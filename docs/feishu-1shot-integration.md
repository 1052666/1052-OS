# 1052-OS 开源贡献 PR 规划

> 更新时间：2026-04-22  
> Fork：`vickioo/1052`（上游 `1052666/1052-OS`）  
> 本地工作目录：`/Users/vicki/service/1052-OS-new`（已切到 `dev` 分支，已 push 到 fork）  
> Upstream：`https://github.com/1052666/1052-OS.git`  
> Origin(fork)：`https://github.com/vickioo/1052.git`

---

## Step 1 ✅ 已完成：Fork + dev 分支

- `gh repo fork 1052666/1052-OS --clone=false` → 已 fork 到 `vickioo/1052`（消息显示 "vickioo/1052 already exists"，fork 实际叫 `1052` 不是 `1052-OS`）
- Remote 布局：
  - `upstream` → `https://github.com/1052666/1052-OS.git`（只读，定期 rebase）
  - `origin`   → `https://github.com/vickioo/1052.git`（push 用，已验证可推）
- 已从 main 切出 `dev` 分支并 push 到 origin：`* [new branch] dev -> dev`
- **所有后续改动均在 dev 分支，禁止直接改 main / 禁止 push upstream**

---

## Step 2：技术栈对比 & PR 机会扫描

### 1052-OS 当前架构（已验）

- backend：Express 4 + TS（`backend/src/modules/*`）模块化，主要模块：agent / channels(feishu/wechat/wecom) / settings / skills / calendar / orchestration / sql / terminal 等
- LLM：`agent/llm.client.ts` + `agent/agent.provider.ts`，已内置 `isMiniMaxCompatible()` 判断（检测 `minimaxi.com` 或 `MiniMax-` 前缀模型）
- 结论：**MiniMax 适配作者已经在做了，不是一片空白**。之前 `invalid chat setting (2013)` 可能是 payload 细节而非缺 provider

### 候选 PR 评分表（风险 1=低 5=高 / 收益 1=低 5=高）

| 候选 | 风险 | 通用性 | 上游收益 | 预估 diff | 测试复杂度 | 推荐度 |
|---|---|---|---|---|---|---|
| **feishu-1shot 一键扫码建 bot** | 2 | 5 | 5 | ~300 行（新增 `modules/channels/feishu/one-shot/` + UI 按钮） | 中（需真机扫码） | ⭐⭐⭐⭐⭐ 首推 |
| **"获取 API" 带邀请注册按钮**（私货） | 3 | 4 | 4 | ~150 行（settings schema + 前端按钮组件 + Provider preset） | 低 | ⭐⭐⭐⭐ 次推 |
| usage-report v1.1.2 调色盘 | 1 | 3 | 3 | ~80 行（提取 chart-palettes.ts） | 低 | ⭐⭐⭐ 备选 |
| Feishu CardKit V2 工具函数 | 2 | 3 | 3 | ~200 行（`modules/channels/feishu/cardkit-v2.ts`） | 中 | ⭐⭐⭐ 备选 |
| MiniMax provider 补丁 | 3 | 4 | 3 | 未知（需先复现 2013 错误） | 高（需测真模型） | ⭐⭐ 上游已在做，除非有明确修复点 |
| pipeline/scheduler 通用模式 | 4 | 3 | 2 | 大（触及 orchestration） | 高 | ⭐ 范围太大 |

### 敏感数据边界（硬约束）

参考 memory feedback_ai_pricing_private.md，**禁止入 fork**：
- `4-Assets/ai-pricing/*`（经营定价）
- 任何 `sk-*` key、`.env` 值、JWT secret
- `2-Projects/dashboard-data/*`（内部数据）
- 邀请码清单本身（referral-codes.md 留在 mycc 本地，fork 里只出现在代码 preset 字段中，且仅 vicki 本人公开的那几个）

**落地规范**：每次 commit 前跑 `git diff --stat` + `git grep -iE "sk-[a-z0-9]{20,}|MINIMAX_API_KEY|AIza[0-9A-Za-z_-]{35}"` 自查。

---

## Step 3：feishu-1shot PR 规划（首推）

### 源仓库

