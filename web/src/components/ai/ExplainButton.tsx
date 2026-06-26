// Copyright (c) 2026 ZyvorAI Labs Private Limited. All rights reserved.

import { useState } from 'react'
import { Sparkles } from 'lucide-react'
import { aiExplain } from '../../api/ai'
import { usePlatformInfo } from '../../contexts/PlatformInfoContext'
import { formatUserError } from '../../utils/apiError'

export default function ExplainButton({
  screen,
  objectRef = {},
  className = '',
}: {
  screen: string
  objectRef?: Record<string, unknown>
  className?: string
}) {
  const { info } = usePlatformInfo()
  const platform = Boolean(info?.control_plane?.proxy_url)
  const [open, setOpen] = useState(false)
  const [text, setText] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  if (!platform) return null

  return (
    <>
      <button
        type="button"
        className={`btn-secondary text-xs flex items-center gap-1 ${className}`}
        onClick={async () => {
          setOpen(true)
          setBusy(true)
          try {
            const r = await aiExplain(screen, objectRef)
            setText(r.explanation)
          } catch (e: unknown) {
            setText(formatUserError(e))
          } finally {
            setBusy(false)
          }
        }}
      >
        <Sparkles className="w-3 h-3" /> Explain
      </button>
      {open && (
        <div className="fixed inset-0 z-[70] flex items-center justify-center p-4 bg-black/50" onClick={() => setOpen(false)}>
          <div className="max-w-lg w-full rounded-2xl bg-slate-900 border border-white/10 p-5" role="dialog" aria-modal="true" aria-label="Zeus Explain" onClick={(e) => e.stopPropagation()}>
            <h3 className="font-semibold mb-2 flex items-center gap-2"><Sparkles className="w-4 h-4 text-orange-400" /> Zeus Explain</h3>
            <p className="text-sm text-slate-300 whitespace-pre-wrap">{busy ? 'Analyzing…' : text}</p>
            <button type="button" className="btn-secondary mt-4 w-full" onClick={() => setOpen(false)}>Close</button>
          </div>
        </div>
      )}
    </>
  )
}
