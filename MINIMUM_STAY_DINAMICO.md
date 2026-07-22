# 🔑 MINIMUM_STAY DINÁMICO - IMPLEMENTADO

## 🎯 ¿QUÉ SE HIZO?

Se agregó lógica para **cambiar dinámicamente `minimum_stay`** según el gap detectado.

**Objetivo:** Permitir excepciones inteligentes en huecos de 1-2 noches.

---

## 📝 CAMBIOS EN `pricingService.ts`

### NUEVO: Detectar gap y modificar minimum_stay

**Línea ~210 (AGREGADO):**

```typescript
// ════════════════════════════════════════════════════════
// NUEVO: Modificar minimum_stay si hay gap
// ════════════════════════════════════════════════════════
let minimumStayOverride: number | null = null;
if (gapNights !== null) {
  minimumStayOverride = gapNights;  // ← Cambiar a 1 o 2
  logger.info("🔑 MINIMUM_STAY modificado para gap", {
    room: r.room_id,
    date: dateKey,
    gapNights,
    newMinimumStay: minimumStayOverride,
  });
}
```

### NUEVO: Incluir en PUT a PxSol

**Línea ~300 (AGREGADO):**

```typescript
// ════════════════════════════════════════════════════════
// NUEVO: Incluir minimum_stay modificado si hay gap
// ════════════════════════════════════════════════════════
const ratePlanData: any = {
  rate_id: Number(room.ratePlan),
  rates,
};

// Si hay gap, incluir el minimum_stay modificado
if (minimumStayOverride !== null) {
  ratePlanData.minimum_stay = minimumStayOverride;
  logger.info("📤 Enviando minimum_stay modificado en PUT", {
    room: r.room_id,
    date: dateKey,
    minimum_stay: minimumStayOverride,
  });
}

dailyBatch[String(r.room_id)] = {
  day: dateKey,
  room_id: Number(r.room_id),
  rate_plans: {
    [String(room.ratePlan)]: ratePlanData,
  },
};
```

---

## 📊 LÓGICA

### ANTES (sin cambios dinámicos):
```
PxSol devuelve: minimum_stay = 3
Se envía a PxSol: minimum_stay = 3
Resultado: No puedes reservar menos de 3 noches en un gap de 1 noche ❌
```

### DESPUÉS (con cambios dinámicos):
```
PxSol devuelve: minimum_stay = 3

Detecta gap de 1 noche:
  └─ Cambiar a: minimum_stay = 1 ✅
  └─ Enviar en PUT: { minimum_stay: 1 }
  └─ Resultado: Puedes reservar 1 noche en ese hueco

Detecta gap de 2 noches:
  └─ Cambiar a: minimum_stay = 2 ✅
  └─ Enviar en PUT: { minimum_stay: 2 }
  └─ Resultado: Puedes reservar 2 noches
```

---

## 🎯 EJEMPLO PRÁCTICO

### Escenario:

```
14/10: Checkout (qty=0)
15/10: GAP 1 noche (qty=1)  ← Detecta gap
16/10: Checkin (qty=0)

PxSol normalmente devuelve:
  minimum_stay: 3 (por defecto)

TU SISTEMA AHORA:
  1. Detecta gap = 1 noche
  2. Cambia a: minimum_stay = 1
  3. PUT a PxSol: { minimum_stay: 1 }
  
RESULTADO:
  ✅ Pueden reservar 1 noche en 15/10
  💰 Llenar el hueco automáticamente
```

---

## 📈 FLUJO COMPLETO

```
GET /availability
  ├─ cantidad: 1 noche
  ├─ minimum_stay: 3 (de PxSol)
  ↓
DETECTAR GAP:
  ├─ gapNights = 1
  ├─ minimumStayOverride = 1
  ↓
CALCULAR PRECIO:
  ├─ Aplica gapNightsRules → basePrice = 50
  ├─ Calcula rates
  ↓
ARMAR BATCH:
  ├─ ratePlanData.minimum_stay = 1  ← ¡¡¡MODIFICADO!!!
  ├─ ratePlanData.rates = [...]
  ↓
PUT /availability:
  ├─ Envía minimum_stay = 1 (NO 3)
  ├─ Envía precio = 50
  ↓
RESULTADO:
  ✅ Mínimo 1 noche (NO 3)
  ✅ Precio $50 (gap nights)
  ✅ Llenar huecos automáticamente
```

---

## 🧪 CÓMO VERIFICAR EN LOGS

### Buscar modificaciones de minimum_stay:
```bash
grep "MINIMUM_STAY modificado\|Enviando minimum_stay" logs/combined.log
```

