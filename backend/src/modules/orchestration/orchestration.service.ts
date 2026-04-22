import fs from 'node:fs/promises'
import path from 'node:path'
import { HttpError } from '../../http-error.js'
import { config } from '../../config.js'
import { getDataSource, getSqlFile, resolveVariables, getServer, getShellFile, executeShellOnServer, executeLocal } from '../sql/sql.service.js'
import { executeDbQuery } from '../sql/sql.client.js'
import type { Orchestration, OrchestrationInput, OrchestrationExecution, LogEntry, OrchestrationNode, OrchestrationEdge, ThresholdOperator, ColumnMapping } from './orchestration.types.js'

const ORCH_DIR = 'orchestrations'
const LOG_DIR = 'orchestration-logs'
const QUERY_TIMEOUT_MS = 30_000

function orchDirPath() { return path.join(config.dataDir, ORCH_DIR) }
function logDirPath() { return path.join(config.dataDir, LOG_DIR) }
function createId() { return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 9)}` }
function normalizeString(value: unknown, fallback = ''): string { return typeof value === 'string' ? value.trim() : fallback }

// ─── CRUD ────────────────────────────────────────────────────

function validateOrchInput(input: OrchestrationInput) {
  const name = normalizeString(input.name)
  const description = normalizeString(input.description)
  let nodes: OrchestrationNode[] = []
  let edges: OrchestrationEdge[] = []

  if (Array.isArray(input.nodes)) {
    nodes = input.nodes.filter((n: unknown) => n && typeof n === 'object') as OrchestrationNode[]
  }
  if (Array.isArray(input.edges)) {
    edges = input.edges.filter((e: unknown) => e && typeof e === 'object') as OrchestrationEdge[]
  }

  return { name, description, nodes, edges }
}

async function readOrchFile(id: string): Promise<Orchestration> {
  const filePath = path.join(orchDirPath(), `${id}.json`)
  try {
    const raw = await fs.readFile(filePath, 'utf-8')
    return JSON.parse(raw) as Orchestration
  } catch {
    throw new HttpError(404, `编排不存在: ${id}`)
  }
}

export async function listOrchestrations(): Promise<Orchestration[]> {
  const dir = orchDirPath()
  try { await fs.access(dir) } catch { return [] }
  const files = await fs.readdir(dir)
  const items: Orchestration[] = []
  for (const file of files) {
    if (!file.endsWith('.json')) continue
    try {
      const raw = await fs.readFile(path.join(dir, file), 'utf-8')
      items.push(JSON.parse(raw) as Orchestration)
    } catch { /* skip */ }
  }
  return items.sort((a, b) => b.updatedAt - a.updatedAt)
}

export async function createOrchestration(input: OrchestrationInput): Promise<Orchestration> {
  const validated = validateOrchInput(input)
  if (!validated.name) throw new HttpError(400, '编排名称不能为空')
  const now = Date.now()
  const item: Orchestration = { id: createId(), ...validated, createdAt: now, updatedAt: now }
  await fs.mkdir(orchDirPath(), { recursive: true })
  await fs.writeFile(path.join(orchDirPath(), `${item.id}.json`), JSON.stringify(item, null, 2), 'utf-8')
  return item
}

export async function updateOrchestration(id: string, input: OrchestrationInput): Promise<Orchestration> {
  const current = await readOrchFile(id)
  const validated = validateOrchInput(input)
  const updated: Orchestration = {
    ...current,
    name: validated.name || current.name,
    description: input.description !== undefined ? validated.description : current.description,
    nodes: Array.isArray(input.nodes) ? validated.nodes : current.nodes,
    edges: Array.isArray(input.edges) ? validated.edges : current.edges,
    updatedAt: Date.now(),
  }
  await fs.writeFile(path.join(orchDirPath(), `${id}.json`), JSON.stringify(updated, null, 2), 'utf-8')
  return updated
}

export async function deleteOrchestration(id: string) {
  const item = await readOrchFile(id)
  await fs.unlink(path.join(orchDirPath(), `${id}.json`))
  return { ok: true as const, deleted: item }
}

// ─── Node Execution ──────────────────────────────────────────

async function resolveNodeSql(node: OrchestrationNode): Promise<{ sql: string; datasourceId: string }> {
  if (node.sqlFileId) {
    try {
      const file = await getSqlFile(node.sqlFileId)
      return { sql: file.content, datasourceId: node.datasourceId || file.datasourceId }
    } catch { /* fallback */ }
  }
  return { sql: node.sql, datasourceId: node.datasourceId }
}

function checkThreshold(actual: unknown, operator: ThresholdOperator, expected: string): boolean {
  const actualNum = Number(actual)
  const expectedNum = Number(expected)
  const useNum = !isNaN(actualNum) && !isNaN(expectedNum)
  switch (operator) {
    case 'eq': return useNum ? actualNum === expectedNum : String(actual) === expected
    case 'ne': return useNum ? actualNum !== expectedNum : String(actual) !== expected
    case 'gt': return useNum ? actualNum > expectedNum : String(actual) > expected
    case 'gte': return useNum ? actualNum >= expectedNum : String(actual) >= expected
    case 'lt': return useNum ? actualNum < expectedNum : String(actual) < expected
    case 'lte': return useNum ? actualNum <= expectedNum : String(actual) <= expected
    default: return true
  }
}

const sleep = (ms: number, signal?: AbortSignal) => new Promise<void>((resolve, reject) => {
  const timer = setTimeout(resolve, ms)
  signal?.addEventListener('abort', () => { clearTimeout(timer); reject(new Error('已停止')) }, { once: true })
})

// ─── Abort Management ────────────────────────────────────────

const activeControllers = new Map<string, AbortController>()

export function stopOrchestration(id: string): boolean {
  const ctrl = activeControllers.get(id)
  if (!ctrl) return false
  ctrl.abort()
  activeControllers.delete(id)
  return true
}

// ─── In-memory execution progress ───────────────────────────

type ExecutionProgress = {
  orchestrationId: string
  orchestrationName: string
  status: 'running' | 'success' | 'failed' | 'warning'
  logs: LogEntry[]
  startTime: number
  endTime: number | null
}

const activeProgress = new Map<string, ExecutionProgress>()

export function getExecutionProgress(execId: string): ExecutionProgress | null {
  return activeProgress.get(execId) ?? null
}

async function executeWaitNode(node: OrchestrationNode, pushLog: (log: LogEntry) => void, signal?: AbortSignal): Promise<LogEntry> {
  const nodeStart = Date.now()
  const intervalMs = (node.waitIntervalSec || 60) * 1000
  const timeoutMs = (node.waitTimeoutSec || 1800) * 1000
  const stableCount = node.waitStableCount || 2
  const hasThreshold = !!(node.thresholdOperator && node.thresholdValue !== undefined)
  const pollLogId = `${node.id}-poll`

  // 用固定 nodeId 维护一条日志，每次轮询更新内容
  const updatePollLog = (updates: Partial<LogEntry> & { actualValue: string; expectedValue: string; status: LogEntry['status'] }) => {
    pushLog({
      nodeId: pollLogId, nodeName: node.name, nodeType: 'wait', sql: '',
      timestamp: Date.now(), duration: Date.now() - nodeStart,
      ...updates,
    })
  }

  try {
    const resolved = await resolveNodeSql(node)
    const sql = await resolveVariables(resolved.sql)
    const ds = await getDataSource(resolved.datasourceId)
    const dsConfig = { type: ds.type, host: ds.host, port: ds.port, user: ds.user, password: ds.password, database: ds.database, filePath: ds.filePath }

    let lastValue: string | null = null
    let stableHits = 0
    let pollCount = 0

    while (true) {
      if (signal?.aborted) throw new Error('已停止')
      pollCount++
      const elapsed = Date.now() - nodeStart
      if (elapsed > timeoutMs) {
        return {
          nodeId: node.id, nodeName: node.name, nodeType: 'wait', status: 'failed',
          sql, error: `等待超时 (${(timeoutMs / 1000).toFixed(0)}s)，共轮询 ${pollCount} 次`,
          timestamp: Date.now(), duration: Date.now() - nodeStart,
        }
      }

      const result = await Promise.race([
        executeDbQuery(dsConfig, sql, 1),
        new Promise<never>((_, reject) => setTimeout(() => reject(new Error('查询超时 (30s)')), QUERY_TIMEOUT_MS)),
      ])

      const actualValue = result.rows[0]?.[result.columns[0]]
      const valueStr = String(actualValue ?? '')

      // 阈值检查
      if (hasThreshold && !checkThreshold(actualValue, node.thresholdOperator!, node.thresholdValue!)) {
        updatePollLog({
          status: 'running', sql, result: { columns: result.columns, rows: result.rows },
          actualValue: valueStr, expectedValue: `第 ${pollCount} 次查询，阈值 ${node.thresholdOperator} ${node.thresholdValue} 未满足，继续等待`,
        })
        lastValue = null
        stableHits = 0
        await sleep(intervalMs, signal)
        continue
      }

      // 稳定性检查：连续多次查询值相同
      if (lastValue !== null && valueStr === lastValue) {
        stableHits++
      } else {
        stableHits = 1
      }

      if (stableHits >= stableCount) {
        const thresholdInfo = hasThreshold ? ` (阈值 ${node.thresholdOperator} ${node.thresholdValue} 已满足)` : ''
        updatePollLog({
          status: 'success', sql, result: { columns: result.columns, rows: result.rows },
          actualValue: valueStr, expectedValue: `第 ${pollCount} 次查询，连续 ${stableCount} 次稳定${thresholdInfo}`,
        })
        return {
          nodeId: node.id, nodeName: node.name, nodeType: 'wait', status: 'success',
          sql, result: { columns: result.columns, rows: result.rows },
          actualValue: valueStr, expectedValue: `连续 ${stableCount} 次稳定${thresholdInfo}`,
          timestamp: Date.now(), duration: Date.now() - nodeStart,
        }
      }

      updatePollLog({
        status: 'running', sql, result: { columns: result.columns, rows: result.rows },
        actualValue: valueStr, expectedValue: `第 ${pollCount} 次查询，稳定次数 ${stableHits}/${stableCount}，继续等待`,
      })
      lastValue = valueStr

      await sleep(intervalMs, signal)
    }
  } catch (err) {
    return { nodeId: node.id, nodeName: node.name, nodeType: node.type, status: 'failed', sql: node.sql, error: err instanceof Error ? err.message : String(err), timestamp: Date.now(), duration: Date.now() - nodeStart }
  }
}

function escapeCol(name: string) {
  return `\`${name.replace(/`/g, '``')}\``
}

