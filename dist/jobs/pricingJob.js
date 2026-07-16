"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.startScheduler = startScheduler;
const node_cron_1 = __importDefault(require("node-cron"));
const pricingService_1 = require("../services/pricingService");
const logger_1 = require("../utils/logger");
let isRunning = false;
async function startScheduler() {
    /**
     * ▶️ Ejecutar inmediatamente al iniciar la app
     */
    if (!isRunning) {
        try {
            isRunning = true;
            logger_1.logger.info("🚀 Ejecutando primer ciclo de pricing");
            await (0, pricingService_1.runPricingCycle)();
            logger_1.logger.info("✅ Primer ciclo ejecutado correctamente");
        }
        catch (err) {
            logger_1.logger.error("❌ Error en primer ciclo", err);
        }
        finally {
            isRunning = false;
        }
    }
    /**
     * ⏱ Ejecutar cada 5 minutos
     * Cron: minuto divisible por 5
     */
    node_cron_1.default.schedule("*/5 * * * *", async () => {
        if (isRunning) {
            logger_1.logger.warn("⏳ Ciclo anterior aún en ejecución, se omite este tick");
            return;
        }
        try {
            isRunning = true;
            logger_1.logger.info("🔁 Ejecutando ciclo programado de pricing");
            await (0, pricingService_1.runPricingCycle)();
            logger_1.logger.info("✅ Ciclo programado ejecutado correctamente");
        }
        catch (err) {
            logger_1.logger.error("❌ Error en ciclo programado", err);
        }
        finally {
            isRunning = false;
        }
    });
    logger_1.logger.info("🕒 Scheduler de pricing iniciado (cada 5 minutos)");
}
