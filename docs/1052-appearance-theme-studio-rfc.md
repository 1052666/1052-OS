# 1052 Appearance Theme Studio RFC

状态：Proposal  
日期：2026-04-25  
建议简称：`Appearance Theme Studio`

## 0. 本文定位

本文提出一个面向 1052 OS 的受控主题 profile 系统。长期方向可以支持 1052 Agent 根据图片和文字描述生成外观方案，但首版不做“Agent 生成主题”的大功能，而是先把外观系统变成可验证、可回滚、可导入导出的配置资产。

这里的 Agent 指 1052 OS 项目内置的 1052 Agent，不是外部开发助手。

## 1. 范围收敛

首版定位：

> Controlled Theme Profile System

核心能力：

1. 导入 / 导出 Theme JSON。
2. 用户或开发者可以手写主题 profile。
3. 用户和 Agent 只提交 core token。
4. derived token 由代码生成。
5. 固定 mock preview matrix，不依赖真实业务数据。
6. 主题有安全等级：`safe` / `experimental` / `rejected`。
7. 最近 5 次已应用主题进入 apply history，方便回滚和试错。

暂不做：

- 不做背景图。
- 不让图片直接作为 UI 背景。
- 不让视觉模型直接输出 CSS/color token。
- 不暴露能直接改 UI 的 Agent apply 工具。
- 不允许 raw CSS、selector、layout token。

## 2. 背景

1052 OS 已经具备以下基础：

- 前端主题使用 CSS variables，例如 `--bg`、`--surface-1`、`--fg`、`--accent`。
- 当前已有 `dark` / `light` / `auto` 主题模式。
- 已有 Settings 页面集中管理模型、图像生成、Agent 行为和外观。
- 已有 Agent progressive disclosure / pack 机制，后续可以扩展 `appearance-pack`。

因此 Theme Studio 不需要重做 UI 框架。它应该在现有主题变量、设置系统和 Agent pack 基础上扩展。

## 3. 目标

1. 把外观主题变成可导入、可导出、可审查、可回滚的配置资产。
2. 用硬性规则防止 UI 冲突、模块重叠、文字不可读和任意 CSS 注入。
3. 让后续 Agent 生成主题时也复用同一份 Theme JSON contract。
4. 让主题预览使用固定 mock 内容，不读取真实聊天、SQL、Wiki 或用户数据。
5. 在用户确认后才应用主题。

## 4. 非目标

首版不做以下内容：

- 不允许 Agent 或用户生成 raw CSS。
- 不允许 selector、className、style tag、layout rule。
- 不允许修改 `position`、`display`、`z-index`、`margin`、`padding`、页面宽高等布局字段。
- 不支持背景图。图片后续只用于 palette extraction，不直接当 UI 背景。
- 不默认把用户上传图片发送给云端视觉模型。
- 不承诺一次性适配所有页面的视觉细节；首版通过固定 preview matrix 覆盖关键组件状态。

## 5. 工程原则

### 5.1 工程上走 runtime harness

主题变更是 UI 副作用，必须经过：

```text
import/create -> derive -> validate -> preview -> confirm -> apply -> history/reset
```

后续 1052 Agent 可以参与生成 draft，但不能直接发布。

### 5.2 功能上解耦

建议拆成独立职责：

- Theme JSON import/export
- core token normalization
- derived token generation
- hard validation
- safety level classification
- fixed preview matrix
- apply / reset / apply history
- Agent tools

### 5.3 判断分离

LLM 可以判断“冷色、低饱和、偏科技、强调 cyan”。代码必须负责：

- token 合法性
- derived token 生成
- 对比度
- 安全等级
- apply gate
- history / reset

不要让模型直接输出 CSS 或最终 token。

## 6. 上下游影响

### 6.1 上游

- Settings：Theme profile 应进入外观区域。
- Theme JSON：首版支持导入 / 导出。
- Agent Pack：后续新增 `appearance-pack`，不进入 base pack。
- 视觉模型：未来只输出 style intent，不输出 CSS/color token。

### 6.2 下游

- CSS variables：只覆盖白名单 token。
- Chat / Sidebar / Settings / Markdown / SQL 等使用固定 mock preview。
- App 默认主题不能被破坏；reset default 必须可用。
- apply 必须有确认 gate。
- 失败不能覆盖当前 active theme。

## 7. 数据结构草案

### 7.1 Core Token

用户、开发者或 Agent 首版只允许提交 core token：

```ts
export type ThemeCoreTokenSet = {
  bg: string
  surface: string
  fg: string
  accent: string
  success: string
  danger: string
}
```

要求：

- 必须是合法颜色。
- 首版必须是纯色，不允许透明色。
- 不允许 CSS variable、CSS function、selector 或 raw CSS。

### 7.2 Derived Token

derived token 由代码生成：

```ts
export type ThemeDerivedTokenSet = {
  bgGrad1: string
  bgGrad2: string
  surface0: string
  surface1: string
  surface2: string
  surface3: string
  surfaceHover: string
  hairline: string
  hairline2: string
  hairlineStrong: string
  fg2: string
  fg3: string
  fg4: string
  accent2: string
  accentSoft: string
  accentRing: string
}
```

