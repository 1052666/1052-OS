# 1052 OS 工业网关与内置 Agent

1052 OS 是一套本地优先的 AI 工业工作台：前端提供统一操作界面，后端提供 Agent Runtime 和工具系统，工业网关负责协议采集、Node-RED 协议积木、TDengine 时序数据写入，内置 Agent 可以通过自然语言查询现场数据并做分析。

当前仓库适合用于：

- 在新电脑上部署完整 1052 OS
- 运行工业网关、Node-RED、TDengine、EMQX 等组件
- 使用 Node-RED 做 Modbus、MQTT、OPC UA、HJ212、DL/T645 等协议采集/仿真
- 在 1052 聊天界面用自然语言查询采集点、趋势、报警、写入审计、Node-RED 状态和 TDengine 表结构

---

## 一、系统组成

```text
1052-OS/
├── frontend/                 # React + Vite 前端
├── backend/                  # Express + TypeScript 后端与 Agent Runtime
├── gateway_python/           # Python 工业网关
│   ├── gateway/server.py     # 工业网关 API
│   ├── gateway/nodered_*     # Node-RED 运行时与流程生成
│   ├── gateway/drivers/      # Modbus / MQTT / OPC UA 驱动
│   └── tests/                # 工业网关测试
├── docs/                     # 协议流程、仿真平台、Node-RED 指南
├── deploy/                   # Docker 与一键部署脚本
└── scripts/                  # 本地启动/停止脚本
```

核心链路：

```text
浏览器 10055/10052
   ↓
1052 Frontend
   ↓
1052 Backend 10053
   ↓
Agent Runtime + industrial_* 工具
   ↓
Industrial Gateway 18765
   ↓
Node-RED 1882 / TDengine / EMQX / 现场协议设备
```

---

## 二、端口约定

| 服务 | 默认端口 | 说明 |
| --- | --- | --- |
| Frontend | `10055` 或 `10052` | 1052 Web 前端 |
| Backend | `10053` | 1052 后端 API 与 Agent |
| Industrial Gateway | `18765` | Python 工业网关 API |
| Node-RED | `1882` | 内嵌 Node-RED，由网关托管 |
| TDengine | `6030` / `6041` | 时序数据库 |
| EMQX/MQTT | `1883` | MQTT Broker |

工业网关页面：

```text
http://127.0.0.1:10055/industrial-gateway
```

Node-RED 编辑器入口：

```text
http://127.0.0.1:10055/industrial-gateway/nodered/
```

Node-RED Dashboard 预览：

```text
http://127.0.0.1:10055/industrial-gateway/nodered/dashboard/1052-debug
```

---

## 三、快速部署到新电脑

### 1. 克隆仓库

```bash
git clone https://github.com/Easononon/gkzzzs.git
cd gkzzzs
```

### 2. 安装基础依赖

需要提前安装：

- Git
- Node.js 20+
- npm 10+
- Python 3.10+
- `uv`
- Docker Desktop / Colima（二选一，用于 TDengine、EMQX 等容器服务）

macOS 可参考：

```bash
brew install node python uv git
```

### 3. 安装前后端依赖

```bash
cd backend
npm install

cd ../frontend
npm install
```

### 4. 安装工业网关依赖

```bash
cd ../gateway_python
uv sync
```

### 5. 启动基础容器

如果使用 Docker Compose：

```bash
cd ..
docker compose -f deploy/docker-compose.yml up -d
```

如果只想先启动 TDengine，也可以单独运行：

```bash
docker run -d --name tdengine \
  -p 6030:6030 \
  -p 6041:6041 \
  -p 6043:6043 \
  tdengine/tdengine:latest
```

### 6. 启动 1052 后端

```bash
cd backend
npm run dev
```

默认地址：

```text
http://127.0.0.1:10053
```

### 7. 启动工业网关

另开一个终端：

```bash
cd gateway_python
uv run uvicorn gateway.server:app --host 0.0.0.0 --port 18765
```

也可以使用脚本：

```bash
./scripts/start-industrial-gateway.sh
```

### 8. 启动前端

另开一个终端：

```bash
cd frontend
VITE_GATEWAY_TARGET=http://127.0.0.1:18765 npm run dev -- --host 0.0.0.0 --port 10055
```

打开：

```text
http://127.0.0.1:10055
```

---

## 四、LLM 与 Agent 配置

1052 内置 Agent 需要在设置页配置可用的大模型：

- Base URL 必须带 `/v1` 后缀
- API Key 不要写入 Git
- 可以在设置页配置任务级模型路由

运行时配置、聊天历史、记忆、Wiki、资源等数据默认存放在：

```text
data/
```

`data/` 已被 `.gitignore` 排除，不应该提交到 GitHub。

---

## 五、工业网关能力

工业网关提供以下能力：

- Modbus TCP/RTU 采集
- MQTT 订阅与写入
- OPC UA 采集
- Node-RED 内嵌运行时
- Protocol Library 协议积木库
- TDengine 写入、查询、聚合、表结构查看
- 异常/报警历史
- 写入/控制审计
- 采集器状态查询

常用 API：

