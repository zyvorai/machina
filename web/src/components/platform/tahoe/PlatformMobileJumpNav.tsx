// Copyright 2026 Zyvor AI Labs · https://zyvor.dev
// SPDX-License-Identifier: LicenseRef-Zyvor-Production-1.0

import { useMemo } from 'react'
import { useLocation, useNavigate } from 'react-router'
import { Compass } from 'lucide-react'
import { usePlatformInfo } from '../../../contexts/PlatformInfoContext'
import { usePlatformDesktopTier } from '../../../hooks/usePlatformDesktopTier'
import { integrationNavItems } from '../../../utils/platformIntegrationsNav'
import { contextNavForPath, isContextNavActive, type ContextNavItem } from '../../../utils/platformContextNav'
import { sidebarForTier } from '../../../utils/platformNavFilter'
import type { PlatformNavItem } from '../../../utils/platformNav'

function activeSidebarPath(pathname: string, to: string): boolean {
  if (to === '/platform') return pathname === '/platform'
  return pathname === to || pathname.startsWith(`${to}/`)
}

function resolveJumpValue(
  pathname: string,
  search: string,
  sidebarItems: PlatformNavItem[],
  contextItems: ContextNavItem[],
): string {
  const contextMatch = contextItems.find((item) => isContextNavActive(pathname, search, item))
  if (contextMatch) return contextMatch.to

  const sidebarMatch = sidebarItems
    .filter((item) => activeSidebarPath(pathname, item.to))
    .sort((a, b) => b.to.length - a.to.length)[0]
  return sidebarMatch?.to ?? ''
}

export default function PlatformMobileJumpNav() {
  const navigate = useNavigate()
  const location = useLocation()
  const [tier] = usePlatformDesktopTier()
  const { info } = usePlatformInfo()
  const sections = sidebarForTier(tier, integrationNavItems(info))
  const ctx = contextNavForPath(location.pathname, tier)

  const sidebarItems = useMemo(
    () => sections.flatMap((section) => section.items),
    [sections],
  )

  const sidebarPaths = useMemo(() => new Set(sidebarItems.map((item) => item.to)), [sidebarItems])

  const contextItems = useMemo(() => {
    if (!ctx || ctx.items.length <= 1) return [] as ContextNavItem[]
    return ctx.items.filter((item) => !sidebarPaths.has(item.to))
  }, [ctx, sidebarPaths])

  const current = useMemo(
    () => resolveJumpValue(location.pathname, location.search, sidebarItems, ctx?.items ?? []),
    [location.pathname, location.search, sidebarItems, ctx?.items],
  )

  return (
    <nav
      id="platform-mobile-jump"
      className="tahoe-mobile-jump lg:hidden shrink-0 sticky z-[34] border-b border-white/[0.06] bg-[var(--apple-surface)] backdrop-blur-md"
      aria-label="Platform jump navigation"
    >
      <label htmlFor="platform-mobile-jump-select" className="sr-only">
        Navigate platform
      </label>
      <div className="flex items-center gap-2 px-4 py-2.5">
        <Compass className="h-4 w-4 shrink-0 text-[var(--link)]/80" aria-hidden />
        <select
          id="platform-mobile-jump-select"
          name="platform_jump"
          className="tahoe-mobile-jump-select flex-1 min-w-0"
          value={current}
          onChange={(e) => {
            if (e.target.value) navigate(e.target.value)
          }}
        >
          <option value="" disabled>
            Jump to…
          </option>
          {sections.map((section) => (
            <optgroup key={section.label} label={section.label}>
              {section.items.map((item) => (
                <option key={item.to} value={item.to}>
                  {item.label}
                </option>
              ))}
            </optgroup>
          ))}
          {ctx && contextItems.length > 0 ? (
            <optgroup label={`In ${ctx.appLabel}`}>
              {contextItems.map((item) => (
                <option key={item.to} value={item.to}>
                  {item.label}
                </option>
              ))}
            </optgroup>
          ) : null}
        </select>
      </div>
    </nav>
  )
}
