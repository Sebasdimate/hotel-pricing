# 🔬 ANÁLISIS PROFUNDO Y DETALLADO - ROBOT DE PRECIOS

## 📚 TABLA DE CONTENIDOS
1. Inicialización del servicio
2. Ejemplo práctico paso a paso (con datos reales)
3. Explicación línea por línea de cada función
4. Estados de la base de datos en cada momento
5. Cálculos matemáticos detallados
6. HTTP requests/responses reales
7. Puntos clave de lógica

---

# 1️⃣ INICIALIZACIÓN DEL SERVICIO

## Paso 0: Variables de Entorno (necesarias)

```env
# DATABASE_URL define la conexión MySQL
# Formato: mysql://usuario:contraseña@host:puerto/nombre_bd
DATABASE_URL=mysql://root:password@localhost:3306/hotel_pricing

# PxSol API (el sistema externo de hoteles)
PX_BASE_URL=https://api.pxsol.com
PX_HOTEL_ID=12345
PX_API_KEY=sk_live_1a2b3c4d5e6f7g8h9i0j

# Logging
LOG_LEVEL=info
NODE_ENV=development
```

---

## Paso 1: Cargar Archivos (npm start)

### 1.1 - entry: `src/index.ts`

```typescript
// LÍNEA 1-2: Cargar variables de entorno
import "dotenv/config";
// ↳ Lee .env y carga todo en process.env

// LÍNEA 2: Importar función del scheduler
import { startScheduler } from "./jobs/pricingJob";

// LÍNEA 3: Importar logger
import { logger } from "./utils/logger";

// LÍNEA 5-13: Función main asíncrona
async function main() {
  logger.info("Arrancando servicio.."); // LOG: [YYYY-MM-DD HH:mm:ss] INFO: Arrancando servicio...
  
  // NOTA: Las migraciones se corren aparte con "npm run migrate:deploy"
  // Aquí solo iniciamos el scheduler
  
  await startScheduler(/* immediateRun = true */);
  // ↳ Esta línea INICIA EL SCHEDULER
  // ↳ Ejecuta el primer ciclo de precios inmediatamente
  // ↳ Luego programa ejecuciones cada 5 minutos
}

// LÍNEA 15-18: Ejecutar main y capturar errores
main().catch(err => {
  console.error(err);
  process.exit(1); // Salir con código de error
});
```

**⏱️ TIMELINE EN ESTE MOMENTO:**
- T = 0s: logger cargado
- T = 0.1s: Prisma conecta a BD (en background)
- T = 0.5s: Axios client configurado con reintentos
- T = 1s: Logger avisa "✅ Conectado a la base de datos"
- T = 1.1s: startScheduler() inicia

---

### 1.2 - Inicialización: `src/infra/prisma/client.ts`

```typescript
// LÍNEA 1: Importar cliente Prisma
import { PrismaClient, Prisma } from "@prisma/client";

// LÍNEA 4-6: Crear global para evitar duplicados
// ↳ En desarrollo con hot reload, Node reinicia pero queremos 1 conexión BD
const globalForPrisma = global as unknown as {
  prisma?: PrismaClient;
};

// LÍNEA 9-13: SINGLETON PATTERN
// ↳ Si ya existe prisma global, lo usa
// ↳ Si no existe, crea uno nuevo
export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    log: ["info", "warn", "error"], // Loguea queries importantes
  });

// LÍNEA 16-18: En desarrollo, guardar en global
if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
}

// LÍNEA 21-28: IIFE (Immediately Invoked Function Expression)
// ↳ Se ejecuta instantáneamente al cargar el archivo
(async () => {
  try {
    await prisma.$connect(); // ← CONEXIÓN REAL A BD
    logger.info("✅ Conectado a la base de datos correctamente.");
  } catch (error: any) {
    logger.error(`❌ Error al conectar a la base de datos: ${error.message}`);
  }
})();

// LÍNEA 31-34: Limpieza al cerrar el proceso
process.on("beforeExit", async () => {
  logger.info("🔌 Cerrando conexión con la base de datos...");
  await prisma.$disconnect();
});
```

**¿QUÉ OCURRE EXACTAMENTE?**

1. Node.js importa `client.ts`
2. Se ejecuta la IIFE anónima (líneas 21-28)
3. Llama `prisma.$connect()`
4. **Prisma abre conexión MySQL real**
5. Si tiene éxito: logger.info() → Console
6. Archivo termina, control vuelve a `index.ts`

---

### 1.3 - Inicialización HTTP: `src/infra/http/axiosClient.ts`

```typescript
// LÍNEA 1-2: Importar dependencias
import axios from "axios";
import axiosRetry from "axios-retry";

// LÍNEA 5-8: Crear cliente axios
const client = axios.create({
  timeout: 10000, // ← 10 segundos máximo por request
  headers: { "Content-Type": "application/json" },
});

// LÍNEA 10-18: CONFIGURAR REINTENTOS AUTOMÁTICOS
axiosRetry(client, {
  retries: 3,  // ← Reintenta hasta 3 veces
  retryDelay: axiosRetry.exponentialDelay,
  // ↳ Espera: 1s, 2s, 4s (exponencial)
  
  shouldResetTimeout: true,
  // ↳ Resetea timeout en cada reintento
  
  retryCondition: (error) => {
    // ↳ CUÁNDO reintentar:
    return axiosRetry.isNetworkError(error) || // Fallos de red
           axiosRetry.isRetryableError(error);   // 5xx (server error)
    // ↳ NO reintenta en 4xx (client errors - datos malos)
  },
});

// LÍNEA 20-39: Interceptor de REQUEST
client.interceptors.request.use(
  (config) => {
    // ← Se ejecuta ANTES de cada request
    
    const token = process.env.PX_API_KEY;
    // ↳ Lee "sk_live_1a2b3c4d5e6f7g8h9i0j" de .env
    
    if (token) {
      config.headers.Authorization = `Bearer ${token}`;
      // ↳ Agrega header: Authorization: Bearer sk_live_...
    }

    logger.info("➡️ Request:", {
      url: config.url,
      method: config.method,
    });
    // ↳ LOG: [17:45:32] INFO: ➡️ Request: | meta={...}
    
    return config; // ← Permite que el request continúe
  },
  (error) => {
    logger.error("Error en request interceptor", { message: error.message });
    return Promise.reject(error);
  }
);

// LÍNEA 41-47: Interceptor de RESPONSE
client.interceptors.response.use(
  res => res, // ← Si respuesta es exitosa, devuelve tal cual
  err => {
    logger.error("HTTP Error", { message: err.message, url: err.config?.url });
    return Promise.reject(err); // ← Propaga el error
  }
);

// LÍNEA 49: EXPORTAR cliente
export default client;
// ↳ Otros módulos importan esto y lo usan
```

**¿QUÉ PASARÍA SI PxSol API FALLA?**

