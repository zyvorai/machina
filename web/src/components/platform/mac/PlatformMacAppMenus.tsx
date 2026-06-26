// Copyright (c) 2026 ZyvorAI Labs Private Limited. All rights reserved.

import { useCallback, useEffect, useMemo, useState } from 'react'
import { useLocation, useNavigate } from 'react-router'
import { LogOut, User } from 'lucide-react'
import { useAuth } from '../../../contexts/AuthContext'
import { useAi } from '../../../contexts/AiContext'
import { ASK_ZEUS_LABEL } from '../../../config/aiBrand'
import ConnectionStatus from '../../ConnectionStatus'
import PlatformMacMenuDropdown, { PlatformMacMenuItem } from './PlatformMacMenuDropdown'
import { usePlatformMacDesktop } from './PlatformMacDesktopContext'
import { openCenterPopout } from '../../../utils/platformCenterPopout'
import { openPlatformDockEditor } from '../../../utils/platformDockPins'
import { usePlatformDesktopTier } from '../../../hooks/usePlatformDesktopTier'
import {
  PLATFORM_DESKTOP_TIER_LABELS,
  isPathAllowedForTier,
  type PlatformDesktopTier,
} from '../../../utils/platformDesktopTier'
import { dispatchOpenMissionControl } from './MissionControlContext'
import {
  CLOSE_PLATFORM_MENUS_EVENT,
  dispatchOpenSpotlight,
  OPEN_SPOTLIGHT_EVENT,
} from '../../../utils/platformJarvisShell'
import { ZEUS_SEARCH_PLACEHOLDER } from '../../../config/aiBrand'
import { macMenuSectionsForTier } from '../../../utils/platformMacMenus'
import { integrationNavItems } from '../../../utils/platformIntegrationsNav'
import { usePlatformInfo } from '../../../contexts/PlatformInfoContext'
import { dispatchOpenHelp } from '../../../utils/openHelp'
import {
  loadPlatformDesktopTabs,
  platformDesktopTabActive,
  PLATFORM_DESKTOP_TABS_EVENT,
} from '../../../utils/platformDesktopTabs'

function openSpotlight(prefill?: string) {
  dispatchOpenSpotlight(prefill)
}

