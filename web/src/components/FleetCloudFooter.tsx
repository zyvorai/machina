// Copyright 2026 Zyvor AI Labs · https://zyvor.dev
// SPDX-License-Identifier: LicenseRef-Zyvor-Production-1.0

import { ExternalLink } from 'lucide-react'
import { Link } from 'react-router'
import { usePlatformInfo } from '../contexts/PlatformInfoContext'

/** Shared footer for Fleet Cloud pages: disk migration + optional HyperSDK dashboard. */
export default function FleetCloudFooter() {
  const { info } = usePlatformInfo()

  return (
    <footer className="rounded-2xl border border-[var(--apple-hairline)] bg-[var(--apple-surface)]/50 bg-[var(--apple-fill-tertiary)] px-4 py-3 text-xs text-[var(--text-muted)] space-y-2">
      <p>
        Push qcow2 from{' '}
        <Link to="/disk-images" className="text-[var(--link)] hover:underline">Disk images</Link>
        . Import exported disks via{' '}
        <Link to="/import" className="text-[var(--link)] hover:underline">Import VM</Link>.
      </p>
      {info?.hypersdk?.enabled && (
        <p>
          <a
            href={
              info?.hypersdk?.base_url
                ? `${info.hypersdk.base_url.replace(/\/$/, '')}/web/dashboard/`
                : `https://${window.location.hostname}:5080/web/dashboard/`
            }
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1 text-[var(--link)] hover:underline"
          >
            HyperSDK dashboard — bulk export and migrations
            <ExternalLink className="w-3 h-3" />
          </a>
        </p>
      )}
    </footer>
  )
}
