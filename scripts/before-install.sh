#!/bin/bash
set -e

echo "🧹 Limpiando directorio anterior..."
pm2 stop hotel-pricing || true
sleep 2

# Eliminar TODO el directorio
rm -rf /home/ubuntu/hotel-pricing || true

echo "✅ Directorio limpiado"
