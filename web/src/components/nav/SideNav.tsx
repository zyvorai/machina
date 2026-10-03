// Copyright 2026 Zyvor AI Labs · https://zyvor.dev
// SPDX-License-Identifier: LicenseRef-Zyvor-Production-1.0

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { NavLink, useLocation } from 'react-router'
import { Compass, LayoutGrid, Settings, type LucideIcon } from 'lucide-react'
import { getFleetFinder } from '../../api/platform'
import { usePlatformInfo } from '../../contexts/PlatformInfoContext'
import { usePlatformDesktopTier } from '../../hooks/usePlatformDesktopTier'
import { integrationNavItems } from '../../utils/platformIntegrationsNav'
import {
  sidebarProductSectionsForTier,
  type SidebarProductSection,
  type SidebarRailItem,
} from '../../utils/platformSidebarNav'
import { navItemActive } from '../../utils/routes'
import PlatformSidebarSection from '../platform/PlatformSidebarSection'

// The top-nav mega-menu covers every route; this sidebar is a fast, always-expanded
// path to the categories people use most — Workloads/Infra/Ops/Secure — pulled from
// the same live registry (sidebarProductSectionsForTier) so it never drifts out of
// sync with the GlobalBar flyouts. Admin/More stay top-nav-only to keep this list
// from growing unbounded.
const RAIL_SECTION_IDS = ['workloads', 'infra', 'ops', 'secure']

const OVERVIEW: SidebarRailItem[] = [
  { to: '/platform', label: 'Mission Control', icon: LayoutGrid },
  { to: '/platform/hosts/finder', label: 'Machine Finder', icon: Compass },
]

const SECTION_COLLAPSE_PREFIX = 'machina-sidenav-'

function loadSectionExpanded(id: string): boolean {
  try {
    const raw = localStorage.getItem(`${SECTION_COLLAPSE_PREFIX}${id}`)
    if (raw === '0') return false
    if (raw === '1') return true
  } catch {
    /* ignore */
  }
  return true
}

function SideLink({
  item,
  isActive,
  badge,
  end,
}: {
  item: SidebarRailItem
  isActive: boolean
  badge?: number
  end?: boolean
}) {
  const Icon = item.icon
  return (
    <NavLink
      to={item.to}
      end={end}
      title={item.label}
      aria-label={item.label}
      className={`gnb-side-link flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-sm transition-all duration-200 ${
        isActive
          ? 'gnb-side-link-active text-[var(--text-primary)]'
          : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--surface-hover,rgba(255,255,255,0.04))]'
      }`}
    >
      <span className="gnb-side-icon relative shrink-0" aria-hidden>
        <Icon className="h-[1.15rem] w-[1.15rem]" strokeWidth={1.5} />
        {badge ? <i className="gnb-side-dot" /> : null}
      </span>
      <span className="truncate flex-1">{item.label}</span>
      {badge ? <span className="gnb-side-count">{badge}</span> : null}
    </NavLink>
  )
}

