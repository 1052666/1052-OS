#!/usr/bin/env bash
# ═══════════════════════════════════════════════════════════════
# 1052-OS Industrial Agent — 一键部署脚本
# 适用: macOS / Linux / Windows(Git Bash/WSL)
#
# 用法:
#   ./deploy.sh              # 交互式部署
#   ./deploy.sh mac          # Mac 本地部署
#   ./deploy.sh pc <IP>      # PC 节点远程部署
#   ./deploy.sh docker       # Docker 容器部署
# ═══════════════════════════════════════════════════════════════

set -euo pipefail

RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; CYAN='\033[0;36m'; NC='\033[0m'
PROJECT_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
DEPLOY_DIR="$PROJECT_ROOT/deploy"
GATEWAY_DIR="$PROJECT_ROOT/gateway_python"
FRONTEND_DIR="$PROJECT_ROOT/frontend"
TD_VERSION="3.3.6.13"

banner() {
  echo -e "${CYAN}"
  echo "  ╔══════════════════════════════════════════╗"
  echo "  ║   1052-OS Industrial Agent 部署工具     ║"
  echo "  ║   Modbus · OPC UA · MQTT · TDengine    ║"
  echo "  ╚══════════════════════════════════════════╝"
  echo -e "${NC}"
}

check_ok() { echo -e "  ${GREEN}✓${NC} $1"; }
check_warn() { echo -e "  ${YELLOW}⚠${NC} $1"; }
check_err() { echo -e "  ${RED}✗${NC} $1"; exit 1; }

# ═══════════════════════════════════════════════════════════════
# Mac 本地部署
# ═══════════════════════════════════════════════════════════════
deploy_mac() {
  echo -e "${CYAN}[Mac 本地部署]${NC}\n"

  # 1. 检查 TDengine
  echo "▶ 检查 TDengine..."
  if docker ps --format '{{.Names}}' | grep -q "tdengine"; then
    check_ok "TDengine Docker 容器已运行"
  else
    check_warn "TDengine 未运行，尝试启动..."
    if ! command -v docker &>/dev/null; then
      check_err "Docker 未安装。请先: brew install colima docker && colima start"
    fi
    if ! docker info &>/dev/null; then
      check_warn "Docker daemon 未运行，尝试启动 colima..."
      colima start 2>/dev/null || check_err "无法启动 Docker。请手动: colima start"
    fi
    docker rm -f tdengine 2>/dev/null || true
    docker run -d --name tdengine \
      -p 6030:6030 -p 6041:6041 -p 6043:6043 \
      -v tdengine_data:/var/lib/taos \
      tdengine/tdengine:latest
    sleep 3
    check_ok "TDengine 已启动 (端口 6041)"
  fi

  # 2. 安装 Python 依赖
  echo "▶ 安装 Python 依赖..."
  cd "$GATEWAY_DIR"
  if [ ! -d ".venv" ]; then
    python3 -m venv .venv
  fi
  source .venv/bin/activate
  pip install uv -q 2>/dev/null || true
  uv sync 2>/dev/null || pip install fastapi uvicorn pymodbus asyncua paho-mqtt taos-ws-py
  check_ok "Python 依赖就绪"

  # 3. 构建前端
  echo "▶ 构建前端..."
  cd "$FRONTEND_DIR"
  if command -v npm &>/dev/null; then
    npm install --silent 2>/dev/null || true
    npx vite build 2>&1 | tail -1
    check_ok "前端构建完成"
  else
    check_warn "npm 未安装，跳过前端构建"
  fi

  # 4. 启动网关
  echo "▶ 启动工业网关..."
  cd "$GATEWAY_DIR"
  lsof -ti:8765 | xargs kill -9 2>/dev/null || true
  nohup .venv/bin/python -m uvicorn gateway.server:app \
    --host 0.0.0.0 --port 8765 \
    > "$DEPLOY_DIR/gateway.log" 2>&1 &
  sleep 2

  if curl -s http://127.0.0.1:8765/api/health > /dev/null 2>&1; then
    check_ok "工业网关已启动 (http://127.0.0.1:8765)"
  else
    check_err "网关启动失败，查看日志: $DEPLOY_DIR/gateway.log"
  fi

  echo -e "\n${GREEN}═══════════════════════════════════════${NC}"
  echo -e "${GREEN}  Mac 部署完成！${NC}"
  echo -e "  网关 API:  ${CYAN}http://127.0.0.1:8765${NC}"
  echo -e "  前端面板:  ${CYAN}http://127.0.0.1:5173/industrial-gateway${NC}"
  echo -e "  停止:      ${YELLOW}lsof -ti:8765 | xargs kill${NC}"
  echo -e "${GREEN}═══════════════════════════════════════${NC}"
}

