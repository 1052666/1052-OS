# 麦当劳 MCP Skill

将麦当劳 MCP 服务转换为可复用的命令行工具和技能。

[中文](#中文) | [English](#english)

---

## 中文

### 📖 项目简介

这是一个将麦当劳模型上下文协议（MCP）服务转换为可复用 Skill 的工具。通过本地 CLI，您可以轻松地测试、调用和集成麦当劳 MCP 服务（`https://mcp.mcd.cn`）的各种功能。

### 🌟 功能特性

- **MCP 转 Skill**：将远程 MCP 服务封装为本地可执行的技能
- **初始化测试**：验证 MCP 服务连接和身份认证
- **列出工具**：发现可用的 MCP 工具及其功能
- **调用工具**：使用自定义参数执行任何 MCP 工具
- **冒烟测试**：运行自动化端到端测试并输出 JSON 结果
- **灵活认证**：支持环境变量或命令行 token

### 📋 环境要求

- Python 3.7+
- `requests` 库

### 🚀 快速开始

1. **克隆仓库**
```bash
git clone https://github.com/1052/mcdonalds-skill.git
cd mcdonalds-skill
```

2. **安装依赖**
```bash
pip install requests
```

3. **获取 token**

访问 [https://open.mcd.cn/mcp](https://open.mcd.cn/mcp) 获取您的 MCP 访问令牌。

4. **配置认证**（推荐）
```bash
# Windows
set MCDONALDS_MCP_TOKEN=your_token_here

# Linux/Mac
export MCDONALDS_MCP_TOKEN=your_token_here
```

5. **运行测试**
```bash
python scripts/mcd_cli.py smoke-test
```

### 📖 使用方法

#### 初始化连接
```bash
python scripts/mcd_cli.py init --token YOUR_TOKEN
```

#### 列出可用工具
```bash
python scripts/mcd_cli.py list-tools --token YOUR_TOKEN
```

#### 调用特定工具
```bash
# 简单工具调用
python scripts/mcd_cli.py call --tool now-time-info --token YOUR_TOKEN

# 带参数的工具调用
python scripts/mcd_cli.py call --tool query-nearby-stores --args "{\"keyword\":\"鸡腿堡\"}" --token YOUR_TOKEN
```

#### 运行冒烟测试
```bash
python scripts/mcd_cli.py smoke-test --token YOUR_TOKEN --out ./results/
```

### ⚙️ 配置说明

#### 环境变量

- `MCDONALDS_MCP_TOKEN`：您的 MCP 认证令牌（必需）
- `MCDONALDS_MCP_URL`：MCP 服务 URL（可选，默认为 `https://mcp.mcd.cn`）

#### 命令行选项

所有命令都支持以下选项：
- `--token`：认证令牌（覆盖环境变量）
- `--url`：MCP 服务 URL（覆盖环境变量）

### 📝 命令参考

| 命令 | 说明 | 选项 |
|------|------|------|
| `init` | 初始化并验证 MCP 连接 | `--token`, `--url` |
| `list-tools` | 列出所有可用的 MCP 工具 | `--token`, `--url`, `--raw` |
| `call` | 执行特定的 MCP 工具 | `--token`, `--url`, `--tool`, `--args` |
| `smoke-test` | 运行自动化测试套件 | `--token`, `--url`, `--out` |

### 🔍 常见问题

**401/403 错误**：token 无效或已过期。请从 [https://open.mcd.cn/mcp](https://open.mcd.cn/mcp) 获取新的 token。

**JSON 解析错误**：确保 `--args` 参数是有效的 JSON 格式：
```bash
--args "{}"
--args "{\"key\":\"value\"}"
```

**工具未找到**：运行 `list-tools` 查看可用工具及其确切名称。

### 🏗️ 项目结构

```
mcdonalds-skill/
├── SKILL.md           # 技能说明文档
├── scripts/
│   └── mcd_cli.py    # 命令行工具主程序
└── README.md          # 本文档
```

### 📄 许可证

MIT 许可证 - 欢迎自由使用和修改。

### 🤝 贡献

欢迎贡献！请随时提交 Pull Request。

---

## English

### 📖 About

This project converts McDonald's Model Context Protocol (MCP) service into a reusable skill with a local CLI tool. It allows you to easily test, call, and integrate various features of the McDonald's MCP service (`https://mcp.mcd.cn`).

### 🌟 Features

- **MCP to Skill Conversion**: Wrap remote MCP service as a locally executable skill
- **Initialize & Test**: Verify MCP service connectivity and authentication
- **List Tools**: Discover available MCP tools and their capabilities
- **Call Tools**: Execute any MCP tool with custom parameters
- **Smoke Test**: Run automated end-to-end tests with JSON output
- **Flexible Auth**: Support for environment variables or command-line tokens

### 📋 Requirements

- Python 3.7+
- `requests` library

### 🚀 Quick Start

1. **Clone the repository**
```bash
git clone https://github.com/1052/mcdonalds-skill.git
cd mcdonalds-skill
```

2. **Install dependencies**
```bash
pip install requests
```

3. **Get your token**

Visit [https://open.mcd.cn/mcp](https://open.mcd.cn/mcp) to obtain your MCP access token.

4. **Set up authentication** (recommended)
```bash
# Windows
set MCDONALDS_MCP_TOKEN=your_token_here

# Linux/Mac
export MCDONALDS_MCP_TOKEN=your_token_here
```

5. **Run a test**
```bash
python scripts/mcd_cli.py smoke-test
```

### 📖 Usage

#### Initialize Connection
```bash
python scripts/mcd_cli.py init --token YOUR_TOKEN
```

#### List Available Tools
```bash
python scripts/mcd_cli.py list-tools --token YOUR_TOKEN
```

#### Call a Specific Tool
```bash
# Simple tool call
python scripts/mcd_cli.py call --tool now-time-info --token YOUR_TOKEN

# Tool call with parameters
python scripts/mcd_cli.py call --tool query-nearby-stores --args "{\"keyword\":\"burger\"}" --token YOUR_TOKEN
```

#### Run Smoke Test
```bash
python scripts/mcd_cli.py smoke-test --token YOUR_TOKEN --out ./results/
```

### ⚙️ Configuration

#### Environment Variables

- `MCDONALDS_MCP_TOKEN`: Your MCP authentication token (required)
- `MCDONALDS_MCP_URL`: MCP service URL (optional, defaults to `https://mcp.mcd.cn`)

#### Command-Line Options

All commands support the following options:
- `--token`: Authentication token (overrides environment variable)
- `--url`: MCP service URL (overrides environment variable)

### 📝 Commands Reference

| Command | Description | Options |
|---------|-------------|---------|
| `init` | Initialize and verify MCP connection | `--token`, `--url` |
| `list-tools` | List all available MCP tools | `--token`, `--url`, `--raw` |
| `call` | Execute a specific MCP tool | `--token`, `--url`, `--tool`, `--args` |
| `smoke-test` | Run automated test suite | `--token`, `--url`, `--out` |

### 🔍 Troubleshooting

**401/403 Error**: Invalid or expired token. Get a new token from [https://open.mcd.cn/mcp](https://open.mcd.cn/mcp)

**JSON Parse Error**: Ensure `--args` parameter is valid JSON format:
```bash
--args "{}"
--args "{\"key\":\"value\"}"
```

**Tool Not Found**: Run `list-tools` to see available tools and their exact names.

### 🏗️ Project Structure

```
mcdonalds-skill/
├── SKILL.md           # Skill documentation
├── scripts/
│   └── mcd_cli.py    # CLI tool main program
└── README.md          # This document
```

### 📄 License

MIT License - feel free to use and modify as needed.

### 🤝 Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

---

**Repository**: [https://github.com/1052/mcdonalds-skill](https://github.com/1052/mcdonalds-skill)
