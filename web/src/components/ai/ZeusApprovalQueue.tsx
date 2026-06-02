// Copyright (c) 2026 ZyvorAI Labs Private Limited. All rights reserved.

import { useEffect, useState } from 'react'
import { executeZeusAction, getZeusApprovalHub, rejectZeusAction, type ZeusActionRow } from '../../api/ai'
import { useToastContext } from '../../contexts/ToastContext'
import { formatUserError } from '../../utils/apiError'
import ZeusInsightCard from './ZeusInsightCard'

export default function ZeusApprovalQueue() {
  const toast = useToastContext()
  const [actions, setActions] = useState<ZeusActionRow[]>([])
  const [busy, setBusy] = useState<string | null>(null)

  const load = async () => {
    try {
      const hub = await getZeusApprovalHub()
      setActions(hub.zeus_actions ?? [])
    } catch {
      setActions([])
    }
  }

  useEffect(() => {
    void load()
  }, [])

  if (actions.length === 0) return null

  return (
    <div className="space-y-2">
      <p className="text-[10px] font-semibold uppercase tracking-wider text-orange-400/80">Zeus approval queue</p>
      {actions.map((a) => (
        <ZeusInsightCard
          key={a.id}
          title={a.label}
          detail={`${a.review} · ${a.risk}`}
          onApprove={busy === a.id ? undefined : () => {
            setBusy(a.id)
            void executeZeusAction(a.id)
              .then((r) => { toast.success(String(r.message ?? 'Executed')); return load() })
              .catch((e: unknown) => toast.error(formatUserError(e)))
              .finally(() => setBusy(null))
          }}
          onDismiss={busy === a.id ? undefined : () => {
            setBusy(a.id)
            void rejectZeusAction(a.id)
              .then(() => load())
              .catch((e: unknown) => toast.error(formatUserError(e)))
              .finally(() => setBusy(null))
          }}
        />
      ))}
    </div>
  )
}
