import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import {
  initialRuntimeState,
  runtimeReducer,
  type RuntimeAction,
  type RuntimeState,
  type RuntimeTrace,
} from '../runtime/runtime'

type Theme = 'dark' | 'light'

type Profile = {
  name: string
  avatar: string
}

type ShellState = {
  theme: Theme
  profile: Profile
  sectionCollapsed: boolean
  inspectorOpen: boolean
  commandOpen: boolean
  selectedTrace?: RuntimeTrace
  runtime: RuntimeState
  setTheme: (theme: Theme) => void
  toggleTheme: () => void
  setSectionCollapsed: (collapsed: boolean) => void
  setInspectorOpen: (open: boolean) => void
  setCommandOpen: (open: boolean) => void
  inspectTrace: (trace?: RuntimeTrace) => void
  dispatchRuntime: (action: RuntimeAction) => void
}

function readLegacyProfile(): Profile {
  try {
    const raw = localStorage.getItem('agent.profile')
    if (!raw) return { name: '本地用户', avatar: '' }
    const value = JSON.parse(raw) as { name?: unknown; avatar?: unknown }
    return {
      name: typeof value.name === 'string' && value.name.trim() ? value.name.trim() : '本地用户',
      avatar: typeof value.avatar === 'string' ? value.avatar : '',
    }
  } catch {
    return { name: '本地用户', avatar: '' }
  }
}

export const useShellStore = create<ShellState>()(
  persist(
    (set) => ({
      theme: 'dark',
      profile: readLegacyProfile(),
      sectionCollapsed: false,
      inspectorOpen: false,
      commandOpen: false,
      runtime: initialRuntimeState,
      setTheme: (theme) => set({ theme }),
      toggleTheme: () => set((state) => ({ theme: state.theme === 'dark' ? 'light' : 'dark' })),
      setSectionCollapsed: (sectionCollapsed) => set({ sectionCollapsed }),
      setInspectorOpen: (inspectorOpen) => set({ inspectorOpen }),
      setCommandOpen: (commandOpen) => set({ commandOpen }),
      inspectTrace: (selectedTrace) => set({ selectedTrace, inspectorOpen: true }),
      dispatchRuntime: (action) => set((state) => ({ runtime: runtimeReducer(state.runtime, action) })),
    }),
    {
      name: '1052.v2.shell',
      partialize: (state) => ({
        theme: state.theme,
        profile: state.profile,
        sectionCollapsed: state.sectionCollapsed,
      }),
    },
  ),
)
