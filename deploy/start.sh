#!/bin/sh
set -e

echo "[1052-OS] Starting nginx..."
nginx

echo "[1052-OS] Starting backend on port ${PORT:-10053}..."
cd /app/backend
exec node dist/index.js
