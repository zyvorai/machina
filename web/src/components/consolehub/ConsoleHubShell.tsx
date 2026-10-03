// Copyright 2026 Zyvor AI Labs · https://zyvor.dev
// SPDX-License-Identifier: LicenseRef-Zyvor-Production-1.0

import type { ReactNode } from 'react'
import { RefreshCw, ExternalLink, Power } from 'lucide-react'
import PageLayout from '../PageLayout'

type Props = {
  title: string
  subtitle?: ReactNode
  vmState?: string
  guestIp?: string
  nodeName?: string
  loading?: boolean
  error?: string | null
  errorHints?: string[]
  onReconnect?: () => void
  onPopout?: () => void
  errorActions?: ReactNode
  prepend?: ReactNode
  protocolPicker?: ReactNode
  sessionInfo?: ReactNode
  children: ReactNode
}

export default function ConsoleHubShell({
  title,
  subtitle,
  vmState,
  guestIp,
  nodeName,
  loading,
  error,
  errorHints,
  onReconnect,
  onPopout,
  errorActions,
  prepend,
  protocolPicker,
  sessionInfo,
  children,
}: Props) {
  return (
    <PageLayout
      compact
      loading={loading}
      title={title}
      subtitle={
        subtitle ?? (
          <span className="text-[var(--text-muted)] flex flex-wrap gap-3 text-xs">
            <span>Zyra ConsoleHub</span>
            {vmState ? <span className="inline-flex items-center gap-1"><Power className="w-3 h-3" />{vmState}</span> : null}
            {nodeName ? <span>Node: {nodeName}</span> : null}
            {guestIp ? <span className="font-mono text-emerald-600/90">{guestIp}</span> : null}
          </span>
        )
      }
      prepend={prepend}
      actions={
        <div className="flex flex-wrap items-center gap-2">
          {onReconnect ? (
            <button type="button" className="btn-secondary text-sm inline-flex items-center gap-1" onClick={onReconnect}>
              <RefreshCw className="w-4 h-4" /> Reconnect
            </button>
          ) : null}
          {onPopout ? (
            <button type="button" className="btn-secondary text-sm inline-flex items-center gap-1" onClick={onPopout}>
              <ExternalLink className="w-4 h-4" /> Pop out
            </button>
          ) : null}
        </div>
      }
      error={error}
      errorHints={errorHints}
      onErrorRetry={onReconnect}
    >
      {error && errorActions ? <div className="mb-3">{errorActions}</div> : null}
      {protocolPicker}
      <div className="flex flex-col flex-1 min-h-0">{children}</div>
      {sessionInfo ? (
        <div className="mt-3 pt-3 border-t border-slate-800/80 text-xs text-[var(--text-muted)]">{sessionInfo}</div>
      ) : null}
    </PageLayout>
  )
}
