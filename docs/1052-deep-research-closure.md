# 1052 OS 深度研究证据闭环

## 1. 目标

深度研究不是一次搜索后直接生成答案，而是一个可以恢复、审核和追溯的状态机：

```text
Session
  -> Search Round
  -> Result review
  -> Immutable Snapshot
  -> Quality Assessment
  -> Claim
  -> Evidence
  -> Claim Review
  -> Wiki writeback
  -> PKM reindex
  -> Completed Session
```

核心约束：

1. 搜索结果默认是 `pending`，不能直接作为已验证证据。
2. Evidence 必须引用一个不可变正文快照中的精确字符区间。
3. 来源状态、证据和审核结论必须在同一个研究 Session 内。
4. 反驳、单一来源、证据不足和高风险低覆盖不会自动通过。
5. 只有 `approved` Claim 可以写入 Wiki / PKM。
6. 完成后的 Session 只读，防止写回后研究依据继续漂移。

## 2. 四阶段实现

### 阶段 1：持久研究会话

- `ResearchSession` 保存主题、所有者、状态和聚合计数。
- 每次搜索生成 `ResearchRound`，完整保留查询、选中引擎、成功引擎和失败原因。
- URL 使用与普通 Web Search 相同的规范化逻辑，移除 `utm_*`、`source`、`ref`、
  `from`、`spm`、`fbclid`、`gclid` 等跟踪参数。
- 同一规范化 URL 只保留一个 Result，通过来源表累积不同轮次和不同排名。
- Result 使用 Reciprocal Rank Fusion：

```text
rrfScore(result) = sum(1 / (60 + rank_in_round))
```

### 阶段 2：正文、质量与追问

- 网页提取创建新的 `ResearchSnapshot`，旧快照不会覆盖。
- 快照保存请求 URL、最终 URL、标题、正文、来源域名、字符数和 SHA-256。
- 提取失败也保存失败快照，研究轨迹可以区分空结果与抓取失败。
- 每轮质量评估包含：
  - `contentDepth`：该轮已提取来源的平均正文长度。
  - `sourceDiversity`：独立来源域名数量。
  - `novelty`：与历史 URL 和历史已批准内容相比的新增比例。
- 未通过的指标会产生下一轮查询建议，例如官方长文、尚未覆盖的专业域名或反方材料。

网页读取安全边界：

- 只允许 `http:` 和 `https:`。
- 拒绝凭据 URL、本机、私网、链路本地、组播和保留地址。
- DNS 结果中只要包含非公网地址就拒绝。
- 每一跳重定向重新验证目标，最多 5 跳。
- 只接受 HTML、XHTML、纯文本和 XML。
- 响应正文最多 2 MB，并使用独立网络超时。

### 阶段 3：Claim / Evidence / Review

Claim 是可以被证据支持或反驳的原子陈述，风险分为 `low`、`medium`、`high`。

Evidence 保存：

| 字段 | 含义 |
| --- | --- |
| `snapshotId` | 引用的不可变快照 |
| `quote` | 原文片段 |
| `charStart` / `charEnd` | 原文在快照中的精确字符偏移 |
| `contentHash` | 原文片段 SHA-256 |
| `snapshotHash` | 整个快照 SHA-256 |
| `sourceClusterId` | 按发布者域名聚类的独立来源标识 |
| `stance` | `support`、`refute` 或 `insufficient` |
| `confidence` | 可选的 0 到 1 置信度 |

写入 Evidence 时会重新读取快照并检查：

```text
snapshot.content.slice(charStart, charEnd) === quote
```

任何新增 Evidence 都会删除旧 Review，使 Claim 回到 `verifying`，避免审核结论与证据集脱节。

自动 Review 规则：

| 条件 | 结果 |
| --- | --- |
| 没有证据 | `needs_review` |
| 存在任意反驳证据 | `needs_review`，并生成冲突摘要 |
| 高风险且少于两个独立来源 | `needs_review` |
| 至少两个独立来源且全部支持 | `approved` |
| 混有 `insufficient` | `needs_review` |
| 只有一个来源 | `needs_review` |

系统没有“忽略冲突后自动通过”的路径。需要人工处理冲突时，应先补充或修正证据，
再重新执行 Review。

### 阶段 4：Wiki / PKM 写回

写回前再次检查：

1. 请求中的每个 Claim 都存在 `approved` Review。
2. 每个 Evidence 引用的 Result 当前仍为 `approved`。
3. 至少存在一条可写入 Evidence。
4. 摘要不为空。
5. Session 仍为 `active`。

