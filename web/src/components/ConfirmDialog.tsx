// Copyright (c) 2026 ZyvorAI Labs Private Limited. All rights reserved.
// Proprietary software — see LICENSE in the repository root.
// https://zyvor.dev · info@zyvor.dev

import { useEffect, useId, useState } from 'react'
import { AlertTriangle, X } from 'lucide-react'

interface Props {
  open: boolean
  title: string
  message: string
  confirmLabel?: string
  variant?: 'danger' | 'warning'
  onConfirm: () => void
  onCancel: () => void
  /** When set, the confirm button stays disabled until the user types this exact string. */
  typeToMatch?: string
  /** Label above the confirmation input (default explains typing the phrase). */
  typeToMatchLabel?: string
}

export default function ConfirmDialog({
  open,
  title,
  message,
  confirmLabel = 'Confirm',
  variant = 'danger',
  onConfirm,
  onCancel,
  typeToMatch,
  typeToMatchLabel,
}: Props) {
  const [typed, setTyped] = useState('')
  const titleId = useId()

  useEffect(() => {
    if (open) setTyped('')
  }, [open, typeToMatch])

  useEffect(() => {
    if (!open) return
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onCancel() }
    document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  }, [open, onCancel])

  if (!open) return null

  const btnColor = variant === 'danger'
    ? 'bg-red-600 hover:bg-red-500 shadow-lg shadow-red-600/20'
    : 'bg-yellow-600 hover:bg-yellow-500 shadow-lg shadow-yellow-600/20'

  const needsMatch = Boolean(typeToMatch && typeToMatch.length > 0)
  const matchOk = !needsMatch || typed === typeToMatch

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm animate-fade-in"
      onClick={onCancel}
      role="presentation"
    >
      <form
        role="dialog"
        aria-modal
        aria-labelledby={titleId}
        className="bg-slate-800 border border-slate-700/50 rounded-2xl shadow-2xl w-full max-w-md mx-4 animate-fade-in"
        onClick={(e) => e.stopPropagation()}
        onSubmit={(e) => { e.preventDefault(); if (matchOk) onConfirm() }}
      >
        <div className="flex items-center justify-between p-5 border-b border-slate-700/50">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-yellow-500/10 flex items-center justify-center">
              <AlertTriangle className="w-4 h-4 text-yellow-500" />
            </div>
            <span id={titleId} className="text-lg font-semibold">{title}</span>
          </div>
          <button type="button" onClick={onCancel} aria-label="Cancel" className="text-slate-400 hover:text-white p-1 hover:bg-slate-700 rounded-lg transition">
            <X className="w-4 h-4" />
          </button>
        </div>
        <div className="p-5 text-slate-300 text-sm leading-relaxed space-y-3">
          <div>{message}</div>
          {needsMatch && (
            <div>
              <label className="block text-xs text-slate-400 mb-1.5" htmlFor="confirm-type-match">
                {typeToMatchLabel ?? 'Type the confirmation phrase exactly (case-sensitive):'}
              </label>
              <input
                id="confirm-type-match"
                type="text"
                autoFocus
                autoComplete="off"
                autoCorrect="off"
                spellCheck={false}
                value={typed}
                onChange={(e) => setTyped(e.target.value)}
                className="w-full px-3 py-2 bg-slate-900 border border-slate-600 rounded-lg text-sm font-mono text-slate-200 focus:outline-none focus:border-red-500"
                placeholder={typeToMatch}
              />
            </div>
          )}
        </div>
        <div className="flex justify-end gap-3 px-5 pb-5">
          <button type="button" onClick={onCancel} className="px-4 py-2 bg-slate-700 hover:bg-slate-600 rounded-lg text-sm font-medium transition">Cancel</button>
          <button
            type="submit"
            disabled={!matchOk}
            className={`px-4 py-2 rounded-lg text-sm text-white font-medium transition ${btnColor} disabled:opacity-40 disabled:cursor-not-allowed disabled:shadow-none`}
          >
            {confirmLabel}
          </button>
        </div>
      </form>
    </div>
  )
}
