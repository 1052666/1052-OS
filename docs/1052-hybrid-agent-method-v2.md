# 1052 深融代理法（第二版）

状态：Draft v0.2  
日期：2026-04-23  
副标题：单核渐进披露、1052 命名体系、低 token 运行

## 这版和上一版的核心变化

第二版推翻两点，保留两点。

推翻：

- 不再设计 `classic + fusion` 双引擎，改成单引擎。
- 不再把“上下文优化”主要理解成“历史压缩”，而是优先处理首轮静态负载。

保留：

- 保留子代理，但只作为侧向任务隔离机制。
- 保留分层记忆、技能蒸馏、非破坏式迁移。

这版的核心目标不是“更先进”，而是先把 `1052` 目前最真实的问题打掉：  
一句“你好”就消耗两万多 token，这说明当前瓶颈不在模型推理能力，而在启动载荷设计。

## 1. 深度调研后的新结论

### 1.1 当前 token 大头不在聊天历史，在静态首包

我直接用当前项目后端模块做了本地测量，输入仅为 `你好`，得到的静态载荷估算如下：

| 模块 | 估算 token |
| --- | ---: |
| 工具定义 `toolsJson` | 17043 |
| `UAPIs` 运行时索引 | 2810 |
| 系统提示词 | 2328 |
| 长期记忆运行时上下文 | 1231 |
| Agent 工作区上下文 | 190 |
| Skills 运行时索引 | 366 |
| 已知静态合计 | 23968 |

补充观测：

- 当前总工具数：`117`
- 当前启用 `UAPIs`：`88`
- 当前常驻长期记忆：`always = 8`
- 当前敏感记忆目录元数据：`6`

结论非常直接：

1. `tools` schema 是最大头。  
2. `UAPIs` 全量索引是第二大头。  
3. 现在就算不回放多少历史，启动也已经很重。  
4. 所以第二版必须优先改“首轮装载策略”，而不是只做 `/compact`。

### 1.2 当前 1052 的根问题是“过早暴露全部能力”

当前链路的特点是：

- `agent.service.ts` 在首轮直接拼多段 `system`
- 把 memory / skills / uapis / workspace / 环境等全部装进消息
- 每次请求都带上全部工具定义

这会导致一个结构性问题：

- 用户只打招呼，也会被当成“可能要操作 117 个工具、88 个 UAPIs、长期记忆和技能库”的大任务处理

这不是模型的问题，是执行器默认姿态太重。

### 1.3 GenericAgent 和 Claude Code 给出的真正启发

这次再看两边资料，最有价值的不是“它们长什么样”，而是它们为什么不那么重。

#### GenericAgent 给出的启发

- 核心是少量原子工具，不是全家桶工具墙。
- 把状态写到 `working checkpoint`，而不是反复回放整段过程。
- Skill 由执行沉淀而来，而不是预加载成厚提示词。

官方仓库 README 明确强调两点：

- `9 atomic tools + a ~100-line Agent Loop`
- `Layered memory ensures the right knowledge is always in scope`

这说明它的成本控制不是靠“模型更省”，而是靠“只让正确的信息进入上下文”。

来源：<https://github.com/lsdefine/GenericAgent>

#### Claude Code 给出的启发

- `CLAUDE.md` 是短规则，不是长百科。
- 子代理的意义是隔离高噪声任务，防止主上下文被搜索结果和日志淹没。
- Skill 正文不是常驻注入，而是“用到时才加载”。
- 支持 prompt caching 的模型上，还会把静态前缀缓存起来。

官方文档里有几个非常关键的点：

- `CLAUDE.md` 要尽量短，建议控制在 `200` 行以内
- 子目录规则按需加载，不是启动全量加载
- Skill 正文只在被使用时加载
- Prompt caching 针对的是静态前缀：`tools -> system -> messages`

来源：

- <https://code.claude.com/docs/en/memory>
- <https://code.claude.com/docs/en/sub-agents>
- <https://code.claude.com/docs/en/slash-commands>
- <https://platform.claude.com/docs/en/build-with-claude/prompt-caching>

## 2. 第二版总方案

第二版方法名改成：

`1052 单核渐进披露法`

英文代号可记为：

`1052-PD`  
PD = Progressive Disclosure

