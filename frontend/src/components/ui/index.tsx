import * as DialogPrimitive from '@radix-ui/react-dialog'
import * as SwitchPrimitive from '@radix-ui/react-switch'
import * as TooltipPrimitive from '@radix-ui/react-tooltip'
import { X } from 'lucide-react'
import {
  forwardRef,
  type ButtonHTMLAttributes,
  type InputHTMLAttributes,
  type ReactNode,
  type SelectHTMLAttributes,
  type TextareaHTMLAttributes,
} from 'react'
import styles from './ui.module.css'

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: 'default' | 'primary' | 'danger' | 'ghost'
  size?: 'default' | 'small'
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = 'default', size = 'default', className = '', ...props },
  ref,
) {
  return (
    <button
      ref={ref}
      className={`${styles.button} ${styles[variant]} ${size === 'small' ? styles.small : ''} ${className}`}
      type={props.type ?? 'button'}
      {...props}
    />
  )
})

export const IconButton = forwardRef<HTMLButtonElement, ButtonProps>(function IconButton(
  { variant = 'ghost', className = '', ...props },
  ref,
) {
  return <button ref={ref} className={`${styles.iconButton} ${styles[variant]} ${className}`} type="button" {...props} />
})

export function Tooltip({ label, children }: { label: string; children: ReactNode }) {
  return (
    <TooltipPrimitive.Provider delayDuration={350}>
      <TooltipPrimitive.Root>
        <TooltipPrimitive.Trigger asChild>{children}</TooltipPrimitive.Trigger>
        <TooltipPrimitive.Portal>
          <TooltipPrimitive.Content sideOffset={7} className={styles.badge}>
            {label}
          </TooltipPrimitive.Content>
        </TooltipPrimitive.Portal>
      </TooltipPrimitive.Root>
    </TooltipPrimitive.Provider>
  )
}

export function Badge({ tone = 'default', children }: { tone?: 'default' | 'success' | 'warning' | 'danger'; children: ReactNode }) {
  const toneClass = tone === 'success' ? styles.badgeSuccess : tone === 'warning' ? styles.badgeWarning : tone === 'danger' ? styles.badgeDanger : ''
  return <span className={`${styles.badge} ${toneClass}`}>{children}</span>
}

export function Field({ label, children }: { label: string; children: ReactNode }) {
  return <label className={styles.field}><span>{label}</span>{children}</label>
}

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(function Input(props, ref) {
  return <input ref={ref} className={`${styles.input} ${props.className ?? ''}`} {...props} />
})

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaHTMLAttributes<HTMLTextAreaElement>>(function Textarea(props, ref) {
  return <textarea ref={ref} className={`${styles.textarea} ${props.className ?? ''}`} {...props} />
})

export const Select = forwardRef<HTMLSelectElement, SelectHTMLAttributes<HTMLSelectElement>>(function Select(props, ref) {
  return <select ref={ref} className={`${styles.select} ${props.className ?? ''}`} {...props} />
})

export function Switch({ checked, onCheckedChange, label }: { checked: boolean; onCheckedChange: (checked: boolean) => void; label: string }) {
  return (
    <SwitchPrimitive.Root className={styles.switchRoot} checked={checked} onCheckedChange={onCheckedChange} aria-label={label}>
      <SwitchPrimitive.Thumb className={styles.switchThumb} />
    </SwitchPrimitive.Root>
  )
}

export function Surface({ title, action, children, className = '' }: { title?: string; action?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={`${styles.surface} ${className}`}>
      {title || action ? <header className={styles.surfaceHeader}><h2 className={styles.surfaceTitle}>{title}</h2>{action}</header> : null}
      <div className={styles.surfaceBody}>{children}</div>
    </section>
  )
}

export function AsyncState({ loading, error, empty, children }: { loading?: boolean; error?: unknown; empty?: boolean; children: ReactNode }) {
  if (loading) return <div className={styles.loading}><span className="sr-only">正在加载</span></div>
  if (error) return <div className={styles.error}>{error instanceof Error ? error.message : '加载失败'}</div>
  if (empty) return <div className={styles.empty}>这里还没有内容</div>
  return <>{children}</>
}

export function Dialog({ open, onOpenChange, title, children, footer }: { open: boolean; onOpenChange: (open: boolean) => void; title: string; children: ReactNode; footer?: ReactNode }) {
  return (
    <DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className={styles.dialogOverlay} />
        <DialogPrimitive.Content className={styles.dialogContent}>
          <header className={styles.dialogHeader}>
            <DialogPrimitive.Title>{title}</DialogPrimitive.Title>
            <DialogPrimitive.Close asChild><IconButton aria-label="关闭"><X size={17} /></IconButton></DialogPrimitive.Close>
          </header>
          <div className={styles.dialogBody}>{children}</div>
          {footer ? <footer className={styles.dialogFooter}>{footer}</footer> : null}
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  )
}

export { styles as uiStyles }
