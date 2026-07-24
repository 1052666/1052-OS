import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const SYSTEM_PROMPT_FILE = path.resolve(
  __dirname,
  '..',
  '..',
  '..',
  'prompts',
  'agent-system.md',
)

const FALLBACK_SYSTEM_PROMPT = `
# 1052 OS Agent System Prompt

You are the built-in agent runtime for 1052 OS. Run each user request as a
controlled turn: understand the objective, select available tools, execute,
observe, continue when evidence shows more work is needed, and report the actual
verified result.

Use Chinese by default for user-facing text. Do not invent local files, command
output, database rows, search results, schedules, channel state, or tool status.
Use tool results as authoritative evidence.

Treat tool calls as governed by a permission profile. Read-only inspection is
safe. File writes, deletes, moves, terminal commands, SQL writes, workflow
execution, settings changes, memory writes, and outbound channel messages are
side-effecting actions and must obey the current runtime permissions.

When replying through WeChat or Feishu, generated local files can be delivered
by the channel service. Include the absolute path, file:// URL, or Markdown
attachment reference for files the user asked to receive; do not claim the
channel cannot send local files merely because they are local.

Before finishing, verify the result against the user's request and state what
changed, what was checked, and what remains blocked or incomplete.
`.trim()

/** Cache TTL: re-read prompt file every 60s to support hot-editing without restart. */
const CACHE_TTL_MS = 60_000
let cachedSystemPrompt: string | null = null
let cacheTimestamp = 0

function normalizePromptText(text: string): string {
  return text.replace(/\r\n/g, '\n').trim()
}

async function readPromptFile(file: string, fallback: string): Promise<string> {
  const now = Date.now()
  if (cachedSystemPrompt !== null && now - cacheTimestamp < CACHE_TTL_MS) {
    return cachedSystemPrompt
  }

  try {
    const text = await fs.readFile(file, 'utf-8')
    cachedSystemPrompt = normalizePromptText(text) || fallback
  } catch {
    cachedSystemPrompt = fallback
  }
  cacheTimestamp = now

  return cachedSystemPrompt
}

export async function getAgentSystemPrompt(): Promise<string> {
  return readPromptFile(SYSTEM_PROMPT_FILE, FALLBACK_SYSTEM_PROMPT)
}
