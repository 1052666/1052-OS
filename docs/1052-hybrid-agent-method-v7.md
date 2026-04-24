# 1052-PD 实施计划：第七版

状态：Approved v0.7  
日期：2026-04-25  
正式名称：`1052-PD + Wiki Knowledge Layer`  
固定简称：`1052-PD V7`

## 0. 本版定位

V6 已经把 1052 OS Agent 收敛到“单引擎 + 渐进披露 + pack 按需挂载”的路线，并完成了 `P0 -> request_context_upgrade -> pack -> 同轮续跑` 的核心框架。

V7 不推翻 V6。V7 是在 V6 之上补齐一个长期知识资产层：

- 把 Wiki 维基能力并入 `data-pack`
- 建立 `raw -> wiki -> index/log -> lint` 的本地知识维护闭环
- 把高价值对话、资料摄取和知识库健康检查变成 Agent 可执行工作流
- 新增独立前端 Wiki 板块

一句话：V6 解决“工具如何按需出现”，V7 解决“有价值的信息如何长期沉淀为可维护知识网络”。

## 1. 与 V6 是否冲突

不冲突。

V7 的 Wiki 能力只作为 `data-pack` 的一部分出现，不进入 P0 常驻上下文，也不破坏 V6 的 token 预算目标。

### 1.1 兼容边界

- `P0` 仍然只挂 `request_context_upgrade`
- Wiki 工具 schema 只在模型申请并挂载 `data-pack` 后出现
- 单轮最多 2 次升级、单次最多 2 个 pack 的 V6 限制不变
- checkpoint、seed、provider caching 的语义不变
- Wiki 数据不进入默认长期记忆；需要时通过 `data-pack` 查询

### 1.2 新增影响

V7 会扩大 `data-pack` 的工具数量，所以需要给 `data-pack` 增加单独预算观测：

- `data-pack` schema token 预算
- Wiki 工具数量
- Wiki 查询返回内容截断上限
- ingest/query/lint 工作流的 tool round 次数

这属于 V6 Phase 4 “扩展 pack”的自然延伸。

## 2. 已锁定决策

以下决策按当前讨论锁定，除非后续明确推翻：

1. Wiki 目录和页面分类使用中文。
2. 前端新增独立 `Wiki` 板块，不并入 Notes。
3. 允许前端向 `data/wiki/raw/` 上传文件。
4. 默认权限下，Wiki 写入、索引重建、日志追加、lint 自动修复都需要用户确认。
5. 开启完全权限后，Wiki 写入类工具可直接执行。
6. Wiki 工具并入 `data-pack`，不新增独立 `wiki-pack`。
7. `AGENTS.md` 和 `CHANGELOG.md` 继续作为本地约定和内部流水，不推送 GitHub。
8. GitHub 更新说明写在 PR 描述或 commit body，不额外新增更新说明 Markdown 文件。

## 3. 数据目录设计

运行时数据目录：

```text
data/wiki/
  raw/
  wiki/
    实体/
    核心理念/
    综合分析/
    索引.md
    操作日志.md
```

### 3.1 raw

`data/wiki/raw/` 是输入区。

规则：

- 前端允许上传文件到这里
- Agent 可读取
- Agent 默认不修改、不删除 raw 文件
- raw 文件作为后续 wiki 页面的来源

支持首批文件类型：

- `.md`
- `.txt`
- `.csv`
- `.json`
- `.yaml`
- `.yml`

其他文件先只保存和列出，不自动内联解析。

### 3.2 wiki

`data/wiki/wiki/` 是整理后的知识区。

规则：

- Agent 可创建、更新、追加页面
- 页面必须带 frontmatter
- 页面之间使用 `[[实体/名称]]`、`[[核心理念/名称]]`、`[[综合分析/名称]]` 交叉引用
- 每次写入后必须更新 `索引.md` 和 `操作日志.md`

### 3.3 索引和日志

`索引.md` 是总目录，按分类列出：

- 页面路径
- 标题
- 一句话摘要
- 来源数
- 最近更新时间
- 主要 tags

`操作日志.md` 是追加式审计记录，记录：

- ingest
- query-writeback
- lint
- manual-update
- index-rebuild
- raw-upload

## 4. Wiki 页面格式

每个 Wiki 页面必须以 frontmatter 开头：

```yaml
---
tags: [核心理念, Agent]
category: concept
source_count: 2
last_updated: 2026-04-25
sources: [raw/example.md, 综合分析/某次讨论.md]
summary: 一句话摘要
---
```

字段要求：

