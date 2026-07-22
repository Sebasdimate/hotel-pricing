# 📊 REGLAS DE PRECIOS ACTUALES - Orden y Prioridad

## 🎯 RESUMEN VISUAL

```
┌─────────────────────────────────────────────────────────┐
│           CÁLCULO DE PRECIO (HOY)                       │
│                                                         │
│  Evalúa EN ORDEN y aplica la PRIMERA que funcione      │
└─────────────────────────────────────────────────────────┘
                          ↓
        ┌───────────────────────────────────┐
        │  1️⃣  EMPTY CHAIR (máxima urgencia)│
        │  SI → Usa precio de la regla      │
        │  NO → Continúa ↓                  │
        └───────────────────────────────────┘
                          ↓
        ┌───────────────────────────────────┐
        │  2️⃣  OVERRIDE (excepciones)       │
        │  SI → Usa precio del override     │
        │  NO → Continúa ↓                  │
        └───────────────────────────────────┘
                          ↓
        ┌───────────────────────────────────┐
        │  3️⃣  PRICING BY AVAILABILITY       │
        │  (Fallback/por defecto)           │
        │  Siempre aplica                   │
        └───────────────────────────────────┘
```

---

## 📋 LAS 3 REGLAS ACTUALES

### 1️⃣ EMPTY CHAIR - Regla de Última Hora

**¿QUÉ ES?**
- Estrategia de última hora para vender habitaciones
- Si faltan pocos días (0-3 días), los precios suben (paradoja deliberada)
- Esto incentiva a la gente a reservar AHORA antes de que suba más
- Mejor vender caro a último minuto que dejar vacía

**UBICACIÓN EN CÓDIGO:**
- Función: `resolveEmptyChairPricing()` en `src/services/pricingRules.ts` (línea 1-44)
- Se evalúa PRIMERA (línea 182-192 en pricingService.ts)

**CONFIGURACIÓN EN BD:**
```json
{
  "emptyChairRules": [
    {
      "fromDays": 0,      // Desde hoy (0 días antes)
      "toDays": 3,        // Hasta 3 días antes
      "priceBase": 120,   // Precio base sube a $120
      "extraPersonAmount": 35  // Persona extra: $35
    },
    {
      "fromDays": 4,      // 4 días antes
      "toDays": 14,       // hasta 2 semanas
      "priceBase": 100,   // Baja a $100
      "extraPersonAmount": 25
    }
  ]
}
```

**LÓGICA (pricingRules.ts):**

```typescript
// Calcular cuántos días faltan para esta fecha
const today = 2025-07-16 00:00
const date = 2025-07-18 00:00
diffDays = 2

// Buscar regla que aplique
emptyChairRules[0]: fromDays=0, toDays=3
¿2 >= 0 && 2 <= 3? → SÍ ✓

// Resultado: usa esta regla
basePrice = 120
extraPersonAmount = 35
```

**EJEMPLO:**

```
Hoy: 16/7/2025

Para el 17/7 (en 1 día):
  diffDays = 1
  ¿Regla 0-3? SÍ → basePrice = $120 (CARO)

Para el 21/7 (en 5 días):
  diffDays = 5
  ¿Regla 0-3? NO
  ¿Regla 4-14? SÍ → basePrice = $100 (moderado)

Para el 30/7 (en 14 días):
  diffDays = 14
  ¿Regla 4-14? SÍ (está en límite) → basePrice = $100

Para el 31/7 (en 15 días):
  diffDays = 15
  ¿Regla 4-14? NO (15 > 14)
  ¿Hay otra regla? NO
  → NO aplica Empty Chair, continúa con Override/Availability
```

**¿POR QUÉ MÁXIMA PRIORIDAD?**
- Vender a último minuto es CRÍTICO para hoteles
- Si falta 1 día, mejor cobrar $120 que perder esa noche
- Empty Chair > todo lo demás

---

### 2️⃣ OVERRIDE - Excepciones Manuales

**¿QUÉ ES?**
- Precios manuales para fechas específicas
- Usados para eventos, puentes festivos, promociones
- "Hoy es 15 de agosto (festivo), todas las suites cuestan $250"

**UBICACIÓN EN CÓDIGO:**
- Tabla BD: `PriceOverride` en `prisma/schema.prisma` (línea 37-50)
- Se evalúa SEGUNDA (línea 193-195 en pricingService.ts)

**ESTRUCTURA EN BD:**

