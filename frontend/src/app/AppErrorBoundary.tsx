import { Component, type ErrorInfo, type ReactNode } from 'react'

type State = { error?: Error }

export class AppErrorBoundary extends Component<{ children: ReactNode }, State> {
  state: State = {}

  static getDerivedStateFromError(error: Error): State {
    return { error }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    if (import.meta.env.PROD) {
      void fetch('/api/logs/frontend', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ level: 'error', message: error.message, stack: error.stack, componentStack: info.componentStack }),
      }).catch(() => undefined)
    }
  }

  render() {
    if (!this.state.error) return this.props.children
    return (
      <main style={{ display: 'grid', minHeight: '100%', placeItems: 'center', padding: 24, background: 'var(--bg-canvas)' }}>
        <section style={{ maxWidth: 520, padding: 24, border: '1px solid var(--line-default)', borderRadius: 8, background: 'var(--bg-panel)' }}>
          <h1 style={{ fontSize: 18, marginBottom: 8 }}>界面出现异常</h1>
          <p style={{ color: 'var(--text-secondary)', marginBottom: 18 }}>{this.state.error.message}</p>
          <button type="button" onClick={() => window.location.reload()} style={{ minHeight: 36, padding: '0 14px', borderRadius: 6, background: 'var(--accent)', color: 'var(--text-inverse)', cursor: 'pointer' }}>重新载入</button>
        </section>
      </main>
    )
  }
}
