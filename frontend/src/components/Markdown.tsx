import {
  Children,
  createElement,
  isValidElement,
  memo,
  useEffect,
  useMemo,
  useRef,
  useState,
  type MouseEvent,
  type ReactNode,
} from 'react'
import ReactMarkdown, { type Components } from 'react-markdown'
import rehypeKatex from 'rehype-katex'
import rehypeRaw from 'rehype-raw'
import rehypeSanitize, {
  defaultSchema,
  type Options as SanitizeSchema,
} from 'rehype-sanitize'
import remarkBreaks from 'remark-breaks'
import remarkDirective from 'remark-directive'
import remarkGfm from 'remark-gfm'
import remarkMath from 'remark-math'
import type { Node } from 'unist'
import { visit } from 'unist-util-visit'
import 'katex/dist/katex.min.css'

type DirectiveAttributes = Record<string, string | number | boolean | null | undefined>

type DirectiveNode = Node & {
  name?: string
  attributes?: DirectiveAttributes
  data?: {
    hName?: string
    hProperties?: Record<string, unknown>
  }
}

type CodeElementProps = {
  className?: string
  children?: ReactNode
}

type MarkdownProps = {
  text: string
  resolveUrl?: (url: string, kind: 'link' | 'image') => string
  onLinkClick?: (href: string, event: MouseEvent<HTMLAnchorElement>) => void
}

const KEYWORDS = new Set([
  'async',
  'await',
  'break',
  'case',
  'catch',
  'class',
  'const',
  'continue',
  'default',
  'else',
  'export',
  'extends',
  'false',
  'finally',
  'for',
  'from',
  'function',
  'if',
  'import',
  'in',
  'let',
  'new',
  'null',
  'return',
  'switch',
  'throw',
  'true',
  'try',
  'type',
  'undefined',
  'while',
])

const CONTAINER_TITLES: Record<string, string> = {
  note: 'Note',
  info: 'Info',
  tip: 'Tip',
  success: 'Success',
  warning: 'Warning',
  danger: 'Danger',
  important: 'Important',
}

const MERMAID_LANGS = new Set([
  'mermaid',
  'mmd',
  'flowchart',
  'graph',
  'sequence',
  'sequencediagram',
  'classdiagram',
  'statediagram',
  'erdiagram',
  'gantt',
  'journey',
  'gitgraph',
  'pie',
  'mindmap',
  'timeline',
  'quadrantchart',
  'requirementdiagram',
  'c4context',
])

let nextMermaidId = 0

const markdownHtmlSchema: SanitizeSchema = {
  ...defaultSchema,
  tagNames: [
    ...(defaultSchema.tagNames ?? []),
    'article',
    'aside',
    'figure',
    'figcaption',
    'mark',
    'u',
  ],
  attributes: {
    ...defaultSchema.attributes,
    div: [
      ...(defaultSchema.attributes?.div ?? []),
      ['className', /^markdown-/],
    ],
    span: [
      ...(defaultSchema.attributes?.span ?? []),
      ['className', /^markdown-/],
    ],
    aside: [
      'dataTitle',
      ['className', 'markdown-container'],
      ['className', /^markdown-container-/],
    ],
    article: defaultSchema.attributes?.div ?? [],
    figure: defaultSchema.attributes?.div ?? [],
    figcaption: defaultSchema.attributes?.div ?? [],
  },
}

const REMARK_PLUGINS = [
  remarkGfm,
  remarkBreaks,
  remarkMath,
  remarkDirective,
  remarkCustomContainers,
  remarkFixInvalidDirectives,
]

const SANITIZE_PLUGIN: [typeof rehypeSanitize, SanitizeSchema] = [
  rehypeSanitize,
  markdownHtmlSchema,
]

const REHYPE_PLUGINS = [
  rehypeRaw,
  SANITIZE_PLUGIN,
  rehypeKatex,
]

const Markdown = memo(function Markdown({ text, resolveUrl, onLinkClick }: MarkdownProps) {
  const components = useMemo(
    () => createMarkdownComponents(resolveUrl, onLinkClick),
    [resolveUrl, onLinkClick],
  )
  const normalizedText = useMemo(() => normalizeContainerOpeners(text), [text])

  return (
    <div className="markdown">
      <ReactMarkdown
        remarkPlugins={REMARK_PLUGINS}
        rehypePlugins={REHYPE_PLUGINS}
        components={components}
      >
        {normalizedText}
      </ReactMarkdown>
    </div>
  )
})

export default Markdown