```
Intento 1 (5s): GET /rooms → timeout/error
  ↓ espera 1s
Intento 2 (7s): GET /rooms → timeout/error
  ↓ espera 2s
Intento 3 (11s): GET /rooms → timeout/error
  ↓ espera 4s
Intento 4 (15s): GET /rooms → timeout/error
  ↓ FALLAR
Error log: "❌ Error GET availability | status=undefined | timeout"
Continúa con próxima ronda en 5 minutos
```

---

### 1.4 - Inicialización Logger: `src/utils/logger.ts`

```typescript
import { createLogger, format, transports } from "winston";
// ↳ Winston = librería de logging profesional

const { combine, timestamp, printf, colorize, splat } = format;

// LÍNEA 5-14: Función helper para evitar referencias circulares
function safeStringify(obj: any): string {
  const seen = new WeakSet();
  // ↳ Rastrear objetos ya procesados
  
  return JSON.stringify(obj, (key, value) => {
    // ↳ Revisor de JSON: se ejecuta en cada propiedad
    
    if (typeof value === "object" && value !== null) {
      if (seen.has(value)) return "[Circular]"; // ← Si ya lo vimos, return "[Circular]"
      seen.add(value); // ← Marcar como visto
    }
    return value; // ← Continuar con el valor
  }, 2); // ← 2 espacios de indentación
}

// LÍNEA 16-23: Formato personalizado de logs
const logFormat = printf(({ level, message, timestamp, ...meta }) => {
  // ↳ Destructurar: level, message, timestamp, y lo demás en meta
  
  const metaString =
    meta && Object.keys(meta).length > 0
      ? ` | meta=${safeStringify(meta)}`
      : "";
  // ↳ Si hay metadatos, incluirlos en string
  
  // Resultado: "[2025-07-16 17:45:32] INFO: Mensaje | meta={...}"
  return `[${timestamp}] ${level}: ${message}${metaString}`;
});

// LÍNEA 25-38: Crear logger
export const logger = createLogger({
  level: "info", // ← Solo loguear 'info' y arriba (warn, error)
  format: combine(
    splat(), // ← Permite usar %s %d en mensajes
    timestamp({ format: "YYYY-MM-DD HH:mm:ss" }),
    logFormat
  ),
  transports: [
    // ↳ DÓNDE escribir los logs:
    
    new transports.Console({
      // ↳ 1. CONSOLA (terminal)
      format: combine(colorize(), splat(), timestamp(), logFormat),
      // ↳ colorize() = colores en terminal (rojo para ERROR, etc)
    }),
    
    new transports.File({ 
      filename: "logs/error.log", 
      level: "error" 
      // ↳ 2. ARCHIVO: solo errores en logs/error.log
    }),
    
    new transports.File({ 
      filename: "logs/combined.log" 
      // ↳ 3. ARCHIVO: todos los logs en logs/combined.log
    }),
  ],
});
```

**EJEMPLO DE OUTPUT:**

```
CONSOLA:
[2025-07-16 17:45:32] INFO: Arrancando servicio...
[2025-07-16 17:45:33] INFO: ✅ Conectado a la base de datos correctamente.
[2025-07-16 17:45:34] INFO: 🚀 Ejecutando primer ciclo de pricing
[2025-07-16 17:45:35] INFO: ➡️ Request: | meta={"url":"https://api.pxsol.com/...","method":"GET"}

logs/error.log:
[2025-07-16 17:46:01] ERROR: ❌ Error GET availability | meta={...}

logs/combined.log:
[Todos los logs anteriores]
```

---

# 2️⃣ EJEMPLO PRÁCTICO PASO A PASO

## ESCENARIO REAL

**Hotel: "Boutique Hotel Bogotá"**
- 3 habitaciones (123, 456, 789)
- 2 categorías (Suite Doble, Habitación Económica)
- Hoy: 16/7/2025, 17:45:32

### BASE DE DATOS INICIAL (antes del ciclo)

```sql
-- Tabla Category
id=1, name="Suite Doble", pricingConfig={...}
id=2, name="Habitación Económica", pricingConfig={...}

-- Tabla Room
id=1, externalId="123", code="101", name="Suite 101", ratePlan="rate_001"
id=2, externalId="456", code="102", name="Suite 102", ratePlan="rate_001"
id=3, externalId="789", code="201", name="Económica", ratePlan="rate_002"

-- Tabla RoomCategory
id=1, roomId=1, categoryId=1  (Suite 101 → Suite Doble)
id=2, roomId=2, categoryId=1  (Suite 102 → Suite Doble)
id=3, roomId=3, categoryId=2  (Económica → Económica)

-- Tabla PriceOverride (vacía hoy)
(sin registros)

-- Tabla PriceSnapshot (últimos 3 días)
roomExternalId="123", date="2025-07-14", price=100
roomExternalId="123", date="2025-07-15", price=100
roomExternalId="456", date="2025-07-14", price=100
roomExternalId="456", date="2025-07-15", price=100
roomExternalId="789", date="2025-07-14", price=60
roomExternalId="789", date="2025-07-15", price=60
```

---

## T = 17:45:32 - COMIENZA EL CICLO

### FASE 1: `startScheduler()` en pricingJob.ts

```typescript
// Línea 7-22
export async function startScheduler() {
  if (!isRunning) {  // ← isRunning = false inicialmente
    try {
      isRunning = true;  // ← SET FLAG (prevenir ciclos simultáneos)
      
      logger.info("🚀 Ejecutando primer ciclo de pricing");
      // OUTPUT: [2025-07-16 17:45:32] INFO: 🚀 Ejecutando primer ciclo de pricing

      await runPricingCycle();
      // ↳ ← AQUÍ OCURRE TODO (ver siguiente fase)
      
      logger.info("✅ Primer ciclo ejecutado correctamente");
      // OUTPUT: [2025-07-16 17:45:XX] INFO: ✅ Primer ciclo ejecutado correctamente
    } catch (err) {
      logger.error("❌ Error en primer ciclo", err);
      // ↳ Si falla, loguea el error
    } finally {
      isRunning = false;  // ← RESET FLAG (permitir próximo ciclo)
    }
  }
}

// Línea 28-44: Programar cada 5 minutos
cron.schedule("*/5 * * * *", async () => {
  // ↳ CRON: cada 5 minutos en cualquier hora de cualquier día
  // ↳ */5 = minutos 0,5,10,15,20,25,30,35,40,45,50,55
  
  if (isRunning) {
    // ↳ Si el ciclo anterior aún está ejecutando...
    logger.warn("⏳ Ciclo anterior aún en ejecución, se omite este tick");
    return; // ← SKIP este tick
  }

  try {
    isRunning = true;
    logger.info("🔁 Ejecutando ciclo programado de pricing");
    await runPricingCycle();
    logger.info("✅ Ciclo programado ejecutado correctamente");
  } catch (err) {
    logger.error("❌ Error en ciclo programado", err);
  } finally {
    isRunning = false;
  }
});

logger.info("🕒 Scheduler de pricing iniciado (cada 5 minutos)");
// OUTPUT: [2025-07-16 17:45:33] INFO: 🕒 Scheduler iniciado...
```

