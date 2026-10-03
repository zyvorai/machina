// Copyright 2026 Zyvor AI Labs · https://zyvor.dev
// SPDX-License-Identifier: LicenseRef-Zyvor-Production-1.0

import { Monitor, Terminal, Wifi } from 'lucide-react'

export type ConsoleHubProtocol =
  | 'novnc'
  | 'spice'
  | 'serial'
  | 'rdp'
  | 'webrtc_spice'

const LABELS: Record<string, string> = {
  novnc: 'VNC (native)',
  spice: 'SPICE',
  native_ssh: 'SSH (native)',
  rdp: 'RDP',
  webrtc_spice: 'Performance (WebRTC)',
}

type Props = {
  protocols: string[]
  recommended: string
  active: string
  onChange: (protocol: string) => void
}

export default function ConsoleHubProtocolPicker({ protocols, recommended, active, onChange }: Props) {
  const items = protocols.length > 0 ? protocols : [recommended]
  return (
    <div className="flex flex-wrap gap-2 border-b border-slate-800/80 pb-2 mb-2">
      {items.map((p) => {
        const isActive = p === active
        const Icon = p.includes('ssh') ? Terminal : p.includes('rdp') ? Monitor : p === 'webrtc_spice' ? Wifi : Monitor
        return (
          <button
            key={p}
            type="button"
            onClick={() => onChange(p)}
            className={
              isActive
                ? 'px-3 py-1.5 rounded-lg text-sm bg-emerald-900/50 border border-emerald-500/40 text-emerald-100'
                : 'px-3 py-1.5 rounded-lg text-sm bg-slate-800/60 border border-slate-700/50 text-[var(--text-secondary)] hover:bg-slate-700/60'
            }
          >
            <span className="inline-flex items-center gap-1.5">
              <Icon className="w-3.5 h-3.5" />
              {LABELS[p] ?? p}
              {p === recommended ? <span className="text-[10px] uppercase text-emerald-400/80">default</span> : null}
            </span>
          </button>
        )
      })}
    </div>
  )
}
