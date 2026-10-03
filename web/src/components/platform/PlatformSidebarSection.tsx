// Copyright 2026 Zyvor AI Labs · https://zyvor.dev
// SPDX-License-Identifier: LicenseRef-Zyvor-Production-1.0

import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import { ChevronDown } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import PlatformFloatingMenu from './mac/PlatformFloatingMenu'

interface PlatformSidebarSectionProps {
  label: string
  icon: LucideIcon
  collapsed: boolean
  expanded: boolean
  onToggleExpanded: () => void
  hasActiveItem?: boolean
  children: ReactNode
  flyoutItems: ReactNode
}

export default function PlatformSidebarSection({
  label,
  icon: Icon,
  collapsed,
  expanded,
  onToggleExpanded,
  hasActiveItem = false,
  children,
  flyoutItems,
}: PlatformSidebarSectionProps) {
  const isOpen = expanded
  const flyoutTriggerRef = useRef<HTMLButtonElement>(null)
  const [flyoutOpen, setFlyoutOpen] = useState(false)
  const closeTimerRef = useRef<number | null>(null)

  const cancelFlyoutClose = useCallback(() => {
    if (closeTimerRef.current !== null) {
      window.clearTimeout(closeTimerRef.current)
      closeTimerRef.current = null
    }
  }, [])

  const scheduleFlyoutClose = useCallback(() => {
    cancelFlyoutClose()
    closeTimerRef.current = window.setTimeout(() => setFlyoutOpen(false), 120)
  }, [cancelFlyoutClose])

  const openFlyout = useCallback(() => {
    cancelFlyoutClose()
    setFlyoutOpen(true)
  }, [cancelFlyoutClose])

  const closeFlyout = useCallback(() => {
    cancelFlyoutClose()
    setFlyoutOpen(false)
  }, [cancelFlyoutClose])

  useEffect(() => () => cancelFlyoutClose(), [cancelFlyoutClose])

  useEffect(() => {
    if (!collapsed) closeFlyout()
  }, [collapsed, closeFlyout])

  if (collapsed) {
    return (
      <div className="platform-sidebar-section platform-sidebar-section--collapsed">
        <button
          ref={flyoutTriggerRef}
          type="button"
          className={`platform-sidebar-section-trigger mx-auto my-0.5 flex h-9 w-9 items-center justify-center rounded-xl transition ${
            hasActiveItem
              ? 'platform-rail-active text-[var(--text-primary)]'
              : 'text-[var(--text-secondary)] hover:bg-[var(--surface-hover,rgba(255,255,255,0.06))] hover:text-[var(--text-primary)]'
          }`}
          aria-label={label}
          aria-haspopup="menu"
          aria-expanded={flyoutOpen}
          title={label}
          onMouseEnter={openFlyout}
          onFocus={openFlyout}
          onMouseLeave={scheduleFlyoutClose}
          onBlur={(e) => {
            if (!e.currentTarget.contains(e.relatedTarget as Node)) scheduleFlyoutClose()
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault()
              setFlyoutOpen((open) => !open)
            }
          }}
        >
          <Icon className="h-[1.15rem] w-[1.15rem]" strokeWidth={1.5} />
        </button>
        <PlatformFloatingMenu
          open={flyoutOpen}
          onClose={closeFlyout}
          triggerRef={flyoutTriggerRef}
          align="start"
          sideOffset={6}
          ariaLabel={label}
          className="min-w-[12rem] py-1"
          style={{ marginLeft: '0.25rem' }}
        >
          <p className="px-3 py-1.5 text-[10px] font-semibold uppercase tracking-wider text-[var(--text-secondary)]">{label}</p>
          <div
            role="menu"
            onMouseEnter={cancelFlyoutClose}
            onMouseLeave={scheduleFlyoutClose}
          >
            {flyoutItems}
          </div>
        </PlatformFloatingMenu>
      </div>
    )
  }

  return (
    <div className={`platform-sidebar-section ${hasActiveItem ? 'platform-sidebar-section--active' : ''}`}>
      <button
        type="button"
        onClick={onToggleExpanded}
        className="platform-sidebar-section-header flex w-full items-center gap-1.5 px-2 py-1.5 mb-0.5 text-[10px] font-semibold uppercase tracking-wider text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition"
      >
        <ChevronDown className={`h-3 w-3 shrink-0 transition-transform ${isOpen ? '' : '-rotate-90'}`} />
        <Icon className="h-3 w-3 shrink-0 opacity-70" strokeWidth={1.5} />
        <span className="truncate">{label}</span>
      </button>
      {isOpen ? children : null}
    </div>
  )
}
