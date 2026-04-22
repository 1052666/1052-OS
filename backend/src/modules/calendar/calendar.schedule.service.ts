import { randomUUID } from 'node:crypto'
import { HttpError } from '../../http-error.js'
import { readJson, writeJson } from '../../storage.js'
import { terminalRun, type TerminalShell } from '../terminal/terminal.service.js'
import { appendChatMessage, updateChatMessage } from '../agent/agent.history.service.js'
import { createNotification } from '../notifications/notifications.service.js'
import {
  resolveWechatDeliveryTarget,
  sendWechatDirectMessage,
} from '../channels/wechat/wechat.service.js'
import type {
  ScheduledTaskFeishuDeliveryMode,
  ScheduledTask,
  ScheduledTaskDelivery,
  ScheduledTaskInput,
  ScheduledTaskMode,
  ScheduledTaskPatch,
  ScheduledTaskQueryInput,
  ScheduledTaskRepeatUnit,
  ScheduledTaskRun,
  ScheduledTaskTarget,
  ScheduledTaskWechatDeliveryMode,
} from './calendar.types.js'

const TASKS_FILE = 'calendar-scheduled-tasks.json'
const RUNS_FILE = 'calendar-scheduled-task-runs.json'
const MAX_RUNS = 500
const TIMEZONE = 'Asia/Hong_Kong' as const

let schedulerTimer: ReturnType<typeof setInterval> | null = null
let schedulerRunning = false
const runningTaskIds = new Set<string>()

function isDateString(value: string) {
  if (!value.match(/^\d{4}-\d{2}-\d{2}$/)) return false
  const [year, month, day] = value.split('-').map(Number)
  const date = new Date(year, month - 1, day)
  return (
    date.getFullYear() === year &&
    date.getMonth() === month - 1 &&
    date.getDate() === day
  )
}

function isTimeString(value: string) {
  return Boolean(value.match(/^([01]\d|2[0-3]):[0-5]\d$/))
}

function toCleanString(value: unknown, maxLength: number) {
  return typeof value === 'string' ? value.trim().slice(0, maxLength) : ''
}

function normalizeBoolean(value: unknown, fallback: boolean) {
  return typeof value === 'boolean' ? value : fallback
}

function normalizeTarget(value: unknown, fallback: ScheduledTaskTarget): ScheduledTaskTarget {
  return value === 'terminal' ? 'terminal' : fallback
}

function normalizeMode(value: unknown, fallback: ScheduledTaskMode): ScheduledTaskMode {
  if (value === 'once' || value === 'recurring' || value === 'ongoing') return value
  return fallback
}

function normalizeRepeatUnit(
  value: unknown,
  fallback: ScheduledTaskRepeatUnit | '',
): ScheduledTaskRepeatUnit | '' {
  if (value === 'day' || value === 'week' || value === 'month') return value
  return fallback
}

function normalizeShell(value: unknown, fallback: TerminalShell): TerminalShell {
  return value === 'cmd' ? 'cmd' : fallback
}

function normalizeWechatDeliveryMode(
  value: unknown,
  fallback: ScheduledTaskWechatDeliveryMode,
): ScheduledTaskWechatDeliveryMode {
  if (value === 'auto' || value === 'fixed' || value === 'off') return value
  return fallback
}

function normalizeFeishuDeliveryMode(
  value: unknown,
  fallback: ScheduledTaskFeishuDeliveryMode,
): ScheduledTaskFeishuDeliveryMode {
  if (value === 'auto' || value === 'fixed' || value === 'off') return value
  return fallback
}

function defaultDelivery(): ScheduledTaskDelivery {
  return {
    wechat: {
      mode: 'auto',
      accountId: '',
      peerId: '',
    },
    feishu: {
      mode: 'auto',
      receiveIdType: 'chat_id',
      receiveId: '',
    },
  }
}

