# 🆕 TUTORIAL: AGREGAR REGLA DE GAP NIGHTS (Noches entre Reservas)

## 📋 OBJETIVO

Crear una regla que:
- Detecte cuántas noches hay **entre reservas consecutivas**
- Aplique precios diferentes:
  - **1 noche vacía**: Precio más bajo (impulsar venta)
  - **2+ noches vacías**: Precio normal o más alto
- Esta regla tendría **MÁXIMA PRIORIDAD** sobre las demás

---

## FASE 1: PREPARAR LA BASE DE DATOS

### Paso 1.1: Crear Tabla `Reservation` (Prisma Migration)

```bash
npx prisma migrate dev --name add_reservations
```

Edita el archivo que se creó: `prisma/migrations/[timestamp]_add_reservations/migration.sql`

```sql
-- CreateTable Reservation
CREATE TABLE `Reservation` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `roomExternalId` VARCHAR(191) NOT NULL,
    `checkInDate` DATETIME(3) NOT NULL,
    `checkOutDate` DATETIME(3) NOT NULL,
    `guestName` VARCHAR(191),
    `occupancy` INTEGER NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `Reservation_roomExternalId_idx`(`roomExternalId`),
    INDEX `Reservation_checkInDate_idx`(`checkInDate`),
    INDEX `Reservation_checkOutDate_idx`(`checkOutDate`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
```

**¿POR QUÉ ESTOS CAMPOS?**
- `roomExternalId`: Identificar qué habitación
- `checkInDate`: Cuándo entra el cliente
- `checkOutDate`: Cuándo se va
- `occupancy`: Cuántas personas (necesitaremos esto para calcular precio)
- Indexes: Búsquedas rápidas por habitación y fechas

### Paso 1.2: Actualizar Prisma Schema

Edita `prisma/schema.prisma` y agrega:

```prisma
model Reservation {
  id              Int         @id @default(autoincrement())
  roomExternalId  String
  checkInDate     DateTime
  checkOutDate    DateTime
  guestName       String?
  occupancy       Int
  createdAt       DateTime    @default(now())
  updatedAt       DateTime    @updatedAt

  @@index([roomExternalId])
  @@index([checkInDate])
  @@index([checkOutDate])
}
```

### Paso 1.3: Ejecutar Migración

```bash
npm run prisma:generate  # Regenerar cliente Prisma
npm run migrate:deploy   # Aplicar cambios a BD
```

---

## FASE 2: CREAR LA LÓGICA DE GAP NIGHTS

### Paso 2.1: Crear Archivo `gapNightsRules.ts`

Crea: `src/services/gapNightsRules.ts`

