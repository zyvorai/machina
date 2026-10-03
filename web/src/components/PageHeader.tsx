// Copyright 2026 Zyvor AI Labs · https://zyvor.dev
// SPDX-License-Identifier: LicenseRef-Zyvor-Production-1.0

import type { ReactNode } from 'react'
import { RefreshCw } from 'lucide-react'

type Props = {
  title: string
  subtitle?: string
  eyebrow?: string
  icon?: ReactNode
  onRefresh?: () => void
  refreshing?: boolean
  actions?: ReactNode
}

/** Standard page title row — same apple.com type as PageLayout / Hero. */
export default function PageHeader({
  title,
  subtitle,
  eyebrow,
  icon,
  onRefresh,
  refreshing,
  actions,
}: Props) {
  return (
    <header className="apple-page-header mb-8">
      <div className="min-w-0 flex-1 max-w-3xl">
        {eyebrow ? <p className="apple-eyebrow">{eyebrow}</p> : null}
        <h1 className="page-title flex items-center gap-3">
          {icon ? <span className="text-[var(--text-muted)] shrink-0">{icon}</span> : null}
          <span className="truncate">{title}</span>
        </h1>
        {subtitle ? <p className="page-lede">{subtitle}</p> : null}
      </div>
      <div className="apple-page-actions">
        {onRefresh && (
          <button
            type="button"
            onClick={onRefresh}
            disabled={refreshing}
            className="btn-secondary text-xs p-2.5 rounded-full disabled:opacity-50"
            aria-label="Refresh"
          >
            <RefreshCw className={`w-4 h-4 ${refreshing ? 'animate-spin' : ''}`} />
          </button>
        )}
        {actions}
      </div>
    </header>
  )
}
