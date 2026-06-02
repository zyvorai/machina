// Copyright (c) 2026 ZyvorAI Labs Private Limited. All rights reserved.
// Proprietary software — see LICENSE in the repository root.
// https://zyvor.dev · info@zyvor.dev

import { useState, useRef, useEffect } from 'react'
import { Link, useLocation } from 'react-router'
import { getPinnedPages } from '../utils/pinnedPages'
import { getPageLabel } from '../utils/pageLabels'
import { Plus, Menu, X, ChevronDown, Zap, LogOut, User, Sparkles, Bell, Palette, CircleHelp, Keyboard, Info, BookOpen, ExternalLink, Bot, LayoutGrid, Layers } from 'lucide-react'
import { ZYVOR_HELP } from '../config/zyvorHelp'
import type { HelpTab } from './HelpDialog'
import ConnectionStatus from './ConnectionStatus'
import PlatformTaskDrawer, { PlatformTaskDrawerButton } from './PlatformTaskDrawer'
import LanguageSwitcher from './LanguageSwitcher'
import { useAuth } from '../contexts/AuthContext'
import { useTheme, type AppTheme } from '../contexts/ThemeContext'
import { useWebSocketContext, VMEvent } from '../contexts/WebSocketContext'
import { timeAgo } from '../utils/time'
import { navGroups, NavItem, isOpenStackNavEnabled, navItemVisible, navItemActive, navGroupHasActive, navDropdownSections, TOP_BAR_QUICK_LINKS } from '../utils/routes'
import { navActiveChipClasses, statusActionLinkClasses, statusBgClass, statusSurfaceClasses, statusToneClass } from '../utils/semanticColors'
import { usePlatformInfo } from '../contexts/PlatformInfoContext'
import { useAi } from '../contexts/AiContext'

function NavLink({ item, onClick, theme, setup }: { item: NavItem; onClick?: () => void; theme: AppTheme; setup?: boolean }) {
  const location = useLocation()
  const isActive = navItemActive(item, location.pathname, location.search)

  if (theme === 'steel') {
    return (
      <Link
        to={item.to}
        onClick={onClick}
        className={`nav-steel-link flex items-center gap-2 px-2 py-2 text-sm font-medium no-underline transition-colors duration-200 ${
          setup
            ? `${statusToneClass('warn')} opacity-90 hover:opacity-100`
            : isActive
              ? 'nav-steel-link-active'
              : 'text-[#9aa8b8] hover:text-white'
        }`}
      >
        {item.icon}
        {item.label}
      </Link>
    )
  }

  if (theme === 'aurora') {
    return (
      <Link
        to={item.to}
        onClick={onClick}
        className={`nav-aurora-link flex items-center gap-2 px-2 py-2 text-sm font-medium no-underline transition-colors duration-200 ${
          setup
            ? `${statusToneClass('warn')} opacity-90 hover:opacity-100`
            : isActive
              ? 'nav-aurora-link-active'
              : 'text-[#a89ec8] hover:text-[#f5f3ff]'
        }`}
      >
        {item.icon}
        {item.label}
      </Link>
    )
  }

  return (
    <Link
      to={item.to}
      onClick={onClick}
      className={`flex items-center gap-2 px-3 py-2 rounded-liquid transition-all duration-200 text-sm font-medium ${
        setup
          ? `${statusSurfaceClasses('warn', 'border flex items-center gap-2 px-3 py-2 rounded-liquid text-sm font-medium')}`
          : isActive
            ? 'glass bg-white/10 text-white border border-white/15 shadow-sm'
            : 'text-[var(--text-secondary)] hover:bg-white/5 hover:text-[var(--text-primary)]'
      }`}
    >
      {item.icon}
      {item.label}
    </Link>
  )
}

