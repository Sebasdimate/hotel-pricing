import "dotenv/config";
import { startScheduler, runSingleCycle } from "./jobs/pricingJob";
import { logger } from "./utils/logger";
import { readFileSync } from "fs";
import { join } from "path";

async function main() {
  const singleCycleMode = process.env.SINGLE_CYCLE === "true";
  const nodeEnv = process.env.NODE_ENV || "development";

  let version = "unknown";
  try {
    const versionFile = join(__dirname, "..", "VERSION");
    version = readFileSync(versionFile, "utf-8").trim();
  } catch (err) {
    // Si no encuentra el archivo, continúa con "unknown"
  }

  logger.info("╔════════════════════════════════════════════════════════════╗");
  logger.info("║              🚀 SERVICIO DE PRICING INICIADO              ║");
  logger.info("╠════════════════════════════════════════════════════════════╣");
  logger.info(`║ 📦 VERSION: ${version.padEnd(50)} ║`);
  logger.info(`║ 🌍 NODE_ENV: ${nodeEnv.padEnd(48)} ║`);
  logger.info(`║ 🔄 SINGLE_CYCLE: ${String(singleCycleMode).padEnd(43)} ║`);
  logger.info("╚════════════════════════════════════════════════════════════╝");

  // ════════════════════════════════════════════════════════
  // Si SINGLE_CYCLE=true, ejecutar UN ciclo y terminar (útil para pruebas
  // manuales, ej: DRY_RUN=true SINGLE_CYCLE=true). Si no, scheduler normal.
  // En producción (EC2/PM2) NO se usa SINGLE_CYCLE → corre el scheduler.
  // ════════════════════════════════════════════════════════
  if (singleCycleMode) {
    logger.info("📌 Modo de ciclo único (SINGLE_CYCLE)");
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