```typescript
import { prisma } from "../infra/prisma/client";
import { logger } from "../utils/logger";

/**
 * Detecta cuántas noches hay libres ANTES de una fecha determinada
 * 
 * EJEMPLO:
 * - Hoy es 16/7
 * - Última checkout fue 15/7
 * - Próximo check-in es 20/7
 * - Gap = 20/7 - 15/7 = 5 noches
 * 
 * Pero si la fecha a calcular es 17/7:
 * - Necesitamos reservas que terminen ANTES de 17/7
 * - Y reservas que empiezan DESPUÉS de 17/7
 */

type GapNightsPricingResult = {
  gapNights: number | null; // Cantidad de noches libres, o null si no aplica
  applied: boolean;
  basePrice?: number;
  extraPersonAmount?: number;
};

export async function resolveGapNightsPricing(params: {
  date: Date;
  roomExternalId: string;
  config: any;
  currentOccupancy: number;
}): Promise<GapNightsPricingResult> {
  const { date, roomExternalId, config, currentOccupancy } = params;

  // LÍNEA 1: Verificar si hay configuración de gap nights
  if (!config?.gapNightRules || config.gapNightRules.length === 0) {
    return {
      gapNights: null,
      applied: false,
    };
  }

  // LÍNEA 2: Obtener reservas anteriores y posteriores
  try {
    // ════════════════════════════════════════════════════════
    // ENCONTRAR LA RESERVA ANTERIOR
    // ════════════════════════════════════════════════════════
    
    const previousReservation = await prisma.reservation.findFirst({
      where: {
        roomExternalId,
        checkOutDate: {
          lte: date, // checkout ANTES o EN esta fecha
        },
      },
      orderBy: {
        checkOutDate: "desc", // La más reciente
      },
    });
    // ↳ Encuentra la última reserva que terminó ANTES de esta fecha

    // ════════════════════════════════════════════════════════
    // ENCONTRAR LA RESERVA SIGUIENTE
    // ════════════════════════════════════════════════════════

    const nextReservation = await prisma.reservation.findFirst({
      where: {
        roomExternalId,
        checkInDate: {
          gte: date, // check-in DESPUÉS o EN esta fecha
        },
      },
      orderBy: {
        checkInDate: "asc", // La más próxima
      },
    });
    // ↳ Encuentra la próxima reserva que empieza DESPUÉS de esta fecha

    // LÍNEA 3: Si no hay reserva siguiente, no hay gap (habitación libre)
    if (!nextReservation) {
      return {
        gapNights: null,
        applied: false,
      };
      // ↳ Si no hay próxima reserva, no estamos en un gap
    }

    // LÍNEA 4: Si no hay reserva anterior, calcular desde hoy
    let gapStartDate = new Date();
    if (previousReservation) {
      gapStartDate = new Date(previousReservation.checkOutDate);
    }
    gapStartDate.setHours(0, 0, 0, 0);

    // LÍNEA 5: Calcular cuántas noches hay en el gap
    const nextCheckIn = new Date(nextReservation.checkInDate);
    nextCheckIn.setHours(0, 0, 0, 0);

    const gapNights = Math.floor(
      (nextCheckIn.getTime() - gapStartDate.getTime()) / (1000 * 60 * 60 * 24)
    );
    // EJEMPLO:
    // previousCheckOut = 15/7 00:00
    // nextCheckIn = 20/7 00:00
    // gapNights = 5 noches (16, 17, 18, 19 y la mañana del 20)

    // LÍNEA 6: Buscar regla que aplique para esta cantidad de noches
    const rule = config.gapNightRules.find((r: any) => {
      const minGap = Number(r.minGapNights);
      const maxGap = Number(r.maxGapNights);
      return gapNights >= minGap && gapNights <= maxGap;
    });
    // ↳ config.gapNightRules = [
    //     { minGapNights: 1, maxGapNights: 1, priceBase: 50, extraPersonAmount: 15 },
    //     { minGapNights: 2, maxGapNights: 3, priceBase: 80, extraPersonAmount: 20 }
    //   ]
    // ↳ Si gapNights=1, aplica la primera regla
    // ↳ Si gapNights=2, aplica la segunda

    if (!rule) {
      return {
        gapNights,
        applied: false,
      };
      // ↳ Si gap de 1 noche pero la regla es "2-3 noches", no aplica
    }

    // LÍNEA 7: Si encontró regla, aplicarla
    logger.info("🎯 Gap Nights aplicada", {
      roomExternalId,
      date: date.toISOString().split("T")[0],
      gapNights,
      rule: `${rule.minGapNights}-${rule.maxGapNights}`,
      basePrice: rule.priceBase,
    });

    return {
      gapNights,
      applied: true,
      basePrice: Number(rule.priceBase),
      extraPersonAmount: Number(rule.extraPersonAmount ?? 0),
    };

  } catch (error: any) {
    logger.error("❌ Error calculando Gap Nights", {
      roomExternalId,
      date: date.toISOString().split("T")[0],
      message: error.message,
    });
    
    return {
      gapNights: null,
      applied: false,
    };
  }
}
```

---

## FASE 3: INTEGRAR EN pricingService.ts

### Paso 3.1: Importar la nueva función

En `src/services/pricingService.ts`, agregar al inicio:

```typescript
import { resolveGapNightsPricing } from "./gapNightsRules";
// ↳ Junto con los otros imports
```

### Paso 3.2: Modificar la lógica de precios

En la sección donde se resuelve el precio (alrededor de línea 182):

**ANTES (código actual):**

```typescript
if (emptyChair.applied) {
  basePrice = emptyChair.basePrice;
  extraPersonAmountNum = emptyChair.extraPersonAmount;
  emptyChairApplied = true;
} else if (override) {
  basePrice = Number(override.priceInitial);
  extraPersonAmountNum = Number(override.addPerPerson ?? config.extraPersonAmount ?? 0);
} else {
  // ... pricingByAvailability ...
}
```

**DESPUÉS (con Gap Nights):**

