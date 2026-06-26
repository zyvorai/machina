// Copyright (c) 2026 ZyvorAI Labs Private Limited. All rights reserved.

import { useEffect, useRef, useState } from 'react'
import { Outlet, useLocation, useNavigate, useSearchParams } from 'react-router'
import PlatformSidebar from '../components/platform/PlatformSidebar'
import PlatformControlCenter from '../components/platform/PlatformControlCenter'
import PlatformContextBar from '../components/platform/tahoe/PlatformContextBar'
import PlatformMobileJumpNav from '../components/platform/tahoe/PlatformMobileJumpNav'
import PlatformMacDock from '../components/platform/PlatformMacDock'
import { PlatformMacDesktopProvider, usePlatformMacDesktop } from '../components/platform/mac/PlatformMacDesktopContext'
import PlatformMacAppMenus from '../components/platform/mac/PlatformMacAppMenus'
import PopoutTitleBar from '../components/platform/mac/PopoutTitleBar'
import PlatformDynamicIsland from '../components/platform/mac/PlatformDynamicIsland'
import MissionControlOverlay from '../components/platform/MissionControlOverlay'
import { FleetDesktopProvider } from '../contexts/FleetDesktopContext'
import {
  MissionControlProvider,
  OPEN_MISSION_CONTROL_EVENT,
  useMissionControl,
} from '../components/platform/mac/MissionControlContext'
import {
  PLATFORM_WALLPAPER_EVENT,
  loadPlatformWallpaper,
  type PlatformWallpaper,
} from '../utils/platformWallpaper'
import { isCenterPopoutMode } from '../utils/platformCenterPopout'
import { platformPageLabel, upsertPlatformDesktopTab } from '../utils/platformDesktopTabs'
import { OPEN_PLATFORM_DOCK_EDITOR_EVENT } from '../utils/platformDockPins'
import { usePlatformDesktopTier } from '../hooks/usePlatformDesktopTier'
import PlatformDockEditor from '../components/platform/mac/PlatformDockEditor'
import { usePlatformTierRouteGuard } from '../hooks/usePlatformTierRouteGuard'
import { useKeyboardShortcut, isInputFocused } from '../hooks/useKeyboardShortcut'
import { suppressContextBar } from '../utils/platformNavRegistry'
import { contextNavForPath, shouldShowContextBar } from '../utils/platformContextNav'
import { dismissPlatformShellOverlays, dispatchScrollGeography } from '../utils/platformJarvisShell'

