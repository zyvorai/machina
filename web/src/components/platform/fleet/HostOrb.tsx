// Copyright 2026 Zyvor AI Labs · https://zyvor.dev
// SPDX-License-Identifier: LicenseRef-Zyvor-Production-1.0

type Props = {
  className?: string
  healthy?: boolean
}

/** Quiet host mark — Apple-flat cube, no neon orbit. */
export default function HostOrb({ className = '', healthy = true }: Props) {
  return (
    <div className={`mc-host-orb relative ${className}`} aria-hidden data-testid="host-orb">
      <div
        className={`absolute inset-4 rounded-2xl border bg-[var(--apple-surface)] flex items-center justify-center ${
          healthy ? 'border-[var(--apple-hairline)]' : 'border-[color-mix(in_srgb,var(--machina-status-warn)_40%,transparent)]'
        }`}
      >
        <div className="w-10 h-10 sm:w-12 sm:h-12 rounded-xl bg-[var(--apple-fill-secondary)] border border-[var(--apple-hairline)]" />
      </div>
    </div>
  )
}
