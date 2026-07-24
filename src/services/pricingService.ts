import { Prisma } from "@prisma/client";
import httpClient from "../infra/http/axiosClient";
import { prisma } from "../infra/prisma/client";
import { logger } from "../utils/logger";
import { pxsolEndpoints } from "../repos/pxsolApi";
import { addMonths, addDays, formatDate } from "../utils/dateUtils";
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

// DRY_RUN=true: calcula todo igual pero NO escribe nada.
// Ni PUT a PxSol ni snapshots en BD (escribir snapshots haría que la siguiente
// corrida real creyera que esos precios ya se aplicaron y los saltara).
const DRY_RUN = process.env.DRY_RUN === "true";

// Cuántos PUT se envían en paralelo. Antes iban de a uno (hasta ~90 por rango en
// serie), lo que podía hacer que el ciclo pasara de 5 min y se saltara el siguiente.
// 6 es un punto medio: acelera mucho sin abrumar a PxSol. Ajustable por env.
const PUT_CONCURRENCY = Math.max(1, Number(process.env.PUT_CONCURRENCY) || 6);

/**
 * Ejecuta `worker` sobre todos los items con como máximo `limit` en paralelo.
 * `limit` runners comparten un índice y van tomando el siguiente item libre.
 * (No hay condición de carrera: en Node los workers solo se intercalan en los
 * `await`, y los push/set sobre los acumuladores son síncronos.)
 */
async function runPutPool<T>(
  items: T[],
  limit: number,
  worker: (item: T) => Promise<void>
): Promise<void> {
  let i = 0;
  const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (i < items.length) {
      const item = items[i++];
      await worker(item);
    }
  });
  await Promise.all(runners);
}

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

/**
 * Pide la disponibilidad de un rango. Si PxSol responde 400 (rechaza la fecha de
 * inicio por considerarla pasada), reintenta desde el día siguiente en vez de
 * perder el rango completo.
 *
 * PxSol valida contra una zona horaria adelantada respecto a Colombia, así que a
 * partir de cierta hora de la tarde deja de aceptar "hoy". No asumimos cuál es esa
 * hora ni esa zona: reaccionamos al 400 real. Si algún día lo corrigen, este código
 * aprovecha la hora extra automáticamente.
 *
 * `shifted: true` indica que el primer día del rango NO es evaluable como gap (no
 * hay día anterior con el que comparar), así que quien llama debe saltárselo.
 */
export async function fetchAvailabilityWithRetry(startDate: Date, endDate: Date) {
  try {
    const resp = await httpClient.get(pxsolEndpoints.availability(startDate, endDate));
    return { availability: resp.data.data.availability, startDate, shifted: false };
  } catch (error: any) {
    if (error?.response?.status !== 400) throw error;

    const shiftedStart = addDays(startDate, 1);
    logger.warn("⚠️ 400 en GET availability: reintentando desde el día siguiente", {
      original: formatDate(startDate),
      reintento: formatDate(shiftedStart),
      motivo: error?.response?.data?.message,
    });

    const resp = await httpClient.get(pxsolEndpoints.availability(shiftedStart, endDate));
    return { availability: resp.data.data.availability, startDate: shiftedStart, shifted: true };
  }
}