它的意思不是做一个“更小的 Agent”，而是做一个“默认极轻、必要时逐层展开”的单引擎。

## 3. 单引擎，而不是双引擎

### 3.1 为什么不要双引擎

双引擎的问题不是不能做，而是不适合 `1052` 当前阶段。

它会带来四个额外成本：

- 前端要解释两种模式
- 后端要维护两套上下文组装器
- 迁移时要决定旧历史属于哪个引擎
- 用户会遇到“这次该选 classic 还是 fusion”的认知成本

对当前项目来说，真正需要的是：

- 一套引擎
- 多个装载层级
- 一个统一的上下文调度器

### 3.2 单引擎的正确打开方式

单引擎不等于“一种上下文大小”。

建议保留一个 `1052 Core Engine`，但内部按任务复杂度分四档启动：

| 档位 | 场景 | 默认注入 |
| --- | --- | --- |
| P0 | 打招呼、闲聊、短问答 | 最小规则包 |
| P1 | 轻任务、问代码、问方案 | 规则包 + 项目画像 + 少量相关记忆 |
| P2 | 工具任务、联网任务、代码改动 | P1 + 定向工具包 + 检查点 |
| P3 | 长任务、复杂任务、多步执行 | P2 + 子代理/扩展记忆/阶段压缩 |

也就是说：

- 引擎只有一个
- 但上下文不是一次性全开

## 4. 1052 命名体系

你提的方向是对的。  
如果要做成 `1052` 自己的方法，核心配置文件名就不该继续沿用外部产品命名。

### 4.1 推荐命名

项目内采用下面这组名字：

| 文件/目录 | 作用 | 是否常驻加载 |
| --- | --- | --- |
| `1052.md` | 项目级共享规则入口 | 是 |
| `1052.local.md` | 本地个性化规则，默认 gitignore | 是 |
| `.1052/rules/*.md` | 路径或任务域规则 | 否，按需 |
| `.1052/skills/<skill>/SKILL.md` | 技能入口 | 否，按需 |
| `.1052/subagents/*.md` | 子代理定义 | 否，按需 |
| `data/1052/profile.json` | 项目画像缓存 | 是，摘要形式 |
| `data/1052/checkpoints/<sessionId>.json` | 工作检查点 | 是，摘要形式 |
| `data/1052/index/*.json` | 分层索引 | 是，摘要形式 |
| `data/1052/migrations/<id>/manifest.json` | 迁移清单 | 否 |

### 4.2 为什么 `SKILL.md` 不建议一起改掉

这里需要刻意做一个取舍。

我不建议把 Skill 的入口文件也改成 `1052.SKILL.md`，原因很实际：

- `SKILL.md` 已经是跨工具生态可复用的约定
- 当前 `1052` 现有技能系统也已经围绕这个入口工作
- 如果强改入口名，会把技能市场兼容性、导入能力和已有数据都一起打断

所以更稳的做法是：

- 把 `1052` 的核心规则体系改成 `1052.*`
- Skill 仍然保留 `SKILL.md`
- 但 Skill 放在 `/.1052/skills/` 目录下，形成 `1052` 自己的组织方式

这叫“命名本地化，格式标准化”。

## 5. 渐进披露设计

### 5.1 启动时只加载 P0

P0 应该非常轻，只包含这些东西：

- `1052.md` 的核心短规则
- `1052.local.md` 的个性化补充
- 项目画像摘要
- 工作检查点摘要
- 一个极简能力索引

P0 目标不是把事情做完，而是先判断“这次需要开什么门”。

建议把 P0 控制在：

- `1200 ~ 2500 token`

### 5.2 P1 再加载任务相关信息

只有识别到用户在做具体任务时，才加载：

- 相关记忆
- 路径命中规则
- 相关项目画像扩展
- 极少量候选技能索引

举例：

- 用户说“你好”  
  只走 P0

- 用户说“帮我看看 backend 这个 agent 模块”  
  加载 `backend` 路径相关规则、仓库画像摘要、代码类工具包

- 用户说“帮我联网搜一下某个 API 报错”  
  加载搜索能力包，不加载文件写入和 SQL 能力包

### 5.3 P2 才挂具体工具包

这一步是第二版最关键的改造点。

当前 `1052` 把 `117` 个工具全部注入模型。  
第二版不能再这样做，必须改成“工具包挂载”。

