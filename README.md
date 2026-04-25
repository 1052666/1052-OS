<p align="center">
  <a href="https://github.com/1052666/1052-OS">
    <img src="./assets/readme/hero.svg" alt="1052 OS" />
  </a>
</p>

<h1 align="center">1052 OS</h1>

<p align="center">
  中文 | <a href="./README.en.md">English</a>
</p>

<p align="center">
  <strong>本地优先、工具驱动、可接入社交通道的个人 AI Agent 工作台。</strong>
</p>

<p align="center">
  由一名学生开发者持续设计、开发与迭代。
</p>

<p align="center">
  <a href="https://github.com/1052666/1052-OS/stargazers"><img alt="GitHub stars" src="https://img.shields.io/github/stars/1052666/1052-OS?style=for-the-badge&logo=github" /></a>
  <a href="https://github.com/1052666/1052-OS/network/members"><img alt="GitHub forks" src="https://img.shields.io/github/forks/1052666/1052-OS?style=for-the-badge&logo=github" /></a>
  <a href="https://github.com/1052666/1052-OS/graphs/contributors"><img alt="Contributors" src="https://img.shields.io/github/contributors/1052666/1052-OS?style=for-the-badge" /></a>
  <a href="./LICENSE"><img alt="License" src="https://img.shields.io/github/license/1052666/1052-OS?style=for-the-badge" /></a>
</p>

<p align="center">
  <img alt="TypeScript" src="https://img.shields.io/badge/TypeScript-5.x-3178c6?style=flat-square&logo=typescript&logoColor=white" />
  <img alt="React" src="https://img.shields.io/badge/React-18-149eca?style=flat-square&logo=react&logoColor=white" />
  <img alt="Vite" src="https://img.shields.io/badge/Vite-5-646cff?style=flat-square&logo=vite&logoColor=white" />
  <img alt="Express" src="https://img.shields.io/badge/Express-4-111827?style=flat-square&logo=express&logoColor=white" />
  <img alt="Node.js" src="https://img.shields.io/badge/Node.js-20+-339933?style=flat-square&logo=node.js&logoColor=white" />
</p>

---

## 加入社区

<table>
  <tr>
    <td width="280" valign="top">
      <img src="./assets/readme/wechat-group-qr.jpg" alt="1052 OS 微信群二维码" width="260" />
    </td>
    <td valign="top">
      <h3>交流、反馈、测试和共建</h3>
      <p><strong>Telegram 群组：</strong><a href="https://t.me/OS1052">https://t.me/OS1052</a></p>
      <p><strong>微信群：</strong>扫描左侧二维码加入 <code>1052内测测测群</code></p>
      <p>欢迎提交 Bug、体验反馈、功能建议、PR、Skill、工具方案和真实使用案例。</p>
      <p><strong>GitHub 仓库：</strong><a href="https://github.com/1052666/1052-OS">https://github.com/1052666/1052-OS</a></p>
    </td>
  </tr>
</table>

---

## 项目状态

1052 OS 已经从聊天页面演进成一个桌面式 AI Agent 工作台。它把模型接入、聊天流、本地文件、仓库阅读、笔记、资源库、长期记忆、输出配方、Wiki 知识层、联网搜索、UAPIs 工具箱、Skill 中心、终端、SQL、日程、定时任务、通知中心、微信、飞书和企业微信放在同一个本地优先的系统里。

项目当前的核心方向是：

- 让 Agent 能接触真实工作区，而不是只在聊天框里回答。
- 通过渐进披露工具包控制上下文和工具暴露，避免一次性塞入过多能力。
- 用权限模式区分只读检查、写入操作、终端执行和外部投递。
- 把长期偏好、敏感信息、输出风格、知识素材和 Wiki 沉淀拆成不同层次管理。
- 让网页聊天、定时任务、微信、飞书等入口共享同一套 Agent 能力。
- 让运行时数据默认留在本地 `data/`，用户可以看见并控制关键配置。

---

## 项目预览

