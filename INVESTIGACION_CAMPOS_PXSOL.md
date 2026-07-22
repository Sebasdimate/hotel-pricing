# 🔍 INVESTIGACIÓN: Qué Campos Trae PxSol API

## El Problema

Hoy en `pricingService.ts` línea 151-163, solo extraemos:

```typescript
for (const r of Object.values<any>(roomsByDate)) {
  if (r.quantity <= 0) continue;  // ← Solo usamos esto
  const room = roomMap.get(String(r.room_id));  // ← Y esto
  // ... el resto no lo tocamos
  
  const ratePlan = Object.values<any>(r.rate_plans)[0];  // ← Y esto
}
```

**Pero `r` probablemente contiene MUCHOS más campos.**

---

## Estructura Típica de PxSol API

### Endpoint: `GET /hotels/{ID}/availability`

**Response esperada (hipótesis basada en buenas prácticas hoteleras):**

```json
{
  "data": {
    "data": {
      "availability": {
        "2025-07-16": {
          "123": {
            "room_id": 123,
            "room_code": "101",
            "room_name": "Suite Presidencial",
            
            // ← DISPONIBILIDAD
            "quantity": 2,          // ✅ YA LO USAMOS
            "minimum_night_stay": 1,   // ← NUEVO: mínimo de noches
            "maximum_night_stay": 30,  // ← NUEVO: máximo de noches
            
            // ← TARIFAS
            "rate_plans": {
              "rate_001": {
                "rate_id": "rate_001",
                "rates": [
                  { "occupancy": 2, "price": 150 }
                ]
              }
            },
            
            // ← POLÍTICAS DE CANCELACIÓN (probablemente)
            "cancellation_policy": "free_until_7_days",
            
            // ← RESTRICCIONES (probablemente)
            "checkin_allowed": true,
            "checkout_allowed": true,
            
            // ← OCUPANCIA (probablemente)
            "max_occupancy": 2,
            "base_occupancy": 2,
            
            // ← AMENITIES (probablemente)
            "amenities": ["wifi", "ac", "tv"],
            
            // ← METADATA (probablemente)
            "currency": "COP",
            "tax_percentage": 8,
            "last_updated": "2025-07-16T12:30:00Z"
          },
          "456": { ... },
          "789": { ... }
        },
        "2025-07-17": { ... },
        ...
      }
    }
  }
}
```

---

## ¿Cuál Es el Campo `minimum_nights`?

**Probablemente es uno de estos:**

### Opción 1: `minimum_night_stay`
```json
{
  "room_id": 123,
  "quantity": 2,
  "minimum_night_stay": 2,  // ← Mínimo 2 noches para esta fecha
  "rate_plans": {...}
}
```

### Opción 2: `min_stay`
```json
{
  "minimum_stay": 2
}
```

### Opción 3: Dentro de `rate_plans`
```json
{
  "rate_plans": {
    "rate_001": {
      "minimum_nights": 2,  // ← Aquí
      "rates": [...]
    }
  }
}
```

---

## Cómo Descubrir Cuál Es

### Opción A: Hacer Request de Prueba

```bash
# Conectarse a PxSol y ver qué trae
curl -H "Authorization: Bearer $PX_API_KEY" \
  "https://api.pxsol.com/hotels/12345/availability?start_date=2025-07-16&end_date=2025-07-17"
```

**Resultado:** Verás el JSON completo

### Opción B: Agregar Logging Temporal

Edita `pricingService.ts` línea 151:

```typescript
for (const r of Object.values<any>(roomsByDate)) {
  // AGREGAR ESTO:
  if (dateKey === "2025-07-16") {
    console.log("📦 RESPUESTA COMPLETA DE PxSol para esta habitación:");
    console.log(JSON.stringify(r, null, 2));  // ← VER TODOS LOS CAMPOS
  }
  
  if (r.quantity <= 0) continue;
  // ... resto del código
}
```

Luego ejecuta:
```bash
npm run dev | grep -A 50 "RESPUESTA COMPLETA"
```

Y verás TODOS los campos que PxSol devuelve.

---

## Mi Predicción (Basada en Estándares Hoteleros)

Probablemente el campo se llama **`minimum_night_stay`** y viene así:

```json
"availability": {
  "2025-07-16": {
    "123": {
      "room_id": 123,
      "quantity": 2,
      "minimum_night_stay": 2,  // ← ESTO ES LO QUE BUSCAMOS
      "rate_plans": {...}
    }
  }
}
```

**¿Por qué?**
- Es el estándar en APIs hoteleras
- Es lógico que varíe por fecha (restrict en temporada alta)
- Afecta directamente el precio

---

## Si Es `minimum_night_stay`, Así Lo Usamos

### Paso 1: Extraer del Response

En `pricingService.ts` línea 163:

```typescript
for (const r of Object.values<any>(roomsByDate)) {
  if (r.quantity <= 0) continue;

  const room = roomMap.get(String(r.room_id));
  if (!room || room.roomCategories.length === 0) continue;

  // ← AGREGAR ESTO:
  const minimumNights = Number(r.minimum_night_stay ?? 1);
  // Si no existe el campo, asumir mínimo 1 noche
  
  const category = room.roomCategories[0].category;
  // ... resto del código
```

