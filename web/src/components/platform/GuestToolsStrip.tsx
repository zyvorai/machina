// Copyright (c) 2026 ZyvorAI Labs Private Limited. All rights reserved.

import { useState } from 'react'
import { AlertTriangle, Download, X } from 'lucide-react'
import { statusSurfaceClasses, statusToneClass } from '../../utils/semanticColors'

const DISMISS_KEY = 'machina_guest_tools_strip_dismissed'

export default function GuestToolsStrip({
  status,
  guestIp,
  guestHostname,
  vmId,
  onInstall,
  installing,
  compact,
}: {
  status?: string
  guestIp?: string
  guestHostname?: string
  vmId?: string
  onInstall?: () => void
  installing?: boolean
  compact?: boolean
}) {
  const healthy = status === 'healthy' || status === 'installed'
  const dismissId = vmId ? `${DISMISS_KEY}:${vmId}` : DISMISS_KEY
  const [dismissed, setDismissed] = useState(() => {
    try {
      return localStorage.getItem(dismissId) === '1'
    } catch {
      return false
    }
  })

  if (healthy || dismissed) return null

  const dismiss = () => {
    setDismissed(true)
    try {
      localStorage.setItem(dismissId, '1')
    } catch { /* private mode */ }
  }

  if (compact) {
    return (
      <div className={`rounded-lg border px-3 py-2 flex flex-wrap items-center justify-between gap-2 text-xs ${statusSurfaceClasses('warn')}`}>
        <span className={`flex items-center gap-2 ${statusToneClass('warn')}`}>
          <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
          Guest tools not installed — IP reporting and graceful shutdown unavailable.
        </span>
        <div className="flex items-center gap-2">
          {onInstall && (
            <button type="button" className="btn-secondary text-xs py-1 px-2" disabled={installing} onClick={onInstall}>
              {installing ? 'Installing…' : 'Install'}
            </button>
          )}
          <button type="button" className="p-1 text-slate-500 hover:text-slate-300" onClick={dismiss} aria-label="Dismiss">
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className={`rounded-xl border p-4 flex flex-wrap items-center justify-between gap-3 ${statusSurfaceClasses('warn')}`}>
      <div className="flex items-center gap-3 min-w-0">
        <AlertTriangle className={`w-5 h-5 shrink-0 ${statusToneClass('warn')}`} />
        <div className="min-w-0">
          <p className="font-medium text-sm text-slate-100">Install Zyvor Guest Tools</p>
          <p className="text-xs text-slate-400 mt-0.5">
            Enables graceful shutdown, guest IP in inventory, app-consistent backups, and in-VM health checks.
          </p>
          {(guestIp || guestHostname) && (
            <p className="text-xs text-slate-500 mt-1">
              {guestHostname && <span>{guestHostname} · </span>}
              {guestIp && <span>{guestIp}</span>}
            </p>
          )}
        </div>
      </div>
      <div className="flex items-center gap-2 shrink-0">
        {onInstall && (
          <button type="button" className="btn-secondary text-xs flex items-center gap-1" disabled={installing} onClick={onInstall}>
            <Download className="w-3 h-3" /> {installing ? 'Installing…' : 'Install tools'}
          </button>
        )}
        <button type="button" className="btn-secondary text-xs" onClick={dismiss}>Dismiss</button>
      </div>
    </div>
  )
}
