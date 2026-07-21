import { logger } from "../utils/logger";

type GapNightsPricingResult = {
  gapNights: number | null;
  applied: boolean;
  basePrice?: number;
  extraPersonAmount?: number;
};

/**
 * Detecta si hay un hueco (gap) de 1 o 2 noches basándose en quantity
 * Patrón 1: 0 → 1 → 0 = gap de 1 noche
 * Patrón 2: 0 → 1 → 1 → 0 = gap de 2 noches
 */
export function resolveGapNightsPricing(params: {
  gapNights: number | null;
  config: any;
}): GapNightsPricingResult {
  const { gapNights, config } = params;

  // Si no hay gap o no hay configuración de gap rules
  if (gapNights === null || !config?.gapNightsRules) {
    return {
      gapNights: null,
      applied: false,
    };
  }

  // Buscar regla que aplique para este gap
  const rule = config.gapNightsRules.find((r: any) => {
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
 * Analiza la disponibilidad (quantity) para detectar gaps
 * Devuelve un mapa: fecha → número de noches de gap
 * IMPORTANTE: Normaliza fechas al formato YYYY-MM-DD para consistencia
 */
export function detectGapsFromAvailability(availability: any): Map<string, number> {
  const gapNightsMap = new Map<string, number>();
  const datesSorted = Object.keys(availability).sort();

  // Función para normalizar fecha al formato YYYY-MM-DD
  const normalizeDate = (dateStr: string): string => {
    return dateStr.split("T")[0]; // Extrae "YYYY-MM-DD" de "YYYY-MM-DDTHH:MM:SSZ" o retorna igual si ya es "YYYY-MM-DD"
  };

  for (let i = 0; i < datesSorted.length - 2; i++) {
    const date0 = normalizeDate(datesSorted[i]);
    const date1 = normalizeDate(datesSorted[i + 1]);
    const date2 = normalizeDate(datesSorted[i + 2]);

    // Obtener quantity para cualquier habitación disponible (usar la primera del día)
    const firstRoomDate0 = Object.values<any>(availability[date0])[0];
    const firstRoomDate1 = Object.values<any>(availability[date1])[0];
    const firstRoomDate2 = Object.values<any>(availability[date2])[0];

    const qty0 = firstRoomDate0?.quantity ?? 0;
    const qty1 = firstRoomDate1?.quantity ?? 0;
    const qty2 = firstRoomDate2?.quantity ?? 0;

    // PATRÓN 1: Ocupado → Libre → Ocupado = GAP DE 1 NOCHE
    if (qty0 === 0 && qty1 > 0 && qty2 === 0) {
      gapNightsMap.set(date1, 1);
      logger.info("🔍 GAP de 1 noche detectado", { date: date1 });
    }
    // PATRÓN 2: Ocupado → Libre → Libre → Ocupado = GAP DE 2 NOCHES
    // Usar else if para dejar explícito que son mutuamente excluyentes
    else if (i + 3 < datesSorted.length) {
      const date3 = normalizeDate(datesSorted[i + 3]);
      const firstRoomDate3 = Object.values<any>(availability[datesSorted[i + 3]])[0];
      const qty3 = firstRoomDate3?.quantity ?? 0;

      if (qty0 === 0 && qty1 > 0 && qty2 > 0 && qty3 === 0) {
        gapNightsMap.set(date1, 2);
        gapNightsMap.set(date2, 2);
        logger.info("🔍 GAP de 2 noches detectado", { dates: `${date1} - ${date2}` });
      }
    }
  }

  return gapNightsMap;
}
