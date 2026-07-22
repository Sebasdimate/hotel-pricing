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
 */
function detectGapsFromAvailability(availability) {
    const gapNightsMap = new Map();
    const datesSorted = Object.keys(availability).sort();
    // Función para normalizar fecha al formato YYYY-MM-DD
    const normalizeDate = (dateStr) => {
        return dateStr.split("T")[0];
    };
    logger_1.logger.info("🔎 INICIANDO detectGapsFromAvailability (POR HABITACIÓN)", {
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
                logger_1.logger.info("🔍 ✅ GAP de 1 noche DETECTADO", {
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
                    logger_1.logger.info("🔍 ✅ GAP de 2 noches DETECTADO", {
                        roomId,
                        dates: `${date1} - ${date2}`,
                        pattern: `${qty0}→${qty1}→${qty2}→${qty3}`
                    });
                }
            }
        }
    }
    logger_1.logger.info("🔎 COMPLETADO detectGapsFromAvailability", {
        gapsFound: gapNightsMap.size,
        gapDates: Array.from(gapNightsMap.entries())
    });
    return gapNightsMap;
}