function escapeTableRef(name: string) {
  const parts = name.replace(/[`";]/g, '').split('.').map(p => p.trim()).filter(Boolean)
  return parts.map(p => escapeCol(p)).join('.')
}

function escapeVal(v: unknown): string {
  if (v === null || v === undefined) return 'NULL'
  return `'${String(v).replace(/'/g, "''")}'`
}

async function executeLoadNode(node: OrchestrationNode): Promise<LogEntry> {
  const nodeStart = Date.now()
  try {
    if (!node.targetDatasourceId) throw new Error('未配置目标数据源')
    if (!node.targetTable) throw new Error('未配置目标表')

    const resolved = await resolveNodeSql(node)
    if (!resolved.sql?.trim()) throw new Error('未配置源查询 SQL')
    const sql = await resolveVariables(resolved.sql)
    const srcDs = await getDataSource(resolved.datasourceId)
    const tgtDs = await getDataSource(node.targetDatasourceId)

    const needsDb = (t: string) => t === 'mysql' || t === 'hive'
    if (needsDb(srcDs.type) && !srcDs.database) throw new Error(`源数据源「${srcDs.name}」未配置数据库名`)
    if (needsDb(tgtDs.type) && !tgtDs.database) throw new Error(`目标数据源「${tgtDs.name}」未配置数据库名`)

    const srcConfig = { type: srcDs.type, host: srcDs.host, port: srcDs.port, user: srcDs.user, password: srcDs.password, database: srcDs.database, filePath: srcDs.filePath }
    const tgtConfig = { type: tgtDs.type, host: tgtDs.host, port: tgtDs.port, user: tgtDs.user, password: tgtDs.password, database: tgtDs.database, filePath: tgtDs.filePath }
    const isHive = tgtDs.type === 'hive'

    // Query source data
    const srcResult = await Promise.race([
      executeDbQuery(srcConfig, sql, 10000),
      new Promise<never>((_, reject) => setTimeout(() => reject(new Error('源查询超时 (30s)')), QUERY_TIMEOUT_MS)),
    ])

    if (srcResult.rows.length === 0) {
      return {
        nodeId: node.id, nodeName: node.name, nodeType: 'load', status: 'success',
        sql, affectedRows: 0, result: { columns: srcResult.columns, rows: [] },
        actualValue: '0', timestamp: Date.now(), duration: Date.now() - nodeStart,
      }
    }

    // Build column mapping: source column → target column
    const partitionSet = new Set(
      (node.partitionColumns || '').split(',').map(s => s.trim()).filter(Boolean)
    )

    let rawMappings: ColumnMapping[]
    if (node.columnMappings?.length) {
      rawMappings = node.columnMappings.filter(m => m.source && m.target)
    } else {
      // Auto same-name mapping
      rawMappings = srcResult.columns.map(c => ({
        source: c, target: c,
        isPartition: partitionSet.has(c),
      }))
    }

    if (rawMappings.length === 0) throw new Error('无有效字段映射')

    // Partition columns go last (Hive requirement)
    const normalMappings = rawMappings.filter(m => !m.isPartition)
    const partitionMappings = rawMappings.filter(m => m.isPartition)
    const sortedMappings = [...normalMappings, ...partitionMappings]

    const tableRef = escapeTableRef(node.targetTable)
    const mode = node.mode || 'insert'

    // TRUNCATE + INSERT mode
    if (mode === 'truncate_insert') {
      const truncateSql = isHive
        ? `TRUNCATE TABLE ${tableRef}`
        : `DELETE FROM ${tableRef}`
      await Promise.race([
        executeDbQuery(tgtConfig, truncateSql, 1),
        new Promise<never>((_, reject) => setTimeout(() => reject(new Error('清空目标表超时')), QUERY_TIMEOUT_MS)),
      ])
    }

    // Build INSERT SQL for a batch
    const buildInsertSql = (batch: Record<string, unknown>[]): string => {
      const values = batch.map(row =>
        '(' + sortedMappings.map(m => escapeVal(row[m.source])).join(', ') + ')'
      ).join(',\n')

      const prefix = mode === 'replace' ? 'REPLACE' : 'INSERT'

      if (isHive && partitionMappings.length > 0) {
        // Hive: INSERT INTO TABLE t PARTITION (p1, p2) (c1, c2, p1, p2) VALUES (...)
        const partColList = partitionMappings.map(m => escapeCol(m.target)).join(', ')
        const allColList = sortedMappings.map(m => escapeCol(m.target)).join(', ')
        return `${prefix} INTO TABLE ${tableRef} PARTITION (${partColList}) (${allColList}) VALUES\n${values}`
      }

      const colList = sortedMappings.map(m => escapeCol(m.target)).join(', ')
      return `${prefix} INTO ${tableRef} (${colList}) VALUES\n${values}`
    }

    // Batch insert
    const BATCH_SIZE = 100
    let totalAffected = 0
    for (let i = 0; i < srcResult.rows.length; i += BATCH_SIZE) {
      const batch = srcResult.rows.slice(i, i + BATCH_SIZE)
      const insertSql = buildInsertSql(batch)

      await Promise.race([
        executeDbQuery(tgtConfig, insertSql, 1),
        new Promise<never>((_, reject) => setTimeout(() => reject(new Error('目标写入超时 (30s)')), QUERY_TIMEOUT_MS)),
      ])
      totalAffected += batch.length
    }

    return {
      nodeId: node.id, nodeName: node.name, nodeType: 'load', status: 'success',
      sql, affectedRows: totalAffected,
      result: { columns: srcResult.columns, rows: srcResult.rows.slice(0, 5) },
      actualValue: String(totalAffected),
      timestamp: Date.now(), duration: Date.now() - nodeStart,
    }
  } catch (err) {
    return {
      nodeId: node.id, nodeName: node.name, nodeType: 'load', status: 'failed',
      sql: node.sql, error: err instanceof Error ? err.message : String(err),
      timestamp: Date.now(), duration: Date.now() - nodeStart,
    }
  }
}

