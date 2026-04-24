# 1052 深融代理法（第三版）

状态：Draft v0.3  
日期：2026-04-24  
副标题：固定 P0、升级动作、前缀缓存前置、检查点闭环

## 这版为什么重写

第三版不是推翻第二版方向，而是吸收第二轮评审后的 6 个关键修正：

1. `P0 ~ P3` 不能靠前置分类器判定  
2. 工具包挂载不能一口气做满 `8` 个 pack  
3. `P0 <= 2.5k` 过于乐观，要上调到 `<= 3k`  
4. 检查点和历史的关系要讲清楚  
5. Prompt caching 不该放到最后  
6. `1052` 的独特点“编排日志反哺技能”要前置，不该只在末尾带过

所以这一版只做三件事：

- 把“单引擎 + 渐进披露”改成可执行机制
- 调整实施顺序，先做最赚的两刀
- 把检查点生命周期补完整

## 1. 先复述病灶

V2 的本地审计结论依然成立。

输入只是一句 `你好` 时，当前静态首包大致为：

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

- 工具总数：`117`
- 启用 `UAPIs`：`88`
- `memory.always`：`8`
- 敏感记忆目录：`6`

所以 V3 不再讨论“要不要双引擎”，而只关注一个问题：

`1052` 如何在不拆产品的情况下，把首轮静态注入从 `2w+` 拉到可控区间。

## 2. 第三版总纲

第三版方法名保留：

`1052 单核渐进披露法`

但内部机制改成更明确的一句话：

`固定 P0 启动，按动作升级上下文，不做前置任务分档分类器。`

这句话很关键。

它意味着：

- 首轮永远只带最小上下文
- 不让模型先“看见全世界”再判断自己要什么
- 让“升级上下文”变成一个显式动作，而不是一段隐式 prompt 逻辑

## 3. 不是前置分档，而是升级动作

### 3.1 为什么不能先分 P0/P1/P2/P3

如果系统要在首轮前就判定“这是轻任务还是重任务”，会立刻遇到悖论：

- 要判断任务复杂度，就得先看到更多上下文
- 但看到更多上下文本身，就已经把 token 花掉了

所以 V3 不再用“前置分档器”。

### 3.2 正确机制：首轮永远 P0

首轮固定只加载：

- `1052.md`
- `1052.local.md`
- 项目画像摘要
- 检查点摘要
- 极简能力路由提示

除此之外，不挂其他大块内容。

### 3.3 升级动作

如果模型需要更多能力，不是直接假定自己已经有，而是发出一个显式动作：

```ts
type ContextUpgradeRequest = {
  packs: ('repo-pack' | 'search-pack' | 'memory-pack' | 'skill-pack' | 'plan-pack' | 'channel-pack' | 'data-pack')[]
  reason: string
  scope?: string[]
}
```

后端收到后做三件事：

1. 校验请求是否合法  
2. 挂载对应 pack 的工具 schema 和最小上下文  
3. 把已挂载 pack 写入检查点，供下一轮复用

这样 `P0 ~ P3` 就不再是前置分类，而是升级后的运行状态：

- `P0`：未升级
- `P1`：已挂 1 个 pack
- `P2`：已挂 2~3 个 pack
- `P3`：已挂多个 pack，且可能启用子代理/阶段摘要

## 4. 1052 命名体系

这一点延续 V2，但更明确。

### 4.1 核心命名

| 文件/目录 | 作用 |
| --- | --- |
| `1052.md` | 项目级共享规则入口 |
| `1052.local.md` | 本地个性化规则入口，默认 gitignore |
| `.1052/rules/*.md` | 路径/任务域规则 |
| `.1052/skills/<skill>/SKILL.md` | 技能入口 |
| `.1052/subagents/*.md` | 子代理定义 |
| `data/1052/profile.json` | 项目画像摘要缓存 |
| `data/1052/checkpoints/<sessionId>.json` | 检查点 |
| `data/1052/index/*.json` | 索引 |
| `data/1052/migrations/<id>/manifest.json` | 迁移清单 |

### 4.2 为什么继续保留 `SKILL.md`

结论不变：

- `1052` 的规则体系本地化
- Skill 的入口协议标准化

这能同时保留：

- 本项目特色
- 技能生态兼容性
- 现有 skills 服务逻辑

## 5. Phase 1 不做满，只先砍两刀

这是第三版最重要的实施顺序调整。

### 5.1 第一刀：先把 UAPIs 从 2810 打到 300 左右

V2 对工具 pack 的方向没错，但一次做 `8` 个 pack，成本太高。

