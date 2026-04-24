# 1052 深融代理法（初版）

状态：Draft v0.1  
日期：2026-04-23  
副标题：稀疏内核、富工具外骨骼、人控边界、可迁移底座

## 目标

在不破坏 `1052 OS` 当前结构的前提下，吸收 `GenericAgent` 与 `Claude Code` 的核心长处，形成一套适配本项目现状的独特代理方法，并支持当前版本与历史版本的数据一键迁移。

这份文档不是概念稿，结论已经对照了三类输入：

- `1052` 当前代码结构，重点参考：
  - `backend/src/modules/agent/agent.service.ts`
  - `backend/src/modules/memory/memory.service.ts`
  - `backend/src/modules/skills/skills.service.ts`
  - `backend/src/modules/agent/agent.history.service.ts`
  - `backend/src/modules/agent/agent.compaction.service.ts`
  - `backend/src/modules/orchestration/orchestration.service.ts`
  - `frontend/src/pages/Chat.tsx`
- `GenericAgent / hello-generic-agent` 的方法论与主仓库实现
- `D:\claudecli\claude-code-main` 的上下文工程、工具治理与子代理设计

## 一句话结论

`1052` 不应该直接“接入一个 GenericAgent Python 侧车”，也不应该“把 Claude Code 当成第二套产品塞进来”。  
更合理的路线是：保留当前 `classic` 执行链路，再新增一个 `fusion` 执行引擎，把 `GenericAgent` 的稀疏循环和分层记忆、`Claude Code` 的项目上下文工程和权限治理，落到 `1052` 现有的数据与工具底座上。

## 1. 三路调研结论

### 1.1 GenericAgent 值得吸收的部分

- 不主张每轮都回放整段历史，而是用“工作检查点 + 分层记忆 + 按需加载”控制上下文。
- 强调 `No Execution, No Memory`，避免把未验证、未落地的信息污染长期记忆。
- Skill 不是静态提示词仓库，而是从真实成功过程里蒸馏出来的 SOP、脚本和可执行能力。
- 主循环比较薄，核心思路是“状态外置、上下文稀疏、工具原子化”。

### 1.2 GenericAgent 不适合直接搬进 1052 的部分

- 它的能力边界比 `1052` 现在的产品能力窄很多，直接照搬会丢失本项目已有的富工具和业务面。
- 如果以独立 Python 运行时长期接入，会把工具、会话、记忆、运维和权限拆成两套。
- 教程里有字符数近似 token 的预算方法，但不适合 `1052` 的中文负载场景，误差会偏大。

### 1.3 Claude Code 值得吸收的部分

- `src/context.ts` 的做法很实用：把 `README`、目录结构、`git status`、项目规则文件纳入会话级缓存上下文。
- `src/commands/compact.ts` 不是简单“截断历史”，而是“先总结，再开新局”，这对长任务持续性很强。
- `src/tools.ts` 与 `AgentTool` 体现了两点：
  - 工具能力可分层暴露
  - 子代理最好做成边界清晰、结果一次性返回的无状态任务
- 整体权限意识明确，写操作、子代理、MCP 工具都可以被治理，而不是一股脑全放给模型。

### 1.4 Claude Code 不适合直接照抄的部分

- 它是偏编码终端型代理，产品边界与 `1052` 的“聊天 + 工具 + 记忆 + 社交通道 + 编排 + 资源管理”不同。
- 它依赖自己的 prompt、交互方式和工具语义，直接套过来会挤压 `1052` 已有模块，而不是增强它们。
- `CLAUDE.md` 机制很好，但 `1052` 已经有 `AGENTS.md`，不能无脑再引入一套同层级规则文件造成语义冲突。

### 1.5 1052 当前最强的部分

- 已经有完整的本地数据底座：聊天历史、压缩备份、长期记忆、敏感记忆、Skill、市集安装、编排执行日志。
- 已经有非常丰富的工具面和业务面，不需要另起炉灶。
- 已经有前端聊天界面、流式输出、历史同步、压缩入口和本地优先运行模式。

### 1.6 1052 当前最需要补的部分

- 现有链路在 `agent.service.ts` 里仍偏“多 system + 大上下文 + 大工具面 + 多轮回放”。
- 工具暴露粒度较粗，模型看到的是一整面工具墙，而不是任务导向的能力镜头。
- 记忆、技能、历史、编排日志已经存在，但还没有被统一成一套分层上下文系统。
- 历史压缩已经有了，但缺少 GenericAgent 风格的“工作检查点”。

