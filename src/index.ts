import "dotenv/config";
import { startScheduler, runSingleCycle } from "./jobs/pricingJob";
import { logger } from "./utils/logger";

async function main() {
  const singleCycleMode = process.env.SINGLE_CYCLE === "true";
  const nodeEnv = process.env.NODE_ENV || "development";

  logger.info("════════════════════════════════════════════");
  logger.info("🚀 Arrancando servicio");
  logger.info(`📦 NODE_ENV: ${nodeEnv}`);
  logger.info(`🔄 SINGLE_CYCLE: ${singleCycleMode}`);
  logger.info("════════════════════════════════════════════");

  // ════════════════════════════════════════════════════════
  // Si SINGLE_CYCLE=true (GitHub Actions), ejecutar UN ciclo y terminar
  // Si no, ejecutar scheduler normal
  // ════════════════════════════════════════════════════════
  if (singleCycleMode) {
    logger.info("📌 Modo de ciclo único (GitHub Actions)");
    await runSingleCycle();
    // runSingleCycle hace process.exit() automáticamente
  } else {
    // Modo normal: scheduler con ciclos cada 5 minutos
    await startScheduler(/* immediateRun = true */);
  }
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