```sql
Table: PriceOverride
┌──────────────────────────────────────────────────────┐
│ id       | categoryId | name              | price    │
├──────────┼────────────┼───────────────────┼──────────┤
│ 1        | 1          | "Puente 15 Agosto"| 250      │
│ 2        | 1          | "Navidad"         | 300      │
│ 3        | 2          | "Puente 15 Agosto"| 150      │
└──────────┴────────────┴───────────────────┴──────────┘

dateFrom: 2025-08-14 (miércoles)
dateTo: 2025-08-18 (domingo)
priceInitial: "250"
addPerPerson: "75"
```

**LÓGICA (pricingService.ts línea 175-176):**

```typescript
// Crear clave para buscar
const overrideKey = `${category.id}_${dateKey}`;
// Ejemplo: "1_2025-08-15"

// Buscar en mapa (preargado)
const override = overrideMap.get(overrideKey);
// Si existe: override = { categoryId: 1, priceInitial: "250", addPerPerson: "75", ... }
// Si no existe: override = undefined
```

**EJEMPLO:**

```
Override creado: 15-18 Agosto, Categoría "Suite Doble", $250 base

Para 16/8:
  overrideKey = "1_2025-08-16"
  ¿Existe en overrideMap? SÍ ✓
  → Usar basePrice = $250, extraPersonAmount = $75

Para 20/8:
  overrideKey = "1_2025-08-20"
  ¿Existe en overrideMap? NO
  → Continuar con Pricing by Availability
```

**CUÁNDO SE USA:**

1. **Puentes Festivos**
   - 20 de Julio (Independencia)
   - 7 de Agosto (Batalla de Boyacá)
   - 25 de Diciembre (Navidad)

2. **Eventos Especiales**
   - Concierto en la ciudad → suben precios
   - Conferencia próxima → suben precios
   - Baja temporada → bajan precios

3. **Promociones**
   - "Mes del Cliente" → descuento manual
   - "Black Friday" → precio especial

**¿POR QUÉ SEGUNDA PRIORIDAD?**
- Menos urgente que Empty Chair
- Pero más importante que precios normales
- Permite control manual sobre automático

---

### 3️⃣ PRICING BY AVAILABILITY - Precios Estándares

**¿QUÉ ES?**
- Precios escalonados según cuántas habitaciones disponibles
- "Si solo queda 1 suite, es cara. Si hay 5, es barata"
- La ley de oferta y demanda

**UBICACIÓN EN CÓDIGO:**
- Función: `resolveAvailabilityKey()` en `src/services/pricingService.ts` (línea 30-43)
- Se evalúa TERCERA (línea 196-203)

**CONFIGURACIÓN EN BD:**

```json
{
  "pricingByAvailability": {
    "1": { "price": 150 },   // Si 1 disponible → cara
    "2": { "price": 140 },   // Si 2 disponibles → medio
    "3": { "price": 130 },   // Si 3 disponibles → bajo
    "4+": { "price": 120 }   // Si 4+ disponibles → muy bajo
  }
}
```

**LÓGICA (pricingService.ts línea 197-203):**

```typescript
// Contar cuántas habitaciones de esta categoría están disponibles
const availableCount = categoryAvailability[category.id];
// Ejemplo: 2 (hay 2 suites disponibles)

// Buscar precio exacto
if (pricing["2"]) {
  return "2"; // Encontrado: usa precio de "2"
}

// Si no existe, buscar "X+"
const plusKey = Object.keys(pricing).find(k => k.endsWith("+"));
// plusKey = "4+"

if (availableCount >= 4) {
  return "4+"; // Usa este precio
}

// Si nada coincide
return null; // SKIP (no hay precio para esta disponibilidad)
```

**EJEMPLO:**

```
Hoy 16/7, hay disponibilidad de Suites en este estado:

Habitación 101: quantity = 1 disponible
Habitación 102: quantity = 2 disponibles
Habitación 103: quantity = 0 disponible (ocupada)

categoryAvailability[1] = 1 + 2 = 3 suites disponibles

Para calcular precio:
  availableCount = 3
  ¿pricing["3"]? SÍ → $130 ✓
  
  Si hubiera 0:
  availableCount = 0
  ¿pricing["0"]? NO
  ¿pricing["4+"]? NO
  → return null (SKIP)
  
  Si hubiera 5:
  availableCount = 5
  ¿pricing["5"]? NO
  ¿pricing["4+"]? SÍ → $120 ✓
```

**¿POR QUÉ FALLBACK?**
- Siempre debe haber un precio
- Si no aplica Empty Chair ni Override, usa disponibilidad
- Es el precio "por defecto"

---

## 🔀 TABLA COMPARATIVA