function normalizeDelivery(
  value: unknown,
  fallback: ScheduledTaskDelivery = defaultDelivery(),
  strict = true,
): ScheduledTaskDelivery {
  if (value === undefined) return fallback
  if (!value || typeof value !== 'object') return fallback

  const raw = value as Record<string, unknown>
  const rawWechat =
    raw.wechat && typeof raw.wechat === 'object'
      ? (raw.wechat as Record<string, unknown>)
      : {}
  const rawFeishu =
    raw.feishu && typeof raw.feishu === 'object'
      ? (raw.feishu as Record<string, unknown>)
      : {}

  const fallbackWechat = fallback.wechat
  const fallbackFeishu = fallback.feishu
  const accountId = toCleanString(rawWechat.accountId ?? fallbackWechat.accountId, 160)
  const peerId = toCleanString(rawWechat.peerId ?? fallbackWechat.peerId, 200)
  let mode = normalizeWechatDeliveryMode(rawWechat.mode, fallbackWechat.mode)
  const receiveId = toCleanString(rawFeishu.receiveId ?? fallbackFeishu.receiveId, 200)
  const receiveIdType =
    rawFeishu.receiveIdType === 'open_id' ||
    rawFeishu.receiveIdType === 'user_id' ||
    rawFeishu.receiveIdType === 'union_id' ||
    rawFeishu.receiveIdType === 'email'
      ? rawFeishu.receiveIdType
      : 'chat_id'
  let feishuMode = normalizeFeishuDeliveryMode(rawFeishu.mode, fallbackFeishu.mode)

  if (rawWechat.mode === undefined && typeof rawWechat.enabled === 'boolean') {
    if (rawWechat.enabled === false) {
      mode = 'off'
    } else {
      mode = accountId && peerId ? 'fixed' : 'auto'
    }
  }

  if (mode === 'fixed' && (!accountId || !peerId)) {
    if (strict) {
      throw new HttpError(400, 'Fixed WeChat delivery requires accountId and peerId')
    }
    mode = 'auto'
  }

  if (rawFeishu.mode === undefined && typeof rawFeishu.enabled === 'boolean') {
    if (rawFeishu.enabled === false) {
      feishuMode = 'off'
    } else {
      feishuMode = receiveId ? 'fixed' : 'auto'
    }
  }

  if (feishuMode === 'fixed' && !receiveId) {
    if (strict) {
      throw new HttpError(400, 'Fixed Feishu delivery requires receiveId')
    }
    feishuMode = 'auto'
  }

  return {
    wechat: {
      mode,
      accountId,
      peerId,
    },
    feishu: {
      mode: feishuMode,
      receiveIdType,
      receiveId,
    },
  }
}

function normalizeWeekdays(value: unknown, fallback: number[]) {
  const list = Array.isArray(value)
    ? value
        .map((item) =>
          typeof item === 'number' && Number.isInteger(item) && item >= 0 && item <= 6
            ? item
            : null,
        )
        .filter((item): item is number => item !== null)
    : fallback
  return [...new Set(list)].sort((a, b) => a - b)
}

function normalizeRepeatInterval(value: unknown, fallback: number) {
  const parsed =
    typeof value === 'number' && Number.isFinite(value) ? Math.floor(value) : fallback
  return Math.min(Math.max(parsed, 1), 365)
}

function daysInMonth(year: number, monthIndex: number) {
  return new Date(year, monthIndex + 1, 0).getDate()
}

function parseDate(value: string) {
  const [year, month, day] = value.split('-').map(Number)
  return { year, month, day }
}

function parseTime(value: string) {
  const [hour, minute] = value.split(':').map(Number)
  return { hour, minute }
}

function toHongKongTimestamp(date: string, time: string) {
  const { year, month, day } = parseDate(date)
  const { hour, minute } = parseTime(time)
  return Date.UTC(year, month - 1, day, hour - 8, minute, 0, 0)
}

function fromHongKongTimestamp(timestamp: number) {
  const offset = timestamp + 8 * 60 * 60 * 1000
  const date = new Date(offset)
  return {
    year: date.getUTCFullYear(),
    month: date.getUTCMonth() + 1,
    day: date.getUTCDate(),
    hour: date.getUTCHours(),
    minute: date.getUTCMinutes(),
    weekday: date.getUTCDay(),
  }
}

function formatDate(year: number, month: number, day: number) {
  return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
}

function addDays(date: string, days: number) {
  const ts = toHongKongTimestamp(date, '00:00') + days * 24 * 60 * 60 * 1000
  const next = fromHongKongTimestamp(ts)
  return formatDate(next.year, next.month, next.day)
}

