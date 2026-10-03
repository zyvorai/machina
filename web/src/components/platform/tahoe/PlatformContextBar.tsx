// Copyright 2026 Zyvor AI Labs · https://zyvor.dev
// SPDX-License-Identifier: LicenseRef-Zyvor-Production-1.0

import { useEffect, useMemo, useRef, useState } from 'react'
import { Link, NavLink, useLocation } from 'react-router'
import { Bell, ChevronDown, Server, Sparkles } from 'lucide-react'
import { useFleetDesktop } from '../../../hooks/useFleetDesktop'
import { usePlatformDesktopTier } from '../../../hooks/usePlatformDesktopTier'
import {
  contextNavForPath,
  isContextNavActive,
  shouldShowContextBar,
  splitContextNavItems,
  type ContextNavItem,
} from '../../../utils/platformContextNav'
import { showPlatformMenuBarForTier } from '../../../utils/platformDesktopTier'
import { operationsHubHref } from '../../../utils/platformHubLinks'
import { statusToneClass } from '../../../utils/semanticColors'
import PlatformFloatingMenu from '../mac/PlatformFloatingMenu'
import { PlatformMenuLinkItem } from '../mac/PlatformMenuItem'

function ContextPill({ item, pathname, search }: { item: ContextNavItem; pathname: string; search: string }) {
  const hasQuery = item.to.includes('?')
  const hubExact =
    item.to === '/platform/zeus/security'
    || item.to === '/platform/infrastructure'
    || item.to === '/platform/workloads'
    || item.to === '/platform/administration'
    || item.to === '/platform/operations'
    || item.to === '/platform/settings'
    || item.to === '/platform/zyra'

  if (hasQuery) {
    const active = isContextNavActive(pathname, search, item)
    return (
      <Link
        to={item.to}
        className={`tahoe-context-pill ${active ? 'tahoe-context-pill-active' : ''}`}
        aria-current={active ? 'page' : undefined}
      >
        {item.label}
      </Link>
    )
  }

  return (
    <NavLink
      to={item.to}
      end={hubExact}
      className={({ isActive }) => `tahoe-context-pill ${isActive ? 'tahoe-context-pill-active' : ''}`}
    >
      {item.label}
    </NavLink>
  )
}

export default function PlatformContextBar() {
  const location = useLocation()
  const [tier] = usePlatformDesktopTier()
  const { desktop } = useFleetDesktop(true, 90_000)
  const ctx = contextNavForPath(location.pathname, tier)
  const AppIcon = ctx?.appIcon
  const [moreOpen, setMoreOpen] = useState(false)
  const moreButtonRef = useRef<HTMLButtonElement>(null)

  const { visible, overflow } = useMemo(() => {
    if (!ctx || ctx.items.length <= 1) return { visible: [] as ContextNavItem[], overflow: [] as ContextNavItem[] }
    return splitContextNavItems(ctx.items, location.pathname, location.search)
  }, [ctx, location.pathname, location.search])

  useEffect(() => {
    setMoreOpen(false)
  }, [location.pathname, location.search])

  if (!ctx || !shouldShowContextBar(location.pathname, tier)) return null

  const overflowActive = overflow.some((item) => isContextNavActive(location.pathname, location.search, item))

  return (
    <div className="tahoe-context-bar shrink-0" role="navigation" aria-label="Context navigation">
      <div className="tahoe-context-bar-inner flex items-center gap-3 min-w-0">
        <div className="tahoe-context-app flex items-center gap-2.5 shrink-0 min-w-0">
          {AppIcon ? (
            <span className="tahoe-context-app-icon">
              <AppIcon className="h-4 w-4" strokeWidth={1.75} />
            </span>
          ) : null}
          {ctx.hubPath ? (
            <Link to={ctx.hubPath} className="tahoe-context-app-title truncate">
              {ctx.appLabel}
            </Link>
          ) : (
            <span className="tahoe-context-app-title truncate">{ctx.appLabel}</span>
          )}
        </div>

        {ctx.items.length > 1 ? (
          <nav className="tahoe-context-pills flex-1 min-w-0 flex items-center gap-1.5 overflow-x-auto" aria-label={`${ctx.appLabel} sections`}>
            {visible.map((item) => (
              <ContextPill key={item.to} item={item} pathname={location.pathname} search={location.search} />
            ))}
            {overflow.length > 0 ? (
              <div className="relative shrink-0" onClick={(e) => e.stopPropagation()}>
                <button
                  ref={moreButtonRef}
                  type="button"
                  className={`tahoe-context-pill tahoe-context-more ${overflowActive ? 'tahoe-context-pill-active' : ''}`}
                  aria-expanded={moreOpen}
                  aria-haspopup="menu"
                  onClick={() => setMoreOpen((open) => !open)}
                >
                  More
                  <ChevronDown className={`h-3 w-3 transition-transform ${moreOpen ? 'rotate-180' : ''}`} />
                </button>
                <PlatformFloatingMenu
                  open={moreOpen}
                  onClose={() => setMoreOpen(false)}
                  triggerRef={moreButtonRef}
                  align="start"
                  sideOffset={6}
                  ariaLabel={`${ctx.appLabel} more sections`}
                  className="min-w-[11rem] py-1"
                >
                  {overflow.map((item) => {
                    const active = isContextNavActive(location.pathname, location.search, item)
                    return (
                      <PlatformMenuLinkItem
                        key={item.to}
                        to={item.to}
                        label={item.label}
                        active={active}
                        onNavigate={() => setMoreOpen(false)}
                      />
                    )
                  })}
                </PlatformFloatingMenu>
              </div>
            ) : null}
          </nav>
        ) : (
          <div className="flex-1 min-w-0" />
        )}

        {desktop && showPlatformMenuBarForTier(tier) ? (
          <div className="tahoe-context-status hidden md:flex items-center gap-2 shrink-0 text-[11px] text-[var(--text-muted)]">
            <Link to="/platform/hosts" className="tahoe-context-status-chip" title="Hosts">
              <Server className="w-3 h-3" />
              {desktop.hosts_online}/{desktop.hosts_total}
            </Link>
            <Link to={operationsHubHref(tier)} className="tahoe-context-status-chip" title="Operations">
              {desktop.active_tasks} tasks
            </Link>
            <Link to="/platform/zyra" className="tahoe-context-status-chip text-orange-700/80" title="Zyra">
              <Sparkles className="w-3 h-3 text-orange-400" />
              {desktop.zyra_status}
            </Link>
            {desktop.unread_notifications > 0 ? (
              <Link to={operationsHubHref(tier)} className={`tahoe-context-status-chip ${statusToneClass('warn')} opacity-90`} title="Alerts">
                <Bell className="w-3 h-3" />
                {desktop.unread_notifications}
              </Link>
            ) : null}
          </div>
        ) : null}
      </div>
    </div>
  )
}