function PlatformDesktopShell() {
  const location = useLocation()
  const navigate = useNavigate()
  const [searchParams, setSearchParams] = useSearchParams()
  const isPopout = isCenterPopoutMode(location.search)
  const [wallpaper, setWallpaper] = useState<PlatformWallpaper>(() => loadPlatformWallpaper())
  const [dockEditorOpen, setDockEditorOpen] = useState(false)
  const { sidebarVisible, cinemaChromeHidden } = usePlatformMacDesktop()
  const [tier] = usePlatformDesktopTier()
  const { openMissionControl, closeMissionControl } = useMissionControl()
  usePlatformTierRouteGuard()

  const navEpoch = useRef(0)
  const cinemaRoute = location.pathname.includes('/consolehub') && cinemaChromeHidden
  const hideChrome = cinemaRoute
  const meshSubtle = location.pathname !== '/platform' && suppressContextBar(location.pathname)
  const contextBarVisible =
    !hideChrome
    && contextNavForPath(location.pathname, tier) != null
    && shouldShowContextBar(location.pathname, tier)

  useEffect(() => {
    const onWallpaper = () => setWallpaper(loadPlatformWallpaper())
    window.addEventListener(PLATFORM_WALLPAPER_EVENT, onWallpaper)
    return () => window.removeEventListener(PLATFORM_WALLPAPER_EVENT, onWallpaper)
  }, [])

  useEffect(() => {
    const open = () => setDockEditorOpen(true)
    window.addEventListener(OPEN_PLATFORM_DOCK_EDITOR_EVENT, open)
    return () => window.removeEventListener(OPEN_PLATFORM_DOCK_EDITOR_EVENT, open)
  }, [])

  useEffect(() => {
    const open = () => {
      const path = location.pathname.replace(/\/$/, '') || '/platform'
      if (path === '/platform') dispatchScrollGeography()
      else openMissionControl()
    }
    window.addEventListener(OPEN_MISSION_CONTROL_EVENT, open)
    return () => window.removeEventListener(OPEN_MISSION_CONTROL_EVENT, open)
  }, [openMissionControl, location.pathname])

  useEffect(() => {
    if (searchParams.get('mission') === '1') {
      const next = new URLSearchParams(searchParams)
      next.delete('mission')
      setSearchParams(next, { replace: true })
      const path = location.pathname.replace(/\/$/, '') || '/platform'
      if (path === '/platform') dispatchScrollGeography()
      else navigate('/platform#geography')
    }
  }, [searchParams, setSearchParams, location.pathname, navigate])

  useEffect(() => {
    try {
      if (sessionStorage.getItem('machina-open-mission') === '1') {
        openMissionControl()
      }
    } catch { /* ignore */ }
  }, [openMissionControl])

  useKeyboardShortcut({
    key: 'F3',
    handler: (e) => {
      if (isInputFocused()) return
      e.preventDefault()
      const path = location.pathname.replace(/\/$/, '') || '/platform'
      if (path === '/platform') {
        dispatchScrollGeography()
        return
      }
      openMissionControl()
    },
  })

  useKeyboardShortcut({
    key: 'ArrowUp',
    ctrl: true,
    handler: (e) => {
      if (isInputFocused()) return
      e.preventDefault()
      const path = location.pathname.replace(/\/$/, '') || '/platform'
      if (path === '/platform') {
        dispatchScrollGeography()
        return
      }
      openMissionControl()
    },
  })

  useEffect(() => {
    if (!location.pathname.startsWith('/platform')) return
    upsertPlatformDesktopTab({ path: location.pathname, label: platformPageLabel(location.pathname) })
  }, [location.pathname])

  useEffect(() => {
    if (!location.pathname.startsWith('/platform')) return
    if (navEpoch.current === 0) {
      navEpoch.current += 1
      return
    }
    closeMissionControl()
    setDockEditorOpen(false)
    dismissPlatformShellOverlays()
  }, [location.pathname, location.search, closeMissionControl])

  if (isPopout) {
    return (
      <div
        className="mac-desktop-root mac-popout-root platform-mac-desktop tahoe-page-root flex flex-col min-h-dvh"
        data-wallpaper={wallpaper}
      >
        <PopoutTitleBar title={platformPageLabel(location.pathname)} />
        <div className="tahoe-canvas relative flex-1">
          <div className="tahoe-mesh pointer-events-none" aria-hidden />
          <div className="relative z-[1] p-3 lg:p-4 platform-readable tahoe-readable-stack py-4 pb-8 platform-mac-scroll-body">
            <Outlet />
          </div>
        </div>
      </div>
    )
  }

  return (
    <div
      className="mac-desktop-root platform-mac-desktop tahoe-page-root flex flex-col min-h-dvh w-full"
      data-wallpaper={wallpaper}
      data-desktop-tier={tier}
      data-context-bar={contextBarVisible ? 'visible' : 'hidden'}
      data-cinema-chrome={hideChrome ? 'hidden' : undefined}
    >
      {!hideChrome ? (
        <header className="mac-menubar-inner glass shrink-0 sticky top-0 z-40 flex items-center gap-2 px-2 lg:px-3 h-11 overflow-visible">
          <div className="flex items-center min-w-0 shrink-0 overflow-visible z-[400]">
            <PlatformMacAppMenus />
          </div>
          <div className="flex-1 flex justify-center min-w-0 pointer-events-none">
            <PlatformDynamicIsland />
          </div>
          <div className="ml-auto shrink-0 flex items-center gap-2 z-[400]">
            <PlatformControlCenter />
          </div>
        </header>
      ) : null}

      {contextBarVisible ? <PlatformContextBar /> : null}
      {!hideChrome ? <PlatformMobileJumpNav /> : null}

      <div className="flex w-full flex-1 items-stretch min-h-0">
        {sidebarVisible && !hideChrome ? <PlatformSidebar /> : null}
        <div className="tahoe-canvas mac-desktop-main flex-1 min-w-0 relative min-h-0">
          {!hideChrome ? <div className={`tahoe-mesh pointer-events-none${meshSubtle ? ' tahoe-mesh-subtle' : ''}`} aria-hidden /> : null}
          <div className={`relative z-[1] w-full platform-mac-scroll-body ${hideChrome ? 'p-0 max-w-none h-full min-h-0' : 'px-4 lg:px-6 pt-1 pb-16 lg:pb-24 max-w-[160rem] mx-auto'}`}>
            <div className={hideChrome ? 'h-full min-h-0' : 'platform-readable tahoe-readable-stack py-3 pb-8'}>
              <Outlet />
            </div>
          </div>
        </div>
      </div>

      {!hideChrome ? <PlatformMacDock /> : null}
      <PlatformDockEditor open={dockEditorOpen} onClose={() => setDockEditorOpen(false)} />
      <MissionControlOverlay />
    </div>
  )
}

export default function PlatformLayout() {
  return (
    <FleetDesktopProvider>
      <MissionControlProvider>
        <PlatformMacDesktopProvider>
          <PlatformDesktopShell />
        </PlatformMacDesktopProvider>
      </MissionControlProvider>
    </FleetDesktopProvider>
  )
}