所以 V3 改成：

- 先不做完整 pack 体系
- 第一阶段先只做 `UAPIs` 两层目录化

#### 第一层：极简目录

只注入：

- 类别名
- 每类数量
- 是否存在搜索类 API
- 三步调用规则

示意：

```md
UAPIs:
- search: 12
- media: 9
- social: 8
- finance: 6
- ...
- 使用顺序：list -> read -> call
```

目标：

- 从 `2810` token 降到 `<= 300`

#### 第二层：按需展开

只有在模型发起 `search-pack` 或 `uapis_detail_request` 时，才展开：

- 某个类别清单
- 某个 API 的详情

### 5.2 第二刀：把 prompt caching 前置

这次明确改顺序。

Prompt caching 不再放在第三阶段，而是第一阶段就做。

原因：

- 投入小
- 对重复前缀收益立刻可见
- 不需要等完整 pack 重构完成

### 5.3 Provider 支持结论

截至 `2026-04-24`，我核对了官方文档：

- Anthropic 官方支持 prompt caching，并明确缓存构建顺序与静态前缀有关  
  来源：<https://platform.claude.com/docs/en/build-with-claude/prompt-caching>
- DeepSeek 官方提供 Context Caching / KV Cache，重复前缀命中后会返回缓存相关 usage 字段  
  来源：<https://api-docs.deepseek.com/guides/kv_cache/>
- MiniMax 官方文本接口提供 Prompt Caching，文档区分普通 OpenAI 兼容文本接口与 Prompt Caching 接口  
  来源：<https://platform.minimax.io/docs/api-reference/text-prompt-caching>

所以在 `1052` 里，正确策略不是“等最后再考虑缓存”，而是：

- 先把稳定前缀固定住
- 对支持缓存的 provider 立刻启用
- 对不支持缓存的 provider 继续走瘦身方案

### 5.4 第一阶段只验证两个 pack

V3 不再一口气做 `8` 个 pack，而是只验证：

- `repo-pack`
- `search-pack`

原因：

- 一个覆盖本地项目任务
- 一个覆盖联网检索任务
- 足够验证“升级动作 -> 后端挂载 -> 下一轮生效”这条主逻辑

其他 pack 延后。

## 6. Token 目标修正

第三版把目标调得更现实。

| 场景 | 目标 |
| --- | ---: |
| `P0` 打招呼/闲聊 | `<= 3k` |
| 代码问答 | `4k ~ 7k` |
| 中等工具任务 | `6k ~ 10k` |
| 复杂长任务首轮 | `8k ~ 12k` |

这里不再立 `1k ~ 2.5k` 的 flag。

更现实的判断是：

- `1052.md`
- 项目画像摘要
- 检查点摘要
- 能力路由提示

这些叠起来，本来就很难压到极低。

所以 `P0 <= 3k` 更稳。

## 7. 检查点生命周期

这是 V3 新增的核心章节。

### 7.1 检查点和历史不是二选一

二者并行存在，但承担不同职责。

| 组件 | 作用 | 是否面向 UI |
| --- | --- | --- |
| `chat-history.json` | 聊天审计、时间线、恢复对话 | 是 |
| `checkpoint.json` | 稀疏执行状态、下轮注入上下文 | 否 |

一句话：

- 历史用于“回看”
- 检查点用于“续跑”

### 7.2 谁来写检查点

V3 不采用“纯模型写”或“纯后台猜”这两种极端方案。

而是采用混合写入：

#### A. 后台必写

每轮结束后，后端根据确定性事件写入：

- 已挂载 pack
- 最近一次工具调用摘要
- 成功/失败状态
- 下一步候选动作

这部分不依赖模型自觉。

#### B. 模型可申请 patch

模型可以通过一个显式动作申请更新：

```ts
type CheckpointPatch = {
  goal?: string
  phase?: string
  facts?: string[]
  done?: string[]
  nextStep?: string
}
```

但最终由后端校验和合并，避免模型乱写。

### 7.3 生命周期

#### 会话开始

- 从空检查点或最近检查点快照开始
- 注入摘要版本，而不是注入整份历史

#### 每轮执行后

- 后台写入确定性字段
- 如果模型发起 patch，请求经校验后合并

#### 挂载 pack 后

- 把 pack 名称和作用域写入检查点
- 下轮默认复用，不必重新申请

#### `/compact` 或阶段结束

- 把检查点压缩成阶段摘要
- 与历史压缩结果互相引用

#### 会话关闭或长期闲置

- 保留最近检查点
- 更旧检查点归档到 `archive`

