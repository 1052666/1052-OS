import { randomUUID } from 'node:crypto'
import { HttpError } from '../../http-error.js'
import { readJson, writeJson } from '../../storage.js'
import type {
  CalendarEvent,
  CalendarEventInput,
  CalendarEventPatch,
  CalendarEventQueryInput,
} from './calendar.types.js'

const FILE = 'calendar-events.json'

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
  return !value || Boolean(value.match(/^([01]\d|2[0-3]):[0-5]\d$/))
}

function toCleanString(value: unknown, maxLength: number) {
  return typeof value === 'string' ? value.trim().slice(0, maxLength) : ''
}

function normalizeEvent(input: CalendarEventInput, current?: CalendarEvent) {
  const title = toCleanString(input.title ?? current?.title, 80)
  const date = toCleanString(input.date ?? current?.date, 10)
  const startTime = toCleanString(input.startTime ?? current?.startTime, 5)
  const endTime = toCleanString(input.endTime ?? current?.endTime, 5)

  if (!title) throw new HttpError(400, '事件标题不能为空')
  if (!isDateString(date)) throw new HttpError(400, '事件日期格式无效')
  if (!isTimeString(startTime)) throw new HttpError(400, '开始时间格式无效')
  if (!isTimeString(endTime)) throw new HttpError(400, '结束时间格式无效')
  if (startTime && endTime && startTime > endTime) {
    throw new HttpError(400, '结束时间不能早于开始时间')
  }

  return {
    title,
    date,
    startTime,
    endTime,
    location: toCleanString(input.location ?? current?.location, 120),
    notes: toCleanString(input.notes ?? current?.notes, 1000),
  }
}

function normalizeQuery(input: CalendarEventQueryInput) {
  const date = toCleanString(input.date, 10)
  const startDate = toCleanString(input.startDate, 10)
  const endDate = toCleanString(input.endDate, 10)
  const keyword = toCleanString(input.keyword, 80).toLocaleLowerCase()
  const rawLimit =
    typeof input.limit === 'number' && Number.isFinite(input.limit)
      ? Math.floor(input.limit)
      : 20
  const limit = Math.min(Math.max(rawLimit, 1), 50)

  if (date && !isDateString(date)) throw new HttpError(400, '查询日期格式无效')
  if (startDate && !isDateString(startDate)) {
    throw new HttpError(400, '查询开始日期格式无效')
  }
  if (endDate && !isDateString(endDate)) {
    throw new HttpError(400, '查询结束日期格式无效')
  }
  if (startDate && endDate && startDate > endDate) {
    throw new HttpError(400, '查询结束日期不能早于开始日期')
  }

  return {
    date,
    startDate,
    endDate,
    keyword,
    limit,
  }
}

function sortEvents(events: CalendarEvent[]) {
  return [...events].sort((a, b) => {
    const byDate = a.date.localeCompare(b.date)
    if (byDate !== 0) return byDate
    const byStart = (a.startTime || '99:99').localeCompare(b.startTime || '99:99')
    if (byStart !== 0) return byStart
    return a.createdAt - b.createdAt
  })
}

async function readEvents() {
  return readJson<CalendarEvent[]>(FILE, [])
}

async function saveEvents(events: CalendarEvent[]) {
  await writeJson(FILE, sortEvents(events))
}

export async function listCalendarEvents() {
  return sortEvents(await readEvents())
}

export async function queryCalendarEvents(input: CalendarEventQueryInput = {}) {
  const query = normalizeQuery(input)
  let events = sortEvents(await readEvents())

  if (query.date) {
    events = events.filter((event) => event.date === query.date)
  } else {
    if (query.startDate) {
      events = events.filter((event) => event.date >= query.startDate)
    }
    if (query.endDate) {
      events = events.filter((event) => event.date <= query.endDate)
    }
  }

  if (query.keyword) {
    events = events.filter((event) => {
      const haystack = [event.title, event.location, event.notes]
        .join('\n')
        .toLocaleLowerCase()
      return haystack.includes(query.keyword)
    })
  }

  return events.slice(0, query.limit)
}

export async function createCalendarEvent(input: CalendarEventInput) {
  const now = Date.now()
  const normalized = normalizeEvent(input)
  const event: CalendarEvent = {
    id: randomUUID(),
    ...normalized,
    createdAt: now,
    updatedAt: now,
  }

  const events = await readEvents()
  await saveEvents([...events, event])
  return event
}

export async function updateCalendarEvent(
  id: string,
  patch: CalendarEventPatch,
) {
  const events = await readEvents()
  const index = events.findIndex((event) => event.id === id)
  if (index === -1) throw new HttpError(404, '事件不存在')

  const current = events[index]
  const normalized = normalizeEvent(patch, current)
  const next: CalendarEvent = {
    ...current,
    ...normalized,
    updatedAt: Date.now(),
  }

  events[index] = next
  await saveEvents(events)
  return next
}

export async function deleteCalendarEvent(id: string) {
  const events = await readEvents()
  const next = events.filter((event) => event.id !== id)
  if (next.length === events.length) throw new HttpError(404, '事件不存在')

  await saveEvents(next)
}
