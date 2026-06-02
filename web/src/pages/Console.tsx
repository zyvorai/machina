// Copyright (c) 2026 ZyvorAI Labs Private Limited. All rights reserved.
// Proprietary software — see LICENSE in the repository root.
// https://zyvor.dev · info@zyvor.dev

import { useState, useEffect } from 'react'
import { useParams, Link, useSearchParams } from 'react-router'
import { ArrowLeft, Terminal as TerminalIcon, Monitor, Keyboard, Camera, Download } from 'lucide-react'
import { ChoiceCard, ChoiceCardGrid } from '../components/ChoiceCards'
import { readJsonObject } from '../api/client'
import SerialConsole from '../components/SerialConsole'
import VNCViewer from '../components/VNCViewer'
import SPICEViewer from '../components/SPICEViewer'
import {
  sendGuestKey, getGuestScreenshotBlob, virtViewerVvUrl, appendVmConnection, vmDetailRoute,
} from '../api/vm'
import { useToastContext } from '../contexts/ToastContext'
import { formatUserError } from '../utils/apiError'
import AiTerminalCompanion from '../components/ai/AiTerminalCompanion'
import PageLayout from '../components/PageLayout'
import { statusBadgeClasses } from '../utils/semanticColors'

interface ConsoleInfo {
  name: string
  console_type: string
  host: string
  port: number
  websocket_port: number
}

function normalizeConsoleInfo(raw: ConsoleInfo): ConsoleInfo {
  const port =
    typeof raw.port === 'number' && Number.isFinite(raw.port)
      ? raw.port
      : Number(raw.port)
  const websocket_port =
    typeof raw.websocket_port === 'number' && Number.isFinite(raw.websocket_port)
      ? raw.websocket_port
      : Number(raw.websocket_port)
  return {
    name: typeof raw.name === 'string' ? raw.name : String(raw.name ?? ''),
    console_type:
      typeof raw.console_type === 'string'
        ? raw.console_type
        : String(raw.console_type ?? 'unknown'),
    host: typeof raw.host === 'string' ? raw.host : String(raw.host ?? ''),
    port: Number.isFinite(port) ? Math.trunc(port) : -1,
    websocket_port: Number.isFinite(websocket_port) ? Math.trunc(websocket_port) : -1,
  }
}

