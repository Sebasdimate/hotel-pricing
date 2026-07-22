# 🧪 INSTRUCCIONES DE TESTING - GAP NIGHTS

## ✅ CHECKLIST DE IMPLEMENTACIÓN

```
✅ COMPLETADO:
  ✓ Crear src/services/gapNightsRules.ts
  ✓ Modificar src/services/pricingService.ts
  ✓ Cambiar orden de prioridad (Override > Gap > Empty Chair > Availability)
  ✓ Agregar análisis de gaps

TODO:
  ⏳ 1. Ejecutar SQL en BD
  ⏳ 2. Ejecutar npm run dev
  ⏳ 3. Verificar logs
  ⏳ 4. Comprobar precios en BD
```

---

## 🚀 PASO 1: Actualizar BD

Ejecuta el SQL en tu base de datos MySQL:

```bash
# Opción A: Desde MySQL Workbench
# Abre SQL_ACTUALIZAR_BD.sql y ejecuta (OPCIÓN 2 si quieres actualizar una categoría específica)

# Opción B: Desde CLI
mysql -u user -p database < SQL_ACTUALIZAR_BD.sql
```

**Verifica que se ejecutó:**
```sql
SELECT JSON_EXTRACT(pricingConfig, '$.gapNightsRules')
FROM Category
WHERE id = 1;
```

Debería devolver:
```json
[
  {"minGap": 1, "maxGap": 1, "priceBase": 50, "extraPersonAmount": 15},
  {"minGap": 2, "maxGap": 2, "priceBase": 70, "extraPersonAmount": 20}
]
```

---

## 🚀 PASO 2: Ejecutar Servicio

```bash
cd "C:\Users\Usuario\Desktop\Robot precio"
npm install  # (si hay dependencias nuevas)
npm run dev
```

Debería ver logs como:

```
✅ Conectado a la base de datos correctamente.
🕒 Scheduler de pricing iniciado (cada 5 minutos)
🚀 Ejecutando primer ciclo de pricing
📅 Procesando rango de fechas
📊 Análisis de gaps completado
🔍 GAP de 1 noche detectado
🔍 GAP de 2 noches detectado
🎯 GAP NIGHTS aplicada
✅ Snapshots actualizados: 273
```

---

## 🔍 PASO 3: Ver Logs Específicos

### Buscar gaps detectados:
```bash
grep "GAP de" logs/combined.log
```

Output esperado:
```
[2026-07-17 12:45:32] INFO: 🔍 GAP de 1 noche detectado | meta={"date":"2026-07-18"}
[2026-07-17 12:45:33] INFO: 🔍 GAP de 2 noches detectado | meta={"dates":"2026-07-20 - 2026-07-21"}
```

### Buscar reglas aplicadas:
```bash
grep "GAP NIGHTS aplicada\|OVERRIDE aplicado\|Empty Chair aplicada" logs/combined.log
```

Output esperado:
```
[2026-07-17 12:45:45] INFO: 🎯 GAP NIGHTS aplicada | meta={"room":28548,"date":"2026-07-18","gapNights":1,"basePrice":50}
[2026-07-17 12:45:46] INFO: 💼 OVERRIDE aplicado | meta={"room":29208,"date":"2026-07-19","basePrice":200}
[2026-07-17 12:45:47] INFO: 🔥 Empty Chair aplicada | meta={"room":31540,"date":"2026-07-20"}
```

---

## 📊 PASO 4: Verificar Precios en BD

### Ver snapshots de precios actualizados:

```sql
-- Ver precios de hoy
SELECT 
  roomExternalId,
  date,
  price,
  updatedAt
FROM PriceSnapshot
WHERE DATE(date) = CURDATE()
ORDER BY date, roomExternalId;
```

### Comparar con reglas:

```sql
-- Ver si GAP NIGHTS fue aplicada
-- Gap de 1 noche debe tener price = 50 + (occupancy - baseOccupancy) * 15

SELECT 
  roomExternalId,
  date,
  price,
  CASE 
    WHEN price BETWEEN 50 AND 65 THEN 'GAP 1 NOCHE (esperado)'
    WHEN price BETWEEN 70 AND 85 THEN 'GAP 2 NOCHES (esperado)'
    ELSE 'OTRO'
  END as regla_esperada
FROM PriceSnapshot
WHERE DATE(date) >= DATE_SUB(CURDATE(), INTERVAL 1 DAY)
ORDER BY date;
```

---

## ✅ VALIDACIONES

### 1. Gaps Detectados Correctamente

```
Si quantity es:
  16/7: 0 (ocupado)
  17/7: 1 (libre)
  18/7: 0 (ocupado)
  
Debe detectar: GAP 1 noche en 17/7 ✓
```

