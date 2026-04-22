export type AgentTool = {
  name: string
  description: string
  parameters: Record<string, unknown>
  execute: (args: unknown) => Promise<unknown>
}
