// Copyright 2026 Zyvor AI Labs · https://zyvor.dev
// SPDX-License-Identifier: LicenseRef-Zyvor-Production-1.0

import { Link } from 'react-router'

interface ActionCardProps {
  to?: string
  onClick?: () => void
  icon: React.ReactNode
  title: string
  subtitle?: string
}

export default function ActionCard({ to, onClick, icon, title, subtitle }: ActionCardProps) {
  const className =
    'platform-action-card flex flex-col items-start gap-3 p-5 rounded-2xl border border-[var(--apple-hairline)]/80 bg-[var(--apple-surface)] hover:bg-[var(--surface-hover)] hover:border-[color-mix(in_srgb,var(--accent)_30%,var(--apple-hairline))] transition-all text-left w-full'
  const inner = (
    <>
      <div className="p-2.5 rounded-xl bg-[var(--apple-surface)] text-[var(--text-primary)]">{icon}</div>
      <div>
        <p className="font-semibold text-[var(--text-primary)]">{title}</p>
        {subtitle && <p className="text-xs text-[var(--text-muted)] mt-1">{subtitle}</p>}
      </div>
    </>
  )
  if (to) {
    return <Link to={to} className={className}>{inner}</Link>
  }
  return (
    <button type="button" onClick={onClick} className={className}>
      {inner}
    </button>
  )
}
