// Copyright 2026 Zyvor AI Labs · https://zyvor.dev
// SPDX-License-Identifier: LicenseRef-Zyvor-Production-1.0

import { statusBgClass, utilizationTone } from '../../../utils/semanticColors'

export type StatusTone = 'ok' | 'warn' | 'error' | 'info' | 'neutral'

/** Small pulsing status LED — tone-driven so it repaints correctly under every theme. */
export function StatusLed({ tone, className = '' }: { tone: StatusTone; className?: string }) {
  return (
    <span
      className={`inline-block w-[7px] h-[7px] rounded-full shrink-0 animate-pulse ${statusBgClass(tone)} ${className}`}
      style={{ boxShadow: `0 0 8px 0 var(--machina-status-${tone === 'neutral' ? 'neutral' : tone})` }}
      aria-hidden
    />
  )
}

/** Segmented VU-style meter — n filled blocks instead of a smooth progress bar. */
export function SegmentedMeter({ percent, segments = 12, tone }: { percent: number; segments?: number; tone?: StatusTone }) {
  const pct = Math.max(0, Math.min(100, percent))
  const on = Math.round((pct / 100) * segments)
  const resolvedTone = tone ?? utilizationTone(pct)
  return (
    <div className="flex gap-[2px] h-1.5" role="img" aria-label={`${Math.round(pct)} percent`}>
      {Array.from({ length: segments }, (_, i) => (
        <span
          key={i}
          className={`flex-1 rounded-[1px] ${i < on ? statusBgClass(resolvedTone) : 'bg-white/10'}`}
        />
      ))}
    </div>
  )
}

/** One mark per occupied bay (VM slot) on a host — no fixed capacity is modeled, so only occupied marks render. */
export function BayRow({ count, tone, max = 24 }: { count: number; tone: StatusTone; max?: number }) {
  const shown = Math.min(count, max)
  return (
    <div className="flex gap-[2px] flex-wrap max-w-[120px]" aria-label={`${count} machines`}>
      {Array.from({ length: shown }, (_, i) => (
        <i key={i} className={`w-[5px] h-[9px] rounded-[1px] ${statusBgClass(tone)} opacity-80`} />
      ))}
      {count > max && <span className="text-[9px] text-[var(--text-muted)] self-center ml-0.5">+{count - max}</span>}
    </div>
  )
}