export default function SideNav({ mobileOpen, onCloseMobile }: { mobileOpen: boolean; onCloseMobile: () => void }) {
  const location = useLocation()
  const [tier] = usePlatformDesktopTier()
  const { info } = usePlatformInfo()
  const integrations = integrationNavItems(info)
  const allSections = useMemo(
    () => sidebarProductSectionsForTier(tier, integrations),
    [tier, integrations],
  )
  const sections = useMemo(
    () => allSections.filter((s) => RAIL_SECTION_IDS.includes(s.id)),
    [allSections],
  )
  const [sectionExpanded, setSectionExpanded] = useState<Record<string, boolean>>(() =>
    Object.fromEntries(sections.map((s) => [s.id, loadSectionExpanded(s.id)])),
  )
  const [vmsNeedAttention, setVmsNeedAttention] = useState(0)

  useEffect(() => {
    void getFleetFinder()
      .then((f) => {
        const needs = f?.smart_folders.find((x) => x.id === 'needs_attention')?.count ?? 0
        setVmsNeedAttention(needs)
      })
      .catch(() => setVmsNeedAttention(0))
  }, [])

  // Skip the first run: this effect closes the drawer on navigation, but SideNav can now mount
  // *because* the mobile drawer just opened (PlatformLayout renders it on `mobileNavOpen` even
  // when the desktop "hide sidebar" preference is on) — without this guard, that initial mount
  // immediately called onCloseMobile() and closed the drawer it had just opened.
  const skippedFirstPathEffect = useRef(false)
  useEffect(() => {
    if (!skippedFirstPathEffect.current) {
      skippedFirstPathEffect.current = true
      return
    }
    onCloseMobile()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [location.pathname])

  const toggleSection = useCallback((id: string) => {
    setSectionExpanded((prev) => {
      const next = !(prev[id] ?? true)
      try {
        localStorage.setItem(`${SECTION_COLLAPSE_PREFIX}${id}`, next ? '1' : '0')
      } catch {
        /* ignore */
      }
      return { ...prev, [id]: next }
    })
  }, [])

  const badgeFor = (to: string) => (to === '/platform/vms' ? vmsNeedAttention : 0)

  return (
    <>
      <aside
        className={`gnb-side gnb-side--expanded flex flex-col shrink-0 border-r border-[var(--apple-hairline)] ${mobileOpen ? 'gnb-side-mobile-open' : ''}`}
        aria-label="Sections"
      >
        <SideNavBody
          sections={sections}
          sectionExpanded={sectionExpanded}
          toggleSection={toggleSection}
          badgeFor={badgeFor}
          location={location}
        />
        <div className="gnb-side-footer border-t border-[var(--apple-hairline)] p-2">
          <NavLink to="/platform/settings" className="gnb-side-link flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-sm text-[var(--text-secondary)]">
            <Settings className="h-[1.15rem] w-[1.15rem]" strokeWidth={1.5} />
            <span>Settings</span>
          </NavLink>
        </div>
      </aside>
      {mobileOpen ? <div className="gnb-scrim gnb-scrim-mobile-only" onClick={onCloseMobile} /> : null}
    </>
  )
}

function SideNavBody({
  sections,
  sectionExpanded,
  toggleSection,
  badgeFor,
  location,
}: {
  sections: SidebarProductSection[]
  sectionExpanded: Record<string, boolean>
  toggleSection: (id: string) => void
  badgeFor: (to: string) => number
  location: ReturnType<typeof useLocation>
}) {
  const sectionHasActive = (section: SidebarProductSection) =>
    section.items.some((item) =>
      navItemActive({ to: item.to, label: item.label, icon: null }, location.pathname, location.search),
    )

  return (
    <nav className="flex-1 min-h-0 overflow-y-auto overscroll-contain py-2 px-1.5 space-y-1">
      <ul className="space-y-0.5">
        {OVERVIEW.map((item) => (
          <li key={item.to}>
            <SideLink
              item={item}
              end={item.to === '/platform'}
              isActive={navItemActive({ to: item.to, label: item.label, icon: null }, location.pathname, location.search)}
            />
          </li>
        ))}
      </ul>

      <div className="gnb-side-divider mx-1 my-2" aria-hidden />

      {sections.map((section: SidebarProductSection) => (
        <PlatformSidebarSection
          key={section.id}
          label={section.label}
          icon={section.icon as LucideIcon}
          collapsed={false}
          expanded={sectionExpanded[section.id] ?? true}
          onToggleExpanded={() => toggleSection(section.id)}
          hasActiveItem={sectionHasActive(section)}
          flyoutItems={null}
        >
          <ul className="space-y-0.5 mb-2">
            {section.items.map((item) => (
              <li key={item.to}>
                <SideLink
                  item={item}
                  isActive={navItemActive({ to: item.to, label: item.label, icon: null }, location.pathname, location.search)}
                  badge={badgeFor(item.to)}
                />
              </li>
            ))}
          </ul>
        </PlatformSidebarSection>
      ))}
    </nav>
  )
}
