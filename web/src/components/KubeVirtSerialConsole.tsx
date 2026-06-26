// Copyright (c) 2026 ZyvorAI Labs Private Limited. All rights reserved.
// Proprietary software — see LICENSE in the repository root.
// https://zyvor.dev · info@zyvor.dev

import { useCallback, useEffect, useRef, useState } from 'react'
import { Terminal as XTerm } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import '@xterm/xterm/css/xterm.css'
import { Maximize, Minimize, RefreshCw, Trash2 } from 'lucide-react'
import { getWsToken } from '../api/client'
import { statusBgClass } from '../utils/semanticColors'

interface Props {
  namespace: string
  vmName: string
}

/** Serial console for a KubeVirt VM via machina WebSocket → kubectl proxy → KubeVirt console subresource. */
export default function KubeVirtSerialConsole({ namespace, vmName }: Props) {
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

    let token: string
    try {
      token = await getWsToken()
    } catch {
      term.write('\r\n❌ Failed to obtain WebSocket token\r\n')
      return
    }

    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
    const ws = new WebSocket(
      `${protocol}//${window.location.host}/ws/v1/k8s-kubevirt/${encodeURIComponent(namespace)}/${encodeURIComponent(vmName)}/console?token=${encodeURIComponent(token)}`,
    )
    ws.binaryType = 'arraybuffer'
    wsRef.current = ws

    ws.onopen = () => {
      setConnected(true)
      term.write('\r\n✅ Connected to KubeVirt serial console\r\n\r\n')
    }

    ws.onmessage = (event) => {
      if (typeof event.data === 'string') {
        term.write(event.data)
      } else if (event.data instanceof ArrayBuffer) {
        const dec = new TextDecoder('utf-8', { fatal: false })
        term.write(dec.decode(new Uint8Array(event.data)))
      }
    }
    ws.onerror = () => term.write('\r\n❌ Connection error\r\n')
    ws.onclose = () => {
      setConnected(false)
      term.write('\r\n⚠️ Disconnected\r\n')
    }

    term.onData((data) => {
      if (ws.readyState === WebSocket.OPEN) ws.send(data)
    })
  }, [namespace, vmName])

  useEffect(() => {
    void connect()
    const handleResize = () => fitRef.current?.fit()
    window.addEventListener('resize', handleResize)
    return () => {
      window.removeEventListener('resize', handleResize)
      wsRef.current?.close()
      xtermRef.current?.dispose()
    }
  }, [connect])

  return (
    <div className={fullscreen ? 'fixed inset-0 z-[70] bg-slate-900 flex flex-col' : 'flex flex-col h-full min-h-0'}>
      <div className="flex items-center justify-between px-4 py-2 bg-slate-800 border-b border-slate-700 rounded-t-lg shrink-0">
        <div className="flex items-center gap-3">
          <div className={`w-2.5 h-2.5 rounded-full ${statusBgClass(connected ? 'ok' : 'error')}`} />
          <span className="text-sm text-slate-300">KubeVirt console — {namespace}/{vmName}</span>
        </div>
        <div className="flex items-center gap-1">
          <button type="button" onClick={() => xtermRef.current?.clear()} className="p-1.5 hover:bg-slate-700 rounded transition" title="Clear" aria-label="Clear"><Trash2 className="w-4 h-4 text-slate-400" /></button>
          <button type="button" onClick={() => void connect()} className="p-1.5 hover:bg-slate-700 rounded transition" title="Reconnect" aria-label="Reconnect"><RefreshCw className="w-4 h-4 text-slate-400" /></button>
          <button type="button" onClick={() => setFullscreen(!fullscreen)} className="p-1.5 hover:bg-slate-700 rounded transition" title="Fullscreen" aria-label="Fullscreen">
            {fullscreen ? <Minimize className="w-4 h-4 text-slate-400" /> : <Maximize className="w-4 h-4 text-slate-400" />}
          </button>
        </div>
      </div>
      <div ref={terminalRef} className={`bg-[#0d1117] rounded-b-lg flex-1 min-h-0 ${fullscreen ? '' : ''}`} style={{ minHeight: fullscreen ? undefined : '480px' }} />
    </div>
  )
}
