import { ReactNode, forwardRef, useCallback, useEffect, useId, useRef, useState } from 'react'
import { useCoupling } from './cardCoupling'

type CardLevel = 1 | 2 | 3
type CardInteractive = 'none' | 'highlight' | 'lift'
type CardPad = 'stat' | 'form' | 'tight'

export interface MirrorCardProps {
  level?: CardLevel
  interactive?: CardInteractive
  pad?: CardPad
  children: ReactNode
  className?: string
  onClick?: () => void
}

export const MirrorCard = forwardRef<HTMLDivElement, MirrorCardProps>(
  ({ level = 1, interactive = 'none', pad = 'form', children, className, onClick }, fwdRef) => {
    const cls = [
      'mr-card',
      `mr-card-level-${level}`,
      `mr-card-pad-${pad}`,
      `mr-card-int-${interactive}`,
      className,
    ].filter(Boolean).join(' ')

    const localRef = useRef<HTMLDivElement | null>(null)
    const id = useId()
    const coupling = useCoupling()

    const setRef = useCallback(
      (el: HTMLDivElement | null) => {
        localRef.current = el
        if (typeof fwdRef === 'function') fwdRef(el)
        else if (fwdRef) fwdRef.current = el
      },
      [fwdRef],
    )

    // Register with the coupling controller. Centers are kept in a JS
    // map (no data-* on the DOM) — per IU-3 codex nit.
    useEffect(() => {
      const el = localRef.current
      if (!el || !coupling) return
      const r = el.getBoundingClientRect()
      coupling.register(id, el, {
        cx: r.left + r.width / 2,
        cy: r.top + r.height / 2,
      })
      const RO = typeof ResizeObserver !== 'undefined' ? ResizeObserver : null
      const ro = RO
        ? new RO(() => {
            if (!el.isConnected) return
            const rr = el.getBoundingClientRect()
            coupling.updatePosition(id, {
              cx: rr.left + rr.width / 2,
              cy: rr.top + rr.height / 2,
            })
          })
        : null
      ro?.observe(el)
      return () => {
        coupling.unregister(id)
        ro?.disconnect()
      }
    }, [coupling, id])

    return (
      <div ref={setRef} className={cls} onClick={onClick} data-mirror-card>
        {children}
      </div>
    )
  },
)
MirrorCard.displayName = 'MirrorCard'

type TextRole = 'label' | 'body' | 'title' | 'meta' | 'big-number'

export interface MirrorTextProps {
  role: TextRole
  as?: keyof JSX.IntrinsicElements
  children: ReactNode
  className?: string
}

export function MirrorText({ role, as: Tag = 'span', children, className }: MirrorTextProps) {
  const TagAny = Tag as any
  return <TagAny className={`mr-text-${role}${className ? ' ' + className : ''}`}>{children}</TagAny>
}

// MirrorStatCard
export interface MirrorStatCardProps {
  label: string
  value: number | string | null
  delta?: { value: string; positive?: boolean }
  className?: string
}

export function MirrorStatCard({ label, value, delta, className }: MirrorStatCardProps) {
  const displayValue = value == null ? '—' : value
  return (
    <MirrorCard level={1} interactive="highlight" pad="stat" className={className}>
      <MirrorText role="label" as="div">{label}</MirrorText>
      <MirrorText role="big-number" as="div">{typeof displayValue === 'number' ? displayValue.toLocaleString() : displayValue}</MirrorText>
      {delta && (
        <MirrorText role="meta" as="div" className={delta.positive ? 'mr-delta-pos' : 'mr-delta-neg'}>
          {delta.value}
        </MirrorText>
      )}
    </MirrorCard>
  )
}

// MirrorButton — outlined chip-style
export interface MirrorButtonProps {
  variant?: 'outlined' | 'subtle'
  disabled?: boolean
  onClick?: () => void
  children: ReactNode
  className?: string
  type?: 'button' | 'submit'
}

export function MirrorButton({ variant = 'outlined', disabled, onClick, children, className, type = 'button' }: MirrorButtonProps) {
  return (
    <button
      type={type}
      className={`mr-button mr-button-${variant}${className ? ' ' + className : ''}`}
      disabled={disabled}
      onClick={onClick}
    >
      {children}
    </button>
  )
}

// MirrorChip — small footer chip
export interface MirrorChipProps {
  active?: boolean
  children: ReactNode
}

export function MirrorChip({ active, children }: MirrorChipProps) {
  return <span className={`mr-chip${active ? ' is-active' : ''}`}>{children}</span>
}

// MirrorCollapsible — "收起" section pattern
export interface MirrorCollapsibleProps {
  title: string
  defaultOpen?: boolean
  rightSlot?: ReactNode
  children: ReactNode
  className?: string
}

export function MirrorCollapsible({ title, defaultOpen = true, rightSlot, children, className }: MirrorCollapsibleProps) {
  const [open, setOpen] = useState(defaultOpen)
  return (
    <div className={`mr-collapsible${className ? ' ' + className : ''}`}>
      <div className="mr-collapsible-header">
        <MirrorText role="title" as="h3">{title}</MirrorText>
        <div className="mr-collapsible-header-right">
          {rightSlot}
          <button className="mr-collapsible-toggle" onClick={() => setOpen(o => !o)} type="button">
            {open ? '收起' : '展开'}
          </button>
        </div>
      </div>
      {open && <div className="mr-collapsible-body">{children}</div>}
    </div>
  )
}

// MirrorProgressBar — "来源与时间窗口" rows
export interface MirrorProgressBarProps {
  label: string
  detail?: string
  fillPercent: number
  totalValue: number | string | null
  totalLabel?: string
}

export function MirrorProgressBar({ label, detail, fillPercent, totalValue, totalLabel = 'tokens' }: MirrorProgressBarProps) {
  const clamped = Math.max(0, Math.min(100, fillPercent))
  const display = totalValue == null ? '—' : typeof totalValue === 'number' ? totalValue.toLocaleString() : totalValue
  return (
    <div className="mr-progress-row">
      <div className="mr-progress-header">
        <MirrorText role="title" as="div">{label}</MirrorText>
        {detail && <MirrorText role="meta" as="div">{detail}</MirrorText>}
      </div>
      <div className="mr-progress-bar">
        <div className="mr-progress-fill" style={{ width: `${clamped}%` }} />
      </div>
      <div className="mr-progress-total">
        <MirrorText role="big-number" as="span">{display}</MirrorText>
        <MirrorText role="meta" as="span">{totalLabel}</MirrorText>
      </div>
    </div>
  )
}

// MirrorInput
export type MirrorInputProps = React.InputHTMLAttributes<HTMLInputElement>

export const MirrorInput = forwardRef<HTMLInputElement, MirrorInputProps>((props, ref) => {
  const { className, ...rest } = props
  return <input ref={ref} className={`mr-input${className ? ' ' + className : ''}`} {...rest} />
})
MirrorInput.displayName = 'MirrorInput'

// MirrorPresetCard
export interface MirrorPresetCardProps {
  name: string
  url?: string
  modelId?: string
  onClick?: () => void
  selected?: boolean
}

export function MirrorPresetCard({ name, url, modelId, onClick, selected }: MirrorPresetCardProps) {
  return (
    <MirrorCard level={2} interactive="lift" pad="tight" onClick={onClick} className={selected ? 'is-selected' : undefined}>
      <MirrorText role="title" as="div">{name}</MirrorText>
      {url && <MirrorText role="body" as="div" className="mr-preset-url">{url}</MirrorText>}
      {modelId && <MirrorText role="meta" as="div">{modelId}</MirrorText>}
    </MirrorCard>
  )
}
