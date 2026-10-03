// Copyright 2026 Zyvor AI Labs · https://zyvor.dev
// SPDX-License-Identifier: LicenseRef-Zyvor-Production-1.0

import { Link } from 'react-router'

type Props = {
  onCreateVm: () => void
}

const DESTINATIONS: Array<{
  id: string
  label: string
  subtitle: string
  href?: string
  action?: 'create'
}> = [
  { id: 'finder', label: 'Machine Finder', subtitle: 'Inventory, power, migrate', href: '/platform/vms' },
  { id: 'create', label: 'Create a VM', subtitle: 'Four steps from image to boot', action: 'create' },
  { id: 'live-wall', label: 'Live Preview Wall', subtitle: 'Live VNC thumbnails of running VMs', href: '/platform/mission-control/live' },
  { id: 'security', label: 'Security', subtitle: 'Firewall, risk, compliance', href: '/platform/zeus/security' },
  { id: 'recovery', label: 'Recovery', subtitle: 'Snapshots and backups', href: '/platform/backups' },
  { id: 'templates', label: 'Templates', subtitle: 'Golden images', href: '/platform/templates' },
  { id: 'network', label: 'Network', subtitle: 'Path and topology', href: '/platform/network-canvas' },
]

export default function MissionControlLaunchpad({ onCreateVm }: Props) {
  return (
    <section className="apple-section" data-testid="mission-control-launchpad">
      <p className="apple-eyebrow">Explore</p>
      <h2 className="apple-display apple-display--sm">Operations</h2>
      <p className="apple-lede">A few places that matter. Everything else is one search away.</p>

      <ul className="apple-dest-list">
        {DESTINATIONS.map((d) => {
          const body = (
            <>
              <span className="min-w-0">
                <span className="apple-dest-title block">{d.label}</span>
                <span className="apple-dest-sub block">{d.subtitle}</span>
              </span>
              <span className="apple-dest-chevron" aria-hidden>
                ›
              </span>
            </>
          )
          return (
            <li key={d.id}>
              {d.action === 'create' ? (
                <button type="button" className="apple-dest-row" onClick={onCreateVm}>
                  {body}
                </button>
              ) : (
                <Link to={d.href!} className="apple-dest-row">
                  {body}
                </Link>
              )}
            </li>
          )
        })}
      </ul>
    </section>
  )
}
