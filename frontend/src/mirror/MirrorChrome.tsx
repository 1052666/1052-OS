import { useEffect, useRef, lazy, Suspense, type ReactNode } from 'react'
import { Routes, Route, Navigate } from 'react-router-dom'
import { MirrorSidebar } from './MirrorSidebar'
import { MirrorPageWrapper } from './MirrorPageWrapper'
import { MirrorPageHeader } from './MirrorPageHeader'
import { attachCursorTracking } from './cursorTracking'
import { CouplingController, CouplingContext } from './cardCoupling'
// liquidPour.ts + LiquidPourOverlay.tsx kept on disk for Phase 2 reference.

// Lazy mirror pages — PR2/PR3 fill the stubs.
const MirrorChat = lazy(() =>
  import('./MirrorChat').then((m) => ({ default: m.MirrorChat })),
)
// MirrorSettings showcase file retained for Phase 2 reference (LLM + Token
// panels in mirror-styled rendering) — currently /settings falls back to
// classic Settings wrapped in MirrorPageWrapper so all sections are
// preserved. The showcase will be re-routed when all sections are mirror-
// native.

// Lazy classic pages — wrapped in MirrorPageWrapper so the mirror page
// chrome (title + scroll region) renders before the classic body. PR2/
// PR3 replace these one at a time with native mirror equivalents.
const Calendar = lazy(() => import('../pages/Calendar'))
const Notifications = lazy(() => import('../pages/Notifications'))
const Repository = lazy(() => import('../pages/Repository'))
const Notes = lazy(() => import('../pages/Notes'))
const Wiki = lazy(() => import('../pages/Wiki'))
const Pkm = lazy(() => import('../pages/Pkm'))
const OutputProfiles = lazy(() => import('../pages/OutputProfiles'))
const Resources = lazy(() => import('../pages/Resources'))
const Memory = lazy(() => import('../pages/Memory'))
const SocialChannels = lazy(() => import('../pages/SocialChannels'))
const Toolbox = lazy(() => import('../pages/Toolbox'))
const SqlWorkbench = lazy(() => import('../pages/SqlWorkbench'))
const SqlDataSources = lazy(() => import('../pages/SqlDataSources'))
const SqlFiles = lazy(() => import('../pages/SqlFiles'))
const SqlVariables = lazy(() => import('../pages/SqlVariables'))
const SqlOrchestration = lazy(() => import('../pages/SqlOrchestration'))
const SqlLoads = lazy(() => import('../pages/SqlLoads'))
const SqlServers = lazy(() => import('../pages/SqlServers'))
const SqlShellFiles = lazy(() => import('../pages/SqlShellFiles'))
const SearchSources = lazy(() => import('../pages/SearchSources'))
const Skills = lazy(() => import('../pages/Skills'))
const Settings = lazy(() => import('../pages/Settings'))

function Wrap(title: string, child: ReactNode) {
  return (
    <MirrorPageWrapper header={<MirrorPageHeader title={title} />}>
      {child}
    </MirrorPageWrapper>
  )
}