export default function ConsolePage() {
  const { name } = useParams<{ name: string }>()
  const [searchParams] = useSearchParams()
  const conn = searchParams.get('connection') ?? undefined
  const toast = useToastContext()
  const [mode, setMode] = useState<'serial' | 'vnc' | 'spice'>('serial')
  const [consoleInfo, setConsoleInfo] = useState<ConsoleInfo | null>(null)
  const [shotBusy, setShotBusy] = useState(false)

  useEffect(() => {
    if (!name) return
    readJsonObject<ConsoleInfo>(
      appendVmConnection(`/api/v1/vms/console-info/${encodeURIComponent(name)}`, conn),
    )
      .then((info) => {
        const n = normalizeConsoleInfo(info)
        setConsoleInfo(n)
        if (n.console_type === 'vnc' && n.port > 0) {
          setMode('vnc')
        } else if (n.console_type === 'spice' && n.port > 0) {
          setMode('spice')
        } else {
          setMode('serial')
        }
      })
      .catch((e) => console.error('Failed to load console info:', e))
  }, [name, conn])

  if (!name) return null

  const vncPort = consoleInfo?.console_type === 'vnc' ? (consoleInfo?.port ?? -1) : -1
  const spicePort = consoleInfo?.console_type === 'spice' ? (consoleInfo?.port ?? -1) : -1

  return (
    <PageLayout
      compact
      title={`Console: ${name}`}
      actions={
        <>
          <Link to={conn ? `/vms/${encodeURIComponent(name)}?connection=${encodeURIComponent(conn)}` : `/vms/${encodeURIComponent(name)}`} className="p-2 hover:bg-slate-700 rounded transition" aria-label="Back">
            <ArrowLeft className="w-5 h-5" />
          </Link>
          <div className="flex flex-col items-stretch sm:items-end gap-2 min-w-0 max-w-xl">
            {consoleInfo && consoleInfo.port > 0 && (
              <span className="text-xs text-slate-500 sm:text-right">
                {(consoleInfo.console_type ?? 'unknown').toUpperCase()} port {consoleInfo.port}
              </span>
            )}
            <ChoiceCardGrid className="sm:max-w-lg">
              {vncPort > 0 && (
                <ChoiceCard
                  compact
                  tone="blue"
                  selected={mode === 'vnc'}
                  onClick={() => setMode('vnc')}
                  icon={<Monitor className="w-4 h-4" />}
                  title="VNC"
                  description="Graphical console in the browser."
                />
              )}
              {spicePort > 0 && (
                <ChoiceCard
                  compact
                  tone="purple"
                  selected={mode === 'spice'}
                  onClick={() => setMode('spice')}
                  icon={<Monitor className="w-4 h-4" />}
                  title="SPICE"
                  description="Graphical SPICE session."
                />
              )}
              <ChoiceCard
                compact
                tone="slate"
                selected={mode === 'serial'}
                onClick={() => setMode('serial')}
                icon={<TerminalIcon className="w-4 h-4" />}
                title="Serial"
                description="Text console over WebSocket."
              />
            </ChoiceCardGrid>
          </div>
        </>
      }
    >
      {(mode === 'vnc' || mode === 'spice') && (
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            className="btn-secondary text-sm inline-flex items-center gap-1.5"
            onClick={() => {
              if (!name) return
              void sendGuestKey(name, { preset: 'ctrl_alt_del' }, conn)
                .then(() => toast.success('Sent Ctrl+Alt+Del'))
                .catch((e: unknown) => toast.error(formatUserError(e)))
            }}
          >
            <Keyboard className="w-4 h-4" aria-hidden />
            Ctrl+Alt+Del
          </button>
          <button
            type="button"
            disabled={shotBusy}
            className="btn-secondary text-sm inline-flex items-center gap-1.5 disabled:opacity-50"
            onClick={() => {
              if (!name) return
              setShotBusy(true)
              void getGuestScreenshotBlob(name, 0, conn)
                .then((blob) => {
                  const u = URL.createObjectURL(blob)
                  window.open(u, '_blank', 'noopener,noreferrer')
                  setTimeout(() => URL.revokeObjectURL(u), 60_000)
                  toast.success('Screenshot opened in new tab')
                })
                .catch((e: unknown) => toast.error(formatUserError(e)))
                .finally(() => setShotBusy(false))
            }}
          >
            <Camera className="w-4 h-4" aria-hidden />
            {shotBusy ? 'Screenshot…' : 'Screenshot'}
          </button>
          <a
            href={virtViewerVvUrl(name, conn)}
            download={`${name}.vv`}
            className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border text-sm transition ${statusBadgeClasses('ok')} border-[color-mix(in_srgb,var(--machina-status-ok)_40%,transparent)] hover:bg-[color-mix(in_srgb,var(--machina-status-ok)_15%,transparent)]`}
          >
            <Download className="w-4 h-4" aria-hidden />
            Virt-Viewer .vv
          </a>
          <span className="text-xs text-slate-500">Send keys / screenshot use the libvirt API on a running guest.</span>
        </div>
      )}

      <div className="card overflow-hidden rounded-liquid-lg">
        {mode === 'vnc' ? (
          <VNCViewer vmName={name} port={vncPort} libvirtConnection={conn} />
        ) : mode === 'spice' ? (
          <SPICEViewer vmName={name} port={spicePort} libvirtConnection={conn} />
        ) : (
          <SerialConsole vmName={name} libvirtConnection={conn} />
        )}
      </div>
      {name && <AiTerminalCompanion vmName={name} libvirtConnection={conn} />}
    </PageLayout>
  )
}
