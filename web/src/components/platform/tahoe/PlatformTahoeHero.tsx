// Copyright 2026 Zyvor AI Labs · https://zyvor.dev
// SPDX-License-Identifier: LicenseRef-Zyvor-Production-1.0

import type { LucideIcon } from 'lucide-react'
import type { ReactNode } from 'react'
import TahoeHero from './TahoeHero'
import type { TahoeStat } from './tahoeTypes'

export type { TahoeStat } from './tahoeTypes'

export interface PlatformTahoeHeroProps {
  title: string
  subtitle?: string
  eyebrow?: string
  icon: LucideIcon
  actions?: ReactNode
  stats?: TahoeStat[]
  compact?: boolean
  badge?: ReactNode
}

/** Platform page hero — Zeus TahoeHero flat (1:1). Eyebrow kept for callers; shown in subtitle prefix when set. */
export default function PlatformTahoeHero({
  title,
  subtitle,
  eyebrow,
  icon,
  actions,
  stats,
  compact = false,
  badge,
}: PlatformTahoeHeroProps) {
  const lede = [eyebrow && eyebrow !== 'Platform' ? eyebrow : null, subtitle].filter(Boolean).join(' · ') || subtitle
  return (
    <div className="space-y-2 mb-2">
      {badge ? <div className="flex justify-end">{badge}</div> : null}
      <TahoeHero
        title={title}
        subtitle={lede}
        icon={icon}
        actions={actions}
        stats={stats}
        compact={compact}
        variant="flat"
      />
    </div>
  )
}
