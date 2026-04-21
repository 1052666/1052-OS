import { useEffect, useRef } from 'react'

export type MenuItem = { label: string; action: string; danger?: boolean }

export function ContextMenu({
  x, y, items, onSelect, onClose,
}: {
  x: number; y: number; items: MenuItem[]
  onSelect: (action: string) => void; onClose: () => void
}) {
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose()
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [onClose])

  return (
    <div ref={ref} className="orch-context-menu" style={{ top: y, left: x }}>
      {items.map((item) => (
        <button key={item.action} className={`orch-context-item ${item.danger ? 'danger' : ''}`}
          onClick={() => { onSelect(item.action); onClose() }}>
          {item.label}
        </button>
      ))}
    </div>
  )
}
