# 1052 - AI 助手

本地部署的多平台 AI 助手，支持 Web、Telegram、飞书、微信，集成 MCP 工具协议和定时任务。

## 快速开始

```bash
# 安装依赖
pip install -r requirements.txt

# 启动服务
python server.py
# 访问 http://localhost:8000
```

## 项目结构

```
1052/
├── server.py              # FastAPI 入口，启动所有服务
├── requirements.txt       # 全部依赖
├── core/                  # 核心模块
│   ├── config.py              配置管理（API Key、对话历史、系统提示词）
│   ├── chat_engine.py         AI 聊天引擎（流式输出、工具调用）
│   ├── tools.py               内置工具（定时任务、记忆管理、文件操作等）
│   ├── skill_manager.py       技能插件管理器（热加载）
│   ├── scheduler.py           定时任务调度器
│   └── health_monitor.py      健康监控与告警
├── mcp_client/            # MCP 客户端
│   ├── manager.py             MCP 服务器连接管理
│   └── router.py              MCP 相关 API 路由
├── im_integration/        # IM 平台集成
│   ├── manager.py             统一管理（Telegram / 飞书 / 微信）
│   ├── telegram_bot.py        Telegram 机器人
│   ├── lark_bot.py            飞书机器人
│   ├── wechat_bot.py          微信机器人（调用 wx/ 模块）
│   └── evolution.py           进化模式（自主改进）
├── routers/               # API 路由
│   ├── chat.py                /api/chat  聊天接口
│   ├── config.py              /api/config 配置接口
│   ├── skills.py              /api/skills 技能接口
│   ├── scheduler.py           /api/scheduler 定时任务接口
│   └── im.py                  /api/im IM 状态接口
├── wx/                    # 微信自动化模块（独立子模块）
│   ├── wechat_msg.py          统一收发消息接口
│   ├── pyweixin/              微信 4.1+ 底层引擎
│   ├── pywechat/              微信 3.9+ 底层引擎
│   └── README.md              微信模块详细文档
├── skills/                # 技能插件目录
├── static/                # 前端静态文件
└── data/                  # 数据目录
    ├── config.json            全局配置
    ├── conversation.json      对话历史
    ├── system_prompt.md       系统提示词
    └── mcp_servers.json       MCP 服务器配置
```

## 配置说明

编辑 `data/config.json`：

```json
{
  "api_key": "your-api-key",
  "model": "gpt-4",
  "temperature": 0.7,
  "im": {
    "telegram": {
      "enabled": true,
      "token": "your-telegram-bot-token"
    },
    "lark": {
      "enabled": false,
      "app_id": "",
      "app_secret": ""
    },
    "wechat": {
      "enabled": false,
      "primary_chat": "",
      "bot_name": "",
      "mention_pattern": ""
    }
  }
}
```

## 功能模块

### Web 聊天

启动后访问 `http://localhost:8000`，提供流式聊天界面。

### Telegram 机器人

配置 `im.telegram` 后自动启动，支持：
- 私聊 / 群聊对话
- 工具调用
- 文件发送

### 飞书机器人

配置 `im.lark` 后自动启动。

### 微信机器人

配置 `im.wechat` 后自动启动，支持：
- 主窗口监听（指定好友/群聊）
- 群聊 @触发
- 消息收发与文件发送
- 与 AI 聊天引擎集成

详细文档见 [wx/README.md](wx/README.md)。

### MCP 工具

通过 `data/mcp_servers.json` 配置 MCP 服务器，AI 可调用外部工具。

### 定时任务

通过 API 或配置文件创建定时任务（cron 表达式）。

### 技能插件

将 Python 文件放入 `skills/` 目录自动加载，支持热更新。

## API 接口

| 路径 | 说明 |
|------|------|
| `GET /` | 聊天页面 |
| `POST /api/chat` | 流式聊天 |
| `GET /api/config` | 获取配置 |
| `POST /api/config` | 更新配置 |
| `GET /api/skills` | 技能列表 |
| `POST /api/skills/reload` | 重载技能 |
| `GET /api/scheduler/tasks` | 定时任务列表 |
| `POST /api/scheduler/tasks` | 创建定时任务 |
| `GET /api/im/status` | IM 平台状态 |
| `GET /health` | 健康检查 |

## 环境要求

- Python 3.9+
- Windows 10/11（微信自动化需要）
- 已登录 PC 微信（微信机器人需要）
