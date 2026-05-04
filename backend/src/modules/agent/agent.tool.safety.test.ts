import { describe, expect, it } from 'vitest'
import { classifyToolSafety, isWriteOperation } from './agent.tool.safety.js'

describe('classifyToolSafety', () => {
  it('classifies read-only inspection tools as read', () => {
    const readOnlyNames = [
      'agent_runtime_status',
      'agent_llm_local_model_scan',
      'filesystem_stat_path',
      'filesystem_list_directory',
      'filesystem_search_files',
      'filesystem_search_content',
      'filesystem_read_file',
      'memory_list',
      'memory_read',
      'memory_summary',
      'memory_runtime_preview',
      'memory_suggestions_list',
      'memory_secure_list',
      'memory_secure_read',
      'repository_list_repos',
      'repository_read_repo',
      'repository_read_file',
      'schedule_list_tasks',
      'schedule_list_runs',
      'skills_list',
      'skills_read',
      'skills_marketplace_search',
      'skills_marketplace_inspect',
      'terminal_status',
      'terminal_run_readonly',
      'uapis_list_apis',
      'uapis_read_api',
      'websearch_list_engines',
      'websearch_search',
      'websearch_read_page',
      'wechat_desktop_list_sessions',
      'wechat_group_list',
      'wechat_group_memory_list',
      'wiki_summary',
      'wiki_raw_list',
      'wiki_raw_read',
      'wiki_page_search',
      'wiki_page_read',
      'wiki_lint_preview',
      'wiki_ingest_preview',
      'pkm_search',
      'pkm_summary',
      'notes_list_notes',
      'notes_read_note',
      'resources_list',
      'resources_read',
      'output_profile_list',
      'output_profile_read',
      'output_profile_summary',
      'output_profile_runtime_preview',
      'calendar_list_events',
      'feishu_list_calendars',
      'feishu_list_calendar_events',
      'feishu_list_tasks',
      'sql_datasource_list',
      'sql_file_list',
      'sql_shell_file_list',
      'sql_variable_list',
      'sql_server_list',
      'orchestration_list',
      'orchestration_logs',
    ]

    for (const name of readOnlyNames) {
      expect(classifyToolSafety(name), `expected ${name} to be classified as read`).toBe('read')
    }
  })

  it('classifies mutation and external-side-effect tools as write', () => {
    const writeNames = [
      // filesystem
      'filesystem_create_directory',
      'filesystem_create_file',
      'filesystem_write_file',
      'filesystem_replace_in_file',
      'filesystem_replace_lines',
      'filesystem_insert_lines',
      'filesystem_move_path',
      'filesystem_copy_path',
      'filesystem_delete_path',
      // memory
      'memory_create',
      'memory_update',
      'memory_delete',
      'memory_confirm_suggestion',
      'memory_reject_suggestion',
      'memory_secure_write',
      'memory_secure_update',
      'memory_secure_delete',
      // agent/settings
      'agent_morning_brief_update',
      'agent_llm_activate_profile',
      'agent_llm_set_task_route',
      // wiki
      'wiki_raw_upload_from_agent_workspace',
      'wiki_page_write',
      'wiki_page_append_section',
      'wiki_ingest_commit',
      'wiki_query_writeback',
      'wiki_lint_fix',
      'wiki_index_rebuild',
      'wiki_log_append',
      // output profile
      'output_profile_create',
      'output_profile_update',
      'output_profile_delete',
      // calendar
      'calendar_create_event',
      'calendar_update_event',
      'calendar_delete_event',
      // schedule
      'schedule_create_task',
      'schedule_update_task',
      'schedule_delete_task',
      // SQL
      'sql_datasource_create',
      'sql_datasource_update',
      'sql_datasource_delete',
      'sql_file_create',
      'sql_file_update',
      'sql_file_delete',
      'sql_variable_create',
      'sql_variable_update',
      'sql_variable_delete',
      'sql_server_create',
      'sql_server_update',
      'sql_server_delete',
      'sql_shell_file_create',
      'sql_shell_file_update',
      'sql_shell_file_delete',
      'sql_shell_file_execute',
      'sql_query',
      // orchestration
      'orchestration_create',
      'orchestration_update',
      'orchestration_delete',
      'orchestration_execute',
      // terminal
      'terminal_run',
      'terminal_interrupt',
      'claude_code',
      // skills
      'skills_create',
      'skills_delete',
      // websearch / uapis config
      'websearch_set_source_enabled',
      'uapis_set_api_enabled',
      'uapis_bulk_set_enabled',
      'uapis_call',
      // image / pkm / intel
      'image_generate',
      'pkm_reindex',
      // wechat
      'wechat_desktop_send_message',
      'wechat_group_memory_write',
      // feishu
      // (none of the current feishu tools are writes, but futures `feishu_send_message`
      //  would be caught by _send pattern — exercised in the pattern test below)
    ]

    for (const name of writeNames) {
      expect(classifyToolSafety(name), `expected ${name} to be classified as write`).toBe('write')
    }
  })

  it('isWriteOperation returns a boolean shortcut', () => {
    expect(isWriteOperation('filesystem_read_file')).toBe(false)
    expect(isWriteOperation('filesystem_write_file')).toBe(true)
    expect(isWriteOperation('terminal_run')).toBe(true)
    expect(isWriteOperation('terminal_run_readonly')).toBe(false)
  })

  it('pattern-matches future hypothetical tool names', () => {
    expect(classifyToolSafety('feishu_send_message')).toBe('write')
    expect(classifyToolSafety('some_future_purge_records')).toBe('write')
    expect(classifyToolSafety('some_future_reset_counters')).toBe('write')
    expect(classifyToolSafety('some_future_list_archives')).toBe('read')
  })
})