### 2. Precios Aplicados Correctamente

```
Para habitación con gap de 1 noche:
  basePrice = 50 (de gapNightsRules[0])
  occupancy = 1: 50 + (1-2)*15 = 50 ✓
  occupancy = 2: 50 + (2-2)*15 = 50 ✓
  occupancy = 3: 50 + (3-2)*15 = 65 ✓
```

### 3. Prioridad Correcta

```
Override > Gap Nights > Empty Chair > Availability

Verificar orden en logs:
  Debería ver "💼 OVERRIDE" ANTES de "🎯 GAP NIGHTS"
  Debería ver "🎯 GAP NIGHTS" ANTES de "🔥 Empty Chair"
```

---

## 🐛 DEBUGGING

### Si NO ve "GAP de X noche detectado"

```bash
# Verificar disponibilidad está siendo procesada
grep "Análisis de gaps completado" logs/combined.log

# Si dice "gapsDetected: 0", significa no hay gaps en el rango
# o quantity no está cambiando entre 0 y >0
```

### Si ve "GAP NIGHTS aplicada" pero precio no cambió

```bash
# Verificar que pricingConfig tiene gapNightsRules
SELECT JSON_EXTRACT(pricingConfig, '$.gapNightsRules')
FROM Category;

# Si es NULL, ejecutar el SQL de actualización
```

### Si ve error de TypeError

```
Error: Cannot read property 'minGap' of undefined

→ Significa que gapNightsRules no está configurado en pricingConfig
→ Ejecutar SQL_ACTUALIZAR_BD.sql
```

---

## 📈 CASOS DE PRUEBA

### Caso 1: Gap de 1 Noche (Fin de Semana)

```sql
-- Insertar datos de prueba
INSERT INTO Reservation (roomExternalId, checkInDate, checkOutDate, occupancy)
VALUES
  ('28548', '2026-07-14 14:00', '2026-07-17 11:00', 2),
  ('28548', '2026-07-18 15:00', '2026-07-21 11:00', 2);

-- Ahora:
-- 17/7: gap de 1 noche
-- Debe aplicar: price = 50

-- Verificar después de ejecutar ciclo
SELECT * FROM PriceSnapshot 
WHERE roomExternalId = '28548' 
  AND date = '2026-07-17';
-- Esperado: price = 50 (si occupancy = 2)
```

### Caso 2: Gap de 2 Noches

```sql
INSERT INTO Reservation (roomExternalId, checkInDate, checkOutDate, occupancy)
VALUES
  ('29208', '2026-07-15 14:00', '2026-07-18 11:00', 2),
  ('29208', '2026-07-20 15:00', '2026-07-23 11:00', 2);

-- Ahora:
-- 18/7: gap de 2 noches
-- 19/7: gap de 2 noches
-- Debe aplicar: price = 70

SELECT * FROM PriceSnapshot 
WHERE roomExternalId = '29208' 
  AND date IN ('2026-07-18', '2026-07-19');
-- Esperado: price = 70 para ambas
```

### Caso 3: Override Gana a Gap

```sql
INSERT INTO PriceOverride (categoryId, name, priceInitial, addPerPerson, dateFrom, dateTo)
VALUES (1, 'Evento especial', '250', '75', '2026-07-18', '2026-07-18');

-- Aunque haya gap de 1 noche en 18/7
-- Override debe ganar
-- price debe ser 250, NO 50

SELECT * FROM PriceSnapshot 
WHERE roomExternalId = '28548' 
  AND date = '2026-07-18';
-- Esperado: price = 250 (override gana)
```

---

## 📋 MONITOREO CONTINUO

```bash
# Monitorear logs en tiempo real
tail -f logs/combined.log | grep -E "GAP|OVERRIDE|Empty Chair|precio calculado"

# O ver solo errores
tail -f logs/error.log
```

---

## ✅ CHECKLIST FINAL

- [ ] SQL ejecutado en BD
- [ ] npm run dev sin errores
- [ ] Logs muestran "Análisis de gaps completado"
- [ ] Logs muestran "GAP de 1/2 noche detectado"
- [ ] Logs muestran "GAP NIGHTS aplicada"
- [ ] Precios en PriceSnapshot son correctos
- [ ] Override sigue ganando a Gap Nights
- [ ] Empty Chair gana si no hay Override ni Gap

---

## 🎉 ¡LISTO!

Si todo está funcionando, tu sistema ahora:

✅ Detecta gaps automáticamente  
✅ Aplica precios especiales para huecos de 1-2 noches  
✅ Respeta prioridad: Override > Gap Nights > Empty Chair > Availability  
✅ Llena huecos de forma inteligente  

