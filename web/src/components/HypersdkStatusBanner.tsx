// Copyright 2026 Zyvor AI Labs · https://zyvor.dev
// SPDX-License-Identifier: LicenseRef-Zyvor-Production-1.0

import { Link } from 'react-router'
import { ExternalLink, RefreshCw } from 'lucide-react'
import { useState } from 'react'
import { useHypersdkConnection } from '../hooks/useHypersdkConnection'
import { useToastContext } from '../contexts/ToastContext'
import ErrorBanner from './ErrorBanner'
import { formatUserError } from '../utils/apiError'
import { statusSurfaceClasses, statusToneClass } from '../utils/semanticColors'

type Props = {
  title?: string
  compact?: boolean
}

/** Shown when HyperSDK is enabled in config but hypervisord is not reachable. */
export default function HypersdkStatusBanner({ title = 'HyperSDK unavailable', compact }: Props) {
  const { phase, status, refresh, baseUrl } = useHypersdkConnection()
  const toast = useToastContext()
  const [testing, setTesting] = useState(false)

  if (phase === 'off' || phase === 'live') return null

  const dashboardUrl = baseUrl
    ? `${baseUrl.replace(/\/$/, '')}/web/dashboard/`
    : `https://${window.location.hostname}:5080/web/dashboard/`

  if (compact) {
    return (
      <p className={`text-xs rounded-lg px-3 py-2 ${statusSurfaceClasses('warn')}`}>
        HyperSDK is enabled but not reachable
        {status?.last_error ? `: ${status.last_error}` : ''}. Check hypervisord on the host.
      </p>
    )
  }

  return (
    <ErrorBanner
      title={title}
      headline={
        status?.last_error ||
        'machina-daemon cannot reach hypervisord — bulk migrations and hyper2kvm deploy paths need it.'
      }
      hints={[
        'Confirm hypervisord is running and `[hypersdk] base_url` in /etc/machina/config.toml is correct.',
        'Open firewall between machina-daemon and the HyperSDK listen port (often 5080).',
        'Use the HyperSDK dashboard directly if the daemon is up but the proxy fails.',
      ]}
      tone="amber"
      actions={
        <>
          <button
            type="button"
            disabled={testing}
            onClick={async () => {
              setTesting(true)
              try {
                const s = await refresh()
                toast.success(s?.reachable ? 'HyperSDK OK' : 'Still unreachable — check hypervisord')
              } catch (e: unknown) {
                toast.error(formatUserError(e))
              } finally {
                setTesting(false)
              }
            }}
            className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg border text-xs disabled:opacity-50 ${statusSurfaceClasses('warn', 'hover:opacity-90')}`}
          >
            <RefreshCw className={`w-3.5 h-3.5 ${testing ? 'animate-spin' : ''}`} />
            Retry
          </button>
          <a
            href={dashboardUrl}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg border border-[var(--apple-hairline)] text-[var(--text-secondary)] hover:bg-[var(--apple-fill-tertiary)] text-xs"
          >
            HyperSDK dashboard
            <ExternalLink className="w-3 h-3" />
          </a>
          <Link
            to="/settings"
            className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg border border-[var(--apple-hairline)] text-[var(--text-secondary)] hover:bg-[var(--apple-fill-tertiary)] text-xs"
          >
            Settings
          </Link>
        </>
      }
    />
  )
}