function monthDiff(fromDate: string, toDate: string) {
  const from = parseDate(fromDate)
  const to = parseDate(toDate)
  return (to.year - from.year) * 12 + (to.month - from.month)
}

function addMonths(date: string, months: number) {
  const parsed = parseDate(date)
  const totalMonths = parsed.year * 12 + (parsed.month - 1) + months
  const year = Math.floor(totalMonths / 12)
  const month = (totalMonths % 12) + 1
  const day = Math.min(parsed.day, daysInMonth(year, month - 1))
  return formatDate(year, month, day)
}

function diffDays(fromDate: string, toDate: string) {
  const from = toHongKongTimestamp(fromDate, '00:00')
  const to = toHongKongTimestamp(toDate, '00:00')
  return Math.floor((to - from) / (24 * 60 * 60 * 1000))
}

function normalizeTaskSummary(value: string) {
  return value.trim()
}

function buildReminderText(task: ScheduledTask, outcome: { status: 'success' | 'failed'; summary: string }) {
  const body = normalizeTaskSummary(outcome.summary)
  if (outcome.status === 'success') {
    return body || task.title
  }
  return body ? `定时任务执行失败：${body}` : `定时任务“${task.title}”执行失败。`
}

async function publishScheduledTaskOutcome(
  task: ScheduledTask,
  outcome: { status: 'success' | 'failed'; summary: string },
) {
  const content = buildReminderText(task, outcome)
  const record = await appendChatMessage({
    role: 'assistant',
    content,
    error: outcome.status === 'failed' ? true : undefined,
    meta: {
      source: 'scheduled-task',
      taskId: task.id,
      taskTitle: task.title,
    },
  })

  const notification = await createNotification({
    title: `定时任务提醒：${task.title}`,
    message: content,
    level: outcome.status === 'success' ? 'success' : 'error',
    source: 'scheduled-task',
    taskId: task.id,
    taskTitle: task.title,
    chatMessageId: record.id,
    chatMessageTs: record.ts,
  })

  await deliverScheduledTaskToWechat(task, content, record.id)
  await deliverScheduledTaskToFeishu(task, content, record.id, notification.id, outcome.status)
}

function deliveryErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error)
}

async function deliverScheduledTaskToWechat(
  task: ScheduledTask,
  content: string,
  chatMessageId: number,
) {
  const wechat = task.delivery?.wechat ?? defaultDelivery().wechat
  if (wechat.mode === 'off') return

  let target: Awaited<ReturnType<typeof resolveWechatDeliveryTarget>> | null = null
  try {
    target = await resolveWechatDeliveryTarget(
      wechat.mode === 'fixed'
        ? { accountId: wechat.accountId, peerId: wechat.peerId }
        : undefined,
    )
  } catch (error) {
    await updateChatMessage(
      chatMessageId,
      (current) => ({
        ...current,
        meta: {
          ...current.meta,
          delivery: {
            status: 'failed',
            targetChannel: 'wechat',
            targetPeerId: wechat.peerId || undefined,
            error: deliveryErrorMessage(error),
          },
        },
      }),
      'scheduled-task-wechat-target-failed',
    )
    return
  }

  if (!target) {
    const error =
      '没有可用的微信投递目标。请先在社交通道微信页面接入微信，并至少完成一次微信会话，或把任务微信推送策略改为固定会话。'
    console.warn(`[scheduled-task] WeChat delivery skipped for task ${task.id}: ${error}`)
    await updateChatMessage(
      chatMessageId,
      (current) => ({
        ...current,
        meta: {
          ...current.meta,
          delivery: {
            status: 'failed',
            targetChannel: 'wechat',
            targetPeerId: wechat.peerId || undefined,
            error,
          },
        },
      }),
      'scheduled-task-wechat-no-target',
    )
    return
  }
  const deliveryTarget = target

  await updateChatMessage(
    chatMessageId,
    (current) => ({
      ...current,
      meta: {
        ...current.meta,
          delivery: {
            status: 'pending',
            targetChannel: 'wechat',
            targetPeerId: deliveryTarget.peerId,
          },
        },
      }),
    'scheduled-task-wechat-pending',
  )

  try {
    await sendWechatDirectMessage({
      accountId: deliveryTarget.accountId,
      peerId: deliveryTarget.peerId,
      text: content,
    })
    await updateChatMessage(
      chatMessageId,
      (current) => ({
        ...current,
        meta: {
          ...current.meta,
          delivery: {
            status: 'sent',
            targetChannel: 'wechat',
            targetPeerId: deliveryTarget.peerId,
          },
        },
      }),
      'scheduled-task-wechat-sent',
    )
  } catch (error) {
    await updateChatMessage(
      chatMessageId,
      (current) => ({
        ...current,
        meta: {
          ...current.meta,
          delivery: {
            status: 'failed',
            targetChannel: 'wechat',
            targetPeerId: deliveryTarget.peerId,
            error: deliveryErrorMessage(error),
          },
        },
      }),
      'scheduled-task-wechat-failed',
    )
  }
}

