#!/bin/bash
set -e

echo "📦 Instalando dependencias..."
cd /home/ubuntu/hotel-pricing

# Instalar dependencias
npm install

# Generar Prisma client
npm run prisma:generate

# Compilar TypeScript
npm run build

echo "✅ Dependencias instaladas"