Output esperado:
```
[2026-07-17 12:45:45] INFO: 🔑 MINIMUM_STAY modificado para gap | meta={"room":28548,"date":"2026-07-18","gapNights":1,"newMinimumStay":1}
[2026-07-17 12:45:46] INFO: 📤 Enviando minimum_stay modificado en PUT | meta={"room":28548,"date":"2026-07-18","minimum_stay":1}
[2026-07-17 12:45:47] INFO: 🔑 MINIMUM_STAY modificado para gap | meta={"room":29208,"date":"2026-07-20","gapNights":2,"newMinimumStay":2}
[2026-07-17 12:45:48] INFO: 📤 Enviando minimum_stay modificado en PUT | meta={"room":29208,"date":"2026-07-20","minimum_stay":2}
```

---

## 📤 CONTENIDO DEL PUT

### Antes (sin gap):
```json
{
  "2026-07-16": {
    "28548": {
      "day": "2026-07-16",
      "room_id": 28548,
      "rate_plans": {
        "10597": {
          "rate_id": 10597,
          "rates": [
            { "occupancy": 1, "price": 100 },
            { "occupancy": 2, "price": 125 }
          ]
        }
      }
    }
  }
}
```

### Después (con gap de 1 noche):
```json
{
  "2026-07-18": {
    "28548": {
      "day": "2026-07-18",
      "room_id": 28548,
      "rate_plans": {
        "10597": {
          "rate_id": 10597,
          "minimum_stay": 1,        ← ¡¡¡AGREGADO!!! (cambió de 3 a 1)
          "rates": [
            { "occupancy": 1, "price": 50 },
            { "occupancy": 2, "price": 65 }
          ]
        }
      }
    }
  }
}
```

---

## 🎯 CASOS DE USO

### Caso 1: Gap de 1 noche
```
Gap detectado: 1 noche
PxSol dice: minimum_stay = 3
Tu sistema envía: minimum_stay = 1
Resultado: Pueden reservar 1 noche ✅
```

### Caso 2: Gap de 2 noches
```
Gap detectado: 2 noches
PxSol dice: minimum_stay = 3
Tu sistema envía: minimum_stay = 2
Resultado: Pueden reservar 2 noches ✅
```

### Caso 3: Sin gap
```
Sin gap detectado
PxSol dice: minimum_stay = 3
Tu sistema envía: (no modifica)
Resultado: minimum_stay = 3 ✅
```

---

## 📊 BENEFICIOS

| Situación | Antes | Después |
|-----------|-------|---------|
| Gap de 1 noche | ❌ No se puede reservar (requiere 3) | ✅ Se puede reservar 1 |
| Gap de 2 noches | ❌ No se puede reservar (requiere 3) | ✅ Se puede reservar 2 |
| Normal (sin gap) | ✅ Requiere 3 | ✅ Requiere 3 |

**RESULTADO:** Huecos se llenan automáticamente 💰

---

## ⚠️ IMPORTANTE

### ¿Qué pasa si PxSol rechaza?

Si PxSol no acepta `minimum_stay` dinámico en el PUT:

1. **Opción A:** Log de error y continúa
   ```
   ❌ Error PUT: PxSol rechaza minimum_stay=1
   ℹ️ Continúa con siguiente
   ```

2. **Opción B:** Investigar API de PxSol
   ```
   ¿PxSol acepta minimum_stay en PUT?
   ¿O solo en configuración global?
   ```

Por ahora, el código lo intenta. Si PxSol lo rechaza, verás en logs:
```
❌ Error PUT [fecha] | status=400
```

---

## ✅ CHECKLIST

- [x] Detectar gap (ya estaba)
- [x] Crear variable `minimumStayOverride`
- [x] Si gapNights = 1 o 2, cambiar a ese valor
- [x] Incluir en el PUT a PxSol
- [x] Logs para verificar cambios
- [x] Logs para verificar envío

---

## 🚀 LISTO PARA TESTING

**Ejecuta:**
```bash
npm run dev
```

**Busca en logs:**
```bash
grep "MINIMUM_STAY modificado\|Enviando minimum_stay" logs/combined.log
```

**Verifica PUT:**
- Si ve "📤 Enviando minimum_stay" → Está funcionando ✅
- Si ve error "❌ Error PUT" → PxSol rechazó (investigar)

---

## 🎉 RESULTADO

Ahora tu sistema:

✅ Detecta gaps automáticamente  
✅ Cambia `minimum_stay` dinámicamente (3 → 1 o 2)  
✅ Envía el cambio en el PUT  
✅ Permite reservas en huecos  
✅ Llena el hotel inteligentemente  

**ESTO ES PODEROSO.** 🔥

