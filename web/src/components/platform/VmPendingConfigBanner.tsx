// Copyright 2026 Zyvor AI Labs · https://zyvor.dev
// SPDX-License-Identifier: LicenseRef-Zyvor-Production-1.0

import { AlertTriangle, Power } from 'lucide-react'
import type { VmPendingConfig } from '../../api/platform'
import { MacGlassPanel } from './mac/PlatformMacUi'

interface VmPendingConfigBannerProps {
  pending: VmPendingConfig | null
  loading?: boolean
  onShutdown?: () => void
}

export default function VmPendingConfigBanner({ pending, loading, onShutdown }: VmPendingConfigBannerProps) {
  if (loading || !pending?.needs_shutdown) return null

  return (
    <div data-testid="vm-pending-config-banner">
    <MacGlassPanel title="Changes pending shutdown">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex gap-3">
          <AlertTriangle className="w-5 h-5 text-amber-400 shrink-0 mt-0.5" />
          <div>
            <p className="text-sm text-[var(--text-primary)]">
              Persistent configuration differs from the running guest. Shut down and start the VM to apply changes.
            </p>
            {pending.pending_changes.length > 0 && (
              <ul className="mt-2 text-xs text-[var(--text-muted)] space-y-1 list-disc list-inside">
                {pending.pending_changes.slice(0, 6).map((c) => (
                  <li key={`${c.category}-${c.summary}`}>
                    <span className="text-[var(--text-muted)] uppercase tracking-wide">{c.category}</span>
                    {' — '}
                    {c.summary}
                  </li>
                ))}
                {pending.pending_changes.length > 6 && (
                  <li>+{pending.pending_changes.length - 6} more</li>
                )}
              </ul>
            )}
          </div>
        </div>
        {onShutdown && (
          <button type="button" className="btn-secondary text-sm shrink-0" onClick={onShutdown}>
            <Power className="w-4 h-4" /> Shut down to apply
          </button>
        )}
      </div>
    </MacGlassPanel>
    </div>
  )
}
