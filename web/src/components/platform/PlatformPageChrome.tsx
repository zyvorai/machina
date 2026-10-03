// Copyright 2026 Zyvor AI Labs · https://zyvor.dev
// SPDX-License-Identifier: LicenseRef-Zyvor-Production-1.0

import type { ComponentProps, ReactNode } from 'react'
import { Link } from 'react-router'
import { ArrowLeft, RefreshCw } from 'lucide-react'
import PageLayout from '../PageLayout'
import { hubLinkClasses } from '../../utils/semanticColors'

type PageLayoutProps = ComponentProps<typeof PageLayout>

export type PlatformPageChromeProps = PageLayoutProps & {
  compact?: boolean
}

/** Platform pages use PageLayout with compact spacing and visible header by default. */
export default function PlatformPageChrome({
  compact = true,
  ...props
}: PlatformPageChromeProps) {
  return <PageLayout compact={compact} {...props} />
}

export function PlatformBackLink({ to, label }: { to: string; label: string }) {
  return (
    <Link to={to} className={`text-sm inline-flex items-center gap-1 min-h-9 -my-1 ${hubLinkClasses()}`}>
      <ArrowLeft className="w-4 h-4" />
      {label}
    </Link>
  )
}

export function PlatformRefreshButton({ onClick, label = 'Refresh' }: { onClick: () => void; label?: string }) {
  return (
    <button type="button" className="btn-secondary text-xs" onClick={onClick} aria-label={label}>
      <RefreshCw className="w-4 h-4" />
    </button>
  )
}

/** Inline stat row for PageLayout subtitle (replaces TahoeHero stats). */
export function platformStatSubtitle(
  stats: Array<{ label: string; value: string | number }>,
): ReactNode {
  return (
    <span className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[15px] text-[var(--text-muted)] tracking-tight">
      {stats.map((s) => (
        <span key={s.label}>
          <span className="text-[var(--text-faint)]">{s.label}</span>{' '}
          <span className="text-[var(--text-primary)] tabular-nums font-medium">{s.value}</span>
        </span>
      ))}
    </span>
  )
}