## 2. 方法定义

这套融合方案命名为：`1052 深融代理法`。

它不是“把两个外部项目接进来”，而是把外部两条路线提炼成四条原则，再落到 `1052` 自己的架构中。

### 2.1 四条原则

1. 单产品、双引擎  
   `1052` 仍是一套产品，不拆成两套代理。保留当前引擎，再新增一个深融引擎。

2. 稀疏内核、富工具外骨骼  
   深融引擎内部上下文要稀疏，但底层继续复用 `1052` 已有的大能力集合。

3. 显式治理、人控边界  
   工具、权限、MCP、子代理、外部通道都要被分层治理，不做默认无限暴露。

4. 导入迁移，不破坏原始数据  
   旧版本、当前版本和外部导入都走“扫描 -> 预览 -> 导入 -> 建索引 -> 可回滚”。

## 3. 目标架构

### 3.1 执行层：双引擎

建议保留现有链路作为 `classic`，新增 `fusion`。

#### `classic`

- 继续承接当前聊天体验和通用任务。
- 保留现有消息构造、历史回放、流式输出和大工具面逻辑。
- 默认模式先不动，保证兼容。

#### `fusion`

- 面向长任务、复杂项目任务、重复流程、重工具协作任务。
- 使用“一条系统规则基底 + 分层上下文 + 工作检查点 + 有界工具镜头”。
- 不再把整段历史持续塞回模型，而是带“当前目标、当前状态、最近结果、按需加载的记忆”。

### 3.2 接口层：不破坏现有入口

保留现有 `/api/agent/chat`，仅增加一个可选参数：

```ts
type AgentChatRequest = {
  messages: ChatMessage[]
  engine?: 'classic' | 'fusion'
}
```

这样做的好处：

- 前端聊天页只需要加一个模式切换，不需要重写页面结构
- 老接口、老历史、老调用方全部继续有效
- 新旧链路可以并行灰度

### 3.3 上下文层：分层记忆 + 项目画像 + 工作检查点

建议形成七层结构。

| 层级 | 含义 | 1052 对应来源 | 注入方式 |
| --- | --- | --- | --- |
| L0 | 硬规则层 | `AGENTS.md`、系统提示、权限规则、环境规则 | 始终注入 |
| L1 | 项目画像索引 | `README`、目录快照、git 状态、可选 `WORKSPACE.md` | 始终注入，但保持短 |
| L2 | 事实记忆层 | `data/memory/memories.json`、`secure/` 元信息 | 按需检索 |
| L3 | 技能/SOP 层 | `data/skills`、候选技能库 | 按需检索 |
| L4 | 历史归档层 | `chat-history.json`、`chat-history-backups/`、编排日志 | 默认不全量注入 |
| L5 | 当前任务上下文 | 当前任务目标、输入、限制、最近工具结果 | 每轮注入 |
| L6 | 工作检查点 | `checkpoint.json` | 每轮读写 |

其中最关键的是新增两个概念：

- `项目画像`
- `工作检查点`

#### 项目画像

这是对 `Claude Code` 的 `CLAUDE.md + context cache` 思路的本地化改造。

建议不要直接照搬 `CLAUDE.md` 文件名，而是采用：

- `AGENTS.md`：硬规则和长期协作约束
- `WORKSPACE.md`：仓库级操作知识，可选
- 运行时画像缓存：由系统根据 `README`、目录结构、git 状态和常用命令生成

这样可以避免：

- 规则文件和操作记忆混在一起
- 外部生态文件名耦合进 `1052`
- 用户分不清“必须遵守的规则”和“可更新的项目经验”

#### 工作检查点

新增建议目录：

```text
data/fusion-agent/sessions/<sessionId>/checkpoint.json
```

检查点保存：

- 当前总目标
- 当前阶段目标
- 已确认事实
- 已完成动作
- 失败尝试
- 下一步计划
- 相关记忆与技能引用

这会替代“每轮都回放几十上百条聊天消息”的做法。

### 3.4 工具层：保留大底座，给模型更窄的镜头

`1052` 当前底层工具很多，这本身是优势，不应该被删掉。  
但 `fusion` 引擎不应该直接把全部工具原样暴露给模型。

建议做一层 `tool lens`，把现有能力适配成 9 到 12 个原子能力入口，例如：

