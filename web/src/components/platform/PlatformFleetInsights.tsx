// Copyright 2026 Zyvor AI Labs · https://zyvor.dev
// SPDX-License-Identifier: LicenseRef-Zyvor-Production-1.0

import { ChevronDown } from 'lucide-react'
import { useState, type ReactNode } from 'react'
import { MacGlassPanel } from './mac/PlatformMacUi'
import { statusPillClasses } from '../../utils/semanticColors'

const EXPANDED_KEY = 'machina-fleet-insights-expanded'

function readExpandedPreference(defaultOpen: boolean): boolean {
  try {
    const raw = sessionStorage.getItem(EXPANDED_KEY)
    if (raw === '1') return true
    if (raw === '0') return false
  } catch {
    /* ignore */
  }
  return defaultOpen
}

function writeExpandedPreference(open: boolean) {
  try {
    sessionStorage.setItem(EXPANDED_KEY, open ? '1' : '0')
  } catch {
    /* ignore */
  }
}

type PlatformFleetInsightsProps = {
  badgeCount: number
  defaultOpen?: boolean
  children: ReactNode
}

export default function PlatformFleetInsights({
  badgeCount,
  defaultOpen = false,
  children,
}: PlatformFleetInsightsProps) {
  const [open, setOpen] = useState(() => readExpandedPreference(defaultOpen))

  const toggle = () => {
    setOpen((v) => {
      const next = !v
      writeExpandedPreference(next)
      return next
    })
  }

  return (
    <MacGlassPanel className="overflow-hidden">
      <button
        type="button"
        className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left hover:bg-white/[0.02] transition"
        onClick={toggle}
        aria-expanded={open}
        data-testid="platform-fleet-insights-toggle"
      >
        <div>
          <p className="text-sm font-semibold text-[var(--text-primary)]">Fleet insights</p>
          <p className="text-xs text-[var(--text-muted)] mt-0.5">
            {badgeCount > 0
              ? `${badgeCount} item${badgeCount === 1 ? '' : 's'} need attention`
              : 'DNA, remediations, and enterprise security'}
          </p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {badgeCount > 0 && (
            <span className={statusPillClasses('warn')}>{badgeCount}</span>
          )}
          <ChevronDown className={`w-4 h-4 text-[var(--text-muted)] transition-transform ${open ? 'rotate-180' : ''}`} />
        </div>
      </button>
      {open && <div className="px-4 pb-4 pt-0 space-y-4 border-t border-white/[0.04]">{children}</div>}
    </MacGlassPanel>
  )
}