async function deliverScheduledTaskToFeishu(
  task: ScheduledTask,
  content: string,
  chatMessageId: number,
  notificationId: string,
  status: 'success' | 'failed',
) {
  const feishu = task.delivery?.feishu ?? defaultDelivery().feishu
  if (feishu.mode === 'off') return

  const {
    resolveFeishuDeliveryTarget,
    sendFeishuDirectMessage,
    sendFeishuScheduledTaskCardMessage,
  } = await import('../channels/feishu/feishu.service.js')
  const { loadFeishuWorkspaceConfig } = await import('../channels/feishu/feishu.store.js')

  let target: Awaited<ReturnType<typeof resolveFeishuDeliveryTarget>> | null = null
  try {
    target = await resolveFeishuDeliveryTarget(
      feishu.mode === 'fixed'
        ? {
            receiveIdType: feishu.receiveIdType,
            receiveId: feishu.receiveId,
          }
        : undefined,
    )
  } catch (error) {
    await updateChatMessage(
      chatMessageId,
      (current) => ({
        ...current,
        meta: {
          ...current.meta,
          delivery: {
            status: 'failed',
            targetChannel: 'feishu',
            targetPeerId: feishu.receiveId || undefined,
            error: deliveryErrorMessage(error),
          },
        },
      }),
      'scheduled-task-feishu-target-failed',
    )
    return
  }

  if (!target) {
    const error =
      'No Feishu delivery target is available yet. Connect Feishu and complete at least one conversation first, or set a fixed receiveId for this scheduled task.'
    await updateChatMessage(
      chatMessageId,
      (current) => ({
        ...current,
        meta: {
          ...current.meta,
          delivery: {
            status: 'failed',
            targetChannel: 'feishu',
            targetPeerId: feishu.receiveId || undefined,
            error,
          },
        },
      }),
      'scheduled-task-feishu-no-target',
    )
    return
  }

  const workspace = await loadFeishuWorkspaceConfig()

  await updateChatMessage(
    chatMessageId,
    (current) => ({
      ...current,
      meta: {
        ...current.meta,
        delivery: {
          status: 'pending',
          targetChannel: 'feishu',
          targetPeerId: target.receiveId,
        },
      },
    }),
    'scheduled-task-feishu-pending',
  )

  try {
    if (workspace.enableScheduledTaskCards !== false) {
      await sendFeishuScheduledTaskCardMessage({
        taskId: task.id,
        taskTitle: task.title,
        summary: content,
        status,
        enabled: task.enabled,
        notificationId,
        receiveIdType: target.receiveIdType,
        receiveId: target.receiveId,
      })
    } else {
      await sendFeishuDirectMessage({
        receiveIdType: target.receiveIdType,
        receiveId: target.receiveId,
        text: content,
      })
    }

    await updateChatMessage(
      chatMessageId,
      (current) => ({
        ...current,
        meta: {
          ...current.meta,
          delivery: {
            status: 'sent',
            targetChannel: 'feishu',
            targetPeerId: target.receiveId,
          },
        },
      }),
      'scheduled-task-feishu-sent',
    )
  } catch (error) {
    await updateChatMessage(
      chatMessageId,
      (current) => ({
        ...current,
        meta: {
          ...current.meta,
          delivery: {
            status: 'failed',
            targetChannel: 'feishu',
            targetPeerId: target.receiveId,
            error: deliveryErrorMessage(error),
          },
        },
      }),
      'scheduled-task-feishu-failed',
    )
  }
}

