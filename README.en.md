# 1052 OS (English)

> This is an English quick-start version of the README. The Chinese README remains the most complete reference for now.

1052 OS is a local-first, tool-driven AI agent workspace that combines chat, file operations, repositories, notes, resources, memory, web search, skills, scheduling, notifications, social channels (WeChat/Feishu/WeCom), image generation, SQL tools, and visual orchestration in one desktop-like interface.

## Quick Start

### 1) Install dependencies

```bash
npm install
npm --prefix backend install
npm --prefix frontend install
```

### 2) Run development servers

```bash
npm run dev
```

By default:
- Frontend: `http://localhost:5173`
- Backend: `http://localhost:3000`

## Minimum setup

Open the **Settings** page and configure at least:
- LLM Base URL
- Model ID
- API Key

## New: Settings language option

The Settings panel now supports interface language selection:
- `中文 (zh-CN)`
- `English (en-US)`

Path: **Settings → Appearance → Interface Language**.

## Features

- Local-first data storage under `data/`
- Multi-model routing via OpenAI-compatible endpoints
- Built-in image generation settings
- Tooling support (files, notes, resources, repository, schedule, notifications)
- Skill center and UAPIs toolbox
- Optional full-access mode for agent automation

## Documentation

- Full documentation (Chinese): [README.md](./README.md)
- License: [LICENSE](./LICENSE)

## Community

- GitHub: https://github.com/1052666/1052-OS
- Telegram: https://t.me/OS1052
