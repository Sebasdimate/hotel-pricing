"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.runPricingCycle = runPricingCycle;
const client_1 = require("@prisma/client");
const axiosClient_1 = __importDefault(require("../infra/http/axiosClient"));
const client_2 = require("../infra/prisma/client");
const logger_1 = require("../utils/logger");
const pxsolApi_1 = require("../repos/pxsolApi");
const dateUtils_1 = require("../utils/dateUtils");
const pricingRules_1 = require("./pricingRules");
const gapNightsRules_1 = require("./gapNightsRules");
function normalizeDate(date) {
    return new Date(date.setHours(0, 0, 0, 0));
}
function resolveAvailabilityKey(availableCount, pricing) {
    if (pricing[String(availableCount)]) {
        return String(availableCount);
    }
    const plusKey = Object.keys(pricing).find(k => k.endsWith("+"));
    if (plusKey) {
        const min = Number(plusKey.replace("+", ""));
        if (availableCount >= min)
            return plusKey;
    }
    return null;
}
async function runPricingCycle() {
    logger_1.logger.info("🚀 Iniciando ciclo de pricing");
    const roomsResp = await axiosClient_1.default.get(pxsolApi_1.pxsolEndpoints.rooms());
    const rooms = roomsResp.data.data.rooms;
    // ════════════════════════════════════════════════════════
    // OPTIMIZADO: Batch upsert en UNA sola query
    // Antes: for loop → N queries individuales
    // Ahora: INSERT ... ON DUPLICATE KEY UPDATE → 1 query batch
    // ════════════════════════════════════════════════════════
    const roomsData = Object.values(rooms).map(r => {
        const ratePlanObj = Object.values(r.rate_plans)[0];
        return {
            externalId: String(r.room_id),
            code: r.code,
            name: r.name,
            description: r.description,
            ratePlan: String(ratePlanObj.rate_id),
        };
    });
    if (roomsData.length > 0) {
        try {
            await client_2.prisma.$executeRaw `
        INSERT INTO Room (externalId, code, name, description, ratePlan)
        VALUES ${client_1.Prisma.join(roomsData.map(rd => client_1.Prisma.sql `(${rd.externalId}, ${rd.code}, ${rd.name}, ${rd.description}, ${rd.ratePlan})`), ',')}
        ON DUPLICATE KEY UPDATE
          code = VALUES(code),
          name = VALUES(name),
          description = VALUES(description),
          ratePlan = VALUES(ratePlan)
      `;
            logger_1.logger.info(`✅ Rooms sincronizados (batch optimizado): ${roomsData.length}`);
        }
        catch (error) {
            logger_1.logger.error("❌ Error sincronizando rooms batch", {
                count: roomsData.length,
                error: error?.message,
            });
        }
    }
    const roomsDb = await client_2.prisma.room.findMany({
        include: {
            roomCategories: {
                include: { category: true },
            },
        },
    });
    const roomMap = new Map(roomsDb.map(r => [r.externalId, r]));
    const baseDate = normalizeDate(new Date());
    const RANGE_MONTHS = 3;
    const TOTAL_MONTHS = 12;
    for (let offset = 0; offset < TOTAL_MONTHS; offset += RANGE_MONTHS) {
        let startDate = (0, dateUtils_1.addMonths)(baseDate, offset);
        // ════════════════════════════════════════════════════════
        // NUEVO: Solapamiento de 1 día para detectar gaps en límites
        // ════════════════════════════════════════════════════════
        let skipFirstDay = false;
        if (offset > 0) {
            startDate = (0, dateUtils_1.addDays)(startDate, -1); // Retroceder 1 día
            skipFirstDay = true; // Flag para ignorar este día en el loop
            logger_1.logger.info("🔄 Solapamiento: 1 día anterior para detectar gaps en límite");
        }
        const endDate = (0, dateUtils_1.addDays)(startDate, 90);
        logger_1.logger.info("📅 Procesando rango de fechas", { startDate, endDate, skipFirstDay });
        let availability;
        try {
            const availResp = await axiosClient_1.default.get(pxsolApi_1.pxsolEndpoints.availability(startDate, endDate));
            availability = availResp.data.data.availability;
        }
        catch (error) {
            logger_1.logger.error("❌ Error GET availability", {
                url: pxsolApi_1.pxsolEndpoints.availability(startDate, endDate),
                status: error?.response?.status,
                message: error?.message,
            });
            continue;
        }
        // Precargar overrides del rango en memoria
        const overridesRaw = await client_2.prisma.priceOverride.findMany({
            where: {
                dateFrom: { lte: endDate },
                dateTo: { gte: startDate },
            },
        });
        const overrideMap = new Map();
        for (const ov of overridesRaw) {
            const from = new Date(ov.dateFrom);
            const to = new Date(ov.dateTo);
            const cur = new Date(from);
            while (cur <= to) {
                const key = `${ov.categoryId}_${cur.toISOString().split("T")[0]}`;
                overrideMap.set(key, ov);
                cur.setDate(cur.getDate() + 1);
            }
        }
        // Precargar snapshots del rango en memoria
        const snapshotsRaw = await client_2.prisma.priceSnapshot.findMany({
            where: {
                date: { gte: startDate, lte: endDate },
            },
        });
        const snapshotMap = new Map();
        for (const sn of snapshotsRaw) {
            const key = `${sn.roomExternalId}_${sn.date.toISOString().split("T")[0]}`;
            snapshotMap.set(key, sn);
        }
        const snapshotUpserts = [];
        // NUEVO: Detectar gaps en todo el rango
        const gapNightsMap = (0, gapNightsRules_1.detectGapsFromAvailability)(availability);
        logger_1.logger.info("📊 Análisis de gaps completado", {
            gapsDetected: gapNightsMap.size,
            skipFirstDay
        });
        // NUEVO: Obtener fecha del día solapado (si aplica)
        const datesArray = Object.keys(availability).sort();
        const firstDayOfRangeKey = datesArray[0];
        for (const [dateKey, roomsByDate] of Object.entries(availability)) {
            const date = normalizeDate(new Date(dateKey));
            // ════════════════════════════════════════════════════════
            // NUEVO: Si hay solapamiento, ignorar el primer día
            // (fue procesado en el rango anterior)
            // ════════════════════════════════════════════════════════
            if (skipFirstDay && dateKey === firstDayOfRangeKey) {
                logger_1.logger.debug("⏭️ Saltando día solapado (ya procesado)", { dateKey });
                continue; // Skip este día, ir al siguiente
            }
            const categoryAvailability = {};
            for (const r of Object.values(roomsByDate)) {
                if (r.quantity <= 0)
                    continue;
                const room = roomMap.get(String(r.room_id));
                if (!room)
                    continue;
                for (const rc of room.roomCategories) {
                    categoryAvailability[rc.categoryId] =
                        (categoryAvailability[rc.categoryId] || 0) + 1;
                }
            }
            const dailyBatch = {};
            for (const r of Object.values(roomsByDate)) {
                if (r.quantity <= 0)
                    continue;
                const room = roomMap.get(String(r.room_id));
                if (!room || room.roomCategories.length === 0)
                    continue;
                const category = room.roomCategories[0].category;
                const availableCount = categoryAvailability[category.id] || 0;
                if (!category.pricingConfig)
                    continue;
                const config = category.pricingConfig;
                const overrideKey = `${category.id}_${dateKey}`;
                const override = overrideMap.get(overrideKey);
                // NUEVO: Obtener gap si existe
                const gapNights = gapNightsMap.get(dateKey) ?? null;
                let basePrice;
                let extraPersonAmountNum;
                let emptyChairApplied = false;
                // ════════════════════════════════════════════════════════
                // NUEVO: Modificar minimum_stay si hay gap
                // ════════════════════════════════════════════════════════
                let minimumStayOverride = null;
                if (gapNights !== null) {
                    minimumStayOverride = gapNights; // Cambiar minimum_stay al número de noches del gap
                    logger_1.logger.info("🔑 MINIMUM_STAY modificado para gap", {
                        room: r.room_id,
                        date: dateKey,
                        gapNights,
                        newMinimumStay: minimumStayOverride,
                    });
                }
                // ════════════════════════════════════════════════════════
                // NUEVA PRIORIDAD:
                // 1️⃣ OVERRIDE (máxima)
                // 2️⃣ GAP NIGHTS
                // 3️⃣ EMPTY CHAIR
                // 4️⃣ PRICING BY AVAILABILITY (fallback)
                // ════════════════════════════════════════════════════════
                if (override) {
                    // 1️⃣ OVERRIDE
                    basePrice = Number(override.priceInitial);
                    extraPersonAmountNum = Number(override.addPerPerson ?? config.extraPersonAmount ?? 0);
                    logger_1.logger.info("💼 OVERRIDE aplicado", {
                        room: r.room_id,
                        date: dateKey,
                        basePrice,
                    });
                }
                else if (gapNights !== null) {
                    // 2️⃣ GAP NIGHTS
                    const gapResult = (0, gapNightsRules_1.resolveGapNightsPricing)({
                        gapNights,
                        config,
                    });
                    if (gapResult.applied) {
                        basePrice = gapResult.basePrice;
                        extraPersonAmountNum = gapResult.extraPersonAmount;
                        logger_1.logger.info("🎯 GAP NIGHTS aplicada", {
                            room: r.room_id,
                            date: dateKey,
                            gapNights,
                            basePrice,
                        });
                    }
                    else {
                        // Si gap existe pero no hay regla, continuar a Empty Chair
                        const emptyChair = (0, pricingRules_1.resolveEmptyChairPricing)({
                            date,
                            config,
                            basePrice: Number(config.pricingByAvailability?.["1"]?.price ?? 0),
                            extraPersonAmount: Number(config.extraPersonAmount ?? 0),
                        });
                        if (emptyChair.applied) {
                            // 3️⃣ EMPTY CHAIR
                            basePrice = emptyChair.basePrice;
                            extraPersonAmountNum = emptyChair.extraPersonAmount;
                            emptyChairApplied = true;
                        }
                        else {
                            // 4️⃣ AVAILABILITY
                            const key = resolveAvailabilityKey(availableCount, config.pricingByAvailability);
                            if (!key)
                                continue;
                            basePrice = config.pricingByAvailability[key].price;
                            extraPersonAmountNum = Number(config.extraPersonAmount ?? 0);
                        }
                    }
                }
                else {
                    // Sin gap, evaluar Empty Chair
                    const emptyChair = (0, pricingRules_1.resolveEmptyChairPricing)({
                        date,
                        config,
                        basePrice: Number(config.pricingByAvailability?.["1"]?.price ?? 0),
                        extraPersonAmount: Number(config.extraPersonAmount ?? 0),
                    });
                    if (emptyChair.applied) {
                        // 3️⃣ EMPTY CHAIR
                        basePrice = emptyChair.basePrice;
                        extraPersonAmountNum = emptyChair.extraPersonAmount;
                        emptyChairApplied = true;
                    }
                    else {
                        // 4️⃣ AVAILABILITY
                        const key = resolveAvailabilityKey(availableCount, config.pricingByAvailability);
                        if (!key)
                            continue;
                        basePrice = config.pricingByAvailability[key].price;
                        extraPersonAmountNum = Number(config.extraPersonAmount ?? 0);
                    }
                }
                // ════════════════════════════════════════════════════════
                // VALIDACIÓN: Verificar que rate_plans existe
                // Evita crash si la habitación no tiene rate_plans
                // ════════════════════════════════════════════════════════
                if (!r.rate_plans || Object.keys(r.rate_plans).length === 0) {
                    logger_1.logger.warn("⚠️ Habitación sin rate_plans válidos", {
                        room: r.room_id,
                        date: dateKey,
                    });
                    continue; // Skip esta habitación
                }
                const ratePlan = Object.values(r.rate_plans)[0];
                const occupancyRaw = ratePlan.rates?.[0]?.occupancy ?? config.baseOccupancy;
                const basePriceNum = Number(basePrice);
                const occupancyNum = Number(occupancyRaw);
                const baseOccupancyNum = Number(config.baseOccupancy ?? 1);
                if (!Number.isFinite(basePriceNum) ||
                    !Number.isFinite(occupancyNum) ||
                    !Number.isFinite(baseOccupancyNum) ||
                    !Number.isFinite(extraPersonAmountNum)) {
                    logger_1.logger.error("❌ Configuración inválida para cálculo de precio", {
                        room: r.room_id,
                        date: dateKey,
                        basePrice: basePriceNum,
                        occupancy: occupancyNum,
                        baseOccupancy: baseOccupancyNum,
                        extraPersonAmount: extraPersonAmountNum,
                    });
                    continue;
                }
                const finalPrice = basePriceNum +
                    Math.max(0, occupancyNum - baseOccupancyNum) * extraPersonAmountNum;
                // ════════════════════════════════════════════════════════
                // IMPORTANTE: Usar String(r.room_id) para consistencia
                // Línea 427 guarda: roomExternalId: String(r.room_id)
                // Aquí buscamos con la misma clave
                // ════════════════════════════════════════════════════════
                const snapshotKey = `${String(r.room_id)}_${dateKey}`;
                const snapshot = snapshotMap.get(snapshotKey);
                if (snapshot && snapshot.price === finalPrice) {
                    logger_1.logger.debug("Precio sin cambios", {
                        room: r.room_id,
                        date: dateKey,
                        price: finalPrice,
                    });
                    continue;
                }
                // ✅ Log de emptyChair solo cuando hay cambio real
                if (emptyChairApplied) {
                    logger_1.logger.info("🔥 Empty Chair aplicada", {
                        room: r.room_id,
                        date: dateKey,
                        basePrice: basePriceNum,
                        extraPersonAmount: extraPersonAmountNum,
                    });
                }
                logger_1.logger.info("Precio calculado", {
                    room: r.room_id,
                    date: dateKey,
                    price: finalPrice,
                });
                const MAX_OCCUPANCY = Math.max(baseOccupancyNum, occupancyNum, 4);
                const rates = Array.from({ length: MAX_OCCUPANCY }, (_, i) => {
                    const occ = i + 1;
                    return {
                        occupancy: occ,
                        price: basePriceNum +
                            Math.max(0, occ - baseOccupancyNum) * extraPersonAmountNum,
                    };
                });
                // ════════════════════════════════════════════════════════
                // NUEVO: Incluir minimum_stay modificado si hay gap
                // PxSol SÍ ACEPTA cambios de minimum_stay en PUT
                // Solo enviar: rate_id, currency, minimum_stay, rates
                // NO enviar: maximum_stay, closed, coa, cod
                // ════════════════════════════════════════════════════════
                const ratePlanData = {
                    rate_id: Number(room.ratePlan),
                    rates,
                };
                // Si hay gap, cambiar minimum_stay dinámicamente
                if (minimumStayOverride !== null) {
                    ratePlanData.minimum_stay = minimumStayOverride;
                    logger_1.logger.info("🔑 MINIMUM_STAY MODIFICADO para gap", {
                        room: r.room_id,
                        date: dateKey,
                        gapNights: minimumStayOverride,
                        newMinimumStay: minimumStayOverride,
                    });
                }
                dailyBatch[String(r.room_id)] = {
                    day: dateKey,
                    room_id: Number(r.room_id),
                    rate_plans: {
                        [String(room.ratePlan)]: ratePlanData,
                    },
                };
                snapshotUpserts.push({
                    roomExternalId: String(r.room_id),
                    date,
                    price: finalPrice,
                });
                snapshotMap.set(snapshotKey, { price: finalPrice });
            }
            if (Object.keys(dailyBatch).length > 0) {
                try {
                    await axiosClient_1.default.put(pxsolApi_1.pxsolEndpoints.updateRates(), {
                        [dateKey]: dailyBatch,
                    });
                    logger_1.logger.info(`✅ PUT enviado para ${dateKey} | habitaciones: ${Object.keys(dailyBatch).length}`);
                }
                catch (error) {
                    logger_1.logger.error(`❌ Error PUT ${dateKey} | status=${error?.response?.status} | ${error?.message}`);
                }
            }
        }
        // ════════════════════════════════════════════════════════
        // OPTIMIZADO: Batch insert/update en UNA sola query
        // Antes: 9,000 queries individuales (for + upsert)
        // Ahora: 1 query batch con INSERT ... ON DUPLICATE KEY UPDATE
        // Mejora: 100-1000x más rápido
        // ════════════════════════════════════════════════════════
        if (snapshotUpserts.length > 0) {
            try {
                await client_2.prisma.$executeRaw `
          INSERT INTO PriceSnapshot (roomExternalId, date, price)
          VALUES ${client_1.Prisma.join(snapshotUpserts.map(sn => client_1.Prisma.sql `(${sn.roomExternalId}, ${sn.date}, ${sn.price})`), ',')}
          ON DUPLICATE KEY UPDATE price = VALUES(price)
        `;
                logger_1.logger.info(`✅ Snapshots guardados (batch optimizado): ${snapshotUpserts.length}`);
            }
            catch (error) {
                logger_1.logger.error("❌ Error guardando snapshots batch", {
                    count: snapshotUpserts.length,
                    error: error?.message,
                });
            }
        }
        // Log final del rango
        if (skipFirstDay) {
            logger_1.logger.info("✅ Rango completado (con solapamiento de 1 día)", {
                startDate: (0, dateUtils_1.addDays)(startDate, 1).toISOString().split("T")[0], // Mostrar fecha real sin solapamiento
                endDate: endDate.toISOString().split("T")[0],
                diasProcesados: datesArray.length - 1 // -1 porque saltamos el primer día
            });
        }
        else {
            logger_1.logger.info("✅ Rango completado", {
                startDate: startDate.toISOString().split("T")[0],
                endDate: endDate.toISOString().split("T")[0],
                diasProcesados: datesArray.length
            });
        }
    }
    logger_1.logger.info("🏁 Ciclo de pricing finalizado");
}