export async function runPricingCycle() {
  logger.info("🚀 Iniciando ciclo de pricing");

  // Contadores de resumen del ciclo: una sola línea al final vale más que
  // miles de líneas por habitación/fecha para saber si el ciclo salió sano
  const cicloInicio = Date.now();
  const stats = {
    rangosOk: 0,
    rangosFallidos: 0,
    preciosCambiados: 0,
    gapsAplicados: 0,
    emptyChairAplicados: 0,
    putsOk: 0,
    putsFallidos: 0,
    putsSimulados: 0,
    snapshotsGuardados: 0,
    sinMinStayDefault: 0,  // categorías sin minimumStayDefault configurado (config incompleta)
  };

  if (DRY_RUN) {
    logger.warn("🧪 DRY_RUN ACTIVO — no se enviará ningún PUT ni se guardará ningún snapshot");
  }

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

  if (roomsData.length > 0 && DRY_RUN) {
    logger.info(`🧪 [DRY_RUN] sync de Room NO escrito: ${roomsData.length} habitaciones`);
  } else if (roomsData.length > 0) {
    try {
      await prisma.$executeRaw`
        INSERT INTO Room (externalId, code, name, description, ratePlan, updatedAt)
        VALUES ${Prisma.join(
          roomsData.map(
            rd => Prisma.sql`(${rd.externalId}, ${rd.code}, ${rd.name}, ${rd.description}, ${rd.ratePlan}, NOW())`
          ),
          ','
        )}
        ON DUPLICATE KEY UPDATE
          code = VALUES(code),
          name = VALUES(name),
          description = VALUES(description),
          ratePlan = VALUES(ratePlan),
          updatedAt = NOW()
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
      logger.debug("🔄 Solapamiento: 1 día anterior para detectar gaps en límite");
    }

    const endDate = addDays(startDate, 90);

    logger.info("📅 Procesando rango de fechas", { startDate, endDate, skipFirstDay });

    let availability: any;
    try {
      const res = await fetchAvailabilityWithRetry(startDate, endDate);
      availability = res.availability;
      if (res.shifted) {
        // Nos corrieron un día (400 en "hoy"). El primer día visible (mañana) SÍ se
        // evalúa ahora con la detección hacia-adelante, así que NO se salta.
        startDate = res.startDate;
      }
    } catch (error: any) {
      stats.rangosFallidos++;
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

    // Tareas de PUT acumuladas durante el rango; se envían en paralelo al final.
    const putTasks: Array<{
      dateKey: string;
      dailyBatch: Record<string, any>;
      daySnapshots: Array<{ roomExternalId: string; date: Date; price: number; snapshotKey: string }>;
    }> = [];

    // NUEVO: Detectar gaps en todo el rango (POR HABITACIÓN - FIX: ahora detecta para cada room individual)
    // La clave del mapa es ahora `${roomId}_${dateString}` en lugar de solo `${dateString}`
    // forwardFirstDay solo en el primer bloque (offset 0): ahí datesSorted[0] es HOY
    // y no hay día anterior visible. En los demás bloques el primer día es un borde
    // futuro con vecino real, así que se detecta bidireccional (y además se salta).
    const gapNightsMap = detectGapsFromAvailability(availability, offset === 0);
    logger.debug("📊 Análisis de gaps completado", {
      gapsDetected: gapNightsMap.size,
      skipFirstDay
    });

    // NUEVO: Obtener fecha del día solapado (si aplica)
    const datesArray = Object.keys(availability).sort();
    const firstDayOfRangeKey = datesArray[0];

    for (const [dateKey, roomsByDate] of Object.entries<any>(availability)) {
      const date = new Date(dateKey + "T00:00:00Z");

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
      // Snapshots de ESTE día, en espera. Solo se confirman a snapshotUpserts si el
      // PUT a PxSol sale bien; si falla, se descartan para que el próximo ciclo reintente.
      const daySnapshots: Array<{
        roomExternalId: string;
        date: Date;
        price: number;
        snapshotKey: string;
      }> = [];

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

        // NUEVO: Obtener gap si existe (FIX: ahora busca por ${roomId}_${date}, no solo ${date})
        const gapNights = gapNightsMap.get(`${String(r.room_id)}_${dateKey}`) ?? null;

        let basePrice: number;
        let extraPersonAmountNum: number;
        let emptyChairApplied = false;
        let emptyChairMinStay: number | undefined;  // minimum_stay propio de la regla de empty chair, si lo trae

        // ════════════════════════════════════════════════════════
        // NUEVO: Modificar minimum_stay si hay gap
        // ════════════════════════════════════════════════════════
        let minimumStayOverride: number | null = null;
        if (gapNights !== null) {
          minimumStayOverride = gapNights;
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
            stats.gapsAplicados++;
            logger.debug("🎯 GAP NIGHTS aplicada", {
              room: r.room_id,
              date,
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
              emptyChairMinStay = emptyChair.minimumStay;
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
            emptyChairMinStay = emptyChair.minimumStay;
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

        if (emptyChairApplied) stats.emptyChairAplicados++;

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
        const liveMinStay = ratePlan.minimum_stay;   // min_stay ACTUAL en PxSol (para el skip)
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

        const snapshotKey = `${String(r.room_id)}_${dateKey}`;

        // ════════════════════════════════════════════════════════
        // Resolver minimum_stay (gap → empty chair con min propio → default).
        // ════════════════════════════════════════════════════════
        const defaultMinStay = Number(config.minimumStayDefault);
        const hasDefault = Number.isFinite(defaultMinStay) && defaultMinStay >= 1;

        let resolvedMinimumStay: number | null = null;
        let minStayOrigen: string;
        if (minimumStayOverride !== null) {
          resolvedMinimumStay = minimumStayOverride;                 // gap: siempre
          minStayOrigen = "gap";
        } else if (emptyChairApplied && emptyChairMinStay !== undefined) {
          resolvedMinimumStay = Number(emptyChairMinStay);           // empty chair con min propio
          minStayOrigen = "empty_chair";
        } else if (hasDefault) {
          resolvedMinimumStay = defaultMinStay;                      // default de la categoría
          minStayOrigen = "default";
        } else {
          resolvedMinimumStay = null;                                // sin default: no se toca
          minStayOrigen = "no_configurado_no_se_envia";
        }

        // Array de tarifas que enviaríamos (occ 1..MAX)
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
        // SKIP: comparar el PAYLOAD COMPLETO contra lo que está VIVO en PxSol.
        // No basta con el precio base: si cambia extraPersonAmount o CUALQUIER
        // tarifa por ocupación, o el min_stay, hay que mandar el PUT. Comparamos
        // contra la respuesta real de PxSol (fuente de verdad), tarifa por tarifa.
        // (El snapshot de un solo precio no detectaba cambios en occ 2+.)
        // ════════════════════════════════════════════════════════
        const liveByOcc = new Map<number, number>(
          (ratePlan.rates ?? []).map((x: any) => [Number(x.occupancy), Number(x.price)])
        );
        let algunaTarifaCambia = false;
        for (const rt of rates) {
          if (liveByOcc.get(rt.occupancy) !== rt.price) { algunaTarifaCambia = true; break; }
        }
        const minStayCambia = resolvedMinimumStay !== null && resolvedMinimumStay !== liveMinStay;

        if (!algunaTarifaCambia && !minStayCambia) {
          logger.debug("Sin cambios (payload == PxSol)", {
            room: r.room_id,
            date: dateKey,
            price: finalPrice,
            minimum_stay: resolvedMinimumStay,
            liveMinStay,
          });
          continue;
        }

        // A partir de aquí SÍ se manda el PUT.
        if (resolvedMinimumStay === null) {
          // Config incompleta (categoría sin minimumStayDefault): no tocamos el
          // min_stay, pero lo contamos para avisar en el resumen del ciclo.
          stats.sinMinStayDefault++;
        }

        // ✅ Log de emptyChair solo cuando hay cambio real
        if (emptyChairApplied) {
          logger.debug("🔥 Empty Chair aplicada", {
            room: r.room_id,
            date: dateKey,
            basePrice: basePriceNum,
            extraPersonAmount: extraPersonAmountNum,
          });
        }

        // rate_plans: solo rate_id, rates y (si aplica) minimum_stay.
        // NO enviar maximum_stay, closed, coa, cod → PxSol responde 422.
        // El minimum_stay ya se resolvió antes del skip (resolvedMinimumStay).
        const ratePlanData: any = {
          rate_id: Number(room.ratePlan),
          rates,
        };
        if (resolvedMinimumStay !== null) {
          ratePlanData.minimum_stay = resolvedMinimumStay;
        }
        logger.debug("🔑 minimum_stay resuelto", {
          room: r.room_id,
          date: dateKey,
          minimum_stay: resolvedMinimumStay,
          origen: minStayOrigen,
        });

        dailyBatch[String(r.room_id)] = {
          day: dateKey,
          room_id: Number(r.room_id),
          rate_plans: {
            [String(room.ratePlan)]: ratePlanData,
          },
        };

        // No confirmamos el snapshot todavía: esperamos a saber si el PUT tuvo éxito.
        // (stats.preciosCambiados y snapshotMap también se actualizan solo tras el PUT OK)
        daySnapshots.push({
          roomExternalId: String(r.room_id),
          date,
          price: finalPrice,
          snapshotKey,
        });
      }

      // No se envía aquí: se acumula y se manda en paralelo al terminar el rango.
      if (Object.keys(dailyBatch).length > 0) {
        putTasks.push({ dateKey, dailyBatch, daySnapshots });
      }
    }

    // ════════════════════════════════════════════════════════
    // Envío de los PUT EN PARALELO (antes: uno por día, en serie).
    // El commit/discard de snapshots se mantiene por tarea: solo se confirman
    // los del PUT que salió bien; los de un PUT fallido se descartan y se reintentan.
    // ════════════════════════════════════════════════════════
    await runPutPool(putTasks, PUT_CONCURRENCY, async ({ dateKey, dailyBatch, daySnapshots }) => {
      if (DRY_RUN) {
        stats.putsSimulados++;
        stats.preciosCambiados += daySnapshots.length;  // en dry-run: lo que SE HABRÍA cambiado
        logger.info(`🧪 [DRY_RUN] PUT NO enviado para ${dateKey} | habitaciones: ${Object.keys(dailyBatch).length}`);
        logger.debug("🧪 [DRY_RUN] payload que se habría enviado", { [dateKey]: dailyBatch });
        return;
      }
      try {
        await httpClient.put(pxsolEndpoints.updateRates(), {
          [dateKey]: dailyBatch,
        });
        stats.putsOk++;
        // ✅ PUT OK: recién ahora confirmamos los snapshots de este día.
        for (const sn of daySnapshots) {
          snapshotUpserts.push({ roomExternalId: sn.roomExternalId, date: sn.date, price: sn.price });
          snapshotMap.set(sn.snapshotKey, { price: sn.price });
          stats.preciosCambiados++;
        }
        logger.debug(`✅ PUT enviado para ${dateKey} | habitaciones: ${Object.keys(dailyBatch).length}`);
      } catch (error: any) {
        stats.putsFallidos++;
        // ❌ PUT falló: NO guardamos los snapshots de este día. Así, en el próximo
        // ciclo el precio seguirá viéndose distinto al snapshot y se REINTENTA
        // (antes se guardaba igual y el fallo se perdía en silencio).
        logger.error(
          `❌ Error PUT ${dateKey} | status=${error?.response?.status} | ${error?.message} | snapshots descartados=${daySnapshots.length}`
        );
      }
    });

    // ════════════════════════════════════════════════════════
    // OPTIMIZADO: Batch insert/update en UNA sola query
    // Antes: 9,000 queries individuales (for + upsert)
    // Ahora: 1 query batch con INSERT ... ON DUPLICATE KEY UPDATE
    // Mejora: 100-1000x más rápido
    // ════════════════════════════════════════════════════════

    if (snapshotUpserts.length > 0 && DRY_RUN) {
      logger.info(`🧪 [DRY_RUN] snapshots NO guardados: ${snapshotUpserts.length}`);
    } else if (snapshotUpserts.length > 0) {
      try {
        await prisma.$executeRaw`
          INSERT INTO PriceSnapshot (roomExternalId, date, price, updatedAt)
          VALUES ${Prisma.join(
            snapshotUpserts.map(
              sn => Prisma.sql`(${sn.roomExternalId}, ${sn.date}, ${sn.price}, NOW())`
            ),
            ','
          )}
          ON DUPLICATE KEY UPDATE price = VALUES(price), updatedAt = NOW()
        `;
        stats.snapshotsGuardados += snapshotUpserts.length;
        logger.debug(`✅ Snapshots guardados (batch optimizado): ${snapshotUpserts.length}`);
      } catch (error: any) {
        logger.error("❌ Error guardando snapshots batch", {
          count: snapshotUpserts.length,
          error: error?.message,
        });
      }
    }

    stats.rangosOk++;

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

  const resumen = {
    duracionSeg: Number(((Date.now() - cicloInicio) / 1000).toFixed(1)),
    ...stats,
  };

  if (stats.sinMinStayDefault > 0) {
    logger.warn("⚠️ Hubo cálculos sin minimumStayDefault configurado (se usó 1 como fallback)", {
      ocurrencias: stats.sinMinStayDefault,
      accion: "Configurar minimumStayDefault en el pricingConfig de esas categorías",
    });
  }

  if (stats.rangosFallidos > 0 || stats.putsFallidos > 0) {
    logger.error("🏁 Ciclo de pricing finalizado CON FALLOS", resumen);
  } else {
    logger.info("🏁 Ciclo de pricing finalizado", resumen);
  }
}
