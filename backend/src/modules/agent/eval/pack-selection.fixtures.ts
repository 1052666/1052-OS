/**
 * Pack selection eval fixtures.
 *
 * Each entry defines:
 * - `input` — a representative user message
 * - `expectedPacks` — the pack(s) the P0 model should request via
 *   `request_context_upgrade`. Empty array means "no upgrade needed —
 *   base-read-pack alone suffices."
 * - `tag` — a short category for grouping metrics (e.g. 'repo', 'search',
 *   'memory', 'multi-pack', 'none').
 *
 * When maintaining this file, keep the total count at 50 ± 5 and ensure
 * every requestable pack appears as an expected target in at least 3 cases.
 */

import type { AgentPackName } from '../agent.runtime.types.js'

export type PackSelectionCase = {
  id: number
  input: string
  expectedPacks: Exclude<AgentPackName, 'base-read-pack'>[]
  tag: string
}

export const PACK_SELECTION_FIXTURES: PackSelectionCase[] = [
  // ── none (base-read-pack only) ─────────────────────────────────────
  { id: 1, input: '你好', expectedPacks: [], tag: 'none' },
  { id: 2, input: '1+1 等于几', expectedPacks: [], tag: 'none' },
  { id: 3, input: '用中文解释什么是 CQRS', expectedPacks: [], tag: 'none' },
  { id: 4, input: '把这段英文翻译成中文：The quick brown fox jumps over the lazy dog.', expectedPacks: [], tag: 'none' },

  // ── repo-pack ──────────────────────────────────────────────────────
  { id: 5, input: '帮我看一下项目根目录有什么文件', expectedPacks: ['repo-pack'], tag: 'repo' },
  { id: 6, input: '读一下 backend/src/index.ts 的内容', expectedPacks: ['repo-pack'], tag: 'repo' },
  { id: 7, input: '在终端运行 npm test 并告诉我结果', expectedPacks: ['repo-pack'], tag: 'repo' },
  { id: 8, input: '帮我创建一个 hello.py 文件，内容是 print("hello")', expectedPacks: ['repo-pack'], tag: 'repo' },
  { id: 9, input: 'git log 最近 5 条提交', expectedPacks: ['repo-pack'], tag: 'repo' },
  { id: 10, input: '用 claude_code 帮我把 utils.ts 里的 bug 修了', expectedPacks: ['repo-pack'], tag: 'repo' },

  // ── search-pack ────────────────────────────────────────────────────
  { id: 11, input: '搜索一下今天的科技新闻', expectedPacks: ['search-pack'], tag: 'search' },
  { id: 12, input: '帮我查一下 OpenAI 最新的 API 定价', expectedPacks: ['search-pack'], tag: 'search' },
  { id: 13, input: '打开这个网页 https://example.com 帮我看看内容', expectedPacks: ['search-pack'], tag: 'search' },
  { id: 14, input: '调用天气 API 查一下北京现在的天气', expectedPacks: ['search-pack'], tag: 'search' },
  { id: 15, input: '用 UAPIs 调用翻译接口翻译这段话', expectedPacks: ['search-pack'], tag: 'search' },

  // ── memory-pack ────────────────────────────────────────────────────
  { id: 16, input: '记住：我喜欢用 markdown 格式输出', expectedPacks: ['memory-pack'], tag: 'memory' },
  { id: 17, input: '列出我所有的长期记忆', expectedPacks: ['memory-pack'], tag: 'memory' },
  { id: 18, input: '删除 ID 为 abc123 的记忆', expectedPacks: ['memory-pack'], tag: 'memory' },
  { id: 19, input: '把我的 OpenAI API Key 存成安全记忆', expectedPacks: ['memory-pack'], tag: 'memory' },
  { id: 20, input: '创建一个输出配方，用分析师风格', expectedPacks: ['memory-pack'], tag: 'memory' },
  { id: 21, input: '查看待确认的记忆建议', expectedPacks: ['memory-pack'], tag: 'memory' },

  // ── image-pack ─────────────────────────────────────────────────────
  { id: 22, input: '帮我生成一张猫咪的插画', expectedPacks: ['image-pack'], tag: 'image' },
  { id: 23, input: '画一个科技感的 Logo', expectedPacks: ['image-pack'], tag: 'image' },
  { id: 24, input: '设计一张公众号封面图', expectedPacks: ['image-pack'], tag: 'image' },

  // ── skill-pack ─────────────────────────────────────────────────────
  { id: 25, input: '查一下我安装了哪些 Skill', expectedPacks: ['skill-pack'], tag: 'skill' },
  { id: 26, input: '在 Skill Marketplace 搜索 "翻译"', expectedPacks: ['skill-pack'], tag: 'skill' },
  { id: 27, input: '用 Intel Center 采集一下今天的全球情报', expectedPacks: ['skill-pack'], tag: 'skill' },
  { id: 28, input: '生成今天的早报', expectedPacks: ['skill-pack'], tag: 'skill' },

  // ── settings-pack ──────────────────────────────────────────────────
  { id: 29, input: '切换到 gpt-4 模型', expectedPacks: ['settings-pack'], tag: 'settings' },
  { id: 30, input: '把早报时间改成每天早上 8 点', expectedPacks: ['settings-pack'], tag: 'settings' },
  { id: 31, input: '设置 agent-chat 任务使用 claude-sonnet 模型', expectedPacks: ['settings-pack'], tag: 'settings' },

  // ── plan-pack ──────────────────────────────────────────────────────
  { id: 32, input: '帮我创建一个明天下午 3 点的会议', expectedPacks: ['plan-pack'], tag: 'plan' },
  { id: 33, input: '查看我这周的日程', expectedPacks: ['plan-pack'], tag: 'plan' },
  { id: 34, input: '列出所有定时任务', expectedPacks: ['plan-pack'], tag: 'plan' },
  { id: 35, input: '在 PKM 中搜索 "项目架构"', expectedPacks: ['plan-pack'], tag: 'plan' },

  // ── data-pack ──────────────────────────────────────────────────────
  { id: 36, input: '列出所有 SQL 数据源', expectedPacks: ['data-pack'], tag: 'data' },
  { id: 37, input: '执行 SQL: SELECT * FROM users LIMIT 10', expectedPacks: ['data-pack'], tag: 'data' },
  { id: 38, input: '查看 Wiki 知识库的健康状态', expectedPacks: ['data-pack'], tag: 'data' },
  { id: 39, input: '在 Wiki 中搜索 "API 设计规范"', expectedPacks: ['data-pack'], tag: 'data' },
  { id: 40, input: '列出我的笔记', expectedPacks: ['data-pack'], tag: 'data' },
  { id: 41, input: '帮我创建一个 MySQL 数据源连接', expectedPacks: ['data-pack'], tag: 'data' },

  // ── channel-pack ───────────────────────────────────────────────────
  { id: 42, input: '给张三发一条微信消息', expectedPacks: ['channel-pack'], tag: 'channel' },
  { id: 43, input: '列出微信桌面的会话', expectedPacks: ['channel-pack'], tag: 'channel' },
  { id: 44, input: '查看飞书日历', expectedPacks: ['channel-pack'], tag: 'channel' },

  // ── multi-pack ─────────────────────────────────────────────────────
  { id: 45, input: '搜索最新的 React 教程，然后保存链接到长期记忆', expectedPacks: ['search-pack', 'memory-pack'], tag: 'multi' },
  { id: 46, input: '读取项目代码然后生成一张架构图', expectedPacks: ['repo-pack', 'image-pack'], tag: 'multi' },
  { id: 47, input: '从 SQL 数据库查出销售数据，然后搜索行业对比', expectedPacks: ['data-pack', 'search-pack'], tag: 'multi' },
  { id: 48, input: '读一下 README 然后帮我写到 Wiki 里', expectedPacks: ['repo-pack', 'data-pack'], tag: 'multi' },
  { id: 49, input: '用 Intel Center 采集今日情报，然后发到微信群', expectedPacks: ['skill-pack', 'channel-pack'], tag: 'multi' },
  { id: 50, input: '查看我的记忆列表，帮我把过时的删掉，然后搜索相关新信息补充', expectedPacks: ['memory-pack', 'search-pack'], tag: 'multi' },
]
