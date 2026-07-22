# 🤖 ANÁLISIS DETALLADO: ROBOT DE PRECIOS - Hotel Pricing

## 📋 Resumen Ejecutivo

Este es un **servicio automatizado en Node.js/TypeScript** que:
- ✅ Consulta disponibilidad de habitaciones cada 5 minutos
- ✅ Calcula precios dinámicos según reglas configurables
- ✅ Actualiza automáticamente los precios en el sistema PxSol
- ✅ Registra snapshots de precios en la base de datos
- ✅ Aplica reglas especiales (empty chair, overrides, etc.)

---

## 🏗️ ARQUITECTURA DEL SISTEMA

```
┌─────────────────────────────────────────────────────────────┐
│                     ENTRY POINT: index.ts                   │
│                  (inicia el scheduler)                       │
└─────────────────────────────────────────────────────────────┘
                            ↓
┌─────────────────────────────────────────────────────────────┐
│          pricingJob.ts: SCHEDULER (cada 5 minutos)          │
│  • Ejecuta inmediatamente al iniciar                        │
│  • Luego cada 5 minutos via CRON: */5 * * * *              │
│  • Evita solapamientos (isRunning flag)                     │
└─────────────────────────────────────────────────────────────┘
                            ↓
┌─────────────────────────────────────────────────────────────┐
│    pricingService.ts: runPricingCycle() - LÓGICA PRINCIPAL  │
│                                                              │
│  1️⃣  Obtiene lista de habitaciones (GET /rooms)             │
│  2️⃣  Actualiza datos en BD (Prisma - tabla Room)           │
│  3️⃣  Procesa 12 meses en rangos de 3 meses                │
│  4️⃣  Para cada rango:                                       │
│      - GET disponibilidad (disponibilidad.ts)               │
│      - Carga OVERRIDES de BD (excepciones manuales)         │
│      - Carga SNAPSHOTS previos (comparar cambios)           │
│      - Calcula precios con reglas (pricingRules.ts)         │
│      - PUT actualiza precios en PxSol                       │
│      - Guarda snapshots en BD                               │
│  5️⃣  Log de todos los cambios                               │
└─────────────────────────────────────────────────────────────┘
```

---

## 🗂️ ESTRUCTURA DE CARPETAS

```
hotel-pricing/
├── src/
│   ├── index.ts                    # Punto de entrada
│   │
│   ├── jobs/
│   │   └── pricingJob.ts          # Scheduler con cron (cada 5 min)
│   │
│   ├── services/
│   │   ├── pricingService.ts      # ⭐ Lógica principal de cálculo
│   │   ├── pricingRules.ts        # Reglas especiales (empty chair)
│   │   ├── availabilityService.ts # (vacío en el código)
│   │   └── roomsService.ts        # (sin usar aún)
│   │
│   ├── repos/
│   │   └── pxsolApi.ts            # Endpoints de la API de PxSol
│   │
│   ├── infra/
│   │   ├── http/
│   │   │   └── axiosClient.ts     # Cliente HTTP con reintentos
│   │   └── prisma/
│   │       └── client.ts          # Conexión a BD
│   │
│   ├── utils/
│   │   ├── dateUtils.ts           # Manejo de fechas
│   │   └── logger.ts              # Winston logging
│   │
│   └── config/
│       └── index.ts               # (vacío en el código)
│
├── prisma/
│   └── schema.prisma              # Definición de modelo de datos
│
├── dist/                          # Código compilado (TypeScript → JS)
├── node_modules/                  # Dependencias
├── package.json                   # Scripts y dependencias
├── tsconfig.json                  # Config de TypeScript
└── force-update.ts                # Script para forzar actualización manual
```

---

## 🔄 FLUJO PRINCIPAL DEL CICLO DE PRECIOS

### PASO 1️⃣: Inicialización (Scheduler)
```
startScheduler()
├─ Ejecuta runPricingCycle() inmediatamente
└─ Luego programa cada 5 minutos:
   └─ Si ya está ejecutando, salta el tick
   └─ Si no, ejecuta runPricingCycle()
```