```typescript
// ════════════════════════════════════════════════════════
// PASO CRÍTICO 3: DETERMINAR EL PRECIO BASE
// PRIORIDAD:
// 1. Gap Nights (MÁXIMA PRIORIDAD - vender noches solas)
// 2. Empty Chair (precios agresivos en últimos días)
// 3. Override (excepciones manuales)
// 4. Pricing by Availability (normal)
// ════════════════════════════════════════════════════════

// LÍNEA A AGREGAR: Resolver Gap Nights
const gapNights = await resolveGapNightsPricing({
  date,
  roomExternalId: String(r.room_id),
  config,
  currentOccupancy: occupancyRaw,
});

let basePrice: number;
let extraPersonAmountNum: number;
let emptyChairApplied = false;
let gapNightsApplied = false;

// LÍNEA: Si Gap Nights aplica, MÁXIMA PRIORIDAD
if (gapNights.applied) {
  basePrice = gapNights.basePrice!;  // ← El ! silencia TypeScript
  extraPersonAmountNum = gapNights.extraPersonAmount!;
  gapNightsApplied = true;

  logger.info("🎯 Gap Nights aplicada - Precio especial para llenar hueco", {
    room: r.room_id,
    date: dateKey,
    gapNights: gapNights.gapNights,
    basePrice,
  });
}
else if (emptyChair.applied) {
  basePrice = emptyChair.basePrice;
  extraPersonAmountNum = emptyChair.extraPersonAmount;
  emptyChairApplied = true;
} else if (override) {
  basePrice = Number(override.priceInitial);
  extraPersonAmountNum = Number(override.addPerPerson ?? config.extraPersonAmount ?? 0);
} else {
  const key = resolveAvailabilityKey(
    availableCount,
    config.pricingByAvailability
  );
  if (!key) continue;
  basePrice = config.pricingByAvailability[key].price;
  extraPersonAmountNum = Number(config.extraPersonAmount ?? 0);
}
```

---

## FASE 4: CONFIGURAR LA REGLA EN BD

### Paso 4.1: Actualizar Category.pricingConfig

La configuración JSON en la tabla `Category` debe incluir `gapNightRules`:

```json
{
  "baseOccupancy": 2,
  "extraPersonAmount": 25,
  "pricingByAvailability": {
    "1": { "price": 100 },
    "2": { "price": 95 },
    "3": { "price": 90 },
    "4+": { "price": 85 }
  },
  "emptyChairRules": [
    {
      "fromDays": 0,
      "toDays": 3,
      "priceBase": 120,
      "extraPersonAmount": 35
    }
  ],
  "gapNightRules": [
    {
      "minGapNights": 1,
      "maxGapNights": 1,
      "priceBase": 50,
      "extraPersonAmount": 15
    },
    {
      "minGapNights": 2,
      "maxGapNights": 3,
      "priceBase": 75,
      "extraPersonAmount": 20
    },
    {
      "minGapNights": 4,
      "maxGapNights": 30,
      "priceBase": 90,
      "extraPersonAmount": 25
    }
  ]
}
```

### Paso 4.2: Insertar/Actualizar en BD

```sql
UPDATE Category
SET pricingConfig = JSON_OBJECT(
  'baseOccupancy', 2,
  'extraPersonAmount', 25,
  'pricingByAvailability', JSON_OBJECT(
    '1', JSON_OBJECT('price', 100),
    '2', JSON_OBJECT('price', 95),
    '3', JSON_OBJECT('price', 90),
    '4+', JSON_OBJECT('price', 85)
  ),
  'gapNightRules', JSON_ARRAY(
    JSON_OBJECT(
      'minGapNights', 1,
      'maxGapNights', 1,
      'priceBase', 50,
      'extraPersonAmount', 15
    ),
    JSON_OBJECT(
      'minGapNights', 2,
      'maxGapNights', 3,
      'priceBase', 75,
      'extraPersonAmount', 20
    )
  )
)
WHERE id = 1;
```

---

## FASE 5: EJEMPLO PRÁCTICO PASO A PASO

### Escenario: Suite 101 (room_id = 123)

**Tabla Reservation (estado actual):**

```sql
id=1, roomExternalId="123", checkInDate="2025-07-10", checkOutDate="2025-07-15"
id=2, roomExternalId="123", checkInDate="2025-07-20", checkOutDate="2025-07-25"
```

**Línea de tiempo visual:**

