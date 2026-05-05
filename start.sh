#!/bin/sh
set -e

echo "Starting MediaMTX..."
mediamtx /app/mediamtx.yml &
MEDIAMTX_PID=$!

# Wait for MediaMTX to be ready
sleep 2

echo "Starting Node.js app..."
exec node /app/server.js
