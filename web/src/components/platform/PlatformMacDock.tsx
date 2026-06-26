// Copyright (c) 2026 ZyvorAI Labs Private Limited. All rights reserved.

import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Link, useLocation, useNavigate } from 'react-router'
import { Search, Sparkles } from 'lucide-react'
import { useAi } from '../../contexts/AiContext'
import { unlockDockPreviewPath, usePlatformDockItems } from '../../utils/platformDockPins'
import { useToastContext } from '../../contexts/ToastContext'
import { platformDesktopTabActive, platformDesktopTabGroup } from '../../utils/platformDesktopTabs'
import { dispatchOpenSpotlight } from '../../utils/platformJarvisShell'
import { useMissionControl } from './mac/MissionControlContext'
import { useFleetDesktop } from '../../hooks/useFleetDesktop'
import { getFleetFinder } from '../../api/platform'
import { useLaunchpadDockApps } from '../../hooks/useLaunchpadDockApps'
import { gradientForName } from './mac/PlatformMacUi'
import { openLaunchpadApp } from '../../utils/launchpadHelpers'

function isPlatformShell(pathname: string): boolean {
  return pathname.startsWith('/platform')
}

export default function PlatformMacDock() {
  const location = useLocation()
  const navigate = useNavigate()
  const toast = useToastContext()
  const { openCopilot } = useAi()
  const { closeMissionControl } = useMissionControl()
  const dockItems = usePlatformDockItems()
  const launchpadFavorites = useLaunchpadDockApps(4)
  const { desktop } = useFleetDesktop()
  const [mounted, setMounted] = useState(false)
  const [dockVisible, setDockVisible] = useState(true)
  const [attentionByPath, setAttentionByPath] = useState<Record<string, number>>({})
  const hideTimerRef = useRef<number | null>(null)
  const autoHide = isPlatformShell(location.pathname)

  useEffect(() => {
    setMounted(true)
  }, [])

  useEffect(() => {
    void getFleetFinder()
      .then((f) => {
        const unprotected = f?.smart_folders.find((x) => x.id === 'unprotected')?.count ?? 0
        const needs = f?.smart_folders.find((x) => x.id === 'needs_attention')?.count ?? 0
        setAttentionByPath({
          '/platform/vms': needs || unprotected,
        })
      })
      .catch(() => setAttentionByPath({}))
  }, [location.pathname])

  useEffect(() => {
    if (!autoHide) {
      setDockVisible(true)
      return
    }

    const scheduleHide = () => {
      if (hideTimerRef.current) window.clearTimeout(hideTimerRef.current)
      hideTimerRef.current = window.setTimeout(() => setDockVisible(false), 2800)
    }

    const onMove = (e: MouseEvent) => {
      const nearBottom = window.innerHeight - e.clientY < 56
      if (nearBottom) {
        setDockVisible(true)
        scheduleHide()
      }
    }

    scheduleHide()
    window.addEventListener('mousemove', onMove)
    return () => {
      window.removeEventListener('mousemove', onMove)
      if (hideTimerRef.current) window.clearTimeout(hideTimerRef.current)
    }
  }, [autoHide, location.pathname])

  const goDock = (path: string) => {
    closeMissionControl()
    const hub = platformDesktopTabGroup(path)
    navigate(hub)
  }

  const cpuPct = desktop?.pressure_hosts != null ? Math.min(99, desktop.pressure_hosts * 12 + 8) : null
  const memPct = desktop?.hosts_total ? Math.round((desktop.hosts_online / Math.max(1, desktop.hosts_total)) * 67) : null

  const dock = (
    <footer
      className={`mac-dock flex ${autoHide ? 'mac-dock-autohide' : ''} ${autoHide && !dockVisible ? 'mac-dock-hidden' : ''}`}
      role="navigation"
      aria-label="Platform dock"
    >
      {(cpuPct != null || memPct != null) && (
        <div className="mac-dock-stats hidden lg:flex items-center gap-2 text-[10px] text-slate-400 mr-2 pointer-events-none">
          <span>CPU {cpuPct ?? '—'}%</span>
          <span>·</span>
          <span>MEM {memPct ?? '—'}%</span>
        </div>
      )}
      <div className="mac-dock-inner mac-dock-inner-scroll">
        {dockItems.map((item) => {
          const Icon = item.icon
          const active = !item.preview && platformDesktopTabActive(location.pathname, item.path)
          const attention = attentionByPath[item.path] ?? 0
          const cls = `mac-dock-item ${active ? 'mac-dock-item-active' : ''} ${item.preview ? 'mac-dock-item-preview' : ''}`
          if (item.preview) {
            return (
              <button
                key={`preview-${item.path}`}
                type="button"
                title={`${item.label} — Power user`}
                aria-label={`${item.label} preview`}
                className={cls}
                onClick={() => {
                  if (unlockDockPreviewPath(item.path)) {
                    toast.success('Switched to Power user — hub unlocked')
                    navigate(item.path)
                  }
                }}
              >
                <Icon className="h-6 w-6" strokeWidth={1.75} />
                <span className="mac-dock-tooltip">{item.label}</span>
              </button>
            )
          }
          const hub = platformDesktopTabGroup(item.path)
          return (
            <Link
              key={item.path}
              to={hub}
              title={item.label}
              aria-label={item.label}
              className={cls}
              aria-current={active ? 'page' : undefined}
              onClick={(e) => {
                if (location.pathname === hub) return
                e.preventDefault()
                goDock(item.path)
              }}
            >
              <Icon className="h-6 w-6" strokeWidth={1.75} />
              <span className="mac-dock-tooltip">{item.label}</span>
              {active ? <span className="mac-dock-dot" aria-hidden /> : null}
              {attention > 0 ? <span className="mac-dock-attention-dot" aria-label={`${attention} need attention`} /> : null}
            </Link>
          )
        })}

        {launchpadFavorites.length > 0 ? (
          <>
            <div className="mac-dock-divider" aria-hidden />
            {launchpadFavorites.map((app) => (
              <button
                key={`launchpad-${app.id}`}
                type="button"
                title={app.displayName}
                aria-label={`Open ${app.displayName}`}
                className="mac-dock-item mac-dock-launchpad-app"
                onClick={() => void openLaunchpadApp(app)}
              >
                <span
                  className={`w-8 h-8 rounded-[22%] bg-gradient-to-br ${gradientForName(app.displayName)} flex items-center justify-center text-white text-xs font-bold shadow-md`}
                >
                  {app.displayName.trim().charAt(0).toUpperCase()}
                </span>
                <span className="mac-dock-tooltip">{app.displayName}</span>
              </button>
            ))}
          </>
        ) : null}

        <div className="mac-dock-divider" aria-hidden />

        <button
          type="button"
          onClick={openCopilot}
          className="mac-dock-spotlight mac-dock-ask"
          title="Ask Zeus"
          aria-label="Ask Zeus"
        >
          <Sparkles className="h-4 w-4" />
          <span className="mac-dock-spotlight-label hidden xl:inline">Zeus</span>
        </button>

        <button
          type="button"
          onClick={() => dispatchOpenSpotlight()}
          className="mac-dock-spotlight"
          title="Spotlight (⌘Space)"
          aria-label="Open Spotlight"
        >
          <Search className="h-4 w-4" />
          <span className="mac-dock-spotlight-label hidden xl:inline">Spotlight</span>
        </button>
      </div>
    </footer>
  )

  if (!mounted) return null
  return createPortal(dock, document.body)
}