- `project.inspect`
- `project.edit`
- `project.run`
- `memory.recall`
- `memory.write_candidate`
- `skill.search`
- `skill.apply`
- `workflow.execute`
- `resource.lookup`
- `web.search`
- `channel.dispatch`
- `artifact.generate`

底层仍然复用现有模块，变化只发生在“模型看到什么能力”和“如何按任务装配能力镜头”。

### 3.5 子代理层：吸收 Claude Code，但不要无限分叉

`claude-code-main` 的 `AgentTool` 很值得借鉴，但 `1052` 这里建议采用“受治理的子任务代理”：

- 子代理只处理边界清晰的侧向任务
- 默认无状态，一次性返回结果
- 默认只给只读能力，写能力必须提升权限
- 子代理结果先回主代理，再决定是否落长期记忆或生成技能

这比直接开放“无限递归代理”更稳。

### 3.6 压缩层：保留现有 `/compact`，但升级为双机制

当前 `1052` 已经有压缩逻辑和历史备份，这部分不要丢。

建议形成双机制：

- `classic`：继续用现有历史压缩与备份
- `fusion`：优先使用检查点续跑，必要时再做阶段摘要

注意：  
不要照搬 GenericAgent 文档中的字符数近似 token 公式。`1052` 中文比例高，应该优先使用真实 usage 或更保守的 token 估算方式。

## 4. 与当前代码的落点映射

### 4.1 现有模块保留不动的部分

- `backend/src/modules/agent/agent.service.ts`
  - 继续作为 `classic` 主链路
- `backend/src/modules/memory/memory.service.ts`
  - 继续作为事实记忆和敏感记忆底座
- `backend/src/modules/skills/skills.service.ts`
  - 继续作为技能库和技能市场入口
- `backend/src/modules/agent/agent.history.service.ts`
  - 继续保留当前历史文件
- `backend/src/modules/agent/agent.compaction.service.ts`
  - 继续保留当前压缩与备份逻辑
- `backend/src/modules/orchestration/orchestration.service.ts`
  - 继续作为流程执行与日志来源
- `frontend/src/pages/Chat.tsx`
  - 继续作为统一聊天页

### 4.2 新增模块建议

建议新增：

```text
backend/src/modules/fusion-agent/
  fusion-agent.service.ts
  fusion-context.service.ts
  fusion-session.service.ts
  fusion-tool-lens.service.ts
  fusion-memory.adapter.ts
  fusion-skill.adapter.ts
  fusion-history.adapter.ts
  fusion-profile.service.ts
  fusion-migration.service.ts
  fusion-subagent.service.ts
```

前端新增最少即可：

- 在聊天页增加 `classic / fusion` 切换
- 在设置页或聊天页增加“迁移”入口
- 增加迁移预览报告 UI

## 5. 一键迁移设计

### 5.1 迁移目标

让以下数据可以被导入 `fusion` 体系，而不是被重写覆盖：

- 当前 `1052` 数据目录
- 历史版本项目目录
- 历史版本导出压缩包

### 5.2 迁移原则

1. 原始文件不改写  
2. 导入结果可回滚  
3. 敏感数据不自动暴露  
4. 未验证经验不直接升正式技能  
5. 老历史优先变成归档种子，而不是强行塞回活动上下文

### 5.3 迁移流程

```text
扫描源目录/压缩包
-> 识别可迁移对象
-> 预览分类结果
-> 干跑生成 manifest
-> 正式导入
-> 重建索引
-> 输出迁移报告
-> 支持一键回滚
```

### 5.4 数据映射规则

| 旧数据 | 导入去向 | 规则 |
| --- | --- | --- |
| `chat-history.json` | L4 历史归档 | 原样保留并生成归档索引 |
| `chat-history-backups/` | L4 历史种子 | 作为阶段压缩历史导入 |
| `compactSummary` | L4 摘要卡片 | 可直接作为历史摘要种子 |
| `memories.json` | L2 事实记忆 | 直接导入 |
| `suggestions.json` | 候选事实队列 | 不自动升 L2 |
| `memory/secure/` | L2 安全记忆索引 | 仅导入索引与权限信息 |
| `data/skills` | L3 正式技能 | 保持现状 |
| 历史技能目录 | 候选技能区 | 先验证再晋升 |
| 编排日志 | L4 档案 + SOP 提取源 | 供后续蒸馏 |

### 5.5 迁移产物目录