- 本地路径：`/Users/vicki/service/feishu-1shot/`
- 远端：`https://github.com/vickioo/feishu-1shot`（MIT License）
- 核心能力（已在 SKILL.md 验证）：
  1. 飞书官方"扫码建 app"私有能力封装（不是 API 而是 OC CLI 通道）
  2. 三档 runtime 自动降级：Docker `--rm` / `npx` / GitHub Codespaces
  3. 凭证落盘后 30 秒擦沙盒，零常驻
  4. Windows 原生 CVE-2026-22176 主动规避
  5. 权限模板预置（消息/文档/日历/任务）

### 1052-OS 落地路径

目录约定参考现有 `backend/src/modules/channels/feishu/`。建议结构：

```
backend/src/modules/channels/feishu/
├── one-shot/                         # 新增
│   ├── one-shot.routes.ts            # POST /api/channels/feishu/one-shot/start
│   ├── one-shot.service.ts           # spawn bootstrap.sh, tail 二维码输出 via SSE
│   ├── one-shot.types.ts             # { runtime, targetEnvPath, qrCode, status }
│   └── README.md                     # 使用说明
frontend/src/pages/settings/channels/
└── FeishuOneShotModal.tsx            # 新增"扫码创建"按钮 + 二维码弹窗 + 进度流
```

### 多环境策略

| 环境 | Runtime 选择 | 凭证落点 |
|---|---|---|
| 本地开发 (macOS / Linux / WSL2) | auto：先 Docker，降级 npx | `backend/.env` |
| Docker 部署（1052-OS 自身容器） | 不支持（Docker-in-Docker 风险），提示用户到宿主执行 | 挂载 `/config/.env` |
| 服务器（无 Docker） | npx + `OPENCLAW_STATE_DIR=/tmp/xxx-<uuid>` | `/config/.env` |
| 浏览器手机（Codespaces） | feishu-1shot README 的 Codespaces 按钮 | 用户手动拷贝 |

**关键边界**：one-shot 模块**不持久化任何凭证到 1052-OS 自身存储**，只负责触发 → 写入 `.env` → 让 settings.service 下次读取时感知。

### 配置项新增（settings.types.ts）

```ts
feishu: {
  // 已有字段 ...
  oneShot: {
    enabled: boolean          // 默认 true
    runtime: 'auto' | 'docker' | 'npx' | 'codespaces'
    targetEnvPath: string     // 默认 `${process.cwd()}/.env`
    lastRun?: { at: number, appId?: string, success: boolean }
  }
}
```

### 测试方案（至少 3 case）

1. **正常登录**：Docker runtime + vicki 本人飞书账号 → 扫码 → 验证 `.env` 里 APP_ID/APP_SECRET 非空、可调 `tenant_access_token` API
2. **token 过期 / 扫码超时**：不扫码静置 10 分钟 → 验证 service 主动 SIGTERM 子进程 + 前端收到 `status:timeout`
3. **多租户切换**：连续跑两次 one-shot，第二次指向不同 `.env` 路径 → 验证两份凭证互不覆盖
4. （bonus）**无 Docker 无 Node**：mock 环境变量，验证服务返回 `runtime:none` + Codespaces 引导链接

### 文档交付物

- `docs/feishu-1shot-integration.md`（在 1052-OS fork 的 dev 分支）—— 使用指南 + 架构图 + 回滚步骤
- `backend/src/modules/channels/feishu/one-shot/README.md`
- README.md 里新增「扫码建 bot（3 步）」章节，对齐 1052-OS 本地优先哲学

### PR 标题草案

`feat(feishu): one-shot QR-scan bot creation via feishu-1shot integration`

### 依赖 / License 考量

- feishu-1shot MIT，与 1052-OS MIT 兼容 ✅
- 运行时不打包 —— 通过 `npx feishu-1shot@latest` 或 Docker image 按需拉，体积零增
- 如作者想避免跨仓依赖，可选：提 PR 时同步邀请把 feishu-1shot 挪入 `@1052/feishu-oneshot` npm 包

---

## Step 4：私货 —— "获取 API" 一键注册带邀请

### 思路来源

参考 Cherry Studio（https://github.com/CherryHQ/cherry-studio）的 provider 配置结构。Cherry 在 `src/renderer/src/config/providers.ts` 里每家 API 挂 `websites: { official, apiKey, docs, referral }` 多字段。我们抄这个结构。

