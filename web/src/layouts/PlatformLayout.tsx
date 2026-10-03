// Copyright 2026 Zyvor AI Labs · https://zyvor.dev
// SPDX-License-Identifier: LicenseRef-Zyvor-Production-1.0

import { useEffect, useRef, useState } from 'react'
import { Outlet, useLocation, useNavigate, useSearchParams } from 'react-router'
import GlobalBar from '../components/nav/GlobalBar'
import ChapterBar from '../components/nav/ChapterBar'
import SideNav from '../components/nav/SideNav'
import { PlatformMacDesktopProvider, usePlatformMacDesktop } from '../components/platform/mac/PlatformMacDesktopContext'
import PopoutTitleBar from '../components/platform/mac/PopoutTitleBar'
import MissionControlOverlay from '../components/platform/MissionControlOverlay'
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
import { usePlatformDesktopTier } from '../hooks/usePlatformDesktopTier'
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
  const { sidebarVisible, cinemaChromeHidden, toggleSidebar } = usePlatformMacDesktop()
  const [tier] = usePlatformDesktopTier()
  const { openMissionControl, closeMissionControl } = useMissionControl()
  const [mobileNavOpen, setMobileNavOpen] = useState(false)

  const navEpoch = useRef(0)
  const cinemaRoute = location.pathname.includes('/consolehub') && cinemaChromeHidden
  const hideChrome = cinemaRoute
  const platformHome =
    location.pathname === '/platform' || location.pathname.replace(/\/$/, '') === '/platform'
  const meshSubtle = location.pathname !== '/platform' && suppressContextBar(location.pathname)
  const contextBarVisible =
    !hideChrome
    && !platformHome
    && contextNavForPath(location.pathname, tier) != null
    && shouldShowContextBar(location.pathname, tier)

  useEffect(() => {
    const onWallpaper = () => setWallpaper(loadPlatformWallpaper())
    window.addEventListener(PLATFORM_WALLPAPER_EVENT, onWallpaper)
    return () => window.removeEventListener(PLATFORM_WALLPAPER_EVENT, onWallpaper)
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

  // The "Machina" dropdown advertises these as ⌘, and ⌘⌥S, but until now neither had a live
  // accelerator anywhere in the current shell — the only matching keydown handler lived in the
  // orphaned PlatformMacAppMenus.tsx, deleted along with the rest of the dead mac-shell components.
  useKeyboardShortcut({
    key: ',',
    meta: true,
    handler: () => navigate('/platform/settings'),
  })

  useKeyboardShortcut({
    key: 's',
    meta: true,
    alt: true,
    handler: () => toggleSidebar(),
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
      {!hideChrome ? <GlobalBar onBurger={() => setMobileNavOpen((v) => !v)} /> : null}
      {contextBarVisible ? <ChapterBar /> : null}

      <div className="flex w-full flex-1 items-stretch min-h-0">
        {/* `sidebarVisible` (⌘⌥S) is a desktop preference; keep rendering on mobileNavOpen too so
            the burger button (always visible) never opens a drawer for a component that isn't
            there — hiding the sidebar on desktop must not strand mobile users with no nav at all. */}
        {(sidebarVisible || mobileNavOpen) && !hideChrome ? (
          <SideNav mobileOpen={mobileNavOpen} onCloseMobile={() => setMobileNavOpen(false)} />
        ) : null}
        <div className="tahoe-canvas mac-desktop-main flex-1 min-w-0 relative min-h-0">
          {!hideChrome ? <div className={`tahoe-mesh pointer-events-none${meshSubtle ? ' tahoe-mesh-subtle' : ''}`} aria-hidden /> : null}
          <div
            className={
              hideChrome
                ? 'relative z-[1] w-full platform-mac-scroll-body p-0 max-w-none h-full min-h-0'
                : platformHome
                  ? 'relative z-[1] w-full platform-mac-scroll-body px-3 sm:px-4 lg:px-5 xl:px-6 pt-1 pb-20 max-w-none'
                  : 'relative z-[1] w-full platform-mac-scroll-body px-4 lg:px-6 pt-1 pb-16 lg:pb-24 max-w-[160rem] mx-auto'
            }
          >
            <div
              className={
                hideChrome
                  ? 'h-full min-h-0'
                  : platformHome
                    ? 'w-full min-w-0 py-2 pb-8'
                    : 'platform-readable tahoe-readable-stack py-3 pb-8'
              }
            >
              <Outlet />
            </div>
          </div>
        </div>
      </div>

      <MissionControlOverlay />
    </div>
  )
}

export default function PlatformLayout() {
  return (
    <MissionControlProvider>
      <PlatformMacDesktopProvider>
        <PlatformDesktopShell />
      </PlatformMacDesktopProvider>
    </MissionControlProvider>
  )
}
