import { useEffect, useState } from 'react'
import {
  SocialChannelsApi,
  type WechatDesktopGroup,
  type WechatDesktopGroupMemory,
  type WechatDesktopSession,
  type WechatUiBridgeStatus,
} from '../api/social-channels'

type Notice = {
  type: 'success' | 'error' | 'info'
  message: string
}

type Props = {
  onNotice: (message: string, type?: Notice['type']) => void
}

type ConfigForm = {
  chatNames: string
  searchPages: string
  listenerEnabled: boolean
}

function formatTime(value?: number | string) {
  if (!value) return '暂无'
  const timestamp = typeof value === 'number' ? value : Date.parse(value)
  if (!Number.isFinite(timestamp)) return '暂无'
  return new Intl.DateTimeFormat('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(timestamp)
}

function toLines(value: string) {
  return value
    .split(/\r?\n/)
    .map((item) => item.trim())
    .filter(Boolean)
}

function toConfigForm(status?: WechatUiBridgeStatus | null): ConfigForm {
  return {
    chatNames: (status?.config?.chatNames ?? []).join('\n'),
    searchPages: String(status?.config?.searchPages ?? 5),
    listenerEnabled: status?.config?.listenerEnabled === true,
  }
}

export function WechatDesktopChannelPanel({ onNotice }: Props) {
  const [uiStatus, setUiStatus] = useState<WechatUiBridgeStatus | null>(null)
  const [configForm, setConfigForm] = useState<ConfigForm>(toConfigForm())
  const [sessions, setSessions] = useState<WechatDesktopSession[]>([])
  const [groups, setGroups] = useState<WechatDesktopGroup[]>([])
  const [selectedGroupId, setSelectedGroupId] = useState('')
  const [groupMemories, setGroupMemories] = useState<WechatDesktopGroupMemory[]>([])
  const [memoryTitle, setMemoryTitle] = useState('')
  const [memoryContent, setMemoryContent] = useState('')
  const [testSessionName, setTestSessionName] = useState('')
  const [testText, setTestText] = useState('1052 OS 已接入微信桌面通道。')
  const [saving, setSaving] = useState(false)
  const [probing, setProbing] = useState(false)
  const [busyId, setBusyId] = useState('')

  const load = async (probeDesktop = false, includeProfile = false) => {
    try {
      const [uiStatusResult, sessionsResult, groupsResult] = await Promise.all([
        SocialChannelsApi.wechatUiBridgeStatus({ includeProfile, probeDesktop }),
        SocialChannelsApi.listWechatDesktopSessions(),
        SocialChannelsApi.listWechatDesktopGroups(),
      ])
      setUiStatus(uiStatusResult)
      setConfigForm(toConfigForm(uiStatusResult))
      setSessions(sessionsResult)
      setGroups(groupsResult)
      if (!testSessionName) {
        const defaultSession = sessionsResult[0]?.sessionName || groupsResult[0]?.groupName || ''
        if (defaultSession) setTestSessionName(defaultSession)
      }
      if (!selectedGroupId && groupsResult.length > 0) {
        setSelectedGroupId(groupsResult[0].groupId)
      }
    } catch (error) {
      onNotice(
        error instanceof Error ? error.message : '微信桌面通道状态加载失败',
        'error',
      )
    }
  }

  useEffect(() => {
    void load(false, false)
  }, [])

  useEffect(() => {
    if (!selectedGroupId) {
      setGroupMemories([])
      return
    }
    void SocialChannelsApi.listWechatDesktopGroupMemories(selectedGroupId)
      .then(setGroupMemories)
      .catch((error) => {
        onNotice(error instanceof Error ? error.message : '群聊记忆加载失败', 'error')
      })
  }, [selectedGroupId])

  const listenerRunning = uiStatus?.listener?.running === true
  const wechatRunning = uiStatus?.running === true
  const configured =
    (uiStatus?.config?.chatNames?.length ?? 0) > 0 ||
    uiStatus?.config?.listenerEnabled === true
  const stateText = listenerRunning ? '监听中' : configured ? '已关闭' : '未启用'
  const stateClass = listenerRunning ? ' running' : configured ? ' connected' : ''
  const runningCount = sessions.filter((item) => item.enabled).length

  const saveConfig = async () => {
    setSaving(true)
    try {
      const next = await SocialChannelsApi.saveWechatUiBridgeConfig({
        chatNames: toLines(configForm.chatNames),
        searchPages: Number(configForm.searchPages) || 5,
        listenerEnabled: configForm.listenerEnabled,
      })
      const patchedStatus: WechatUiBridgeStatus = {
        ...(uiStatus ?? { enabled: true, running: false }),
        config: next,
        root: uiStatus?.root,
      }
      setUiStatus(patchedStatus)
      setConfigForm(toConfigForm(patchedStatus))
      await load(false, false)
      onNotice('微信桌面桥接配置已保存。', 'success')
    } catch (error) {
      onNotice(error instanceof Error ? error.message : '保存失败', 'error')
    } finally {
      setSaving(false)
    }
  }

  const toggleRuntime = async () => {
    setSaving(true)
    try {
      if (listenerRunning) {
        const result = await SocialChannelsApi.wechatUiBridgeStopListener({ confirmed: true })
        setUiStatus((current) => (current ? { ...current, listener: result.listener } : current))
        onNotice('微信桌面持续监听已停止。', 'success')
      } else {
        const result = await SocialChannelsApi.wechatUiBridgeStartListener({
          confirmed: true,
          chatNames: toLines(configForm.chatNames),
          searchPages: Number(configForm.searchPages) || 5,
        })
        setUiStatus((current) => (current ? { ...current, listener: result.listener } : current))
        onNotice('微信桌面持续监听已启动。', 'success')
      }
      await load(false, false)
    } catch (error) {
      onNotice(error instanceof Error ? error.message : '启动失败', 'error')
    } finally {
      setSaving(false)
    }
  }

  const updateSession = async (
    session: WechatDesktopSession,
    patch: Partial<WechatDesktopSession>,
  ) => {
    setBusyId(session.sessionId)
    try {
      await SocialChannelsApi.updateWechatDesktopSession(session.sessionId, patch)
      if (typeof patch.enabled === 'boolean') {
        const chatNames = new Set(toLines(configForm.chatNames))
        if (patch.enabled) chatNames.add(session.sessionName)
        else chatNames.delete(session.sessionName)
        const next = await SocialChannelsApi.saveWechatUiBridgeConfig({
          chatNames: [...chatNames],
          searchPages: Number(configForm.searchPages) || 5,
          listenerEnabled: configForm.listenerEnabled,
        })
        const patchedStatus: WechatUiBridgeStatus = {
          ...(uiStatus ?? { enabled: true, running: false }),
          config: next,
          root: uiStatus?.root,
        }
        setUiStatus(patchedStatus)
        setConfigForm(toConfigForm(patchedStatus))
      }
      await load(false, false)
    } catch (error) {
      onNotice(error instanceof Error ? error.message : '会话更新失败', 'error')
    } finally {
      setBusyId('')
    }
  }

  const updateGroup = async (group: WechatDesktopGroup, patch: Partial<WechatDesktopGroup>) => {
    setBusyId(group.groupId)
    try {
      const next = await SocialChannelsApi.updateWechatDesktopGroup(group.groupId, patch)
      setGroups((current) => current.map((item) => (item.groupId === next.groupId ? next : item)))
      if (selectedGroupId === next.groupId) {
        setSelectedGroupId(next.groupId)
      }
    } catch (error) {
      onNotice(error instanceof Error ? error.message : '群配置更新失败', 'error')
    } finally {
      setBusyId('')
    }
  }

  const sendTest = async () => {
    if (!testSessionName.trim() || !testText.trim()) {
      onNotice('请填写会话名和消息内容。', 'error')
      return
    }
    setSaving(true)
    try {
      await SocialChannelsApi.wechatUiBridgeSendText({
        friend: testSessionName.trim(),
        text: testText.trim(),
        confirmed: true,
      })
      onNotice('测试消息已通过 pywechat 桥接发送。', 'success')
      await load(false, false)
    } catch (error) {
      onNotice(error instanceof Error ? error.message : '发送失败', 'error')
    } finally {
      setSaving(false)
    }
  }

  const createMemory = async () => {
    if (!selectedGroupId || !memoryTitle.trim() || !memoryContent.trim()) {
      onNotice('请选择群聊并填写记忆标题和内容。', 'error')
      return
    }
    setSaving(true)
    try {
      await SocialChannelsApi.createWechatDesktopGroupMemory({
        groupId: selectedGroupId,
        title: memoryTitle.trim(),
        content: memoryContent.trim(),
        source: 'tool_write',
      })
      setMemoryTitle('')
      setMemoryContent('')
      setGroupMemories(await SocialChannelsApi.listWechatDesktopGroupMemories(selectedGroupId))
      onNotice('群聊记忆已写入。', 'success')
    } catch (error) {
      onNotice(error instanceof Error ? error.message : '群聊记忆写入失败', 'error')
    } finally {
      setSaving(false)
    }
  }

  const probeWechatDesktop = async () => {
    setProbing(true)
    try {
      const status = await SocialChannelsApi.wechatUiBridgeStatus({
        probeDesktop: true,
        includeProfile: true,
      })
      setUiStatus(status)
      setConfigForm(toConfigForm(status))
      const chatNames = toLines(configForm.chatNames)
      if (chatNames.length > 0) {
        await SocialChannelsApi.wechatUiBridgeBindChatWindows({
          confirmed: true,
          chatNames,
          minimize: false,
        })
      }
      onNotice('微信桌面状态已检测。', 'success')
    } catch (error) {
      onNotice(error instanceof Error ? error.message : '微信桌面检测失败', 'error')
    } finally {
      setProbing(false)
    }
  }

  return (
    <section className="social-channel-detail">
      <div className="social-channel-detail-head">
        <div>
          <div className="eyebrow">Active Channel</div>
          <h2>微信桌面通道</h2>
          <p>底层已切到 `codex2295` 的 pywechat 桥接方案，独立于原扫码微信通道继续承载群权限、群专属提示词和群聊记忆增强。</p>
        </div>
        <div className="social-channel-actions">
          <span className={'social-platform-status' + stateClass}>{stateText}</span>
        </div>
      </div>

      <section className="social-overview">
        <div className="social-metric">
          <span>桥接状态</span>
          <strong>{listenerRunning ? '持续监听中' : wechatRunning ? '微信运行中' : '未监听'}</strong>
          <small>当前独立板块直接消费 `/channels/wechat/ui/*` 原始桥接接口。</small>
        </div>
        <div className="social-metric">
          <span>监听配置</span>
          <strong>{runningCount}</strong>
          <small>{configForm.listenerEnabled ? '已保存持续监听意图。' : '当前未保存持续监听意图。'}</small>
        </div>
        <div className="social-metric">
          <span>群聊数量</span>
          <strong>{groups.length}</strong>
          <small>每个群聊独立控制提示词、工具权限和记忆写入。</small>
        </div>
        <div className="social-metric">
          <span>最近检查</span>
          <strong>{formatTime(uiStatus?.listener?.lastCheckAt)}</strong>
          <small>最近命中：{formatTime(uiStatus?.listener?.lastMentionAt)}</small>
        </div>
      </section>

      <section className="social-layout">
        <div className="social-card">
          <div className="social-card-head">
            <div>
              <h2>桥接配置</h2>
              <p>这里对应 `codex2295` 母版里的桥接配置。`pywechat` 已内置到当前项目，机器人名也按当前登录微信自动识别。</p>
            </div>
          </div>

          <div className="social-form">
            <label className="social-field">
              <span>绑定群聊窗口列表</span>
              <textarea
                rows={4}
                value={configForm.chatNames}
                onChange={(event) =>
                  setConfigForm((current) => ({ ...current, chatNames: event.target.value }))
                }
                placeholder="每行一个群聊名称，持续监听时会按这些名称绑定独立聊天窗口"
              />
            </label>
            <label className="social-field">
              <span>扫描页数</span>
              <input
                value={configForm.searchPages}
                onChange={(event) =>
                  setConfigForm((current) => ({ ...current, searchPages: event.target.value }))
                }
                placeholder="5"
              />
            </label>

            <div className="social-checks">
              <label>
                <input
                  type="checkbox"
                  checked={configForm.listenerEnabled}
                  onChange={(event) =>
                    setConfigForm((current) => ({
                      ...current,
                      listenerEnabled: event.target.checked,
                    }))
                  }
                />
                <span>保存为默认持续监听配置</span>
              </label>
            </div>

            <div className="social-empty-note">
              当前内置 pywechat 目录：{uiStatus?.root || '项目 vendor 中自动解析'}
            </div>
            <div className="social-empty-note">
              当前登录微信昵称将由桥接自动识别，用于群聊 `@` 判断；前端不再单独配置机器人名字。
            </div>

            <div className="social-account-actions">
              <button className="primary-btn" type="button" disabled={saving} onClick={() => void saveConfig()}>
                保存桥接配置
              </button>
              <button className="secondary-btn" type="button" disabled={saving} onClick={() => void toggleRuntime()}>
                {listenerRunning ? '停止持续监听' : '启动持续监听'}
              </button>
              <button className="secondary-btn" type="button" disabled={saving || probing} onClick={() => void probeWechatDesktop()}>
                {probing ? '检测中...' : '检测微信状态'}
              </button>
            </div>
          </div>

          {uiStatus?.listener?.missingWindows?.length ? (
            <div className="social-empty-note">
              缺失窗口：{uiStatus.listener.missingWindows.join('、')}
            </div>
          ) : null}
          {uiStatus?.listener?.lastError ? <div className="social-error">{uiStatus.listener.lastError}</div> : null}
          {uiStatus?.profileError ? <div className="social-error">{uiStatus.profileError}</div> : null}
        </div>

        <div className="social-card">
          <div className="social-card-head">
            <div>
              <h2>监听会话</h2>
              <p>这里展示的是独立板块的会话增强层。底层来源是 pywechat，启用标记和群权限仍由当前项目管理。</p>
            </div>
          </div>

          {sessions.length === 0 ? (
            <div className="social-empty-note">还没有生成会话记录。先保存群聊窗口名，或等首次监听命中后自动建档。</div>
          ) : (
            <div className="social-account-list">
              {sessions.map((session) => (
                <article className="social-account-card" key={session.sessionId}>
                  <div className="social-account-main">
                    <div>
                      <div className="social-account-title">{session.sessionName}</div>
                      <div className="social-account-id">{session.sessionId}</div>
                    </div>
                    <span className={'social-status' + (session.enabled ? ' running' : '')}>
                      {session.sessionType === 'group' ? '群聊' : '单聊'}
                    </span>
                  </div>
                  <div className="social-account-grid">
                    <span>来源：{session.source === 'discovered' ? 'pywechat 发现' : '本地配置'}</span>
                    <span>最近消息：{formatTime(session.lastMessageAt)}</span>
                    <span>最近发送者：{session.lastSenderName || '暂无'}</span>
                    <span>监听标记：{session.listening ? '已添加' : '未添加'}</span>
                  </div>
                  {session.lastMessagePreview ? <div className="social-empty-note">{session.lastMessagePreview}</div> : null}
                  <div className="social-account-actions">
                    <button
                      className={session.enabled ? 'secondary-btn' : 'primary-btn'}
                      type="button"
                      disabled={busyId === session.sessionId}
                      onClick={() => void updateSession(session, { enabled: !session.enabled })}
                    >
                      {session.enabled ? '停用监听' : '启用监听'}
                    </button>
                    <button
                      className="secondary-btn"
                      type="button"
                      disabled={busyId === session.sessionId}
                      onClick={() => {
                        setTestSessionName(session.sessionName)
                        if (session.sessionType === 'group') {
                          const matchedGroup = groups.find((item) => item.groupName === session.sessionName)
                          if (matchedGroup) setSelectedGroupId(matchedGroup.groupId)
                        }
                      }}
                    >
                      设为发送目标
                    </button>
                  </div>
                </article>
              ))}
            </div>
          )}
        </div>

        <div className="social-card">
          <div className="social-card-head">
            <div>
              <h2>群聊权限与提示词</h2>
              <p>这部分是在迁移过来的 pywechat 母版之上新增的增强层，不和扫码微信共用。</p>
            </div>
          </div>

          {groups.length === 0 ? (
            <div className="social-empty-note">还没有识别到群聊。先保存群聊窗口名，或等待监听命中后自动建档。</div>
          ) : (
            <div className="social-account-list">
              {groups.map((group) => (
                <article className="social-account-card" key={group.groupId}>
                  <div className="social-account-main">
                    <div>
                      <div className="social-account-title">{group.groupName}</div>
                      <div className="social-account-id">{group.groupId}</div>
                    </div>
                    <span className={'social-status' + (group.enabled ? ' running' : '')}>
                      {group.mode === 'full' ? '完整 Agent' : '仅对话'}
                    </span>
                  </div>
                  <div className="social-checks">
                    <label>
                      <input
                        type="checkbox"
                        checked={group.enabled}
                        onChange={(event) => void updateGroup(group, { enabled: event.target.checked })}
                      />
                      <span>启用群通道</span>
                    </label>
                    <label>
                      <input
                        type="checkbox"
                        checked={group.mentionOnly}
                        onChange={(event) => void updateGroup(group, { mentionOnly: event.target.checked })}
                      />
                      <span>仅在被 @ 时回复</span>
                    </label>
                    <label>
                      <input
                        type="checkbox"
                        checked={group.allowAutoReply}
                        onChange={(event) => void updateGroup(group, { allowAutoReply: event.target.checked })}
                      />
                      <span>允许自动回复</span>
                    </label>
                    <label>
                      <input
                        type="checkbox"
                        checked={group.allowTools}
                        onChange={(event) => void updateGroup(group, { allowTools: event.target.checked })}
                      />
                      <span>允许工具调用</span>
                    </label>
                    <label>
                      <input
                        type="checkbox"
                        checked={group.allowMemoryWrite}
                        onChange={(event) => void updateGroup(group, { allowMemoryWrite: event.target.checked })}
                      />
                      <span>允许群聊记忆写入</span>
                    </label>
                  </div>
                  <label className="social-field">
                    <span>群聊模式</span>
                    <select
                      value={group.mode}
                      onChange={(event) =>
                        void updateGroup(group, { mode: event.target.value as WechatDesktopGroup['mode'] })
                      }
                    >
                      <option value="chat">仅对话</option>
                      <option value="full">完整 Agent</option>
                    </select>
                  </label>
                  <label className="social-field">
                    <span>群专属提示词追加</span>
                    <textarea
                      rows={4}
                      value={group.promptAppend}
                      onChange={(event) =>
                        setGroups((current) =>
                          current.map((item) =>
                            item.groupId === group.groupId ? { ...item, promptAppend: event.target.value } : item,
                          ),
                        )
                      }
                      onBlur={(event) => void updateGroup(group, { promptAppend: event.target.value })}
                      placeholder="例如：这个群以产品运营为主，回答尽量给可执行步骤，避免长篇空话。"
                    />
                  </label>
                  <div className="social-account-grid">
                    <span>最近消息：{formatTime(group.lastMessageAt)}</span>
                    <span>最近发送者：{group.lastSenderName || '暂无'}</span>
                    <span>更新时间：{formatTime(group.updatedAt)}</span>
                    <span>群记忆：{groupMemories.filter((item) => item.groupId === group.groupId).length} 条</span>
                  </div>
                  <div className="social-account-actions">
                    <button className="secondary-btn" type="button" onClick={() => setSelectedGroupId(group.groupId)}>
                      查看群聊记忆
                    </button>
                  </div>
                </article>
              ))}
            </div>
          )}
        </div>

        <div className="social-card">
          <div className="social-card-head">
            <div>
              <h2>群聊记忆</h2>
              <p>实时微信群上下文会自动注入最近群聊记忆；脱离群上下文时，模型才需要显式调用群记忆工具。</p>
            </div>
          </div>

          <label className="social-field">
            <span>查看群聊</span>
            <select value={selectedGroupId} onChange={(event) => setSelectedGroupId(event.target.value)}>
              <option value="">请选择群聊</option>
              {groups.map((group) => (
                <option key={group.groupId} value={group.groupId}>
                  {group.groupName}
                </option>
              ))}
            </select>
          </label>

          <div className="social-form">
            <label className="social-field">
              <span>记忆标题</span>
              <input
                value={memoryTitle}
                onChange={(event) => setMemoryTitle(event.target.value)}
                placeholder="例如：运营群默认输出风格"
              />
            </label>
            <label className="social-field">
              <span>记忆内容</span>
              <textarea
                rows={4}
                value={memoryContent}
                onChange={(event) => setMemoryContent(event.target.value)}
                placeholder="例如：这个群喜欢先给结论，再给分点步骤，避免套话。"
              />
            </label>
            <div className="social-account-actions">
              <button className="primary-btn" type="button" disabled={saving} onClick={() => void createMemory()}>
                写入群聊记忆
              </button>
            </div>
          </div>

          {selectedGroupId && groupMemories.length > 0 ? (
            <div className="social-account-list">
              {groupMemories.map((item) => (
                <article className="social-account-card" key={item.id}>
                  <div className="social-account-main">
                    <div>
                      <div className="social-account-title">{item.title}</div>
                      <div className="social-account-id">{item.groupName}</div>
                    </div>
                    <span className="social-status running">{item.source}</span>
                  </div>
                  <div className="social-empty-note">{item.content}</div>
                  <div className="social-account-grid">
                    <span>创建：{formatTime(item.createdAt)}</span>
                    <span>更新：{formatTime(item.updatedAt)}</span>
                  </div>
                </article>
              ))}
            </div>
          ) : (
            <div className="social-empty-note">当前群聊还没有长期记忆。</div>
          )}
        </div>

        <div className="social-card">
          <div className="social-card-head">
            <div>
              <h2>测试发送</h2>
              <p>这里直接调用迁移过来的 pywechat 原始发送接口，验证独立桌面微信通道是否能主动发消息。</p>
            </div>
          </div>

          <div className="social-form">
            <label className="social-field">
              <span>会话名称</span>
              <input
                value={testSessionName}
                onChange={(event) => setTestSessionName(event.target.value)}
                placeholder="微信群或微信会话名称"
              />
            </label>
            <label className="social-field">
              <span>消息内容</span>
              <textarea
                rows={4}
                value={testText}
                onChange={(event) => setTestText(event.target.value)}
                placeholder="输入要发送到微信桌面会话的消息"
              />
            </label>
            <div className="social-account-actions">
              <button className="primary-btn" type="button" disabled={saving} onClick={() => void sendTest()}>
                发送测试消息
              </button>
            </div>
          </div>
        </div>
      </section>
    </section>
  )
}
