import { Check, ChevronRight, CircleAlert, Clock3, Cpu, ShieldAlert, X } from 'lucide-react'
import { useMutation } from '@tanstack/react-query'
import { agentApi } from '../../data/api'
import { useShellStore } from '../../state/shell'
import { Badge, Button, IconButton } from '../ui'
import styles from './shell.module.css'

const statusLabel = {
  idle: '空闲',
  running: '运行中',
  'waiting-approval': '等待确认',
  completed: '已完成',
  cancelled: '已停止',
  error: '失败',
} as const

export function RuntimeInspector() {
  const open = useShellStore((state) => state.inspectorOpen)
  const setOpen = useShellStore((state) => state.setInspectorOpen)
  const runtime = useShellStore((state) => state.runtime)
  const selectedTrace = useShellStore((state) => state.selectedTrace)
  const inspectTrace = useShellStore((state) => state.inspectTrace)
  const dispatch = useShellStore((state) => state.dispatchRuntime)
  const approval = useMutation({
    mutationFn: ({ id, approved }: { id: string; approved: boolean }) => agentApi.resolveApproval(id, approved),
    onSuccess: (result) => {
      const trace = runtime.traces.find((item) => item.approvalId === result.approvalId)
      dispatch({
        type: 'event',
        event: {
          type: 'approval-resolved',
          approvalId: result.approvalId,
          approved: result.approved,
          decision: result.approved ? 'approved' : 'denied',
          callId: trace?.callId,
          name: trace?.raw?.name,
        },
      })
    },
  })

  if (!open) return null
  const pending = runtime.traces.filter((trace) => trace.kind === 'approval' && trace.status === 'warning')
  const totalTokens = runtime.usage?.totalTokens ?? runtime.usage?.inputTokens ?? 0
  const duration = runtime.startedAt ? Math.max(0, (runtime.finishedAt ?? Date.now()) - runtime.startedAt) : 0

  return (
    <aside className={styles.inspector} aria-label="Runtime 检查器">
      <header className={styles.inspectorHeader}>
        <div><strong>运行检查器</strong><span>1052 Runtime</span></div>
        <IconButton aria-label="关闭检查器" onClick={() => setOpen(false)}><X size={17} /></IconButton>
      </header>
      <div className={styles.inspectorMetrics}>
        <div><Cpu size={15} /><span>状态</span><strong>{statusLabel[runtime.status]}</strong></div>
        <div><Clock3 size={15} /><span>耗时</span><strong>{duration ? `${(duration / 1000).toFixed(1)}s` : '0s'}</strong></div>
        <div><Check size={15} /><span>Token</span><strong>{totalTokens.toLocaleString()}</strong></div>
      </div>

      {pending.map((trace) => (
        <section key={trace.id} className={styles.approvalBox}>
          <div className={styles.approvalTitle}><ShieldAlert size={17} /><strong>{trace.title}</strong></div>
          {trace.detail ? <pre>{trace.detail}</pre> : null}
          <div className={styles.approvalActions}>
            <Button size="small" onClick={() => trace.approvalId && approval.mutate({ id: trace.approvalId, approved: false })}>拒绝</Button>
            <Button size="small" variant="primary" onClick={() => trace.approvalId && approval.mutate({ id: trace.approvalId, approved: true })}>允许</Button>
          </div>
        </section>
      ))}

      <div className={styles.traceList}>
        {runtime.traces.length === 0 ? <div className={styles.inspectorEmpty}>Runtime 暂无活动</div> : null}
        {runtime.traces.map((trace) => (
          <button key={trace.id} type="button" className={`${styles.traceItem} ${selectedTrace?.id === trace.id ? styles.traceSelected : ''}`} onClick={() => inspectTrace(trace)}>
            <span className={`${styles.traceDot} ${styles[`trace_${trace.status}`]}`} />
            <span><strong>{trace.title}</strong>{trace.detail ? <small>{trace.detail}</small> : null}</span>
            <ChevronRight size={14} />
          </button>
        ))}
      </div>

      {selectedTrace ? (
        <section className={styles.traceDetail}>
          <div><strong>事件详情</strong><Badge tone={selectedTrace.status === 'error' ? 'danger' : 'default'}>{selectedTrace.kind}</Badge></div>
          <pre>{JSON.stringify(selectedTrace.raw ?? selectedTrace, null, 2)}</pre>
        </section>
      ) : runtime.error ? (
        <section className={styles.traceDetail}><div><CircleAlert size={16} /><strong>错误信息</strong></div><pre>{runtime.error}</pre></section>
      ) : null}
    </aside>
  )
}
