#!/bin/bash
# ============================================================
# Gateway 后端启动脚本
# 用法: ./scripts/start-gateway.sh
# ============================================================
set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"
BACKEND_DIR="$PROJECT_ROOT/backend"
PID_FILE="$PROJECT_ROOT/gateway_backend.pid"
LOG_FILE="$PROJECT_ROOT/logs/gateway.log"

# 创建日志目录
mkdir -p "$(dirname "$LOG_FILE")"

# 如果已有 PID 文件，先检查进程是否还在运行
if [ -f "$PID_FILE" ]; then
  OLD_PID=$(cat "$PID_FILE")
  if kill -0 "$OLD_PID" 2>/dev/null; then
    echo "⚠️  Gateway 后端已在运行 (PID: $OLD_PID)"
    echo "$OLD_PID" > "$PID_FILE"
    exit 0
  else
    echo "🧹 清理旧的 PID 文件 (stale PID: $OLD_PID)"
    rm -f "$PID_FILE"
  fi
fi

# 切换到后端目录并启动
echo "🚀 启动 Gateway 后端..."
cd "$BACKEND_DIR"

# 后台启动，输出重定向到日志
nohup pnpm run dev > "$LOG_FILE" 2>&1 &
NEW_PID=$!

# 保存 PID
echo "$NEW_PID" > "$PID_FILE"

# 等待进程启动
sleep 3

if kill -0 "$NEW_PID" 2>/dev/null; then
  echo "✅ Gateway 后端启动成功"
  echo "   PID: $NEW_PID"
  echo "   日志: $LOG_FILE"
  echo "   PID 文件: $PID_FILE"
else
  echo "❌ Gateway 后端启动失败，请检查日志:"
  echo "   tail -f $LOG_FILE"
  rm -f "$PID_FILE"
  exit 1
fi
