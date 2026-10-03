// Copyright 2026 Zyvor AI Labs · https://zyvor.dev
// SPDX-License-Identifier: LicenseRef-Zyvor-Production-1.0

import { useEffect, useState } from 'react'
import { Link, useLocation } from 'react-router'
import { ArrowLeft } from 'lucide-react'
import { usePlatformInfo } from '../contexts/PlatformInfoContext'
import { shellLabel } from './shellBridgeUtils'

export { shellLabel } from './shellBridgeUtils'

/** Compact classic↔platform bridge — Settings owns Apps & Integrations. */
export default function ShellBridgeBar() {
  const { pathname } = useLocation()
  const { info, loading } = usePlatformInfo()
  const label = shellLabel(pathname)
  const fleetMode = Boolean(info?.control_plane?.proxy_url)
  const [stickyFleet, setStickyFleet] = useState(false)

  useEffect(() => {
    if (fleetMode) setStickyFleet(true)
  }, [fleetMode])

  if (!label) return null
  if (!stickyFleet && !fleetMode && !loading && info != null) return null

  return (
    <div
      className="shell-bridge-bar platform-space-banner px-4 py-1.5"
      role="navigation"
      aria-label="Return to Platform desktop"
    >
      <div className="flex items-center gap-3 max-w-[90rem] mx-auto">
        <p className="text-xs text-[var(--text-muted)] min-w-0 truncate">{label}</p>
        <Link
          to="/platform"
          className="platform-space-banner-link platform-space-banner-link-primary ml-auto shrink-0"
        >
          <ArrowLeft className="w-3.5 h-3.5" />
          Platform
        </Link>
      </div>
    </div>
  )
}
