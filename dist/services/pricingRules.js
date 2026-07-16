"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.resolveEmptyChairPricing = resolveEmptyChairPricing;
function resolveEmptyChairPricing(params) {
    const { date, config } = params;
    // Si no hay reglas → fallback automático
    if (!config?.emptyChairRules?.length) {
        return {
            basePrice: params.basePrice,
            extraPersonAmount: params.extraPersonAmount,
            applied: false,
        };
    }
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const diffDays = Math.floor((date.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
    const rule = config.emptyChairRules.find((r) => diffDays >= Number(r.fromDays) &&
        diffDays <= Number(r.toDays));
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
    };
}