function computeNextRunAt(task: ScheduledTask, afterTimestamp: number): number | null {
  if (!task.enabled) return null

  const anchorTimestamp = toHongKongTimestamp(task.startDate, task.time)
  const threshold = Math.max(afterTimestamp, anchorTimestamp - 1)

  if (task.mode === 'once') {
    if (anchorTimestamp <= threshold) return null
    if (task.endDate && task.startDate > task.endDate) return null
    return anchorTimestamp
  }

  if (!task.repeatUnit) return null

  if (task.repeatUnit === 'day') {
    let candidateDate = task.startDate
    if (threshold >= anchorTimestamp) {
      const current = fromHongKongTimestamp(threshold + 1)
      const currentDate = formatDate(current.year, current.month, current.day)
      const elapsedDays = Math.max(0, diffDays(task.startDate, currentDate))
      const skips = Math.floor(elapsedDays / task.repeatInterval)
      candidateDate = addDays(task.startDate, skips * task.repeatInterval)
      while (toHongKongTimestamp(candidateDate, task.time) <= threshold) {
        candidateDate = addDays(candidateDate, task.repeatInterval)
      }
    }
    if (task.endDate && candidateDate > task.endDate) return null
    return toHongKongTimestamp(candidateDate, task.time)
  }

  if (task.repeatUnit === 'week') {
    const weekdays = task.repeatWeekdays.length
      ? task.repeatWeekdays
      : [fromHongKongTimestamp(anchorTimestamp).weekday]
    const thresholdDateParts = fromHongKongTimestamp(threshold + 1)
    let probeDate = formatDate(
      thresholdDateParts.year,
      thresholdDateParts.month,
      thresholdDateParts.day,
    )
    if (probeDate < task.startDate) probeDate = task.startDate

    for (let i = 0; i < 3660; i += 1) {
      const probeTs = toHongKongTimestamp(probeDate, task.time)
      const probeWeekday = fromHongKongTimestamp(probeTs).weekday
      const weeksFromAnchor = Math.floor(diffDays(task.startDate, probeDate) / 7)
      if (
        probeDate >= task.startDate &&
        (!task.endDate || probeDate <= task.endDate) &&
        weeksFromAnchor >= 0 &&
        weeksFromAnchor % task.repeatInterval === 0 &&
        weekdays.includes(probeWeekday) &&
        probeTs > threshold
      ) {
        return probeTs
      }
      probeDate = addDays(probeDate, 1)
    }
    return null
  }

  let monthsToAdd = 0
  if (threshold >= anchorTimestamp) {
    const current = fromHongKongTimestamp(threshold + 1)
    const currentDate = formatDate(current.year, current.month, current.day)
    const elapsedMonths = Math.max(0, monthDiff(task.startDate, currentDate))
    monthsToAdd = Math.floor(elapsedMonths / task.repeatInterval) * task.repeatInterval
  }

  for (let i = 0; i < 240; i += 1) {
    const candidateDate = addMonths(task.startDate, monthsToAdd + i * task.repeatInterval)
    if (task.endDate && candidateDate > task.endDate) return null
    const candidateTs = toHongKongTimestamp(candidateDate, task.time)
    if (candidateTs > threshold) return candidateTs
  }

  return null
}

function serializeTask(task: ScheduledTask): ScheduledTask {
  return {
    ...task,
    delivery: normalizeDelivery(task.delivery, defaultDelivery(), false),
    repeatWeekdays: [...task.repeatWeekdays].sort((a, b) => a - b),
  }
}

async function readTasks() {
  const tasks = await readJson<ScheduledTask[]>(TASKS_FILE, [])
  return tasks.map((task) => serializeTask(task))
}

async function saveTasks(tasks: ScheduledTask[]) {
  await writeJson(
    TASKS_FILE,
    tasks
      .map((task) => serializeTask(task))
      .sort((a, b) => {
        const nextA = a.nextRunAt ?? Number.MAX_SAFE_INTEGER
        const nextB = b.nextRunAt ?? Number.MAX_SAFE_INTEGER
        if (nextA !== nextB) return nextA - nextB
        return a.createdAt - b.createdAt
      }),
  )
}

