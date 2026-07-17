import cron from "node-cron";
import { runPricingCycle } from "../services/pricingService";
import { logger } from "../utils/logger";

let isRunning = false;

// ════════════════════════════════════════════════════════
// PARA GITHUB ACTIONS: Ejecutar SOLO UN CICLO sin scheduler
// ════════════════════════════════════════════════════════
export async function runSingleCycle() {
  logger.info("🚀 Ejecutando ciclo único de pricing (GitHub Actions)");
  try {
    await runPricingCycle();
    logger.info("✅ Ciclo completado exitosamente");
    process.exit(0);
  } catch (err) {
    logger.error("❌ Error en ciclo de pricing", err);
    process.exit(1);
  }
}

export async function startScheduler() {
  /**
   * ▶️ Ejecutar inmediatamente al iniciar la app
   */
  if (!isRunning) {
    try {
      isRunning = true;
      logger.info("🚀 Ejecutando primer ciclo de pricing");
      await runPricingCycle();
      logger.info("✅ Primer ciclo ejecutado correctamente");
    } catch (err) {
      logger.error("❌ Error en primer ciclo", err);
    } finally {
      isRunning = false;
    }
  }

  /**
   * ⏱ Ejecutar cada 5 minutos
   * Cron: minuto divisible por 5
   */
  cron.schedule("*/5 * * * *", async () => {
    if (isRunning) {
      logger.warn("⏳ Ciclo anterior aún en ejecución, se omite este tick");
      return;
    }

    try {
      isRunning = true;
      logger.info("🔁 Ejecutando ciclo programado de pricing");
      await runPricingCycle();
      logger.info("✅ Ciclo programado ejecutado correctamente");
    } catch (err) {
      logger.error("❌ Error en ciclo programado", err);
    } finally {
      isRunning = false;
    }
  });

  logger.info("🕒 Scheduler de pricing iniciado (cada 5 minutos)");
}
