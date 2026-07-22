#!/bin/bash
set -e

echo "📦 Instalando dependencias..."
cd /home/ubuntu/hotel-pricing

# Arreglar permisos después de descargar código de CodeDeploy
sudo chown -R ubuntu:ubuntu /home/ubuntu/hotel-pricing

# Limpiar dist anterior para forzar recompilación limpia
rm -rf dist/

# Instalar todas las dependencias (incluyendo devDependencies para compilación)
npm ci

# Generar Prisma client
npm run prisma:generate

# Compilar TypeScript
npm run build

# Verificar que los archivos críticos fueron compilados
REQUIRED_FILES=(
  "dist/index.js"
  "dist/services/pricingService.js"
  "dist/services/gapNightsRules.js"
  "dist/jobs/pricingJob.js"
)

MISSING_FILES=()
for file in "${REQUIRED_FILES[@]}"; do
  if [ ! -f "$file" ]; then
    MISSING_FILES+=("$file")
  fi
done

if [ ${#MISSING_FILES[@]} -gt 0 ]; then
  echo "❌ ERROR: Los siguientes archivos compilados no existen:"
  for file in "${MISSING_FILES[@]}"; do
    echo "  - $file"
  done
  exit 1
fi

echo "✅ Compilación exitosa - todos los archivos requeridos existen"