### 1052-OS 现状

- `backend/src/modules/settings/settings.service.ts` 目前只存 `baseUrl/modelId/apiKey` 三字段
- **没有** provider preset 概念 —— 用户要自己粘 baseUrl
- 前端 `frontend/src/pages/settings/` 对应表单也只有这 3 个输入框

### 落地设计（仅方案，不改代码）

#### 后端 schema 扩展

```ts
// backend/src/modules/settings/provider-presets.ts  （新增）
export interface ProviderPreset {
  id: string                      // 'openrouter' | 'minimax' | 'siliconflow' | ...
  name: string                    // 展示名
  logo?: string                   // 前端 assets 路径
  baseUrl: string
  defaultModelId: string
  officialSite: string            // 官网首页
  registerUrl?: string            // 注册页（含 ref 占位）
  referralCode?: string           // vicki 的邀请码（只对允许分发的填）
  docsUrl?: string
  tags?: ('free-tier' | 'paid' | 'cn-mainland')[]
}
```

#### 前端按钮组件

在 LLM 设置表单 baseUrl 输入框右侧放 `<ProviderRegisterButton preset={preset} />`：

- 如 `registerUrl` 含 `{{ref}}` 占位符且 `referralCode` 非空 → 点击 `window.open(registerUrl.replace('{{ref}}', referralCode))`，按钮文字 "🔗 去注册（含邀请）"
- 否则 → 打开 `officialSite`，按钮文字 "🔗 去官网注册"
- preset 里 `referralCode` 为空的（如 Groq/NIM）走第二种

#### Preset 数据源

`/Users/vicki/service/mycc/2-Projects/1052-os-upgrade-eval/referral-codes.md` 是 vicki 本地清单（含未公开邀请码，**留 mycc 不进 fork**）。PR 只带：
- 官网链接（公开信息）
- vicki 同意公开的邀请码（逐一 ToS 核对后）
- referralCode 字段可留空占位，其他用户 fork 后可自填

### 私货合规边界

- ❌ 不对 Claude/OpenAI 打邀请标签
- ❌ 不在默认 preset 里硬塞"推荐"某家商业 provider（避免被 issue 喷）
- ✅ 中立地列出所有常见 provider，按字母排，referralCode 只是"如果你愿意支持原作者可点带 ref 的按钮"
- ✅ README 透明声明："若使用带 ref 按钮注册，原作者将获得对应平台的返利积分"

### PR 标题草案

`feat(settings): provider presets with official/register/referral links`

### 落地时机

**留在 Step 3 PR 合并之后再开第二个 PR**。先让作者接受 feishu-1shot 这个高价值 feature，建立信任，再推私货。

---

## 总体里程碑

| 阶段 | 产出 | 状态 |
|---|---|---|
| M1: Fork + dev | dev 分支 push 到 fork | ✅ 完成 |
| M2: feishu-1shot 集成方案 | 本文档 Step 3 | ✅ 完成（文档） |
| M3: feishu-1shot 代码实现 | `modules/channels/feishu/one-shot/` | ⏳ 待 vicki 授权开干 |
| M4: 测试 & docs | 3 个 case + `docs/feishu-1shot-integration.md` | ⏳ |
| M5: 提 PR #1 | feishu-1shot feat | ⏳ |
| M6: 等 PR #1 合并 | —— | ⏳ |
| M7: 邀请注册按钮方案→代码 | Step 4 | ⏳ |
| M8: 提 PR #2 | provider presets | ⏳ |

## 下一步建议（给 vicki 决策）

1. **先动手 M3（feishu-1shot 代码实现）还是先提 Issue 探作者态度？** 推荐先开 issue 标题 "Proposal: integrate feishu-1shot for one-click Feishu bot creation"，等作者 +1 再写代码，避免白干。
2. **邀请码清单 referral-codes.md 的邀请码 vicki 本人去哪几家拿？** OpenRouter/MiniMax/SiliconFlow/Zhipu 这 4 家价值最高，建议今晚 10 分钟扫一遍后台。
3. **是否要把 feishu-1shot 先发 npm？** 如果作者不喜欢跨仓依赖，可预先发 `@vickioo/feishu-1shot@1.0.0` 到 npm，PR 里引用 npm 版本，作者合并压力小。
