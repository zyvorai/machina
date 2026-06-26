// Copyright (c) 2026 ZyvorAI Labs Private Limited. All rights reserved.

export type GlassTab = {
  id: string
  label: string
  disabled?: boolean
}

export type GlassTabsProps = {
  tabs: GlassTab[]
  active: string
  onChange: (id: string) => void
  className?: string
}

export function GlassTabs({ tabs, active, onChange, className = '' }: GlassTabsProps) {
  const enabledTabs = tabs.filter((t) => !t.disabled)

  const handleKeyDown = (e: React.KeyboardEvent, currentId: string) => {
    const idx = enabledTabs.findIndex((t) => t.id === currentId)
    if (e.key === 'ArrowRight' || e.key === 'ArrowDown') {
      e.preventDefault()
      const next = enabledTabs[(idx + 1) % enabledTabs.length]
      if (next) onChange(next.id)
    } else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') {
      e.preventDefault()
      const prev = enabledTabs[(idx - 1 + enabledTabs.length) % enabledTabs.length]
      if (prev) onChange(prev.id)
    } else if (e.key === 'Home') {
      e.preventDefault()
      if (enabledTabs[0]) onChange(enabledTabs[0].id)
    } else if (e.key === 'End') {
      e.preventDefault()
      const last = enabledTabs[enabledTabs.length - 1]
      if (last) onChange(last.id)
    }
  }

  return (
    <div
      className={`inline-flex flex-wrap gap-1 p-1 rounded-liquid glass border border-white/[0.06] ${className}`.trim()}
      role="tablist"
    >
      {tabs.map((tab) => (
        <button
          key={tab.id}
          type="button"
          role="tab"
          aria-selected={active === tab.id}
          tabIndex={active === tab.id ? 0 : -1}
          disabled={tab.disabled}
          onClick={() => onChange(tab.id)}
          onKeyDown={(e) => handleKeyDown(e, tab.id)}
          className={`px-4 py-2 text-sm font-medium rounded-[calc(var(--radius-liquid)-4px)] transition-all ${
            active === tab.id
              ? 'tahoe-segment-active text-white'
              : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-white/5'
          } ${tab.disabled ? 'opacity-40 cursor-not-allowed' : ''}`}
        >
          {tab.label}
        </button>
      ))}
    </div>
  )
}
