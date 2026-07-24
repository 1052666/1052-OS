import { useEffect, useRef } from 'react'
import { useShellStore } from '../../state/shell'

type Node = { x: number; y: number; phase: number; speed: number; lane: number }

export function SystemField() {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const runtimeStatus = useShellStore((state) => state.runtime.status)
  const theme = useShellStore((state) => state.theme)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const context = canvas.getContext('2d', { alpha: true })
    if (!context) return

    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    const cores = navigator.hardwareConcurrency || 4
    const targetFps = reduced ? 0 : cores >= 8 ? 60 : 30
    const nodes: Node[] = Array.from({ length: 26 }, (_, index) => ({
      x: ((index * 47) % 101) / 100,
      y: ((index * 31 + 9) % 97) / 100,
      phase: index * 0.72,
      speed: 0.00003 + (index % 5) * 0.000008,
      lane: index % 3,
    }))
    let width = 1
    let height = 1
    let frame = 0
    let lastFrame = 0
    let visible = document.visibilityState === 'visible'

    const resize = () => {
      const rect = canvas.getBoundingClientRect()
      const dpr = Math.min(window.devicePixelRatio || 1, 1.5)
      width = Math.max(1, Math.round(rect.width))
      height = Math.max(1, Math.round(rect.height))
      canvas.width = Math.round(width * dpr)
      canvas.height = Math.round(height * dpr)
      context.setTransform(dpr, 0, 0, dpr, 0, 0)
    }

    const draw = (time: number) => {
      context.clearRect(0, 0, width, height)
      const light = theme === 'light'
      const active = runtimeStatus === 'running' || runtimeStatus === 'waiting-approval'
      const grid = light ? 'rgba(18, 75, 78, 0.055)' : 'rgba(104, 229, 225, 0.045)'
      context.strokeStyle = grid
      context.lineWidth = 1
      const spacing = 44
      for (let x = 0; x <= width; x += spacing) {
        context.beginPath()
        context.moveTo(x + 0.5, 0)
        context.lineTo(x + 0.5, height)
        context.stroke()
      }
      for (let y = 0; y <= height; y += spacing) {
        context.beginPath()
        context.moveTo(0, y + 0.5)
        context.lineTo(width, y + 0.5)
        context.stroke()
      }

      const colors = light
        ? ['rgba(8,127,131,.24)', 'rgba(26,129,80,.16)', 'rgba(168,105,9,.12)']
        : ['rgba(99,230,226,.28)', 'rgba(102,217,154,.18)', 'rgba(241,189,98,.14)']
      for (const node of nodes) {
        const wave = reduced ? 0 : Math.sin(time * node.speed + node.phase) * 0.035
        const x = (node.x + wave + 1) % 1 * width
        const y = node.y * height
        context.fillStyle = colors[node.lane]
        const size = active && node.lane === 0 ? 2.2 : 1.35
        context.fillRect(x - size / 2, y - size / 2, size, size)
      }

      if (active) {
        const travel = reduced ? 0.62 : (time * 0.00008) % 1
        const y = height * (0.24 + travel * 0.52)
        const gradient = context.createLinearGradient(0, y, width, y)
        gradient.addColorStop(0, 'transparent')
        gradient.addColorStop(0.5, light ? 'rgba(8,127,131,.15)' : 'rgba(99,230,226,.18)')
        gradient.addColorStop(1, 'transparent')
        context.strokeStyle = gradient
        context.beginPath()
        context.moveTo(0, y)
        context.lineTo(width, y)
        context.stroke()
      }
    }

    const loop = (time: number) => {
      if (visible && (targetFps === 0 || time - lastFrame >= 1000 / targetFps)) {
        draw(time)
        lastFrame = time
      }
      if (targetFps > 0) frame = requestAnimationFrame(loop)
    }
    const onVisibility = () => {
      visible = document.visibilityState === 'visible'
      if (visible && targetFps === 0) draw(performance.now())
    }
    const observer = new ResizeObserver(resize)
    observer.observe(canvas)
    document.addEventListener('visibilitychange', onVisibility)
    resize()
    draw(0)
    if (targetFps > 0) frame = requestAnimationFrame(loop)
    return () => {
      cancelAnimationFrame(frame)
      observer.disconnect()
      document.removeEventListener('visibilitychange', onVisibility)
    }
  }, [runtimeStatus, theme])

  return <canvas ref={canvasRef} aria-hidden="true" data-testid="system-field" />
}
