"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.prisma = void 0;
const client_1 = require("@prisma/client");
const logger_1 = require("../../utils/logger");
const globalForPrisma = global;
// Crear una sola instancia (evita duplicados en desarrollo)
exports.prisma = globalForPrisma.prisma ??
    new client_1.PrismaClient({
        log: ["info", "warn", "error"],
    });
// Guardar instancia global en desarrollo (para hot reload)
if (process.env.NODE_ENV !== "production") {
    globalForPrisma.prisma = exports.prisma;
}
// Conectar y registrar eventos
(async () => {
    try {
        await exports.prisma.$connect();
        logger_1.logger.info("✅ Conectado a la base de datos correctamente.");
    }
    catch (error) {
        logger_1.logger.error(`❌ Error al conectar a la base de datos: ${error.message}`);
    }
})();
// Cierre limpio del cliente
process.on("beforeExit", async () => {
    logger_1.logger.info("🔌 Cerrando conexión con la base de datos...");
    await exports.prisma.$disconnect();
});
