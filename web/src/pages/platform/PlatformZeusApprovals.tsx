// Copyright (c) 2026 ZyvorAI Labs Private Limited. All rights reserved.

import { useCallback, useEffect, useState } from 'react'
import { CheckCircle2, ShieldCheck } from 'lucide-react'
import ConfirmDialog from '../../components/ConfirmDialog'
import PlatformPageChrome, { PlatformRefreshButton } from '../../components/platform/PlatformPageChrome'
import PlatformEmptyState from '../../components/platform/PlatformEmptyState'
import { MacGlassPanel } from '../../components/platform/mac/PlatformMacUi'
import ZeusInsightCard from '../../components/ai/ZeusInsightCard'
import { executeZeusAction, getZeusApprovalHub, rejectZeusAction, type ZeusActionRow } from '../../api/ai'
import { useToastContext } from '../../contexts/ToastContext'
import { formatUserError } from '../../utils/apiError'

export default function PlatformZeusApprovals() {
  const toast = useToastContext()
  const [actions, setActions] = useState<ZeusActionRow[]>([])
  const [totalPending, setTotalPending] = useState(0)
  const [firewallPending, setFirewallPending] = useState(0)
  const [busy, setBusy] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [rejectTargetId, setRejectTargetId] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const hub = await getZeusApprovalHub()
      setActions(hub.zeus_actions ?? [])
      setTotalPending(hub.total_pending)
      setFirewallPending(hub.firewall_pending)
    } catch (e: unknown) {
      setError(formatUserError(e))
      setActions([])
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const execute = async (id: string) => {
    setBusy(id)
    try {
      const r = await executeZeusAction(id)
      toast.success(String(r.message ?? 'Executed'))
      await load()
    } catch (e: unknown) {
      toast.error(formatUserError(e))
    } finally {
      setBusy(null)
    }
  }

  const doReject = async (id: string) => {
    setRejectTargetId(null)
    setBusy(id)
    try {
      await rejectZeusAction(id)
      toast.success('Action rejected')
      await load()
    } catch (e: unknown) {
      toast.error(formatUserError(e))
    } finally {
      setBusy(null)
    }
  }

  return (
    <PlatformPageChrome
      title="Zeus approvals"
      subtitle="Review and execute pending AI actions from Zeus, NL Ops, and firewall automation"
      icon={<ShieldCheck className="w-6 h-6 text-orange-400" />}
      loading={loading}
      error={error}
      onErrorRetry={() => void load()}
      actions={<PlatformRefreshButton onClick={() => void load()} />}
      contentClassName="space-y-4"
    >
      <MacGlassPanel
        title="Pending queue"
        subtitle={`${totalPending} total · ${firewallPending} firewall-related`}
      >
        {actions.length === 0 && !loading && (
          <PlatformEmptyState
            title="No pending approvals"
            subtitle="When Zeus or NL Ops queues a risky change, it appears here for human approval."
          />
        )}
        <div className="space-y-2">
          {actions.map((a) => (
            <ZeusInsightCard
              key={a.id}
              title={a.label}
              detail={`${a.review} · Risk: ${a.risk} · ${a.source}`}
              onApprove={busy === a.id ? undefined : () => void execute(a.id)}
              onDismiss={busy === a.id ? undefined : () => setRejectTargetId(a.id)}
            />
          ))}
        </div>
      </MacGlassPanel>

      {actions.length > 0 && (
        <p className="text-xs text-slate-500 flex items-center gap-1.5">
          <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400/80" />
          Executed actions are audited on the controller — reject to discard without side effects.
        </p>
      )}
      <ConfirmDialog
        open={rejectTargetId !== null}
        title="Reject AI Action"
        message="Reject this AI action? It will not be executed."
        confirmLabel="Reject"
        variant="danger"
        onCancel={() => setRejectTargetId(null)}
        onConfirm={() => { if (rejectTargetId) void doReject(rejectTargetId) }}
      />
    </PlatformPageChrome>
  )
}
