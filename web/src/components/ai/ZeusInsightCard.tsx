// Copyright (c) 2026 ZyvorAI Labs Private Limited. All rights reserved.

import { Sparkles } from 'lucide-react'

export default function ZeusInsightCard({
  title,
  detail,
  onApprove,
  onDismiss,
  onExplain,
}: {
  title: string
  detail: string
  onApprove?: () => void
  onDismiss?: () => void
  onExplain?: () => void
}) {
  return (
    <div className="rounded-xl border border-orange-500/20 bg-orange-500/5 p-3 text-sm">
      <div className="flex items-start gap-2">
        <Sparkles className="w-4 h-4 text-orange-400 mt-0.5 shrink-0" />
        <div className="min-w-0 flex-1">
          <p className="font-medium text-slate-100">{title}</p>
          <p className="text-slate-400 text-xs mt-1">{detail}</p>
          <div className="flex flex-wrap gap-2 mt-2">
            {onApprove && (
              <button type="button" className="btn-primary text-[10px]" onClick={onApprove}>
                Approve
              </button>
            )}
            {onExplain && (
              <button type="button" className="btn-secondary text-[10px]" onClick={onExplain}>
                Explain
              </button>
            )}
            {onDismiss && (
              <button type="button" className="btn-secondary text-[10px]" onClick={onDismiss}>
                Dismiss
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
