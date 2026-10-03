// Copyright 2026 Zyvor AI Labs · https://zyvor.dev
// SPDX-License-Identifier: LicenseRef-Zyvor-Production-1.0

import { useCallback, useEffect, useRef, useState } from 'react'
import ConfirmDialog from '../../components/ConfirmDialog'
import { Gauge, Plus, Trash2 } from 'lucide-react'
import OperatingSurfaceLayout from '../../components/platform/OperatingSurfaceLayout'
import PlatformEmptyState from '../../components/platform/PlatformEmptyState'
import PlatformPageChrome, { PlatformBackLink, PlatformRefreshButton } from '../../components/platform/PlatformPageChrome'
import { MacGlassPanel, MacListRow } from '../../components/platform/mac/PlatformMacUi'
import {
  createAlertRule,
  deleteAlertRule,
  listAlertRules,
  setAlertRuleEnabled,
  type AlertComparator,
  type AlertMetric,
  type AlertRule,
  type AlertSeverity,
} from '../../api/day2'
import { useToastContext } from '../../contexts/ToastContext'
import { formatUserError } from '../../utils/apiError'

export default function PlatformAlertRules() {
  const toast = useToastContext()
  const [rows, setRows] = useState<AlertRule[]>([])
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [name, setName] = useState('high-cpu')
  const [metric, setMetric] = useState<AlertMetric>('cpu_percent')
  const [comparator, setComparator] = useState<AlertComparator>('gt')
  const [threshold, setThreshold] = useState('85')
  const [severity, setSeverity] = useState<AlertSeverity>('warning')
  const [cooldown, setCooldown] = useState('30')
  const [scopeProject, setScopeProject] = useState('')
  const [scopeTag, setScopeTag] = useState('')
  const [saving, setSaving] = useState(false)
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null)
  const loadSeq = useRef(0)

  const load = useCallback(async () => {
    const seq = ++loadSeq.current
    const alive = () => seq === loadSeq.current
    setError(null)
    try {
      const r = await listAlertRules()
      if (alive()) setRows(r)
    } catch (e: unknown) {
      if (alive()) setError(formatUserError(e))
    } finally {
      if (alive()) setLoading(false)
    }
  }, [])

  useEffect(() => { void load() }, [load])

  const add = async () => {
    if (!name.trim() || saving) return
    setSaving(true)
    try {
      await createAlertRule({
        name: name.trim(),
        metric,
        comparator,
        threshold: Number(threshold) || 0,
        severity,
        scope_project: scopeProject.trim() || undefined,
        scope_tag: scopeTag.trim() || undefined,
        cooldown_minutes: Number(cooldown) || 30,
      })
      toast.success('Alert rule created')
      await load()
    } catch (e: unknown) {
      toast.error(formatUserError(e))
    } finally {
      setSaving(false)
    }
  }

  const remove = async (id: string) => {
    try {
      await deleteAlertRule(id)
      toast.success('Alert rule deleted')
      await load()
    } catch (e: unknown) {
      toast.error(formatUserError(e))
    }
  }

  const toggleEnabled = async (r: AlertRule) => {
    try {
      await setAlertRuleEnabled(r.id, !r.enabled)
      toast.success(r.enabled ? `Disabled '${r.name}'` : `Enabled '${r.name}'`)
      await load()
    } catch (e: unknown) {
      toast.error(formatUserError(e))
    }
  }

  return (
    <PlatformPageChrome
      eyebrow="Platform"
      error={error}
      onErrorRetry={() => void load()}
      prepend={<PlatformBackLink to="/platform/operations" label="Operations" />}
      title="Alert rules"
      subtitle="Threshold alerts on VM CPU / memory — fire notifications when a metric crosses a bound."
      icon={<Gauge className="w-6 h-6 text-[var(--text-muted)]" />}
      actions={<PlatformRefreshButton onClick={() => void load()} />}
      loading={loading && rows.length === 0}
      contentClassName="space-y-4"
    >
      <OperatingSurfaceLayout testId="platform-alert-rules-page">
        <MacGlassPanel title="New alert rule">
          <div className="grid gap-3 md:grid-cols-2 max-w-2xl">
            <input className="input text-sm" aria-label="Rule name" placeholder="Name" value={name} onChange={(e) => setName(e.target.value)} />
            <select className="input text-sm" aria-label="Metric" value={metric} onChange={(e) => setMetric(e.target.value as AlertMetric)}>
              <option value="cpu_percent">cpu_percent</option>
              <option value="mem_percent">mem_percent</option>
            </select>
            <select className="input text-sm" aria-label="Comparator" value={comparator} onChange={(e) => setComparator(e.target.value as AlertComparator)}>
              <option value="gt">greater than (gt)</option>
              <option value="lt">less than (lt)</option>
            </select>
            <input className="input text-sm" aria-label="Threshold" type="number" min={0} max={100} placeholder="Threshold %" value={threshold} onChange={(e) => setThreshold(e.target.value)} />
            <select className="input text-sm" aria-label="Severity" value={severity} onChange={(e) => setSeverity(e.target.value as AlertSeverity)}>
              <option value="info">info</option>
              <option value="warning">warning</option>
              <option value="critical">critical</option>
            </select>
            <input className="input text-sm" aria-label="Cooldown minutes" type="number" min={0} placeholder="Cooldown (minutes)" value={cooldown} onChange={(e) => setCooldown(e.target.value)} />
            <input className="input text-sm" aria-label="Scope project" placeholder="Scope project (optional)" value={scopeProject} onChange={(e) => setScopeProject(e.target.value)} />
            <input className="input text-sm" aria-label="Scope tag" placeholder="Scope tag (optional)" value={scopeTag} onChange={(e) => setScopeTag(e.target.value)} />
          </div>
          <button type="button" className="btn-primary text-sm mt-3 flex items-center gap-1.5" disabled={saving || !name.trim()} onClick={() => void add()}>
            <Plus className="w-4 h-4" /> {saving ? 'Saving…' : 'Add rule'}
          </button>
        </MacGlassPanel>

        <MacGlassPanel title="Active rules" subtitle={loading ? 'Loading…' : `${rows.length} rule(s)`}>
          {rows.length === 0 && !loading ? (
            <PlatformEmptyState
              icon={Gauge}
              title="No alert rules yet"
              subtitle="Add a threshold rule to be notified when VM CPU or memory crosses a bound."
            />
          ) : (
            <ul className="divide-y divide-white/[0.04] -mx-1">
              {rows.map((r) => (
                <MacListRow
                  key={r.id}
                  title={r.name}
                  subtitle={`${r.metric} ${r.comparator} ${r.threshold} · ${r.severity} · cooldown ${r.cooldown_minutes}m · ${
                    r.scope_project || r.scope_tag ? `scope ${r.scope_project || '*'}/${r.scope_tag || '*'}` : 'all VMs'
                  }${r.enabled ? '' : ' · disabled'} · last fired ${r.last_fired_at ? new Date(r.last_fired_at).toLocaleString() : 'never'}`}
                  badge={
                    <div className="flex items-center gap-1.5">
                      <button type="button" className="btn-secondary text-xs px-2 py-1" onClick={() => void toggleEnabled(r)}>
                        {r.enabled ? 'Disable' : 'Enable'}
                      </button>
                      <button type="button" className="btn-secondary text-xs p-1.5" aria-label="Delete" onClick={() => setConfirmDeleteId(r.id)}>
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  }
                />
              ))}
            </ul>
          )}
        </MacGlassPanel>
      </OperatingSurfaceLayout>
      <ConfirmDialog
        open={confirmDeleteId !== null}
        title="Delete Alert Rule"
        message={`Delete alert rule "${rows.find((r) => r.id === confirmDeleteId)?.name}"? It will stop firing notifications.`}
        confirmLabel="Delete"
        variant="danger"
        onCancel={() => setConfirmDeleteId(null)}
        onConfirm={async () => {
          await remove(confirmDeleteId!)
          setConfirmDeleteId(null)
        }}
      />
    </PlatformPageChrome>
  )
}