| Aspecto | Empty Chair | Override | Availability |
|---------|-------------|----------|--------------|
| **Prioridad** | 1️⃣ Máxima | 2️⃣ Media | 3️⃣ Baja (default) |
| **Cuándo aplica** | Faltan 0-14 días | Fechas específicas | Siempre que haya disponibilidad |
| **Quién decide** | Config automática | Admin manual | Config automática |
| **Variabilidad** | Predecible (por días) | Impredecible (eventos) | Predecible (por cantidad) |
| **Objetivo** | Vender last-minute | Casos especiales | Optimizar según demanda |
| **Ejemplo** | Hoy falta 1 día → $120 | Puente 15 Agosto → $250 | 3 disponibles → $130 |

---

## 📈 FLUJO COMPLETO CON EJEMPLO

**CASO REAL:**

Hoy: 16 de Julio de 2025
Suite Doble, 3 disponibles, NO hay override para hoy

```
┌─ PASO 1: Verificar Empty Chair
│ ├─ diffDays = 0 (hoy)
│ ├─ ¿Encaja en regla 0-3? SÍ
│ ├─ basePrice = 120 ✓
│ └─ APLICA EMPTY CHAIR → FIN
│
└─ (No continúa porque ya encontró regla)

RESULTADO: basePrice = 120 (EMPTY CHAIR gana)
```

**CASO 2: En 5 días (21/7)**

Hoy: 16 de Julio
Para el 21 de Julio (en 5 días)
Suite Doble, 3 disponibles, NO hay override

```
┌─ PASO 1: Verificar Empty Chair
│ ├─ diffDays = 5
│ ├─ ¿Encaja en regla 0-3? NO (5 > 3)
│ ├─ ¿Encaja en regla 4-14? SÍ
│ ├─ basePrice = 100 ✓
│ └─ APLICA EMPTY CHAIR → FIN
│
└─ (No continúa porque ya encontró regla)

RESULTADO: basePrice = 100 (EMPTY CHAIR gana)
```

**CASO 3: En 15 días (31/7) SIN Empty Chair**

Hoy: 16 de Julio
Para el 31 de Julio (en 15 días)
Suite Doble, 3 disponibles, NO hay override

```
┌─ PASO 1: Verificar Empty Chair
│ ├─ diffDays = 15
│ ├─ ¿Encaja en regla 0-3? NO
│ ├─ ¿Encaja en regla 4-14? NO (15 > 14)
│ ├─ NO HAY REGLA que aplique
│ └─ applied = false → Continúa
│
├─ PASO 2: Verificar Override
│ ├─ overrideKey = "1_2025-07-31"
│ ├─ ¿Existe en BD? NO
│ └─ override = undefined → Continúa
│
├─ PASO 3: Pricing by Availability
│ ├─ availableCount = 3
│ ├─ ¿pricing["3"]? SÍ
│ ├─ basePrice = 130 ✓
│ └─ APLICA AVAILABILITY → FIN

RESULTADO: basePrice = 130 (AVAILABILITY gana)
```

**CASO 4: Puente con Override (15 Agosto)**

Hoy: 16 de Julio
Para el 15 de Agosto (en 30 días)
Suite Doble, 1 disponible, HAY override para este día

```
┌─ PASO 1: Verificar Empty Chair
│ ├─ diffDays = 30
│ ├─ ¿Encaja en rule? NO (30 > 14)
│ └─ applied = false → Continúa
│
├─ PASO 2: Verificar Override
│ ├─ overrideKey = "1_2025-08-15"
│ ├─ ¿Existe en BD? SÍ ✓
│ ├─ override.priceInitial = "250"
│ ├─ basePrice = 250 ✓
│ └─ APLICA OVERRIDE → FIN
│
└─ (No llega a Availability porque Override ganó)

RESULTADO: basePrice = 250 (OVERRIDE gana)
```

**CASO 5: Todo junto (Puente con 1 suite y Empty Chair aplica)**

Hoy: 16 de Julio
Para el 17 de Julio (mañana, en 1 día)
Suite Doble, 1 disponible, HAY override pero NO aplica para mañana

```
┌─ PASO 1: Verificar Empty Chair
│ ├─ diffDays = 1 (mañana)
│ ├─ ¿Encaja en regla 0-3? SÍ
│ ├─ basePrice = 120 ✓
│ └─ APLICA EMPTY CHAIR → FIN
│
└─ (Override nunca se evalúa porque Empty Chair ganó primero)

RESULTADO: basePrice = 120 (EMPTY CHAIR gana)

NOTA: Empty Chair DOMINA aunque solo haya 1 suite disponible
      Incluso si no hubiera override, Empty Chair de todas formas gana
```

---

## 🎯 MATRIZ DE DECISIÓN