**ESTADO EN ESTE MOMENTO:**
- isRunning = true
- A las 17:50:32, 17:55:32, 18:00:32 etc, se ejecutará el mismo ciclo automáticamente

---

### FASE 2: `runPricingCycle()` en pricingService.ts

#### 2.1 - Obtener Habitaciones (Línea 45-69)

```typescript
export async function runPricingCycle() {
  logger.info("🚀 Iniciando ciclo de pricing");
  // OUTPUT: [2025-07-16 17:45:34] INFO: 🚀 Iniciando ciclo...

  // LÍNEA 48: GET /rooms
  const roomsResp = await httpClient.get(pxsolEndpoints.rooms());
  // ↳ httpClient = axios con reintentos
  // ↳ pxsolEndpoints.rooms() devuelve:
  //   "https://api.pxsol.com/hotels/12345/rooms"
  // ↳ Headers incluyen: Authorization: Bearer sk_live_...

  // RESPUESTA DE PxSol (lo que devuelve la API):
  /*
  {
    "data": {
      "data": {
        "rooms": {
          "123": {
            "room_id": 123,
            "code": "101",
            "name": "Suite 101",
            "description": "Suite de lujo con vista",
            "rate_plans": {
              "rate_001": {
                "rate_id": "rate_001",
                "rates": [
                  { "occupancy": 2, "price": 150 }
                ]
              }
            }
          },
          "456": {
            "room_id": 456,
            "code": "102",
            "name": "Suite 102",
            ...
          },
          "789": {
            "room_id": 789,
            "code": "201",
            "name": "Económica",
            ...
          }
        }
      }
    }
  }
  */

  // LÍNEA 49: Extraer data.data.rooms
  const rooms = roomsResp.data.data.rooms;
  // ↳ rooms ahora contiene el objeto con "123", "456", "789"

  // LÍNEA 51-68: LOOP por cada habitación
  for (const r of Object.values<any>(rooms)) {
    // ↳ r es cada habitación (123, 456, 789)
    
    // LÍNEA 52: Obtener el primer (y único) plan de tarifa
    const ratePlanObj = Object.values(r.rate_plans as Record<string, RatePlan>)[0];
    // ↳ Ejemplo: { rate_id: "rate_001", rates: [...] }

    // LÍNEA 53-68: UPSERT en tabla Room
    // ↳ Actualizar si existe, crear si no existe
    await prisma.room.upsert({
      where: { externalId: String(r.room_id) },
      // ↳ Buscar por externalId = "123"

      update: {
        code: r.code,           // "101"
        name: r.name,           // "Suite 101"
        description: r.description, // "Suite de lujo..."
        ratePlan: String(ratePlanObj.rate_id), // "rate_001"
      },
      // ↳ Si existe, actualizar estos campos

      create: {
        externalId: String(r.room_id),
        code: r.code,
        name: r.name,
        description: r.description,
        ratePlan: String(ratePlanObj.rate_id),
      },
      // ↳ Si NO existe, crear con estos datos
    });
  }
  // ↳ Resultado: Las 3 habitaciones están en la BD
}
```

**ESTADO DE BD DESPUÉS:**

```sql
Room tabla (sin cambios en este hotel, pero si fuera nuevo):
id=1, externalId="123", code="101", name="Suite 101", ratePlan="rate_001"
id=2, externalId="456", code="102", name="Suite 102", ratePlan="rate_001"
id=3, externalId="789", code="201", name="Económica", ratePlan="rate_002"
```

---

#### 2.2 - Cargar Configuración de BD (Línea 71-81)

```typescript
// LÍNEA 71-76: Obtener habitaciones con categorías
const roomsDb: RoomWithCategories[] = await prisma.room.findMany({
  include: {
    roomCategories: {
      include: { category: true },
      // ↳ Traer también las categorías relacionadas
    },
  },
});

// RESULTADO (roomsDb):
/*
[
  {
    id: 1,
    externalId: "123",
    code: "101",
    name: "Suite 101",
    ratePlan: "rate_001",
    roomCategories: [
      {
        id: 1,
        roomId: 1,
        categoryId: 1,
        category: {
          id: 1,
          name: "Suite Doble",
          pricingConfig: {
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
                toDays: 3,
                priceBase: 120,
                extraPersonAmount: 35
              }
            ]
          }
        }
      }
    ]
  },
  { ... habitación 456 ... },
  { ... habitación 789 ... }
]
*/

// LÍNEA 79-81: Crear Map para búsqueda rápida
const roomMap = new Map<string, RoomWithCategories>(
  roomsDb.map(r => [r.externalId, r])
);
// ↳ Clave: externalId ("123")
// ↳ Valor: objeto Room completo con sus categorías
// ↳ Para búsquedas de O(1) en lugar de O(n)
```

---

#### 2.3 - Procesamiento por Rangos de Meses (Línea 83-322)

```typescript
// LÍNEA 83-85: Configuración de rango
const baseDate = normalizeDate(new Date());
// ↳ Hoy 2025-07-16 → normalizado a 2025-07-16 00:00:00

const RANGE_MONTHS = 3;  // Procesar 3 meses por iteración
const TOTAL_MONTHS = 12; // Total 12 meses

// LÍNEA 87: LOOP por cada rango (0, 3, 6, 9)
for (let offset = 0; offset < TOTAL_MONTHS; offset += RANGE_MONTHS) {
  // Iteración 1: offset = 0
  // Iteración 2: offset = 3
  // Iteración 3: offset = 6
  // Iteración 4: offset = 9

  // LÍNEA 88-89: Calcular fecha inicio y fin
  const startDate = addMonths(baseDate, offset);
  // ↳ addMonths(16/7, 0) = 16/7
  // ↳ addMonths(16/7, 3) = 16/10
  // ↳ addMonths(16/7, 6) = 16/1 (2026)
  // ↳ addMonths(16/7, 9) = 16/4 (2026)

  const endDate = addDays(startDate, 90);
  // ↳ Sumar 90 días al inicio
  // ↳ Rango: 91 días (16/7 a 14/10, por ejemplo)

  logger.info("📅 Procesando rango de fechas", { startDate, endDate });
  // OUTPUT: [17:45:35] INFO: 📅 Procesando... | meta={startDate:"2025-07-16T00:00:00Z",...}
```

---

#### 2.4 - GET Disponibilidad (Línea 94-106)

