#!/bin/bash
set -e

echo "🚀 Iniciando bot de pricing..."
cd /home/ubuntu/hotel-pricing

# Compilar TypeScript si es necesario
npm run build || true

# Iniciar con PM2
pm2 restart hotel-pricing || pm2 start dist/index.js --name "hotel-pricing"

echo "✅ Bot iniciado"
