import { describe, expect, it } from 'vitest'
import { buildScheduledAgentMessages } from '../calendar.schedule.service.js'
import type { ScheduledTask } from '../calendar.types.js'

function scheduledTask(overrides: Partial<ScheduledTask> = {}): ScheduledTask {
  return {
    id: 'task-1',
    title: '长书 Wiki 摄取',
    notes: '样例要求：每章至少拆出实体、核心理念和综合分析，不能只列几个词。',
    target: 'agent',
    mode: 'recurring',
    startDate: '2026-04-25',
    time: '09:00',
    timezone: 'Asia/Hong_Kong',
    repeatUnit: 'day',
    repeatInterval: 1,
    repeatWeekdays: [],
    endDate: '',
    prompt: '读取 raw 中的新书资料并维护 Wiki。',
    command: '',
    shell: 'powershell',
    delivery: {
      wechat: { mode: 'off', accountId: '', peerId: '' },
      feishu: { mode: 'off', receiveIdType: 'chat_id', receiveId: '' },
    },
    enabled: true,
    createdAt: 1,
    updatedAt: 1,
    lastRunAt: null,
    nextRunAt: null,
    lastRunStatus: null,
    lastRunSummary: '',
    ...overrides,
  }
}

describe('scheduled agent task prompt', () => {
  it('carries notes, examples, and long-source quality rules in the task prompt', () => {
    const messages = buildScheduledAgentMessages(scheduledTask())
    const system = messages.find((message) => message.role === 'system')?.content ?? ''
    const user = messages.find((message) => message.role === 'user')?.content ?? ''

    expect(system).toContain('scheduled background task')
    expect(system).toContain('Concise means no filler')
    expect(user).toContain('任务备注 / 用户样例 / 长期要求')
    expect(user).toContain('样例要求')
    expect(user).toContain('不得只归纳几个词条了事')
    expect(user).toContain('已覆盖范围')
    expect(user).toContain('未覆盖范围')
  })
})
