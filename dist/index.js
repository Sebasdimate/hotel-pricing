"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
require("dotenv/config");
const pricingJob_1 = require("./jobs/pricingJob");
const logger_1 = require("./utils/logger");
const fs_1 = require("fs");
const path_1 = require("path");
async function main() {
    const singleCycleMode = process.env.SINGLE_CYCLE === "true";
    const nodeEnv = process.env.NODE_ENV || "development";
    let version = "unknown";
    try {
        const versionFile = (0, path_1.join)(__dirname, "..", "VERSION");
        version = (0, fs_1.readFileSync)(versionFile, "utf-8").trim();
    }
    catch (err) {
        // Si no encuentra el archivo, continúa con "unknown"
    }
    logger_1.logger.info("╔════════════════════════════════════════════════════════════╗");
    logger_1.logger.info("║              🚀 SERVICIO DE PRICING INICIADO              ║");
    logger_1.logger.info("╠════════════════════════════════════════════════════════════╣");
    logger_1.logger.info(`║ 📦 VERSION: ${version.padEnd(50)} ║`);
    logger_1.logger.info(`║ 🌍 NODE_ENV: ${nodeEnv.padEnd(48)} ║`);
    logger_1.logger.info(`║ 🔄 SINGLE_CYCLE: ${String(singleCycleMode).padEnd(43)} ║`);
    logger_1.logger.info("╚════════════════════════════════════════════════════════════╝");
    // ════════════════════════════════════════════════════════
    // Si SINGLE_CYCLE=true (GitHub Actions), ejecutar UN ciclo y terminar
    // Si no, ejecutar scheduler normal
    // ════════════════════════════════════════════════════════
    if (singleCycleMode) {
        logger_1.logger.info("📌 Modo de ciclo único (GitHub Actions)");
        await (0, pricingJob_1.runSingleCycle)();
        // runSingleCycle hace process.exit() automáticamente
    }
    else {
        // Modo normal: scheduler con ciclos cada 5 minutos
        await (0, pricingJob_1.startScheduler)( /* immediateRun = true */);
    }
}
main().catch(err => {
    console.error(err);
    process.exit(1);
});