export function MirrorChrome() {
  // Lazy-init once so the controller identity stays stable across renders.
  const couplingRef = useRef<CouplingController | null>(null)
  if (couplingRef.current == null) couplingRef.current = new CouplingController()

  useEffect(() => attachCursorTracking(), [])

  // IU-16 → material self-reveal: ramp --mr-reveal from 0 → 1 over 1.2s
  // on first mount per session. Mirror's own material properties (specular
  // peak alpha, silk noise opacity) are multiplied by this var, so the UI
  // starts as a flat dark dashboard and "crystallizes" into reflective
  // material. Hover boost + coupling are NOT multiplied — they're interaction
  // effects, separate concern. sessionStorage key reused from pour gate.
  useEffect(() => {
    const root = document.documentElement
    const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false

    const seen = (() => {
      try { return sessionStorage.getItem('mirror_pour_seen') === '1' } catch { return false }
    })()

    if (reduced || seen) {
      root.style.setProperty('--mr-reveal', '1')
      return
    }

    root.style.setProperty('--mr-reveal', '0')
    const start = performance.now()
    const duration = 1200
    let rafId: number | null = null

    function easeOutCubic(t: number): number {
      return 1 - Math.pow(1 - t, 3)
    }

    function tick(now: number) {
      const t = Math.min(1, (now - start) / duration)
      const eased = easeOutCubic(t)
      root.style.setProperty('--mr-reveal', eased.toFixed(3))
      if (t < 1) {
        rafId = requestAnimationFrame(tick)
      } else {
        try { sessionStorage.setItem('mirror_pour_seen', '1') } catch {}
        rafId = null
      }
    }

    rafId = requestAnimationFrame(tick)
    return () => {
      if (rafId != null) cancelAnimationFrame(rafId)
      // Leave --mr-reveal at its final value on unmount.
    }
  }, [])

  // Cross-card coupling rAF loop: hover-source detection + scroll refresh
  // + 3s idle fadeout. Throttled via a single rAF in flight.
  useEffect(() => {
    const controller = couplingRef.current!
    let rafId: number | null = null
    let idleTimer: number | null = null

    const schedule = () => {
      if (rafId != null) return
      rafId = requestAnimationFrame(() => {
        controller.tick()
        rafId = null
      })
    }

    const onMove = (e: MouseEvent) => {
      const t = e.target as HTMLElement | null
      const card =
        (t && typeof t.closest === 'function'
          ? (t.closest('[data-mirror-card]') as HTMLElement | null)
          : null)
      if (card) {
        const r = card.getBoundingClientRect()
        controller.setSource({
          cx: r.left + r.width / 2,
          cy: r.top + r.height / 2,
        })
      } else {
        controller.setSource(null)
      }
      schedule()
      if (idleTimer != null) window.clearTimeout(idleTimer)
      idleTimer = window.setTimeout(() => {
        controller.setSource(null)
        schedule()
      }, 3000)
    }

    const onScroll = () => {
      controller.refreshAll()
      schedule()
    }

    window.addEventListener('mousemove', onMove, { passive: true })
    document.addEventListener('scroll', onScroll, { capture: true, passive: true })
    return () => {
      window.removeEventListener('mousemove', onMove)
      document.removeEventListener('scroll', onScroll, { capture: true })
      if (rafId != null) cancelAnimationFrame(rafId)
      if (idleTimer != null) window.clearTimeout(idleTimer)
    }
  }, [])

  return (
    <CouplingContext.Provider value={couplingRef.current}>
    <div className="mr-shell">
      <MirrorSidebar />
      <Suspense fallback={<div className="mr-page-loading" />}>
        <Routes>
          <Route path="/" element={<Navigate to="/chat" replace />} />
          <Route path="/chat" element={<MirrorChat />} />
          <Route path="/settings" element={Wrap('设置', <Settings />)} />

          <Route path="/calendar" element={Wrap('日历', <Calendar />)} />
          <Route
            path="/notifications"
            element={Wrap('通知中心', <Notifications />)}
          />
          <Route path="/repository" element={Wrap('仓库', <Repository />)} />
          <Route path="/repository/:id" element={Wrap('仓库', <Repository />)} />
          <Route path="/notes" element={Wrap('笔记', <Notes />)} />
          <Route path="/wiki" element={Wrap('Wiki', <Wiki />)} />
          <Route path="/pkm" element={Wrap('PKM', <Pkm />)} />
          <Route
            path="/output-profiles"
            element={Wrap('输出配方', <OutputProfiles />)}
          />
          <Route path="/resources" element={Wrap('资源列表', <Resources />)} />
          <Route path="/memory" element={Wrap('记忆中心', <Memory />)} />
          <Route
            path="/social-channels"
            element={Wrap('社交通道', <SocialChannels />)}
          />
          <Route
            path="/social-channels/:channel"
            element={Wrap('社交通道', <SocialChannels />)}
          />
          <Route path="/toolbox" element={Wrap('工具箱', <Toolbox />)} />
          <Route
            path="/toolbox/:provider"
            element={Wrap('工具箱', <Toolbox />)}
          />
          <Route path="/sql" element={Wrap('SQL 工作台', <SqlWorkbench />)} />
          <Route
            path="/sql/datasources"
            element={Wrap('SQL 工作台', <SqlDataSources />)}
          />
          <Route
            path="/sql/files"
            element={Wrap('SQL 工作台', <SqlFiles />)}
          />
          <Route
            path="/sql/variables"
            element={Wrap('SQL 工作台', <SqlVariables />)}
          />
          <Route
            path="/sql/orchestration"
            element={Wrap('SQL 工作台', <SqlOrchestration />)}
          />
          <Route
            path="/sql/loads"
            element={Wrap('SQL 工作台', <SqlLoads />)}
          />
          <Route
            path="/sql/servers"
            element={Wrap('SQL 工作台', <SqlServers />)}
          />
          <Route
            path="/sql/shell-files"
            element={Wrap('SQL 工作台', <SqlShellFiles />)}
          />
          <Route
            path="/search-sources"
            element={Wrap('搜索源', <SearchSources />)}
          />
          <Route path="/skills" element={Wrap('Skill 中心', <Skills />)} />
        </Routes>
      </Suspense>
    </div>
    </CouplingContext.Provider>
  )
}