<table>
  <tr>
    <td width="50%" valign="top">
      <img src="./assets/readme/preview-chat.svg" alt="Chat workspace preview" />
      <br />
      <strong>Chat Workspace</strong>
      <br />
      流式输出、思考折叠、Markdown、Mermaid、数学公式、上下文压缩、Token 统计、失败上下文过滤和统一聊天历史。
    </td>
    <td width="50%" valign="top">
      <img src="./assets/readme/preview-files.svg" alt="Files and resources preview" />
      <br />
      <strong>Files, Notes, Resources</strong>
      <br />
      本地文件增删查改、按行修改、仓库阅读、笔记目录管理、资源卡片、Agent 工作区和可上传素材。
    </td>
  </tr>
  <tr>
    <td width="50%" valign="top">
      <img src="./assets/readme/preview-search.svg" alt="Search and skills preview" />
      <br />
      <strong>Search, Skills, Toolbox</strong>
      <br />
      聚合搜索、网页阅读、搜索源面板、Skill 市场、UAPIs 工具箱和按需启用的能力包。
    </td>
    <td width="50%" valign="top">
      <img src="./assets/readme/preview-schedule.svg" alt="Schedules and channels preview" />
      <br />
      <strong>Schedules + Social Channels</strong>
      <br />
      日程、一次性/循环/长期定时任务、Agent 回调、终端任务、通知中心、微信、飞书和企业微信投递。
    </td>
  </tr>
</table>

---

## 核心能力

| 模块 | 能力 |
| --- | --- |
| Chat | OpenAI 兼容模型接入、SSE 流式输出、思考过程折叠、Markdown 渲染、上下文压缩、Token 统计、聊天历史保护、失败上下文过滤 |
| 渐进披露 Agent | P0 路由、能力包挂载、运行状态日志、checkpoint、预算报告、按需加载 `repo-pack` / `search-pack` / `memory-pack` / `data-pack` 等 |
| 模型端点 | 常见 LLM 端点预设、Base URL 归一化、供应商差异兼容、流式与非流式调用 |
| 图像生成 | OpenAI compatible `/images/generations`、Gemini native `generateContent`、Gemini OpenAI compatible 图片接口、图片落盘和聊天展示 |
| 本地文件 | 读取、搜索、新建、替换、按行插入、按行替换、复制、移动、删除，适合 Agent 精准维护本地项目和文档 |
| 仓库 | 自动识别本地项目仓库，读取 README、浏览目录、预览代码和图片、仓库 zip 导出、聊天内快速跳转 |
| 终端 | 只读终端白名单、授权执行型终端、跨平台 shell、cwd 切换、运行状态和中断能力 |
| 笔记 | 用户指定目录或 `data/notes/`，支持真实文件树、Markdown 编辑、预览、搜索、拖拽和右键菜单 |
| 资源库 | 每条资源独立存储，支持标题、正文、备注、多标签、状态、网址资源、长文资源和清单资源 |
| 长期记忆 | 普通长期记忆、敏感长期记忆、记忆建议、Agent 主动建议、摘要折叠、运行时注入和用户确认机制 |
| 输出配方 | 将核心认知模型、写作风格和素材范围组合成可复用输出方案，可引用 memory、Wiki、raw、resource、note、tag 或自由文本 |
| Wiki 知识层 | raw 素材、结构化 Wiki 页面、WikiLink、摄取预览、写入、综合分析、lint、索引重建和操作日志 |
| 搜索 | 聚合搜索、网页正文阅读、搜索源可视化面板、启用/禁用管理、UAPIs 搜索类接口交叉验证 |
| 工具箱 | UAPIs API 索引、接口详情读取、结构化调用、按卡片启用/禁用 |
| Skill 中心 | 展示已安装 Skill、市场搜索、安装、删除、预览 `SKILL.md`，支持包含脚本和多文件的技能包 |
| 日程与任务 | 普通日程、一次性任务、多次任务、长期循环任务、Agent 回调、终端任务、结果写回聊天流或通知中心 |
| 社交通道 | 微信、飞书、企业微信二级页面；支持消息回显、自动回复、媒体收发、任务触发推送和卡片交互 |
| 飞书 | 长连接订阅、One-Shot 原生扫码、互动卡片、媒体文件发送/接收、卡片按钮回调 |
| 微信 | 扫码登录、自动重连、文本/媒体消息处理、LLM 调用失败回显和定时任务推送 |
| SQL 与编排 | SQL 数据源、SQL 文件、可视化节点编排、Shell 节点、SQL 节点和任务流程基础能力 |
| 运行日志 | 生产环境前后端日志落盘到 `data/logs/`，便于定位真实用户环境中的问题 |