async function readRuns() {
  return readJson<ScheduledTaskRun[]>(RUNS_FILE, [])
}

async function saveRuns(runs: ScheduledTaskRun[]) {
  await writeJson(
    RUNS_FILE,
    runs
      .slice(0, MAX_RUNS)
      .sort((a, b) => b.startedAt - a.startedAt),
  )
}

function normalizeTask(
  input: ScheduledTaskInput,
  current?: ScheduledTask,
): Omit<
  ScheduledTask,
  'id' | 'createdAt' | 'updatedAt' | 'lastRunAt' | 'nextRunAt' | 'lastRunStatus' | 'lastRunSummary'
> {
  const title = toCleanString(input.title ?? current?.title, 120)
  const notes = toCleanString(input.notes ?? current?.notes, 1000)
  const target = normalizeTarget(input.target, current?.target ?? 'agent')
  const mode = normalizeMode(input.mode, current?.mode ?? 'once')
  const startDate = toCleanString(input.startDate ?? current?.startDate, 10)
  const time = toCleanString(input.time ?? current?.time, 5)
  const repeatUnit = normalizeRepeatUnit(input.repeatUnit, current?.repeatUnit ?? '')
  const repeatInterval = normalizeRepeatInterval(
    input.repeatInterval,
    current?.repeatInterval ?? 1,
  )
  const repeatWeekdays = normalizeWeekdays(
    input.repeatWeekdays,
    current?.repeatWeekdays ?? [],
  )
  const endDate = toCleanString(input.endDate ?? current?.endDate, 10)
  const prompt = toCleanString(input.prompt ?? current?.prompt, 4000)
  const command = toCleanString(input.command ?? current?.command, 4000)
  const shell = normalizeShell(input.shell, current?.shell ?? 'powershell')
  const delivery = normalizeDelivery(
    input.delivery,
    current?.delivery ?? defaultDelivery(),
    true,
  )
  const enabled = normalizeBoolean(input.enabled, current?.enabled ?? true)

  if (!title) throw new HttpError(400, 'Scheduled task title is required')
  if (!isDateString(startDate)) throw new HttpError(400, 'Scheduled task startDate is invalid')
  if (!isTimeString(time)) throw new HttpError(400, 'Scheduled task time is invalid')
  if (endDate && !isDateString(endDate)) {
    throw new HttpError(400, 'Scheduled task endDate is invalid')
  }
  if (endDate && endDate < startDate) {
    throw new HttpError(400, 'Scheduled task endDate cannot be earlier than startDate')
  }
  if (target === 'agent' && !prompt) {
    throw new HttpError(400, 'Agent scheduled task requires a prompt')
  }
  if (target === 'terminal' && !command) {
    throw new HttpError(400, 'Terminal scheduled task requires a command')
  }
  if (mode !== 'once' && !repeatUnit) {
    throw new HttpError(400, 'Recurring or ongoing scheduled task requires repeatUnit')
  }
  if (repeatUnit !== 'week' && repeatWeekdays.length > 0 && mode !== 'once') {
    throw new HttpError(400, 'repeatWeekdays is only supported for weekly scheduled tasks')
  }
  if (repeatUnit === 'week' && mode !== 'once' && repeatWeekdays.length === 0) {
    repeatWeekdays.push(fromHongKongTimestamp(toHongKongTimestamp(startDate, time)).weekday)
  }
  if (mode === 'ongoing' && endDate) {
    throw new HttpError(400, 'Ongoing scheduled task cannot have endDate')
  }

  return {
    title,
    notes,
    target,
    mode,
    startDate,
    time,
    timezone: TIMEZONE,
    repeatUnit: mode === 'once' ? '' : repeatUnit,
    repeatInterval: mode === 'once' ? 1 : repeatInterval,
    repeatWeekdays: mode === 'once' ? [] : repeatWeekdays,
    endDate: mode === 'ongoing' ? '' : endDate,
    prompt,
    command,
    shell,
    delivery,
    enabled,
  }
}

