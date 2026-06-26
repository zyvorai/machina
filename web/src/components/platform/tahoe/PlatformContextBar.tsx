// Copyright (c) 2026 ZyvorAI Labs Private Limited. All rights reserved.

import { useEffect, useMemo, useState } from 'react'
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

function ContextPill({ item, pathname, search }: { item: ContextNavItem; pathname: string; search: string }) {
  const hasQuery = item.to.includes('?')
  const hubExact =
    item.to === '/platform/zeus/security'
    || item.to === '/platform/infrastructure'
    || item.to === '/platform/workloads'
    || item.to === '/platform/administration'
    || item.to === '/platform/operations'
    || item.to === '/platform/integrations'
    || item.to === '/platform/zeus'

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
  const { desktop } = useFleetDesktop()
  const ctx = contextNavForPath(location.pathname, tier)
  const AppIcon = ctx?.appIcon
  const [moreOpen, setMoreOpen] = useState(false)

  const { visible, overflow } = useMemo(() => {
    if (!ctx || ctx.items.length <= 1) return { visible: [] as ContextNavItem[], overflow: [] as ContextNavItem[] }
    return splitContextNavItems(ctx.items, location.pathname, location.search)
  }, [ctx, location.pathname, location.search])

  useEffect(() => {
    if (!moreOpen) return
    const close = () => setMoreOpen(false)
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close()
    }
    window.addEventListener('click', close)
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('click', close)
      window.removeEventListener('keydown', onKey)
    }
  }, [moreOpen])

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
                  type="button"
                  className={`tahoe-context-pill tahoe-context-more ${overflowActive ? 'tahoe-context-pill-active' : ''}`}
                  aria-expanded={moreOpen}
                  onClick={() => setMoreOpen((open) => !open)}
                >
                  More
                  <ChevronDown className={`h-3 w-3 transition-transform ${moreOpen ? 'rotate-180' : ''}`} />
                </button>
                {moreOpen ? (
                  <div className="tahoe-context-overflow-menu">
                    {overflow.map((item) => {
                      const active = isContextNavActive(location.pathname, location.search, item)
                      return (
                        <Link
                          key={item.to}
                          to={item.to}
                          className={`tahoe-context-overflow-item ${active ? 'tahoe-context-overflow-item-active' : ''}`}
                          onClick={() => setMoreOpen(false)}
                        >
                          {item.label}
                        </Link>
                      )
                    })}
                  </div>
                ) : null}
              </div>
            ) : null}
          </nav>
        ) : (
          <div className="flex-1 min-w-0" />
        )}

        {desktop && showPlatformMenuBarForTier(tier) ? (
          <div className="tahoe-context-status hidden md:flex items-center gap-2 shrink-0 text-[11px] text-white/55">
            <Link to="/platform/hosts" className="tahoe-context-status-chip" title="Hosts">
              <Server className="w-3 h-3" />
              {desktop.hosts_online}/{desktop.hosts_total}
            </Link>
            <Link to={operationsHubHref(tier)} className="tahoe-context-status-chip" title="Operations">
              {desktop.active_tasks} tasks
            </Link>
            <Link to="/platform/zeus" className="tahoe-context-status-chip text-orange-200/80" title="Zeus">
              <Sparkles className="w-3 h-3 text-orange-400" />
              {desktop.zeus_status}
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