### Paso 2: Pasar a la Función de Precios

```typescript
// Línea 182, cuando llamas resolveEmptyChairPricing:

const emptyChair = resolveEmptyChairPricing({
  date,
  config,
  basePrice: Number(config.pricingByAvailability?.["1"]?.price ?? 0),
  extraPersonAmount: Number(config.extraPersonAmount ?? 0),
  minimumNights,  // ← NUEVO PARÁMETRO
});
```

### Paso 3: Crear Nueva Regla

Crea `src/services/minimumNightsRules.ts`:

```typescript
export function resolveTwoNightsPricing(params: {
  minimumNights: number;
  config: any;
  basePrice: number;
  extraPersonAmount: number;
}) {
  const { minimumNights, config } = params;

  // Si el mínimo es exactamente 2 noches
  if (minimumNights === 2 && config?.twoNightsRules) {
    const rule = config.twoNightsRules[0]; // Asumir 1 sola regla
    
    if (rule) {
      return {
        applied: true,
        basePrice: Number(rule.priceBase),
        extraPersonAmount: Number(rule.extraPersonAmount ?? 0),
      };
    }
  }

  return {
    applied: false,
    basePrice: params.basePrice,
    extraPersonAmount: params.extraPersonAmount,
  };
}
```

### Paso 4: Nueva Prioridad en pricingService.ts

```typescript
// Línea 189-204: NUEVO ORDEN

// 1️⃣ OVERRIDE (máxima prioridad)
if (override) {
  basePrice = Number(override.priceInitial);
  extraPersonAmountNum = Number(override.addPerPerson ?? config.extraPersonAmount ?? 0);
}
// 2️⃣ EMPTY CHAIR
else if (emptyChair.applied) {
  basePrice = emptyChair.basePrice;
  extraPersonAmountNum = emptyChair.extraPersonAmount;
  emptyChairApplied = true;
}
// 3️⃣ 2 NOCHES
else {
  const twoNights = resolveTwoNightsPricing({
    minimumNights,
    config,
    basePrice: Number(config.pricingByAvailability?.["1"]?.price ?? 0),
    extraPersonAmount: Number(config.extraPersonAmount ?? 0),
  });

  if (twoNights.applied) {
    basePrice = twoNights.basePrice;
    extraPersonAmountNum = twoNights.extraPersonAmount;
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

## Configuración en Category.pricingConfig

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
    { "fromDays": 0, "toDays": 3, "priceBase": 120, "extraPersonAmount": 35 }
  ],
  "twoNightsRules": [
    {
      "priceBase": 75,           // Más barato que normal
      "extraPersonAmount": 18    // Incentivar 2 noches
    }
  ]
}
```

---

## Ejemplo Práctico

**Escenario:**

```
16/7: minimum_night_stay = 2 (necesita mínimo 2 noches)
     hay Override?      → NO
     hay Empty Chair?   → SÍ, pero...
     
PRIORIDAD NUEVA:
  1. Override      → NO
  2. Empty Chair   → SÍ, basePrice = $120
  3. 2 Nights      → minimumNights = 2, SÍ aplica, basePrice = $75
```

**¿Cuál gana?**
- Con prioridad NUEVA: OVERRIDE > Empty Chair > 2 Nights > Availability
- Empty Chair aplicaría primero ($120)
- Pero si cambiamos orden: Override > Empty Chair > 2 Nights
- Entonces 2 Nights solo aplica si NO hay Override ni Empty Chair

---

## 🎯 ACCIÓN INMEDIATA

**Para descubrir el campo exacto, haz esto:**

1. Abre `pricingService.ts`
2. Línea 151, agrega:

```typescript
for (const r of Object.values<any>(roomsByDate)) {
  // LOGGING TEMPORAL:
  console.log("🔍 OBJETO COMPLETO de PxSol:");
  console.log(JSON.stringify(r, null, 2));
  
  if (r.quantity <= 0) continue;
  // ... resto
}
```

3. Ejecuta:
```bash
npm run dev
```

4. Busca en los logs:
```bash
# Ver qué campos tiene 'r'
grep -A 30 "OBJETO COMPLETO" logs/combined.log
```

5. **Dame captura o copia-pega la respuesta JSON**

Con eso sabré exactamente qué campo es y podemos hacer los cambios finales.

---

## Resumen de lo que Hoy Pasa vs. Mañana

### HOY (sin minimum_nights):
```
Override → Empty Chair → Availability
```

### MAÑANA (con minimum_nights):
```
Override → Empty Chair → 2 Noches → Availability
```

Donde "2 Noches" = si minimum_night_stay = 2, aplica precio especial.

---

Documento: Investigación de Campos PxSol
Urgencia: MEDIA (necesitas ver el JSON de PxSol)
Próximo Paso: Haz el logging temporal y comparte el resultado