function applyNextRunAt(task: ScheduledTask) {
  return {
    ...task,
    nextRunAt: computeNextRunAt(task, Date.now()),
  }
}

export async function listScheduledTasks(input: ScheduledTaskQueryInput = {}) {
  const target =
    input.target === 'agent' || input.target === 'terminal' ? input.target : undefined
  const enabled =
    typeof input.enabled === 'boolean'
      ? input.enabled
      : input.enabled === 'true'
        ? true
        : input.enabled === 'false'
          ? false
          : undefined
  const limit =
    typeof input.limit === 'number' && Number.isFinite(input.limit)
      ? Math.min(Math.max(Math.floor(input.limit), 1), 200)
      : 200

  let tasks = await readTasks()
  if (target) tasks = tasks.filter((task) => task.target === target)
  if (enabled !== undefined) tasks = tasks.filter((task) => task.enabled === enabled)
  return tasks.slice(0, limit)
}

export async function listScheduledTaskRuns(taskId?: string, limit = 50) {
  const max = Math.min(Math.max(limit, 1), 200)
  const runs = await readRuns()
  return runs.filter((run) => (!taskId ? true : run.taskId === taskId)).slice(0, max)
}

export async function getScheduledTask(id: string) {
  const tasks = await readTasks()
  const task = tasks.find((item) => item.id === id)
  if (!task) throw new HttpError(404, 'Scheduled task not found')
  return task
}

export async function createScheduledTask(input: ScheduledTaskInput) {
  const now = Date.now()
  const base = normalizeTask(input)
  const task: ScheduledTask = applyNextRunAt({
    id: randomUUID(),
    ...base,
    createdAt: now,
    updatedAt: now,
    lastRunAt: null,
    lastRunStatus: null,
    lastRunSummary: '',
    nextRunAt: null,
  })
  const tasks = await readTasks()
  await saveTasks([...tasks, task])
  return task
}

export async function updateScheduledTask(id: string, patch: ScheduledTaskPatch) {
  const tasks = await readTasks()
  const index = tasks.findIndex((task) => task.id === id)
  if (index === -1) throw new HttpError(404, 'Scheduled task not found')
  const current = tasks[index]
  const base = normalizeTask(patch, current)
  const next = applyNextRunAt({
    ...current,
    ...base,
    updatedAt: Date.now(),
  })
  tasks[index] = next
  await saveTasks(tasks)
  return next
}

export async function deleteScheduledTask(id: string) {
  const tasks = await readTasks()
  const next = tasks.filter((task) => task.id !== id)
  if (next.length === tasks.length) throw new HttpError(404, 'Scheduled task not found')
  await saveTasks(next)
  const runs = await readRuns()
  await saveRuns(runs.filter((run) => run.taskId !== id))
  runningTaskIds.delete(id)
  return { deleted: true, id }
}

export async function setScheduledTaskEnabled(id: string, enabled: boolean) {
  return updateScheduledTask(id, { enabled })
}

async function createTaskRun(task: ScheduledTask, triggerAt: number) {
  const run: ScheduledTaskRun = {
    id: randomUUID(),
    taskId: task.id,
    taskTitle: task.title,
    target: task.target,
    status: 'running',
    triggerAt,
    startedAt: Date.now(),
    finishedAt: null,
    summary: '',
    error: '',
  }
  const runs = await readRuns()
  await saveRuns([run, ...runs])
  return run
}

async function finishTaskRun(
  runId: string,
  outcome: Pick<ScheduledTaskRun, 'status' | 'summary' | 'error'>,
) {
  const runs = await readRuns()
  const index = runs.findIndex((run) => run.id === runId)
  if (index === -1) return
  runs[index] = {
    ...runs[index],
    ...outcome,
    finishedAt: Date.now(),
  }
  await saveRuns(runs)
}

