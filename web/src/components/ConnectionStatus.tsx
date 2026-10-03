// Copyright 2026 Zyvor AI Labs · https://zyvor.dev
// SPDX-License-Identifier: LicenseRef-Zyvor-Production-1.0

import { Loader2, Wifi, WifiOff } from 'lucide-react'
import { useWebSocketContext } from '../contexts/WebSocketContext'
import { statusBgClass, statusSurfaceClasses } from '../utils/semanticColors'

export default function ConnectionStatus() {
  const { connection } = useWebSocketContext()

  const isLive = connection === 'live'
  const isConnecting = connection === 'connecting'
  const tone = isLive ? 'ok' : isConnecting ? 'warn' : 'error'

  const title = isLive
    ? 'Real-time VM updates connected (/ws/v1/watch)'
    : isConnecting
      ? 'Connecting to real-time updates… Can stay here briefly after libvirt or the daemon restarts. If it never turns Live, check WebSockets through your proxy (see README).'
      : 'Could not obtain a WebSocket token (try refreshing after sign-in).'

  const ariaLabel = isLive ? 'Live: real-time updates connected' : isConnecting ? 'Connecting to real-time updates' : 'Offline: real-time updates unavailable'

  return (
    <div
      role="status"
      aria-live="polite"
      aria-label={ariaLabel}
      title={title}
      className={statusSurfaceClasses(tone, 'flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium transition-all border')}
    >
      {isLive ? (
        <>
          <div className={`w-1.5 h-1.5 rounded-full animate-pulse-dot ${statusBgClass('ok')}`} />
          <Wifi className="w-3 h-3 shrink-0" aria-hidden />
          <span className="whitespace-nowrap max-[520px]:sr-only">Live</span>
        </>
      ) : isConnecting ? (
        <>
          <Loader2 className="w-3 h-3 shrink-0 animate-spin" aria-hidden />
          <Wifi className="w-3 h-3 shrink-0 opacity-60" aria-hidden />
          <span className="whitespace-nowrap max-[520px]:sr-only">Connecting</span>
        </>
      ) : (
        <>
          <div className={`w-1.5 h-1.5 rounded-full ${statusBgClass('error')}`} />
          <WifiOff className="w-3 h-3 shrink-0" aria-hidden />
          <span className="whitespace-nowrap max-[520px]:sr-only">Offline</span>
        </>
      )}
    </div>
  )
}