async function executeNode(node: OrchestrationNode, signal?: AbortSignal, pushLog?: (log: LogEntry) => void): Promise<LogEntry> {
  if (signal?.aborted) throw new Error('已停止')
  if (node.type === 'wait') return executeWaitNode(node, pushLog || (() => {}), signal)
  if (node.type === 'load') return executeLoadNode(node)
  if (node.type === 'shell') {
    const nodeStart = Date.now()
    try {
      let script = node.shellContent || ''
      if (node.shellFileId) {
        try {
          const file = await getShellFile(node.shellFileId)
          script = file.content
        } catch { /* fallback */ }
      }
      if (!script.trim()) throw new Error('未配置脚本内容')

      const result = node.serverId
        ? await executeShellOnServer(await getServer(node.serverId), script)
        : await executeLocal(script)

      return {
        nodeId: node.id,
        nodeName: node.name,
        nodeType: 'shell',
        status: result.exitCode === 0 ? 'success' : 'failed',
        sql: script.slice(0, 500),
        error: result.exitCode !== 0 ? result.stderr.slice(0, 500) : undefined,
        result: { columns: ['stdout', 'stderr', 'exitCode', 'duration'], rows: [{ stdout: result.stdout.slice(0, 500), stderr: result.stderr.slice(0, 200), exitCode: result.exitCode, duration: result.duration }] },
        actualValue: result.stdout.slice(0, 200).trim(),
        timestamp: Date.now(),
        duration: result.duration,
      }
    } catch (err) {
      return { nodeId: node.id, nodeName: node.name, nodeType: 'shell', status: 'failed', sql: node.shellContent || '', error: err instanceof Error ? err.message : String(err), timestamp: Date.now(), duration: Date.now() - nodeStart }
    }
  }
  const nodeStart = Date.now()
  try {
    const resolved = await resolveNodeSql(node)
    const sql = await resolveVariables(resolved.sql)
    const ds = await getDataSource(resolved.datasourceId)

    const result = await Promise.race([
      executeDbQuery(
        { type: ds.type, host: ds.host, port: ds.port, user: ds.user, password: ds.password, database: ds.database, filePath: ds.filePath },
        sql,
        node.type === 'debug' ? 2 : 1,
      ),
      new Promise<never>((_, reject) => setTimeout(() => reject(new Error('查询超时 (30s)')), QUERY_TIMEOUT_MS)),
    ])

    if (node.type === 'sql') {
      const affectedRows = result.rows[0]?.affectedRows
      return { nodeId: node.id, nodeName: node.name, nodeType: node.type, status: 'success', sql, affectedRows: typeof affectedRows === 'number' ? affectedRows : result.rowCount, timestamp: Date.now(), duration: Date.now() - nodeStart }
    }

    const actualValue = result.rows[0]?.[result.columns[0]]
    let thresholdPassed = true
    if (node.thresholdOperator && node.thresholdValue !== undefined) {
      thresholdPassed = checkThreshold(actualValue, node.thresholdOperator, node.thresholdValue)
    }
    return {
      nodeId: node.id, nodeName: node.name, nodeType: node.type,
      status: thresholdPassed ? 'success' : 'warning', sql,
      result: { columns: result.columns, rows: result.rows },
      thresholdPassed, actualValue: String(actualValue ?? ''), expectedValue: node.thresholdValue,
      timestamp: Date.now(), duration: Date.now() - nodeStart,
    }
  } catch (err) {
    return { nodeId: node.id, nodeName: node.name, nodeType: node.type, status: 'failed', sql: node.sql, error: err instanceof Error ? err.message : String(err), timestamp: Date.now(), duration: Date.now() - nodeStart }
  }
}

