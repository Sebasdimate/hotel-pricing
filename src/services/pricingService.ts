import { Prisma } from "@prisma/client";
import httpClient from "../infra/http/axiosClient";
import { prisma } from "../infra/prisma/client";
import { logger } from "../utils/logger";
import { pxsolEndpoints } from "../repos/pxsolApi";
import { addMonths, addDays } from "../utils/dateUtils";
import { resolveEmptyChairPricing } from "./pricingRules";
import { resolveGapNightsPricing, detectGapsFromAvailability } from "./gapNightsRules";

type RoomWithCategories = Prisma.RoomGetPayload<{
  include: {
    roomCategories: {
      include: {
        category: true;
      };
    };
  };
}>;

type RatePlan = {
  rate_id: string | number;
  rates?: Array<{
    occupancy?: number;
  }>;
};

function normalizeDate(date: Date) {
  return new Date(date.setHours(0, 0, 0, 0));
}

function resolveAvailabilityKey(
  availableCount: number,
  pricing: Record<string, { price: number }>
) {
  if (pricing[String(availableCount)]) {
    return String(availableCount);
  }
  const plusKey = Object.keys(pricing).find(k => k.endsWith("+"));
  if (plusKey) {
    const min = Number(plusKey.replace("+", ""));
    if (availableCount >= min) return plusKey;
  }
  return null;
}

