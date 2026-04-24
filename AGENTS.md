# 1052 OS Agent 工作约定

这份文档记录本项目内和代码代理协作时需要长期遵守的规则。后续进入项目时优先读取本文件，避免重复确认。

## 协作边界

- 代理负责读代码、定位问题、修改代码、做必要的类型检查或构建检查。
- 页面点击、真实聊天、接口实际效果、端到端流程等功能类测试交给用户。
- 除非用户明确要求，不主动发真实模型请求，不主动跑功能验证流程。
- 可以运行构建、类型检查这类代码正确性检查，用于确认改动没有写坏。

## 修改后的必做事项

- 每次修改代码后，都需要重启前端和后端。
- 重启前必须先删除旧的前后端进程，不能直接叠加启动新服务。
- 默认端口：
  - 前端 Vite: `10052`
  - 后端 Express: `10053`
- Windows PowerShell 重启流程：
  0. 确保日志目录存在：
     `$logDir = 'C:\Users\lixia\Desktop\1052os\data\logs'; New-Item -ItemType Directory -Force $logDir | Out-Null`
  1. 查询占用端口的进程：
     `Get-NetTCPConnection -LocalPort 10052,10053 -State Listen -ErrorAction SilentlyContinue | Select-Object LocalPort,OwningProcess`
  2. 停掉旧进程：
     `Stop-Process -Id <pid1>,<pid2> -Force`
  3. 启动后端：
     `Start-Process -FilePath npm.cmd -ArgumentList 'run','dev' -WorkingDirectory 'C:\Users\lixia\Desktop\1052os\backend' -WindowStyle Minimized -RedirectStandardOutput "$logDir\backend-dev.out.log" -RedirectStandardError "$logDir\backend-dev.err.log"`
  4. 启动前端：
     `Start-Process -FilePath npm.cmd -ArgumentList 'run','dev' -WorkingDirectory 'C:\Users\lixia\Desktop\1052os\frontend' -WindowStyle Minimized -RedirectStandardOutput "$logDir\frontend-dev.out.log" -RedirectStandardError "$logDir\frontend-dev.err.log"`
  5. 做轻量健康检查：
     - 后端：`Invoke-RestMethod http://localhost:10053/api/health`
     - 前端：`Invoke-WebRequest http://localhost:10052 -UseBasicParsing`
 - 不只按 10052/10053 端口杀进程。
  - 还要清理项目相关的旧 npm run dev / vite / tsx watch / node 子进程。
- 运行日志统一放在 `data/logs/`，不要在项目根目录新增 `backend-dev.log`、`frontend-dev.log`、`*.out.log` 或 `*.err.log`。

## CHANGELOG 规则

- 所有值得记录的改动都要写进根目录 `CHANGELOG.md`。
- 已完成的改动不要堆在 `Unreleased` 里；需要另起一个版本段落。
- 当前版本序列从 `0.5.1` 开始继续递增，例如 `0.5.2`、`0.5.3`。
- `Unreleased` 只放还没做的计划项。
- 新版本段落格式：

```md
## [0.x.x] - YYYY-MM-DD - 简短标题

### Added
- ...

### Changed
- ...

### Fixed
- ...
```

- 没有对应类别可以省略，不要硬凑。

## GitHub 发布目录约定

- 当前项目运行目录 `C:\Users\lixia\Desktop\1052os` 不要求直接作为 Git 仓库使用。
- 需要推送到 GitHub 时，默认使用独立发布目录：`C:\Users\lixia\Desktop\GitHub\1052-OS`。
- 发布前先把当前运行目录的项目文件同步到发布目录，再在发布目录内执行 `git status`、`git add`、`git commit`、`git push origin main`。
- 同步时不要把运行时隐私数据、日志、密钥、模型配置、聊天历史和本地缓存推送到 GitHub；优先遵守仓库 `.gitignore`，并额外避开 `data/` 下的运行时文件。
- 提交信息和 GitHub 更新说明要写清楚本次改动背景、核心修复、影响范围和验证结果。

## 前端架构约定

- 前端功能应尽量解耦，避免把跨页面状态和业务逻辑塞进 `App.tsx`。
- 共享状态优先用独立 provider/hook，例如主题使用 `theme-context.tsx`。
- 可复用 UI 或渲染能力放到 `frontend/src/components/`。
- 页面组件只负责页面状态编排和调用组件，不承担复杂解析或跨页面逻辑。

## 聊天与 Markdown 约定

- 聊天消息正文使用 Markdown 渲染。
- `<think>...</think>` 思考内容默认折叠，且折叠内容也支持 Markdown。
- Markdown 渲染组件位于 `frontend/src/components/Markdown.tsx`。
- Markdown 支持能力包括：
  - 标题、段落、软换行、分割线
  - 有序列表、无序列表、嵌套列表、任务列表
  - 多层引用
  - 表格
  - 代码块语言标识、复制按钮、轻量高亮
  - 行内代码、粗体、斜体、删除线、链接、自动链接、图片
  - 行内数学公式和块级数学公式
  - 自定义容器 `:::`，用于 note、info、tip、warning、danger 等提示块
  - 脚注引用和脚注定义
  - Mermaid 图表代码块，支持流程图、时序图、类图、状态图、ER 图、甘特图等常见图表
  - 安全 HTML 混写，允许常用排版标签并过滤脚本、事件属性和危险协议
