// Copyright 2026 Zyvor AI Labs · https://zyvor.dev
// SPDX-License-Identifier: LicenseRef-Zyvor-Production-1.0

import type { LucideIcon } from 'lucide-react'
import type { ReactNode } from 'react'
import type { TahoeStat } from './tahoeTypes'

export type { TahoeStat } from './tahoeTypes'

const STAT_TONE: Record<NonNullable<TahoeStat['tone']>, string> = {
  sky: 'tahoe-stat-sky',
  violet: 'tahoe-stat-violet',
  emerald: 'tahoe-stat-emerald',
  amber: 'tahoe-stat-amber',
  red: 'tahoe-stat-red',
}

export interface TahoeHeroProps {
  title: string
  subtitle?: string
  icon: LucideIcon
  actions?: ReactNode
  stats?: TahoeStat[]
  compact?: boolean
  /** Flat header: no shine, smaller badge, ledger stats. Zeus default. */
  variant?: 'default' | 'flat'
}

/** Zeus OS TahoeHero — 1:1 flat Magichromatic page header. */
export default function TahoeHero({
  title,
  subtitle,
  icon: Icon,
  actions,
  stats,
  compact = false,
  variant = 'flat',
}: TahoeHeroProps) {
  const isFlat = variant === 'flat'

  return (
    <header
      className={`tahoe-hero relative ${isFlat ? 'overflow-visible' : 'overflow-hidden'} border border-border ${
        isFlat
          ? 'tahoe-hero-flat rounded-2xl px-5 py-4 sm:px-6'
          : `rounded-3xl ${compact ? 'px-5 py-5 sm:px-6' : 'px-6 py-7 sm:px-8 sm:py-8'}`
      }`}
    >
      {!isFlat ? <div className="tahoe-hero-shine" aria-hidden /> : null}
      <div className="relative z-10 flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div className="min-w-0 flex items-start gap-3 sm:gap-4">
          <div className="tahoe-icon-badge shrink-0">
            <Icon className={isFlat ? 'h-5 w-5 text-primary' : 'h-7 w-7 text-primary'} strokeWidth={1.75} />
          </div>
          <div className="min-w-0">
            <h1
              className={
                isFlat
                  ? 'truncate text-xl font-semibold tracking-tight text-foreground'
                  : 'line-clamp-2 text-2xl font-semibold tracking-tight text-foreground sm:text-3xl'
              }
            >
              {title}
            </h1>
            {subtitle ? (
              <p
                className={
                  isFlat
                    ? 'mt-1 max-w-2xl text-sm leading-relaxed text-muted-foreground'
                    : 'mt-2 max-w-2xl text-base leading-relaxed text-muted-foreground'
                }
              >
                {subtitle}
              </p>
            ) : null}
          </div>
        </div>
        {actions ? (
          <div className="flex flex-wrap items-center gap-2 shrink-0">{actions}</div>
        ) : null}
      </div>

      {stats && stats.length > 0 ? (
        isFlat ? (
          <ul className="relative z-10 tahoe-hero-ledger mt-3 list-none p-0 m-0">
            {stats.map((s) => {
              const tone = s.tone ?? 'sky'
              return (
                <li key={s.label} className={`tahoe-hero-ledger-cell ${STAT_TONE[tone]}`}>
                  <span className="tahoe-hero-ledger-label">{s.label}</span>
                  <span className="tahoe-hero-ledger-value tahoe-stat-value">{s.value}</span>
                </li>
              )
            })}
          </ul>
        ) : (
          <ul className="relative z-10 mt-6 zeus-auto-grid list-none p-0 m-0">
            {stats.map((s) => (
              <li key={s.label} className={`tahoe-stat-pill ${STAT_TONE[s.tone ?? 'sky']}`}>
                <span className="tahoe-stat-value">{s.value}</span>
                <span className="tahoe-stat-label">{s.label}</span>
              </li>
            ))}
          </ul>
        )
      ) : null}
    </header>
  )
}
