import { Check, Copy } from 'lucide-react'
import { lazy, Suspense, useState, type ReactNode } from 'react'
import ReactMarkdown from 'react-markdown'
import rehypeKatex from 'rehype-katex'
import rehypeSanitize from 'rehype-sanitize'
import remarkGfm from 'remark-gfm'
import remarkMath from 'remark-math'
import { IconButton, Tooltip } from '../ui'
import styles from './chat.module.css'

const MermaidDiagram = lazy(() => import('./MermaidDiagram'))

function CodeBlock({ className, children }: { className?: string; children?: ReactNode }) {
  const [copied, setCopied] = useState(false)
  const language = className?.replace('language-', '') ?? ''
  const code = String(children ?? '').replace(/\n$/, '')
  if (language === 'mermaid') {
    return <Suspense fallback={<div className={styles.diagramLoading}>正在绘制图表</div>}><MermaidDiagram code={code} /></Suspense>
  }
  const copy = async () => {
    await navigator.clipboard.writeText(code)
    setCopied(true)
    window.setTimeout(() => setCopied(false), 1300)
  }
  return (
    <div className={styles.codeBlock}>
      <div><span>{language || 'text'}</span><Tooltip label="复制代码"><IconButton aria-label="复制代码" onClick={copy}>{copied ? <Check size={14} /> : <Copy size={14} />}</IconButton></Tooltip></div>
      <pre><code>{code}</code></pre>
    </div>
  )
}

export function MarkdownView({ content }: { content: string }) {
  return (
    <div className={styles.markdown}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm, remarkMath]}
        rehypePlugins={[rehypeSanitize, rehypeKatex]}
        components={{
          code({ className, children }) {
            if (!className && !String(children).includes('\n')) return <code className={styles.inlineCode}>{children}</code>
            return <CodeBlock className={className}>{children}</CodeBlock>
          },
          a({ href, children }) {
            const safe = href?.startsWith('/') || href?.startsWith('https://') || href?.startsWith('http://')
            return safe ? <a href={href} target={href?.startsWith('/') ? undefined : '_blank'} rel="noreferrer">{children}</a> : <span>{children}</span>
          },
          img({ src, alt }) {
            const safe = src?.startsWith('/') || src?.startsWith('https://') || src?.startsWith('http://')
            return safe ? <img src={src} alt={alt ?? ''} loading="lazy" /> : null
          },
        }}
      >
        {content}
      </ReactMarkdown>
    </div>
  )
}
