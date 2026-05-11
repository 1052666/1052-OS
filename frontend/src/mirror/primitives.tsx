import { ReactNode, forwardRef } from 'react'

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
  ({ level = 1, interactive = 'none', pad = 'form', children, className, onClick }, ref) => {
    const cls = [
      'mr-card',
      `mr-card-level-${level}`,
      `mr-card-pad-${pad}`,
      `mr-card-int-${interactive}`,
      className,
    ].filter(Boolean).join(' ')
    return (
      <div ref={ref} className={cls} onClick={onClick} data-mirror-card>
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