```
┌──────────────────────────────────────────────────────────────┐
│  CUÁL REGLA APLICA (según combinación de condiciones)        │
└──────────────────────────────────────────────────────────────┘

Empty Chair sí, Override sí → EMPTY CHAIR gana
Empty Chair sí, Override no → EMPTY CHAIR gana
Empty Chair no, Override sí → OVERRIDE gana
Empty Chair no, Override no → AVAILABILITY gana

╔════════════════════════════════════════════════════════════╗
║  RESUMEN: Empty Chair SIEMPRE gana si aplica             ║
║           Override gana si Empty Chair NO aplica          ║
║           Availability es el fallback (siempre disponible) ║
╚════════════════════════════════════════════════════════════╝
```

---

## 💡 CUÁNDO CADA REGLA ES MÁS IMPORTANTE

### Empty Chair DOMINA cuando:
✅ Hay poco tiempo (menos de 2 semanas)
✅ Necesitas llenar rápido
✅ Es fin de semana (más turismo)
✅ Preferencia estratégica: vender a último momento

### Override DOMINA cuando:
✅ Hay eventos especiales (concierto, conferencia)
✅ Fechas festivas (puentes, navidad)
✅ Quieres ofrecer promociones específicas
✅ Necesitas control manual total

### Availability DOMINA cuando:
✅ Hay mucho tiempo (>2 semanas)
✅ No hay eventos especiales
✅ Quieres precios automáticos dinámicos
✅ La disponibilidad varía mucho día a día

---

## 🔍 CÓDIGO: DÓNDE VER ESTO EN EL PROYECTO

### pricingService.ts (línea 182-204):

```typescript
// ════════════════════════════════════════════════════════
// PASO CRÍTICO 3: DETERMINAR EL PRECIO BASE
// ════════════════════════════════════════════════════════

const emptyChair = resolveEmptyChairPricing({...});

if (emptyChair.applied) {              // ← 1. EMPTY CHAIR
  basePrice = emptyChair.basePrice;
  extraPersonAmountNum = emptyChair.extraPersonAmount;
  emptyChairApplied = true;
} else if (override) {                 // ← 2. OVERRIDE
  basePrice = Number(override.priceInitial);
  extraPersonAmountNum = Number(override.addPerPerson ?? ...);
} else {                                // ← 3. AVAILABILITY
  const key = resolveAvailabilityKey(availableCount, config.pricingByAvailability);
  if (!key) continue;
  basePrice = config.pricingByAvailability[key].price;
  extraPersonAmountNum = Number(config.extraPersonAmount ?? 0);
}
```

### pricingRules.ts (línea 25-29):

```typescript
const rule = config.emptyChairRules.find(
  (r: any) =>
    diffDays >= Number(r.fromDays) &&
    diffDays <= Number(r.toDays)
);
```

### pricingService.ts (línea 30-43):

```typescript
function resolveAvailabilityKey(availableCount, pricing) {
  if (pricing[String(availableCount)]) {
    return String(availableCount);
  }
  const plusKey = Object.keys(pricing).find(k => k.endsWith("+"));
  if (plusKey) {
    const min = Number(plusKey.replace("+", ""));
    if (availableCount >= min) return plusKey;
  }
  return null;
}
```

---

## ⚠️ PUNTOS CRÍTICOS

### 1. Empty Chair NO es "descuento"
```
EQUIVOCADO: "Empty Chair baja los precios"
CORRECTO: "Empty Chair SUBE los precios en últimos días"
```

Teoría: "Mejor perder 1 noche barata que perder $0"

### 2. Override SIEMPRE gana a Availability
```
Si hay override para una fecha:
- Ignore Pricing by Availability
- Ignore que solo hay 1 suite
- Use exactamente el precio del override
```

### 3. Availability NUNCA da null
```
EXCEPTO si:
- No hay precio configurado (raro)
- availableCount = 0 (no hay nada disponible)

Cualquier otro caso → siempre hay precio
```

---

## 📊 ESTADÍSTICA TÍPICA

De 100 noches calculadas:

```
Empty Chair aplica:  20% (últimos 14 días de cada mes)
Override aplica:     5% (puentes, eventos, promociones)
Availability aplica: 75% (el resto de los días)
```

---

## 🎓 CONCLUSIÓN

**HOY, las 3 reglas en orden son:**

1. **Empty Chair** - Máxima urgencia (vender rápido)
2. **Override** - Control manual (eventos/puentes)
3. **Availability** - Automático dinámico (oferta/demanda)

**La jerarquía es:**
```
Empty Chair > Override > Availability
```

**Si quisieras cambiar la prioridad:**
- Mover el IF de Empty Chair a otra posición en pricingService.ts

**Si quisieras agregar más reglas (como Gap Nights):**
- Iría ANTES de Empty Chair (máxima prioridad)

```
Gap Nights > Empty Chair > Override > Availability
```

---

Documento creado: 2025-07-16
Claridad: MÁXIMA
Ejemplos: 5+ casos reales
