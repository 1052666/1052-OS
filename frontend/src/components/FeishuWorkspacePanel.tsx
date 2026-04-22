import { useEffect, useState } from 'react'
import {
  SocialChannelsApi,
  type FeishuEventLog,
  type FeishuSyncJob,
  type FeishuWorkspaceConfig,
  type FeishuWorkspaceStatus,
} from '../api/social-channels'

type NoticeType = 'success' | 'error' | 'info'

type Props = {
  onNotice: (message: string, type?: NoticeType) => void
}

function formatTime(value?: number | string) {
  if (!value) return 'N/A'
  const timestamp = typeof value === 'number' ? value : Date.parse(value)
  if (!Number.isFinite(timestamp)) return 'N/A'
  return new Intl.DateTimeFormat('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(timestamp)
}

function formatJson(value: unknown) {
  try {
    return JSON.stringify(value, null, 2)
  } catch {
    return String(value)
  }
}

function statusTone(status: FeishuSyncJob['status']) {
  if (status === 'success') return 'success'
  if (status === 'failed') return 'error'
  return 'info'
}

const defaultAclJson = JSON.stringify(
  [{ type: 'user_id', value: 'all', permission: 'read' }],
  null,
  2,
)

const emptyConfig: FeishuWorkspaceConfig = {
  webBaseUrl: '',
  driveFolderToken: '',
  wikiSpaceId: '',
  wikiParentNodeToken: '',
  bitableAppToken: '',
  bitableTableId: '',
  searchDataSourceId: '',
  approvalCode: '',
  calendarId: '',
  enableNotificationCards: true,
  enableMemoryCards: true,
  enableScheduledTaskCards: true,
}

export function FeishuWorkspacePanel({ onNotice }: Props) {
  const [workspace, setWorkspace] = useState<FeishuWorkspaceStatus | null>(null)
  const [config, setConfig] = useState<FeishuWorkspaceConfig>(emptyConfig)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [busyAction, setBusyAction] = useState('')
  const [resultPreview, setResultPreview] = useState('')
  const [calendars, setCalendars] = useState<Array<Record<string, unknown>>>([])
  const [tasks, setTasks] = useState<Array<Record<string, unknown>>>([])
  const [dataSources, setDataSources] = useState<Array<Record<string, unknown>>>([])

  const [docTitle, setDocTitle] = useState('1052 OS Workspace Doc')
  const [docMarkdown, setDocMarkdown] = useState('# 1052 OS\n\nWrite your summary here.')
  const [notePath, setNotePath] = useState('')
  const [mountDocToken, setMountDocToken] = useState('')
  const [mountTitle, setMountTitle] = useState('')
  const [calendarSummary, setCalendarSummary] = useState('1052 OS Calendar')
  const [calendarDescription, setCalendarDescription] = useState('')
  const [taskSummary, setTaskSummary] = useState('1052 OS Task')
  const [taskDescription, setTaskDescription] = useState('')
  const [approvalName, setApprovalName] = useState('1052 OS Approval')
  const [approvalDescription, setApprovalDescription] = useState('')
  const [searchName, setSearchName] = useState('1052 OS Search')
  const [searchDescription, setSearchDescription] = useState('')
  const [searchAclJson, setSearchAclJson] = useState(defaultAclJson)

  const loadWorkspace = async () => {
    try {
      const [workspaceStatus, calendarList, taskList, searchList] = await Promise.all([
        SocialChannelsApi.feishuWorkspaceStatus(),
        SocialChannelsApi.feishuListCalendars().catch(() => ({ items: [] })),
        SocialChannelsApi.feishuListTasks().catch(() => ({ items: [] })),
        SocialChannelsApi.feishuListSearchDataSources().catch(() => ({ items: [] })),
      ])
      setWorkspace(workspaceStatus)
      setConfig({
        ...emptyConfig,
        ...workspaceStatus.config,
      })
      setCalendars(calendarList.items)
      setTasks(taskList.items)
      setDataSources(searchList.items)
    } catch (error) {
      const apiError = error as { message?: string }
      onNotice(apiError.message ?? '飞书工作区状态加载失败', 'error')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void loadWorkspace()
  }, [])

  const updateConfig = <K extends keyof FeishuWorkspaceConfig>(
    key: K,
    value: FeishuWorkspaceConfig[K],
  ) => {
    setConfig((current) => ({ ...current, [key]: value }))
  }

  const runAction = async (label: string, runner: () => Promise<unknown>) => {
    setBusyAction(label)
    try {
      const result = await runner()
      setResultPreview(formatJson(result))
      onNotice(`${label} 已完成`, 'success')
      await loadWorkspace()
    } catch (error) {
      const apiError = error as { message?: string }
      onNotice(apiError.message ?? `${label} 失败`, 'error')
    } finally {
      setBusyAction('')
    }
  }

  const saveConfig = async () => {
    setSaving(true)
    try {
      await SocialChannelsApi.saveFeishuWorkspaceConfig(config)
      onNotice('飞书工作区配置已保存', 'success')
      await loadWorkspace()
    } catch (error) {
      const apiError = error as { message?: string }
      onNotice(apiError.message ?? '飞书工作区配置保存失败', 'error')
    } finally {
      setSaving(false)
    }
  }

  const parseAcl = () => {
    const parsed = JSON.parse(searchAclJson) as unknown
    if (!Array.isArray(parsed)) {
      throw new Error('ACL 必须是 JSON 数组')
    }
    return parsed
  }

  return (
    <>
      <section className="social-layout workspace-layout">
        <div className="social-card">
          <div className="social-card-head">
            <div>
              <h2>飞书工作区配置</h2>
              <p>这里集中保存 Docs、Wiki、Bitable、Search Connector、Approval 和 Calendar 需要的关键 Token。</p>
            </div>
            <div className="social-account-actions">
              <button className="secondary-btn" type="button" disabled={loading} onClick={() => void loadWorkspace()}>
                刷新
              </button>
              <button className="primary-btn" type="button" disabled={saving} onClick={() => void saveConfig()}>
                保存工作区
              </button>
            </div>
          </div>

          <div className="social-form">
            <label className="social-field">
              <span>Web Base URL</span>
              <input
                value={config.webBaseUrl ?? ''}
                onChange={(event) => updateConfig('webBaseUrl', event.target.value)}
                placeholder="https://your-domain.example.com"
              />
            </label>
            <label className="social-field">
              <span>Drive Folder Token</span>
              <input
                value={config.driveFolderToken ?? ''}
                onChange={(event) => updateConfig('driveFolderToken', event.target.value)}
                placeholder="fldcn..."
              />
            </label>
            <label className="social-field">
              <span>Wiki Space ID</span>
              <input
                value={config.wikiSpaceId ?? ''}
                onChange={(event) => updateConfig('wikiSpaceId', event.target.value)}
                placeholder="space..."
              />
            </label>
            <label className="social-field">
              <span>Wiki Parent Node Token</span>
              <input
                value={config.wikiParentNodeToken ?? ''}
                onChange={(event) => updateConfig('wikiParentNodeToken', event.target.value)}
                placeholder="wik..."
              />
            </label>
            <label className="social-field">
              <span>Bitable App Token</span>
              <input
                value={config.bitableAppToken ?? ''}
                onChange={(event) => updateConfig('bitableAppToken', event.target.value)}
                placeholder="bascn..."
              />
            </label>
            <label className="social-field">
              <span>Bitable Table ID</span>
              <input
                value={config.bitableTableId ?? ''}
                onChange={(event) => updateConfig('bitableTableId', event.target.value)}
                placeholder="tbl..."
              />
            </label>
            <label className="social-field">
              <span>Search Data Source ID</span>
              <input
                value={config.searchDataSourceId ?? ''}
                onChange={(event) => updateConfig('searchDataSourceId', event.target.value)}
                placeholder="search..."
              />
            </label>
            <label className="social-field">
              <span>Approval Code</span>
              <input
                value={config.approvalCode ?? ''}
                onChange={(event) => updateConfig('approvalCode', event.target.value)}
                placeholder="approval_..."
              />
            </label>
            <label className="social-field">
              <span>Calendar ID</span>
              <input
                value={config.calendarId ?? ''}
                onChange={(event) => updateConfig('calendarId', event.target.value)}
                placeholder="cal..."
              />
            </label>

            <div className="social-checks">
              <label>
                <input
                  type="checkbox"
                  checked={config.enableNotificationCards}
                  onChange={(event) =>
                    updateConfig('enableNotificationCards', event.target.checked)
                  }
                />
                <span>允许通知卡片</span>
              </label>
              <label>
                <input
                  type="checkbox"
                  checked={config.enableMemoryCards}
                  onChange={(event) => updateConfig('enableMemoryCards', event.target.checked)}
                />
                <span>允许长期记忆确认卡片</span>
              </label>
              <label>
                <input
                  type="checkbox"
                  checked={config.enableScheduledTaskCards}
                  onChange={(event) =>
                    updateConfig('enableScheduledTaskCards', event.target.checked)
                  }
                />
                <span>允许定时任务结果卡片</span>
              </label>
            </div>
          </div>
        </div>

        <div className="social-card">
          <div className="social-card-head">
            <div>
              <h2>最近同步状态</h2>
              <p>这里展示后端记录的飞书工作区任务和平台事件，方便确认 Docs、Wiki、Bitable、Approval、Search Connector 是否真正跑过。</p>
            </div>
          </div>

          <div className="workspace-summary-grid">
            <div className="social-metric">
              <span>最近任务</span>
              <strong>{workspace?.recentJobs.length ?? 0}</strong>
              <small>同步与创建操作的后端记录</small>
            </div>
            <div className="social-metric">
              <span>最近事件</span>
              <strong>{workspace?.recentEvents.length ?? 0}</strong>
              <small>飞书卡片动作、消息和平台事件摘要</small>
            </div>
            <div className="social-metric">
              <span>Calendars</span>
              <strong>{calendars.length}</strong>
              <small>当前应用可见的飞书日历数量</small>
            </div>
            <div className="social-metric">
              <span>Search Sources</span>
              <strong>{dataSources.length}</strong>
              <small>当前应用创建的搜索数据源数量</small>
            </div>
          </div>

          {resultPreview ? (
            <div className="workspace-result-panel">
              <div className="workspace-result-head">
                <strong>最近一次结果</strong>
              </div>
              <pre>{resultPreview}</pre>
            </div>
          ) : null}
        </div>
      </section>

      <section className="social-layout workspace-layout">
        <div className="social-card">
          <div className="social-card-head">
            <div>
              <h2>Docs / Wiki / Bitable</h2>
              <p>P2 的文档、知识库、多维表格能力都在这里，支持导入 Markdown、同步资源、同步笔记、同步长期记忆，以及挂载到 Wiki。</p>
            </div>
          </div>

          <div className="social-form">
            <label className="social-field">
              <span>Markdown 标题</span>
              <input value={docTitle} onChange={(event) => setDocTitle(event.target.value)} />
            </label>
            <label className="social-field">
              <span>Markdown 内容</span>
              <textarea
                rows={7}
                value={docMarkdown}
                onChange={(event) => setDocMarkdown(event.target.value)}
              />
            </label>
            <div className="workspace-button-row">
              <button
                className="primary-btn"
                type="button"
                disabled={busyAction === '导入 Markdown 文档'}
                onClick={() =>
                  void runAction('导入 Markdown 文档', () =>
                    SocialChannelsApi.feishuImportMarkdownDoc({
                      title: docTitle.trim(),
                      markdown: docMarkdown,
                    }),
                  )
                }
              >
                导入 Markdown 文档
              </button>
              <button
                className="secondary-btn"
                type="button"
                disabled={busyAction === '同步资源到文档'}
                onClick={() =>
                  void runAction('同步资源到文档', () =>
                    SocialChannelsApi.feishuSyncResourcesDoc(),
                  )
                }
              >
                同步资源到文档
              </button>
              <button
                className="secondary-btn"
                type="button"
                disabled={busyAction === '同步长期记忆到文档'}
                onClick={() =>
                  void runAction('同步长期记忆到文档', () =>
                    SocialChannelsApi.feishuSyncMemoryDoc(),
                  )
                }
              >
                同步长期记忆到文档
              </button>
            </div>

            <label className="social-field">
              <span>笔记路径（可选）</span>
              <input
                value={notePath}
                onChange={(event) => setNotePath(event.target.value)}
                placeholder="docs/example.md"
              />
            </label>
            <div className="workspace-button-row">
              <button
                className="secondary-btn"
                type="button"
                disabled={busyAction === '同步笔记到文档'}
                onClick={() =>
                  void runAction('同步笔记到文档', () =>
                    SocialChannelsApi.feishuSyncNotesDoc(notePath.trim() || undefined),
                  )
                }
              >
                同步笔记到文档
              </button>
              <button
                className="secondary-btn"
                type="button"
                disabled={busyAction === '同步资源到 Bitable'}
                onClick={() =>
                  void runAction('同步资源到 Bitable', () =>
                    SocialChannelsApi.feishuSyncResourcesBitable({
                      appToken: config.bitableAppToken || undefined,
                      tableId: config.bitableTableId || undefined,
                    }),
                  )
                }
              >
                同步资源到 Bitable
              </button>
            </div>

            <label className="social-field">
              <span>Document Token</span>
              <input
                value={mountDocToken}
                onChange={(event) => setMountDocToken(event.target.value)}
                placeholder="doccn..."
              />
            </label>
            <label className="social-field">
              <span>Wiki 标题（可选）</span>
              <input
                value={mountTitle}
                onChange={(event) => setMountTitle(event.target.value)}
                placeholder="1052 OS Wiki Doc"
              />
            </label>
            <button
              className="secondary-btn"
              type="button"
              disabled={busyAction === '挂载文档到 Wiki'}
              onClick={() =>
                void runAction('挂载文档到 Wiki', () =>
                  SocialChannelsApi.feishuMountDocToWiki({
                    documentToken: mountDocToken.trim(),
                    title: mountTitle.trim() || undefined,
                    spaceId: config.wikiSpaceId || undefined,
                    parentWikiToken: config.wikiParentNodeToken || undefined,
                  }),
                )
              }
            >
              挂载文档到 Wiki
            </button>
          </div>
        </div>

        <div className="social-card">
          <div className="social-card-head">
            <div>
              <h2>Calendar / Task / Approval / Search</h2>
              <p>P3 的协同能力集中在这里，包括共享日历、任务、审批定义以及 Search Connector 数据源和资源索引。</p>
            </div>
          </div>

          <div className="social-form">
            <label className="social-field">
              <span>Calendar 名称</span>
              <input
                value={calendarSummary}
                onChange={(event) => setCalendarSummary(event.target.value)}
              />
            </label>
            <label className="social-field">
              <span>Calendar 描述</span>
              <input
                value={calendarDescription}
                onChange={(event) => setCalendarDescription(event.target.value)}
              />
            </label>
            <button
              className="secondary-btn"
              type="button"
              disabled={busyAction === '创建飞书日历'}
              onClick={() =>
                void runAction('创建飞书日历', () =>
                  SocialChannelsApi.feishuCreateCalendar({
                    summary: calendarSummary.trim(),
                    description: calendarDescription.trim() || undefined,
                  }),
                )
              }
            >
              创建飞书日历
            </button>

            <label className="social-field">
              <span>Task 标题</span>
              <input value={taskSummary} onChange={(event) => setTaskSummary(event.target.value)} />
            </label>
            <label className="social-field">
              <span>Task 描述</span>
              <input
                value={taskDescription}
                onChange={(event) => setTaskDescription(event.target.value)}
              />
            </label>
            <button
              className="secondary-btn"
              type="button"
              disabled={busyAction === '创建飞书任务'}
              onClick={() =>
                void runAction('创建飞书任务', () =>
                  SocialChannelsApi.feishuCreateTask({
                    summary: taskSummary.trim(),
                    description: taskDescription.trim() || undefined,
                  }),
                )
              }
            >
              创建飞书任务
            </button>

            <label className="social-field">
              <span>Approval 名称</span>
              <input
                value={approvalName}
                onChange={(event) => setApprovalName(event.target.value)}
              />
            </label>
            <label className="social-field">
              <span>Approval 描述</span>
              <input
                value={approvalDescription}
                onChange={(event) => setApprovalDescription(event.target.value)}
              />
            </label>
            <button
              className="secondary-btn"
              type="button"
              disabled={busyAction === '创建飞书审批定义'}
              onClick={() =>
                void runAction('创建飞书审批定义', () =>
                  SocialChannelsApi.feishuCreateApprovalDefinition({
                    approvalCode: config.approvalCode || undefined,
                    approvalName: approvalName.trim(),
                    description: approvalDescription.trim() || undefined,
                  }),
                )
              }
            >
              创建飞书审批定义
            </button>

            <label className="social-field">
              <span>Search Data Source 名称</span>
              <input value={searchName} onChange={(event) => setSearchName(event.target.value)} />
            </label>
            <label className="social-field">
              <span>Search 描述</span>
              <input
                value={searchDescription}
                onChange={(event) => setSearchDescription(event.target.value)}
              />
            </label>
            <div className="workspace-button-row">
              <button
                className="secondary-btn"
                type="button"
                disabled={busyAction === '创建 Search Data Source'}
                onClick={() =>
                  void runAction('创建 Search Data Source', () =>
                    SocialChannelsApi.feishuCreateSearchDataSource({
                      name: searchName.trim(),
                      description: searchDescription.trim() || undefined,
                    }),
                  )
                }
              >
                创建 Search Data Source
              </button>
              <button
                className="secondary-btn"
                type="button"
                disabled={busyAction === '刷新飞书工作区'}
                onClick={() => void runAction('刷新飞书工作区', () => loadWorkspace())}
              >
                刷新列表
              </button>
            </div>

            <label className="social-field">
              <span>Search ACL JSON</span>
              <textarea
                rows={6}
                value={searchAclJson}
                onChange={(event) => setSearchAclJson(event.target.value)}
              />
            </label>
            <button
              className="primary-btn"
              type="button"
              disabled={busyAction === '同步资源到 Search Connector'}
              onClick={() =>
                void runAction('同步资源到 Search Connector', async () =>
                  SocialChannelsApi.feishuSyncResourcesSearch({
                    dataSourceId: config.searchDataSourceId || undefined,
                    acl: parseAcl(),
                  }),
                )
              }
            >
              同步资源到 Search Connector
            </button>

            <div className="workspace-mini-grid">
              <div>
                <strong>Calendars</strong>
                <small>{calendars.length} 个</small>
              </div>
              <div>
                <strong>Tasks</strong>
                <small>{tasks.length} 个</small>
              </div>
              <div>
                <strong>Search Sources</strong>
                <small>{dataSources.length} 个</small>
              </div>
            </div>
          </div>
        </div>
      </section>

      <section className="social-layout workspace-layout">
        <div className="social-card">
          <div className="social-card-head">
            <div>
              <h2>最近任务</h2>
              <p>后端飞书工作区任务记录。</p>
            </div>
          </div>
          <div className="workspace-list">
            {loading ? (
              <div className="social-empty-note">加载中...</div>
            ) : workspace?.recentJobs.length ? (
              workspace.recentJobs.map((job) => (
                <article key={job.id} className={'workspace-list-item ' + statusTone(job.status)}>
                  <div className="workspace-list-head">
                    <strong>{job.title}</strong>
                    <span>{job.status}</span>
                  </div>
                  <div className="workspace-list-meta">
                    <span>{job.type}</span>
                    <span>{formatTime(job.startedAt)}</span>
                    <span>{job.finishedAt ? formatTime(job.finishedAt) : 'running'}</span>
                  </div>
                  {job.summary ? <p>{job.summary}</p> : null}
                </article>
              ))
            ) : (
              <div className="social-empty-note">还没有飞书工作区任务记录。</div>
            )}
          </div>
        </div>

        <div className="social-card">
          <div className="social-card-head">
            <div>
              <h2>最近事件</h2>
              <p>飞书消息、卡片动作和工作区操作摘要。</p>
            </div>
          </div>
          <div className="workspace-list">
            {loading ? (
              <div className="social-empty-note">加载中...</div>
            ) : workspace?.recentEvents.length ? (
              workspace.recentEvents.map((event: FeishuEventLog) => (
                <article key={event.id} className="workspace-list-item">
                  <div className="workspace-list-head">
                    <strong>{event.title}</strong>
                    <span>{event.type}</span>
                  </div>
                  <div className="workspace-list-meta">
                    <span>{event.source ?? 'system'}</span>
                    <span>{formatTime(event.createdAt)}</span>
                  </div>
                  {event.detail ? <p>{event.detail}</p> : null}
                </article>
              ))
            ) : (
              <div className="social-empty-note">还没有飞书事件记录。</div>
            )}
          </div>
        </div>
      </section>
    </>
  )
}
