// Copyright (c) 2026 ZyvorAI Labs Private Limited. All rights reserved.

import { useEffect, useRef, useState } from 'react'
import PageLayout from '../../components/PageLayout'
import { Link, useLocation, useParams } from 'react-router'
import { ArrowLeft, ExternalLink } from 'lucide-react'
import { getVmConsole, platformVncWsUrl } from '../../api/platform'
import { formatUserError } from '../../utils/apiError'
import AiTerminalCompanion from '../../components/ai/AiTerminalCompanion'
import { isCenterPopoutMode, openCenterPopout } from '../../utils/platformCenterPopout'
import { hubLinkClasses } from '../../utils/semanticColors'

export default function PlatformConsole() {
  const { id } = useParams<{ id: string }>()
  const location = useLocation()
  const isPopout = isCenterPopoutMode(location.search)
  const containerRef = useRef<HTMLDivElement>(null)
  const [error, setError] = useState<string | null>(null)
  const [status, setStatus] = useState('loading')

  useEffect(() => {
    if (!id || !containerRef.current) return
    let cancelled = false
    let rfb: { disconnect: () => void; addEventListener?: (e: string, fn: () => void) => void } | null = null

    async function connect() {
      try {
        const info = await getVmConsole(id!)
        if (cancelled || !containerRef.current) return
        const wsUrl = platformVncWsUrl(info.ws_path)
        containerRef.current.innerHTML = ''
        const loadRfb = new Function('return import("/novnc/core/rfb.js")')
        const module = await loadRfb() as { default: new (el: HTMLElement, url: string, opts?: object) => { disconnect: () => void; addEventListener: (e: string, fn: () => void) => void } }
        const RFB = module.default
        if (cancelled || !containerRef.current) return
        rfb = new RFB(containerRef.current, wsUrl, { showDotCursor: true })
        rfb.addEventListener?.('connect', () => setStatus('connected'))
        rfb.addEventListener?.('disconnect', () => setStatus('disconnected'))
      } catch (e: unknown) {
        try {
          const { default: RFB } = await import(/* @vite-ignore */ 'novnc-core/lib/rfb')
          if (cancelled || !containerRef.current) return
          const info = await getVmConsole(id!)
          rfb = new RFB(containerRef.current, platformVncWsUrl(info.ws_path), { showDotCursor: true })
          setStatus('connected')
        } catch (inner: unknown) {
          setError(formatUserError(inner ?? e))
          setStatus('error')
        }
      }
    }

    void connect()
    return () => {
      cancelled = true
      rfb?.disconnect()
    }
  }, [id])

  return (
    <PageLayout
      hideHeader
      compact
      error={error}
      className={isPopout ? 'h-[calc(100vh-3rem)] flex flex-col' : ''}
      contentClassName={`space-y-4 ${isPopout ? 'flex flex-col flex-1 min-h-0' : ''}`}
    >
      {!isPopout && (
        <div className="flex items-center justify-between gap-2">
          <Link to={`/platform/vms/${id}`} className={`text-sm flex items-center gap-1 ${hubLinkClasses()}`}>
            <ArrowLeft className="w-4 h-4" /> Back to VM
          </Link>
          <button
            type="button"
            className="btn-secondary text-xs flex items-center gap-1"
            onClick={() => openCenterPopout(`/platform/vms/${id}/console`)}
          >
            <ExternalLink className="w-3 h-3" /> Pop out
          </button>
        </div>
      )}
      <div className="text-sm text-white/50">Status: {status}</div>
      <div
        ref={containerRef}
        className={`w-full bg-black rounded-lg overflow-hidden flex-1 ${isPopout ? 'min-h-0' : 'min-h-[480px]'}`}
      />
      {id && !isPopout && <AiTerminalCompanion vmName={id} vmId={id} />}
    </PageLayout>
  )
}
