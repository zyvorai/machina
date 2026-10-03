// Copyright 2026 Zyvor AI Labs · https://zyvor.dev
// SPDX-License-Identifier: LicenseRef-Zyvor-Production-1.0

import { useId, type InputHTMLAttributes } from 'react'

export type GlassInputProps = InputHTMLAttributes<HTMLInputElement> & {
  label?: string
  hint?: string
  error?: string
}

export function GlassInput({ label, hint, error, className = '', id, required, ...props }: GlassInputProps) {
  // Fall back to a React-generated unique suffix rather than the raw slugified
  // label: two GlassInputs sharing a label (e.g. "Name" in two side-by-side
  // forms/modals) would otherwise render duplicate DOM ids, breaking the
  // label/input association and aria-describedby wiring for both.
  const generatedId = useId()
  const inputId = id ?? (label ? `${label.toLowerCase().replace(/\s+/g, '-')}-${generatedId}` : undefined)
  const errorId = inputId ? `${inputId}-error` : undefined
  return (
    <label className="block space-y-1.5">
      {label && (
        <span className="text-sm font-medium text-[var(--text-secondary)]">{label}</span>
      )}
      <input
        id={inputId}
        className={`input-field ${className}`.trim()}
        aria-invalid={error ? true : undefined}
        aria-describedby={error && errorId ? errorId : undefined}
        aria-required={required || undefined}
        required={required}
        {...props}
      />
      {hint && <span className="text-xs text-[var(--text-muted)]">{hint}</span>}
      {error && errorId && <p id={errorId} role="alert" className="text-xs text-red-400 mt-1">{error}</p>}
    </label>
  )
}
