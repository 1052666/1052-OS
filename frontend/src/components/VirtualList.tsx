import { useEffect, useMemo, useRef, useState, type Key, type ReactNode, type UIEvent } from 'react'

type Props<T> = {
  items: T[]
  className?: string
  itemHeight: number
  gap?: number
  overscan?: number
  getKey: (item: T, index: number) => Key
  renderItem: (item: T, index: number) => ReactNode
}

export default function VirtualList<T>({
  items,
  className,
  itemHeight,
  gap = 0,
  overscan = 4,
  getKey,
  renderItem,
}: Props<T>) {
  const containerRef = useRef<HTMLDivElement | null>(null)
  const [viewportHeight, setViewportHeight] = useState(0)
  const [scrollTop, setScrollTop] = useState(0)

  useEffect(() => {
    const node = containerRef.current
    if (!node) return undefined

    const updateSize = () => setViewportHeight(node.clientHeight)
    updateSize()

    if (typeof ResizeObserver === 'undefined') return undefined

    const observer = new ResizeObserver(() => updateSize())
    observer.observe(node)
    return () => observer.disconnect()
  }, [])

  const stride = itemHeight + gap
  const safeViewportHeight = viewportHeight || stride * 6
  const totalHeight = items.length > 0 ? items.length * stride - gap : 0

  const range = useMemo(() => {
    if (items.length === 0) return { start: 0, end: -1 }
    const start = Math.max(0, Math.floor(scrollTop / stride) - overscan)
    const end = Math.min(items.length - 1, Math.ceil((scrollTop + safeViewportHeight) / stride) + overscan)
    return { start, end }
  }, [items.length, overscan, safeViewportHeight, scrollTop, stride])

  const visibleItems = useMemo(
    () => (range.end >= range.start ? items.slice(range.start, range.end + 1) : []),
    [items, range.end, range.start],
  )

  const handleScroll = (event: UIEvent<HTMLDivElement>) => {
    setScrollTop(event.currentTarget.scrollTop)
  }

  return (
    <div ref={containerRef} className={className} onScroll={handleScroll}>
      <div className="virtual-list-inner" style={{ height: totalHeight }}>
        {visibleItems.map((item, offset) => {
          const index = range.start + offset
          return (
            <div
              key={getKey(item, index)}
              className="virtual-list-row"
              style={{ top: index * stride, height: itemHeight }}
            >
              {renderItem(item, index)}
            </div>
          )
        })}
      </div>
    </div>
  )
}