export async function runPricingCycle() {
  logger.info("🚀 Iniciando ciclo de pricing");

  const roomsResp = await httpClient.get(pxsolEndpoints.rooms());
  const rooms = roomsResp.data.data.rooms;

  // ════════════════════════════════════════════════════════
  // OPTIMIZADO: Batch upsert en UNA sola query
  // Antes: for loop → N queries individuales
  // Ahora: INSERT ... ON DUPLICATE KEY UPDATE → 1 query batch
  // ════════════════════════════════════════════════════════

  const roomsData = Object.values<any>(rooms).map(r => {
    const ratePlanObj = Object.values(r.rate_plans as Record<string, RatePlan>)[0];
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
      await prisma.$executeRaw`
        INSERT INTO Room (externalId, code, name, description, ratePlan)
        VALUES ${Prisma.join(
          roomsData.map(
            rd => Prisma.sql`(${rd.externalId}, ${rd.code}, ${rd.name}, ${rd.description}, ${rd.ratePlan})`
          ),
          ','
        )}
        ON DUPLICATE KEY UPDATE
          code = VALUES(code),
          name = VALUES(name),
          description = VALUES(description),
          ratePlan = VALUES(ratePlan)
      `;
      logger.info(`✅ Rooms sincronizados (batch optimizado): ${roomsData.length}`);
    } catch (error: any) {
      logger.error("❌ Error sincronizando rooms batch", {
        count: roomsData.length,
        error: error?.message,
      });
    }
  }

  const roomsDb: RoomWithCategories[] = await prisma.room.findMany({
    include: {
      roomCategories: {
        include: { category: true },
      },
    },
  });

  const roomMap = new Map<string, RoomWithCategories>(
    roomsDb.map(r => [r.externalId, r])
  );

  const baseDate = normalizeDate(new Date());
  const RANGE_MONTHS = 3;
  const TOTAL_MONTHS = 12;

  for (let offset = 0; offset < TOTAL_MONTHS; offset += RANGE_MONTHS) {
    let startDate = addMonths(baseDate, offset);

    // ════════════════════════════════════════════════════════
    // NUEVO: Solapamiento de 1 día para detectar gaps en límites
    // ════════════════════════════════════════════════════════
    let skipFirstDay = false;
    if (offset > 0) {
      startDate = addDays(startDate, -1);  // Retroceder 1 día
      skipFirstDay = true;  // Flag para ignorar este día en el loop
      logger.info("🔄 Solapamiento: 1 día anterior para detectar gaps en límite");
    }

    const endDate = addDays(startDate, 90);

    logger.info("📅 Procesando rango de fechas", { startDate, endDate, skipFirstDay });

    let availability: any;
    try {
      const availResp = await httpClient.get(
        pxsolEndpoints.availability(startDate, endDate)
      );
      availability = availResp.data.data.availability;
    } catch (error: any) {
      logger.error("❌ Error GET availability", {
        url: pxsolEndpoints.availability(startDate, endDate),
        status: error?.response?.status,
        message: error?.message,
      });
      continue;
    }

    // Precargar overrides del rango en memoria
    const overridesRaw = await prisma.priceOverride.findMany({
      where: {
        dateFrom: { lte: endDate },
        dateTo: { gte: startDate },
      },
    });

    const overrideMap = new Map<string, any>();
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
    const snapshotsRaw = await prisma.priceSnapshot.findMany({
      where: {
        date: { gte: startDate, lte: endDate },
      },
    });

    const snapshotMap = new Map<string, any>();
    for (const sn of snapshotsRaw) {
      const key = `${sn.roomExternalId}_${sn.date.toISOString().split("T")[0]}`;
      snapshotMap.set(key, sn);
    }

    const snapshotUpserts: Array<{
      roomExternalId: string;
      date: Date;
      price: number;
    }> = [];

    // NUEVO: Detectar gaps en todo el rango
    const gapNightsMap = detectGapsFromAvailability(availability);
    logger.info("📊 Análisis de gaps completado", {
      gapsDetected: gapNightsMap.size,
      skipFirstDay
    });

    // NUEVO: Obtener fecha del día solapado (si aplica)
    const datesArray = Object.keys(availability).sort();
    const firstDayOfRangeKey = datesArray[0];

    for (const [dateKey, roomsByDate] of Object.entries<any>(availability)) {
      const date = normalizeDate(new Date(dateKey));

      // ════════════════════════════════════════════════════════
      // NUEVO: Si hay solapamiento, ignorar el primer día
      // (fue procesado en el rango anterior)
      // ════════════════════════════════════════════════════════
      if (skipFirstDay && dateKey === firstDayOfRangeKey) {
        logger.debug("⏭️ Saltando día solapado (ya procesado)", { dateKey });
        continue;  // Skip este día, ir al siguiente
      }

      const categoryAvailability: Record<number, number> = {};
      for (const r of Object.values<any>(roomsByDate)) {
        if (r.quantity <= 0) continue;
        const room = roomMap.get(String(r.room_id));
        if (!room) continue;
        for (const rc of room.roomCategories) {
          categoryAvailability[rc.categoryId] =
            (categoryAvailability[rc.categoryId] || 0) + 1;
        }
      }

      const dailyBatch: Record<string, any> = {};

      for (const r of Object.values<any>(roomsByDate)) {
        if (r.quantity <= 0) continue;

        const room = roomMap.get(String(r.room_id));
        if (!room || room.roomCategories.length === 0) continue;

        const category = room.roomCategories[0].category;
        const availableCount = categoryAvailability[category.id] || 0;

        if (!category.pricingConfig) continue;
        const config = category.pricingConfig as any;

        const overrideKey = `${category.id}_${dateKey}`;
        const override = overrideMap.get(overrideKey);

        // NUEVO: Obtener gap si existe
        const gapNights = gapNightsMap.get(dateKey) ?? null;

        let basePrice: number;
        let extraPersonAmountNum: number;
        let emptyChairApplied = false;

        // ════════════════════════════════════════════════════════
        // NUEVO: Modificar minimum_stay si hay gap
        // ════════════════════════════════════════════════════════
        let minimumStayOverride: number | null = null;
        if (gapNights !== null) {
          minimumStayOverride = gapNights;  // Cambiar minimum_stay al número de noches del gap
          logger.info("🔑 MINIMUM_STAY modificado para gap", {
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
          logger.info("💼 OVERRIDE aplicado", {
            room: r.room_id,
            date: dateKey,
            basePrice,
          });
        }
        else if (gapNights !== null) {
          // 2️⃣ GAP NIGHTS
          const gapResult = resolveGapNightsPricing({
            gapNights,
            config,
          });

          if (gapResult.applied) {
            basePrice = gapResult.basePrice!;
            extraPersonAmountNum = gapResult.extraPersonAmount!;
            logger.info("🎯 GAP NIGHTS aplicada", {
              room: r.room_id,
              date: dateKey,
              gapNights,
              basePrice,
            });
          } else {
            // Si gap existe pero no hay regla, continuar a Empty Chair
            const emptyChair = resolveEmptyChairPricing({
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
            } else {
              // 4️⃣ AVAILABILITY
              const key = resolveAvailabilityKey(
                availableCount,
                config.pricingByAvailability
              );
              if (!key) continue;
              basePrice = config.pricingByAvailability[key].price;
              extraPersonAmountNum = Number(config.extraPersonAmount ?? 0);
            }
          }
        }
        else {
          // Sin gap, evaluar Empty Chair
          const emptyChair = resolveEmptyChairPricing({
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
          } else {
            // 4️⃣ AVAILABILITY
            const key = resolveAvailabilityKey(
              availableCount,
              config.pricingByAvailability
            );
            if (!key) continue;
            basePrice = config.pricingByAvailability[key].price;
            extraPersonAmountNum = Number(config.extraPersonAmount ?? 0);
          }
        }

        // ════════════════════════════════════════════════════════
        // VALIDACIÓN: Verificar que rate_plans existe
        // Evita crash si la habitación no tiene rate_plans
        // ════════════════════════════════════════════════════════
        if (!r.rate_plans || Object.keys(r.rate_plans).length === 0) {
          logger.warn("⚠️ Habitación sin rate_plans válidos", {
            room: r.room_id,
            date: dateKey,
          });
          continue;  // Skip esta habitación
        }

        const ratePlan = Object.values<any>(r.rate_plans)[0];
        const occupancyRaw = ratePlan.rates?.[0]?.occupancy ?? config.baseOccupancy;
        const basePriceNum = Number(basePrice);
        const occupancyNum = Number(occupancyRaw);
        const baseOccupancyNum = Number(config.baseOccupancy ?? 1);

        if (
          !Number.isFinite(basePriceNum) ||
          !Number.isFinite(occupancyNum) ||
          !Number.isFinite(baseOccupancyNum) ||
          !Number.isFinite(extraPersonAmountNum)
        ) {
          logger.error("❌ Configuración inválida para cálculo de precio", {
            room: r.room_id,
            date: dateKey,
            basePrice: basePriceNum,
            occupancy: occupancyNum,
            baseOccupancy: baseOccupancyNum,
            extraPersonAmount: extraPersonAmountNum,
          });
          continue;
        }

        const finalPrice =
          basePriceNum +
          Math.max(0, occupancyNum - baseOccupancyNum) * extraPersonAmountNum;

        // ════════════════════════════════════════════════════════
        // IMPORTANTE: Usar String(r.room_id) para consistencia
        // Línea 427 guarda: roomExternalId: String(r.room_id)
        // Aquí buscamos con la misma clave
        // ════════════════════════════════════════════════════════
        const snapshotKey = `${String(r.room_id)}_${dateKey}`;
        const snapshot = snapshotMap.get(snapshotKey);

        if (snapshot && snapshot.price === finalPrice) {
          logger.debug("Precio sin cambios", {
            room: r.room_id,
            date: dateKey,
            price: finalPrice,
          });
          continue;
        }

        // ✅ Log de emptyChair solo cuando hay cambio real
        if (emptyChairApplied) {
          logger.info("🔥 Empty Chair aplicada", {
            room: r.room_id,
            date: dateKey,
            basePrice: basePriceNum,
            extraPersonAmount: extraPersonAmountNum,
          });
        }

        logger.info("Precio calculado", {
          room: r.room_id,
          date: dateKey,
          price: finalPrice,
        });

        const MAX_OCCUPANCY = Math.max(baseOccupancyNum, occupancyNum, 4);
        const rates = Array.from({ length: MAX_OCCUPANCY }, (_, i) => {
          const occ = i + 1;
          return {
            occupancy: occ,
            price:
              basePriceNum +
              Math.max(0, occ - baseOccupancyNum) * extraPersonAmountNum,
          };
        });

        // ════════════════════════════════════════════════════════
        // NUEVO: Incluir minimum_stay modificado si hay gap
        // PxSol SÍ ACEPTA cambios de minimum_stay en PUT
        // Solo enviar: rate_id, currency, minimum_stay, rates
        // NO enviar: maximum_stay, closed, coa, cod
        // ════════════════════════════════════════════════════════

        const ratePlanData: any = {
          rate_id: Number(room.ratePlan),
          rates,
        };

        // Si hay gap, cambiar minimum_stay dinámicamente
        if (minimumStayOverride !== null) {
          ratePlanData.minimum_stay = minimumStayOverride;
          logger.info("🔑 MINIMUM_STAY MODIFICADO para gap", {
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
          await httpClient.put(pxsolEndpoints.updateRates(), {
            [dateKey]: dailyBatch,
          });
          logger.info(`✅ PUT enviado para ${dateKey} | habitaciones: ${Object.keys(dailyBatch).length}`);
        } catch (error: any) {
          logger.error(`❌ Error PUT ${dateKey} | status=${error?.response?.status} | ${error?.message}`);
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
        await prisma.$executeRaw`
          INSERT INTO PriceSnapshot (roomExternalId, date, price)
          VALUES ${Prisma.join(
            snapshotUpserts.map(
              sn => Prisma.sql`(${sn.roomExternalId}, ${sn.date}, ${sn.price})`
            ),
            ','
          )}
          ON DUPLICATE KEY UPDATE price = VALUES(price)
        `;
        logger.info(`✅ Snapshots guardados (batch optimizado): ${snapshotUpserts.length}`);
      } catch (error: any) {
        logger.error("❌ Error guardando snapshots batch", {
          count: snapshotUpserts.length,
          error: error?.message,
        });
      }
    }

    // Log final del rango
    if (skipFirstDay) {
      logger.info("✅ Rango completado (con solapamiento de 1 día)", {
        startDate: addDays(startDate, 1).toISOString().split("T")[0],  // Mostrar fecha real sin solapamiento
        endDate: endDate.toISOString().split("T")[0],
        diasProcesados: datesArray.length - 1  // -1 porque saltamos el primer día
      });
    } else {
      logger.info("✅ Rango completado", {
        startDate: startDate.toISOString().split("T")[0],
        endDate: endDate.toISOString().split("T")[0],
        diasProcesados: datesArray.length
      });
    }
  }

  logger.info("🏁 Ciclo de pricing finalizado");
}
