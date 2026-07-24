import { useEffect, useId, useState } from 'react'
import styles from './chat.module.css'

export default function MermaidDiagram({ code }: { code: string }) {
  const id = useId().replace(/:/g, '')
  const [svg, setSvg] = useState('')
  const [error, setError] = useState('')

  useEffect(() => {
    let cancelled = false
    import('mermaid')
      .then(async ({ default: mermaid }) => {
        mermaid.initialize({ startOnLoad: false, securityLevel: 'strict', theme: document.documentElement.dataset.theme === 'light' ? 'neutral' : 'dark' })
        const result = await mermaid.render(`m-${id}`, code)
        if (!cancelled) setSvg(result.svg)
      })
      .catch((reason: unknown) => {
        if (!cancelled) setError(reason instanceof Error ? reason.message : '图表语法错误')
      })
    return () => { cancelled = true }
  }, [code, id])

  if (error) return <pre className={styles.diagramError}>{error}</pre>
  return <div className={styles.diagram} dangerouslySetInnerHTML={{ __html: svg }} />
}
