/**
 * Tool safety classification.
 *
 * Classifies every agent tool as either `read` (safe side-effect-free inspection)
 * or `write` (performs a mutation, external call with side effects, or irrevocable
 * action). Consumers use this:
 *
 * - Backend: emit a `dangerous` flag on `tool-started` events so the UI can show
 *   a warning badge when a write tool runs, independent of `fullAccess`.
 * - Backend (future): gate auto-injection of `confirmed: true` in `fullAccess`
 *   mode so destructive tools still require an explicit confirmation step.
 *
 * Classification is deterministic, name-based, and does NOT read tool metadata,
 * so it stays trivial to audit in code review and stays stable across refactors.
 * The logic is:
 *
 *   1. If the name is in `READ_ONLY_OVERRIDES`, return 'read'.
 *   2. If the name is in `WRITE_OVERRIDES`, return 'write'.
 *   3. If the name matches any `WRITE_PATTERNS` regex, return 'write'.
 *   4. Otherwise default to 'read'.
 *
 * When in doubt, prefer adding a name to `WRITE_OVERRIDES` — false-positive
 * warnings are cheap, missed-warnings are not.
 */

/** Tools whose names happen to match a write pattern but are actually read-only. */
const READ_ONLY_OVERRIDES: ReadonlySet<string> = new Set([
  // `schedule_list_runs` — ends with `_runs`, not `_run`, but `_run` substring match would mis-fire.
  'schedule_list_runs',
  // `memory_suggest` creates a PENDING suggestion that requires follow-up user confirmation
  // to actually persist anything. It is effectively a read-side scaffolding op.
  'memory_suggest',
  // `intel_center_collect` pulls external data into a preview buffer; it does not write
  // into any persistent store of the agent.
  'intel_center_collect',
  // `intel_brief_format` is a pure render operation.
  'intel_brief_format',
  // Explicit read-only terminal runner variant; the generic `_run` write pattern
  // intentionally catches the unrestricted `terminal_run` tool.
  'terminal_run_readonly',
])

/**
 * Tools that do NOT match any pattern but still need to be treated as writes
 * because they have non-trivial side effects (external calls, quota consumption,
 * server mutations, irreversible rejections, etc.).
 */
const WRITE_OVERRIDES: ReadonlySet<string> = new Set([
  // Runs arbitrary terminal commands — obvious write vector.
  'terminal_run',
  // Cancels a running terminal process — interrupts long-running work.
  'terminal_interrupt',
  // Runs Claude Code CLI which may spawn subprocesses, edit files, commit git, etc.
  'claude_code',
  // Executes SQL against configured data sources; the SQL itself can be DDL/DML.
  'sql_query',
  // Calls external UAPIs; many APIs are stateful or quota-consuming.
  'uapis_call',
  // Generates an image, consuming paid quota and producing a file on disk.
  'image_generate',
  // Promotes a pending suggestion to a persisted confirmed memory.
  'memory_confirm_suggestion',
  // Rejects a pending memory suggestion, which deletes it irreversibly.
  'memory_reject_suggestion',
  // PKM index rebuild — rewrites on-disk index files.
  'pkm_reindex',
  // Activates a different LLM profile — changes subsequent agent behaviour globally.
  'agent_llm_activate_profile',
])

/**
 * Regex patterns matched against the full tool name. A match marks the tool
 * as a write operation. Each entry lists a couple of real tool examples that
 * it is expected to catch so reviewers can sanity-check the coverage.
 */
const WRITE_PATTERNS: readonly RegExp[] = [
  // Common verb suffixes that imply mutation.
  // e.g. filesystem_write_file, memory_create, schedule_update_task, memory_delete,
  //      sql_datasource_create, wiki_page_write, wiki_log_append, wiki_ingest_commit,
  //      wiki_lint_fix, wiki_index_rebuild, wiki_query_writeback
  /_(write|create|update|delete|commit|fix|rebuild|writeback|upload|reset|drop|purge|truncate)(_|$)/,
  // e.g. filesystem_replace_in_file, filesystem_insert_lines, filesystem_move_path,
  //      filesystem_copy_path, wiki_page_append_section, filesystem_append_to_file
  /_(replace|insert|move|copy|append)(_|$)/,
  // e.g. sql_shell_file_execute, terminal_run, orchestration_execute, schedule_run_task
  /_(execute|run)(_|$)/,
  // e.g. wechat_desktop_send_message, feishu_send_message
  /_send(_|$)/,
  // e.g. websearch_set_source_enabled, uapis_set_api_enabled, uapis_bulk_set_enabled,
  //      agent_llm_set_task_route
  /_set(_|$)/,
  // Any *_secure_* memory operation except the pure read ones — conservatively marked
  // as writes because the values are sensitive. The read-only names are
  // `memory_secure_list` and `memory_secure_read`, handled below by the negative lookahead.
  /_secure_(write|update|delete)(_|$)/,
]

/** Tool names that look like reads based on pattern but are declared as writes explicitly. */
export type ToolSafetyClass = 'read' | 'write'

/**
 * Classify a tool by name. Pure, deterministic, and has no runtime dependencies
 * so it is safe to call from anywhere in the backend (including tests).
 */
export function classifyToolSafety(name: string): ToolSafetyClass {
  if (READ_ONLY_OVERRIDES.has(name)) return 'read'
  if (WRITE_OVERRIDES.has(name)) return 'write'
  for (const pattern of WRITE_PATTERNS) {
    if (pattern.test(name)) return 'write'
  }
  return 'read'
}

/** Convenience predicate for consumers that only care about the boolean. */
export function isWriteOperation(name: string): boolean {
  return classifyToolSafety(name) === 'write'
}