function createMarkdownComponents(
  resolveUrl?: MarkdownProps['resolveUrl'],
  onLinkClick?: MarkdownProps['onLinkClick'],
): Components {
  const heading = (level: 1 | 2 | 3 | 4 | 5 | 6) =>
    function Heading({ children }: { children?: ReactNode }) {
      const text = reactNodeToText(children)
      return createElement(
        `h${level}`,
        { id: slugifyHeading(text) },
        children,
      )
    }

  return {
    a({ href, title, children }) {
      const originalHref = href ?? ''
      const safeHref = resolveUrl ? resolveUrl(originalHref, 'link') : originalHref
      const isExternal = /^[a-z][a-z0-9+.-]*:/i.test(originalHref) && !originalHref.startsWith('file:')
      return (
        <a
          href={safeHref || originalHref || '#'}
          title={title}
          target={isExternal ? '_blank' : undefined}
          rel={isExternal ? 'noreferrer' : undefined}
          onClick={(event) => onLinkClick?.(originalHref, event)}
        >
          {children}
        </a>
      )
    },
    img({ src, alt, title }) {
      const safeSrc = src && resolveUrl ? resolveUrl(src, 'image') : src
      return <img src={safeSrc} alt={alt ?? ''} title={title} loading="lazy" decoding="async" />
    },
    h1: heading(1),
    h2: heading(2),
    h3: heading(3),
    h4: heading(4),
    h5: heading(5),
    h6: heading(6),
    pre({ children }) {
      const child = Children.toArray(children)[0]
      if (isValidElement<CodeElementProps>(child)) {
        const className = child.props.className ?? ''
        const lang = className.match(/language-([A-Za-z0-9_-]+)/)?.[1] ?? ''
        const text = reactNodeToText(child.props.children).replace(/\n$/, '')
        if (isMermaidBlock(lang, text)) return <MermaidBlock text={text} />
        return <CodeBlock lang={lang} text={text} />
      }

      return <pre>{children}</pre>
    },
    table({ children }) {
      return (
        <div className="table-wrap">
          <table>{children}</table>
        </div>
      )
    },
  }
}

function remarkCustomContainers() {
  return (tree: Node) => {
    visit(tree, 'containerDirective', (node) => {
      const directive = node as DirectiveNode
      const rawName = String(directive.name ?? '').trim().toLowerCase()
      if (!rawName.match(/^[a-z][a-z0-9_-]*$/)) return

      const kind = CONTAINER_TITLES[rawName] ? rawName : 'custom'
      const explicitTitle = getAttribute(directive.attributes, 'title')
      const data = directive.data || (directive.data = {})

      data.hName = 'aside'
      data.hProperties = {
        className: ['markdown-container', `markdown-container-${kind}`],
        dataTitle: explicitTitle || CONTAINER_TITLES[rawName] || toTitle(rawName),
      }
    })
  }
}

function remarkFixInvalidDirectives() {
  return (tree: Node) => {
    visit(tree, 'textDirective' as any, (node: any, index: any, parent: any) => {
      if (!parent || index == null) return
      const name = String(node.name ?? '')
      if (/^[a-zA-Z_]/.test(name)) return
      let text = ':' + name
      if (Array.isArray(node.children)) {
        const label = node.children.map((c: any) => c.value ?? '').join('')
        if (label) text += '[' + label + ']'
      }
      if (node.attributes && typeof node.attributes === 'object') {
        const attrs = Object.entries(node.attributes as Record<string, string>)
          .map(([k, v]) => k + '="' + String(v) + '"')
          .join(' ')
        if (attrs) text += '{' + attrs + '}'
      }
      parent.children[index] = { type: 'text', value: text }
    })
  }
}

function normalizeContainerOpeners(text: string) {
  return text.replace(
    /^:::\s+([A-Za-z][A-Za-z0-9_-]*)(.*)$/gm,
    (_line: string, name: string, rest: string) => {
      const value = rest.trim()
      if (!value) return `:::${name}`
      if (value.startsWith('{') || value.startsWith('[')) return `:::${name}${value}`
      return `:::${name}{title="${escapeDirectiveAttribute(value)}"}`
    },
  )
}

function escapeDirectiveAttribute(value: string) {
  return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')
}

function getAttribute(attributes: DirectiveAttributes | undefined, key: string) {
  const value = attributes?.[key]
  if (typeof value === 'string') return value.trim()
  if (typeof value === 'number') return String(value)
  return ''
}

function toTitle(value: string) {
  return value
    .split(/[-_]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ')
}

function reactNodeToText(node: ReactNode): string {
  if (Array.isArray(node)) return node.map(reactNodeToText).join('')
  if (typeof node === 'string' || typeof node === 'number') return String(node)
  if (isValidElement<{ children?: ReactNode }>(node)) return reactNodeToText(node.props.children)
  return ''
}

function slugifyHeading(value: string) {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s_-]+/gu, '')
    .replace(/\s+/g, '-')
}

