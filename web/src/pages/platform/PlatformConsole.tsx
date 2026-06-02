// Copyright (c) 2026 ZyvorAI Labs Private Limited. All rights reserved.

import { useCallback, useEffect, useRef, useState } from 'react'
import PageLayout from '../../components/PageLayout'
import { Link, useLocation, useParams } from 'react-router'
import { ArrowLeft, ExternalLink, Monitor, RefreshCw, Terminal } from 'lucide-react'
import { getPlatformVm, getVmConsole, platformVncWsUrl } from '../../api/platform'
import { formatUserError } from '../../utils/apiError'
import AiTerminalCompanion from '../../components/ai/AiTerminalCompanion'
import { isCenterPopoutMode, openCenterPopout } from '../../utils/platformCenterPopout'
import { hubLinkClasses, statusPillClasses } from '../../utils/semanticColors'

type ConsoleStatus = 'loading' | 'connected' | 'disconnected' | 'error'

export default function PlatformConsole() {
  const { id } = useParams<{ id: string }>()
  const location = useLocation()
  const isPopout = isCenterPopoutMode(location.search)
  const containerRef = useRef<HTMLDivElement>(null)
  const rfbRef = useRef<{ disconnect: () => void; addEventListener?: (e: string, fn: () => void) => void } | null>(null)
  const [vmName, setVmName] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [status, setStatus] = useState<ConsoleStatus>('loading')
  const [connectKey, setConnectKey] = useState(0)

  const connect = useCallback(async (signal: { cancelled: boolean }) => {
    if (!id || !containerRef.current) return
    setError(null)
    setStatus('loading')
    rfbRef.current?.disconnect()
    rfbRef.current = null
    if (containerRef.current) containerRef.current.innerHTML = ''

    try {
      const [info, vm] = await Promise.all([
        getVmConsole(id),
        getPlatformVm(id).catch(() => null),
      ])
      if (signal.cancelled || !containerRef.current) return
      if (vm?.name) setVmName(vm.name)

      const wsUrl = platformVncWsUrl(info.ws_path)
      const loadRfb = new Function('return import("/novnc/core/rfb.js")')
      const module = await loadRfb() as {
        default: new (el: HTMLElement, url: string, opts?: object) => {
          disconnect: () => void
          addEventListener: (e: string, fn: () => void) => void
        }
      }
      const RFB = module.default
      if (signal.cancelled || !containerRef.current) return

      const rfb = new RFB(containerRef.current, wsUrl, { showDotCursor: true })
      rfbRef.current = rfb
      rfb.addEventListener('connect', () => { if (!signal.cancelled) setStatus('connected') })
      rfb.addEventListener('disconnect', () => { if (!signal.cancelled) setStatus('disconnected') })
    } catch (e: unknown) {
      try {
        const { default: RFB } = await import(/* @vite-ignore */ 'novnc-core/lib/rfb')
        if (signal.cancelled || !containerRef.current) return
        const info = await getVmConsole(id)
        const rfb = new RFB(containerRef.current, platformVncWsUrl(info.ws_path), { showDotCursor: true })
        rfbRef.current = rfb
        if (!signal.cancelled) setStatus('connected')
      } catch (inner: unknown) {
        if (!signal.cancelled) {
          setError(formatUserError(inner ?? e))
          setStatus('error')
        }
      }
    }
  }, [id])

  useEffect(() => {
    const signal = { cancelled: false }
    void connect(signal)
    return () => {
      signal.cancelled = true
      rfbRef.current?.disconnect()
      rfbRef.current = null
    }
  }, [connect, connectKey])

  const statusTone = status === 'connected' ? 'ok' : status === 'error' ? 'error' : status === 'disconnected' ? 'warn' : 'neutral'
  const statusLabel = status === 'loading' ? 'Connecting…' : status === 'connected' ? 'Connected' : status === 'disconnected' ? 'Disconnected' : 'Error'

  return (
    <PageLayout
      compact
      hideHeader={isPopout}
      title={vmName ?? 'VM console'}
      subtitle={
        <span className="flex flex-wrap items-center gap-2 text-sm">
          <span className={statusPillClasses(statusTone)}>{statusLabel}</span>
          <span className="text-slate-500">noVNC · same-origin proxy</span>
        </span>
      }
      icon={<Terminal className="w-6 h-6 text-slate-400" />}
      prepend={
        !isPopout ? (
          <Link to={`/platform/vms/${id}`} className={`text-sm inline-flex items-center gap-1 ${hubLinkClasses()}`}>
            <ArrowLeft className="w-4 h-4" /> Back to VM
          </Link>
        ) : undefined
      }
      actions={
        !isPopout ? (
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              className="btn-secondary text-sm inline-flex items-center gap-1"
              onClick={() => setConnectKey((k) => k + 1)}
              disabled={status === 'loading'}
            >
              <RefreshCw className={`w-4 h-4 ${status === 'loading' ? 'animate-spin' : ''}`} /> Reconnect
            </button>
            <button
              type="button"
              className="btn-secondary text-sm inline-flex items-center gap-1"
              onClick={() => openCenterPopout(`/platform/vms/${id}/console`)}
            >
              <ExternalLink className="w-4 h-4" /> Pop out
            </button>
          </div>
        ) : undefined
      }
      error={error}
      errorHints={
        error?.toLowerCase().includes('transport')
          ? ['Ensure machina-agent is running on the host (systemctl status machina-agent)', 'Sync hosts from Platform → Hosts if the host shows offline']
          : undefined
      }
      onErrorRetry={() => setConnectKey((k) => k + 1)}
      className={isPopout ? 'h-[calc(100vh-3rem)] flex flex-col' : ''}
      contentClassName={`space-y-3 ${isPopout ? 'flex flex-col flex-1 min-h-0' : ''}`}
    >
      {status === 'loading' && (
        <div className="flex items-center justify-center h-32 text-slate-400 text-sm gap-2" aria-busy="true">
          <Monitor className="w-5 h-5 animate-pulse" /> Establishing VNC session…
        </div>
      )}
      <div
        ref={containerRef}
        className={`w-full bg-black rounded-lg overflow-hidden ${status === 'loading' ? 'hidden' : 'flex-1'} ${isPopout ? 'min-h-0' : 'min-h-[480px]'}`}
      />
      {id && !isPopout && status === 'connected' && <AiTerminalCompanion vmName={vmName ?? id} vmId={id} />}
    </PageLayout>
  )
}
