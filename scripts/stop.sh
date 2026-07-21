#!/bin/bash
set -e

echo "⏹️  Deteniendo bot de pricing..."
cd /home/ubuntu/hotel-pricing

# Detener PM2
pm2 stop hotel-pricing || true

echo "✅ Bot detenido"
