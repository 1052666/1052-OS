import fs from 'node:fs/promises'
import path from 'node:path'
import { config } from '../../config.js'

export const AGENT_WORKSPACE_DIR = 'agent-workspace'

const WORKSPACE_README = `# Agent 工作区

这个目录由 1052 OS 自动创建，供 Agent 保存临时文件、草稿、分析中间产物和项目报告。

使用约定：
- 临时文件、草稿、生成报告、导出摘要等默认放在这里，不要散落到项目根目录。
- 建议按用途创建子目录，例如 reports、drafts、temp、exports。
- 文件名应尽量包含任务主题和日期，方便用户后续查找。
- 写入、覆盖、移动或删除文件仍需遵守当前权限模式；默认权限下需要先告知用户并等待确认，完全权限下可直接执行。
`

export function getAgentWorkspacePath() {
  return path.join(config.dataDir, AGENT_WORKSPACE_DIR)
}

export function formatAgentWorkspaceContext() {
  return [
    'Agent 工作区:',
    `- 工作区绝对路径: ${getAgentWorkspacePath()}`,
    '- 用途: 保存 Agent 生成的临时文件、草稿、分析中间产物、项目报告、导出摘要等。',
    '- 默认策略: 用户要求生成文件、报告、整理结果落盘但没有指定路径时，优先写入这个工作区。',
    '- 组织建议: 按任务创建子目录，例如 reports、drafts、temp、exports，并使用有意义的文件名。',
    '- 权限规则: 这里仍然是本地文件写入；默认权限模式下写入/覆盖/删除前必须告知路径和影响并等待确认，完全权限开启时可直接执行。',
  ].join('\n')
}

async function fileExists(target: string) {
  try {
    await fs.access(target)
    return true
  } catch {
    return false
  }
}

export async function ensureAgentWorkspace() {
  const workspace = getAgentWorkspacePath()
  await fs.mkdir(workspace, { recursive: true })

  const readmePath = path.join(workspace, 'README.md')
  if (!(await fileExists(readmePath))) {
    await fs.writeFile(readmePath, WORKSPACE_README, 'utf-8')
  }

  return workspace
}
