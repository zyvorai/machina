// Copyright (c) 2026 ZyvorAI Labs Private Limited. All rights reserved.

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
    <Link to={to} className={`text-sm inline-flex items-center gap-1 ${hubLinkClasses()}`}>
      <ArrowLeft className="w-4 h-4" />
      {label}
    </Link>
  )
}

export function PlatformRefreshButton({ onClick, label = 'Refresh' }: { onClick: () => void; label?: string }) {
  return (
    <button type="button" className="btn-secondary" onClick={onClick} aria-label={label}>
      <RefreshCw className="w-4 h-4" />
    </button>
  )
}

/** Inline stat row for PageLayout subtitle (replaces TahoeHero stats). */
export function platformStatSubtitle(
  stats: Array<{ label: string; value: string }>,
): ReactNode {
  return (
    <span className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-slate-400">
      {stats.map((s) => (
        <span key={s.label}>
          <span className="text-slate-500">{s.label}</span> {s.value}
        </span>
      ))}
    </span>
  )
}
