import { Search } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { commandEntries } from '../../app/navigation'
import { useShellStore } from '../../state/shell'
import { Dialog, Input } from '../ui'
import styles from './shell.module.css'

export function CommandPalette() {
  const open = useShellStore((state) => state.commandOpen)
  const setOpen = useShellStore((state) => state.setCommandOpen)
  const [query, setQuery] = useState('')
  const navigate = useNavigate()
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault()
        setOpen(!open)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, setOpen])

  useEffect(() => {
    if (!open) setQuery('')
    else window.setTimeout(() => inputRef.current?.focus(), 30)
  }, [open])

  const entries = useMemo(() => {
    const normalized = query.trim().toLowerCase()
    if (!normalized) return commandEntries
    return commandEntries.filter((entry) => `${entry.section} ${entry.label}`.toLowerCase().includes(normalized))
  }, [query])

  const go = (path: string) => {
    navigate(path)
    setOpen(false)
  }

  return (
    <Dialog open={open} onOpenChange={setOpen} title="搜索与命令">
      <div className={styles.commandInput}>
        <Search size={17} />
        <Input ref={inputRef} value={query} onChange={(event) => setQuery(event.target.value)} placeholder="查找页面或能力" />
      </div>
      <div className={styles.commandList}>
        {entries.map((entry) => (
          <button key={entry.path} type="button" className={styles.commandItem} onClick={() => go(entry.path)}>
            <entry.icon size={17} />
            <span>{entry.label}</span>
            <small>{entry.section}</small>
          </button>
        ))}
        {entries.length === 0 ? <div className={styles.commandEmpty}>没有匹配的页面</div> : null}
      </div>
    </Dialog>
  )
}
