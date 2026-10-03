// Copyright 2026 Zyvor AI Labs · https://zyvor.dev
// SPDX-License-Identifier: LicenseRef-Zyvor-Production-1.0

import { Link } from 'react-router'
import { MacGlassPanel, LaunchpadAppIcon } from '../mac/PlatformMacUi'

export type HubTile = {
  to: string
  label: string
  icon: React.ReactNode
}

export type HubGroup = {
  label: string
  subtitle?: string
  tiles: HubTile[]
}

export default function PlatformHubLaunchpad({ groups }: { groups: HubGroup[] }) {
  return (
    <div className="space-y-5">
      {groups.map((group) => (
        <MacGlassPanel key={group.label} title={group.label} subtitle={group.subtitle}>
          <div className="platform-launchpad-grid grid grid-cols-3 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6 gap-x-4 gap-y-8 -mt-1">
            {group.tiles.map((tile) => (
              <Link key={tile.to} to={tile.to} className="block">
                <LaunchpadAppIcon name={tile.label} icon={tile.icon} />
              </Link>
            ))}
          </div>
        </MacGlassPanel>
      ))}
    </div>
  )
}