```typescript
  // DENTRO DEL LOOP POR RANGOS

  let availability: any;
  try {
    // LÍNEA 95-97: GET disponibilidad
    const availResp = await httpClient.get(
      pxsolEndpoints.availability(startDate, endDate)
    );
    // ↳ URL: /hotels/12345/availability?start_date=2025-07-16&end_date=2025-10-14

    // RESPUESTA DE PxSol:
    /*
    {
      "data": {
        "data": {
          "availability": {
            "2025-07-16": {
              "123": {
                "room_id": 123,
                "quantity": 2,  ← 2 suites disponibles
                "rate_plans": {
                  "rate_001": {
                    "rate_id": "rate_001",
                    "rates": [{ "occupancy": 2, "price": 150 }]
                  }
                }
              },
              "456": {
                "room_id": 456,
                "quantity": 1,  ← 1 suite disponible
                "rate_plans": { ... }
              },
              "789": {
                "room_id": 789,
                "quantity": 3,  ← 3 económicas disponibles
                "rate_plans": { ... }
              }
            },
            "2025-07-17": {
              "123": { "quantity": 2, ... },
              ...
            },
            ...
            "2025-10-14": {
              "123": { "quantity": 0, ... },
              ...
            }
          }
        }
      }
    }
    */

    // LÍNEA 98: Extraer data.data.availability
    availability = availResp.data.data.availability;
    // ↳ availability[fecha][room_id] = objeto con quantity, rates, etc
    
  } catch (error: any) {
    logger.error("❌ Error GET availability", {
      url: pxsolEndpoints.availability(startDate, endDate),
      status: error?.response?.status,
      message: error?.message,
    });
    continue; // ← SKIP este rango, pasar al siguiente
  }
```

---

#### 2.5 - Precargar Overrides (Línea 109-126)

```typescript
  // Precargar overrides del rango en memoria
  const overridesRaw = await prisma.priceOverride.findMany({
    where: {
      dateFrom: { lte: endDate },  // dateFrom ≤ endDate
      dateTo: { gte: startDate },  // dateTo ≥ startDate
      // ↳ Evita SQL JOIN, trae en Python/JS y procesa
    },
  });
  // ↳ Resultado: [] (vacío, no hay overrides hoy)

  // LÍNEA 116-126: Crear Map de overrides por fecha
  const overrideMap = new Map<string, any>();
  for (const ov of overridesRaw) {
    // EJEMPLO (si hubiera override):
    // ov = { categoryId: 1, dateFrom: "2025-08-15", dateTo: "2025-08-17", priceInitial: "200" }
    
    const from = new Date(ov.dateFrom);  // 15/8
    const to = new Date(ov.dateTo);      // 17/8
    const cur = new Date(from);          // 15/8
    
    while (cur <= to) {
      // Itera: 15/8, 16/8, 17/8
      
      const key = `${ov.categoryId}_${cur.toISOString().split("T")[0]}`;
      // key = "1_2025-08-15"
      // key = "1_2025-08-16"
      // key = "1_2025-08-17"
      
      overrideMap.set(key, ov);
      // ↳ Mapa: "1_2025-08-15" → { categoryId: 1, priceInitial: "200", ... }
      
      cur.setDate(cur.getDate() + 1);
    }
  }
  // ↳ Resultado: Map vacío (no hay overrides este rango)
```

**¿POR QUÉ PRECARGAR?**
- Si tuviéramos 365 días × 100 habitaciones = 36,500 búsquedas
- Sin precargar: 36,500 queries a BD (LENTO)
- Con precargar: 1 query + búsqueda en memoria O(1) (RÁPIDO)

---

#### 2.6 - Precargar Snapshots (Línea 128-139)

```typescript
  // Precargar snapshots del rango en memoria
  const snapshotsRaw = await prisma.priceSnapshot.findMany({
    where: {
      date: { gte: startDate, lte: endDate }, // Entre startDate y endDate
    },
  });
  // ↳ Resultado: snapshots previos de este rango

  // LÍNEA 135-139: Crear Map de snapshots
  const snapshotMap = new Map<string, any>();
  for (const sn of snapshotsRaw) {
    const key = `${sn.roomExternalId}_${sn.date.toISOString().split("T")[0]}`;
    // key = "123_2025-07-16"
    
    snapshotMap.set(key, sn);
    // ↳ "123_2025-07-16" → { roomExternalId: "123", date: "2025-07-16", price: 100 }
  }
  // ↳ Para compararalía precios y ver si cambió
```

---

#### 2.7 - LOOP por Cada Fecha (Línea 147-302)

```typescript
  // LÍNEA 141-145: Array donde guardar cambios
  const snapshotUpserts: Array<{
    roomExternalId: string;
    date: Date;
    price: number;
  }> = [];
  // ↳ Acumula todos los snapshots nuevos para insertar después

  // LÍNEA 147: Iterar por cada fecha en availability
  for (const [dateKey, roomsByDate] of Object.entries<any>(availability)) {
    // dateKey = "2025-07-16" (string)
    // roomsByDate = { "123": {...}, "456": {...}, "789": {...} }

    // LÍNEA 148: Normalizar fecha
    const date = normalizeDate(new Date(dateKey));
    // ↳ "2025-07-16" → Date object 2025-07-16 00:00:00

    // ════════════════════════════════════════════════════════
    // PASO CRÍTICO 1: CONTAR DISPONIBILIDAD POR CATEGORÍA
    // ════════════════════════════════════════════════════════

    // LÍNEA 150-159: Crear mapa de disponibilidad por categoría
    const categoryAvailability: Record<number, number> = {};
    // ↳ { 1: 3, 2: 3 }
    // ↳ Categoría 1 (Suites): 3 disponibles
    // ↳ Categoría 2 (Económicas): 3 disponibles

    for (const r of Object.values<any>(roomsByDate)) {
      // r = { room_id: 123, quantity: 2, ... }
      
      if (r.quantity <= 0) continue; // ← SKIP si no hay disponibilidad
      
      const room = roomMap.get(String(r.room_id)); // ← Buscar en mapa
      if (!room) continue; // ← SKIP si no existe la habitación
      
      // LÍNEA 155-158: Contar disponibilidad por categoría
      for (const rc of room.roomCategories) {
        // rc = { id: 1, categoryId: 1, category: {...} }
        
        categoryAvailability[rc.categoryId] =
          (categoryAvailability[rc.categoryId] || 0) + 1;
        // ↳ Sumar 1 a la disponibilidad de esa categoría
      }
    }
    // RESULTADO PARA 2025-07-16:
    // categoryAvailability = { 1: 3, 2: 3 }
    // (3 suites disponibles, 3 económicas disponibles)
```

---

#### 2.8 - Crear Batch Diario (Línea 161-290)

```typescript
    // LÍNEA 161: Objeto que acumulará todos los cambios del día
    const dailyBatch: Record<string, any> = {};
    // ↳ Estructura: { "123": {...}, "456": {...}, "789": {...} }
    // ↳ Se enviará en UN SOLO PUT a PxSol

    // ════════════════════════════════════════════════════════
    // PASO CRÍTICO 2: PROCESAR CADA HABITACIÓN DEL DÍA
    // ════════════════════════════════════════════════════════

    // LÍNEA 163: Loop por cada habitación disponible del día
    for (const r of Object.values<any>(roomsByDate)) {
      // Iteración 1: r = { room_id: 123, quantity: 2, ... }
      // Iteración 2: r = { room_id: 456, quantity: 1, ... }
      // Iteración 3: r = { room_id: 789, quantity: 3, ... }

      if (r.quantity <= 0) continue; // SKIP si 0 disponibles
      
      // LÍNEA 166-167: Obtener habitación de mapa
      const room = roomMap.get(String(r.room_id));
      if (!room || room.roomCategories.length === 0) continue;
      // ↳ SKIP si no existe o sin categorías

      // LÍNEA 169-170: Obtener categoría (la primera)
      const category = room.roomCategories[0].category;
      // ↳ category = { id: 1, name: "Suite Doble", pricingConfig: {...} }

      // LÍNEA 170-171: Obtener disponibilidad de esta categoría
      const availableCount = categoryAvailability[category.id] || 0;
      // ↳ Para room_123 (Suite): availableCount = 3

      // LÍNEA 172: Verificar que hay configuración
      if (!category.pricingConfig) continue;
      const config = category.pricingConfig as any;
      // ↳ config = {
      //     baseOccupancy: 2,
      //     extraPersonAmount: 25,
      //     pricingByAvailability: { "1": {...}, "2": {...}, ... },
      //     emptyChairRules: [...]
      //   }
```