### PASO 2️⃣: Obtener Habitaciones
```
GET /hotels/{HOTEL_ID}/rooms (PxSol API)
↓
Respuesta: {
  rooms: {
    "room_123": {
      room_id: 123,
      code: "101",
      name: "Suite Presidencial",
      rate_plans: {
        "rate_001": {
          rate_id: "rate_001",
          rates: [{ occupancy: 2 }]
        }
      }
    },
    ...
  }
}
↓
UPSERT en BD (tabla Room):
  • externalId, code, name, description, ratePlan
  • Se actualiza si ya existe
```

### PASO 3️⃣: Procesar 12 Meses
```
Hoy: 2025-07-16
┌─ Mes 0-2 (16/7 - 14/10):     GET disponibilidad
├─ Mes 3-5 (16/10 - 14/1):    GET disponibilidad
├─ Mes 6-8 (14/1 - 14/4):     GET disponibilidad
└─ Mes 9-11 (14/4 - 16/7):    GET disponibilidad

Cada rango hace:
1. GET /hotels/{ID}/availability?start={YYYY-MM-DD}&end={YYYY-MM-DD}
2. Procesa disponibilidad por fecha y habitación
3. Calcula precios
4. PUT /availability (actualiza en PxSol)
5. Guarda snapshots
```

### PASO 4️⃣: Calcular Precio para Cada Habitación/Fecha

```
Para cada habitación en cada fecha:

1. DETECTAR CATEGORÍA
   Habitación → RoomCategory → Category
   (una habitación puede estar en múltiples categorías)

2. OBTENER CONFIGURACIÓN
   Category.pricingConfig = {
     baseOccupancy: 2,
     extraPersonAmount: 25,
     pricingByAvailability: {
       "1": { price: 100 },
       "2": { price: 95 },
       "3": { price: 90 },
       "4+": { price: 85 }
     },
     emptyChairRules: [
       {
         fromDays: 0,
         toDays: 2,
         priceBase: 120,
         extraPersonAmount: 35
       }
     ]
   }

3. VERIFICAR OVERRIDE (excepciones manuales)
   ¿Existe PriceOverride para esta categoría/fecha?
   SI → usa priceInitial y addPerPerson del override
   NO → continúa

4. APLICAR REGLA "EMPTY CHAIR" (si está configurada)
   ¿Estamos en los días especificados?
   ¿La regla aplica para la diferencia de hoy a la fecha?
   SI → usa precios de la regla
   NO → usa precio por disponibilidad

5. RESOLVER DISPONIBILIDAD
   ¿Cuántas habitaciones de esta categoría están disponibles?
   Lookup en config.pricingByAvailability:
   • "1" habitación disponible → $100 base
   • "3" habitaciones disponibles → $90 base
   • "5" habitaciones disponibles → busca "4+" → $85 base

6. CALCULAR PRECIO FINAL
   basePrice = precio según disponibilidad/override/empty chair
   
   finalPrice = basePrice + 
                MAX(0, occupancy - baseOccupancy) × extraPersonAmount
   
   EJEMPLO:
   basePrice = $100, baseOccupancy = 2, extraPersonAmount = $25
   • 2 personas: $100 + MAX(0, 2-2) × $25 = $100
   • 3 personas: $100 + MAX(0, 3-2) × $25 = $125
   • 4 personas: $100 + MAX(0, 4-2) × $25 = $150

7. GENERAR TABLA DE TASAS (rates)
   Crea un array de precios para ocupancias 1 a MAX_OCCUPANCY:
   rates = [
     { occupancy: 1, price: 75 },
     { occupancy: 2, price: 100 },
     { occupancy: 3, price: 125 },
     { occupancy: 4, price: 150 }
   ]

8. EVITAR DUPLICADOS
   ¿El precio es igual al del snapshot anterior?
   SI → salta (no log de cambio)
   NO → procede a enviar
```

