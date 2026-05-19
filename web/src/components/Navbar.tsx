import { useState, useRef, useEffect } from 'react'
import { Link, useLocation } from 'react-router'
import { Plus, Menu, X, ChevronDown, Zap, LogOut, User, Sun, Moon, Bell, Palette } from 'lucide-react'
import ConnectionStatus from './ConnectionStatus'
import { useAuth } from '../contexts/AuthContext'
import { useTheme, type AppTheme } from '../contexts/ThemeContext'
import { useWebSocketContext, VMEvent } from '../contexts/WebSocketContext'
import { timeAgo } from '../utils/time'
import { navGroups, NavItem, NavGroup } from '../utils/routes'

function navItemVisible(item: NavItem, username: string) {
  return !item.requiresRoot || username === 'root'
}

function NavLink({ item, onClick, steel }: { item: NavItem; onClick?: () => void; steel: boolean }) {
  const { theme } = useTheme()
  const isLight = theme === 'light'
  const location = useLocation()
  const isActive = location.pathname === item.to

  if (steel) {
    return (
      <Link
        to={item.to}
        onClick={onClick}
        className={`nav-steel-link flex items-center gap-2 px-2 py-2 text-sm font-medium no-underline transition-colors duration-200 ${
          isActive ? 'nav-steel-link-active' : 'text-[#9aa8b8] hover:text-white'
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
      className={`flex items-center gap-2 px-3 py-2 rounded-lg transition-all duration-200 text-sm font-medium ${
        isActive
          ? isLight
            ? 'bg-blue-100 text-blue-900 shadow-lg shadow-blue-200/40'
            : 'bg-blue-600/90 text-white shadow-lg shadow-blue-600/20'
          : isLight
            ? 'text-slate-700 hover:bg-slate-100'
            : 'text-slate-300 hover:bg-slate-700/60 hover:text-white'
      }`}
    >
      {item.icon}
      {item.label}
    </Link>
  )
}

function DesktopDropdown({ group, username, steel }: { group: NavGroup; username: string; steel: boolean }) {
  const { theme } = useTheme()
  const isLight = theme === 'light'
  const [open, setOpen] = useState(false)
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const location = useLocation()
  const items = group.items.filter((i) => navItemVisible(i, username))
  const hasActive = items.some((i) => i.to === location.pathname)

  const handleEnter = () => {
    if (closeTimer.current) { clearTimeout(closeTimer.current); closeTimer.current = null }
    setOpen(true)
  }
  const handleLeave = () => {
    const timer = setTimeout(() => setOpen(false), 400)
    closeTimer.current = timer
  }

  const btnSteel = steel
    ? `flex items-center gap-1 px-2 py-2 text-sm font-medium border-0 bg-transparent cursor-pointer rounded-lg transition-colors ${
      hasActive ? 'text-[#eef3f8]' : 'text-[#9aa8b8] hover:text-white'
    }`
    : `flex items-center gap-1 px-3 py-2 rounded-lg transition-all duration-200 text-sm font-medium ${
      hasActive ? (isLight ? 'text-blue-900' : 'text-blue-400') : (isLight ? 'text-slate-700 hover:bg-slate-100' : 'text-slate-300 hover:bg-slate-700/60 hover:text-white')
    }`

  const panelClass = steel
    ? 'absolute top-full left-0 mt-1 rounded-xl py-2 min-w-[180px] z-40 animate-fade-in origin-top nav-steel-dropdown border border-[rgba(140,160,190,0.18)] shadow-2xl'
    : isLight
      ? 'absolute top-full left-0 mt-1 rounded-xl overflow-hidden py-1 min-w-[180px] z-40 animate-fade-in origin-top bg-white border border-slate-200 shadow-2xl'
      : 'absolute top-full left-0 mt-1 rounded-xl overflow-hidden py-1 min-w-[180px] z-40 animate-fade-in origin-top bg-slate-800/95 backdrop-blur-xl border border-slate-700/50 shadow-2xl'

  const itemClass = (active: boolean) =>
    steel
      ? `flex items-center gap-2.5 px-4 py-2.5 transition text-sm no-underline ${
        active ? 'text-[#eef3f8] bg-white/5' : 'text-[#9aa8b8] hover:text-white hover:bg-white/5'
      }`
      : `flex items-center gap-2.5 px-4 py-2.5 transition-all duration-150 text-sm ${
        active
          ? isLight
            ? 'bg-blue-100 text-blue-900'
            : 'bg-blue-600/80 text-white'
          : isLight
            ? 'text-slate-700 hover:bg-slate-100'
            : 'text-slate-300 hover:bg-slate-700/60 hover:text-white'
      }`

  return (
    <div className="relative" onMouseEnter={handleEnter} onMouseLeave={handleLeave}>
      <button type="button" onClick={() => setOpen(o => !o)} className={btnSteel}>
        {group.label}
        <ChevronDown className={`w-3 h-3 transition-transform duration-200 ${open ? 'rotate-180' : ''}`} />
      </button>
      {open && (
        <div className={panelClass}>
          {items.map((item) => (
            <Link
              key={item.to}
              to={item.to}
              onClick={() => setOpen(false)}
              className={itemClass(location.pathname === item.to)}
            >
              {item.icon}
              {item.label}
            </Link>
          ))}
        </div>
      )}
    </div>
  )
}

export default function Navbar() {
  const [mobileOpen, setMobileOpen] = useState(false)
  const { isAuthenticated, username, logout } = useAuth()
  const { theme, setTheme, toggleDarkLight } = useTheme()
  const steel = theme === 'steel'
  const { events } = useWebSocketContext()
  const [bellOpen, setBellOpen] = useState(false)
  const bellRef = useRef<HTMLDivElement>(null)
  const recentCount = events.filter((e: VMEvent) => Date.now() - e.timestamp < 300_000).length

  useEffect(() => {
    if (!bellOpen) return
    const handler = (e: MouseEvent) => {
      if (bellRef.current && !bellRef.current.contains(e.target as Node)) setBellOpen(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [bellOpen])

  const navShell = steel
    ? 'min-h-[72px] flex flex-wrap items-center gap-x-3 gap-y-2 py-2 lg:flex-nowrap lg:justify-between lg:items-center'
    : 'flex flex-wrap items-center gap-x-2 gap-y-2 min-h-14 py-2 lg:min-h-16 lg:py-0 lg:flex-nowrap lg:justify-between'

  const themeSelect = (
    <label className="flex items-center gap-1 shrink-0 min-w-0" title="Theme">
      <Palette className={`w-3.5 h-3.5 shrink-0 light-theme:text-slate-600 ${steel ? 'text-[#8fa0b2]' : 'text-slate-500'}`} aria-hidden />
      <select
        aria-label="Theme"
        value={theme}
        onChange={(e) => setTheme(e.target.value as AppTheme)}
        className={`text-xs rounded-xl border px-1.5 sm:px-2 py-1.5 max-w-[6.5rem] sm:max-w-[7.5rem] cursor-pointer outline-none transition min-w-0 light-theme:bg-slate-50 light-theme:border-slate-300 light-theme:text-slate-900 ${
          steel
            ? 'nav-steel-select text-[#d7dde5]'
            : 'bg-slate-900/80 border-slate-600 text-slate-200'
        }`}
      >
        <option value="dark">Dark</option>
        <option value="steel">Steel</option>
        <option value="light">Light</option>
      </select>
    </label>
  )

  return (
    <nav
      id="app-topnav"
      className={`sticky top-0 z-30 light-theme:bg-white light-theme:border-slate-200 ${
        steel
          ? 'border-b border-[rgba(140,160,190,0.18)] bg-gradient-to-b from-[#0f141a] via-[#1a222d] to-[#0c1117] shadow-[inset_0_1px_0_rgba(255,255,255,0.06),0_10px_30px_rgba(0,0,0,0.45)]'
          : 'bg-slate-900/80 backdrop-blur-xl border-b border-slate-700/50'
      }`}
    >
      <div className="app-shell">
        <div className={navShell}>
          {/* Logo */}
          <Link
            to="/"
            title="Linux hypervisor host manager — QEMU/KVM + libvirt, optional KubeVirt"
            className={`flex items-center gap-2 sm:gap-2.5 group hover:scale-[1.02] transition-transform duration-200 shrink-0 order-1 ${
              steel ? 'nav-steel-brand' : ''
            }`}
          >
            <div
              className={`flex items-center justify-center shrink-0 ${
                steel
                  ? 'w-[38px] h-[38px] rounded-xl bg-gradient-to-br from-[#2a3442] to-[#121820] border border-[rgba(170,190,220,0.25)] shadow-[inset_0_1px_0_rgba(255,255,255,0.08),0_6px_16px_rgba(0,0,0,0.4)]'
                  : 'light-theme:bg-gradient-to-br light-theme:from-blue-100 light-theme:to-blue-200 w-8 h-8 bg-gradient-to-br from-blue-500 to-blue-700 rounded-lg shadow-lg shadow-blue-500/20 group-hover:shadow-blue-500/40 transition-shadow'
              }`}
            >
              <Zap className={`${steel ? 'w-5 h-5 text-[#b8c5d6]' : 'light-theme:text-blue-900 w-4.5 h-4.5 text-white'}`} />
            </div>
            <span
              className={
                steel
                  ? 'text-base sm:text-lg font-semibold text-[#eef3f8]'
                  : theme === 'light'
                    ? 'text-base sm:text-lg font-bold text-slate-900'
                    : 'text-base sm:text-lg font-bold bg-gradient-to-r from-white to-slate-300 bg-clip-text text-transparent'
              }
            >
              Machina
            </span>
          </Link>

          {/* Desktop Nav — top bar only, no sidebar */}
          <div className="hidden lg:flex items-center gap-1 order-3 lg:order-2 flex-1 min-w-0 justify-center">
            {navGroups.map((group) => (
              <DesktopDropdown key={group.label} group={group} username={username} steel={steel} />
            ))}
          </div>

          <div className="flex flex-wrap items-center justify-end gap-x-1.5 gap-y-2 sm:gap-x-2 min-w-0 shrink-0 w-full basis-full ml-auto order-2 sm:w-auto sm:basis-auto lg:order-3 lg:w-auto lg:shrink-0">
            {themeSelect}
            <button
              type="button"
              onClick={() => void toggleDarkLight()}
              className={`p-1.5 rounded-lg transition shrink-0 light-theme:text-slate-600 light-theme:hover:bg-slate-100 ${
                steel
                  ? 'text-[#9aa8b8] hover:text-white hover:bg-white/5'
                  : 'hover:bg-slate-700/60 text-slate-400 hover:text-white'
              }`}
              title={
                theme === 'light'
                  ? 'Switch to dark'
                  : theme === 'steel'
                    ? 'Switch to standard dark'
                    : 'Switch to light'
              }
              aria-label="Toggle dark or light theme"
            >
              {theme === 'light' ? (
                <Moon className="w-4 h-4" />
              ) : theme === 'steel' ? (
                <Moon className="w-4 h-4" />
              ) : (
                <Sun className="w-4 h-4" />
              )}
            </button>
            <div className="relative shrink-0" ref={bellRef}>
              <button
                type="button"
                onClick={() => setBellOpen(o => !o)}
                className={`relative p-1.5 rounded-lg transition light-theme:text-slate-600 light-theme:hover:bg-slate-100 ${
                  steel ? 'text-[#9aa8b8] hover:text-white hover:bg-white/5' : 'hover:bg-slate-700/60 text-slate-400 hover:text-white'
                }`}
                title="Notifications"
                aria-label="Notifications"
              >
                <Bell className="w-4 h-4" />
                {recentCount > 0 && (
                  <span className="absolute -top-0.5 -right-0.5 w-4 h-4 bg-blue-500 rounded-full text-[9px] font-bold text-white flex items-center justify-center">{recentCount > 9 ? '9+' : recentCount}</span>
                )}
              </button>
              {bellOpen && (
                <div
                  className={`absolute top-full right-0 mt-1 rounded-xl py-2 w-[min(20rem,calc(100vw-2rem))] z-40 animate-fade-in origin-top-right max-h-[400px] overflow-y-auto light-theme:bg-white light-theme:border-slate-200 ${
                    steel
                      ? 'nav-steel-dropdown border border-[rgba(140,160,190,0.18)] shadow-2xl'
                      : 'bg-slate-800/95 backdrop-blur-xl border border-slate-700/50 shadow-2xl'
                  }`}
                >
                  <div className={`px-4 py-2 border-b text-[10px] font-bold uppercase tracking-wider light-theme:border-slate-200 light-theme:text-slate-600 ${
                    steel ? 'border-[rgba(140,160,190,0.12)] text-[#7f8b99]' : 'border-slate-700/50 text-slate-500'
                  }`}
                  >
                    Recent Activity
                  </div>
                  {events.length === 0 ? (
                    <div className={`px-4 py-6 text-center text-sm light-theme:text-slate-500 ${steel ? 'text-[#8fa0b2]' : 'text-slate-500'}`}>No recent events</div>
                  ) : (
                    events.slice(0, 20).map((ev: VMEvent, i: number) => (
                      <div
                        key={i}
                        className={`px-4 py-2.5 transition text-sm light-theme:text-slate-700 light-theme:hover:bg-slate-100 ${
                          steel ? 'hover:bg-white/5 text-[#cfd8e3]' : 'hover:bg-slate-700/40'
                        }`}
                      >
                        <div className="flex items-center justify-between">
                          <span className={`font-medium light-theme:text-slate-900 ${steel ? 'text-[#eef3f8]' : 'text-white'}`}>{ev.name}</span>
                          <span className={`text-[10px] light-theme:text-slate-500 ${steel ? 'text-[#7f8b99]' : 'text-slate-500'}`}>{timeAgo(ev.timestamp)}</span>
                        </div>
                        <div className={`text-xs mt-0.5 light-theme:text-slate-600 ${steel ? 'text-[#9aa8b8]' : 'text-slate-400'}`}>
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
            <div className="shrink-0">
              <ConnectionStatus />
            </div>
            <Link
              to="/create"
              className={`hidden md:flex items-center gap-1.5 px-3 py-1.5 sm:px-4 sm:py-2 rounded-xl transition-all duration-200 text-sm font-medium shrink-0 whitespace-nowrap light-theme:bg-blue-100 light-theme:text-blue-900 light-theme:hover:bg-blue-200 ${
                steel
                  ? 'bg-gradient-to-r from-[#5d90f7] to-[#3d6fd0] text-white shadow-lg shadow-black/30 hover:brightness-110'
                  : 'bg-gradient-to-r from-blue-600 to-blue-700 hover:from-blue-500 hover:to-blue-600 shadow-lg shadow-blue-600/20 hover:shadow-blue-500/30'
              }`}
            >
              <Plus className="w-4 h-4 shrink-0" />
              <span className="hidden lg:inline">Create VM</span>
              <span className="lg:hidden">Create</span>
            </Link>
            {isAuthenticated && (
              <div
                className={`flex items-center gap-1 shrink-0 pl-1.5 sm:pl-2 ml-0.5 border-l light-theme:border-slate-300 ${
                  steel ? 'border-[rgba(140,160,190,0.2)]' : 'border-slate-700/60'
                }`}
              >
                <span
                  className={`hidden xl:flex text-xs items-center gap-1 max-w-[140px] 2xl:max-w-[200px] light-theme:text-slate-600 ${
                    steel ? 'text-[#9aa8b8]' : 'text-slate-400'
                  }`}
                  title={username || undefined}
                >
                  <User className="w-3 h-3 shrink-0" aria-hidden />
                  <span className="truncate">{username || 'Signed in'}</span>
                </span>
                <button
                  type="button"
                  onClick={() => void logout()}
                  className={`flex items-center gap-1 px-2 py-1.5 rounded-lg transition shrink-0 border light-theme:text-slate-700 light-theme:border-slate-300 light-theme:hover:bg-slate-100 ${
                    steel
                      ? 'text-[#cfd8e3] border-[rgba(140,160,190,0.25)] hover:bg-white/5 hover:text-white'
                      : 'text-slate-300 hover:bg-slate-700 hover:text-white border-slate-600/60 hover:border-slate-500'
                  }`}
                  title={username ? `Sign out (${username})` : 'Sign out'}
                  aria-label="Sign out"
                >
                  <LogOut className="w-4 h-4 shrink-0 light-theme:text-slate-500 hover:light-theme:text-red-500 text-slate-400 hover:text-red-400" />
                  <span className="text-[11px] sm:text-xs font-medium leading-none">Log out</span>
                </button>
              </div>
            )}
            <button
              type="button"
              className={`lg:hidden p-2 rounded-lg transition shrink-0 -mr-1 light-theme:text-slate-600 light-theme:hover:bg-slate-100 ${
                steel ? 'text-[#9aa8b8] hover:bg-white/5 hover:text-white' : 'hover:bg-slate-700/60'
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
          className={`lg:hidden border-t pb-4 animate-fade-in light-theme:bg-slate-50 light-theme:border-slate-200 ${
            steel ? 'border-[rgba(140,160,190,0.15)] nav-steel-dropdown' : 'border-slate-700/50 bg-slate-900/95 backdrop-blur-xl'
          }`}
        >
          <div className="app-shell pt-3 space-y-4">
            {navGroups.map((group) => (
              <div key={group.label}>
                <div className={`text-[10px] font-bold uppercase tracking-wider px-3 mb-1.5 light-theme:text-slate-600 ${
                  steel ? 'text-[#7f8b99]' : 'text-slate-500'
                }`}
                >
                  {group.label}
                </div>
                <div className="space-y-0.5">
                  {group.items.filter((item) => navItemVisible(item, username)).map((item) => (
                    <NavLink key={item.to} item={item} steel={steel} onClick={() => setMobileOpen(false)} />
                  ))}
                </div>
              </div>
            ))}
            <Link
              to="/create"
              onClick={() => setMobileOpen(false)}
              className={`flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl transition sm:hidden font-medium light-theme:bg-blue-100 light-theme:text-blue-900 ${
                steel ? 'bg-gradient-to-r from-[#5d90f7] to-[#3d6fd0] text-white' : 'bg-gradient-to-r from-blue-600 to-blue-700'
              }`}
            >
              <Plus className="w-4 h-4" />
              Create VM
            </Link>
            {isAuthenticated && (
              <button
                type="button"
                onClick={() => { setMobileOpen(false); void logout() }}
                className={`flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg transition text-sm w-full light-theme:bg-slate-200 light-theme:text-slate-900 light-theme:hover:bg-slate-300 ${
                  steel ? 'bg-white/5 text-[#cfd8e3] hover:bg-white/10' : 'bg-slate-800 hover:bg-slate-700 text-slate-300'
                }`}
              >
                <LogOut className="w-4 h-4" />
                Log out{username ? ` (${username})` : ''}
              </button>
            )}
          </div>
        </div>
      )}
    </nav>
  )
}
