# ✅ PLAN DE IMPLEMENTACIÓN FINAL

## 🎯 Descubrimiento: Campo en PxSol

**UBICACIÓN:** `/availability` response

**ESTRUCTURA:**
```json
{
  "2026-07-17": {
    "28548": {  // room_id
      "rate_plans": {
        "10597": {  // rate_plan_id
          "minimum_stay": 3,      ← ¡¡¡AQUÍ!!!
          "maximum_stay": 365,
          "rates": [...]
        }
      }
    }
  }
}
```

**VALORES REALES ENCONTRADOS:**
- `minimum_stay: 3` (requiere 3 noches mínimo)
- `maximum_stay: 365`
- También hay: `closed`, `coa`, `cod`, `currency`

---

## 📋 PLAN DE IMPLEMENTACIÓN

### FASE 1: Extraer `minimum_stay` del Response

**Archivo:** `src/services/pricingService.ts`

**Línea 206-207 (ANTES):**
```typescript
const ratePlan = Object.values<any>(r.rate_plans)[0];
const occupancyRaw = ratePlan.rates?.[0]?.occupancy ?? config.baseOccupancy;
```

**Línea 206-210 (DESPUÉS):**
```typescript
const ratePlan = Object.values<any>(r.rate_plans)[0];
const occupancyRaw = ratePlan.rates?.[0]?.occupancy ?? config.baseOccupancy;

// ← AGREGAR ESTO:
const minimumStay = Number(ratePlan.minimum_stay ?? 1);
// Si no existe, asumir 1 noche
```

---

### FASE 2: Crear Función para Regla de 2 Noches

**Crear archivo:** `src/services/minimumStayRules.ts`

```typescript
import { logger } from "../utils/logger";

type MinimumStayPricingResult = {
  applied: boolean;
  basePrice?: number;
  extraPersonAmount?: number;
};

/**
 * Regla: Si el mínimo requerido es 2 noches, aplica precio especial
 * Esto incentiva bookings de fin de semana (2-3 noches típico)
 */
export function resolveTwoNightsPricing(params: {
  minimumStay: number;
  config: any;
  date: Date;
  roomId: string;
}): MinimumStayPricingResult {
  const { minimumStay, config, date, roomId } = params;

  // Verificar si hay regla de 2 noches configurada
  if (!config?.twoNightsRules) {
    return { applied: false };
  }

  // Buscar regla que aplique (normalmente solo una)
  const rule = config.twoNightsRules.find((r: any) => {
    const minReq = Number(r.minStay);
    const maxReq = Number(r.maxStay);
    return minimumStay >= minReq && minimumStay <= maxReq;
  });

  if (!rule) {
    return { applied: false };
  }

  logger.info("🎯 Regla de 2+ Noches aplicada", {
    room: roomId,
    date: date.toISOString().split("T")[0],
    minimumStay,
    basePrice: rule.priceBase,
  });

  return {
    applied: true,
    basePrice: Number(rule.priceBase),
    extraPersonAmount: Number(rule.extraPersonAmount ?? 0),
  };
}
```

---

### FASE 3: Cambiar Orden de Prioridad

**Archivo:** `src/services/pricingService.ts`

**Línea 182-204 (ANTES - orden actual):**
```typescript
if (emptyChair.applied) {
  basePrice = emptyChair.basePrice;
  extraPersonAmountNum = emptyChair.extraPersonAmount;
  emptyChairApplied = true;
} else if (override) {
  basePrice = Number(override.priceInitial);
  extraPersonAmountNum = Number(override.addPerPerson ?? ...);
} else {
  const key = resolveAvailabilityKey(...);
  if (!key) continue;
  basePrice = config.pricingByAvailability[key].price;
  extraPersonAmountNum = Number(config.extraPersonAmount ?? 0);
}
```

**LÍNEA 182-220 (DESPUÉS - NUEVO ORDEN):**
```typescript
// NUEVO ORDEN DE PRIORIDAD:
// 1. OVERRIDE (máxima)
// 2. EMPTY CHAIR
// 3. 2 NOCHES (nueva)
// 4. PRICING BY AVAILABILITY (fallback)

if (override) {
  // 1️⃣ OVERRIDE
  basePrice = Number(override.priceInitial);
  extraPersonAmountNum = Number(override.addPerPerson ?? config.extraPersonAmount ?? 0);
  logger.info("💼 Override aplicado", { room: r.room_id, date: dateKey, price: basePrice });
} 
else if (emptyChair.applied) {
  // 2️⃣ EMPTY CHAIR
  basePrice = emptyChair.basePrice;
  extraPersonAmountNum = emptyChair.extraPersonAmount;
  emptyChairApplied = true;
} 
else {
  // 3️⃣ 2 NOCHES (nueva regla)
  const twoNights = resolveTwoNightsPricing({
    minimumStay,
    config,
    date,
    roomId: String(r.room_id),
  });

  if (twoNights.applied) {
    basePrice = twoNights.basePrice!;
    extraPersonAmountNum = twoNights.extraPersonAmount!;
  }
  // 4️⃣ AVAILABILITY (fallback)
  else {
    const key = resolveAvailabilityKey(availableCount, config.pricingByAvailability);
    if (!key) continue;
    basePrice = config.pricingByAvailability[key].price;
    extraPersonAmountNum = Number(config.extraPersonAmount ?? 0);
  }
}
```

---

### FASE 4: Agregar Import

