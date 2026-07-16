import { PrismaClient, Prisma } from "@prisma/client";
import { logger } from "../../utils/logger";

const globalForPrisma = global as unknown as {
  prisma?: PrismaClient;
};

// Crear una sola instancia (evita duplicados en desarrollo)
export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    log: ["info", "warn", "error"],
  });

// Guardar instancia global en desarrollo (para hot reload)
if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
}

// Conectar y registrar eventos
(async () => {
  try {
    await prisma.$connect();
    logger.info("✅ Conectado a la base de datos correctamente.");
  } catch (error: any) {
    logger.error(`❌ Error al conectar a la base de datos: ${error.message}`);
  }
})();

// Cierre limpio del cliente
process.on("beforeExit", async () => {
  logger.info("🔌 Cerrando conexión con la base de datos...");
  await prisma.$disconnect();
});