写回内容包含研究标题、用户摘要、已核验 Claim、每条证据的立场和来源链接，以及去重后的
来源清单。写入现有 Wiki 后立即调用 PKM 重建索引，再记录 `ResearchWriteback`。
只有这些步骤全部成功，才会在请求指定时把 Session 标记为 `completed`。

## 3. SQLite 数据模型

数据库文件：`data/research/research-sessions.sqlite`

| 表 | 作用 |
| --- | --- |
| `research_sessions` | 研究主题和生命周期 |
| `research_queries` | 每轮查询、引擎结果和失败信息 |
| `research_results` | 规范化、去重后的来源节点 |
| `research_result_origins` | 来源在每轮中的排名和原始分数 |
| `research_snapshots` | 不可变正文版本和提取失败记录 |
| `research_round_assessments` | 质量指标和追问建议 |
| `research_claims` | 原子主张和风险等级 |
| `research_evidence` | 带快照锚点和哈希的证据 |
| `research_claim_reviews` | 规则检查、冲突和审核结论 |
| `research_writebacks` | Wiki / PKM 写回审计记录 |

数据库启用 WAL 和外键。搜索轮次、结果审核、Evidence、Review 等多表操作使用 SQLite
事务，避免网页、微信、飞书和定时任务并发运行时覆盖彼此状态。

## 4. REST API

所有路径以 `/api/websearch/research` 开头。

| 方法与路径 | 作用 |
| --- | --- |
| `GET /sessions` | 列出研究会话 |
| `POST /sessions` | 创建研究会话 |
| `GET /sessions/:id` | 获取完整研究轨迹 |
| `POST /sessions/:id/search` | 执行一轮搜索 |
| `POST /sessions/:id/extract` | 批量提取来源快照 |
| `POST /sessions/:id/assess` | 评估指定或最新轮次 |
| `POST /sessions/:id/results/review` | 审核搜索结果 |
| `POST /sessions/:id/claims` | 创建 Claim |
| `POST /sessions/:id/claims/:claimId/evidence/candidates` | 查找证据候选 |
| `POST /sessions/:id/claims/:claimId/evidence` | 锚定 Evidence |
| `POST /sessions/:id/claims/:claimId/review` | 执行 Claim Review |
| `POST /sessions/:id/writeback` | 写回 Wiki / PKM |
| `POST /sessions/:id/complete` | 完成研究会话 |

无效状态、风险等级、证据立场和字符偏移返回 4xx；不会静默转换为更有利的审核值。
单次网页提取最多 12 个结果。前端状态响应控制展示条数，内部质量、证据和写回读取不受
100 条展示分页影响。

## 5. Agent 工具流程

`search-pack` 暴露与 REST API 对应的研究工具。推荐 Runtime Loop：

```text
websearch_research_start
  -> websearch_research_search
  -> websearch_research_extract
  -> websearch_research_assess
  -> 根据建议继续 search
  -> websearch_research_review
  -> websearch_research_claim_create
  -> websearch_research_evidence_candidates
  -> websearch_research_evidence_add
  -> websearch_research_claim_review
  -> websearch_research_writeback
```

搜索、状态、提取、评估、候选和审核属于研究内部操作。最终 Wiki / PKM 写回属于持久化
副作用，继续遵循 1052 OS 的工具审批策略。P0 提示词明确禁止把 `pending` 来源、冲突
Claim 或 `needs_review` Claim 当作已验证事实写入知识库。

## 6. 前端研究轨迹

入口：`/knowledge/research`

页面由以下连续工作区组成：

- 研究会话列表和完成状态。
- 搜索输入、轮次时间线、引擎成功/失败信息。
- 深度、多样性、新颖度指标和追问建议。
- Result 的 RRF、来源命中轮次、快照状态和审核按钮。
- Claim 编辑、Evidence 候选、支持/反驳/不足选择和 Review 结论。
- 仅审核通过 Claim 的 Wiki / PKM 写回。

页面桌面端使用双栏工作区，手机端改为单列，并保留底部核心导航。完成后的 Session
仍可浏览全部轨迹和来源，但所有修改控件都会禁用。

## 7. 验证

关键测试覆盖：

- URL 跟踪参数去除、跨轮去重和 RRF。
- 搜索引擎失败轮次持久化。
- 不可变快照和 SHA-256。
- Evidence 精确字符锚定和旧 Review 失效。
- 双独立来源自动通过和反驳冲突。
- 未审核 Claim 写回拒绝。
- Wiki 写入、PKM 重建和 Session 完成的完整链路。
- 完成后的 Session 拒绝修改。
- 超过 100 个来源时内部工作流不受展示分页影响。
- SSRF 地址、重定向、类型和响应体积边界。
- `1440x900`、`1920x1080`、`390x844` 三种浏览器视口的完整交互流程。