### PASO 5️⃣: Enviar Precios a PxSol

```
dailyBatch = {
  "room_123": {
    day: "2025-07-16",
    room_id: 123,
    rate_plans: {
      "rate_001": {
        rate_id: "rate_001",
        rates: [
          { occupancy: 1, price: 75 },
          { occupancy: 2, price: 100 },
          { occupancy: 3, price: 125 }
        ]
      }
    }
  },
  "room_456": { ... },
  ...
}

PUT /hotels/{HOTEL_ID}/availability
Body: {
  "2025-07-16": {
    "room_123": { ... },
    "room_456": { ... }
  }
}

Response: ✅ Precios actualizados en PxSol
```

### PASO 6️⃣: Guardar Snapshot

```
UPSERT en BD (tabla PriceSnapshot):
{
  roomExternalId: "123",
  date: 2025-07-16,
  price: 100  (el finalPrice calculado)
}

Sirve para:
✓ Comparar si el precio cambió en próxima ejecución
✓ Auditoría de historial de precios
✓ Análisis de tendencias
```

---

## 💾 MODELO DE DATOS (Prisma)

### Tabla: Room
```
id          INT (PK)
externalId  STRING (unique) ← ID en PxSol
code        STRING          ← Ej: "101", "chapinero-001"
name        STRING          ← Ej: "Suite Presidencial"
description TEXT
ratePlan    STRING          ← ID del plan de tarifa
createdAt   DATETIME
updatedAt   DATETIME

Relación:
  → roomCategories (una habitación puede estar en múltiples categorías)
```

### Tabla: Category
```
id             INT (PK)
name           STRING          ← Ej: "Suite Doble", "Habitación Básica"
description    STRING
pricingConfig  JSON            ← Configuración completa de precios
createdAt      DATETIME
updatedAt      DATETIME

pricingConfig estructura:
{
  "baseOccupancy": 2,
  "extraPersonAmount": 25,
  "pricingByAvailability": {
    "1": { "price": 100 },
    "2": { "price": 95 },
    "3+": { "price": 85 }
  },
  "emptyChairRules": [
    { "fromDays": 0, "toDays": 3, "priceBase": 120, "extraPersonAmount": 35 }
  ]
}

Relación:
  → roomCategories
  → priceOverrides
```

### Tabla: RoomCategory
```
id         INT (PK)
roomId     INT (FK)          ← Relaciona Room
categoryId INT (FK)          ← Relaciona Category
createdAt  DATETIME

Unique: [roomId, categoryId]
```

### Tabla: PriceOverride
```
id            INT (PK)
categoryId    INT (FK)       ← Qué categoría
name          STRING         ← Ej: "Puente festivo 2025"
priceInitial  STRING         ← Precio base para este período
addPerPerson  STRING         ← Cargo por persona extra
dateFrom      DATETIME       ← Inicio del override
dateTo        DATETIME       ← Fin del override
createdAt     DATETIME

Unique: [categoryId, dateFrom, dateTo]

USAR PARA:
• Precios especiales en puentes festivos
• Eventos especiales
• Promociones puntuales
```

### Tabla: PriceSnapshot
```
id             INT (PK)
roomExternalId STRING        ← ID de la habitación
date           DATETIME      ← Fecha del precio
price          INT           ← Precio calculado ese día
updatedAt      DATETIME

Unique: [roomExternalId, date]
Index: [roomExternalId]

AUDITORÍA: guarda todos los precios históricos
```

---

## 🔌 INTEGRACIÓN CON PxSol API

### Endpoints Utilizados

