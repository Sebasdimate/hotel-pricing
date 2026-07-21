#!/bin/bash
set -e

echo "📦 Instalando dependencias..."
cd /home/ubuntu/hotel-pricing

# Instalar dependencias
npm install

# Generar Prisma client
npm run prisma:generate

echo "✅ Dependencias instaladas"