---

## 架构概览

```mermaid
flowchart LR
  User[User] --> Frontend[React + Vite Frontend]
  Frontend --> Backend[Express + TypeScript Backend]
  Backend --> Agent[Agent Runtime]
  Agent --> LLM[LLM Providers]
  Agent --> Image[Image Providers]
  Agent --> Packs[Capability Packs]

  Packs --> Repo[Repo + Files + Terminal]
  Packs --> Search[Search + UAPIs]
  Packs --> Memory[Memory + Output Profiles]
  Packs --> Data[Wiki + Raw + Notes + Resources + SQL]
  Packs --> Plan[Calendar + Scheduled Tasks]
  Packs --> Skills[Skills]
  Packs --> Channels[WeChat / Feishu / WeCom]

  Backend --> Store[(local data/)]
  Store --> Workspace[agent-workspace]
  Store --> Wiki[wiki/raw + wiki/pages]
  Store --> Logs[logs]
```

### 前端

- Vite
- React 18
- TypeScript
- React Router
- React Markdown
- Mermaid
- KaTeX
- Vitest

### 后端

- Node.js
- Express
- TypeScript
- Server-Sent Events
- OpenAI compatible Chat Completions
- Gemini native image generation
- JSON-based local storage
- Feishu / WeChat / WeCom channel services
- Cross-platform terminal runtime

---

## 从零开始搭建

### 1. 环境要求

建议使用：

- Node.js 20 或更高
- npm 10 或更高
- Git
- Windows、macOS、Linux 均可运行

可选：

- 一个 OpenAI 兼容聊天模型 API Key
- 一个图像生成 API Key
- 飞书、微信、企业微信相关账号或开发者配置
- UAPIs API Key，不填也可以使用免费 IP 额度

SQL 功能额外依赖（不用可跳过）：

- Python >= 3.10
- uv（Python 包管理器）

> 不使用 SQL 查询/编排功能时，可跳过 Python 和 uv，1052 OS 其他功能正常使用。

安装 uv：

```bash
# macOS / Linux
curl -LsSf https://astral.sh/uv/install.sh | sh

# Windows (PowerShell)
powershell -ExecutionPolicy ByPass -c "irm https://astral.sh/uv/install.ps1 | iex"

# 或通过 pip
pip install uv
```

SQL 功能依赖安装：

```bash
cd backend
uv sync
```

### 2. 克隆仓库

```bash
git clone https://github.com/1052666/1052-OS.git
cd 1052-OS
```

### 3. 安装后端依赖

```bash
cd backend
npm ci
```

如果你没有 lockfile 或需要本地重新解析依赖，可以改用 `npm install`。

### 4. 安装前端依赖

```bash
cd ../frontend
npm ci
```

### 5. 启动后端

```bash
cd ../backend
npm run dev
```

后端默认端口是：

```text
http://localhost:10053
```

健康检查：

```bash
curl http://localhost:10053/api/health
```

### 6. 启动前端

另开一个终端：

```bash
cd frontend
npm run dev
```

前端默认端口是：

```text
http://localhost:10052
```

### 7. 第一次配置模型

打开前端后进入设置页，至少配置：

- LLM Base URL
- Model ID
- API Key
- 是否开启流式输出
- 聊天上下文携带条数
- 渐进披露、checkpoint、完全权限等 Agent 运行选项

常见 LLM Base URL：