export default function PlatformMacAppMenus() {
  const navigate = useNavigate()
  const location = useLocation()
  const { username, logout } = useAuth()
  const { openCopilot } = useAi()
  const { toggleSidebar, toggleInspector, sidebarVisible, inspectorVisible } = usePlatformMacDesktop()
  const [tier, setTier] = usePlatformDesktopTier()
  const [openMenu, setOpenMenu] = useState<string | null>(null)
  const [openWindows, setOpenWindows] = useState(() => loadPlatformDesktopTabs())
  const [zeusQuery, setZeusQuery] = useState('')

  const { info } = usePlatformInfo()
  const navSections = useMemo(() => macMenuSectionsForTier(tier, integrationNavItems(info)), [tier, info])

  const closeMenu = useCallback(() => setOpenMenu(null), [])
  const toggleMenu = (id: string) => setOpenMenu((prev) => (prev === id ? null : id))
  const go = useCallback((path: string) => {
    navigate(path)
    closeMenu()
  }, [navigate, closeMenu])

  const pickTier = (next: PlatformDesktopTier) => {
    setTier(next)
    closeMenu()
  }

  const helpNavItems = useMemo(() => [
    { label: 'Platform Support', path: '/platform/support' },
    { label: 'Developer / SDK', path: '/platform/developer' },
  ].filter((item) => isPathAllowedForTier(item.path, tier)), [tier])

  useEffect(() => {
    const refresh = () => setOpenWindows(loadPlatformDesktopTabs())
    window.addEventListener(PLATFORM_DESKTOP_TABS_EVENT, refresh)
    return () => window.removeEventListener(PLATFORM_DESKTOP_TABS_EVENT, refresh)
  }, [])

  useEffect(() => {
    if (openMenu === 'window') setOpenWindows(loadPlatformDesktopTabs())
  }, [openMenu, location.pathname])

  useEffect(() => {
    const dismiss = () => closeMenu()
    window.addEventListener(OPEN_SPOTLIGHT_EVENT, dismiss)
    window.addEventListener(CLOSE_PLATFORM_MENUS_EVENT, dismiss)
    return () => {
      window.removeEventListener(OPEN_SPOTLIGHT_EVENT, dismiss)
      window.removeEventListener(CLOSE_PLATFORM_MENUS_EVENT, dismiss)
    }
  }, [closeMenu])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey)) return
      if (e.key === ',') {
        e.preventDefault()
        navigate('/platform/settings')
      }
      if (e.altKey && e.key.toLowerCase() === 's') {
        e.preventDefault()
        toggleSidebar()
      }
      if (e.altKey && e.key.toLowerCase() === 'i') {
        e.preventDefault()
        toggleInspector()
      }
      if (e.altKey && e.key.toLowerCase() === 'n') {
        e.preventDefault()
        openCenterPopout(`${location.pathname}${location.search}`)
      }
      if (e.shiftKey && e.key.toLowerCase() === 'a') {
        e.preventDefault()
        openCopilot()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [navigate, toggleSidebar, toggleInspector, openCopilot, location.pathname, location.search])

  return (
    <div className="flex items-center gap-1 shrink-0 min-w-0 overflow-visible">
      <PlatformMacMenuDropdown label="Machina" open={openMenu === 'machina'} onToggle={() => toggleMenu('machina')} onClose={closeMenu}>
        <PlatformMacMenuItem label="About Machina Platform" onClick={() => go('/platform/settings?section=about')} />
        <PlatformMacMenuItem label="Settings…" shortcut="⌘," onClick={() => go('/platform/settings')} />
        <PlatformMacMenuItem label="Customize Dock…" onClick={() => { openPlatformDockEditor(); closeMenu() }} />
        <div className="my-1 border-t border-white/[0.08]" />
        <PlatformMacMenuItem label="Add Host…" onClick={() => go('/platform/enroll')} />
        <PlatformMacMenuItem label="Platform Support" onClick={() => go('/platform/support')} />
        <div className="my-1 border-t border-white/[0.08]" />
        <PlatformMacMenuItem label="Sign Out" onClick={() => { void logout(); closeMenu() }} />
      </PlatformMacMenuDropdown>

      <PlatformMacMenuDropdown label="Go" open={openMenu === 'go'} onToggle={() => toggleMenu('go')} onClose={closeMenu}>
        {navSections.map((section, idx) => (
          <div key={section.label}>
            {idx > 0 && <div className="my-1 border-t border-white/[0.08]" />}
            <PlatformMacMenuItem label={section.label} header />
            {section.items.map((item, itemIdx) => {
              const prev = section.items[itemIdx - 1]
              const showSubheader = item.subsection && item.subsection !== prev?.subsection
              return (
                <div key={item.to}>
                  {showSubheader && <PlatformMacMenuItem label={item.subsection!} header />}
                  <PlatformMacMenuItem
                    label={item.label}
                    checked={location.pathname === item.to || location.pathname.startsWith(`${item.to}/`)}
                    onClick={() => go(item.to)}
                  />
                </div>
              )
            })}
          </div>
        ))}
        <div className="my-1 border-t border-white/[0.08]" />
        <PlatformMacMenuItem label="All destinations…" shortcut="⌘K" onClick={() => { openSpotlight(); closeMenu() }} />
      </PlatformMacMenuDropdown>

      <PlatformMacMenuDropdown label="View" open={openMenu === 'view'} onToggle={() => toggleMenu('view')} onClose={closeMenu}>
        <PlatformMacMenuItem label="Show Sidebar" shortcut="⌘⌥S" checked={sidebarVisible} onClick={() => { toggleSidebar(); closeMenu() }} />
        <PlatformMacMenuItem label="Show Inspector" shortcut="⌘⌥I" checked={inspectorVisible} onClick={() => { toggleInspector(); closeMenu() }} />
        <div className="my-1 border-t border-white/[0.08]" />
        <PlatformMacMenuItem label={PLATFORM_DESKTOP_TIER_LABELS.normal} checked={tier === 'normal'} onClick={() => pickTier('normal')} />
        <PlatformMacMenuItem label={PLATFORM_DESKTOP_TIER_LABELS.power} checked={tier === 'power'} onClick={() => pickTier('power')} />
        <PlatformMacMenuItem label={PLATFORM_DESKTOP_TIER_LABELS.advanced} checked={tier === 'advanced'} onClick={() => pickTier('advanced')} />
        <div className="my-1 border-t border-white/[0.08]" />
        <PlatformMacMenuItem label="Mission Control" shortcut="F3" onClick={() => { dispatchOpenMissionControl(); closeMenu() }} />
      </PlatformMacMenuDropdown>

      <PlatformMacMenuDropdown label="Window" open={openMenu === 'window'} onToggle={() => toggleMenu('window')} onClose={closeMenu}>
        {openWindows.length > 0 && (
          <>
            <PlatformMacMenuItem label="Open Windows" header />
            {openWindows.map((tab) => (
              <PlatformMacMenuItem
                key={tab.path}
                label={tab.label}
                checked={platformDesktopTabActive(location.pathname, tab.path)}
                onClick={() => go(tab.path)}
              />
            ))}
            <div className="my-1 border-t border-white/[0.08]" />
          </>
        )}
        <PlatformMacMenuItem label="Spotlight…" shortcut="⌘K" onClick={() => { openSpotlight(); closeMenu() }} />
        <PlatformMacMenuItem label={`${ASK_ZEUS_LABEL}…`} shortcut="⌘⇧A" onClick={() => { openCopilot(); closeMenu() }} />
        <PlatformMacMenuItem label="Move to New Window" shortcut="⌘⌥N" onClick={() => { openCenterPopout(`${location.pathname}${location.search}`); closeMenu() }} />
      </PlatformMacMenuDropdown>

      <PlatformMacMenuDropdown label="Help" open={openMenu === 'help'} onToggle={() => toggleMenu('help')} onClose={closeMenu}>
        <PlatformMacMenuItem label="Platform guide…" onClick={() => { dispatchOpenHelp('platform'); closeMenu() }} />
        <PlatformMacMenuItem label="Keyboard shortcuts" onClick={() => { dispatchOpenHelp('shortcuts'); closeMenu() }} />
        <div className="my-1 border-t border-white/[0.08]" />
        <PlatformMacMenuItem label={`${ASK_ZEUS_LABEL}…`} shortcut="⌘⇧A" onClick={() => { openCopilot(); closeMenu() }} />
        <PlatformMacMenuItem label="Spotlight Search" shortcut="⌘K" onClick={() => { openSpotlight(); closeMenu() }} />
        <div className="my-1 border-t border-white/[0.08]" />
        {helpNavItems.map((item) => (
          <PlatformMacMenuItem key={item.path} label={item.label} onClick={() => go(item.path)} />
        ))}
        <PlatformMacMenuItem label="OpenAPI Reference" onClick={() => { window.open('/api/v1/openapi.json', '_blank'); closeMenu() }} />
      </PlatformMacMenuDropdown>

      <form
        className="hidden md:flex items-center ml-2 min-w-[12rem] max-w-md flex-1"
        onSubmit={(e) => {
          e.preventDefault()
          openSpotlight(zeusQuery.trim() || undefined)
          setZeusQuery('')
        }}
      >
        <input
          type="search"
          aria-label="Zeus search"
          value={zeusQuery}
          onChange={(e) => setZeusQuery(e.target.value)}
          placeholder={ZEUS_SEARCH_PLACEHOLDER}
          className="w-full rounded-lg bg-white/[0.06] border border-white/[0.08] px-3 py-1 text-xs text-slate-100 placeholder:text-slate-500 focus:outline-none focus:ring-1 focus:ring-sky-500/40"
          data-testid="menubar-zeus-search"
        />
      </form>

      <div className="hidden xl:flex items-center gap-2 ml-2 pl-2 border-l border-white/[0.08] text-xs text-white/50">
        <ConnectionStatus />
        <span className="inline-flex items-center gap-1">
          <User className="w-3 h-3" />
          {username || 'user'}
        </span>
        <button type="button" className="mac-menubar-icon-btn" title="Sign out" aria-label="Sign out" onClick={() => void logout()}>
          <LogOut className="w-3.5 h-3.5" />
        </button>
      </div>
    </div>
  )
}