---

#### 2.9 - RESOLVER PRECIO (EL CORAZÓN DEL ALGORITMO) (Línea 175-204)

```typescript
      // ════════════════════════════════════════════════════════
      // PASO CRÍTICO 3: DETERMINAR EL PRECIO BASE
      // ════════════════════════════════════════════════════════

      // LÍNEA 175: Crear clave para buscar override
      const overrideKey = `${category.id}_${dateKey}`;
      // ↳ overrideKey = "1_2025-07-16"

      // LÍNEA 176: Buscar override en mapa
      const override = overrideMap.get(overrideKey);
      // ↳ override = undefined (no hay override hoy)

      // LÍNEA 178-180: Variables que calcularemos
      let basePrice: number;              // Precio sin ocupantes extra
      let extraPersonAmountNum: number;   // Precio por persona extra
      let emptyChairApplied = false;      // Flag si se aplicó Empty Chair

      // ════════════════════════════════════════════════════════
      // APLICAR REGLAS EN ORDEN:
      // 1. Empty Chair
      // 2. Override
      // 3. Pricing by Availability
      // ════════════════════════════════════════════════════════

      // LÍNEA 182-187: ¿APLICA EMPTY CHAIR?
      const emptyChair = resolveEmptyChairPricing({
        date,
        config,
        basePrice: Number(config.pricingByAvailability?.["1"]?.price ?? 0),
        // ↳ Tomar precio cuando hay 1 disponible como baseline
        // ↳ Para 2025-07-16: $100
        
        extraPersonAmount: Number(config.extraPersonAmount ?? 0),
        // ↳ Cargo por persona extra: $25
      });
      // ↳ Llamar función pricingRules.ts
      // ↳ Retorna { basePrice, extraPersonAmount, applied }

      // LÍNEA 189-192: Si Empty Chair aplica, usarla
      if (emptyChair.applied) {
        basePrice = emptyChair.basePrice;           // $120
        extraPersonAmountNum = emptyChair.extraPersonAmount; // $35
        emptyChairApplied = true;
        // ↳ Precios agresivos porque quedan solo 2-3 días
      } 
      
      // LÍNEA 193-195: Si no Empty Chair, ¿hay Override?
      else if (override) {
        basePrice = Number(override.priceInitial);  // $200 (ej. si hubiera)
        extraPersonAmountNum = Number(override.addPerPerson ?? config.extraPersonAmount ?? 0);
      } 
      
      // LÍNEA 196-203: Si no Empty Chair ni Override, usar Pricing by Availability
      else {
        const key = resolveAvailabilityKey(
          availableCount,           // 3 (hay 3 suites disponibles)
          config.pricingByAvailability // { "1": {price:100}, "2": {...}, "3": {...}, "4+": {...} }
        );
        // ↳ Función en línea 30-43
        // ↳ availableCount=3 → busca "3"
        // ↳ Encuentra "3": {price: 90}
        // ↳ Si no encuentra "3", busca "4+"
        // ↳ Retorna "3" o "4+" o null

        if (!key) continue; // SKIP si no hay precio para esta disponibilidad
        
        basePrice = config.pricingByAvailability[key].price; // $90
        extraPersonAmountNum = Number(config.extraPersonAmount ?? 0); // $25
      }
```

---

#### 2.10 - RESOLVER Occupancy (Línea 206-227)

```typescript
      // LÍNEA 206-207: Obtener occupancy del rate_plan de PxSol
      const ratePlan = Object.values<any>(r.rate_plans)[0];
      // ↳ ratePlan = { rate_id: "rate_001", rates: [{occupancy: 2}] }

      const occupancyRaw = ratePlan.rates?.[0]?.occupancy ?? config.baseOccupancy;
      // ↳ occupancyRaw = 2 (del PxSol) o fallback a config (2)

      // LÍNEA 208-210: Convertir a números
      const basePriceNum = Number(basePrice);         // 90
      const occupancyNum = Number(occupancyRaw);      // 2
      const baseOccupancyNum = Number(config.baseOccupancy ?? 1); // 2
      // ↳ baseOccupancy: precio base incluye hasta 2 personas

      // ════════════════════════════════════════════════════════
      // VALIDACIÓN: ¿Todos son números válidos?
      // ════════════════════════════════════════════════════════

      // LÍNEA 212-227: Validar que no sean NaN o Infinity
      if (
        !Number.isFinite(basePriceNum) ||      // ¿90 es un número finito?
        !Number.isFinite(occupancyNum) ||      // ¿2 es finito?
        !Number.isFinite(baseOccupancyNum) ||  // ¿2 es finito?
        !Number.isFinite(extraPersonAmountNum) // ¿25 es finito?
      ) {
        logger.error("❌ Configuración inválida para cálculo de precio", {
          room: r.room_id,    // 123
          date: dateKey,      // "2025-07-16"
          basePrice: basePriceNum,
          occupancy: occupancyNum,
          baseOccupancy: baseOccupancyNum,
          extraPersonAmount: extraPersonAmountNum,
        });
        continue; // ← SKIP si hay valores inválidos
      }
```

---

#### 2.11 - CÁLCULO FINAL DEL PRECIO (Línea 229-231)

```typescript
      // ════════════════════════════════════════════════════════
      // FÓRMULA CENTRAL: PRECIO FINAL
      // ════════════════════════════════════════════════════════

      // LÍNEA 229-231:
      const finalPrice =
        basePriceNum +
        Math.max(0, occupancyNum - baseOccupancyNum) * extraPersonAmountNum;

      // DESGLOSE:
      // basePriceNum = 90 (precio base para 3 disponibles)
      // occupancyNum = 2 (personas en la habitación)
      // baseOccupancyNum = 2 (ocupantes incluidos en el precio base)
      // extraPersonAmountNum = 25 (cargo por persona extra)

      // Math.max(0, 2 - 2) = Math.max(0, 0) = 0
      // ↳ No hay personas extra, no hay cargo adicional

      // finalPrice = 90 + 0 * 25 = 90
      // ↳ EL PRECIO FINAL ES $90

      // ════════════════════════════════════════════════════════
      // EJEMPLO CON 4 PERSONAS:
      // ════════════════════════════════════════════════════════
      // occupancyNum = 4
      // Math.max(0, 4 - 2) = 2 personas extra
      // finalPrice = 90 + 2 * 25 = 90 + 50 = 140
```