建议把底层工具重新组织成可挂载能力包：

| 能力包 | 包含内容 |
| --- | --- |
| `repo-pack` | repository / filesystem / terminal 基础读能力 |
| `edit-pack` | 文件写入、补丁、重命名、删除 |
| `search-pack` | websearch + UAPIs 搜索 |
| `memory-pack` | 长期记忆、敏感记忆索引、建议写入 |
| `skill-pack` | skill 搜索、读取、安装 |
| `plan-pack` | orchestration / schedule / calendar |
| `channel-pack` | 微信、飞书、通知外发 |
| `data-pack` | sql / resources / notes |

模型首轮只看到一个非常薄的能力路由器，不看到全量 schema。

只有当系统判定这轮确实需要某个能力包时，才把该包的详细工具 schema 挂进去。

### 5.4 UAPIs 不能再全量列 88 个

这一块必须单独说。

当前 `UAPIs` 运行时索引约 `2810` token，而且这还只是索引，不是调用结果。  
第二版必须改成两层：

#### 第一层：极简目录

只保留：

- 类别
- 各类别数量
- 搜索类 API 的存在性
- 三步调用规则

示例：

```md
UAPIs:
- search: 12
- social: 8
- finance: 6
- media: 9
- ...
- 先 list，再 read，再 call
```

#### 第二层：按需展开

只有在下列情况才展开具体 API 明细：

- 用户明确要求某类联网能力
- 模型已经决定使用 `search-pack`
- 某个 API 被选为候选后，再读取该 API 详情

这能直接砍掉大量无效启动 token。

### 5.5 Memory 也要做渐进披露

当前 memory 的问题不算最严重，但也还不够轻。

第二版建议：

- `always` 记忆只保留真正的硬约束
- 相关记忆按任务检索返回前 `3~5` 条
- 敏感记忆目录默认不常驻
- 只有任务明确触发凭证/配置需求时，才注入敏感目录索引

也就是说：

- “你好”不应该看到敏感记忆目录
- “帮我调用这个已配置 API”才可能需要看到

### 5.6 Skill 用“索引 + 正文按需”

这一点 Claude Code 的思路很值得抄，但要本地化到 `1052`。

建议：

- 首轮只给极简 skill 索引
- 命中概率最高的 `1~3` 个技能先做短摘要
- 真正执行前再读 `SKILL.md`

不要再把“全部启用 skill 的描述列表”长期塞进 system。

## 6. 子代理在第二版里的位置

子代理保留，但不是“第二引擎”，而是“上下文隔离阀”。

### 6.1 子代理该干什么

子代理适合这些任务：

- 大量搜索结果筛选
- 日志和长输出分析
- 代码库局部探索
- 文档调研
- 候选方案比较

### 6.2 子代理不该干什么

不适合：

- 主链路的最终决策
- 需要持续共享状态的核心执行链
- 高频小任务

### 6.3 子代理默认策略

- 默认无状态
- 默认只读
- 默认返回短摘要
- 默认使用更便宜模型时优先便宜模型

这和 Claude Code 文档里“把高噪声任务放到独立上下文里处理”是一致的，但 `1052` 不需要把一切都拆成子代理。

## 7. 工作检查点

单引擎下，检查点比上一版更重要。

建议每个会话维护：

```json
{
  "goal": "",
  "phase": "",
  "facts": [],
  "done": [],
  "failed_attempts": [],
  "next_step": "",
  "mounted_packs": [],
  "related_rules": [],
  "related_memories": [],
  "related_skills": []
}
```

检查点的作用是：

- 替代历史回放
- 记录已经展开过什么上下文
- 防止模型来回重复读同一批大块内容

## 8. 迁移策略

迁移总体方向不变，但要适配新的 `1052` 命名体系和单引擎。

### 8.1 配置迁移

把旧项目中的规则和知识，迁移成：

- `1052.md`
- `1052.local.md`
- `.1052/rules/`

### 8.2 数据迁移

把旧数据导入到：

- `data/1052/index/`
- `data/1052/checkpoints/`
- `data/1052/migrations/`
- `data/1052/archive/`

### 8.3 技能迁移

技能仍然进入：

- `.1052/skills/<skill>/SKILL.md`

历史技能先导入为候选技能，再做验证，不直接晋升正式技能。

