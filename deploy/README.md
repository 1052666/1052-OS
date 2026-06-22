# 1052-OS Industrial Agent 运维手册

> 版本 1.0 · 最后更新 2026-06-13

## 系统架构

```
┌──────────────┐   Modbus TCP    ┌─────────────────┐
│  DCS 控制器   │ ──────────────→ │  Industrial      │
│  (K/FM系列)  │ ←────────────── │  Gateway :8765   │
└──────────────┘                 │  ┌─────────────┐ │
                                 │  │ 异常检测引擎 │ │
┌──────────────┐   OPC UA        │  │ 趋势预测引擎 │ │
│  OPC Server  │ ──────────────→ │  │ 智能报告引擎 │ │
└──────────────┘                 │  └──────┬──────┘ │
                                 └─────────┼────────┘
                                           │ WebSocket
                                 ┌─────────▼────────┐
                                 │  TDengine :6041  │
                                 │  时序数据库       │
                                 └──────────────────┘
```

## 快速启动

### Mac

```bash
# 1. 启动 Docker + TDengine
colima start
docker run -d --name tdengine -p 6030:6030 -p 6041:6041 -p 6043:6043 tdengine/tdengine:latest

# 2. 启动网关
cd gateway_python
uv sync
uv run uvicorn gateway.server:app --host 0.0.0.0 --port 8765

# 3. 打开前端
# http://127.0.0.1:5173/industrial-gateway
```

### PC 节点 (Windows)

```powershell
# SSH 登录后
cd C:\1052OS\gateway_python
python -m uvicorn gateway.server:app --host 0.0.0.0 --port 8765
```

### 一键部署

```bash
./deploy/deploy.sh mac       # Mac 部署
./deploy/deploy.sh pc        # PC 远程部署
./deploy/deploy.sh docker    # Docker 全栈部署
```

## 核心接口

| 端点 | 说明 |
|------|------|
| `GET /api/health` | 全栈健康检查 |
| `POST /api/td/connect` | 连接 TDengine |
| `POST /api/modbus/connect` | 连接 Modbus |
| `POST /api/anomaly/scan` | 异常检测扫描 |
| `GET /api/predict/trend` | 趋势预测 |
| `GET /api/predict/ttl` | 超限倒计时 |
| `POST /api/report/generate` | 生成分析报告 |

## 场景配置

1. 复制配置模板: `cp deploy/config/k-series-template.json deploy/config/config.json`
2. 修改 `modbus.host` 为实际 DCS IP
3. 修改 `anomaly_channels` 为实际通道列表
4. 重启网关

## 常见排错

### TDengine 连接失败
```bash
docker ps | grep tdengine          # 检查容器运行
curl http://127.0.0.1:6041         # 检查端口
docker restart tdengine            # 重启
```

### Modbus 无法连接
- 检查 DCS 控制器 IP 和端口
- 确认防火墙放行 502 端口
- 检查站号 (unit_id) 是否正确
- 测试: `curl -X POST http://127.0.0.1:8765/api/modbus/ping`

### 网关端口冲突
```bash
lsof -ti:8765 | xargs kill         # Mac
netstat -ano | findstr 8765        # Windows 查找占用
```

### 数据不入库
1. 确认 TDengine 已连接: `GET /api/td/ping`
2. 确认采集任务运行: `GET /api/collector/status`
3. 手动写测试: `POST /api/td/write`

## 备份与恢复

### TDengine 数据备份
```bash
docker exec tdengine taosdump -o /backup industrial
docker cp tdengine:/backup ./backup_$(date +%Y%m%d)
```

### 配置文件备份
```bash
tar czf 1052os-backup-$(date +%Y%m%d).tar.gz deploy/config/ gateway_python/gateway/*.py
```

### 恢复
```bash
docker exec -i tdengine taosdump -i /backup
tar xzf 1052os-backup-*.tar.gz
```

## 性能调优

| 场景 | 建议 |
|------|------|
| 通道 < 50 | 默认配置即可，采集间隔 1s |
| 通道 50-200 | 采集间隔 5s，drift_window 30 |
| 通道 > 200 | 采集间隔 10s，PC 端部署(性能更好) |

## 目录结构

```
1052-OS/
├── deploy/                  # 部署物
│   ├── deploy.sh            # 一键部署脚本
│   ├── docker-compose.yml   # Docker 编排
│   ├── Dockerfile.gateway   # 网关容器
│   ├── config/              # 场景配置模板
│   │   ├── k-series-template.json
│   │   └── fm-series-template.json
│   └── README.md            # 本文档
├── gateway_python/          # 工业网关
│   ├── gateway/
│   │   ├── server.py        # REST API (端口 8765)
│   │   ├── modbus_client.py # Modbus TCP/RTU
│   │   ├── opcua_client.py  # OPC UA
│   │   ├── mqtt_client.py   # MQTT
│   │   ├── tdengine_client.py # TDengine
│   │   ├── anomaly.py       # 异常检测
│   │   ├── predictor.py     # 趋势预测
│   │   └── reporter.py      # 智能报告
│   └── pyproject.toml
└── frontend/                # React 前端
    └── src/pages/
        └── IndustrialGateway.tsx  # 工业面板 (7 Tab)
```