```
[10-15 julio]
Reserva 1 ocupada
└─ checkout: 15/7

[16-19 julio]
GAP = 4 noches libres

[20-25 julio]
Reserva 2 ocupada
└─ check-in: 20/7
```

---

### Calcular Precio para 17/7 (1 noche en el gap)

```
1. resolveGapNightsPricing({
     date: 2025-07-17,
     roomExternalId: "123",
     config: { gapNightRules: [...] }
   })

2. Query BD:
   previousReservation = Reserva 1 (checkout 15/7) ✓
   nextReservation = Reserva 2 (check-in 20/7) ✓

3. Calcular gap:
   gapStartDate = 15/7 (checkout anterior)
   nextCheckIn = 20/7 (check-in siguiente)
   gapNights = 5 noches

4. Pero espera... fechas:
   15/7 = fin de Reserva 1 (checkout)
   16/7 = noche 1 libre
   17/7 = noche 2 libre ← AQUÍ ESTAMOS
   18/7 = noche 3 libre
   19/7 = noche 4 libre
   20/7 = check-in Reserva 2
   
   Entonces del 15/7 al 20/7 = 5 noches

5. Buscar regla:
   gapNightRules[0]: minGap=1, maxGap=1 → ¿5 >= 1 && 5 <= 1? NO
   gapNightRules[1]: minGap=2, maxGap=3 → ¿5 >= 2 && 5 <= 3? NO
   gapNightRules[2]: minGap=4, maxGap=30 → ¿5 >= 4 && 5 <= 30? SÍ ✓

6. Resultado:
   applied = true
   basePrice = 90
   extraPersonAmount = 25
   gapNights = 5

7. Log:
   "🎯 Gap Nights aplicada - Precio especial para llenar hueco"
   "gapNights: 5"
```

---

### Comparación de Precios

**Sin Gap Nights (pricing by availability):**
- 3 suites disponibles → $90

**Con Gap Nights (gap de 5 noches):**
- Gap de 5 noches (regla 4-30) → $90 (igual en este caso)
- Log avisa que es por Gap Nights, no por disponibilidad

**Caso diferente: gap de 1 noche**

```
Reserva 1 checkout: 18/7
Reserva 2 check-in: 19/7
Gap = 1 noche

Para 19/7:
  gapNights = 1
  Buscar regla: minGap=1, maxGap=1 → SÍ aplica ✓
  basePrice = 50 (MUCHO MÁS BARATO)
  extraPersonAmount = 15

BENEFICIO: Impulsar venta de esa 1 noche sola
```

---

## FASE 6: IMPORTANCIA DE LA PRIORIDAD

### Flujo de Decisión Actualizado

```
┌─ ¿Hay Gap Nights? → SÍ → Usar precio de Gap
│                    └─ NO → Continuar
├─ ¿Hay Empty Chair? → SÍ → Usar precio de Empty Chair
│                    └─ NO → Continuar
├─ ¿Hay Override?    → SÍ → Usar precio de Override
│                    └─ NO → Continuar
└─ Usar Pricing by Availability (normal)
```

**¿POR QUÉ ESTA PRIORIDAD?**

1. **Gap Nights MÁXIMA PRIORIDAD**
   - Vender noches solas es MUY importante
   - Mejor precio agresivo que dejar vacía

2. **Empty Chair SEGUNDA PRIORIDAD**
   - Faltan pocos días, necesita urgencia

3. **Override TERCERA PRIORIDAD**
   - Excepciones manuales (puente, evento)

4. **Pricing by Availability FALLBACK**
   - Precio estándar según disponibilidad

---

## FASE 7: CONSIDERACIONES IMPORTANTES

### ⚠️ PROBLEMA: Las Reservas Vienen de Dónde?

**OPCIÓN A: Desde PxSol API**

Si PxSol proporciona endpoint de reservas:

```typescript
// En pricingService.ts:

// GET reservas del próximo mes
const reservationsResp = await httpClient.get(
  `${process.env.PX_BASE_URL}/hotels/${process.env.PX_HOTEL_ID}/reservations?start_date=${formatDate(startDate)}&end_date=${formatDate(endDate)}`
);

// Insertar en BD Reservation
for (const res of reservationsResp.data.data.reservations) {
  await prisma.reservation.upsert({
    where: { id: res.id },
    update: {
      checkInDate: new Date(res.check_in),
      checkOutDate: new Date(res.check_out),
      guestName: res.guest_name,
      occupancy: res.occupancy,
    },
    create: {
      roomExternalId: String(res.room_id),
      checkInDate: new Date(res.check_in),
      checkOutDate: new Date(res.check_out),
      guestName: res.guest_name,
      occupancy: res.occupancy,
    },
  });
}
```

