-- ════════════════════════════════════════════════════════════════════════════════
-- SQL: Actualizar Category.pricingConfig con reglas de Gap Nights
-- ════════════════════════════════════════════════════════════════════════════════

-- OPCIÓN 1: Si quieres actualizar TODOS los hoteles
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
  'emptyChairRules', JSON_ARRAY(
    JSON_OBJECT(
      'fromDays', 0,
      'toDays', 3,
      'priceBase', 120,
      'extraPersonAmount', 35
    ),
    JSON_OBJECT(
      'fromDays', 4,
      'toDays', 14,
      'priceBase', 100,
      'extraPersonAmount', 25
    )
  ),
  'gapNightsRules', JSON_ARRAY(
    JSON_OBJECT(
      'minGap', 1,
      'maxGap', 1,
      'priceBase', 50,
      'extraPersonAmount', 15
    ),
    JSON_OBJECT(
      'minGap', 2,
      'maxGap', 2,
      'priceBase', 70,
      'extraPersonAmount', 20
    )
  )
);

-- ════════════════════════════════════════════════════════════════════════════════

-- OPCIÓN 2: Si quieres actualizar una categoría ESPECÍFICA
-- Reemplaza "1" con el ID de tu categoría
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
  'emptyChairRules', JSON_ARRAY(
    JSON_OBJECT(
      'fromDays', 0,
      'toDays', 3,
      'priceBase', 120,
      'extraPersonAmount', 35
    ),
    JSON_OBJECT(
      'fromDays', 4,
      'toDays', 14,
      'priceBase', 100,
      'extraPersonAmount', 25
    )
  ),
  'gapNightsRules', JSON_ARRAY(
    JSON_OBJECT(
      'minGap', 1,
      'maxGap', 1,
      'priceBase', 50,
      'extraPersonAmount', 15
    ),
    JSON_OBJECT(
      'minGap', 2,
      'maxGap', 2,
      'priceBase', 70,
      'extraPersonAmount', 20
    )
  )
)
WHERE id = 1;  -- ← Cambiar el ID aquí

-- ════════════════════════════════════════════════════════════════════════════════

-- OPCIÓN 3: Ver la configuración actual antes de actualizar
SELECT id, name, pricingConfig
FROM Category
WHERE id = 1;

-- ════════════════════════════════════════════════════════════════════════════════

-- OPCIÓN 4: Verificar la configuración después de actualizar
SELECT
  id,
  name,
  JSON_EXTRACT(pricingConfig, '$.gapNightsRules') as gapNightsRules
FROM Category
WHERE id = 1;

-- ════════════════════════════════════════════════════════════════════════════════
-- EXPLICACIÓN DE LOS CAMBIOS:
-- ════════════════════════════════════════════════════════════════════════════════
--
-- baseOccupancy: 2
--   Precio base incluye 2 personas
--
-- extraPersonAmount: 25
--   Cada persona adicional cuesta $25
--
-- pricingByAvailability:
--   - 1 disponible → $100
--   - 2 disponibles → $95
--   - 3 disponibles → $90
--   - 4+ disponibles → $85
--
-- emptyChairRules:
--   - 0-3 días: $120 (última hora, muy caro)
--   - 4-14 días: $100 (moderado)
--
-- gapNightsRules (NUEVA):
--   - Gap de 1 noche: $50 TOTAL → $50 por noche
--   - Gap de 2 noches: $70 TOTAL → $35 por noche
--   (El precio se divide automáticamente entre el número de noches)
--
-- PRIORIDAD:
--   1. OVERRIDE (si existe, siempre gana)
--   2. GAP NIGHTS (si hay 1 o 2 noches libres)
--   3. EMPTY CHAIR (si faltan pocos días)
--   4. AVAILABILITY (precio normal por disponibilidad)
--
-- ════════════════════════════════════════════════════════════════════════════════
