import { useEffect, useMemo, useState } from 'react'
import Markdown from './Markdown'

type CollapsibleFormat = 'markdown' | 'code' | 'text'
type CollapseMode = 'plain' | 'rendered'

type Props = {
  text: string
  format?: CollapsibleFormat
  collapsedLines?: number
  collapsedChars?: number
  collapseMode?: CollapseMode
}

export default function CollapsibleContent({
  text,
  format = 'markdown',
  collapsedLines = 64,
  collapsedChars = 6000,
  collapseMode = 'plain',
}: Props) {
  const normalizedText = text.replace(/\r\n/g, '\n')
  const lineCount = normalizedText ? normalizedText.split('\n').length : 0
  const collapsible = lineCount > collapsedLines || normalizedText.length > collapsedChars

  const previewText = useMemo(
    () =>
      collapsible
        ? buildPreviewText(normalizedText, format, collapsedLines, collapsedChars, collapseMode)
        : normalizedText,
    [collapseMode, collapsedChars, collapsedLines, collapsible, format, normalizedText],
  )

  const [expanded, setExpanded] = useState(!collapsible)

  useEffect(() => {
    setExpanded(!collapsible)
  }, [collapsible, normalizedText])

  const shouldRenderPreviewAsPlain = collapsible && !expanded && collapseMode === 'plain'
  const renderText = expanded || !collapsible ? normalizedText : previewText

  return (
    <div className={`collapsible-content${expanded ? ' expanded' : ' collapsed'}`}>
      <div className="collapsible-content-body">
        {shouldRenderPreviewAsPlain ? (
          <div className={`collapsible-content-plain ${format}`}>{previewText}</div>
        ) : format === 'markdown' ? (
          <Markdown text={renderText} />
        ) : (
          <pre>
            <code>{renderText}</code>
          </pre>
        )}
      </div>

      {collapsible ? (
        <div className="collapsible-content-foot">
          <span className="collapsible-content-meta">
            {expanded ? '已展开完整内容' : `当前仅展示前 ${Math.min(collapsedLines, lineCount)} 行预览`}
          </span>
          <button className="chip" type="button" onClick={() => setExpanded((current) => !current)}>
            {expanded ? '收起内容' : '展开全文'}
          </button>
        </div>
      ) : null}
    </div>
  )
}

function buildPreviewText(
  text: string,
  format: CollapsibleFormat,
  collapsedLines: number,
  collapsedChars: number,
  collapseMode: CollapseMode,
) {
  const lines = text.split('\n')
  let preview = lines.slice(0, collapsedLines).join('\n')
  if (preview.length > collapsedChars) {
    preview = preview.slice(0, collapsedChars)
  }

  preview = preview.trimEnd()

  if (collapseMode === 'plain') {
    return preview.length < text.length ? `${preview}\n\n...` : preview
  }

  if (format === 'markdown') {
    preview = closeMarkdownFences(preview)
    return `${preview}\n\n> 内容已折叠，点击下方可展开完整内容。`
  }

  return `${preview}\n\n...`
}

function closeMarkdownFences(text: string) {
  let next = text

  const backtickFenceCount = countMatches(next, /^```/gm)
  if (backtickFenceCount % 2 === 1) {
    next += '\n```'
  }

  const tildeFenceCount = countMatches(next, /^~~~/gm)
  if (tildeFenceCount % 2 === 1) {
    next += '\n~~~'
  }

  return next
}

function countMatches(text: string, pattern: RegExp) {
  const matches = text.match(pattern)
  return matches ? matches.length : 0
}