---

#### 2.12 - Comparar con Snapshot Anterior (Línea 233-242)

```typescript
      // LÍNEA 233-234: Buscar snapshot anterior
      const snapshotKey = `${r.room_id}_${dateKey}`;
      // ↳ snapshotKey = "123_2025-07-16"

      const snapshot = snapshotMap.get(snapshotKey);
      // ↳ snapshot = { roomExternalId: "123", date: "2025-07-16", price: 100 }
      // ↳ (precio anterior era $100, ahora es $90 → CAMBIÓ)

      // LÍNEA 236-242: ¿El precio es el mismo que antes?
      if (snapshot && snapshot.price === finalPrice) {
        // ↳ Si 100 === 90? NO → NO coinciden
        
        logger.debug("Precio sin cambios", {
          room: r.room_id,
          date: dateKey,
          price: finalPrice,
        });
        // ↳ NO se ejecuta porque el precio SÍ cambió
        
        continue; // SKIP si no cambió (no enviar a PxSol)
      }
      // ↳ Como SÍ cambió, continúa...
```

---

#### 2.13 - Log de Cambios (Línea 245-259)

```typescript
      // LÍNEA 245-253: Log si Empty Chair fue aplicada
      if (emptyChairApplied) {
        logger.info("🔥 Empty Chair aplicada", {
          room: r.room_id,       // 123
          date: dateKey,         // "2025-07-16"
          basePrice: basePriceNum,  // 120
          extraPersonAmount: extraPersonAmountNum, // 35
        });
        // OUTPUT: [17:45:40] INFO: 🔥 Empty Chair... | meta={...}
      }

      // LÍNEA 255-259: Log del precio calculado
      logger.info("Precio calculado", {
        room: r.room_id,    // 123
        date: dateKey,      // "2025-07-16"
        price: finalPrice,  // 90
      });
      // OUTPUT: [17:45:41] INFO: Precio calculado | meta={room: 123, date: "2025-07-16", price: 90}
```

---

#### 2.14 - Generar Tabla de Tarifas (Línea 261-270)

```typescript
      // ════════════════════════════════════════════════════════
      // CREAR ARRAY DE PRECIOS PARA OCUPANCIAS 1-4
      // ════════════════════════════════════════════════════════

      // LÍNEA 261: Determinar ocupancy máxima
      const MAX_OCCUPANCY = Math.max(baseOccupancyNum, occupancyNum, 4);
      // ↳ Math.max(2, 2, 4) = 4
      // ↳ Crear precios hasta 4 personas

      // LÍNEA 262-270: Array.from crea un array de 4 elementos
      const rates = Array.from({ length: MAX_OCCUPANCY }, (_, i) => {
        const occ = i + 1; // occ = 1, 2, 3, 4
        return {
          occupancy: occ,
          price:
            basePriceNum +
            Math.max(0, occ - baseOccupancyNum) * extraPersonAmountNum,
        };
      });
      // ↳ Cálculo para cada ocupancy:

      // occ=1:
      // 90 + Math.max(0, 1 - 2) * 25 = 90 + 0 = 90

      // occ=2:
      // 90 + Math.max(0, 2 - 2) * 25 = 90 + 0 = 90

      // occ=3:
      // 90 + Math.max(0, 3 - 2) * 25 = 90 + 1*25 = 115

      // occ=4:
      // 90 + Math.max(0, 4 - 2) * 25 = 90 + 2*25 = 140

      // RESULTADO rates:
      /*
      [
        { occupancy: 1, price: 90 },
        { occupancy: 2, price: 90 },
        { occupancy: 3, price: 115 },
        { occupancy: 4, price: 140 }
      ]
      */
```

---

#### 2.15 - Agregar a Batch (Línea 272-281)

```typescript
      // LÍNEA 272-281: Agregar esta habitación al batch del día
      dailyBatch[String(r.room_id)] = {
        day: dateKey,           // "2025-07-16"
        room_id: Number(r.room_id), // 123
        rate_plans: {
          [String(room.ratePlan)]: { // "rate_001"
            rate_id: Number(room.ratePlan), // "rate_001"
            rates, // [{ occupancy: 1, price: 90 }, ...]
          },
        },
      };
      // ↳ Agregar a dailyBatch
      // ↳ dailyBatch["123"] ahora contiene esto

      // LÍNEA 283-287: Agregar a array para BD
      snapshotUpserts.push({
        roomExternalId: String(r.room_id),  // "123"
        date,                                 // 2025-07-16 00:00:00
        price: finalPrice,                   // 90
      });
      // ↳ Guardar para inserte en BD después

      // LÍNEA 289: Actualizar cache en memoria
      snapshotMap.set(snapshotKey, { price: finalPrice });
      // ↳ Próximas habitaciones usan este snapshot actualizado
    }
    // ↳ Fin del loop por habitaciones del día

    // RESULTADO DESPUÉS DE PROCESAR 2025-07-16:
    /*
    dailyBatch = {
      "123": { day: "2025-07-16", room_id: 123, rate_plans: {...}, rates: [...] },
      "456": { day: "2025-07-16", room_id: 456, rate_plans: {...}, rates: [...] },
      "789": { day: "2025-07-16", room_id: 789, rate_plans: {...}, rates: [...] }
    }

    snapshotUpserts = [
      { roomExternalId: "123", date: "2025-07-16", price: 90 },
      { roomExternalId: "456", date: "2025-07-16", price: 95 },
      { roomExternalId: "789", date: "2025-07-16", price: 60 }
    ]
    */
```

---

#### 2.16 - Enviar a PxSol (Línea 292-301)

```typescript
    // LÍNEA 292: Si hay cambios en el batch
    if (Object.keys(dailyBatch).length > 0) {
      try {
        // LÍNEA 294-296: PUT a PxSol
        await httpClient.put(pxsolEndpoints.updateRates(), {
          [dateKey]: dailyBatch, // { "2025-07-16": { "123": {...}, "456": {...}, "789": {...} } }
        });
        // ↳ URL: PUT /hotels/12345/availability
        // ↳ Body enviado:
        /*
        {
          "2025-07-16": {
            "123": {
              "day": "2025-07-16",
              "room_id": 123,
              "rate_plans": {
                "rate_001": {
                  "rate_id": "rate_001",
                  "rates": [
                    { "occupancy": 1, "price": 90 },
                    { "occupancy": 2, "price": 90 },
                    { "occupancy": 3, "price": 115 },
                    { "occupancy": 4, "price": 140 }
                  ]
                }
              }
            },
            "456": { ... },
            "789": { ... }
          }
        }
        */

        // RESPUESTA DE PxSol:
        // HTTP 200 OK
        // { "status": "success", "updated": 3 }

        // LÍNEA 297: Log de éxito
        logger.info(`✅ PUT enviado para ${dateKey} | habitaciones: ${Object.keys(dailyBatch).length}`);
        // OUTPUT: [17:45:45] INFO: ✅ PUT enviado para 2025-07-16 | habitaciones: 3
        
      } catch (error: any) {
        // LÍNEA 299-300: Si falla (con reintentos)
        logger.error(`❌ Error PUT ${dateKey} | status=${error?.response?.status} | ${error?.message}`);
        // OUTPUT: [17:45:50] ERROR: ❌ Error PUT 2025-07-16 | status=500 | Internal Server Error
      }
    }
    // ↳ Fin de este día (dateKey)
  }
  // ↳ Fin del loop por fechas del rango
```

