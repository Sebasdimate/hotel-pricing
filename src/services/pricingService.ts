import { Prisma } from "@prisma/client";
import httpClient from "../infra/http/axiosClient";
import { prisma } from "../infra/prisma/client";
import { logger } from "../utils/logger";
import { pxsolEndpoints } from "../repos/pxsolApi";
import { addMonths, addDays } from "../utils/dateUtils";
import { resolveEmptyChairPricing } from "./pricingRules";

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

  for (const r of Object.values<any>(rooms)) {
    const ratePlanObj = Object.values(r.rate_plans as Record<string, RatePlan>)[0];
    await prisma.room.upsert({
      where: { externalId: String(r.room_id) },
      update: {
        code: r.code,
        name: r.name,
        description: r.description,
        ratePlan: String(ratePlanObj.rate_id),
      },
      create: {
        externalId: String(r.room_id),
        code: r.code,
        name: r.name,
        description: r.description,
        ratePlan: String(ratePlanObj.rate_id),
      },
    });
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
    const startDate = addMonths(baseDate, offset);
    const endDate = addDays(startDate, 90);

    logger.info("📅 Procesando rango de fechas", { startDate, endDate });

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

    for (const [dateKey, roomsByDate] of Object.entries<any>(availability)) {
      const date = normalizeDate(new Date(dateKey));

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

        let basePrice: number;
        let extraPersonAmountNum: number;
        let emptyChairApplied = false;

        const emptyChair = resolveEmptyChairPricing({
          date,
          config,
          basePrice: Number(config.pricingByAvailability?.["1"]?.price ?? 0),
          extraPersonAmount: Number(config.extraPersonAmount ?? 0),
        });

        if (emptyChair.applied) {
          basePrice = emptyChair.basePrice;
          extraPersonAmountNum = emptyChair.extraPersonAmount;
          emptyChairApplied = true;
        } else if (override) {
          basePrice = Number(override.priceInitial);
          extraPersonAmountNum = Number(override.addPerPerson ?? config.extraPersonAmount ?? 0);
        } else {
          const key = resolveAvailabilityKey(
            availableCount,
            config.pricingByAvailability
          );
          if (!key) continue;
          basePrice = config.pricingByAvailability[key].price;
          extraPersonAmountNum = Number(config.extraPersonAmount ?? 0);
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

        const snapshotKey = `${r.room_id}_${dateKey}`;
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

        dailyBatch[String(r.room_id)] = {
          day: dateKey,
          room_id: Number(r.room_id),
          rate_plans: {
            [String(room.ratePlan)]: {
              rate_id: Number(room.ratePlan),
              rates,
            },
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

    for (const sn of snapshotUpserts) {
      await prisma.priceSnapshot.upsert({
        where: {
          roomExternalId_date: {
            roomExternalId: sn.roomExternalId,
            date: sn.date,
          },
        },
        update: { price: sn.price },
        create: {
          roomExternalId: sn.roomExternalId,
          date: sn.date,
          price: sn.price,
        },
      });
    }

    logger.info(`✅ Snapshots actualizados: ${snapshotUpserts.length}`);
  }

  logger.info("Ciclo de pricing finalizado");
}
