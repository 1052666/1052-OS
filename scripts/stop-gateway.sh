#!/bin/bash
# ============================================================
# Gateway 后端停止脚本
# 用法: ./scripts/stop-gateway.sh
# ============================================================

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"
PID_FILE="$PROJECT_ROOT/gateway_backend.pid"

if [ ! -f "$PID_FILE" ]; then
  echo "ℹ️  没有找到 PID 文件，可能服务未启动"
  exit 0
fi

PID=$(cat "$PID_FILE")

if ! kill -0 "$PID" 2>/dev/null; then
  echo "ℹ️  进程 $PID 已不在运行，清理 PID 文件"
  rm -f "$PID_FILE"
  exit 0
fi

echo "🛑 停止 Gateway 后端 (PID: $PID)..."
kill "$PID" 2>/dev/null

# 等待进程退出
TIMEOUT=10
COUNT=0
while kill -0 "$PID" 2>/dev/null; do
  sleep 1
  COUNT=$((COUNT + 1))
  if [ $COUNT -ge $TIMEOUT ]; then
    echo "⚠️  进程未响应，强制杀死..."
    kill -9 "$PID" 2>/dev/null
    break
  fi
done

rm -f "$PID_FILE"
echo "✅ Gateway 后端已停止"
