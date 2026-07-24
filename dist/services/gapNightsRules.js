"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.resolveGapNightsPricing = resolveGapNightsPricing;
exports.detectGapsFromAvailability = detectGapsFromAvailability;
const logger_1 = require("../utils/logger");
/**
 * Detecta si hay un hueco (gap) de 1 o 2 noches basándose en quantity
 * Patrón 1: 0 → 1 → 0 = gap de 1 noche
 * Patrón 2: 0 → 1 → 1 → 0 = gap de 2 noches
 */
function resolveGapNightsPricing(params) {
    const { gapNights, config } = params;
    // Si no hay gap o no hay configuración de gap rules
    if (gapNights === null || !config?.gapNightsRules) {
        return {
            gapNights: null,
            applied: false,
        };
    }
    // Buscar regla que aplique para este gap
    const rule = config.gapNightsRules.find((r) => {
        const minGap = Number(r.minGap);
        const maxGap = Number(r.maxGap);
        return gapNights >= minGap && gapNights <= maxGap;
    });
    if (!rule) {
        return {
            gapNights,
            applied: false,
        };
    }
    // ════════════════════════════════════════════════════════
    // NUEVO: Dividir el precio total entre el número de noches
    // Si configura $200 para gap de 2 noches → $100 por noche
    // ════════════════════════════════════════════════════════
    const pricePerNight = Number(rule.priceBase) / gapNights;
    const extraPerNight = Number(rule.extraPersonAmount ?? 0) / gapNights;
    return {
        gapNights,
        applied: true,
        basePrice: pricePerNight,
        extraPersonAmount: extraPerNight,
    };
}
/**
 * Analiza la disponibilidad (quantity) para detectar gaps POR HABITACIÓN
 * Devuelve un mapa: `${roomId}_${fecha}` → número de noches de gap
 * IMPORTANTE: Normaliza fechas al formato YYYY-MM-DD para consistencia
 * FIX: Ahora detecta gaps para CADA habitación individual, no solo la primera
 *
 * @param forwardFirstDay  Si es true, además aplica detección HACIA ADELANTE al
 *   primer día visible (hoy). El patrón normal (ocupado→libre→ocupado) necesita el
 *   día anterior, que la API no entrega para hoy. Con esto, si hoy está libre se
 *   cuenta cuántas noches libres hay hasta la próxima reserva: 1 → gap 1, 2 → gap 2,
 *   3+ → silla vacía (no gap). Solo debe usarse en el PRIMER bloque (offset 0).
 */
