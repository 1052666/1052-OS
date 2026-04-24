import type { AgentTool } from '../agent.tool.types.js'
import {
  terminalInterrupt,
  terminalRun,
  terminalSetCwd,
  terminalStatus,
} from '../../terminal/terminal.service.js'

export const terminalTools: AgentTool[] = [
  {
    name: 'terminal_run',
    description:
      'Run a local terminal command on Windows using PowerShell or CMD. Safe read-only commands may run directly. Commands that can modify files, processes, environment, git state, or system state require explicit user confirmation unless full-access mode is enabled in settings.',
    parameters: {
      type: 'object',
      properties: {
        command: {
          type: 'string',
          description: 'Terminal command to execute.',
        },
        shell: {
          type: 'string',
          enum: ['powershell', 'cmd'],
          description: 'Shell to use. Default powershell.',
        },
        cwd: {
          type: 'string',
          description: 'Optional working directory. Defaults to the shell session cwd.',
        },
        timeoutMs: {
          type: 'number',
          description: 'Optional timeout in milliseconds. Default 120000, max 1800000.',
        },
        confirmed: {
          type: 'boolean',
          description: 'Must be true only after explicit user confirmation for risky commands unless full-access mode is enabled.',
        },
      },
      required: ['command'],
      additionalProperties: false,
    },
    execute: async (args) => {
      const input = (args ?? {}) as Record<string, unknown>
      return terminalRun({
        command: String(input.command ?? ''),
        shell: input.shell === 'cmd' ? 'cmd' : 'powershell',
        cwd: typeof input.cwd === 'string' ? input.cwd : undefined,
        timeoutMs: typeof input.timeoutMs === 'number' ? Math.min(Math.max(input.timeoutMs, 1000), 1800000) : undefined,
        confirmed: input.confirmed === true ? true : undefined,
      })
    },
  },
  {
    name: 'terminal_run_readonly',
    description:
      'Run a strictly allow-listed read-only terminal command on Windows using PowerShell or CMD. Allowed commands: ls, dir, cat, type, rg, git status, git diff, git log, git show.',
    parameters: {
      type: 'object',
      properties: {
        command: {
          type: 'string',
          description: 'Read-only terminal command to execute.',
        },
        shell: {
          type: 'string',
          enum: ['powershell', 'cmd'],
          description: 'Shell to use. Default powershell.',
        },
        cwd: {
          type: 'string',
          description: 'Optional working directory. Defaults to the shell session cwd.',
        },
        timeoutMs: {
          type: 'number',
          description: 'Optional timeout in milliseconds. Default 120000, max 1800000.',
        },
      },
      required: ['command'],
      additionalProperties: false,
    },
    execute: async (args) => {
      const input = (args ?? {}) as Record<string, unknown>
      return terminalRun({
        command: String(input.command ?? ''),
        shell: input.shell === 'cmd' ? 'cmd' : 'powershell',
        cwd: typeof input.cwd === 'string' ? input.cwd : undefined,
        timeoutMs:
          typeof input.timeoutMs === 'number'
            ? Math.min(Math.max(input.timeoutMs, 1000), 1800000)
            : undefined,
        confirmed: input.confirmed === true ? true : undefined,
        readonly: true,
      })
    },
  },
  {
    name: 'terminal_status',
    description: 'Get terminal session status, current cwd, running command, and last exit code. Read-only.',
    parameters: {
      type: 'object',
      properties: {
        shell: {
          type: 'string',
          enum: ['powershell', 'cmd'],
          description: 'Optional shell. Omit to get both sessions.',
        },
      },
      additionalProperties: false,
    },
    execute: async (args) => {
      const input = (args ?? {}) as Record<string, unknown>
      return terminalStatus(input.shell)
    },
  },
  {
    name: 'terminal_interrupt',
    description: 'Interrupt the currently running terminal command for a shell session.',
    parameters: {
      type: 'object',
      properties: {
        shell: {
          type: 'string',
          enum: ['powershell', 'cmd'],
          description: 'Shell session to interrupt. Default powershell.',
        },
      },
      additionalProperties: false,
    },
    execute: async (args) => {
      const input = (args ?? {}) as Record<string, unknown>
      return terminalInterrupt(input.shell)
    },
  },
  {
    name: 'terminal_set_cwd',
    description: 'Set the current working directory for a shell session. Read-only session state change.',
    parameters: {
      type: 'object',
      properties: {
        path: {
          type: 'string',
          description: 'Directory path to switch the shell session to.',
        },
        shell: {
          type: 'string',
          enum: ['powershell', 'cmd'],
          description: 'Shell session. Default powershell.',
        },
      },
      required: ['path'],
      additionalProperties: false,
    },
    execute: async (args) => {
      const input = (args ?? {}) as Record<string, unknown>
      return terminalSetCwd(input.path, input.shell)
    },
  },
]
