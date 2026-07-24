export function resolveEmptyChairPricing(params: {
  date: Date;
  config: any;
  basePrice: number;
  extraPersonAmount: number;
}) {
  const { date, config } = params;

  // Si no hay reglas → fallback automático
  if (!config?.emptyChairRules?.length) {
    return {
      basePrice: params.basePrice,
      extraPersonAmount: params.extraPersonAmount,
      applied: false,
    };
  }

  // `date` llega como medianoche UTC (pricingService la crea con "YYYY-MM-DDT00:00:00Z").
  // Si aquí usáramos medianoche LOCAL, quedaría un sesgo del offset horario (5h en
  // Colombia) y Math.floor tumbaría un día en TODAS las fechas.
  // Tomamos el día del calendario local (el "hoy" real del hotel) y lo representamos
  // en UTC, para comparar contra `date` con el mismo criterio.
  const now = new Date();
  const today = new Date(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()));

  const diffDays = Math.round(
    (date.getTime() - today.getTime()) / (1000 * 60 * 60 * 24)
  );

  const rule = config.emptyChairRules.find(
    (r:any) =>
      diffDays >= Number(r.fromDays) &&
      diffDays <= Number(r.toDays)
  );

  if (!rule) {
    return {
      basePrice: params.basePrice,
      extraPersonAmount: params.extraPersonAmount,
      applied: false,
    };
  }

  return {
    basePrice: Number(rule.priceBase),
    extraPersonAmount: Number(rule.extraPersonAmount),
    applied: true,
    // minimumStay opcional de la regla: si no viene, quien llama usa el default de la categoría
    minimumStay: rule.minimumStay !== undefined ? Number(rule.minimumStay) : undefined,
  };
}