| 服务商 | Base URL | Model ID 示例 |
| --- | --- | --- |
| OpenAI | `https://api.openai.com/v1` | 以 OpenAI 平台当前模型为准 |
| MiniMax Global | `https://api.minimax.io/v1` | `MiniMax-M2` 系列 |
| MiniMax 中国区 | `https://api.minimaxi.com/v1` | `MiniMax-M2` 系列 |
| Gemini OpenAI | `https://generativelanguage.googleapis.com/v1beta/openai` | Gemini OpenAI 兼容模型 |
| DeepSeek | `https://api.deepseek.com/v1` | DeepSeek Chat 系列 |
| Moonshot | `https://api.moonshot.cn/v1` | Kimi / Moonshot 模型 |
| OpenRouter | `https://openrouter.ai/api/v1` | OpenRouter 路由模型 |
| SiliconFlow | `https://api.siliconflow.cn/v1` | 硅基流动支持的模型 |

设置页会根据当前 Base URL / Model ID 判断供应商，并在未配置 API Key 时显示对应平台的获取入口。MiniMax 端点会做兼容处理：如果填了未带 `/v1` 的 API 域名或文档域名，后端会自动归一化到可调用的 OpenAI 兼容地址。

API Key 获取地址汇总：

| 服务商 | 获取地址 | 说明 |
| --- | --- | --- |
| OpenAI | `https://platform.openai.com/api-keys` | 登录 OpenAI 平台后创建和管理 API Key。 |
| MiniMax Global / 中国区 | `https://platform.minimaxi.com/` | Global 和中国区仅 Base URL 不同。 |
| Gemini（OpenAI 兼容） | `https://aistudio.google.com/app/apikey` | 在 Google AI Studio 中创建 API Key。 |
| DeepSeek | `https://platform.deepseek.com/` | 在控制台的 API Keys 页面创建密钥。 |
| Moonshot（Kimi） | `https://platform.moonshot.cn/` | 在 API Key 管理页面创建密钥。 |
| OpenRouter | `https://openrouter.ai/` | 登录后在 Keys 页面创建密钥。 |
| SiliconFlow（硅基流动） | `https://cloud.siliconflow.cn/i/QOxdzxkd` | 在控制台 API 密钥页面创建密钥。 |

### 8. 配置图像生成

设置页中的图像生成支持三类路径：

| API 格式 | Base URL 示例 | Model ID 示例 | 说明 |
| --- | --- | --- | --- |
| OpenAI compatible | `https://api.openai.com/v1` | 兼容 `/images/generations` 的图像模型 | 后端拼接 `/images/generations` |
| Gemini native | `https://generativelanguage.googleapis.com/v1beta` | 支持图片输出的 Gemini 模型 | 后端拼接 `/models/{model}:generateContent` 并解析 `inlineData` |
| Gemini OpenAI compatible | `https://generativelanguage.googleapis.com/v1beta/openai` | Gemini OpenAI 兼容图像模型 | 使用 Gemini 的 OpenAI 兼容图像接口 |

生成后的图片会保存到：

```text
data/generated-images/
```

聊天里会自动展示对应图片链接。

---

## 数据目录

运行时数据统一放在项目根目录的 `data/` 下。首次运行时会自动创建，不需要提前准备。

常见结构：

```text
data/
|-- agent-workspace/
|-- channels/
|-- generated-images/
|-- logs/
|-- memory/
|-- notes/
|-- resources/
|-- skills/
|-- wiki/
|   |-- raw/
|   `-- wiki/
|-- chat-history.json
`-- settings.json
```

这些内容通常不应该提交到 GitHub：

- `data/`
- `node_modules/`
- `dist/`
- `.env`
- 本地日志文件
- 临时导出文件
- 模型配置、聊天历史、渠道登录态和密钥

如果你要发布一个干净仓库，只需要保留源码、静态资源、文档、依赖清单和许可证即可。

---

## Agent 的实际工作方式

1052 OS 的 Agent 不只是把用户消息发给模型。后端会根据运行模式、权限、上下文预算和用户任务动态构造模型上下文：