// ─── DAG Execution ───────────────────────────────────────────

export async function startExecution(id: string): Promise<string> {
  const orch = await readOrchFile(id)
  const execId = createId()
  const controller = new AbortController()
  activeControllers.set(id, controller)

  const progress: ExecutionProgress = {
    orchestrationId: id, orchestrationName: orch.name,
    status: 'running', logs: [], startTime: Date.now(), endTime: null,
  }
  activeProgress.set(execId, progress)

  // Run async
  ;(async () => {
    const signal = controller.signal
    let hasWarning = false
    let hasFailed = false
    let stopped = false

    const enabledNodes = orch.nodes.filter(n => n.enabled)
    const edges = orch.edges || []

    const pushLog = (log: LogEntry) => {
      const idx = progress.logs.findIndex(l => l.nodeId === log.nodeId)
      if (idx >= 0) {
        progress.logs = progress.logs.map((l, i) => i === idx ? log : l)
      } else {
        progress.logs = [...progress.logs, log]
      }
    }

    for (const node of orch.nodes.filter(n => !n.enabled)) {
      pushLog({ nodeId: node.id, nodeName: node.name, nodeType: node.type, status: 'skipped', sql: node.sql, timestamp: Date.now(), duration: 0 })
    }

    try {
      if (edges.length === 0) {
        for (const node of enabledNodes) {
          const log = await executeNode(node, signal, pushLog)
          pushLog(log)
          if (log.status === 'failed') { hasFailed = true; break }
          if (log.status === 'warning') hasWarning = true
        }
      } else {
        const incomingMap = new Map<string, Set<string>>()
        for (const node of enabledNodes) incomingMap.set(node.id, new Set())
        for (const edge of edges) {
          if (incomingMap.has(edge.target)) incomingMap.get(edge.target)!.add(edge.source)
        }

        const completed = new Set<string>()
        const failedNodes = new Set<string>()

        while (completed.size + failedNodes.size < enabledNodes.length) {
          const ready = enabledNodes.filter(n =>
            !completed.has(n.id) && !failedNodes.has(n.id) &&
            [...(incomingMap.get(n.id) || [])].every(src => completed.has(src))
          )
          if (ready.length === 0) break

          const results = await Promise.all(ready.map(n => executeNode(n, signal, pushLog)))
          for (const log of results) {
            pushLog(log)
            if (log.status === 'failed') { failedNodes.add(log.nodeId); hasFailed = true }
            else { completed.add(log.nodeId); if (log.status === 'warning') hasWarning = true }
          }
        }

        for (const node of enabledNodes) {
          if (!completed.has(node.id) && !failedNodes.has(node.id)) {
            pushLog({ nodeId: node.id, nodeName: node.name, nodeType: node.type, status: 'skipped', sql: node.sql, timestamp: Date.now(), duration: 0 })
          }
        }
      }
    } catch (err) {
      if (signal.aborted) { stopped = true; hasFailed = true }
    } finally {
      activeControllers.delete(id)
    }

    progress.status = stopped ? 'failed' : hasFailed ? 'failed' : hasWarning ? 'warning' : 'success'
    progress.endTime = Date.now()

    // Persist to disk
    const execution: OrchestrationExecution = {
      id: execId, orchestrationId: id, orchestrationName: orch.name,
      status: progress.status, logs: progress.logs,
      startTime: progress.startTime, endTime: progress.endTime,
    }
    try {
      const logSubDir = path.join(logDirPath(), id)
      await fs.mkdir(logSubDir, { recursive: true })
      await fs.writeFile(path.join(logSubDir, `${execId}.json`), JSON.stringify(execution, null, 2), 'utf-8')
    } catch { /* non-critical */ }
  })()

  return execId
}

export async function listExecutionLogs(orchestrationId: string): Promise<OrchestrationExecution[]> {
  const dir = path.join(logDirPath(), orchestrationId)
  try { await fs.access(dir) } catch { return [] }
  const files = await fs.readdir(dir)
  const items: OrchestrationExecution[] = []
  for (const file of files) {
    if (!file.endsWith('.json')) continue
    try { const raw = await fs.readFile(path.join(dir, file), 'utf-8'); items.push(JSON.parse(raw) as OrchestrationExecution) } catch { /* skip */ }
  }
  return items.sort((a, b) => b.startTime - a.startTime)
}

export async function getExecutionLog(orchestrationId: string, logId: string): Promise<OrchestrationExecution> {
  const filePath = path.join(logDirPath(), orchestrationId, `${logId}.json`)
  try { const raw = await fs.readFile(filePath, 'utf-8'); return JSON.parse(raw) as OrchestrationExecution }
  catch { throw new HttpError(404, `执行日志不存在: ${logId}`) }
}