| 字段 | 必填 | 说明 |
| --- | --- | --- |
| `tags` | 是 | 中文标签数组 |
| `category` | 是 | `entity` / `concept` / `synthesis` |
| `source_count` | 是 | sources 数量 |
| `last_updated` | 是 | `YYYY-MM-DD` |
| `sources` | 是 | 引用来源路径 |
| `summary` | 是 | 一句话摘要，供索引使用 |

正文建议结构：

```md
# 标题

## 概述

## 关键观点

## 关联

- [[核心理念/某概念]]
- [[实体/某项目]]

## 来源

- raw/example.md
```

## 5. 后端设计

新增模块：

```text
backend/src/modules/wiki/
  wiki.types.ts
  wiki.markdown.ts
  wiki.service.ts
  wiki.lint.ts
  wiki.routes.ts
```

接入：

```ts
app.use('/api/wiki', wikiRouter)
```

### 5.1 API

首批 API：

- `GET /api/wiki/summary`
- `GET /api/wiki/raw`
- `POST /api/wiki/raw/upload`
- `GET /api/wiki/raw/:path`
- `GET /api/wiki/pages`
- `GET /api/wiki/pages/:path`
- `POST /api/wiki/pages`
- `PUT /api/wiki/pages/:path`
- `POST /api/wiki/pages/:path/append`
- `POST /api/wiki/ingest-preview`
- `POST /api/wiki/query-writeback`
- `POST /api/wiki/lint`
- `POST /api/wiki/index/rebuild`
- `GET /api/wiki/logs`

### 5.2 安全规则

- 所有路径必须限制在 `data/wiki/` 内
- 拒绝 `..` 路径穿越
- 拒绝绝对路径写入
- raw 默认只读，上传除外
- 写入使用临时文件 + rename
- 不暴露系统路径以外的文件
- 不把 API Key、token、密码等敏感信息写入普通 Wiki

### 5.3 Markdown 解析

V7 首版不引入复杂 YAML parser，先实现受控 frontmatter 解析：

- 只识别开头 `--- ... ---`
- 支持 string、number、array
- 不执行任何动态内容
- 无 frontmatter 的页面在 lint 中标记

WikiLink 解析：

```text
[[实体/名称]]
[[核心理念/名称]]
[[综合分析/名称]]
```

## 6. Agent 工具设计

新增：

```text
backend/src/modules/agent/tools/wiki.tools.ts
```

只读工具：

- `wiki_summary`
- `wiki_raw_list`
- `wiki_raw_read`
- `wiki_page_search`
- `wiki_page_read`
- `wiki_lint_preview`

写入工具：

- `wiki_raw_upload_from_agent_workspace`
- `wiki_page_write`
- `wiki_page_append_section`
- `wiki_ingest_commit`
- `wiki_query_writeback`
- `wiki_lint_fix`
- `wiki_index_rebuild`
- `wiki_log_append`

写入工具统一要求：

```ts
confirmed: boolean
```

默认权限下，未确认时拒绝执行。完全权限开启时沿用现有工具层逻辑自动注入 `confirmed:true`。

## 7. data-pack 集成

`data-pack` 扩展为：

```ts
'data-pack': [
  'notes_list_notes',
  'notes_read_note',
  'resources_list',
  'resources_read',
  'sql_datasource_list',
  'sql_file_list',
  'wiki_summary',
  'wiki_raw_list',
  'wiki_raw_read',
  'wiki_page_search',
  'wiki_page_read',
  'wiki_lint_preview',
  'wiki_raw_upload_from_agent_workspace',
  'wiki_page_write',
  'wiki_page_append_section',
  'wiki_ingest_commit',
  'wiki_query_writeback',
  'wiki_lint_fix',
  'wiki_index_rebuild',
  'wiki_log_append',
]
```

`describePackForRouting('data-pack')` 更新为：

> 笔记、资源、SQL 数据源、Wiki 原始资料、结构化知识页、综合分析、Wiki 健康检查与知识沉淀工具。

## 8. P0 和系统提示词规则

P0 路由新增：

- 需要读取或维护 Wiki、摄取 raw 文件、查询结构化知识页、沉淀综合分析时申请 `data-pack`
- raw 是只读来源区
- wiki 是结构化知识区
- ingest 前先总结 3-5 个要点，等待用户确认重点
- query 后如果有长期价值，询问是否写入 `综合分析/`
- lint 可先预览，自动修复需要确认或完全权限

系统提示词新增：

- Wiki 不等于长期记忆
- 长期记忆保存用户偏好和约束
- Wiki 保存知识资产、来源材料和综合分析
- Wiki 写入必须维护索引和操作日志
- 不要把普通聊天内容自动写入 Wiki，除非用户要求或确认

