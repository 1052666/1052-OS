import { useEffect, useState } from 'react'
import { useTheme } from '../theme-context'
import { IconClose } from './Icons'

type Props = {
  open: boolean
  onClose: () => void
  /**
   * Optional override for the final-step CTA. Defaults to applying the GPT
   * base profile via the surrounding ThemeProvider. Inject a custom handler
   * for tests, or to retarget this onboarding flow at a different theme
   * without touching the modal's step content.
   *
   * Note: `useTheme()` is still called unconditionally below (React hooks
   * rule). The override only redirects the action, not the dependency graph.
   */
  onApplyGpt?: () => Promise<void>
}

const STEP_COUNT = 3

/**
 * First-run onboarding modal.
 *
 * 3 lightweight steps:
 *   1. Welcome — one-line intro to the new theme system
 *   2. Theme switcher orientation — points users at Settings → Appearance
 *   3. GPT Style apply CTA — explicit two-button choice; the user must
 *      actively pick "Use GPT Style" to opt in. "Keep current look" /
 *      closing the modal both keep the visual state untouched.
 *
 * Either CTA marks the modal completed via the parent's onClose, so the
 * user is never re-prompted (managed by useOnboarding). The Settings page
 * exposes a "重新开始引导" button to restart this flow.
 */
export default function OnboardingModal({ open, onClose, onApplyGpt }: Props) {
  const { setBaseProfile } = useTheme()
  const handleApply = onApplyGpt ?? (() => setBaseProfile('gpt'))
  const [step, setStep] = useState(0)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (open) {
      setStep(0)
      setBusy(false)
      setError(null)
    }
  }, [open])

  useEffect(() => {
    if (!open) return
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])

  if (!open) return null

  const isFirst = step === 0
  const isLast = step === STEP_COUNT - 1

  const goNext = () => setStep((s) => Math.min(s + 1, STEP_COUNT - 1))
  const goBack = () => setStep((s) => Math.max(s - 1, 0))

  const applyGpt = async () => {
    setBusy(true)
    setError(null)
    try {
      await handleApply()
      onClose()
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      setError(message || '应用主题失败，请稍后重试')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(event) => event.stopPropagation()}>
        <div className="modal-head">
          <div className="modal-title">欢迎使用 1052 OS · 外观新功能</div>
          <button className="icon-btn ghost" onClick={onClose} aria-label="关闭引导">
            <IconClose size={16} />
          </button>
        </div>

        <div className="modal-body">
          <div className="onboarding-progress" aria-label={`第 ${step + 1} 步，共 ${STEP_COUNT} 步`}>
            {Array.from({ length: STEP_COUNT }).map((_, index) => (
              <span
                key={index}
                className={'onboarding-dot' + (index === step ? ' active' : '')}
                aria-hidden="true"
              />
            ))}
          </div>

          {step === 0 ? (
            <div className="onboarding-step">
              <h3>主题系统升级了</h3>
              <p>
                1052 OS 现在支持<strong>三种主题风格</strong>，每一种都有深色与浅色变体：
              </p>
              <ul className="onboarding-bullets">
                <li><strong>经典</strong> · 沿用现有外观</li>
                <li><strong>GPT 风格</strong> · 现代深色 / 浅色，青绿强调</li>
                <li><strong>水面</strong> · 灰度镜面 + 交互特效（开发中）</li>
              </ul>
              <p className="muted">
                你的当前外观不会被自动改变，下面给你看怎么切换。
              </p>
            </div>
          ) : null}

          {step === 1 ? (
            <div className="onboarding-step">
              <h3>主题切换在哪里</h3>
              <p>
                打开 <strong>设置 → 外观</strong>，你会看到两组段控件：
              </p>
              <ul className="onboarding-bullets">
                <li>第一组「主题风格」选 经典 / GPT 风格 / 水面</li>
                <li>第二组「主题模式」选 浅色 / 深色 / 跟随系统</li>
              </ul>
              <p className="muted">
                两组互相独立，可以随时切换；切到「经典」会清除自定义主题，回到默认外观。
              </p>
            </div>
          ) : null}

          {step === 2 ? (
            <div className="onboarding-step">
              <h3>要不要现在试试 GPT 风格？</h3>
              <p>
                深黑背景 + 青绿强调，参考 ChatGPT 网页设计。点「使用 GPT 风格」立即应用，
                后续随时可在设置页切回经典。
              </p>
              {error ? <div className="banner error" role="alert">{error}</div> : null}
            </div>
          ) : null}
        </div>

        <div className="modal-foot onboarding-foot">
          {isFirst ? (
            <button className="chip ghost" onClick={onClose} disabled={busy}>
              先跳过
            </button>
          ) : (
            <button className="chip ghost" onClick={goBack} disabled={busy}>
              上一步
            </button>
          )}

          {isLast ? (
            <div className="onboarding-cta-group">
              <button className="chip ghost" onClick={onClose} disabled={busy}>
                保持当前外观
              </button>
              <button className="chip primary" onClick={applyGpt} disabled={busy}>
                {busy ? '应用中…' : '使用 GPT 风格'}
              </button>
            </div>
          ) : (
            <button className="chip primary" onClick={goNext} disabled={busy}>
              下一步
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
