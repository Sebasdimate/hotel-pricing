import "dotenv/config";
import { startScheduler } from "./jobs/pricingJob";
import { logger } from "./utils/logger";

async function main() {
  logger.info("Arrancando servicio...");

  // Si prefieres migrar por código:
  // await runMigrations(); // O ejecuta prisma migrate deploy en entrypoint

  // Primer fetch inmediato (encapsulado en el job)
  await startScheduler(/* immediateRun = true */);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