async function updateTaskAfterRun(
  taskId: string,
  outcome: { status: 'success' | 'failed'; summary: string; triggerAt: number },
) {
  const tasks = await readTasks()
  const index = tasks.findIndex((task) => task.id === taskId)
  if (index === -1) return
  const current = tasks[index]
  const nextSeed: ScheduledTask = {
    ...current,
    lastRunAt: Date.now(),
    lastRunStatus: outcome.status,
    lastRunSummary: normalizeTaskSummary(outcome.summary),
    updatedAt: Date.now(),
  }
  const nextRunAt = computeNextRunAt(nextSeed, outcome.triggerAt)
  tasks[index] = {
    ...nextSeed,
    nextRunAt,
    enabled: nextSeed.mode === 'once' ? false : nextSeed.enabled,
  }
  await saveTasks(tasks)
}

async function executeAgentTask(task: ScheduledTask) {
  const { sendMessage } = await import('../agent/agent.service.js')
  const systemInstruction =
    'This is a scheduled background task in 1052 OS. Execute the request directly, keep the result concise, and report only the actual outcome. Do not ask the user follow-up questions.'
  const reply = await sendMessage([
    { role: 'system', content: systemInstruction },
    { role: 'user', content: task.prompt },
  ])
  return {
    summary: normalizeTaskSummary(reply.content),
  }
}

async function executeTerminalTask(task: ScheduledTask) {
  const result = await terminalRun({
    command: task.command,
    shell: task.shell,
    confirmed: true,
  })
  const chunks = [result.stdout, result.stderr].filter(Boolean)
  return {
    summary: normalizeTaskSummary(
      chunks.length > 0
        ? chunks.join('\n\n')
        : `Command finished with exit code ${String(result.exitCode)}`,
    ),
    failed: result.exitCode !== 0 || result.timedOut,
  }
}

async function executeScheduledTask(task: ScheduledTask, triggerAt: number) {
  if (runningTaskIds.has(task.id)) return
  runningTaskIds.add(task.id)
  const run = await createTaskRun(task, triggerAt)

  try {
    if (task.target === 'agent') {
      const result = await executeAgentTask(task)
      await publishScheduledTaskOutcome(task, {
        status: 'success',
        summary: result.summary,
      })
      await finishTaskRun(run.id, {
        status: 'success',
        summary: result.summary,
        error: '',
      })
      await updateTaskAfterRun(task.id, {
        status: 'success',
        summary: result.summary,
        triggerAt,
      })
      return
    }

    const result = await executeTerminalTask(task)
    await publishScheduledTaskOutcome(task, {
      status: result.failed ? 'failed' : 'success',
      summary: result.summary,
    })
    await finishTaskRun(run.id, {
      status: result.failed ? 'failed' : 'success',
      summary: result.summary,
      error: result.failed ? result.summary : '',
    })
    await updateTaskAfterRun(task.id, {
      status: result.failed ? 'failed' : 'success',
      summary: result.summary,
      triggerAt,
    })
  } catch (error) {
    const message =
      error instanceof Error ? error.message : 'Scheduled task execution failed'
    await publishScheduledTaskOutcome(task, {
      status: 'failed',
      summary: message,
    })
    await finishTaskRun(run.id, {
      status: 'failed',
      summary: '',
      error: message,
    })
    await updateTaskAfterRun(task.id, {
      status: 'failed',
      summary: message,
      triggerAt,
    })
  } finally {
    runningTaskIds.delete(task.id)
  }
}

export async function triggerScheduledTaskNow(id: string) {
  const task = await getScheduledTask(id)
  await executeScheduledTask(task, Date.now())
  return getScheduledTask(id)
}

export async function runScheduledTasksCycle() {
  if (schedulerRunning) return
  schedulerRunning = true

  try {
    const tasks = await readTasks()
    const now = Date.now()
    const due = tasks.filter(
      (task) =>
        task.enabled === true &&
        task.nextRunAt !== null &&
        task.nextRunAt <= now &&
        !runningTaskIds.has(task.id),
    )

    for (const task of due) {
      await executeScheduledTask(task, now)
    }
  } finally {
    schedulerRunning = false
  }
}

export function startScheduledTaskRunner() {
  if (schedulerTimer) return
  schedulerTimer = setInterval(() => {
    void runScheduledTasksCycle()
  }, 15_000)
  void runScheduledTasksCycle()
}

export function stopScheduledTaskRunner() {
  if (!schedulerTimer) return
  clearInterval(schedulerTimer)
  schedulerTimer = null
}