### 8.1 系统提示词更新交付项

V7 实现时必须同步更新模型实际会读取的系统提示词，不能只新增工具和页面。

需要修改：

- `1052.md`：补充 1052-PD V7 的 Wiki 知识层定位、`data-pack` 申请时机和 Wiki/Memory 边界。
- `backend/prompts/agent-system.md`：补充 Wiki 工作流规则，让模型知道 raw、wiki、索引、操作日志、lint、query writeback 的职责。
- `backend/src/modules/agent/agent.prompt.service.ts`：同步更新兜底系统提示词，避免提示词文件读取失败时模型退回旧规则。
- `backend/src/modules/agent/agent.p0.service.ts`：更新 P0 路由说明，让模型在需要 Wiki 能力时主动申请 `data-pack`。
- `backend/src/modules/agent/agent.pack.service.ts`：更新 `data-pack` 描述和工具说明，明确哪些 Wiki 工具是只读、哪些需要确认。

必须告诉模型的规则：

- 需要读取或维护 Wiki 时先申请 `data-pack`，不要声称没有 Wiki 工具。
- `data/wiki/raw/` 是来源区，默认只读；上传可以走前端或明确的 raw 上传工具。
- `data/wiki/wiki/` 是结构化知识区，写入后必须更新 `索引.md` 和 `操作日志.md`。
- 摄取 raw 文件前先给用户 3-5 个要点和拆页建议，默认权限下等确认后再写入。
- 复杂问答有长期价值时，可以建议写入 `综合分析/`，但默认权限下必须先说明理由并征求确认。
- lint 先预览问题；自动修复、索引重建和日志追加属于写入行为，默认权限下需要确认。
- Wiki 不存用户长期偏好；用户偏好、约束和身份类信息仍走长期记忆工具。

验收方式：

- 检查 `backend/prompts/agent-system.md` 和兜底提示词都包含 Wiki/Memory 边界。
- 检查 P0 路由说明包含 “Wiki/raw/知识页/综合分析/lint -> data-pack”。
- 检查 `data-pack` 工具描述包含 Wiki 工具并标注写入确认要求。
- 渐进披露测试需要覆盖：用户要求“读取 Wiki / 摄取 raw / 检查 Wiki 健康”时会申请 `data-pack`。

## 9. 前端 Wiki 板块

新增：

```text
frontend/src/api/wiki.ts
frontend/src/pages/Wiki.tsx
```

修改：

```text
frontend/src/App.tsx
frontend/src/components/Sidebar.tsx
frontend/src/styles.css
```

### 9.1 页面结构

顶部：

- raw 文件数
- wiki 页面数
- 断链数
- 孤立页数
- 最近更新时间

左侧：

- 原始资料
- 实体
- 核心理念
- 综合分析
- 索引
- 操作日志

中间：

- Markdown 阅读
- 源码编辑
- frontmatter 摘要
- WikiLink 点击跳转

右侧：

- 上传 raw 文件
- ingest preview
- lint preview
- rebuild index
- 最近操作日志

### 9.2 上传规则

前端允许上传到 `data/wiki/raw/`。

首版限制：

- 单文件大小上限：10 MB
- 批量上传最多 20 个
- 同名文件默认拒绝覆盖
- 如需覆盖，必须显式确认

## 10. 三个核心工作流

### 10.1 Ingest 摄取

流程：

1. 用户上传或指定 raw 文件
2. Agent 申请 `data-pack`
3. `wiki_raw_read`
4. `wiki_ingest_preview`
5. Agent 给出 3-5 个关键点和建议拆页方式
6. 用户确认
7. `wiki_ingest_commit`
8. 写入或更新 Wiki 页面
9. 更新 `索引.md`
10. 追加 `操作日志.md`

### 10.2 Query 回写

流程：

1. 用户提出复杂问题
2. Agent 申请 `data-pack`
3. `wiki_page_search`
4. `wiki_page_read`
5. Agent 综合回答
6. 如果答案有沉淀价值，询问是否写入
7. 用户确认或完全权限已开启
8. `wiki_query_writeback`
9. 写入 `综合分析/`
10. 更新索引和日志

### 10.3 Lint 健康检查

流程：

1. 用户要求检查 Wiki
2. Agent 申请 `data-pack`
3. `wiki_lint_preview`
4. 输出断链、孤立页、frontmatter 缺失、source 不一致、索引缺项
5. 小问题可请求确认后 `wiki_lint_fix`
6. 更新日志