```typescript
// 1. GET Habitaciones
GET /hotels/{HOTEL_ID}/rooms

Request:
  Headers: Authorization: Bearer {PX_API_KEY}

Response:
  {
    "data": {
      "rooms": {
        "123": { ... }
      }
    }
  }

---

// 2. GET Disponibilidad
GET /hotels/{HOTEL_ID}/availability
  ?start_date=2025-07-16
  &end_date=2025-10-14

Response:
  {
    "data": {
      "availability": {
        "2025-07-16": {
          "123": {
            "room_id": 123,
            "quantity": 2,  ← Cuántas disponibles
            "rate_plans": {
              "rate_001": { ... }
            }
          },
          "456": { ... }
        },
        "2025-07-17": { ... },
        ...
      }
    }
  }

---

// 3. PUT Actualizar Precios
PUT /hotels/{HOTEL_ID}/availability

Body:
{
  "2025-07-16": {
    "123": {
      "day": "2025-07-16",
      "room_id": 123,
      "rate_plans": {
        "rate_001": {
          "rate_id": "rate_001",
          "rates": [
            { "occupancy": 1, "price": 100 },
            { "occupancy": 2, "price": 125 },
            { "occupancy": 3, "price": 150 }
          ]
        }
      }
    },
    "456": { ... }
  }
}

Response:
  ✅ Precios actualizados exitosamente
```

### Variables de Entorno Requeridas

```env
# BD
DATABASE_URL=mysql://user:password@host:3306/hotel_pricing

# PxSol API
PX_BASE_URL=https://api.pxsol.com
PX_HOTEL_ID=12345
PX_API_KEY=sk_live_xxxxxxxxxxxxx

# Logging
LOG_LEVEL=info
```

---

## 🎯 REGLAS ESPECIALES

### 1. Empty Chair Pricing
```
"Empty Chair" = vender habitaciones vacías más baratas si faltan
                 poco días para llegar a la fecha

Configuración en Category.pricingConfig.emptyChairRules:
[
  {
    "fromDays": 0,      // Desde hoy
    "toDays": 3,        // Hasta 3 días antes de la fecha
    "priceBase": 120,   // Precio base para ese período
    "extraPersonAmount": 35
  },
  {
    "fromDays": 4,      // 4+ días antes
    "toDays": 14,
    "priceBase": 100,
    "extraPersonAmount": 25
  }
]

LÓGICA:
  diffDays = (fecha de reserva - hoy en días)
  
  ¿Hoy es 16/7 y la fecha es 18/7?
  diffDays = 2
  
  ¿2 está entre fromDays=0 y toDays=3?
  SÍ → usa priceBase=120, extraPersonAmount=35
  NO → busca el siguiente rango que aplique

BENEFICIO:
  • Llenar habitaciones que de otro modo quedarían vacías
  • Precios más competitivos en last-minute
  • Maximizar occupancy
```

### 2. Price Override
```
Para excepciones puntuales (no cubiertas por las reglas)

INSERT en tabla PriceOverride:
{
  categoryId: 5,
  name: "Puente Festivo Julio 2025",
  priceInitial: "200",
  addPerPerson: "50",
  dateFrom: "2025-07-18",
  dateTo: "2025-07-21"
}

LÓGICA:
  Si existe override para (categoryId, fecha), usa sus precios
  Ignora pricingByAvailability y emptyChair durante ese período
```

### 3. Pricing by Availability
```
Precios escalonados según cuántas habitaciones disponibles

Configuración en Category.pricingConfig.pricingByAvailability:
{
  "1": { "price": 150 },   // Si solo 1 disponible → más caro
  "2": { "price": 140 },
  "3": { "price": 130 },
  "4+": { "price": 120 }    // Si 4 o más disponibles → más barato
}

LÓGICA:
  Resuelve qué precio usar según disponibilidad:
  
  ¿Hay 1 habitación disponible?
    → busca "1" → $150 ✓
  
  ¿Hay 5 habitaciones disponibles?
    → busca "5" → NO existe
    → busca "4+" → SÍ existe → $120 ✓
  
  ¿Hay 2 habitaciones disponibles?
    → busca "2" → $140 ✓
```

---

## ⚙️ DEPENDENCIAS PRINCIPALES

