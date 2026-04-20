# 1052 OS Agent Guidelines

This file documents collaboration rules for AI coding agents working on this repository.

## Scope

- Read the codebase before changing implementation.
- Keep frontend, backend, and runtime data clearly separated.
- Do not commit runtime data, logs, credentials, model keys, WeChat tokens, generated images, or local user files.
- Treat `data/` as a private runtime directory. It is created automatically by the backend.

## Development

- Frontend dev server: `http://localhost:10052`
- Backend dev server: `http://localhost:10053`
- Backend health check: `GET /api/health`

Recommended local commands:

```bash
cd backend
npm install
npm run build
npm run dev
```

```bash
cd frontend
npm install
npm run build
npm run dev
```

## Code Style

- Prefer TypeScript types over loose objects.
- Keep page-level React components focused on composition.
- Put reusable UI into `frontend/src/components/`.
- Put backend business logic into feature modules under `backend/src/modules/`.
- Keep Agent tool definitions explicit and safe.

## Safety

- File, note, resource, skill, memory, and terminal write operations should be explicit.
- Default mode should ask for user confirmation before high-risk writes or command execution.
- Full-access mode may bypass repeated confirmations, but the Agent should still report what it changed.

## Markdown

Chat content is rendered as Markdown. Keep support for:

- headings and lists
- tables
- task lists
- code blocks
- links and images
- math
- Mermaid diagrams
- folded `<think>...</think>` blocks