## 11. 数据类型

```ts
type WikiCategory = 'entity' | 'concept' | 'synthesis'

type WikiPage = {
  path: string
  title: string
  category: WikiCategory
  tags: string[]
  sourceCount: number
  sources: string[]
  summary: string
  lastUpdated: string
  links: string[]
  backlinks: string[]
  content: string
  raw: string
}

type WikiRawFile = {
  path: string
  name: string
  size: number
  updatedAt: number
  readable: boolean
}

type WikiLintResult = {
  brokenLinks: Array<{ page: string; link: string }>
  orphanPages: string[]
  missingFrontmatter: string[]
  missingSources: Array<{ page: string; source: string }>
  sourceCountMismatches: Array<{ page: string; expected: number; actual: number }>
  indexMissingPages: string[]
  autoFixable: string[]
  warnings: string[]
}
```

## 12. 实施计划

一次性跑通，但内部按以下顺序执行：

1. 新增 Wiki 后端类型和 service
2. 实现目录初始化和路径安全
3. 实现 raw 列表、读取、上传
4. 实现 frontmatter 和 WikiLink 解析
5. 实现页面列表、搜索、读取、创建、追加
6. 实现索引重建和日志追加
7. 实现 lint preview 和 lint fix
8. 新增 wiki tools
9. 把 wiki tools 并入 `data-pack`
10. 更新 P0 路由、系统提示词、兜底提示词和 `data-pack` 描述，确保模型知道 V7 Wiki 工作流
11. 新增前端 `api/wiki.ts`
12. 新增前端 `Wiki.tsx`
13. 侧边栏和路由接入 Wiki
14. 补样式
15. 补测试
16. 构建检查
17. 重启前后端

## 13. 测试计划

后端测试：

- 路径穿越拒绝
- raw 上传和读取
- raw 默认不可由 Agent 修改/删除
- frontmatter 解析
- WikiLink 解析
- 页面创建自动补 frontmatter
- append section 不覆盖旧内容
- index rebuild 保留手写区
- log append 追加不覆盖
- lint 能识别断链、孤立页、缺 frontmatter、source_count 不一致
- `data-pack` 包含 Wiki 工具

前端检查：

- `npm run build`
- Wiki 页面能加载 summary
- raw 上传控件不撑破布局
- 页面树窄屏不溢出
- WikiLink 点击能跳转

不做：

- 不发真实模型请求
- 不跑真实聊天端到端验证
- 不把 `data/wiki/` 推送 GitHub

## 14. 风险和控制

| 风险 | 影响 | 控制 |
| --- | --- | --- |
| `data-pack` schema 变大 | token 回升 | Wiki 工具描述压短，必要时拆只读/写入 schema |
| Wiki 自动写入污染知识库 | 低质量内容沉淀 | 默认权限必须确认，query 回写必须说明理由 |
| 索引重建覆盖用户手写内容 | 数据损坏 | 使用 `<!-- 1052:wiki-index:start -->` 标记区，只替换自动区 |
| raw 上传带来隐私风险 | 敏感资料长期留存 | 上传提示本地保存位置，不推 GitHub |
| frontmatter 解析过弱 | 边界格式失败 | 首版只支持受控 YAML 子集，lint 报告异常 |
| Wiki 与 Memory 混淆 | 长期偏好和知识资产混在一起 | 提示词和工具描述明确职责分离 |

## 15. 验收标准

功能验收：

- 可以在前端上传 raw 文件
- 可以通过 Wiki 页面浏览 raw 和 wiki
- 可以创建实体、核心理念、综合分析页面
- 页面带 frontmatter
- WikiLink 能解析和跳转
- 索引能重建
- 操作日志能追加
- lint 能输出健康报告
- Agent 申请 `data-pack` 后能使用 Wiki 工具

V6 兼容验收：

- P0 不新增 Wiki 业务工具 schema
- 未挂载 `data-pack` 时模型不能调用 Wiki 工具
- `request_context_upgrade` 限制不变
- 新增 Wiki 不影响 `repo-pack/search-pack/memory-pack`
- `data-pack` 挂载后同轮续跑正常

构建验收：

- `backend npm run build` 通过
- `frontend npm run build` 通过
- 相关后端测试通过
- 重启前后端后健康检查通过

## 16. 拍板项

当前已按讨论默认选择：

- 中文目录
- 独立 Wiki 板块
- 允许前端上传 raw
- 默认权限写入需确认
- 完全权限直接执行
- Wiki 工具并入 `data-pack`

如果这版通过，下一步就不再继续写方案，直接进入实现。
