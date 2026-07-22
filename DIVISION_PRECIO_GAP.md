# 💰 CÓMO FUNCIONA LA DIVISIÓN DE PRECIOS EN GAPS

## 🎯 CONCEPTO

**TÚ configuras: Precio TOTAL del gap**  
**El sistema calcula: Precio POR NOCHE automáticamente**

---

## 📊 EJEMPLO SIMPLE

### Configuración en BD:

```json
{
  "minGap": 2,
  "maxGap": 2,
  "priceBase": 200,
  "extraPersonAmount": 50
}
```

### Sistema detecta gap de 2 noches:

```
TU VALOR CONFIGURADO: $200 (TOTAL del gap de 2 noches)

CÁLCULO AUTOMÁTICO:
  Precio por noche = $200 / 2 noches = $100 por noche
  Extra por noche = $50 / 2 noches = $25 por noche

RESULTADO EN PxSol:
  21/7: $100 + $25/persona = $125 para 1+1 persona
  22/7: $100 + $25/persona = $125 para 1+1 persona
```

---

## 🧮 FÓRMULAS

### Para gap de 1 noche:
```
Precio por noche = priceBase / 1
Ejemplo: $100 / 1 = $100 por noche
```

### Para gap de 2 noches:
```
Precio por noche = priceBase / 2
Ejemplo: $200 / 2 = $100 por noche
```

---

## 📈 EJEMPLOS REALES

### Ejemplo 1: Llenar huecos baratos

**Objetivo:** Llenar gaps al precio más bajo posible

```
Configuración:
  Gap 1 noche: priceBase = $50
    → Precio por noche = $50 / 1 = $50
  
  Gap 2 noches: priceBase = $100
    → Precio por noche = $100 / 2 = $50

BENEFICIO: Ambos tipos de gaps cuestan lo mismo por noche
```

### Ejemplo 2: Penalizar gaps largos

**Objetivo:** Gaps cortos baratos, gaps largos más caros

```
Configuración:
  Gap 1 noche: priceBase = $80
    → Precio por noche = $80 / 1 = $80
  
  Gap 2 noches: priceBase = $180
    → Precio por noche = $180 / 2 = $90

BENEFICIO: Incentiva reservas de 1 noche pero 2 noches es más caro
```

### Ejemplo 3: Precios progresivos

**Objetivo:** Cuanto más corto, más barato

```
Configuración:
  Gap 1 noche: priceBase = $50
    → Precio por noche = $50 / 1 = $50
  
  Gap 2 noches: priceBase = $150
    → Precio por noche = $150 / 2 = $75

BENEFICIO: Réserva 1 noche por $50, 2 noches por $75 c/u
```

---

## 📤 LO QUE SE ENVÍA A PxSol

### Con tu precio de $200 para 2 noches:

```json
{
  "2026-07-21": {
    "room_123": {
      "rate_plans": {
        "rate_1": {
          "rates": [
            { "occupancy": 1, "price": 100 },      ← $200/2 = $100
            { "occupancy": 2, "price": 125 }       ← $100 + $25
          ]
        }
      }
    }
  },
  "2026-07-22": {
    "room_123": {
      "rate_plans": {
        "rate_1": {
          "rates": [
            { "occupancy": 1, "price": 100 },      ← $200/2 = $100
            { "occupancy": 2, "price": 125 }       ← $100 + $25
          ]
        }
      }
    }
  }
}
```

**RESULTADO:** Cada noche cuesta $100, NO $200 por noche

---

## ✅ VENTAJAS

| Aspecto | Beneficio |
|---------|-----------|
| **Simplicidad** | Configuras un valor, el sistema divide |
| **Flexibilidad** | Puedes cambiar precios sin código |
| **Proporción** | El extra de personas se divide igual |
| **Logística** | Cada noche tiene precio justo |

---

## 🔍 VERIFICAR EN LOGS

Cuando ejecutes `npm run dev`, busca:

```bash
grep "GAP NIGHTS aplicada\|Precio calculado" logs/combined.log
```

Verás algo como:

```
[2026-07-17 12:45:46] INFO: 🎯 GAP NIGHTS aplicada | meta={"room":28548,"date":"2026-07-21","gapNights":2,"basePrice":100}
[2026-07-17 12:45:46] INFO: Precio calculado | meta={"room":28548,"date":"2026-07-21","price":100}
[2026-07-17 12:45:46] INFO: 🎯 GAP NIGHTS aplicada | meta={"room":28548,"date":"2026-07-22","gapNights":2,"basePrice":100}
[2026-07-17 12:45:46] INFO: Precio calculado | meta={"room":28548,"date":"2026-07-22","price":100}
```

**Ambas fechas tienen `basePrice: 100` (resultado de $200/2)**

---

## 💡 CONSEJOS DE CONFIGURACIÓN

### Strategy 1: Precios uniformes
```json
{
  "minGap": 1,
  "maxGap": 1,
  "priceBase": 100
},
{
  "minGap": 2,
  "maxGap": 2,
  "priceBase": 200
}
```
**Resultado:** Ambos: $100 por noche

### Strategy 2: Premium para gaps largos
```json
{
  "minGap": 1,
  "maxGap": 1,
  "priceBase": 100
},
{
  "minGap": 2,
  "maxGap": 2,
  "priceBase": 250
}
```
**Resultado:** 1 noche=$100, 2 noches=$125 c/u

### Strategy 3: Descuento por volumen
```json
{
  "minGap": 1,
  "maxGap": 1,
  "priceBase": 100
},
{
  "minGap": 2,
  "maxGap": 2,
  "priceBase": 180
}
```
**Resultado:** 1 noche=$100, 2 noches=$90 c/u (descuento)

---

## ❓ PREGUNTAS COMUNES

### P: Si configuro $200 para gap de 2 noches, ¿cuánto paga el cliente?

**R:** $200 total por 2 noches = $100 por noche
- Noche 1: $100
- Noche 2: $100
- **TOTAL: $200**

### P: ¿Se puede configurar precio diferente para cada noche?

**R:** NO. El sistema divide automáticamente. Es igual en ambas noches.

### P: ¿Qué pasa con `extraPersonAmount`?

**R:** Se divide igual. Si configuras $50 para 2 noches:
- Extra por noche = $50 / 2 = $25

### P: ¿Puedo tener gap de 3 noches?

**R:** Actualmente el sistema detecta solo 1-2 noches. Puedes agregar más reglas después.

---

## 📝 EJEMPLOS SQL

### Precios uniformes:
```sql
'gapNightsRules', JSON_ARRAY(
  JSON_OBJECT('minGap', 1, 'maxGap', 1, 'priceBase', 80, 'extraPersonAmount', 20),
  JSON_OBJECT('minGap', 2, 'maxGap', 2, 'priceBase', 160, 'extraPersonAmount', 40)
)
-- Ambos resultan en $80 por noche
```

### Premium para 2 noches:
```sql
'gapNightsRules', JSON_ARRAY(
  JSON_OBJECT('minGap', 1, 'maxGap', 1, 'priceBase', 100, 'extraPersonAmount', 25),
  JSON_OBJECT('minGap', 2, 'maxGap', 2, 'priceBase', 220, 'extraPersonAmount', 55)
)
-- Gap 1 noche: $100 | Gap 2 noches: $110 c/u
```

---

## ✅ STATUS

- [x] Código implementado para dividir precios
- [x] Documentación actualizada
- [x] Ejemplos incluidos
- [ ] Ejecutar npm run dev para verificar

---

## 🚀 PRÓXIMO PASO

```bash
npm run dev
```

Verás en logs que los precios se dividen correctamente.