1. 用户在网页聊天、微信、飞书或定时任务中提出需求。
2. 后端注入系统提示词、运行时状态、权限模式、长期记忆、输出配方、checkpoint 和最近聊天历史。
3. 渐进披露模式下，模型先在 P0 判断是否需要能力包。
4. 模型按需申请 `repo-pack`、`search-pack`、`memory-pack`、`skill-pack`、`plan-pack`、`data-pack` 或 `channel-pack`。
5. 后端挂载对应工具，执行工具调用，并把结果返回给模型。
6. 模型生成最终回答，结果写回聊天流、通知中心或外部通道。

这套流程让 Agent 可以处理更接近真实工作的任务，例如：

- “帮我读一下这个仓库 README，总结启动方式。”
- “把这批链接整理成资源，并给每条资源加标签。”
- “把这本书的 raw 素材摄取到 Wiki，不要只归纳几个词条。”
- “明天早上 8 点提醒我看日报，并推送到微信。”
- “搜索今天的 AI 新闻，交叉验证后写成摘要。”
- “在 Agent 工作区生成一份项目报告。”
- “帮我把这个文件第 120 行附近的配置改掉。”
- “按我认可的认知模型、写作风格和素材库组合输出一篇文章。”

---

## 权限模型

1052 OS 默认采用保守权限：

- 读取、查询、预览、搜索、状态检查通常可以直接执行。
- 写入、删除、覆盖、移动、安装、卸载、执行终端命令、发送外部消息等操作，在没有完全权限时需要先告知用户并等待确认。
- 用户可以在设置中开启“完全权限”。开启后，Agent 会被明确告知用户已授权最高权限，可以连续调用工具完成任务，不必每一步重复确认。
- `terminal_run_readonly` 只允许白名单只读命令；创建文件、运行脚本、构建、测试和其他可能修改本地状态的命令必须走执行型终端能力。
- 敏感长期记忆与普通长期记忆分开管理，API Key、令牌、密码等不应进入普通记忆或公开回答。

这让系统既适合谨慎用户，也适合希望 Agent 自动完成长任务的用户。

---

## 社交通道

### 微信

- 扫码登录
- 自动重连
- 文本消息处理
- 媒体消息接收与发送
- LLM 调用失败时回显错误
- 定时任务触发后可推送到微信
- 与前端聊天流保持同一个上下文

### 飞书

- 官方长连接订阅
- One-Shot 原生扫码接入
- 飞书机器人配置
- 文本、图片、文件等媒体能力
- 互动卡片按钮
- 通知已读、定时任务重跑、暂停/恢复、长期记忆建议确认等卡片动作
- 飞书消息写入统一聊天流

### 企业微信

- Webhook 管理
- 测试发送
- 任务通知基础投递

---

## Skill 与工具箱

### Skill 中心

Skill 可以理解为 Agent 的能力包。它可能包含：

- `SKILL.md`
- 脚本
- 模板
- 参考资料
- 多个辅助文件

1052 OS 支持：

- 查看已安装 Skill
- 搜索 Skill 市场
- 安装 Skill
- 删除 Skill
- 预览 Skill 文档
- 热更新加载

### UAPIs 工具箱

工具箱把 UAPIs 的 API 做成可视化卡片，每个 API 都可以单独启用或禁用。Agent 不会把所有 API 说明一次性塞进上下文，而是先看到轻量索引，需要具体接口时再读取详情。

推荐调用顺序：

1. `uapis_list_apis`
2. `uapis_read_api`
3. `uapis_call`

这能避免上下文爆炸，也方便用户精细化控制能力范围。

---

## 搜索策略

1052 OS 支持多类搜索源：

- 聚合搜索引擎
- 网页正文读取
- UAPIs 搜索类接口
- Skill 市场搜索源

推荐策略：

- 事实会变化的内容必须联网核实，例如新闻、价格、政策、产品规格、API 文档、人物职务、市场数据和平台规则。
- 需要稳定、结构化、可交叉验证的资料时，优先考虑 UAPIs 搜索类接口。
- 需要广覆盖时使用聚合搜索。
- 找到可疑或重要信息后，再读取网页正文。
- 搜索源可以在面板中启用或禁用。

---

## 本地开发命令

后端：

```bash
cd backend
npm run build
npm test
npm run dev
```

