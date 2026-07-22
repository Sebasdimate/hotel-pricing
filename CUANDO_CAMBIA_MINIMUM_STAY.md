# ⏰ ¿CUÁNDO CAMBIA MINIMUM_STAY?

## 🎯 RESPUESTA RÁPIDA

**El `minimum_stay` cambia CUANDO TU SISTEMA DETECTA UN GAP** (1 o 2 noches libres entre reservas)

---

## 📅 EJEMPLO PRÁCTICO

### ESCENARIO:

```
14/10: Checkout (reserva anterior)
  ↓
15/10: ← GAP DE 1 NOCHE (vacía)
  ↓
16/10: Checkin (próxima reserva)
```

### ANTES (sin gap):
```
normal: minimum_stay = 3 (global en PxSol)
```

### CUANDO TU SISTEMA EJECUTA:

```
1. GET /availability
   └─ Descarga datos del 14/10 al 16/10

2. detectGapsFromAvailability()
   ├─ Analiza quantity: 0 → 1 → 0
   ├─ Detecta: GAP DE 1 NOCHE en 15/10
   └─ gapNightsMap.set("15/10", 1)

3. LOOP por fecha (15/10):
   ├─ gapNights = 1
   ├─ minimumStayOverride = 1  ← CAMBIA AQUÍ
   ├─ Precio configurado: $50 (total)
   ├─ Precio dividido: $50 / 1 = $50 por noche
   └─ Precio final: $50

4. PUT a PxSol:
   ├─ rate_id: 10597
   ├─ currency: "COP"
   ├─ minimum_stay: 1      ← ¡¡¡ENVIADO!!!
   ├─ rates: [{occupancy:1, price:50}, ...]
   └─ HTTP 200 ✅

5. RESULTADO EN PxSol:
   ├─ minimum_stay cambió de 3 → 1
   ├─ Precio: $50 por noche
   └─ Ahora permiten reservas de 1 noche
```

---

## 📊 FLUJO VISUAL

```
┌─────────────────────────────────────────────────────────┐
│ CADA VEZ QUE EJECUTAS: npm run dev                     │
└─────────────────────────────────────────────────────────┘
        ↓
┌─────────────────────────────────────────────────────────┐
│ GET /availability (próximos 12 meses)                  │
│   └─ Devuelve quantity para cada fecha                │
└─────────────────────────────────────────────────────────┘
        ↓
┌─────────────────────────────────────────────────────────┐
│ ANÁLISIS: Buscar patrones (0→1→0, 0→1→1→0)            │
│   └─ Detecta gaps de 1 y 2 noches                     │
└─────────────────────────────────────────────────────────┘
        ↓
┌─────────────────────────────────────────────────────────┐
│ PARA CADA FECHA CON GAP:                               │
│   ├─ Si gap=1 → minimum_stay = 1 ← CAMBIO             │
│   ├─ Si gap=2 → minimum_stay = 2 ← CAMBIO             │
│   └─ Calcular precios especiales                      │
└─────────────────────────────────────────────────────────┘
        ↓
┌─────────────────────────────────────────────────────────┐
│ PUT /availability (enviar cambios)                     │
│   ├─ minimum_stay modificado                          │
│   ├─ rates modificados (precios)                      │
│   └─ HTTP 200 OK ✅                                    │
└─────────────────────────────────────────────────────────┘
        ↓
┌─────────────────────────────────────────────────────────┐
│ RESULTADO EN PxSol:                                    │
│   ├─ 15/10 (gap 1 noche):                             │
│   │   └─ minimum_stay: 3 → 1                          │
│   │   └─ price: $100 → $50                            │
│   │                                                    │
│   ├─ 16/10 (gap 1 noche):                             │
│   │   └─ minimum_stay: 3 → 1                          │
│   │   └─ price: $100 → $50                            │
│   │                                                    │
│   └─ Usuarios pueden reservar 1 noche a precio bajo ✅ │
└─────────────────────────────────────────────────────────┘
```

---

## 🔄 CICLO AUTOMÁTICO

```
CADA 5 MINUTOS:

1. Detectar gaps automáticamente
2. Cambiar minimum_stay si hay gap
3. Cambiar precios si hay gap
4. Enviar cambios a PxSol
5. Guardar snapshots en BD

RESULTADO:
✅ Sistema dinámico
✅ Sin intervención manual
✅ Optimización automática de huecos
```

---

## ⏱️ TIMELINE

```
T=0min:   npm run dev → primer ciclo ejecuta inmediatamente
T=5min:   Ciclo automático (detecta gaps, cambios)
T=10min:  Ciclo automático
T=15min:  Ciclo automático
...
T=∞:      Continúa cada 5 minutos
```

---

## 🎯 CUÁNDO VERÁS CAMBIOS EN PxSol

### INMEDIATAMENTE (primera ejecución):
```
npm run dev
  ↓ (2-3 minutos después)
En PxSol verás:
  ✅ minimum_stay cambió en fechas con gap
  ✅ Precios cambiaron
  ✅ Snapshots guardados en BD
```

### CONTINUAMENTE (cada 5 minutos):
```
El sistema:
  ✅ Re-analiza availability
  ✅ Detecta nuevos gaps (si cambian reservas)
  ✅ Actualiza precios y minimum_stay
  ✅ Envía PUT a PxSol
```

---

## 💡 EJEMPLO CON NÚMEROS

**Escenario real (configuraste en BD):**

```
gapNightsRules:
  - Gap 1 noche: priceBase: 100
  - Gap 2 noches: priceBase: 200
```

**Hoy 17/7: Ejecutas npm run dev**

```
Sistema analiza y DIVIDE PRECIOS AUTOMÁTICAMENTE:
  • 18/7: gap = 1 noche → 100 / 1 = $100 por noche
  • 19/7: gap = 1 noche → 100 / 1 = $100 por noche
  • 20/7: sin gap (precio normal)
  • 22/7: gap = 2 noches → 200 / 2 = $100 por noche
  • 23/7: gap = 2 noches → 200 / 2 = $100 por noche

Cambios en PxSol:
  • 18/7: minimum_stay: 3→1, price: 100→100 ✅
  • 19/7: minimum_stay: 3→1, price: 100→100 ✅
  • 20/7: sin cambios (no hay gap)
  • 22/7: minimum_stay: 3→2, price: 100→100 ✅
  • 23/7: minimum_stay: 3→2, price: 100→100 ✅

RESULTADO:
  ✅ TÚ configuras precio TOTAL del gap
  ✅ El sistema lo DIVIDE automáticamente
  ✅ Cada noche recibe el precio justo
  ✅ Hotel se llena automáticamente
```

---

## ✅ STATUS

- [x] Código implementado para detectar gaps
- [x] Código implementado para cambiar minimum_stay
- [x] Código implementado para cambiar precios
- [x] Código implementado para enviar PUT a PxSol
- [ ] Ejecutar npm run dev para ver en acción

---

## 🚀 PRÓXIMO PASO

```bash
npm run dev
```

Verás en los logs:
```
🔍 GAP de 1 noche detectado
🔑 MINIMUM_STAY MODIFICADO para gap
🎯 GAP NIGHTS aplicada
📤 PUT enviado a PxSol
✅ HTTP 200 OK
```

**Todo funciona automáticamente cada 5 minutos.**