```json
{
  "@prisma/client": "^6.0.0",      // ORM para BD
  "axios": "^1.7.0",                // HTTP client
  "axios-retry": "^3.9.1",          // Reintentos automáticos
  "dotenv": "^16.6.1",              // Variables de entorno
  "node-cron": "^3.0.3",            // Scheduler (cron)
  "winston": "^3.13.0"              // Logging
}
```

### Reintentos HTTP (axios-retry)
```
Configurado con:
• 3 reintentos
• Exponential backoff (espera más en cada reintento)
• Reintenta en errores de red y 5xx
• NO reintenta en 4xx (client errors)

Beneficio: Maneja fallos temporales de API
```

---

## 📊 LOGGING (Winston)

El servicio loguea:

```
✅ INFORMACIÓN (INFO):
  "🚀 Ejecutando primer ciclo de pricing"
  "🔁 Ejecutando ciclo programado de pricing"
  "📅 Procesando rango de fechas"
  "➡️ Request:" (antes de cada HTTP call)
  "Precio calculado" (cuando hay cambio)
  "🔥 Empty Chair aplicada"
  "PUT enviado para 2025-07-16 | habitaciones: 5"
  "✅ Snapshots actualizados: 45"

⚠️ ADVERTENCIAS (WARN):
  "⏳ Ciclo anterior aún en ejecución, se omite este tick"

❌ ERRORES (ERROR):
  "❌ Error en primer ciclo"
  "❌ Error GET availability"
  "❌ Error PUT"
  "❌ Configuración inválida para cálculo de precio"
  "HTTP Error"

🐛 DEBUG:
  "Precio sin cambios" (cuando no hay cambio)
```

---

## 🔐 SEGURIDAD

```
✅ Token PxSol en header Authorization: Bearer
✅ Variables de entorno con dotenv (no en código)
✅ Timeout de 10s en HTTP requests
✅ Manejo de errores con try/catch
✅ Logs de errores sin exponer credenciales

⚠️ TODO:
  • Rate limiting (si PxSol lo requiere)
  • Validación de entrada (rangos de fechas, precios)
  • Rollback en caso de error masivo
```

---

## 🚀 CÓMO EJECUTAR

### Desarrollo
```bash
npm install
npm run dev
```
- Usa ts-node para ejecutar TypeScript directo
- Respawn automático si hay cambios
- LOG_LEVEL configurable

### Producción
```bash
npm run build
npm start
```
- Compila TypeScript a JavaScript
- Ejecuta código compilado en dist/

### Migraciones BD
```bash
npm run migrate:dev         # Desarrollo
npm run migrate:deploy      # Producción
npm run prisma:generate     # Regenerar cliente Prisma
```

---

## 🔍 CASOS DE USO

### 1️⃣ Diferencias de Precios por Disponibilidad
```
Misma habitación, misma fecha:
• Lunes 16/7: 5 suites disponibles → $120
• Martes 17/7: 2 suites disponibles → $140
• Miércoles 18/7: 1 suite disponible → $150

Esto maximiza ingresos: precios bajos cuando hay abundancia
```

### 2️⃣ Last-Minute Booking (Empty Chair)
```
Hoy 16/7, precio para 18/7 (en 2 días):
• Sin empty chair: $100
• Con empty chair: $120 (más agresivo)

Razón: Faltan solo 2 días, es mejor vender a precio mayor
       que dejar la habitación vacía
```

### 3️⃣ Puente Festivo (Override)
```
Puente del 16-18 de julio:

INSERT PriceOverride:
  dateFrom: 2025-07-16
  dateTo: 2025-07-18
  priceInitial: "250"
  addPerPerson: "75"

Resultado: Todas las suites cuestan $250 base + $75/persona
           (ignoran la configuración normal)
```