| API | 说明 |
| --- | --- |
| `GET /api/health` | 网关健康检查 |
| `GET /api/tags` | 采集点位列表 |
| `GET /api/td/tables` | TDengine 表列表 |
| `GET /api/td/query` | 原始时序查询 |
| `GET /api/td/aggregate` | 聚合趋势查询 |
| `GET /api/anomaly/history` | 报警/异常历史 |
| `GET /api/collector/status` | 采集状态 |
| `GET /api/nodered/runtime` | Node-RED 运行状态 |
| `GET /api/audit/writes` | 写入/控制审计 |

---

## 六、Node-RED 协议积木

在工业网关页面点击：

```text
CONFIGURE → Node-RED → 协议积木库
```

可以安装协议模板，例如：

- HJ212-2017
- HJ212-2025
- DL/T645-2007
- MQTT 数据集成
- EtherNet/IP
- 三菱 MC
- 欧姆龙 FINS
- 1052 Debug Dashboard

安装后可以在 Node-RED 编辑器中查看和修改流程。

---

## 七、1052 Agent 查询工业数据

Agent 已内置 `industrial_*` 只读工具。用户可以在 1052 聊天界面直接问：

```text
工业网关现在有哪些采集点？
Node-RED 现在运行正常吗？
TDengine 里有哪些表？
最近有哪些异常？
今天报警多少次，报警时间分别是什么？
过去 2 小时粉尘浓度趋势怎么样？
最近 24 小时有没有写入或控制操作？
```

Agent 的回答会优先采用：

```text
结论 → 数据依据 → 可能原因 → 建议 → 不确定性/需要现场确认项
```

安全边界：

- Agent 工业工具只读
- 不通过聊天执行启动设备、停止设备、修改设定值、复位报警等控制动作
- 控制类动作必须走人工确认和专门控制流程

---

## 八、文档与示例

| 路径 | 说明 |
| --- | --- |
| `deploy/README.md` | 工业 Agent 运维手册 |
| `docs/nodered-embedded-integration.md` | Node-RED 嵌入集成说明 |
| `docs/hj212-nodered-guide.md` | HJ212-2017 Node-RED 指南 |
| `docs/hj212-2025-nodered-guide.md` | HJ212-2025 Node-RED 指南 |
| `docs/dust-explosion-nodered-v1.1-guide.md` | 粉尘涉爆接口对接指南 |
| `docs/data-integration-nodered-guide.md` | 数据对接 Node-RED 指南 |
| `docs/*-mock-platform.py` | 协议仿真平台 |
| `docs/*-nodered-flow.json` | Node-RED 流程模板 |

---

## 九、安全与敏感信息

不要提交以下内容：

- `.env` / `.env.*`
- GitHub token
- LLM API Key
- 摄像头账号密码
- EMQX / TDengine 生产密码
- 客户现场真实 DCS 数据
- `data/` 运行时目录
- `__pycache__`、`.DS_Store`、日志和临时文件

摄像头、平台账号等信息请使用环境变量或前端配置管理。

如果 token 已经在聊天、日志或命令行中暴露过，建议去 GitHub 立即撤销并重新生成。

---

## 十、常见排错

### 1. 工业网关打不开

检查端口：

```bash
curl http://127.0.0.1:18765/api/health
```

### 2. Node-RED iframe 空白

检查：

```bash
curl http://127.0.0.1:18765/api/nodered/runtime
```

如果 `running` 不是 `true`，重启工业网关或 Node-RED runtime。

### 3. 前端访问工业网关 502

确认前端启动时指定了正确代理：

```bash
VITE_GATEWAY_TARGET=http://127.0.0.1:18765 npm run dev -- --host 0.0.0.0 --port 10055
```

### 4. Agent 聊天 429

这通常是 LLM 服务额度或限流问题，不是工业网关代码问题。等额度恢复或切换任务级模型路由即可。

### 5. TDengine 没有数据

检查：

```bash
curl http://127.0.0.1:18765/api/td/tables
curl http://127.0.0.1:18765/api/collector/status
```

---

## 十一、常用命令

后端：

```bash
cd backend
npm run dev
npm run build
```

前端：

```bash
cd frontend
npm run dev
npm run build
```

工业网关：

```bash
cd gateway_python
uv sync
uv run uvicorn gateway.server:app --host 0.0.0.0 --port 18765
```

脚本：

```bash
./scripts/start-industrial-gateway.sh
./scripts/stop-industrial-gateway.sh
```

Git 推送：

```bash
git status
git add <明确文件>
git commit -m "message"
git push origin main
```

---

## 十二、部署建议

如果要把 1052 整套部署到其他电脑，推荐流程是：

1. 新电脑安装 Docker、Node.js、Python、uv
2. `git clone https://github.com/Easononon/gkzzzs.git`
3. 安装前后端依赖和网关依赖
4. 启动 TDengine / EMQX
5. 启动 backend、gateway、frontend
6. 在设置页配置 LLM
7. 打开 `/industrial-gateway` 验证 Node-RED、协议积木和采集状态

生产环境建议后续把启动流程收敛到 `deploy/docker-compose.yml` 或系统服务中，避免手工开多个终端。
