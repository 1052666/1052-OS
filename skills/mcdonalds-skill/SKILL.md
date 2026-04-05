---
name: mcdonalds-mcp
description: Use when the user wants to connect to, test, or use the McDonalds MCP service at mcp.mcd.cn, including checking authentication, probing MCP endpoints, listing tools, or calling McDonalds MCP tools through a reusable local CLI.
---

# 麦当劳 MCP 技能

## 适用场景
当用户想把麦当劳 MCP 接入为可复用能力，或需要检查 `https://mcp.mcd.cn` 这个远程 MCP 服务是否可连通、鉴权是否有效、是否能正常初始化、列出工具、以及执行具体工具调用时使用。

## 能力概览
这个技能现在已经升级成**可执行技能**，提供了一个本地 CLI：
- 初始化并测试握手
- 列出 MCP 工具
- 调用任意工具
- 一键运行 smoke test
- 将测试结果输出为 JSON 文件，便于复查

## 目录结构
- `SKILL.md`：技能说明
- `scripts/mcd_cli.py`：命令行工具

## 服务信息
- 服务名：`mcdonalds`
- 类型：HTTP MCP
- URL：`https://mcp.mcd.cn`
- 鉴权：`Authorization: Bearer <token>`

## 推荐配置
优先使用环境变量：
- `MCDONALDS_MCP_TOKEN`
- 可选：`MCDONALDS_MCP_URL`（默认 `https://mcp.mcd.cn`）

也支持命令行显式传入 token。

## 常用命令
在 `kills/mcdonalds-mcp/` 下执行：

```bash
python scripts/mcd_cli.py init --token YOUR_TOKEN
python scripts/mcd_cli.py list-tools --token YOUR_TOKEN
python scripts/mcd_cli.py call --token YOUR_TOKEN --tool now-time-info
python scripts/mcd_cli.py call --token YOUR_TOKEN --tool query-nearby-stores --args "{}"
python scripts/mcd_cli.py smoke-test --token YOUR_TOKEN --out D:/
```

如果已经设置环境变量，则可以省略 `--token`：

```bash
set MCDONALDS_MCP_TOKEN=YOUR_TOKEN
python scripts/mcd_cli.py smoke-test
```

## 命令说明
### 1. init
发送标准 `initialize` 请求，验证：
- URL 是否可达
- token 是否有效
- MCP 初始化是否成功

### 2. list-tools
调用 `tools/list`，返回可用工具列表。
默认会做适度摘要，避免终端刷屏；如需完整原始结果可加 `--raw`。

### 3. call
调用任意工具：
- `--tool <工具名>` 必填
- `--args '<json对象>'` 可选，默认 `{}`

### 4. smoke-test
自动执行：
1. `initialize`
2. `tools/list`
3. 选择一个默认测试工具（优先 `now-time-info`）做真实调用
4. 输出汇总 JSON

## 常见判断
- 返回 `200` 且有 JSON-RPC `result`：服务基本可用
- 返回 `401/403`：通常是 token 无效或无权限
- 返回 JSON-RPC `error`：服务可达，但请求参数或方法不对
- 中文显示异常：通常是终端编码问题，不一定影响 MCP 功能

## 常见报错排查
### token 缺失
请传 `--token`，或者设置环境变量 `MCDONALDS_MCP_TOKEN`。

### JSON 参数格式错误
`--args` 必须是合法 JSON 对象，例如：
```bash
--args "{}"
--args "{\"keyword\":\"鸡腿堡\"}"
```

### 工具调用失败
先运行：
```bash
python scripts/mcd_cli.py list-tools --token YOUR_TOKEN
```
确认工具名存在，再检查该工具所需参数。

## 设计原则
- 不把 token 写死到技能文件或脚本中
- 默认输出真实 MCP 返回，避免“口头成功”

## 获取token
请让用户在这个网址获取token：https://open.mcd.cn/mcp
如果没有环境变量的话，优先配置环境变量，获取token之后