**OPCIÓN B: Manual (Webhooks desde PxSol)**

Si PxSol envía webhooks cuando se hace una reserva:

```typescript
// En un archivo webhook router (no incluido aún):
// POST /webhooks/reservation-created

app.post("/webhooks/reservation-created", async (req, res) => {
  const { room_id, check_in, check_out, guest_name } = req.body;

  await prisma.reservation.create({
    data: {
      roomExternalId: String(room_id),
      checkInDate: new Date(check_in),
      checkOutDate: new Date(check_out),
      guestName: guest_name,
      occupancy: req.body.occupancy,
    },
  });

  res.json({ status: "ok" });
});
```

**OPCIÓN C: Sincronizar Reservas en el Ciclo**

Agregar GET reservas en cada `runPricingCycle()`:

```typescript
// Al inicio de runPricingCycle(), antes de GET availability:

// GET todas las reservas
const reservationsResp = await httpClient.get(
  pxsolEndpoints.allReservations(startDate, addMonths(endDate, 2))
);

// Sincronizar con BD
for (const res of reservationsResp.data.data.reservations) {
  await prisma.reservation.upsert({...});
}
```

### ⚠️ PERFORMANCE: Consulta a BD en Loop

```typescript
// PROBLEMA: Esto hace 273 queries a BD (1 por habitación/fecha)
for (date in 91 días) {
  for (room in 3 habitaciones) {
    gapNights = await resolveGapNightsPricing(...); // ← Query a BD
  }
}
```

**SOLUCIÓN: Precargar todas las reservas**

```typescript
// En pricingService.ts, al inicio del loop por rangos:

const reservations = await prisma.reservation.findMany({
  where: {
    checkOutDate: { gte: addMonths(startDate, -1) }, // Mes anterior
    checkInDate: { lte: addMonths(endDate, 1) },     // Mes siguiente
  },
});
// ↳ 1 query a BD (trae todas de una vez)

// Crear Map por habitación:
const reservationsByRoom = new Map<string, any[]>();
for (const res of reservations) {
  if (!reservationsByRoom.has(res.roomExternalId)) {
    reservationsByRoom.set(res.roomExternalId, []);
  }
  reservationsByRoom.get(res.roomExternalId)!.push(res);
}

// Pasar al resolver gap nights:
const gapNights = await resolveGapNightsPricing({
  date,
  roomExternalId: String(r.room_id),
  config,
  currentOccupancy: occupancyRaw,
  preloadedReservations: reservationsByRoom.get(String(r.room_id)) || [],
});
```

Luego actualizar `gapNightsRules.ts` para recibir y usar `preloadedReservations` en lugar de queries.

---

## FASE 8: TESTING

### Test 1: Caso Simple (1 noche gap)

```bash
# Insertar datos de prueba
INSERT INTO Reservation VALUES
  (1, '123', '2025-07-10 14:00', '2025-07-15 11:00', 'Guest 1', 2),
  (2, '123', '2025-07-16 15:00', '2025-07-20 11:00', 'Guest 2', 2);

# Ahora gap es: 15/7 11:00 a 16/7 15:00
# Para fecha 15/7, 16/7: debería aplicar regla gapNightRules[0] (1 noche)

# Ejecutar ciclo:
npm run dev
```

### Test 2: Múltiples gaps

```bash
INSERT INTO Reservation VALUES
  (1, '456', '2025-07-01', '2025-07-05', 'G1', 2),
  (2, '456', '2025-07-10', '2025-07-20', 'G2', 2),
  (3, '456', '2025-07-22', '2025-08-10', 'G3', 2);

# Gaps:
# 05/7-10/7 = 5 noches
# 20/7-22/7 = 2 noches

# Para 07/7: debería ver gap de 5 → regla minGap=4, maxGap=30
# Para 21/7: debería ver gap de 2 → regla minGap=2, maxGap=3
```

### Ver Logs

```bash
# En tiempo real:
npm run dev | grep "Gap Nights"

# O en archivo:
tail -f logs/combined.log | grep "Gap Nights"
```

---

## RESUMEN: CHECKLIST DE IMPLEMENTACIÓN

