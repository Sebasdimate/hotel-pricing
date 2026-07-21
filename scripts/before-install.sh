#!/bin/bash
set -e

echo "🧹 Limpiando directorio anterior..."
pm2 stop hotel-pricing || true

# Eliminar todo menos node_modules (para no reinstalar)
cd /home/ubuntu/hotel-pricing 2>/dev/null || true
find . -maxdepth 1 -type f -delete || true
find . -maxdepth 1 -type d ! -name . ! -name node_modules -exec rm -rf {} + || true

echo "✅ Directorio limpiado"