## 9. 第二版和当前 1052 的接口关系

接口尽量不大动，但内部执行逻辑要重写。

### 9.1 对外接口

仍然保留现有 `/api/agent/chat`。

不建议给用户暴露“引擎选择”。

真正新增的应该是调试字段，而不是模式字段，例如：

```ts
type AgentDebugInfo = {
  stage: 'P0' | 'P1' | 'P2' | 'P3'
  mountedPacks: string[]
  estimatedStaticTokens?: number
}
```

### 9.2 前端变化

前端建议新增两个能力：

- 一个“上下文开销可视化”
- 一个“当前已挂载能力包”调试视图

这比“切换 classic/fusion”更符合单引擎设计。

## 10. 预期效果

### 10.1 Token 目标

按第二版方案，目标应该是：

| 场景 | 当前 | 目标 |
| --- | ---: | ---: |
| 打招呼/闲聊 | 2w+ | 1k~2.5k |
| 代码问答 | 2w+ | 3k~6k |
| 中等工具任务 | 2w+ | 5k~9k |
| 复杂长任务首轮 | 2w+ | 8k~12k |

### 10.2 稳定性目标

- 首轮上下文更短
- 工具选择更集中
- 长任务不靠整段历史硬扛
- 不再因无关 UAPIs 和工具 schema 挤爆预算

## 11. 实施顺序

### 第一阶段：先降 token，不先重构一切

1. 建立启动 token 审计  
2. 改成单引擎分阶段装载  
3. 拆掉全量工具 schema 注入  
4. 把 UAPIs 改成两层目录  
5. 引入 `1052.md` + `1052.local.md`

### 第二阶段：再做结构化升级

1. `.1052/rules/` 路径规则  
2. 工作检查点  
3. Skill 按需装载  
4. 子代理隔离高噪声任务

### 第三阶段：最后做迁移和自进化

1. 历史版本一键迁移  
2. 编排日志蒸馏候选技能  
3. 候选技能晋升机制  
4. Provider 级缓存优化

## 12. Provider 级缓存的定位

Prompt caching 可以做，但它只是补充优化，不是主方案。

原因很简单：

- 它能降低部分提供商上的重复前缀成本
- 但不能替代“上下文本身太胖”这个结构问题

所以第二版的原则是：

- 先瘦身
- 再缓存

如果未来接 Anthropic 原生接口，可以优先缓存：

- `tools`
- `1052.md`
- 项目画像摘要
- 稳定 system 前缀

但这一步应该放在主链路瘦身之后。

## 13. 第二版的最终判断

如果只允许我给一个方向，那我会选下面这条线：

`1052.md 命名体系 + 单引擎 + 分层渐进披露 + 工具包挂载 + 工作检查点`

这条线比双引擎更适合当前 `1052`，原因是：

- 它更容易灰度改造
- 它能直接解决 token 爆炸
- 它保留了 GenericAgent 的稀疏思想
- 它吸收了 Claude Code 的按需加载与上下文隔离
- 它不会把当前项目拆成两套产品逻辑

---

## 附：本轮调研依据

### 本地代码审计

- `backend/src/modules/agent/agent.service.ts`
- `backend/src/modules/agent/agent.tool.service.ts`
- `backend/src/modules/agent/agent.prompt.service.ts`
- `backend/src/modules/agent/llm.client.ts`
- `backend/src/modules/memory/memory.service.ts`
- `backend/src/modules/skills/skills.service.ts`
- `backend/src/modules/uapis/uapis.service.ts`
- `frontend/src/pages/Chat.tsx`
- `D:\claudecli\claude-code-main\src\context.ts`
- `D:\claudecli\claude-code-main\src\services\claude.ts`
- `D:\claudecli\claude-code-main\src\commands\compact.ts`
- `D:\claudecli\claude-code-main\src\tools\AgentTool\prompt.ts`

### 外部资料

- GenericAgent README：<https://github.com/lsdefine/GenericAgent>
- Claude Code memory：<https://code.claude.com/docs/en/memory>
- Claude Code subagents：<https://code.claude.com/docs/en/sub-agents>
- Claude Code skills：<https://code.claude.com/docs/en/slash-commands>
- Anthropic prompt caching：<https://platform.claude.com/docs/en/build-with-claude/prompt-caching>