### 7.4 替代关系到底是什么

V2 里“检查点替代历史回放”这句话容易引起误解。  
V3 改成更准确的表述：

`检查点替代的是“模型输入里的大段历史回放”，不是替代历史存储本身。`

## 8. Prompt caching 在 1052 里的落点

这一节也比 V2 更具体。

### 8.1 应缓存什么

优先稳定缓存这些部分：

- `1052.md`
- `1052.local.md`
- 项目画像摘要
- 稳定 system 前缀
- 已挂载 pack 的工具 schema

### 8.2 不该缓存什么

不适合缓存：

- 高频变化的用户消息
- 短期工具结果
- 每轮都变化的临时上下文

### 8.3 与瘦身的关系

Prompt caching 的定位依然是：

- 提前做
- 但不替代瘦身

顺序应是：

1. 先把稳定前缀结构固定住  
2. 对支持缓存的 provider 打开缓存  
3. 同时继续瘦身 pack 和索引  

## 9. 工具包挂载的保守实现

V3 明确降低这项的首期范围。

### 9.1 初始只做两个 pack

#### `repo-pack`

包含：

- repository 基础读取
- filesystem 基础读取
- terminal 只读探测

#### `search-pack`

包含：

- websearch
- UAPIs 搜索目录
- UAPIs 详情读取

### 9.2 第二批再扩

后续再补：

- `memory-pack`
- `skill-pack`
- `plan-pack`
- `data-pack`
- `channel-pack`

### 9.3 这样做的好处

- 路由逻辑先跑通
- 前端调试视图可以先跟上
- 避免一次重构 `117` 个工具

## 10. 1052 的独特点必须前置：编排日志反哺技能

这部分在 V2 里太靠后了，V3 往前提。

`1052` 和 GenericAgent / Claude Code 最大的不一样，不只是本地工具多，而是它已经有：

- 编排系统
- 执行日志
- 任务调度

这意味着 `1052` 有能力把真实工作流反哺成新的能力资产。

### 10.1 反哺链路

建议明确为：

```text
编排日志
-> 成功样本筛选
-> 提取 SOP 草稿
-> 生成候选 Skill
-> 验证
-> 晋升正式 Skill
```

### 10.2 为什么这要前置

因为这才是 `1052` 真正的方法特色：

- 不是只会聊天
- 不是只会编码
- 而是能把已经做成的流程沉淀成复用能力

这条线应该从 V3 就明确占坑，而不是到第三阶段再想起来。

## 11. 新的实施顺序

### Phase 0：观测与结构固化

- 固化 `1052.md` 命名体系
- 新增静态 token 审计输出
- 固定 `P0` 前缀结构

### Phase 1：先砍最赚钱的两刀

- `UAPIs` 极简目录化
- Prompt caching 前置接入
- `repo-pack` / `search-pack` 试点

### Phase 2：把升级机制跑通

- `context_upgrade_request`
- 挂载 pack
- 前端显示当前已挂载能力

### Phase 3：补检查点闭环

- `checkpoint.json`
- 后端确定性写入
- 模型 patch 申请
- `/compact` 与检查点联动

### Phase 4：继续扩 pack

- `memory-pack`
- `skill-pack`
- `plan-pack`
- `data-pack`
- `channel-pack`

### Phase 5：做 1052 特色闭环

- 编排日志提取 SOP
- 候选 Skill 验证
- 正式 Skill 晋升
- 历史版本一键迁移

## 12. 第三版最终结论

如果现在只能定一条工程路线，那就定这条：

`固定 P0 + 升级动作 + UAPIs 先瘦身 + Prompt caching 前置 + 两个 pack 试点 + 检查点闭环 + 编排日志反哺技能`

这条线比 V2 更稳，原因是：

- 不靠前置分类器
- 不一次重构全部工具
- 先做投入产出比最高的部分
- 把检查点从概念补成机制
- 把 `1052` 自己的独特点真正放到主线上

---

## 附：本轮补充核实资料

- Anthropic Prompt Caching：<https://platform.claude.com/docs/en/build-with-claude/prompt-caching>
- DeepSeek Context Caching / KV Cache：<https://api-docs.deepseek.com/guides/kv_cache/>
- MiniMax Prompt Caching：<https://platform.minimax.io/docs/api-reference/text-prompt-caching>
- Claude Code Memory：<https://code.claude.com/docs/en/memory>
- Claude Code Sub Agents：<https://code.claude.com/docs/en/sub-agents>
- GenericAgent README：<https://github.com/lsdefine/GenericAgent>