---

#### 2.17 - Guardar Snapshots en BD (Línea 304-319)

```typescript
  // DESPUÉS DE PROCESAR TODAS LAS FECHAS DEL RANGO

  // LÍNEA 304-318: Insertar/actualizar todos los snapshots
  for (const sn of snapshotUpserts) {
    // sn = { roomExternalId: "123", date: "2025-07-16", price: 90 }

    await prisma.priceSnapshot.upsert({
      where: {
        roomExternalId_date: {
          roomExternalId: sn.roomExternalId, // "123"
          date: sn.date,                      // 2025-07-16
        },
      },
      // ↳ Buscar por composite key (unique index)

      update: { price: sn.price }, // Actualizar precio
      create: {
        roomExternalId: sn.roomExternalId,
        date: sn.date,
        price: sn.price,
      },
      // ↳ Crear si no existe
    });
  }

  // LÍNEA 321: Log final del rango
  logger.info(`✅ Snapshots actualizados: ${snapshotUpserts.length}`);
  // OUTPUT: [17:46:30] INFO: ✅ Snapshots actualizados: 91
  // ↳ 91 snapshots = 91 días de 1 habitación (para 3 habitaciones sería más)
}
// ↳ Fin del loop por rangos (offset 0, 3, 6, 9)

// LÍNEA 324: Log final del ciclo
logger.info("Ciclo de pricing finalizado");
// OUTPUT: [17:47:00] INFO: Ciclo de pricing finalizado
```

---

## 3️⃣ FUNCIÓN ESPECIAL: resolveEmptyChairPricing()

### Explicación Línea por Línea (pricingRules.ts)

```typescript
export function resolveEmptyChairPricing(params: {
  date: Date;
  config: any;
  basePrice: number;
  extraPersonAmount: number;
}) {
  const { date, config } = params;

  // LÍNEA 10: Si no hay reglas Empty Chair, devolver datos como están
  if (!config?.emptyChairRules?.length) {
    return {
      basePrice: params.basePrice,           // 100
      extraPersonAmount: params.extraPersonAmount, // 25
      applied: false, // ← NO se aplicó Empty Chair
    };
  }

  // LÍNEA 18-19: Obtener "hoy"
  const today = new Date();
  today.setHours(0, 0, 0, 0); // Normalizar a 00:00:00
  // ↳ today = 2025-07-16 00:00:00

  // LÍNEA 21-23: Calcular diferencia en días
  const diffDays = Math.floor(
    (date.getTime() - today.getTime()) / (1000 * 60 * 60 * 24)
  );
  // ↳ date = 2025-07-16, today = 2025-07-16
  // ↳ diffDays = 0 (hoy mismo)

  // EJEMPLO 2:
  // date = 2025-07-18, today = 2025-07-16
  // (2025-07-18 - 2025-07-16) en ms / (1000 * 60 * 60 * 24) = 2 días
  // ↳ diffDays = 2

  // LÍNEA 25-29: Buscar regla que aplique
  const rule = config.emptyChairRules.find(
    (r: any) =>
      diffDays >= Number(r.fromDays) &&    // diffDays ≥ fromDays
      diffDays <= Number(r.toDays)         // diffDays ≤ toDays
  );
  // ↳ config.emptyChairRules = [
  //     { fromDays: 0, toDays: 3, priceBase: 120, extraPersonAmount: 35 },
  //     { fromDays: 4, toDays: 14, priceBase: 100, extraPersonAmount: 25 }
  //   ]
  // ↳ diffDays = 2
  // ↳ ¿2 >= 0 && 2 <= 3? SÍ → Selecciona la primera regla

  // Si NO encuentra regla, devolver sin aplicar
  if (!rule) {
    return {
      basePrice: params.basePrice,
      extraPersonAmount: params.extraPersonAmount,
      applied: false,
    };
  }

  // LÍNEA 38-42: Si encontró regla, devolver sus precios
  return {
    basePrice: Number(rule.priceBase), // 120
    extraPersonAmount: Number(rule.extraPersonAmount), // 35
    applied: true, // ← SÍ se aplicó Empty Chair
  };
}

// RESUMEN EMPTY CHAIR:
// Hoy 16/7, para fecha 18/7 (en 2 días):
// ↳ Busca regla con fromDays ≤ 2 ≤ toDays
// ↳ Encuentra: fromDays=0, toDays=3
// ↳ Aplica: basePrice=120, extraPersonAmount=35 (más caro, impulsar venta)
//
// Para fecha 25/7 (en 9 días):
// ↳ Busca regla con fromDays ≤ 9 ≤ toDays
// ↳ Encuentra: fromDays=4, toDays=14
// ↳ Aplica: basePrice=100, extraPersonAmount=25 (normal, menos urgencia)
```

---

## 4️⃣ FUNCIÓN HELPER: resolveAvailabilityKey()

### Explicación (pricingService.ts línea 30-43)

```typescript
function resolveAvailabilityKey(
  availableCount: number,
  pricing: Record<string, { price: number }>
) {
  // availableCount = 3 (hay 3 suites disponibles)
  // pricing = { "1": { price: 100 }, "2": { price: 95 }, "3": { price: 90 }, "4+": { price: 85 } }

  // LÍNEA 34-35: ¿Existe un precio exacto para esta cantidad?
  if (pricing[String(availableCount)]) {
    // ¿ pricing["3"] existe?
    // SÍ → pricing["3"] = { price: 90 }
    return String(availableCount); // Retorna "3"
  }

  // LÍNEA 36-41: Si no existe exacto, buscar "X+" (X o más)
  const plusKey = Object.keys(pricing).find(k => k.endsWith("+"));
  // ↳ Buscar primera clave que termine en "+"
  // ↳ plusKey = "4+"

  if (plusKey) {
    const min = Number(plusKey.replace("+", ""));
    // ↳ min = 4 (quitar el "+")

    if (availableCount >= min) return plusKey;
    // ↳ ¿ 3 >= 4? NO → no retorna aquí
  }

  // LÍNEA 42: Si nada coincide
  return null; // Retorna null (no hay precio para esta disponibilidad)

  // SCENARIOS:
  // availableCount=1: pricing["1"] existe → retorna "1"
  // availableCount=5: pricing["5"] NO existe → busca "4+" → retorna "4+"
  // availableCount=10: pricing["10"] NO existe → busca "4+" → retorna "4+"
  // availableCount=0: no existe → retorna null (SKIP)
}
```

---

# 5️⃣ ESTADO FINAL DE LA BD

## Después del Ciclo Completo

