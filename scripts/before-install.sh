#!/bin/bash
set -e

echo "🧹 Limpiando directorio anterior..."
pm2 stop hotel-pricing || true

# Eliminar TODO el directorio
rm -rf /home/ubuntu/hotel-pricing || true
mkdir -p /home/ubuntu/hotel-pricing
chown -R ubuntu:ubuntu /home/ubuntu/hotel-pricing

echo "✅ Directorio limpiado"