前端：

```bash
cd frontend
npm run build
npm test
npm run dev
```

端口：

```text
Frontend: http://localhost:10052
Backend:  http://localhost:10053
```

---

## 目录结构

```text
1052-OS/
|-- assets/
|   `-- readme/
|-- backend/
|   |-- prompts/
|   |-- scripts/
|   `-- src/
|       |-- modules/
|       |-- app.ts
|       `-- index.ts
|-- docs/
|-- frontend/
|   `-- src/
|       |-- api/
|       |-- components/
|       |-- pages/
|       `-- styles.css
|-- LICENSE
`-- README.md
```

运行后会自动生成：

```text
data/
```

---

## 贡献者

感谢所有参与测试、反馈、提交代码和改进方案的贡献者。

<p>
  <a href="https://github.com/1052666/1052-OS/graphs/contributors">
    <img src="https://contrib.rocks/image?repo=1052666/1052-OS" alt="1052 OS contributors" />
  </a>
</p>

贡献者列表和提交数量会随 GitHub 自动更新，请以 GitHub Contributors 页面为准。如果你的贡献没有正确显示，通常是因为提交使用的邮箱没有绑定到 GitHub 账号。

---

## Stars 与增长

仓库顶部的 Stars / Forks 徽章会自动跟随 GitHub 更新。下面的图表用于观察 Stars 增长趋势。

<p align="center">
  <a href="https://star-history.com/#1052666/1052-OS&Date">
    <img src="https://api.star-history.com/svg?repos=1052666/1052-OS&type=Date" alt="Star History Chart" />
  </a>
</p>

---

## 常见问题

### data 目录需要提交吗？

不需要。`data/` 是运行时目录，包含聊天历史、设置、日志、生成图片、笔记配置、资源、Skill、Wiki、渠道状态等本地数据。它会在运行时自动创建。

### 没有 API Key 能用吗？

前端和后端可以启动，但 Agent 聊天需要配置一个可用的 LLM API Key。UAPIs Key 是可选的，不填时使用免费 IP 额度。

### MiniMax 怎么配置？

在设置页使用预设即可：

- Global：`https://api.minimax.io/v1`
- 中国区：`https://api.minimaxi.com/v1`
- Model ID：以 MiniMax 平台当前模型为准

后端会自动识别 MiniMax 兼容模式，避免给它传入不兼容的工具选择参数，并保持推理内容输出更稳定。

### Gemini 图片怎么配置？

如果使用 Gemini 原生图片格式：

- API 格式选择 `Gemini native`
- Base URL 使用 `https://generativelanguage.googleapis.com/v1beta`
- Model ID 使用支持图片输出的 Gemini 图像模型
- API Key 填 Google AI Studio Key

如果使用 Gemini OpenAI 兼容图片接口：

- API 格式选择 `OpenAI compatible`
- Base URL 使用 `https://generativelanguage.googleapis.com/v1beta/openai`
- Model ID 使用兼容的图像模型

### 微信和飞书消息会和网页聊天分开吗？

设计目标是同一个上下文。微信、飞书等外部平台收到的消息会写回同一聊天流，定时任务和 Agent 回调也可以回写到通知中心或社交通道。

### 可以用在 Linux 或 macOS 吗？

可以。项目避免把终端能力写死为 Windows/CMD。具体命令仍取决于当前运行系统、Shell 和用户权限。

---

### Cross-platform terminal behavior

Backend terminal tools choose a platform default shell: PowerShell on Windows, zsh on macOS, and bash on Linux. Users can also select `pwsh`, `cmd`, `bash`, `zsh`, or `sh` where the runtime supports them.

Scheduled terminal tasks use the same shell list. Repository zip export is generated inside Node.js instead of depending on `powershell.exe`, so Linux and macOS do not need Windows PowerShell for repository downloads.

`terminal_run_readonly` is intentionally strict and only accepts allow-listed read commands. Use the execution terminal tool for scripts, builds, tests, file writes, or any command that can change local state, subject to the current permission mode.

---

## License

This project is licensed under the [MIT License](./LICENSE).
