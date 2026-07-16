"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
require("dotenv/config");
const pricingJob_1 = require("./jobs/pricingJob");
const logger_1 = require("./utils/logger");
async function main() {
    logger_1.logger.info("Arrancando servicio...");
    // Si prefieres migrar por código:
    // await runMigrations(); // O ejecuta prisma migrate deploy en entrypoint
    // Primer fetch inmediato (encapsulado en el job)
    await (0, pricingJob_1.startScheduler)( /* immediateRun = true */);
}
main().catch(err => {
    console.error(err);
    process.exit(1);
});