function isMermaidBlock(lang: string, text: string) {
  const normalizedLang = lang.toLowerCase()
  if (MERMAID_LANGS.has(normalizedLang)) return true

  const firstLine = text.trimStart().split(/\r?\n/, 1)[0]?.trim() ?? ''
  return Boolean(
    firstLine.match(
      /^(flowchart|graph|sequenceDiagram|classDiagram|stateDiagram-v2|stateDiagram|erDiagram|gantt|journey|gitGraph|pie|mindmap|timeline|quadrantChart|requirementDiagram|C4Context)\b/,
    ),
  )
}

function MermaidBlock({ text }: { text: string }) {
  const [svg, setSvg] = useState('')
  const [error, setError] = useState('')
  const containerRef = useRef<HTMLDivElement>(null)
  const diagramId = useRef(`mermaid-${++nextMermaidId}`)

  useEffect(() => {
    let cancelled = false

    async function renderDiagram() {
      try {
        setError('')
        setSvg('')

        const mermaid = (await import('mermaid')).default
        const rootStyles = getComputedStyle(document.documentElement)
        const fg = readCssVar(rootStyles, '--fg', '#e5e7eb')
        const fgMuted = readCssVar(rootStyles, '--fg-3', '#9ca3af')
        const surface = readCssVar(rootStyles, '--surface-1', '#111827')
        const accent = readCssVar(rootStyles, '--accent', '#818cf8')
        const hairline = readCssVar(rootStyles, '--hairline', '#374151')

        mermaid.initialize({
          startOnLoad: false,
          securityLevel: 'strict',
          theme: 'base',
          themeVariables: {
            primaryColor: surface,
            primaryTextColor: fg,
            primaryBorderColor: hairline,
            lineColor: accent,
            secondaryColor: surface,
            tertiaryColor: surface,
            textColor: fg,
            noteTextColor: fg,
            noteBkgColor: surface,
            noteBorderColor: hairline,
            actorTextColor: fg,
            actorBorder: hairline,
            actorBkg: surface,
            labelTextColor: fg,
            signalTextColor: fgMuted,
          },
        })

        const result = await mermaid.render(diagramId.current, text)
        if (cancelled) return

        setSvg(result.svg)
        window.setTimeout(() => {
          if (!cancelled && containerRef.current) {
            result.bindFunctions?.(containerRef.current)
          }
        }, 0)
      } catch (err) {
        if (!cancelled) {
          const message = err instanceof Error ? err.message : '未知错误'
          setError(message)
        }
      }
    }

    renderDiagram()

    return () => {
      cancelled = true
    }
  }, [text])

  if (error) {
    return (
      <div className="mermaid-block mermaid-error">
        <div className="mermaid-error-title">图表渲染失败</div>
        <div className="mermaid-error-message">{error}</div>
        <CodeBlock lang="mermaid" text={text} />
      </div>
    )
  }

  return (
    <div className="mermaid-block" ref={containerRef}>
      {svg ? (
        <div className="mermaid-svg" dangerouslySetInnerHTML={{ __html: svg }} />
      ) : (
        <div className="mermaid-loading">正在渲染图表...</div>
      )}
    </div>
  )
}

function readCssVar(styles: CSSStyleDeclaration, name: string, fallback: string) {
  return styles.getPropertyValue(name).trim() || fallback
}

function CodeBlock({ lang, text }: { lang: string; text: string }) {
  const [copied, setCopied] = useState(false)

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text)
      setCopied(true)
      window.setTimeout(() => setCopied(false), 1200)
    } catch {
      setCopied(false)
    }
  }

  return (
    <div className="code-block">
      <div className="code-head">
        <span>{lang || 'text'}</span>
        <button type="button" onClick={copy}>
          {copied ? '已复制' : '复制'}
        </button>
      </div>
      <pre>
        <code>{highlightCode(text)}</code>
      </pre>
    </div>
  )
}

function highlightCode(text: string): ReactNode[] {
  const nodes: ReactNode[] = []
  const pattern = /(\/\/.*$|\/\*[\s\S]*?\*\/|"(?:\\.|[^"])*"|'(?:\\.|[^'])*'|`(?:\\.|[^`])*`|\b\d+(?:\.\d+)?\b|\b[A-Za-z_$][\w$]*\b)/gm
  let lastIndex = 0
  let key = 0
  let match: RegExpExecArray | null

  while ((match = pattern.exec(text)) !== null) {
    if (match.index > lastIndex) nodes.push(text.slice(lastIndex, match.index))
    const token = match[0]
    let className = ''
    if (token.startsWith('//') || token.startsWith('/*')) className = 'tok-comment'
    else if (/^["'`]/.test(token)) className = 'tok-string'
    else if (/^\d/.test(token)) className = 'tok-number'
    else if (KEYWORDS.has(token)) className = 'tok-keyword'

    nodes.push(
      className ? (
        <span key={key++} className={className}>
          {token}
        </span>
      ) : (
        token
      ),
    )
    lastIndex = match.index + token.length
  }

  if (lastIndex < text.length) nodes.push(text.slice(lastIndex))
  return nodes
}
