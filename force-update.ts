import { runDailyFixedPriceUpdate } from "./src/jobs/dailyPriceSync";

console.log("🚀 Iniciando forzado manual de precios...");

runDailyFixedPriceUpdate()
  .then(() => {
    console.log("✅ ¡Proceso completado! Revisa la base de datos.");
    process.exit(0);
  })
  .catch((err) => {
    console.error("❌ Error durante la ejecución:", err);
    process.exit(1);
  });