### Tabla: Room (sin cambios)

```sql
id=1, externalId="123", code="101", name="Suite 101", ratePlan="rate_001"
id=2, externalId="456", code="102", name="Suite 102", ratePlan="rate_001"
id=3, externalId="789", code="201", name="Económica", ratePlan="rate_002"
```

### Tabla: PriceSnapshot (actualizada)

```sql
-- Nuevos/actualizados para 2025-07-16
roomExternalId="123", date="2025-07-16", price=90, updatedAt="2025-07-16 17:45:50"
roomExternalId="456", date="2025-07-16", price=95, updatedAt="2025-07-16 17:45:51"
roomExternalId="789", date="2025-07-16", price=60, updatedAt="2025-07-16 17:45:52"

-- Para todos los días hasta 2026-07-16 (91 días × 3 habitaciones = 273 snapshots nuevos)
roomExternalId="123", date="2025-07-17", price=92, updatedAt="2025-07-16 17:45:53"
roomExternalId="456", date="2025-07-17", price=97, updatedAt="2025-07-16 17:45:54"
...
```

---

# 6️⃣ LÍNEA DE TIEMPO COMPLETA

```
17:45:32 → index.ts carga, startScheduler() inicia
17:45:33 → Prisma conecta a BD
17:45:34 → Logger dice "🚀 Ejecutando primer ciclo"
17:45:35 → GET /hotels/12345/rooms (intento 1)
17:45:36 → Response: 3 habitaciones
17:45:37 → UPSERT 3 habitaciones en BD
17:45:38 → Load roomCategories y config desde BD
17:45:39 → GET /hotels/12345/availability (16/7 a 14/10)
17:45:40 → Response: 91 días × 3 habitaciones = 273 registros
17:45:41 → Cargar overrides (ninguno)
17:45:42 → Cargar snapshots (algunos viejos)
17:45:43 → LOOP día 1 (2025-07-16): calcula 3 habitaciones
17:45:44 → PUT /availability (día 1)
17:46:30 → LOOP día 91 (2025-10-14): calcula 3 habitaciones
17:46:31 → PUT /availability (día 91)
17:46:32 → UPSERT 273 snapshots en BD
17:46:33 → Log: "✅ Snapshots actualizados: 273"
17:46:35 → GET /availability rango 2 (15/10 a 14/1)
17:46:50 → PUT día 2
...
17:47:00 → Log: "Ciclo de pricing finalizado"
17:47:01 → isRunning = false (permitir próximo)
17:50:32 → Próximo ciclo automático (cada 5 minutos)
```

---

# 7️⃣ PUNTOS CRÍTICOS PARA ENTENDER

## 1. El Flag `isRunning`

```typescript
let isRunning = false;

// Previene que 2 ciclos se ejecuten simultáneamente
if (isRunning) {
  logger.warn("Ciclo anterior aún en ejecución");
  return;
}
isRunning = true;
// ... executa ciclo ...
isRunning = false;
```

**¿POR QUÉ IMPORTANTE?**
- Si un ciclo toma >5 minutos, el siguiente NO se ejecuta
- Evita condiciones de carrera (race conditions)
- BD querría múltiples UPDATE al mismo tiempo

---

## 2. Precargar en Memoria

```typescript
// Sin precargar:
for (date in 91 días) {
  for (room in 3 habitaciones) {
    override = DB.query(...) // 91 × 3 = 273 queries
    snapshot = DB.query(...) // 273 queries
  }
}
// Total: 546 queries a BD (LENTO)

// Con precargar:
overrides = DB.query(...) // 1 query
snapshots = DB.query(...) // 1 query
for (date in 91 días) {
  for (room in 3 habitaciones) {
    override = overrideMap.get(...) // O(1)
    snapshot = snapshotMap.get(...) // O(1)
  }
}
// Total: 2 queries a BD + búsquedas rápidas (RÁPIDO)
```

**OPTIMIZACIÓN: De O(n²) a O(n)**

---

## 3. Uniqueness en Snapshots

```sql
-- Sin este constraint:
SELECT * FROM PriceSnapshot WHERE roomExternalId="123" AND date="2025-07-16";
-- Retorna 5 registros (ERROR: datos duplicados)

-- Con UNIQUE constraint:
UNIQUE INDEX `PriceSnapshot_roomExternalId_date_key`(roomExternalId, date)
-- Garantiza 1 solo registro por habitación/fecha
-- UPSERT actualiza el existente sin crear duplicados
```

---

## 4. El Algoritmo de Precio

```
IF emptyChair.applied:
  basePrice = rule.priceBase
ELSE IF override exists:
  basePrice = override.priceInitial
ELSE:
  basePrice = config.pricingByAvailability[key].price

finalPrice = basePrice + MAX(0, occupancy - baseOccupancy) * extraPersonAmount
```

**PRIORIDAD:**
1. Empty Chair (urgencia de venta en últimos días)
2. Override (excepciones manuales)
3. Pricing by Availability (precios estándares)

---

## 5. Cálculo de Ocupancy

```typescript
// Si el rate_plan de PxSol dice ocupancy=2:
occupancyNum = 2

// Si hay 0 personas extra:
finalPrice = 90 + MAX(0, 2-2) * 25 = 90

// Si reservan 3 personas:
finalPrice = 90 + MAX(0, 3-2) * 25 = 115

// Si reservan 5 personas (pero MAX_OCCUPANCY=4):
// Se crea precio hasta ocupancy=4
// Si alguien intenta 5, PxSol rechazaría o no lo mostraría
```

---

# 8️⃣ CÓMO DEBUGGEAR

### Ver Logs en Tiempo Real

```bash
npm run dev

# O revisar archivos:
cat logs/combined.log
cat logs/error.log
```

### Buscar un Precio Específico

```sql
SELECT * FROM PriceSnapshot
  WHERE roomExternalId = "123"
  AND date BETWEEN "2025-07-16" AND "2025-07-20"
  ORDER BY date;
```

### Ver Configuración de Categoría

```sql
SELECT id, name, pricingConfig 
  FROM Category
  WHERE id = 1;
  
-- Retorna JSON con toda la configuración
```

### Simular un Ciclo Manual

```bash
npm run build
npx ts-node force-update.ts
# Ejecuta runDailyFixedPriceUpdate() del archivo force-update.ts
```

---

# ✨ RESUMEN ULTRA-COMPRIMIDO

1. **Cada 5 minutos**, GET disponibilidad de PxSol
2. **Para cada fecha/habitación**, aplicar en orden:
   - Empty Chair (si está urgente)
   - Override (si hay excepción)
   - Pricing by Availability (precio normal)
3. **Calcular**: basePrice + (ocupantes_extra) × (precio_por_extra)
4. **Crear tabla de tasas** para 1-4 personas
5. **PUT a PxSol** (actualizar precios)
6. **UPSERT snapshots** (guardar para auditoría)
7. **Repetir** cada 5 minutos

---

Documento creado: 2025-07-16 17:50
Análisis: 100% detallado, línea por línea
Profundidad: MÁXIMA
