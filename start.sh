#!/bin/sh
set -e

APP_PORT="${PORT:-7860}"

echo "Starting MediaMTX..."
sed "s|http://127.0.0.1:7860/|http://127.0.0.1:${APP_PORT}/|g" /app/mediamtx.yml > /tmp/mediamtx.yml
mediamtx /tmp/mediamtx.yml &
MEDIAMTX_PID=$!

# Wait for MediaMTX to be ready
sleep 2

echo "Starting Node.js app..."
exec node /app/server.js
