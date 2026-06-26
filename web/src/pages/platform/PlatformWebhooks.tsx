// Copyright (c) 2026 ZyvorAI Labs Private Limited. All rights reserved.

import { useCallback, useEffect, useState } from 'react'
import ConfirmDialog from '../../components/ConfirmDialog'
import { Webhook, Plus, Send } from 'lucide-react'
import OperatingSurfaceLayout from '../../components/platform/OperatingSurfaceLayout'
import PlatformEmptyState from '../../components/platform/PlatformEmptyState'
import PlatformPageChrome, { PlatformRefreshButton } from '../../components/platform/PlatformPageChrome'
import { MacGlassPanel, MacStatWidget } from '../../components/platform/mac/PlatformMacUi'
import {
  createWebhook,
  deleteWebhook,
  listWebhookDeliveries,
  listWebhooks,
  purgeWebhookDeliveries,
  retryWebhookDelivery,
  toggleWebhook,
  type WebhookDeliveryRow,
  type WebhookRow,
} from '../../api/platform'
import { useToastContext } from '../../contexts/ToastContext'
import { formatUserError } from '../../utils/apiError'
import { statusToneClass, webhookDeliveryTone } from '../../utils/semanticColors'

export default function PlatformWebhooks({ embedded }: { embedded?: boolean } = {}) {
  const toast = useToastContext()
  const [rows, setRows] = useState<WebhookRow[]>([])
  const [deliveries, setDeliveries] = useState<WebhookDeliveryRow[]>([])
  const [deliveryFilter, setDeliveryFilter] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [url, setUrl] = useState('https://example.com/hook')
  const [deleteTargetId, setDeleteTargetId] = useState<string | null>(null)
  const [showRemoveTest, setShowRemoveTest] = useState(false)

  const testWebhooks = rows.filter(
    (w) => w.url.includes('127.0.0.1:19876') || w.url.endsWith('/e2e'),
  )
  const failedCount = deliveries.filter((d) => d.status === 'failed').length
  const enabledCount = rows.filter((w) => w.enabled).length

  const load = useCallback(async () => {
    setError(null)
    try {
      const [hooks, dels] = await Promise.all([
        listWebhooks(),
        listWebhookDeliveries(deliveryFilter || undefined),
      ])
      setRows(hooks)
      setDeliveries(dels)
    } catch (e: unknown) {
      setError(formatUserError(e))
    } finally {
      setLoading(false)
    }
  }, [deliveryFilter])

  useEffect(() => { void load() }, [load])

  return (
    <PlatformPageChrome
      hideHeader={embedded}
      compact={embedded}
      loading={loading && rows.length === 0 && deliveries.length === 0}
      error={error}
      onErrorRetry={() => void load()}
      title={embedded ? undefined : 'Webhooks'}
      subtitle={embedded ? undefined : 'Event notifications for VM lifecycle and HA events'}
      icon={embedded ? undefined : <Webhook className="w-6 h-6 text-slate-400" />}
      actions={embedded ? undefined : <PlatformRefreshButton onClick={() => void load()} />}
      contentClassName="space-y-4"
    >
      <OperatingSurfaceLayout testId="platform-webhooks-page">
        <div className="grid gap-3 sm:grid-cols-3">
          <MacStatWidget label="Endpoints" value={String(rows.length)} icon={<Webhook className="w-4 h-4" />} />
          <MacStatWidget label="Enabled" value={String(enabledCount)} icon={<Send className="w-4 h-4" />} tone={enabledCount > 0 ? 'ok' : 'default'} />
          <MacStatWidget label="Failed deliveries" value={String(failedCount)} icon={<Send className="w-4 h-4" />} tone={failedCount > 0 ? 'warn' : 'default'} />
        </div>

        {testWebhooks.length > 0 && (
          <div className="rounded-xl border border-amber-500/35 bg-amber-500/10 p-3 text-sm text-amber-100">
            <p className="font-medium">E2E test webhooks detected</p>
            <p className="text-xs mt-1 text-amber-200/80">
              These point at <span className="font-mono">127.0.0.1:19876</span> on the controller host — nothing listens there, so
              deliveries fail. Remove them unless you are actively running the E2E receiver.
            </p>
            <button
              type="button"
              className="btn-secondary text-xs mt-2"
              onClick={() => setShowRemoveTest(true)}
            >
              Remove test webhooks
            </button>
          </div>
        )}

        <MacGlassPanel title="Add webhook endpoint" subtitle="Subscribe to vm.create, vm.delete, and ha.recover events.">
          <div className="flex flex-col sm:flex-row gap-3">
            <input aria-label="Webhook URL" className="input flex-1" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://example.com/hook" />
            <button type="button" className="btn-primary flex items-center gap-2 shrink-0" onClick={async () => {
              try { await createWebhook({ url, events: ['vm.create', 'vm.delete', 'ha.recover'] }); toast.success('Webhook added'); await load() } catch (e: unknown) { toast.error(formatUserError(e)) }
            }}><Plus className="w-4 h-4" /> Add endpoint</button>
          </div>
        </MacGlassPanel>

        {rows.length === 0 ? (
          <PlatformEmptyState
            icon={Webhook}
            title="No webhook endpoints"
            subtitle="Add an HTTPS URL to receive fleet event notifications."
          />
        ) : (
          <MacGlassPanel title="Registered endpoints">
            <ul className="divide-y divide-white/[0.04] -mx-1 space-y-0">
              {rows.map((w) => (
                <li key={w.id} className="flex justify-between gap-2 py-3 px-1 text-sm text-slate-400">
                  <span><span className={statusToneClass(w.enabled ? 'ok' : 'neutral')}>{w.enabled ? 'on' : 'off'}</span> {w.url}</span>
                  <span className="flex gap-2 shrink-0">
                    <button type="button" className="btn-secondary text-xs" onClick={async () => { try { await toggleWebhook(w.id); await load() } catch (e: unknown) { toast.error(formatUserError(e)) } }}>Toggle</button>
                    <button type="button" className="btn-secondary text-xs" onClick={() => setDeleteTargetId(w.id)}>Delete</button>
                  </span>
                </li>
              ))}
            </ul>
          </MacGlassPanel>
        )}

        <MacGlassPanel
          title="Recent deliveries"
          action={
            failedCount > 0 ? (
              <button
                type="button"
                className="btn-secondary text-xs"
                onClick={async () => {
                  try {
                    const r = await purgeWebhookDeliveries({ status: 'failed' })
                    toast.success(`Cleared ${r.deleted} failed delivery(ies)`)
                    await load()
                  } catch (e: unknown) {
                    toast.error(formatUserError(e))
                  }
                }}
              >
                Clear failed ({failedCount})
              </button>
            ) : undefined
          }
        >
          <div className="flex flex-wrap items-center gap-3 mb-3">
            <select className="input text-sm w-auto" aria-label="Filter by delivery status" value={deliveryFilter} onChange={(e) => setDeliveryFilter(e.target.value)}>
              <option value="">All statuses</option>
              <option value="pending">Pending</option>
              <option value="delivered">Delivered</option>
              <option value="failed">Failed</option>
            </select>
          </div>
          {deliveries.length === 0 ? (
            <PlatformEmptyState
              title="No deliveries yet"
              subtitle="Deliveries appear after fleet events trigger your webhook endpoints."
            />
          ) : (
            <ul className="space-y-2 text-xs">
              {deliveries.map((d) => (
                <li key={d.id} className="border-b border-white/[0.04] pb-2 text-slate-400">
                  <div className="flex justify-between gap-2">
                    <span>{d.event_kind} → {d.url}</span>
                    <span className={statusToneClass(webhookDeliveryTone(d.status))}>
                      {d.status} ({d.attempts}/{d.max_attempts})
                    </span>
                  </div>
                  {d.last_error && <p className={`${statusToneClass('error')} opacity-80 mt-1 truncate`}>{d.last_error}</p>}
                  {(d.status === 'failed' || d.status === 'pending') && (
                    <button type="button" className="btn-secondary text-xs mt-1" onClick={async () => {
                      try { await retryWebhookDelivery(d.id); toast.success('Retry queued'); await load() } catch (e: unknown) { toast.error(formatUserError(e)) }
                    }}>Retry</button>
                  )}
                </li>
              ))}
            </ul>
          )}
        </MacGlassPanel>
      </OperatingSurfaceLayout>
      <ConfirmDialog
        open={deleteTargetId !== null}
        title="Remove Webhook"
        message="Remove this webhook endpoint? Future events will not be delivered to it."
        confirmLabel="Remove"
        variant="danger"
        onCancel={() => setDeleteTargetId(null)}
        onConfirm={async () => {
          try { await deleteWebhook(deleteTargetId!); await load() }
          catch (e: unknown) { toast.error(formatUserError(e)) }
          finally { setDeleteTargetId(null) }
        }}
      />
      <ConfirmDialog
        open={showRemoveTest}
        title="Remove Test Webhooks"
        message={`Remove ${testWebhooks.length} test webhook(s)? This will stop all deliveries to E2E endpoints.`}
        confirmLabel="Remove All"
        variant="danger"
        onCancel={() => setShowRemoveTest(false)}
        onConfirm={async () => {
          try {
            for (const w of testWebhooks) await deleteWebhook(w.id)
            toast.success(`Removed ${testWebhooks.length} test webhook(s)`)
            await load()
          } catch (e: unknown) { toast.error(formatUserError(e)) }
          finally { setShowRemoveTest(false) }
        }}
      />
    </PlatformPageChrome>
  )
}