# ═══════════════════════════════════════════════════════════════
# PC 节点远程部署
# ═══════════════════════════════════════════════════════════════
deploy_pc() {
  local PC_IP="${1:-192.168.1.25}"
  local SSH_KEY="$HOME/.ssh/id_ed25519_hermes_pc"

  echo -e "${CYAN}[PC 节点部署 → $PC_IP]${NC}\n"

  if [ ! -f "$SSH_KEY" ]; then
    check_err "SSH 密钥未找到: $SSH_KEY"
  fi

  SSH="ssh -i $SSH_KEY Administrator@$PC_IP"
  SCP="scp -i $SSH_KEY"

  # 1. 检查连接
  echo "▶ 检查 PC 连接..."
  if $SSH "echo ok" 2>/dev/null | grep -q ok; then
    check_ok "SSH 连接正常"
  else
    check_err "无法连接到 $PC_IP"
  fi

  # 2. 同步网关代码
  echo "▶ 同步网关代码..."
  $SSH "mkdir -p C:\\1052OS\\gateway_python\\gateway"
  for f in server.py modbus_client.py opcua_client.py mqtt_client.py \
           tdengine_client.py collector.py anomaly.py predictor.py reporter.py __init__.py; do
    $SCP "$GATEWAY_DIR/gateway/$f" "Administrator@$PC_IP:C:\\1052OS\\gateway_python\\gateway\\" 2>/dev/null
  done

  # 同步配置
  $SSH "mkdir -p C:\\1052OS\\deploy\\config"
  $SCP "$DEPLOY_DIR/config/"* "Administrator@$PC_IP:C:\\1052OS\\deploy\\config\\" 2>/dev/null || true

  # 同步 requirements
  cat > /tmp/1052os_requirements.txt << 'REQS'
fastapi>=0.115
uvicorn[standard]>=0.34
pymodbus>=3.7
asyncua>=1.1
paho-mqtt>=2.1
taos-ws-py>=0.6
pydantic>=2.0
REQS
  $SCP /tmp/1052os_requirements.txt "Administrator@$PC_IP:C:\\1052OS\\requirements.txt"

  check_ok "代码同步完成"

  # 3. PC 端安装 Python 依赖
  echo "▶ PC 端安装 Python 依赖..."
  $SSH "cd C:\\1052OS && python -m pip install -r requirements.txt -i https://pypi.tuna.tsinghua.edu.cn/simple" 2>&1 | tail -3 || check_warn "pip 安装部分失败，请手动检查"

  # 4. 检查 PC 端 Ollama
  echo "▶ 检查 PC 端 Ollama..."
  if $SSH "curl -s http://127.0.0.1:11434/api/tags" 2>/dev/null | grep -q "qwen"; then
    check_ok "Ollama 已运行 (qwen2.5:7b)"
  else
    check_warn "Ollama 未运行，启动中..."
    $SSH "start /B ollama serve" 2>/dev/null || true
  fi

  # 5. 启动 PC 端网关
  echo "▶ 启动 PC 端网关..."
  $SSH "taskkill /F /IM python.exe /FI \"WINDOWTITLE eq 1052os*\" 2>nul" 2>/dev/null || true
  $SSH "cd C:\\1052OS\\gateway_python && start /B python -m uvicorn gateway.server:app --host 0.0.0.0 --port 8765" 2>/dev/null

  sleep 3
  if curl -s "http://$PC_IP:8765/api/health" 2>/dev/null | grep -q '"ok"'; then
    check_ok "PC 网关已启动 (http://$PC_IP:8765)"
  else
    check_warn "PC 网关可能未启动，请手动检查"
  fi

  echo -e "\n${GREEN}═══════════════════════════════════════${NC}"
  echo -e "${GREEN}  PC 节点部署完成！${NC}"
  echo -e "  网关 API:  ${CYAN}http://$PC_IP:8765${NC}"
  echo -e "  Ollama:    ${CYAN}http://$PC_IP:11434${NC}"
  echo -e "${GREEN}═══════════════════════════════════════${NC}"
}

# ═══════════════════════════════════════════════════════════════
# Docker 容器部署
# ═══════════════════════════════════════════════════════════════
deploy_docker() {
  echo -e "${CYAN}[Docker 容器部署]${NC}\n"

  if ! command -v docker &>/dev/null; then
    check_err "Docker 未安装"
  fi

  cd "$DEPLOY_DIR"

  echo "▶ 构建前端..."
  cd "$FRONTEND_DIR" && npx vite build --outDir "$DEPLOY_DIR/frontend-dist" 2>&1 | tail -1

  echo "▶ 启动全栈容器..."
  cd "$DEPLOY_DIR"
  docker compose up -d --build

  sleep 5
  if docker compose ps | grep -q "Up"; then
    check_ok "全栈容器已启动"
    docker compose ps
  else
    check_err "容器启动失败"
  fi

  echo -e "\n${GREEN}═══════════════════════════════════════${NC}"
  echo -e "${GREEN}  Docker 部署完成！${NC}"
  echo -e "  前端:      ${CYAN}http://127.0.0.1:3000${NC}"
  echo -e "  网关 API:  ${CYAN}http://127.0.0.1:8765${NC}"
  echo -e "  停止:      ${YELLOW}docker compose down${NC}"
  echo -e "${GREEN}═══════════════════════════════════════${NC}"
}

# ═══════════════════════════════════════════════════════════════
# Main
# ═══════════════════════════════════════════════════════════════
banner

case "${1:-}" in
  mac)     deploy_mac ;;
  pc)      deploy_pc "${2:-192.168.1.25}" ;;
  docker)  deploy_docker ;;
  *)
    echo "用法:"
    echo "  ./deploy.sh mac           Mac 本地一键部署"
    echo "  ./deploy.sh pc [IP]       PC 节点远程部署 (默认 192.168.1.25)"
    echo "  ./deploy.sh docker        Docker 容器全栈部署"
    ;;
esac
