// Copyright 2026 Zyvor AI Labs · https://zyvor.dev
// SPDX-License-Identifier: LicenseRef-Zyvor-Production-1.0

import { useEffect, useState } from 'react'
import { executeZyraAction, getZyraApprovalHub, rejectZyraAction, type ZyraActionRow } from '../../api/ai'
import { useToastContext } from '../../contexts/ToastContext'
import { formatUserError } from '../../utils/apiError'
import ConfirmDialog from '../ConfirmDialog'
import ZyraInsightCard from './ZyraInsightCard'

export default function ZyraApprovalQueue() {
  const toast = useToastContext()
  const [actions, setActions] = useState<ZyraActionRow[]>([])
  const [busy, setBusy] = useState<string | null>(null)
  const [confirmApprove, setConfirmApprove] = useState<ZyraActionRow | null>(null)

  const load = async () => {
    try {
      const hub = await getZyraApprovalHub()
      setActions(hub.zyra_actions ?? [])
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
      <ConfirmDialog
        open={confirmApprove !== null}
        title="Approve Zyra action"
        message={confirmApprove ? `Approve and execute "${confirmApprove.label}"? ${confirmApprove.review} · ${confirmApprove.risk}` : ''}
        confirmLabel="Approve"
        variant="danger"
        onCancel={() => setConfirmApprove(null)}
        onConfirm={() => {
          const a = confirmApprove
          setConfirmApprove(null)
          if (!a) return
          setBusy(a.id)
          void executeZyraAction(a.id)
            .then((r) => { toast.success(String(r.message ?? 'Executed')); return load() })
            .catch((e: unknown) => toast.error(formatUserError(e)))
            .finally(() => setBusy(null))
        }}
      />
      <p className="text-[10px] font-semibold uppercase tracking-wider text-orange-400/80">Zyra approval queue</p>
      {actions.map((a) => (
        <ZyraInsightCard
          key={a.id}
          title={a.label}
          detail={`${a.review} · ${a.risk}`}
          onApprove={busy === a.id ? undefined : () => setConfirmApprove(a)}
          onDismiss={busy === a.id ? undefined : () => {
            setBusy(a.id)
            void rejectZyraAction(a.id)
              .then(() => load())
              .catch((e: unknown) => toast.error(formatUserError(e)))
              .finally(() => setBusy(null))
          }}
        />
      ))}
    </div>
  )
}