function detectGapsFromAvailability(availability, forwardFirstDay = false) {
    const gapNightsMap = new Map();
    const datesSorted = Object.keys(availability).sort();
    // Función para normalizar fecha al formato YYYY-MM-DD
    const normalizeDate = (dateStr) => {
        return dateStr.split("T")[0];
    };
    logger_1.logger.debug("🔎 INICIANDO detectGapsFromAvailability (POR HABITACIÓN)", {
        totalDates: datesSorted.length,
        dateRange: `${datesSorted[0]} a ${datesSorted[datesSorted.length - 1]}`
    });
    for (let i = 0; i < datesSorted.length - 2; i++) {
        const date0Orig = datesSorted[i];
        const date1Orig = datesSorted[i + 1];
        const date2Orig = datesSorted[i + 2];
        const date0 = normalizeDate(date0Orig);
        const date1 = normalizeDate(date1Orig);
        const date2 = normalizeDate(date2Orig);
        // Recolectar todas las habitaciones presentes en el rango
        const roomIds = new Set([
            ...Object.keys(availability[date0Orig] ?? {}),
            ...Object.keys(availability[date1Orig] ?? {}),
            ...Object.keys(availability[date2Orig] ?? {}),
        ]);
        // Analizar CADA habitación individualmente
        for (const roomId of roomIds) {
            const qty0 = availability[date0Orig]?.[roomId]?.quantity ?? 0;
            const qty1 = availability[date1Orig]?.[roomId]?.quantity ?? 0;
            const qty2 = availability[date2Orig]?.[roomId]?.quantity ?? 0;
            // PATRÓN 1: Ocupado → Libre → Ocupado = GAP DE 1 NOCHE
            if (qty0 === 0 && qty1 > 0 && qty2 === 0) {
                const key = `${roomId}_${date1}`;
                gapNightsMap.set(key, 1);
                logger_1.logger.debug("🔍 ✅ GAP de 1 noche DETECTADO", {
                    roomId,
                    date: date1,
                    pattern: `${qty0}→${qty1}→${qty2}`
                });
            }
            // PATRÓN 2: Ocupado → Libre → Libre → Ocupado = GAP DE 2 NOCHES
            else if (i + 3 < datesSorted.length) {
                const date3Orig = datesSorted[i + 3];
                const date3 = normalizeDate(date3Orig);
                const qty3 = availability[date3Orig]?.[roomId]?.quantity ?? 0;
                if (qty0 === 0 && qty1 > 0 && qty2 > 0 && qty3 === 0) {
                    const key1 = `${roomId}_${date1}`;
                    const key2 = `${roomId}_${date2}`;
                    gapNightsMap.set(key1, 2);
                    gapNightsMap.set(key2, 2);
                    logger_1.logger.debug("🔍 ✅ GAP de 2 noches DETECTADO", {
                        roomId,
                        dates: `${date1} - ${date2}`,
                        pattern: `${qty0}→${qty1}→${qty2}→${qty3}`
                    });
                }
            }
        }
    }
    // ════════════════════════════════════════════════════════
    // DETECCIÓN HACIA ADELANTE para el PRIMER día (hoy).
    // El patrón bidireccional nunca marca el primer día (necesita el día anterior,
    // que la API no da para hoy). Aquí lo tratamos como borde izquierdo: si hoy está
    // libre, contamos las noches libres hasta la próxima reserva.
    //   hoy libre, mañana ocupado            → hueco de 1 noche (hoy)
    //   hoy y mañana libres, pasado ocupado  → hueco de 2 noches (hoy y mañana)
    //   3+ libres                            → silla vacía (no gap)
    // ════════════════════════════════════════════════════════
    if (forwardFirstDay && datesSorted.length >= 2) {
        const d0Orig = datesSorted[0];
        const d1Orig = datesSorted[1];
        const d2Orig = datesSorted[2]; // puede ser undefined si el rango es muy corto
        const d0 = normalizeDate(d0Orig);
        const d1 = normalizeDate(d1Orig);
        for (const roomId of Object.keys(availability[d0Orig] ?? {})) {
            const q0 = availability[d0Orig]?.[roomId]?.quantity ?? 0;
            if (q0 <= 0)
                continue; // hoy ocupado: nada que vender, no es hueco
            const q1 = availability[d1Orig]?.[roomId]?.quantity ?? 0;
            if (q1 === 0) {
                // hoy libre, mañana ocupado → hueco de 1 noche (hoy)
                gapNightsMap.set(`${roomId}_${d0}`, 1);
                logger_1.logger.debug("🔍 ✅ GAP de 1 noche DETECTADO (hacia adelante, hoy)", {
                    roomId, date: d0, pattern: `${q0}→${q1}`,
                });
            }
            else if (d2Orig !== undefined) {
                const q2 = availability[d2Orig]?.[roomId]?.quantity ?? 0;
                if (q2 === 0) {
                    // hoy y mañana libres, pasado ocupado → hueco de 2 noches
                    gapNightsMap.set(`${roomId}_${d0}`, 2);
                    gapNightsMap.set(`${roomId}_${d1}`, 2);
                    logger_1.logger.debug("🔍 ✅ GAP de 2 noches DETECTADO (hacia adelante, hoy)", {
                        roomId, dates: `${d0} - ${d1}`, pattern: `${q0}→${q1}→${q2}`,
                    });
                }
                // else: 3+ noches libres → silla vacía, no se marca gap
            }
        }
    }
    // Solo el conteo en info: el detalle completo puede ser de miles de entradas
    logger_1.logger.info("🔎 Gaps detectados", { gapsFound: gapNightsMap.size });
    logger_1.logger.debug("Detalle de gaps", { gapDates: Array.from(gapNightsMap.entries()) });
    return gapNightsMap;
}