建议新增：

```text
data/fusion-agent/
  migrations/<migrationId>/manifest.json
  migrations/<migrationId>/report.md
  sessions/<sessionId>/checkpoint.json
  profiles/<workspaceId>.json
  candidates/skills/
  indexes/
```

### 5.6 一键回滚

回滚不是去恢复源文件，而是根据 `manifest.json` 删除或失效导入产物。

这样做的好处是：

- 原始版本绝对不动
- 当前版本数据不会被误覆盖
- 回滚逻辑简单

## 6. 1052 的独特做法

如果只做“GenericAgent 移植版”，价值不够。  
如果只做“Claude Code 风格编码代理”，也会收窄 `1052` 的定位。

`1052 深融代理法` 的独特点应该体现在下面五件事上。

### 6.1 一套产品，两种执行姿态

- `classic` 负责通用聊天和现有工作流兼容
- `fusion` 负责深任务、长任务、复杂项目任务

这不是分裂，而是运行时切换策略。

### 6.2 工具不减，暴露变窄

`1052` 的竞争力就在“能力面宽”。  
深融方案不删底层模块，只重构模型看到的抽象层。

### 6.3 规则、画像、记忆三分离

- 规则：`AGENTS.md`
- 画像：`WORKSPACE.md` + 自动画像缓存
- 记忆：L2/L3/L4 与检查点

这比把所有东西都塞进 system prompt 更稳。

### 6.4 编排日志反哺技能

`1052` 已经有编排系统，这是 GenericAgent 和 Claude Code 都没有的独特点。  
深融之后，成功的编排日志可以被蒸馏成：

- SOP 模板
- 候选技能
- 候选脚本
- 迁移向导建议

### 6.5 社交通道与任务系统纳入代理底座

`1052` 不是纯 IDE 代理。  
飞书、微信、任务、日程、资源、笔记这些业务能力，应该成为深融方法里的“外骨骼能力群”，而不是外挂。

## 7. 分阶段实施建议

### Phase 0：文档与边界确认

- 固化这份设计文档
- 明确 `classic` 默认保留
- 明确数据迁移走导入模式

### Phase 1：双引擎骨架

- 新增 `fusion-agent` 模块
- `/api/agent/chat` 支持 `engine`
- 前端增加模式切换

### Phase 2：检查点与分层上下文

- 建立 `checkpoint.json`
- 建立 L0-L6 组装器
- 建立项目画像缓存

### Phase 3：工具镜头与权限治理

- 构建 `tool lens`
- 给子代理、写操作、外部通道加治理层
- 支持按任务装配工具面

### Phase 4：迁移器

- 支持当前数据目录导入
- 支持旧版本目录导入
- 支持 zip 导入
- 生成报告与回滚清单

### Phase 5：蒸馏与进化

- 从成功对话、编排日志中提取候选技能
- 加入候选技能验证与晋升机制
- 再考虑引入更强的 MCP 联邦与子代理并发

## 8. 第一版实施建议

如果只做第一阶段落地，我建议优先顺序是：

1. 做双引擎骨架  
2. 做工作检查点  
3. 做历史与记忆的导入映射  
4. 做工具镜头  
5. 最后再做候选技能蒸馏

原因很简单：

- 没有双引擎，方案无法灰度
- 没有检查点，GenericAgent 的核心收益落不下来
- 没有导入映射，历史资产接不进来
- 技能蒸馏必须放在稳定运行之后，否则会把噪声快速固化

## 9. 暂不建议做的事情

- 不建议直接把 GenericAgent 作为长期 Python 侧车挂到主链路
- 不建议直接复刻 `CLAUDE.md` 文件名和完整交互语义
- 不建议把所有旧历史直接回灌为活动上下文
- 不建议把历史技能一键升为正式可执行技能
- 不建议用字符数近似 token 的方式做中文上下文预算

## 10. 下一步可交付物

这份文档通过后，下一轮可以直接补三份更落地的产物：

1. 接口与目录设计稿  
2. 迁移器数据结构与 manifest 规范  
3. `fusion-agent` 的最小可运行骨架清单

---

## 参考输入

- `GenericAgent` 主仓库：<https://github.com/lsdefine/GenericAgent>
- `hello-generic-agent` 教程：<https://datawhalechina.github.io/hello-generic-agent/>
- `claude-code-main` 本地调研目录：`D:\claudecli\claude-code-main`
