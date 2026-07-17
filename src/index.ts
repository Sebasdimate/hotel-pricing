import "dotenv/config";
import { startScheduler, runSingleCycle } from "./jobs/pricingJob";
import { logger } from "./utils/logger";

async function main() {
  logger.info("Arrancando servicio...");

  // ════════════════════════════════════════════════════════
  // Si SINGLE_CYCLE=true (GitHub Actions), ejecutar UN ciclo y terminar
  // Si no, ejecutar scheduler normal
  // ════════════════════════════════════════════════════════
  if (process.env.SINGLE_CYCLE === "true") {
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