**Línea 1-7 (ANTES):**
```typescript
import { Prisma } from "@prisma/client";
import httpClient from "../infra/http/axiosClient";
import { prisma } from "../infra/prisma/client";
import { logger } from "../utils/logger";
import { pxsolEndpoints } from "../repos/pxsolApi";
import { addMonths, addDays } from "../utils/dateUtils";
import { resolveEmptyChairPricing } from "./pricingRules";
```

**LÍNEA 1-8 (DESPUÉS):**
```typescript
import { Prisma } from "@prisma/client";
import httpClient from "../infra/http/axiosClient";
import { prisma } from "../infra/prisma/client";
import { logger } from "../utils/logger";
import { pxsolEndpoints } from "../repos/pxsolApi";
import { addMonths, addDays } from "../utils/dateUtils";
import { resolveEmptyChairPricing } from "./pricingRules";
import { resolveTwoNightsPricing } from "./minimumStayRules";  // ← NUEVO
```

---

### FASE 5: Configuración en BD

**En tabla `Category`, campo `pricingConfig`:**

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
  "twoNightsRules": [
    {
      "minStay": 2,
      "maxStay": 3,
      "priceBase": 75,
      "extraPersonAmount": 20
    },
    {
      "minStay": 4,
      "maxStay": 7,
      "priceBase": 85,
      "extraPersonAmount": 22
    }
  ]
}
```

**UPDATE en BD:**

```sql
UPDATE Category
SET pricingConfig = JSON_SET(
  pricingConfig,
  '$.twoNightsRules',
  JSON_ARRAY(
    JSON_OBJECT(
      'minStay', 2,
      'maxStay', 3,
      'priceBase', 75,
      'extraPersonAmount', 20
    ),
    JSON_OBJECT(
      'minStay', 4,
      'maxStay', 7,
      'priceBase', 85,
      'extraPersonAmount', 22
    )
  )
)
WHERE id = 1;
```

---

## 📊 TABLA: NUEVA PRIORIDAD

| Orden | Regla | Condición | Ganador | Logs |
|:---:|---|---|---|---|
| 1 | Override | Existe para fecha | 💼 | "💼 Override aplicado" |
| 2 | Empty Chair | Faltan 0-14 días | 🔥 | "🔥 Empty Chair aplicada" |
| 3 | 2+ Noches | minimum_stay = 2-3 o 4-7 | 🎯 | "🎯 Regla de 2+ Noches aplicada" |
| 4 | Availability | Siempre (fallback) | 📊 | "Precio calculado" |

---

## 🎯 EJEMPLO PRÁCTICO

**PxSol devuelve:**
```json
{
  "2026-07-17": {
    "28548": {
      "quantity": 2,
      "rate_plans": {
        "10597": {
          "minimum_stay": 2,
          "rates": [...]
        }
      }
    }
  }
}
```

**Calcular precio para 17/7:**

```
1. Extraer minimumStay = 2
2. ¿Override para "1_2026-07-17"? NO
3. ¿Empty Chair (diffDays)? SÍ (son 0 días, regla 0-3)
4. → APLICA EMPTY CHAIR (línea 192-195)
   basePrice = $120

(2 Noches nunca se evalúa porque Empty Chair ganó)
```

**Otro ejemplo (en 15 días):**

```
1. Extraer minimumStay = 2
2. ¿Override? NO
3. ¿Empty Chair (diffDays=15)? NO (> 14 días)
4. ¿2 Noches (minimumStay=2)? SÍ
   minStay=2, maxStay=3
   ¿2 >= 2 && 2 <= 3? SÍ ✓
5. → APLICA 2 NOCHES
   basePrice = $75

(Availability nunca se evalúa)
```

**Otro ejemplo (mínimo de 1 noche):**

```
1. Extraer minimumStay = 1
2. ¿Override? NO
3. ¿Empty Chair? NO
4. ¿2 Noches (minimumStay=1)?
   minStay=2, maxStay=3
   ¿1 >= 2 && 1 <= 3? NO
   minStay=4, maxStay=7
   ¿1 >= 4 && 1 <= 7? NO
5. → NO APLICA 2 NOCHES
6. → APLICA AVAILABILITY
   availableCount = 3 → $90
```

---

## 📋 CHECKLIST DE IMPLEMENTACIÓN

```
✅ FASE 1: Extraer minimumStay (línea 210)
   - Agregar: const minimumStay = Number(ratePlan.minimum_stay ?? 1);

✅ FASE 2: Crear minimumStayRules.ts
   - Crear archivo
   - Función resolveTwoNightsPricing()
   - Lógica: si minimumStay está en rango, aplica precio

✅ FASE 3: Cambiar orden de prioridad
   - Reordenar IF/ELSE en línea 182-220
   - Nuevo orden: Override > Empty Chair > 2 Noches > Availability

✅ FASE 4: Agregar import
   - Línea 8: import { resolveTwoNightsPricing }

✅ FASE 5: Configurar en BD
   - UPDATE Category.pricingConfig
   - Agregar twoNightsRules

✅ FASE 6: Testing
   - npm run dev
   - Verificar logs con "🎯 Regla de 2+ Noches"
   - Verificar precios en DB
```

---

## 🚀 SIGUIENTE PASO

Quieres que:
1. ✅ Haga los cambios de código AHORA
2. ✅ Solo te muestre el código exacto a copiar-pegar
3. ✅ Te genere los SQL updates para la BD

¿Cuál prefieres?

---

Documento: Plan Final de Implementación
Basado en: Datos REALES de PxSol API
Campo encontrado: `minimum_stay` (dentro de rate_plans)
Estado: LISTO PARA IMPLEMENTAR
