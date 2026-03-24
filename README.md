# 1052 助理

> 一个由 [黎夏](https://github.com/1052666) 开发的智能 AI 聊天机器人，支持 Web 界面、Telegram、飞书等多平台接入

[![Python](https://img.shields.io/badge/Python-3.8+-blue.svg)](https://www.python.org/)
[![FastAPI](https://img.shields.io/badge/FastAPI-0.100+-green.svg)](https://fastapi.tiangolo.com/)
[![License](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

---

## 功能特性

### 核心能力

- **多平台聊天**：提供 Web 界面，同时支持 Telegram 机器人和飞书机器人
- **流式输出**：实时显示 AI 回复，支持 Markdown 渲染和代码高亮
- **多模型支持**：OpenAI GPT-4o/GPT-4o Mini/DeepSeek/Moonshot/GLM-4 等
- **技能系统 (Skills)**：可热加载的技能扩展机制，随添随用无需重启
- **MCP 支持**：通过 Model Context Protocol 连接外部工具服务器
- **定时任务**：支持 Cron 表达式/每日/间隔/一次性任务，自动执行并推送结果
- **进化模式**：开启后 AI 将自主思考并执行任务，每 30 分钟运行一次

### Web 界面功能

- 实时流式对话
- 系统提示词编辑
- 模型参数配置（温度、Token 上限等）
- 技能管理（查看、重载）
- 定时任务管理（创建、编辑、删除、查看历史）
- MCP 服务器配置

### Telegram 机器人功能

- `/start` - 启动机器人
- `/1052` - 显示命令菜单
- `/help` - 查看帮助
- `/new` - 新建对话
- `/evolve` - 开启进化模式
- 支持发送图片、文件、音频、视频、语音消息

### 飞书机器人功能

- 支持事件订阅和回调模式
- 长连接模式支持
- 消息加解密配置

---

## 系统架构

```
1052-robot/
├── server.py              # 主入口，FastAPI 应用
├── core/                  # 核心模块
│   ├── config.py          # 配置管理
│   ├── skill_manager.py  # 技能管理器（热加载）
│   ├── scheduler.py       # 定时任务调度器
│   └── tools.py           # 内置工具集
├── routers/               # API 路由
│   ├── chat.py            # 聊天接口
│   ├── config.py          # 配置接口
│   ├── skills.py          # 技能接口
│   ├── scheduler.py       # 定时任务接口
│   ├── im.py              # IM 平台接口
│   └── mcp.py             # MCP 服务器接口
├── mcp_client/            # MCP 客户端
│   ├── manager.py         # MCP 连接管理器
│   ├── router.py          # MCP API 路由
│   └── servers/           # 自定义 MCP 服务器示例
├── im_integration/        # IM 平台集成
│   ├── manager.py         # IM 管理器
│   ├── telegram_bot.py    # Telegram 机器人
│   ├── lark_bot.py        # 飞书机器人
│   └── evolution.py       # 进化模式管理器
├── skills/                # 技能目录
│   ├── web-search/        # 网页搜索技能
│   ├── im-integration/    # IM 集成技能
│   ├── create-skill/      # 创建技能指南
│   └── skill-evolve/      # 技能进化
├── static/                # 前端静态文件
│   ├── index.html         # 主页面
│   ├── css/app.css        # 样式
│   └── js/                # JavaScript 模块
├── data/                  # 数据目录
│   ├── config.json        # 用户配置
│   ├── system_prompt.md   # 系统提示词
│   ├── mcp_servers.json   # MCP 服务器配置
│   ├── tasks.json         # 定时任务配置
│   ├── preferences.md     # 用户偏好
│   └── tasks/            # 任务执行上下文
├── static/                # 静态文件
├── requirements.txt       # Python 依赖
└── README.md              # 本文件
```

---

## 快速开始

### 环境要求

- Python 3.8+
- OpenAI API Key（或兼容 API）

### 安装

1. **克隆项目**

```bash
https://github.com/1052666/1052.git
cd 1052
```

2. **安装依赖**

```bash
pip install -r requirements.txt
```

3. **配置**

编辑 `data/config.json` 或通过 Web 界面配置：

```json
{
  "api_key": "your-api-key",
  "base_url": "https://api.openai.com/v1",
  "model": "gpt-4o-mini"
}
```

4. **启动服务器**

```bash
python server.py
```

5. **访问**

- Web 界面：http://localhost:8000
- API 文档：http://localhost:8000/docs

---

## 配置说明

### 基础配置 (data/config.json)

| 配置项 | 说明 | 默认值 |
|--------|------|--------|
| `api_key` | OpenAI API 密钥 | - |
| `base_url` | API 地址 | `https://api.openai.com/v1` |
| `model` | 使用的模型 | `gpt-4o-mini` |
| `temperature` | 温度参数 | `0.7` |
| `max_tokens` | 最大 Token 数 | `32768` |

### 系统提示词 (data/system_prompt.md)

定义机器人的角色和行为。首次启动会自动创建默认提示词。

### MCP 服务器配置 (data/mcp_servers.json)

支持 stdio 和 SSE 两种传输协议：

```json
{
  "mcpServers": {
    "my-server": {
      "transport": "stdio",
      "command": "python",
      "args": ["path/to/server.py"]
    }
  }
}
```

### IM 平台配置

#### Telegram

1. 在 Telegram 创建机器人，获取 Bot Token
2. 在 Web 界面的「IM 集成」设置中填入 Token 并启用

#### 飞书

1. 在飞书开放平台创建企业自建应用
2. 获取 App ID 和 App Secret
3. 配置加密密钥和验证令牌（可选）

---

## 技能系统

### 创建技能

在 `skills/` 目录下创建技能文件夹，放入 `SKILL.md` 文件：

```markdown
---
name: my-skill
description: 这是我的技能说明
---
# 技能标题

这里写技能的详细指令和说明...
```

### 内置技能

| 技能 | 说明 |
|------|------|
| `web-search` | 网页搜索 |
| `im-integration` | IM 集成辅助 |
| `skill-evolve` | 技能进化 |

技能会在启动时自动加载，也支持热重载——修改 SKILL.md 后无需重启服务。

---

## 定时任务

### 调度表达式格式

| 格式 | 说明 | 示例 |
|------|------|------|
| `daily:HH:MM` | 每日定时 | `daily:09:00` |
| `interval:N` | 间隔执行（分钟） | `interval:30` |
| `cron:* * * * *` | Cron 表达式 | `cron:0 9 * * 1` |
| `once:ISO时间` | 一次性任务 | `once:2024-12-31T09:00:00` |

### 创建定时任务

通过 Web 界面或调用 API：

```bash
curl -X POST http://localhost:8000/api/scheduler/tasks \
  -H "Content-Type: application/json" \
  -d '{
    "name": "早报摘要",
    "prompt": "请总结今日科技新闻...",
    "schedule": "daily:09:00",
    "platform": "telegram",
    "user_id": "123456789"
  }'
```

---

## 进化模式

开启进化模式后，AI 将进入自主思考状态，每 30 分钟自动执行有意义的思考和行动。

**启动方式：**
- Web 界面：点击侧边栏的「/1052进化」
- Telegram：发送 `/evolve` 命令

**退出方式：** 发送任意消息即可退出

---

## API 接口

### 聊天

```
POST /api/chat
Content-Type: application/json

{
  "messages": [{"role": "user", "content": "你好"}]
}
```

流式响应：
```
POST /api/chat/stream
```

### 配置

```
GET  /api/config        # 获取配置
PUT  /api/config        # 更新配置
```

### 技能

```
GET  /api/skills        # 列出所有技能
POST /api/skills/reload # 重载技能
```

### 定时任务

```
GET    /api/scheduler/tasks      # 列出任务
POST   /api/scheduler/tasks      # 创建任务
PUT    /api/scheduler/tasks/{id} # 更新任务
DELETE /api/scheduler/tasks/{id} # 删除任务
GET    /api/scheduler/tasks/{id}/context  # 查看执行历史
```

### MCP

```
GET  /api/mcp/servers           # 列出 MCP 服务器
POST /api/mcp/servers/reload    # 重连所有服务器
```

### IM

```
GET  /api/im/status    # 查看 IM 连接状态
POST /api/im/reload    # 重载 IM 配置
```

---

## 开发指南

### 添加新的 IM 平台

1. 在 `im_integration/` 目录创建新的机器人类
2. 实现 `start()`, `stop()`, `chat_handler` 接口
3. 在 `IMManager` 中注册

### 添加内置工具

在 `core/tools.py` 的 `BUILTIN_TOOLS` 列表中添加新的工具定义。

### 运行测试

```bash
# 后续版本将添加单元测试
pytest tests/
```

---

## 常见问题

**Q: 启动失败，提示缺少依赖？**
> 确保已安装 requirements.txt 中的所有依赖

**Q: Telegram 机器人无法连接？**
> 检查 Bot Token 是否正确，网络是否可达

**Q: 定时任务没有执行？**
> 检查任务是否启用，以及调度表达式是否正确

**Q: 技能没有加载？**
> 确认 SKILL.md 格式正确，包含 name 和 description

---

## 许可证

本项目采用 MIT 许可证 - 详见 [LICENSE](LICENSE) 文件

---

## 联系方式

- 作者：黎夏
- GitHub：https://github.com/1052666
- GitHub：lixia20250619

---

> 💡 **提示**：首次使用请先配置 API Key。支持 OpenAI API 以及兼容其接口的其他大模型服务。