function DesktopNavCluster({
  openGroup,
  onOpenGroup,
  onDropdownEnter,
  onDropdownLeave,
  username,
  theme,
  openstackReady,
  hypersdkEnabled,
}: {
  openGroup: string | null
  onOpenGroup: (name: string | null) => void
  onDropdownEnter: (name: string) => void
  onDropdownLeave: () => void
  username: string
  theme: AppTheme
  openstackReady: boolean
  hypersdkEnabled: boolean
}) {
  const location = useLocation()
  const steel = theme === 'steel'
  const aurora = theme === 'aurora'

  const triggerClass = (active: boolean) => {
    if (steel || aurora) {
      return `machina-nav-group machina-nav-group-icon flex h-9 w-9 items-center justify-center rounded-lg transition-colors ${
        active ? 'machina-nav-group-active' : ''
      }`
    }
    return `machina-nav-group machina-nav-group-icon flex h-9 w-9 items-center justify-center rounded-lg transition-colors ${
      active
        ? navActiveChipClasses('flex h-9 w-9 items-center justify-center rounded-lg')
        : 'text-slate-400 hover:text-white hover:bg-slate-700/60'
    }`
  }

  const panelClass = (scroll: boolean) => {
    const scrollCls = scroll ? 'max-h-[min(70vh,28rem)] overflow-y-auto' : ''
    if (steel) return `machina-nav-dropdown p-2 rounded-xl min-w-[220px] ${scrollCls}`
    if (aurora) return `machina-nav-dropdown p-2 rounded-xl min-w-[220px] ${scrollCls}`
    return `bg-slate-800/95 backdrop-blur-xl border border-slate-700/50 shadow-2xl p-2 rounded-xl min-w-[220px] ${scrollCls}`
  }

  const linkClass = (active: boolean, setup?: boolean) => {
    if (setup) return `flex items-center gap-3 px-3 py-2 rounded-lg text-sm ${statusActionLinkClasses('warn')}`
    if (steel || aurora) {
      return `machina-nav-dd-link flex items-center gap-3 px-3 py-2 rounded-lg text-sm transition-colors ${
        active ? 'machina-nav-dd-active' : ''
      }`
    }
    return `flex items-center gap-3 px-3 py-2 rounded-lg text-sm transition-colors ${
      active ? navActiveChipClasses() : 'text-slate-300 hover:bg-slate-700/60 hover:text-white'
    }`
  }

  const sectionHeadingClass = steel
    ? 'px-3 py-1.5 text-[10px] font-semibold uppercase tracking-wider text-[#7f8b99]'
    : aurora
      ? 'px-3 py-1.5 text-[10px] font-semibold uppercase tracking-wider text-[#8b7aa8]'
      : 'px-3 py-1.5 text-[10px] font-semibold uppercase tracking-wider text-slate-500'

  const handleNavClick = (e: React.MouseEvent, name: string) => {
    e.stopPropagation()
    onOpenGroup(openGroup === name ? null : name)
  }

  return (
    <>
      {navGroups.map((group) => {
        const BarIcon = group.barIcon
        const hasActive = navGroupHasActive(group, location.pathname, location.search, username, openstackReady, hypersdkEnabled)
        const sections = navDropdownSections(group)
          .map((section) => ({
            ...section,
            items: section.items.filter((i) => navItemVisible(i, username, openstackReady, hypersdkEnabled)),
          }))
          .filter((section) => section.items.length > 0)
        if (sections.length === 0) return null

        return (
          <div
            key={group.label}
            className="relative flex-shrink-0"
            onMouseEnter={() => onDropdownEnter(group.label)}
            onMouseLeave={onDropdownLeave}
          >
            <button
              type="button"
              title={group.label}
              aria-label={group.label}
              aria-haspopup="menu"
              aria-expanded={openGroup === group.label}
              onClick={(e) => handleNavClick(e, group.label)}
              className={triggerClass(hasActive)}
            >
              <BarIcon className="h-[17px] w-[17px] flex-shrink-0" strokeWidth={2} aria-hidden />
            </button>
            {openGroup === group.label && (
              <div className="absolute left-0 top-full z-[200] min-w-[220px] pt-2">
                <div className={panelClass(Boolean(group.menuScroll))}>
                  {sections.map((section) => (
                    <div key={section.label || '_'} className={section.label ? 'mb-2 last:mb-0' : ''}>
                      {section.label ? <p className={sectionHeadingClass}>{section.label}</p> : null}
                      <div className="space-y-0.5">
                        {section.items.map((item) => (
                          <Link
                            key={item.to}
                            to={item.to}
                            onClick={() => onOpenGroup(null)}
                            className={linkClass(navItemActive(item, location.pathname, location.search), item.openstackSetupOnly)}
                          >
                            {item.icon}
                            <span>{item.label}</span>
                          </Link>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )
      })}
    </>
  )
}

export default function Navbar({ onOpenHelp }: { onOpenHelp?: (tab?: HelpTab) => void }) {
  const [mobileOpen, setMobileOpen] = useState(false)
  const [helpMenuOpen, setHelpMenuOpen] = useState(false)
  const [openNavGroup, setOpenNavGroup] = useState<string | null>(null)
  const helpRef = useRef<HTMLDivElement>(null)
  const desktopNavRef = useRef<HTMLDivElement>(null)
  const navCloseTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const location = useLocation()
  const { isAuthenticated, username, logout } = useAuth()
  const { theme, setTheme, cycleTheme } = useTheme()
  const { info } = usePlatformInfo()
  const { toggleCopilot, mode } = useAi()
  const openstackReady = isOpenStackNavEnabled(info?.openstack)
  const hypersdkEnabled = Boolean(info?.hypersdk?.enabled)
  const steel = theme === 'steel'
  const aurora = theme === 'aurora'
  const themed = steel || aurora
  const { events } = useWebSocketContext()
  const [bellOpen, setBellOpen] = useState(false)
  const bellRef = useRef<HTMLDivElement>(null)
  const recentCount = events.filter((e: VMEvent) => Date.now() - e.timestamp < 300_000).length
  const [pinnedPaths, setPinnedPaths] = useState(() => getPinnedPages())
  const [taskDrawerOpen, setTaskDrawerOpen] = useState(false)
  const platformEnabled = Boolean(info?.control_plane?.proxy_url)

  useEffect(() => {
    setPinnedPaths(getPinnedPages())
  }, [location.pathname])

  useEffect(() => {
    if (!bellOpen) return
    const handler = (e: MouseEvent) => {
      if (bellRef.current && !bellRef.current.contains(e.target as Node)) setBellOpen(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [bellOpen])

  useEffect(() => {
    if (!helpMenuOpen) return
    const handler = (e: MouseEvent) => {
      if (helpRef.current && !helpRef.current.contains(e.target as Node)) setHelpMenuOpen(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [helpMenuOpen])

  useEffect(() => {
    if (!openNavGroup) return
    const onDown = (ev: MouseEvent) => {
      const el = desktopNavRef.current
      if (el && !el.contains(ev.target as Node)) setOpenNavGroup(null)
    }
    const onKey = (ev: KeyboardEvent) => {
      if (ev.key === 'Escape') setOpenNavGroup(null)
    }
    document.addEventListener('mousedown', onDown)
    window.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      window.removeEventListener('keydown', onKey)
    }
  }, [openNavGroup])

  useEffect(() => {
    return () => {
      if (navCloseTimer.current) clearTimeout(navCloseTimer.current)
    }
  }, [])

  const handleNavDropdownEnter = (name: string) => {
    if (navCloseTimer.current) {
      clearTimeout(navCloseTimer.current)
      navCloseTimer.current = null
    }
    setOpenNavGroup(name)
  }

  const handleNavDropdownLeave = () => {
    navCloseTimer.current = setTimeout(() => setOpenNavGroup(null), 150)
  }

  const quickLinkClass = (active: boolean) =>
    steel || aurora
      ? `machina-nav-group machina-nav-group-icon flex h-9 w-9 items-center justify-center rounded-lg transition-colors ${
          active ? 'machina-nav-group-active' : ''
        }`
      : `flex h-9 w-9 items-center justify-center rounded-lg transition-colors ${
          active
            ? navActiveChipClasses('flex h-9 w-9 items-center justify-center rounded-lg')
            : 'text-slate-400 hover:text-white hover:bg-slate-700/60'
        }`

  const navShell = themed
    ? 'min-h-[72px] flex flex-wrap items-center gap-x-3 gap-y-2 py-2 lg:flex-nowrap lg:justify-between lg:items-center'
    : 'flex flex-wrap items-center gap-x-2 gap-y-2 min-h-14 py-2 lg:min-h-16 lg:py-0 lg:flex-nowrap lg:justify-between'

  const themeSelect = (
    <label className="flex items-center gap-1 shrink-0 min-w-0" title="Theme">
      <Palette
        className={`w-3.5 h-3.5 shrink-0 ${steel ? 'text-[#8fa0b2]' : aurora ? 'text-[#a89ec8]' : 'text-slate-500'}`}
        aria-hidden
      />
      <select
        aria-label="Theme"
        value={theme}
        onChange={(e) => setTheme(e.target.value as AppTheme)}
        className={`text-xs rounded-xl border px-1.5 sm:px-2 py-1.5 max-w-[6.5rem] sm:max-w-[7.5rem] cursor-pointer outline-none transition min-w-0 ${
          steel
            ? 'nav-steel-select text-[#d7dde5]'
            : aurora
              ? 'nav-aurora-select text-[#e8e4f8]'
              : 'glass bg-white/5 border-white/10 text-[var(--text-primary)]'
        }`}
      >
        <option value="dark">Liquid Glass</option>
        <option value="steel">Steel</option>
        <option value="aurora">Aurora</option>
      </select>
    </label>
  )

  const navBarClass = steel
    ? 'border-b border-[rgba(140,160,190,0.18)] bg-gradient-to-b from-[#0f141a] via-[#1a222d] to-[#0c1117] shadow-[inset_0_1px_0_rgba(255,255,255,0.06),0_10px_30px_rgba(0,0,0,0.45)]'
    : aurora
      ? 'border-b border-[rgba(167,139,250,0.22)] bg-gradient-to-b from-[#0a0618] via-[#12082a] to-[#050816] shadow-[inset_0_1px_0_rgba(255,255,255,0.05),0_10px_40px_rgba(34,211,238,0.08)]'
      : 'liquid-glass-navbar'

  return (
    <nav id="app-topnav" className={`sticky top-0 z-30 ${navBarClass}`}>
      <div className="app-shell">
        <div className={navShell}>
          {/* Logo */}
          <Link
            to="/"
            title="Linux hypervisor host manager — QEMU/KVM + libvirt, optional KubeVirt"
            className={`flex items-center gap-2 sm:gap-2.5 group hover:scale-[1.02] transition-transform duration-200 shrink-0 order-1 ${
              steel ? 'nav-steel-brand' : aurora ? 'nav-aurora-brand' : ''
            }`}
          >
            <div
              className={`flex items-center justify-center shrink-0 ${
                steel
                  ? 'w-[38px] h-[38px] rounded-xl bg-gradient-to-br from-[#2a3442] to-[#121820] border border-[rgba(170,190,220,0.25)] shadow-[inset_0_1px_0_rgba(255,255,255,0.08),0_6px_16px_rgba(0,0,0,0.4)]'
                  : aurora
                    ? 'w-[38px] h-[38px] rounded-xl bg-gradient-to-br from-[#1a0a2e] to-[#050816] border border-[rgba(167,139,250,0.35)] shadow-[0_0_24px_rgba(34,211,238,0.2),inset_0_1px_0_rgba(255,255,255,0.08)]'
                    : 'w-8 h-8 bg-gradient-to-br from-blue-500 to-blue-700 rounded-lg shadow-lg shadow-blue-500/20 group-hover:shadow-blue-500/40 transition-shadow'
              }`}
            >
              <Zap
                className={`${
                  steel ? 'w-5 h-5 text-[#b8c5d6]' : aurora ? 'w-5 h-5 text-[#67e8f9]' : 'w-4.5 h-4.5 text-white'
                }`}
              />
            </div>
            <span
              className={
                steel
                  ? 'text-base sm:text-lg font-semibold text-[#eef3f8]'
                  : aurora
                    ? 'text-base sm:text-lg font-semibold bg-gradient-to-r from-[#67e8f9] via-[#e9d5ff] to-[#f9a8d4] bg-clip-text text-transparent'
                    : 'text-base sm:text-lg font-bold bg-gradient-to-r from-white to-slate-300 bg-clip-text text-transparent'
              }
            >
              Machina
            </span>
          </Link>

          {/* Desktop Nav — v9s-style icon cluster + quick links */}
          <div
            ref={desktopNavRef}
            className="hidden lg:flex flex-1 min-w-0 items-center justify-center gap-2 overflow-visible"
          >
            <nav aria-label="Main navigation" className="machina-nav-wrap flex items-center gap-0.5 overflow-visible">
              <DesktopNavCluster
                openGroup={openNavGroup}
                onOpenGroup={setOpenNavGroup}
                onDropdownEnter={handleNavDropdownEnter}
                onDropdownLeave={handleNavDropdownLeave}
                username={username}
                theme={theme}
                openstackReady={openstackReady}
                hypersdkEnabled={hypersdkEnabled}
              />
            </nav>
            <div
              className={`flex flex-shrink-0 items-center gap-0.5 border-l pl-2 ${
                steel ? 'border-[rgba(140,160,190,0.2)]' : aurora ? 'border-[rgba(167,139,250,0.2)]' : 'border-slate-700/60'
              }`}
              aria-label="Toolbar shortcuts"
            >
              {platformEnabled && (
                <Link
                  to="/platform"
                  title="Platform desktop"
                  aria-label="Platform desktop"
                  className={quickLinkClass(location.pathname.startsWith('/platform'))}
                >
                  <LayoutGrid className="w-4 h-4" />
                </Link>
              )}
              {TOP_BAR_QUICK_LINKS.map((item) => (
                <Link
                  key={item.to}
                  to={item.to}
                  title={item.label}
                  aria-label={item.label}
                  aria-current={navItemActive(item, location.pathname, location.search) ? 'page' : undefined}
                  className={quickLinkClass(navItemActive(item, location.pathname, location.search))}
                >
                  {item.icon}
                </Link>
              ))}
            </div>
          </div>

          <div className="flex flex-wrap items-center justify-end gap-x-1.5 gap-y-2 sm:gap-x-2 min-w-0 shrink-0 w-full basis-full ml-auto order-2 sm:w-auto sm:basis-auto lg:order-3 lg:w-auto lg:shrink-0">
            <LanguageSwitcher className="hidden sm:flex" />
            {themeSelect}
            <button
              type="button"
              onClick={() => void cycleTheme()}
              className={`p-1.5 rounded-lg transition shrink-0 ${
                steel
                  ? 'text-[#9aa8b8] hover:text-white hover:bg-white/5'
                  : aurora
                    ? 'text-[#a89ec8] hover:text-[#f5f3ff] hover:bg-white/5'
                    : 'hover:bg-slate-700/60 text-slate-400 hover:text-white'
              }`}
              title="Cycle theme (dark → steel → aurora)"
              aria-label="Cycle theme"
            >
              <Sparkles className={`w-4 h-4 ${aurora ? 'text-[#67e8f9]' : ''}`} />
            </button>
            <div className="relative shrink-0" ref={bellRef}>
              <button
                type="button"
                onClick={() => setBellOpen(o => !o)}
                className={`relative p-1.5 rounded-lg transition ${
                  steel
                    ? 'text-[#9aa8b8] hover:text-white hover:bg-white/5'
                    : aurora
                      ? 'text-[#a89ec8] hover:text-[#f5f3ff] hover:bg-white/5'
                      : 'hover:bg-slate-700/60 text-slate-400 hover:text-white'
                }`}
                title="Notifications"
                aria-label="Notifications"
              >
                <Bell className="w-4 h-4" />
                {recentCount > 0 && (
                  <span className={`absolute -top-0.5 -right-0.5 w-4 h-4 ${statusBgClass('info')} rounded-full text-[9px] font-bold text-white flex items-center justify-center`}>{recentCount > 9 ? '9+' : recentCount}</span>
                )}
              </button>
              {bellOpen && (
                <div
                  className={`absolute top-full right-0 mt-1 rounded-xl py-2 w-[min(20rem,calc(100vw-2rem))] z-40 animate-fade-in origin-top-right max-h-[400px] overflow-y-auto ${
                    steel
                      ? 'nav-steel-dropdown border border-[rgba(140,160,190,0.18)] shadow-2xl'
                      : aurora
                        ? 'nav-aurora-dropdown shadow-2xl'
                        : 'bg-slate-800/95 backdrop-blur-xl border border-slate-700/50 shadow-2xl'
                  }`}
                >
                  <div className={`px-4 py-2 border-b text-[10px] font-bold uppercase tracking-wider ${
                    steel
                      ? 'border-[rgba(140,160,190,0.12)] text-[#7f8b99]'
                      : aurora
                        ? 'border-[rgba(167,139,250,0.15)] text-[#8b7aa8]'
                        : 'border-slate-700/50 text-slate-500'
                  }`}
                  >
                    Recent Activity
                  </div>
                  {events.length === 0 ? (
                    <div className={`px-4 py-6 text-center text-sm ${steel ? 'text-[#8fa0b2]' : aurora ? 'text-[#8b7aa8]' : 'text-slate-500'}`}>No recent events</div>
                  ) : (
                    events.slice(0, 20).map((ev: VMEvent, i: number) => (
                      <div
                        key={i}
                        className={`px-4 py-2.5 transition text-sm ${
                          themed ? 'hover:bg-white/5 text-[#cfd8e3]' : 'hover:bg-slate-700/40'
                        }`}
                      >
                        <div className="flex items-center justify-between">
                          <span className={`font-medium ${themed ? 'text-[#eef3f8]' : 'text-white'}`}>{ev.name}</span>
                          <span className={`text-[10px] ${steel ? 'text-[#7f8b99]' : aurora ? 'text-[#8b7aa8]' : 'text-slate-500'}`}>{timeAgo(ev.timestamp)}</span>
                        </div>
                        <div className={`text-xs mt-0.5 ${steel ? 'text-[#9aa8b8]' : aurora ? 'text-[#a89ec8]' : 'text-slate-400'}`}>
                          {ev.event === 'state_change' && `${ev.old_state} → ${ev.new_state}`}
                          {ev.event === 'vm_added' && 'VM created'}
                          {ev.event === 'vm_removed' && 'VM removed'}
                        </div>
                      </div>
                    ))
                  )}
                </div>
              )}
            </div>
            {mode !== 'off' && (
              <button
                type="button"
                onClick={toggleCopilot}
                className={`hidden sm:flex items-center gap-1 px-2 py-1.5 rounded-lg transition text-sm shrink-0 ${
                  steel
                    ? 'text-orange-300/90 hover:text-orange-200 hover:bg-white/5'
                    : aurora
                      ? 'text-orange-300/90 hover:text-orange-200 hover:bg-white/5'
                      : 'text-orange-400 hover:bg-slate-700/60 hover:text-orange-300'
                }`}
                title="Zeus"
                aria-label="Open Zeus"
              >
                <Bot className="w-4 h-4" />
                <span className="hidden md:inline text-xs font-medium">Copilot</span>
              </button>
            )}
            {onOpenHelp && (
              <div className="relative shrink-0 hidden sm:block" ref={helpRef}>
                <button
                  type="button"
                  onClick={() => setHelpMenuOpen((v) => !v)}
                  aria-expanded={helpMenuOpen}
                  aria-haspopup="menu"
                  className={`flex items-center gap-1 px-2 py-1.5 rounded-lg transition text-sm ${
                    steel
                      ? 'text-[#9aa8b8] hover:text-white hover:bg-white/5'
                      : aurora
                        ? 'text-[#a89ec8] hover:text-[#f5f3ff] hover:bg-white/5'
                        : 'text-slate-400 hover:bg-slate-700/60 hover:text-white'
                  } ${helpMenuOpen ? (themed ? 'bg-white/5 text-white' : 'bg-slate-700/60 text-white') : ''}`}
                  title="Help (?)"
                  aria-label="Help menu"
                >
                  <CircleHelp className="w-4 h-4 shrink-0" aria-hidden />
                  <span className="hidden md:inline text-xs font-medium">Help</span>
                  <ChevronDown
                    className={`w-3 h-3 hidden md:block transition-transform ${helpMenuOpen ? 'rotate-180' : ''}`}
                    aria-hidden
                  />
                </button>
                {helpMenuOpen && (
                  <div
                    className={`absolute top-full right-0 mt-1 min-w-[12.5rem] rounded-xl py-1.5 z-40 animate-fade-in ${
                      steel
                        ? 'nav-steel-dropdown border border-[rgba(140,160,190,0.18)] shadow-2xl'
                        : aurora
                          ? 'nav-aurora-dropdown shadow-2xl'
                          : 'bg-slate-800/95 backdrop-blur-xl border border-slate-700/50 shadow-2xl'
                    }`}
                    role="menu"
                  >
                    <button
                      type="button"
                      role="menuitem"
                      onClick={() => {
                        setHelpMenuOpen(false)
                        onOpenHelp('platform')
                      }}
                      className={`flex w-full items-center gap-2 px-3 py-2 text-sm ${
                        themed ? 'text-[#cfd8e3] hover:bg-white/5' : 'text-slate-300 hover:bg-slate-700/60'
                      }`}
                    >
                      <Layers className="w-4 h-4 shrink-0" aria-hidden />
                      Platform guide…
                    </button>
                    <button
                      type="button"
                      role="menuitem"
                      onClick={() => {
                        setHelpMenuOpen(false)
                        onOpenHelp('shortcuts')
                      }}
                      className={`flex w-full items-center gap-2 px-3 py-2 text-sm ${
                        themed ? 'text-[#cfd8e3] hover:bg-white/5' : 'text-slate-300 hover:bg-slate-700/60'
                      }`}
                    >
                      <Keyboard className="w-4 h-4 shrink-0" aria-hidden />
                      Keyboard shortcuts
                      <kbd
                        className={`ml-auto text-[10px] px-1 py-0.5 rounded font-mono ${
                          themed ? 'bg-black/30 text-[#9aa8b8]' : 'bg-slate-700 text-slate-500'
                        }`}
                      >
                        ?
                      </kbd>
                    </button>
                    <button
                      type="button"
                      role="menuitem"
                      onClick={() => {
                        setHelpMenuOpen(false)
                        onOpenHelp('about')
                      }}
                      className={`flex w-full items-center gap-2 px-3 py-2 text-sm ${
                        themed ? 'text-[#cfd8e3] hover:bg-white/5' : 'text-slate-300 hover:bg-slate-700/60'
                      }`}
                    >
                      <Info className="w-4 h-4 shrink-0" aria-hidden />
                      About
                    </button>
                    <a
                      role="menuitem"
                      href={ZYVOR_HELP.docs}
                      target="_blank"
                      rel="noopener noreferrer"
                      onClick={() => setHelpMenuOpen(false)}
                      className={`flex w-full items-center gap-2 px-3 py-2 text-sm ${
                        themed ? 'text-[#cfd8e3] hover:bg-white/5' : 'text-slate-300 hover:bg-slate-700/60'
                      }`}
                    >
                      <BookOpen className="w-4 h-4 shrink-0" aria-hidden />
                      Help &amp; documentation
                      <ExternalLink className="w-3 h-3 ml-auto opacity-60" aria-hidden />
                    </a>
                    <a
                      role="menuitem"
                      href={ZYVOR_HELP.contact}
                      target="_blank"
                      rel="noopener noreferrer"
                      onClick={() => setHelpMenuOpen(false)}
                      className={`flex w-full items-center gap-2 px-3 py-2 text-sm ${
                        themed ? 'text-[#cfd8e3] hover:bg-white/5' : 'text-slate-300 hover:bg-slate-700/60'
                      }`}
                    >
                      <ExternalLink className="w-4 h-4 shrink-0" aria-hidden />
                      Contact support
                    </a>
                    <a
                      role="menuitem"
                      href={ZYVOR_HELP.platform}
                      target="_blank"
                      rel="noopener noreferrer"
                      onClick={() => setHelpMenuOpen(false)}
                      className="flex w-full items-center gap-2 px-3 py-2 text-sm text-orange-400 hover:text-orange-300"
                    >
                      <ExternalLink className="w-4 h-4 shrink-0" aria-hidden />
                      zyvor.dev · © 2026
                    </a>
                  </div>
                )}
              </div>
            )}
            {platformEnabled && (
              <PlatformTaskDrawerButton onClick={() => setTaskDrawerOpen(true)} />
            )}
            <div className="shrink-0">
              <ConnectionStatus />
            </div>
            <Link
              to="/create"
              className={`hidden md:flex items-center gap-1.5 px-3 py-1.5 sm:px-4 sm:py-2 rounded-xl transition-all duration-200 text-sm font-medium shrink-0 whitespace-nowrap ${
                steel
                  ? 'bg-gradient-to-r from-[#5d90f7] to-[#3d6fd0] text-white shadow-lg shadow-black/30 hover:brightness-110'
                  : aurora
                    ? 'bg-gradient-to-r from-cyan-500 via-violet-600 to-fuchsia-600 text-white shadow-lg shadow-violet-500/25 hover:brightness-110'
                    : 'bg-gradient-to-r from-blue-600 to-blue-700 hover:from-blue-500 hover:to-blue-600 shadow-lg shadow-blue-600/20 hover:shadow-blue-500/30'
              }`}
            >
              <Plus className="w-4 h-4 shrink-0" />
              <span className="hidden lg:inline">Create VM</span>
              <span className="lg:hidden">Create</span>
            </Link>
            {isAuthenticated && (
              <div
                className={`flex items-center gap-1 shrink-0 pl-1.5 sm:pl-2 ml-0.5 border-l ${
                  steel
                    ? 'border-[rgba(140,160,190,0.2)]'
                    : aurora
                      ? 'border-[rgba(167,139,250,0.2)]'
                      : 'border-slate-700/60'
                }`}
              >
                <span
                  className={`hidden xl:flex text-xs items-center gap-1 max-w-[140px] 2xl:max-w-[200px] ${
                    steel ? 'text-[#9aa8b8]' : aurora ? 'text-[#a89ec8]' : 'text-slate-400'
                  }`}
                  title={username || undefined}
                >
                  <User className="w-3 h-3 shrink-0" aria-hidden />
                  <span className="truncate">{username || 'Signed in'}</span>
                </span>
                <button
                  type="button"
                  onClick={() => void logout()}
                  className={`group flex items-center gap-1 px-2 py-1.5 rounded-lg transition shrink-0 border ${
                    steel
                      ? 'text-[#cfd8e3] border-[rgba(140,160,190,0.25)] hover:bg-white/5 hover:text-white'
                      : aurora
                        ? 'text-[#e8e4f8] border-[rgba(167,139,250,0.28)] hover:bg-white/5 hover:text-white'
                        : 'text-slate-300 hover:bg-slate-700 hover:text-white border-slate-600/60 hover:border-slate-500'
                  }`}
                  title={username ? `Sign out (${username})` : 'Sign out'}
                  aria-label="Sign out"
                >
                  <LogOut className={`w-4 h-4 shrink-0 text-slate-400 group-hover:text-[var(--machina-status-error)]`} />
                  <span className="text-[11px] sm:text-xs font-medium leading-none">Log out</span>
                </button>
              </div>
            )}
            <button
              type="button"
              className={`lg:hidden p-2 rounded-lg transition shrink-0 -mr-1 ${
                steel
                  ? 'text-[#9aa8b8] hover:bg-white/5 hover:text-white'
                  : aurora
                    ? 'text-[#a89ec8] hover:bg-white/5 hover:text-[#f5f3ff]'
                    : 'hover:bg-slate-700/60'
              }`}
              onClick={() => setMobileOpen(!mobileOpen)}
              aria-label="Open menu"
            >
              {mobileOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
            </button>
          </div>
        </div>
      </div>

      {mobileOpen && (
        <div
          className={`lg:hidden border-t pb-4 animate-fade-in ${
            steel
              ? 'border-[rgba(140,160,190,0.15)] nav-steel-dropdown'
              : aurora
                ? 'border-[rgba(167,139,250,0.15)] nav-aurora-dropdown'
                : 'border-slate-700/50 bg-slate-900/95 backdrop-blur-xl'
          }`}
        >
          <div className="app-shell pt-3 space-y-4">
            {pinnedPaths.length > 0 ? (
              <div>
                <div className={`text-[10px] font-bold uppercase tracking-wider px-3 mb-1.5 ${
                  steel ? 'text-[#7f8b99]' : aurora ? 'text-[#8b7aa8]' : 'text-slate-500'
                }`}
                >
                  Pinned
                </div>
                <div className="space-y-0.5">
                  {pinnedPaths.map((path) => (
                    <Link
                      key={path}
                      to={path}
                      onClick={() => setMobileOpen(false)}
                      className={`flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-medium truncate no-underline ${statusToneClass('warn')} opacity-90 ${
                        steel || aurora ? 'hover:bg-white/5' : 'hover:bg-[color-mix(in_srgb,var(--machina-status-warn)_12%,transparent)]'
                      }`}
                    >
                      {getPageLabel(path)}
                    </Link>
                  ))}
                </div>
              </div>
            ) : null}
            {navGroups.map((group) => {
              const sections = navDropdownSections(group)
                .map((section) => ({
                  ...section,
                  items: section.items.filter((item) => navItemVisible(item, username, openstackReady, hypersdkEnabled)),
                }))
                .filter((section) => section.items.length > 0)
              if (sections.length === 0) return null
              return (
              <div key={group.label} className="px-1 py-2 border-b border-slate-700/40 last:border-b-0">
                <h3 className={`text-xs font-semibold uppercase tracking-wider mb-2 px-3 ${
                  steel ? 'text-[#7f8b99]' : aurora ? 'text-[#8b7aa8]' : 'text-slate-500'
                }`}
                >
                  {group.label}
                </h3>
                <div className="space-y-3">
                  {sections.map((section) => (
                    <div key={section.label || '_'}>
                      {section.label ? (
                        <p className={`text-[10px] font-semibold uppercase tracking-wider mb-1.5 pl-3 ${
                          steel ? 'text-[#6b7785]' : aurora ? 'text-[#7a6a98]' : 'text-slate-600'
                        }`}
                        >
                          {section.label}
                        </p>
                      ) : null}
                      <div className="space-y-0.5">
                        {section.items.map((item) => (
                          <NavLink
                            key={item.to}
                            item={item}
                            theme={theme}
                            setup={item.openstackSetupOnly}
                            onClick={() => setMobileOpen(false)}
                          />
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
              )
            })}
            <div className="px-4 py-3 border-b border-slate-700/40">
              <div className={`text-[10px] font-bold uppercase tracking-wider mb-2 ${
                steel ? 'text-[#7f8b99]' : aurora ? 'text-[#8b7aa8]' : 'text-slate-500'
              }`}
              >
                Shortcuts
              </div>
              <div className="flex flex-wrap gap-2">
                {TOP_BAR_QUICK_LINKS.map((item) => (
                  <NavLink key={item.to} item={item} theme={theme} onClick={() => setMobileOpen(false)} />
                ))}
              </div>
            </div>
            <Link
              to="/create"
              onClick={() => setMobileOpen(false)}
              className={`flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl transition sm:hidden font-medium ${
                steel
                  ? 'bg-gradient-to-r from-[#5d90f7] to-[#3d6fd0] text-white'
                  : aurora
                    ? 'bg-gradient-to-r from-cyan-500 via-violet-600 to-fuchsia-600 text-white'
                    : 'bg-gradient-to-r from-blue-600 to-blue-700'
              }`}
            >
              <Plus className="w-4 h-4" />
              Create VM
            </Link>
            {onOpenHelp && (
              <div className="space-y-0.5 sm:hidden">
                <div className={`text-[10px] font-bold uppercase tracking-wider px-3 mb-1.5 ${
                  steel ? 'text-[#7f8b99]' : aurora ? 'text-[#8b7aa8]' : 'text-slate-500'
                }`}
                >
                  Help
                </div>
                <button
                  type="button"
                  onClick={() => { setMobileOpen(false); onOpenHelp('platform') }}
                  className={`flex w-full items-center gap-2 px-3 py-2 rounded-lg text-sm ${
                    themed ? 'text-[#cfd8e3] hover:bg-white/5' : 'text-slate-300 hover:bg-slate-700/60'
                  }`}
                >
                  <Layers className="w-4 h-4" />
                  Platform guide…
                </button>
                <button
                  type="button"
                  onClick={() => { setMobileOpen(false); onOpenHelp('shortcuts') }}
                  className={`flex w-full items-center gap-2 px-3 py-2 rounded-lg text-sm ${
                    themed ? 'text-[#cfd8e3] hover:bg-white/5' : 'text-slate-300 hover:bg-slate-700/60'
                  }`}
                >
                  <Keyboard className="w-4 h-4" />
                  Keyboard shortcuts
                </button>
                <button
                  type="button"
                  onClick={() => { setMobileOpen(false); onOpenHelp('about') }}
                  className={`flex w-full items-center gap-2 px-3 py-2 rounded-lg text-sm ${
                    themed ? 'text-[#cfd8e3] hover:bg-white/5' : 'text-slate-300 hover:bg-slate-700/60'
                  }`}
                >
                  <Info className="w-4 h-4" />
                  About
                </button>
                <a
                  href={ZYVOR_HELP.docs}
                  target="_blank"
                  rel="noopener noreferrer"
                  onClick={() => setMobileOpen(false)}
                  className={`flex w-full items-center gap-2 px-3 py-2 rounded-lg text-sm ${
                    themed ? 'text-[#cfd8e3] hover:bg-white/5' : 'text-slate-300 hover:bg-slate-700/60'
                  }`}
                >
                  <BookOpen className="w-4 h-4" />
                  Help &amp; documentation
                </a>
              </div>
            )}
            {isAuthenticated && (
              <button
                type="button"
                onClick={() => { setMobileOpen(false); void logout() }}
                className={`flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg transition text-sm w-full ${
                  themed ? 'bg-white/5 text-[#cfd8e3] hover:bg-white/10' : 'bg-slate-800 hover:bg-slate-700 text-slate-300'
                }`}
              >
                <LogOut className="w-4 h-4" />
                Log out{username ? ` (${username})` : ''}
              </button>
            )}
          </div>
        </div>
      )}
      <PlatformTaskDrawer open={taskDrawerOpen} onClose={() => setTaskDrawerOpen(false)} />
    </nav>
  )
}