### 4️⃣ Auditoría de Cambios
```
PriceSnapshot registra todos los precios históricos:

SELECT * FROM PriceSnapshot
  WHERE roomExternalId = "123"
  ORDER BY date DESC

Resultado:
  2025-07-16 | room_123 | $100
  2025-07-15 | room_123 | $95
  2025-07-14 | room_123 | $95
  
Puedo ver: ¿cuándo cambió el precio? ¿de cuánto?
```

---

## 🛠️ MANTENIMIENTO

### Agregar nueva categoría de habitación
```
1. INSERT Category:
   name: "Habitación Económica"
   pricingConfig: {
     baseOccupancy: 1,
     extraPersonAmount: 20,
     pricingByAvailability: { ... },
     emptyChairRules: [ ... ]
   }

2. INSERT RoomCategory:
   roomId: 789
   categoryId: (nuevo ID)

3. Próximo ciclo automáticamente calcula precios
```

### Cambiar configuración de precios
```
1. UPDATE Category:
   pricingConfig: {
     baseOccupancy: 3,  (cambio aquí)
     ...
   }

2. Próximo ciclo (en 5 min) usa nueva configuración

3. Histórico en PriceSnapshot queda intacto (auditoría)
```

### Debugging
```
Logs en tiempo real:
npm run dev

Buscar errores:
grep "❌" console

Ver ciclos ejecutados:
grep "Ciclo de pricing finalizado" console

Verificar snapshots:
SELECT * FROM PriceSnapshot
  WHERE date = CURRENT_DATE()
  ORDER BY updatedAt DESC
```

---

## 📈 DIAGRAMA DE FLUJO COMPLETO

```
INICIO
  ↓
[index.ts] → startScheduler()
  ↓
[pricingJob.ts]
  ├─ Ejecuta immediatamente
  └─ Luego cada 5 minutos (cron)
  ↓
[runPricingCycle]
  ↓
┌─ GET /rooms → actualiza tabla Room
├─ LOOP 12 meses (3 meses por iteration)
│ ├─ GET /availability (startDate, endDate)
│ ├─ LOAD BD: priceOverrides, priceSnapshots
│ ├─ LOOP cada fecha en rango
│ │ ├─ LOOP cada habitación en fecha
│ │ │ ├─ RESOLVER categoría
│ │ │ ├─ VERIFICAR empty chair
│ │ │ ├─ VERIFICAR override
│ │ │ ├─ RESOLVER disponibilidad
│ │ │ ├─ CALCULAR precio final
│ │ │ ├─ GENERAR rates array
│ │ │ └─ Agregar a dailyBatch
│ │ ├─ PUT /availability (actualizar PxSol)
│ │ └─ UPSERT priceSnapshots
│ └─ LOG resumen del rango
└─ FINALIZAR ciclo
  ↓
ESPERAR 5 minutos
  ↓
REPETIR
```

---

## ⚡ OPTIMIZACIONES ACTUALES

1. **Batch Processing**: Procesa múltiples habitaciones en un PUT
2. **Precargar en memoria**: Override y snapshots se cargan una vez por rango
3. **Skip duplicados**: No envía PUT si el precio no cambió
4. **Evitar solapamientos**: Flag `isRunning` previene ciclos simultáneos
5. **Reintentos automáticos**: axios-retry maneja fallos temporales
6. **Rango de 3 meses**: Parte 12 meses en 4 queries (más manejable)

---

## 🚨 PUNTOS CRÍTICOS A VIGILAR

1. **Base de datos cayendo**: Fallaría en UPSERT de habitaciones
2. **PxSol API timeout**: Reintentaría 3 veces, luego loguea error
3. **Configuración incompleta**: Si `pricingConfig` falta, continúa sin aplicar reglas
4. **Ocupancy inválida**: Valida que sean números finitos antes de calcular
5. **Ciclo lento**: Si toma >5 minutos, siguiente ciclo se salta (isRunning = true)

---

Documento creado: 2025-07-16 (hora actual en sistema)
Versión: 1.0
Autor: Análisis automatizado de código
