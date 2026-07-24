import { describe, expect, it } from 'vitest'
import { getAgentSystemPrompt } from './agent.prompt.service.js'

describe('1052 agent system prompt', () => {
  it('loads the rewritten 1052 runtime prompt', async () => {
    const prompt = await getAgentSystemPrompt()

    expect(prompt).toContain('1052 OS Agent System Prompt')
    expect(prompt).toContain('Runtime Model')
    expect(prompt).toContain('Permissions And Safety')
    expect(prompt).not.toContain('鏃')
  })
})