用户或 Agent 不直接编辑 derived token，避免乱配导致不可读。

### 7.3 ThemeSpec

```ts
export type ThemeSafetyLevel = 'safe' | 'experimental' | 'rejected'

export type ThemeSpec = {
  schemaVersion: 1
  name: string
  mode: 'dark' | 'light'
  scope: 'chat' | 'workspace' | 'brief' | 'all'
  safetyLevel: ThemeSafetyLevel
  coreTokens: ThemeCoreTokenSet
  tokens: ThemeCoreTokenSet & ThemeDerivedTokenSet
}
```

### 7.4 Apply History

```ts
export type AppearanceApplyHistoryEntry = {
  profileId: string
  themeName: string
  safetyLevel: ThemeSafetyLevel
  appliedAt: number
}
```

建议保留最近 5 个已应用主题。

## 8. 安全等级

### safe

- 只改颜色 token。
- 无背景图。
- 无透明 core token。
- 通过最低对比度检查。
- 可进入固定 preview，并在用户确认后应用。

### experimental

保留给未来能力，例如：

- 更强烈的风格偏移。
- 未来背景图或高透明度。
- 需要更严格确认。

### rejected

- raw CSS / selector / layout token。
- 背景图字段出现在首版 Theme JSON。
- 对比度失败。
- core token 非法或缺失。
- 不可应用。

## 9. 硬性校验规则

这些规则必须由代码执行：

- 只能导入 `name`、`mode`、`scope`、`coreTokens`。
- 可接受导出的 `tokens` 字段用于兼容再导入，但忽略用户提交的 derived token。
- 拒绝 raw CSS、selector、style tag、className。
- 拒绝 layout token，例如 `display`、`position`、`zIndex`、`fontSize`、`width`、`height`、`margin`、`padding`。
- 拒绝 `background` 字段。
- core token 必须是合法纯色。
- `fg` vs `bg`、`fg` vs `surface1`、`accent/success/danger` vs `surface1` 必须过最低对比度。
- `rejected` 主题不能 apply。

## 10. Preview Matrix

Preview Matrix 必须使用固定 mock 内容，不依赖真实业务数据。

首批建议覆盖：

- Sidebar active item
- Chat user / assistant bubble
- Markdown paragraph / code / table / blockquote
- Settings form row
- SQL table mock
- Notification success / error

固定 mock 的原因：

- 避免读取真实聊天或 SQL 结果。
- 避免预览随业务数据漂移。
- 避免泄露用户内容。

## 11. API 草案

```text
GET    /api/appearance/themes
POST   /api/appearance/themes/review
POST   /api/appearance/themes
DELETE /api/appearance/themes/:id
POST   /api/appearance/themes/:id/apply
POST   /api/appearance/themes/reset
```

`apply` 和 `reset` 必须携带显式确认：

```ts
type ApplyThemeRequest = {
  confirmed: true
  allowExperimental?: boolean
}

type ResetThemeRequest = {
  confirmed: true
}
```

`experimental` 主题必须额外携带 `allowExperimental: true`，`rejected` 主题不能应用。

首版不需要 SSE，也不需要图片上传。

## 12. Agent 工具草案

后续如果暴露给 1052 Agent，工具名称应更保守：

```ts
'appearance-pack': [
  'appearance_theme_create_draft',
  'appearance_theme_preview_draft',
  'appearance_theme_request_apply',
]
```

语义：

- `appearance_theme_create_draft`：生成受控 draft，不改当前 UI。
- `appearance_theme_preview_draft`：生成固定 mock preview 和 review report。
- `appearance_theme_request_apply`：请求应用，但后端仍检查 safety level 和用户确认。

不使用听起来可以直接改 UI 的工具名。

## 13. 视觉模型增强

后续视觉模型只输出 style intent：

```ts
type ThemeStyleIntent = {
  temperature: 'cool' | 'warm' | 'neutral'
  saturation: 'low' | 'medium' | 'high'
  mood: string[]
  suggestedAccent: string
}
```

代码再把 intent 转换为 core token，并继续走 derived token、review、preview、apply gate。

## 14. 建议 PR 拆分

### PR 1：Controlled Theme Profile System

- Theme JSON import/export。
- core token contract。
- derived token generation。
- safety level。
- apply history 最近 5 个。
- Settings 外观区管理入口。
- 不接 AI、不接图片。

### PR 2：Fixed Preview Matrix

- 用固定 mock 内容展示核心 UI 状态。
- 不依赖真实业务数据。
- 增加更完整的 preview surface。

### PR 3：Agent Draft Tools

- 暴露 `create_draft` / `preview_draft` / `request_apply`。
- 不允许 Agent 直接 apply。

### PR 4：Image Palette / Style Intent

- 图片只用于 palette extraction。
- 视觉模型只输出 style intent。
- 不把图片直接作为 UI 背景。

## 15. 推荐首刀

建议第一刀只做：

> Controlled Theme Profile System: contract, import/export, derived tokens, safety level, apply history, reset.

这能先建立受控主题资产边界，后续再接入图片、Agent tools、流式生成和视觉模型增强。
