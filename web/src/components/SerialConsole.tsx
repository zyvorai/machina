// Copyright (c) 2026 ZyvorAI Labs Private Limited. All rights reserved.
// Proprietary software — see LICENSE in the repository root.
// https://zyvor.dev · info@zyvor.dev

import { useCallback, useEffect, useRef, useState } from 'react'
import { Terminal as XTerm } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import '@xterm/xterm/css/xterm.css'
import { RefreshCw, Trash2, Maximize, Minimize } from 'lucide-react'
import { getWsToken } from '../api/client'
import { statusBgClass } from '../utils/semanticColors'

function wsConnQs(libvirtConnection?: string | null): string {
  if (!libvirtConnection || libvirtConnection === 'system') return ''
  return `&connection=${encodeURIComponent(libvirtConnection)}`
}

interface Props {
  vmName: string
  libvirtConnection?: string | null
  /** Pre-built WebSocket URL (platform controller proxy). Skips daemon token + /console path. */
  wsUrl?: string
}

export default function SerialConsole({ vmName, libvirtConnection, wsUrl: wsUrlOverride }: Props) {
  const terminalRef = useRef<HTMLDivElement>(null)
  const xtermRef = useRef<XTerm | null>(null)
  const fitRef = useRef<FitAddon | null>(null)
  const wsRef = useRef<WebSocket | null>(null)
  const [connected, setConnected] = useState(false)
  const [fullscreen, setFullscreen] = useState(false)

  const connect = useCallback(async () => {
    if (!terminalRef.current) return

    xtermRef.current?.dispose()
    wsRef.current?.close()

    const term = new XTerm({
      cursorBlink: true,
      fontSize: 14,
      fontFamily: 'Menlo, Monaco, "Courier New", monospace',
      theme: {
        background: '#0d1117',
        foreground: '#c9d1d9',
        cursor: '#58a6ff',
        selectionBackground: '#264f78',
      },
      scrollback: 5000,
    })

    const fit = new FitAddon()
    term.loadAddon(fit)
    term.open(terminalRef.current)
    fit.fit()

    xtermRef.current = term
    fitRef.current = fit

    let wsTarget = wsUrlOverride
    if (!wsTarget) {
      let token: string
      try {
        token = await getWsToken()
      } catch (e) {
        const msg = e instanceof Error ? e.message : 'Failed to obtain WebSocket token'
        term.write(`\r\n❌ ${msg}\r\n`)
        return
      }
      const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
      wsTarget = `${protocol}//${window.location.host}/ws/v1/console/${encodeURIComponent(vmName)}?token=${encodeURIComponent(token)}${wsConnQs(libvirtConnection)}`
    }

    const ws = new WebSocket(wsTarget)
    wsRef.current = ws

    ws.onopen = () => {
      setConnected(true)
      term.write('✅ Connected to serial console\r\n\r\n')
    }

    ws.onmessage = (event) => term.write(typeof event.data === 'string' ? event.data : new TextDecoder().decode(event.data))
    ws.onerror = () => term.write('\r\n❌ Connection error\r\n')
    ws.onclose = () => {
      setConnected(false)
      term.write('\r\n⚠️ Disconnected\r\n')
    }

    term.onData((data) => {
      if (ws.readyState === WebSocket.OPEN) ws.send(data)
    })
  }, [vmName, libvirtConnection, wsUrlOverride])

  useEffect(() => {
    connect()
    const handleResize = () => fitRef.current?.fit()
    window.addEventListener('resize', handleResize)
    return () => {
      window.removeEventListener('resize', handleResize)
      wsRef.current?.close()
      xtermRef.current?.dispose()
    }
  }, [connect])

  const reconnect = () => connect()
  const clear = () => xtermRef.current?.clear()

  return (
    <div className={fullscreen ? 'fixed inset-0 z-50 bg-slate-900 flex flex-col' : ''}>
      <div className="flex items-center justify-between px-4 py-2 bg-slate-800 border-b border-slate-700 rounded-t-lg">
        <div className="flex items-center gap-3">
          <div className={`w-2.5 h-2.5 rounded-full ${statusBgClass(connected ? 'ok' : 'error')}`} />
          <span className="text-sm text-slate-300">Serial Console — {vmName}</span>
        </div>
        <div className="flex items-center gap-1">
          <button onClick={clear} className="p-1.5 hover:bg-slate-700 rounded transition" title="Clear" aria-label="Clear"><Trash2 className="w-4 h-4 text-slate-400" /></button>
          <button onClick={reconnect} className="p-1.5 hover:bg-slate-700 rounded transition" title="Reconnect" aria-label="Reconnect"><RefreshCw className="w-4 h-4 text-slate-400" /></button>
          <button onClick={() => setFullscreen(!fullscreen)} className="p-1.5 hover:bg-slate-700 rounded transition" title="Fullscreen" aria-label="Fullscreen">
            {fullscreen ? <Minimize className="w-4 h-4 text-slate-400" /> : <Maximize className="w-4 h-4 text-slate-400" />}
          </button>
        </div>
      </div>
      <div ref={terminalRef} className={`bg-[#0d1117] rounded-b-lg ${fullscreen ? 'flex-1' : ''}`} style={fullscreen ? {} : { minHeight: '500px' }} />
    </div>
  )
}
