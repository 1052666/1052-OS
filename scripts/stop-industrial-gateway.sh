#!/bin/bash
# 1052-OS Industrial Gateway — Stop Script

PID_FILE=/tmp/1052-industrial-gateway.pid

if [ -f "$PID_FILE" ]; then
    PID=$(cat "$PID_FILE")
    if kill -0 "$PID" 2>/dev/null; then
        kill "$PID"
        echo "Gateway (PID $PID) stopped."
    else
        echo "Gateway not running."
    fi
    rm -f "$PID_FILE"
else
    echo "No PID file found."
fi