```
✅ 1. Crear tabla Reservation en Prisma
   └─ npx prisma migrate dev --name add_reservations
   └─ Agregar modelo en schema.prisma
   └─ npm run prisma:generate

✅ 2. Crear archivo gapNightsRules.ts
   └─ Función resolveGapNightsPricing()
   └─ Query reservas anteriores y siguientes
   └─ Calcular gap en días
   └─ Buscar regla que aplique

✅ 3. Modificar pricingService.ts
   └─ Importar resolveGapNightsPricing
   └─ Agregar lógica ANTES de Empty Chair
   └─ Establecer prioridad: Gap > Empty Chair > Override > Availability

✅ 4. Configurar reglas en Category.pricingConfig
   └─ gapNightRules: [ ... ]
   └─ Definir minGapNights, maxGapNights, priceBase, extraPersonAmount

✅ 5. Sincronizar reservas (elegir opción A, B o C)
   └─ GET desde PxSol, webhooks, o cada ciclo

✅ 6. Optimizar performance
   └─ Precargar reservaciones en mapa
   └─ Evitar queries en loop

✅ 7. Hacer test
   └─ INSERT reservas de prueba
   └─ npm run dev
   └─ Verificar logs y precios en BD
```

---

## CÓDIGO COMPLETO: gapNightsRules.ts (Con Optimización)

```typescript
import { prisma } from "../infra/prisma/client";
import { logger } from "../utils/logger";

type GapNightsPricingResult = {
  gapNights: number | null;
  applied: boolean;
  basePrice?: number;
  extraPersonAmount?: number;
};

/**
 * Versión OPTIMIZADA que recibe reservas preargadas
 */
export async function resolveGapNightsPricing(params: {
  date: Date;
  roomExternalId: string;
  config: any;
  currentOccupancy: number;
  preloadedReservations?: any[]; // ← Reservas ya cargadas
}): Promise<GapNightsPricingResult> {
  const { date, roomExternalId, config, preloadedReservations } = params;

  if (!config?.gapNightRules || config.gapNightRules.length === 0) {
    return { gapNights: null, applied: false };
  }

  try {
    // Usar reservas preargadas o query
    let reservations = preloadedReservations || [];
    
    if (!preloadedReservations) {
      // Query si no están preargadas
      reservations = await prisma.reservation.findMany({
        where: { roomExternalId },
        orderBy: { checkOutDate: "desc" },
      });
    }

    // Encontrar reserva anterior
    const previousReservation = reservations.find(
      (r: any) => new Date(r.checkOutDate) <= date
    );

    // Encontrar reserva siguiente
    const nextReservation = reservations
      .reverse()
      .find((r: any) => new Date(r.checkInDate) >= date);

    if (!nextReservation) {
      return { gapNights: null, applied: false };
    }

    // Calcular gap
    let gapStartDate = new Date();
    if (previousReservation) {
      gapStartDate = new Date(previousReservation.checkOutDate);
    }
    gapStartDate.setHours(0, 0, 0, 0);

    const nextCheckIn = new Date(nextReservation.checkInDate);
    nextCheckIn.setHours(0, 0, 0, 0);

    const gapNights = Math.floor(
      (nextCheckIn.getTime() - gapStartDate.getTime()) / (1000 * 60 * 60 * 24)
    );

    // Buscar regla
    const rule = config.gapNightRules.find((r: any) => {
      const minGap = Number(r.minGapNights);
      const maxGap = Number(r.maxGapNights);
      return gapNights >= minGap && gapNights <= maxGap;
    });

    if (!rule) {
      return { gapNights, applied: false };
    }

    logger.info("🎯 Gap Nights aplicada", {
      roomExternalId,
      date: date.toISOString().split("T")[0],
      gapNights,
      rule: `${rule.minGapNights}-${rule.maxGapNights}`,
      basePrice: rule.priceBase,
    });

    return {
      gapNights,
      applied: true,
      basePrice: Number(rule.priceBase),
      extraPersonAmount: Number(rule.extraPersonAmount ?? 0),
    };

  } catch (error: any) {
    logger.error("❌ Error calculando Gap Nights", {
      roomExternalId,
      message: error.message,
    });
    return { gapNights: null, applied: false };
  }
}
```

---

Documento completado: Tutorial de Gap Nights Pricing
Complejidad: INTERMEDIA
Impacto: ALTO (vender noches solas a precios competitivos)
