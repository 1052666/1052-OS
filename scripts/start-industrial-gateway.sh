#!/bin/bash
# 1052-OS Industrial Gateway — Start Script
# Launches Modbus REST API on port 8765

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
GATEWAY_DIR="$PROJECT_DIR/gateway_python"

cd "$GATEWAY_DIR"

if [ ! -d ".venv" ]; then
    echo "ERROR: virtualenv not found. Run: cd gateway_python && uv sync"
    exit 1
fi

echo "Starting 1052-OS Industrial Gateway on :8765 ..."
.venv/bin/python -c "
import uvicorn
uvicorn.run('gateway.server:app', host='0.0.0.0', port=8765, reload=False)
" &

echo $! > /tmp/1052-industrial-gateway.pid
echo "Gateway PID: $(cat /tmp/1052-industrial-gateway.pid)"
sleep 1
curl -s http://127.0.0.1:8765/api/health | python3 -m json.tool 2>/dev/null || echo "Waiting for startup..."
