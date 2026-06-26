// Copyright (c) 2026 ZyvorAI Labs Private Limited. All rights reserved.

import {
  Activity,
  Bot,
  Monitor,
  Network,
  ScrollText,
  Terminal,
  Wrench,
} from 'lucide-react'

export type ConsoleLens =
  | 'display'
  | 'shell'
  | 'serial'
  | 'network'
  | 'perf'
  | 'events'
  | 'recovery'
  | 'ai'

const LENSES: { id: ConsoleLens; label: string; icon: typeof Monitor }[] = [
  { id: 'display', label: 'Display', icon: Monitor },
  { id: 'shell', label: 'Shell', icon: Terminal },
  { id: 'serial', label: 'Serial', icon: ScrollText },
  { id: 'network', label: 'Network', icon: Network },
  { id: 'perf', label: 'Perf', icon: Activity },
  { id: 'events', label: 'Events', icon: ScrollText },
  { id: 'recovery', label: 'Recovery', icon: Wrench },
  { id: 'ai', label: 'AI', icon: Bot },
]

type Props = {
  active: ConsoleLens
  onChange: (lens: ConsoleLens) => void
  displayProtocols?: string[]
  activeProtocol?: string
  onProtocolChange?: (protocol: string) => void
  /** Backend recommendation — used only to guide users who are on the wrong lens. */
  recommended?: string
}

export default function ViewLensBar({
  active,
  onChange,
  displayProtocols = [],
  activeProtocol,
  onProtocolChange,
  recommended,
}: Props) {
  // Cockpit pattern: only hint when the user is on the wrong lens for the VM type.
  // Never nudge away from Display toward Serial — serial is a last resort.
  const cockpitHint =
    recommended === 'novnc' && active === 'serial'
      ? 'This VM has a graphical display — switch to Display for VNC.'
      : recommended === 'spice' && active === 'serial'
        ? 'This VM has a SPICE display — switch to Display for the graphics console.'
        : null

  return (
    <div className="flex flex-col gap-2 shrink-0">
      <div className="flex flex-wrap gap-1.5">
        {LENSES.map(({ id, label, icon: Icon }) => {
          const isActive = active === id
          return (
            <button
              key={id}
              type="button"
              onClick={() => onChange(id)}
              className={
                isActive
                  ? 'px-3 py-1.5 rounded-lg text-xs bg-emerald-900/40 border border-emerald-500/40 text-emerald-100 inline-flex items-center gap-1.5'
                  : 'px-3 py-1.5 rounded-lg text-xs bg-slate-800/50 border border-slate-700/50 text-slate-300 hover:bg-slate-700/50 inline-flex items-center gap-1.5'
              }
            >
              <Icon className="w-3.5 h-3.5" />
              {label}
            </button>
          )
        })}
      </div>
      {active === 'display' && displayProtocols.length > 0 && onProtocolChange ? (
        <div className="flex flex-wrap gap-1 pl-1">
          {displayProtocols.map((p) => (
            <button
              key={p}
              type="button"
              onClick={() => onProtocolChange(p)}
              className={
                p === activeProtocol
                  ? 'px-2 py-0.5 rounded text-[11px] bg-slate-700 text-slate-100'
                  : 'px-2 py-0.5 rounded text-[11px] text-slate-500 hover:text-slate-300'
              }
            >
              {p.replace('guacamole_', '').replace(/_/g, ' ')}
            </button>
          ))}
        </div>
      ) : null}
      {cockpitHint ? (
        <p className="text-xs text-amber-300/90 pl-1">{cockpitHint}</p>
      ) : null}
    </div>
  )
}

export function lensToProtocol(lens: ConsoleLens, protocols: string[], recommended: string): string {
  if (lens === 'shell') {
    if (protocols.includes('native_ssh')) return 'native_ssh'
    if (protocols.includes('guacamole_ssh')) return 'guacamole_ssh'
  }
  if (lens === 'serial') return 'serial'
  if (lens === 'display') return recommended
  return recommended
}
