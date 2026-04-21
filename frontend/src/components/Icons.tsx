type Props = { size?: number; className?: string }

const base = (p: Props) => ({
  width: p.size ?? 18,
  height: p.size ?? 18,
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.8,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
  className: p.className,
})

export const IconChat = (p: Props) => (
  <svg {...base(p)}>
    <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
  </svg>
)

export const IconCalendar = (p: Props) => (
  <svg {...base(p)}>
    <rect x="3" y="4" width="18" height="18" rx="2" />
    <path d="M16 2v4M8 2v4M3 10h18" />
  </svg>
)

export const IconRepo = (p: Props) => (
  <svg {...base(p)}>
    <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" />
    <path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z" />
  </svg>
)

export const IconNotes = (p: Props) => (
  <svg {...base(p)}>
    <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
    <path d="M14 2v6h6M8 13h8M8 17h6" />
  </svg>
)

export const IconResources = (p: Props) => (
  <svg {...base(p)}>
    <path d="M4 5a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2z" />
    <path d="M8 8h8M8 12h8M8 16h5" />
    <path d="M6 3v18" />
  </svg>
)

export const IconSettings = (p: Props) => (
  <svg {...base(p)}>
    <line x1="4" y1="6" x2="20" y2="6" />
    <line x1="4" y1="12" x2="20" y2="12" />
    <line x1="4" y1="18" x2="20" y2="18" />
    <circle cx="9" cy="6" r="2" fill="var(--bg-grad-1)" />
    <circle cx="15" cy="12" r="2" fill="var(--bg-grad-1)" />
    <circle cx="7" cy="18" r="2" fill="var(--bg-grad-1)" />
  </svg>
)

export const IconEdit = (p: Props) => (
  <svg {...base(p)}>
    <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
    <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
  </svg>
)

export const IconClose = (p: Props) => (
  <svg {...base(p)}>
    <path d="M18 6 6 18M6 6l12 12" />
  </svg>
)

export const IconSend = (p: Props) => (
  <svg {...base(p)}>
    <path d="M22 2 11 13M22 2l-7 20-4-9-9-4z" />
  </svg>
)

export const IconPlus = (p: Props) => (
  <svg {...base(p)}>
    <path d="M12 5v14M5 12h14" />
  </svg>
)

export const IconTrash = (p: Props) => (
  <svg {...base(p)}>
    <path d="M3 6h18M8 6V4h8v2M6 6l1 16h10l1-16" />
    <path d="M10 11v6M14 11v6" />
  </svg>
)

export const IconFolder = (p: Props) => (
  <svg {...base(p)}>
    <path d="M3 6a2 2 0 0 1 2-2h5l2 2h7a2 2 0 0 1 2 2v9a3 3 0 0 1-3 3H6a3 3 0 0 1-3-3z" />
  </svg>
)

export const IconRefresh = (p: Props) => (
  <svg {...base(p)}>
    <path d="M21 12a9 9 0 0 1-15.5 6.2L3 16" />
    <path d="M3 21v-5h5" />
    <path d="M3 12A9 9 0 0 1 18.5 5.8L21 8" />
    <path d="M21 3v5h-5" />
  </svg>
)

export const IconSearch = (p: Props) => (
  <svg {...base(p)}>
    <circle cx="11" cy="11" r="8" />
    <path d="m21 21-4.3-4.3" />
  </svg>
)

export const IconSparkle = (p: Props) => (
  <svg {...base(p)}>
    <path d="M12 3v3M12 18v3M3 12h3M18 12h3M5.6 5.6l2.1 2.1M16.3 16.3l2.1 2.1M5.6 18.4l2.1-2.1M16.3 7.7l2.1-2.1" />
  </svg>
)

export const IconChevron = (p: Props) => (
  <svg {...base(p)}>
    <path d="m9 18 6-6-6-6" />
  </svg>
)

export const IconStar = (p: Props) => (
  <svg {...base(p)}>
    <path d="m12 2 3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z" />
  </svg>
)

export const IconBranch = (p: Props) => (
  <svg {...base(p)}>
    <line x1="6" y1="3" x2="6" y2="15" />
    <circle cx="18" cy="6" r="3" />
    <circle cx="6" cy="18" r="3" />
    <path d="M18 9a9 9 0 0 1-9 9" />
  </svg>
)

export const IconSearchGrid = (p: Props) => (
  <svg {...base(p)}>
    <circle cx="11" cy="11" r="6" />
    <path d="m20 20-3.5-3.5" />
    <path d="M11 2v3M11 17v3M2 11h3M17 11h3" />
  </svg>
)

export const IconBell = (p: Props) => (
  <svg {...base(p)}>
    <path d="M6 8a6 6 0 1 1 12 0c0 7 3 8 3 8H3s3-1 3-8" />
    <path d="M10 20a2 2 0 0 0 4 0" />
  </svg>
)

export const IconSkills = (p: Props) => (
  <svg {...base(p)}>
    <path d="M12 3 4 7l8 4 8-4-8-4Z" />
    <path d="m4 12 8 4 8-4" />
    <path d="m4 17 8 4 8-4" />
  </svg>
)

export const IconMemory = (p: Props) => (
  <svg {...base(p)}>
    <path d="M8 7a3 3 0 1 1 0 6H7a3 3 0 0 0-3 3v1" />
    <path d="M16 7a3 3 0 1 0 0 6h1a3 3 0 0 1 3 3v1" />
    <path d="M12 6v12" />
    <path d="M9 6h6" />
    <path d="M9 18h6" />
  </svg>
)

export const IconSocial = (p: Props) => (
  <svg {...base(p)}>
    <circle cx="7" cy="8" r="3" />
    <circle cx="17" cy="8" r="3" />
    <circle cx="12" cy="17" r="3" />
    <path d="M9.5 10.2 11 14M14.5 10.2 13 14M9.7 17h4.6" />
  </svg>
)

export const IconDatabase = (p: Props) => (
  <svg {...base(p)}>
    <ellipse cx="12" cy="5" rx="9" ry="3" />
    <path d="M21 12c0 1.66-4 3-9 3s-9-1.34-9-3" />
    <path d="M3 5v14c0 1.66 4 3 9 3s9-1.34 9-3V5" />
  </svg>
)

export const IconSqlFile = (p: Props) => (
  <svg {...base(p)}>
    <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8Z" />
    <path d="M14 2v6h6" />
    <path d="M8 13h2" />
    <path d="M14 13h2" />
    <path d="M8 17h2" />
    <path d="M14 17h2" />
  </svg>
)

export const IconVariable = (p: Props) => (
  <svg {...base(p)}>
    <path d="M4 7V4h16v3" />
    <path d="M9 20h6" />
    <path d="M12 4v16" />
  </svg>
)

export const IconLoad = (p: Props) => (
  <svg {...base(p)}>
    <path d="M12 3v12" />
    <path d="m8 11 4 4 4-4" />
    <path d="M20 21H4" />
    <path d="M4 17v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2" />
  </svg>
)

export const IconOrchestration = (p: Props) => (
  <svg {...base(p)}>
    <rect x="3" y="3" width="6" height="6" rx="1" />
    <rect x="15" y="3" width="6" height="6" rx="1" />
    <rect x="9" y="15" width="6" height="6" rx="1" />
    <path d="M9 6h6" />
    <path d="M18 9v3l-6 3" />
  </svg>
)

export const IconStop = (p: Props) => (
  <svg {...base(p)}>
    <rect x="6" y="6" width="12" height="12" rx="1.5" fill="currentColor" stroke="none" />
  </svg>
)
