// Copyright (c) 2026 ZyvorAI Labs Private Limited. All rights reserved.
// Proprietary software — see LICENSE in the repository root.
// https://zyvor.dev · info@zyvor.dev

import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router'
import { Server, RefreshCw, Play, Square, Power, BarChart3 } from 'lucide-react'
import PageLayout from '../components/PageLayout'
import EmptyState from '../components/EmptyState'
import CopyButton from '../components/CopyButton'
import {
  getFleetStatus,
  getFleetVms,
  getFleetMetrics,
  getFleetAlerts,
  postFleetPlacement,
  postFleetCreateVm,
  fleetPeerProxy,
  fleetPrometheusAggregateUrl,
  type FleetPeerStatus,
  type FleetVmRow,
  type FleetMetricsResponse,
  type FleetAlertPeer,
  type PlacementCandidate,
} from '../api/fleet'
import { useToastContext } from '../contexts/ToastContext'
import { formatUserError } from '../utils/apiError'
import { hubLinkClasses, statusToneClass } from '../utils/semanticColors'
import { useTranslation } from 'react-i18next'

export default function FleetPage() {
  const { t } = useTranslation()
  const toast = useToastContext()
  const [loadError, setLoadError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [peers, setPeers] = useState<FleetPeerStatus[]>([])
  const [vms, setVms] = useState<FleetVmRow[]>([])
  const [enabled, setEnabled] = useState(false)
  const [primaryPeer, setPrimaryPeer] = useState('')
  const [standbyPeer, setStandbyPeer] = useState('')
  const [busy, setBusy] = useState<string | null>(null)
  const [metrics, setMetrics] = useState<FleetMetricsResponse | null>(null)
  const [fleetAlerts, setFleetAlerts] = useState<FleetAlertPeer[]>([])
  const [fleetAlertsTotal, setFleetAlertsTotal] = useState(0)
  const [placementVcpus, setPlacementVcpus] = useState(2)
  const [placementMemMb, setPlacementMemMb] = useState(2048)
  const [placement, setPlacement] = useState<PlacementCandidate[] | null>(null)
  const [placementBusy, setPlacementBusy] = useState(false)
  const [createVmName, setCreateVmName] = useState('')
  const [createBusy, setCreateBusy] = useState(false)

  const load = useCallback(async () => {
    setLoadError(null)
    try {
      const [st, vmRows, met, alerts] = await Promise.all([
        getFleetStatus(),
        getFleetVms(),
        getFleetMetrics(),
        getFleetAlerts(),
      ])
      setEnabled(Boolean(st.enabled))
      setPrimaryPeer(st.primary_peer ?? '')
      setStandbyPeer(st.standby_peer ?? '')
      setPeers(st.peers ?? [])
      setVms(vmRows.vms ?? [])
      setMetrics(met)
      setFleetAlerts(alerts.peers ?? [])
      setFleetAlertsTotal(alerts.total_unacknowledged ?? 0)
    } catch (e: unknown) {
      setLoadError(formatUserError(e))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const peerAction = async (peer: string, vmName: string, action: 'start' | 'stop' | 'shutdown') => {
    const key = `${peer}/${vmName}/${action}`
    setBusy(key)
    try {
      await fleetPeerProxy(peer, 'POST', `/vms/${encodeURIComponent(vmName)}/${action}`)
      toast.success(t('fleet.actionOk', { peer, vm: vmName, action }))
      await load()
    } catch (e: unknown) {
      toast.error(formatUserError(e))
    } finally {
      setBusy(null)
    }
  }

  return (
    <PageLayout
      title={t('fleet.title')}
      subtitle={t('fleet.subtitle')}
      icon={<Server className="w-8 h-8" />}
      loading={loading}
      error={loadError}
      errorTitle={t('fleet.title')}
      onErrorRetry={() => void load()}
      actions={
        <button
          type="button"
          onClick={() => void load()}
          className="btn-secondary flex items-center gap-2"
          aria-label={t('common.refresh')}
        >
          <RefreshCw className="w-4 h-4" />
          {t('common.refresh')}
        </button>
      }
    >
      {!enabled ? (
        <div className="rounded-xl border border-slate-700/50 bg-slate-800/40 px-4 py-3 space-y-2">
          <p className="text-slate-400 text-sm">{t('fleet.disabledHint')}</p>
          <p className="text-xs text-slate-500">
            Enable fleet mode in machina config, or return to the{' '}
            <Link to="/platform" className={hubLinkClasses()}>Platform desktop</Link>
            {' · '}
            <Link to="/platform/integrations" className={hubLinkClasses()}>Apps &amp; Integrations</Link>
          </p>
        </div>
      ) : (
        <p className="text-slate-400 text-sm">
          {primaryPeer ? t('fleet.primaryPeer', { name: primaryPeer }) : null}
          {standbyPeer ? ` · ${t('fleet.standbyPeer', { name: standbyPeer })}` : null}
        </p>
      )}

      <section aria-labelledby="fleet-peers-heading">
        <h2 id="fleet-peers-heading" className="text-lg font-semibold mb-3">
          {t('fleet.peers')}
        </h2>
        <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
          {peers.map((p) => (
            <div
              key={p.name}
              className="rounded-xl border border-slate-700/50 bg-slate-800/40 p-4"
            >
              <div className="font-medium text-slate-100">{p.name}</div>
              <div className="text-xs text-slate-500 truncate" title={p.url}>
                {p.url}
              </div>
              <div className="mt-2 text-sm">
                <span className={statusToneClass(p.reachable ? 'ok' : 'warn')}>
                  {p.reachable ? t('fleet.reachable') : t('fleet.unreachable')}
                </span>
                {p.version ? (
                  <span className="text-slate-500 ml-2">v{p.version}</span>
                ) : null}
                {p.vm_count != null ? (
                  <span className="text-slate-500 ml-2">
                    {t('fleet.vmCount', { count: p.vm_count })}
                  </span>
                ) : null}
              </div>
              {p.host_cpu_percent != null ? (
                <div className="mt-2 text-xs text-slate-400">
                  CPU {p.host_cpu_percent.toFixed(0)}%
                  {p.host_memory_percent != null
                    ? ` · mem ${p.host_memory_percent.toFixed(0)}%`
                    : ''}
                  {p.vms_running != null ? ` · ${p.vms_running} running` : ''}
                </div>
              ) : null}
              {p.error ? (
                <p className={`text-xs mt-1 ${statusToneClass('warn')}`}>{p.error}</p>
              ) : null}
            </div>
          ))}
        </div>
        {enabled && peers.length === 0 && !loadError && (
          <EmptyState
            title={t('fleet.noPeersTitle', { defaultValue: 'No fleet peers configured' })}
            description={t('fleet.noPeersHint', { defaultValue: 'Add peer URLs in Settings to aggregate VMs and metrics across Machina nodes.' })}
            primaryAction={
              <Link to="/settings" className="btn-primary text-sm">
                {t('fleet.openSettings', { defaultValue: 'Open Settings' })}
              </Link>
            }
          />
        )}
      </section>

      {enabled ? (
        <section
          className="rounded-xl border border-slate-700/50 bg-slate-800/40 p-4 space-y-3"
          aria-labelledby="fleet-prometheus-heading"
        >
          <h2
            id="fleet-prometheus-heading"
            className="text-lg font-semibold flex items-center gap-2"
          >
            <BarChart3 className="w-5 h-5 text-sky-400" />
            {t('fleet.prometheusTitle')}
          </h2>
          <p className="text-xs text-slate-500">{t('fleet.prometheusHint')}</p>
          <code className="block text-xs text-slate-300 break-all bg-slate-900/60 rounded-lg px-3 py-2 border border-slate-700/40">
            {fleetPrometheusAggregateUrl()}
          </code>
          <div className="flex flex-wrap gap-2">
            <CopyButton
              text={fleetPrometheusAggregateUrl()}
              label={t('fleet.prometheusCopyUrl')}
            />
            <a
              href={fleetPrometheusAggregateUrl()}
              target="_blank"
              rel="noreferrer"
              className="btn-secondary text-sm"
            >
              {t('fleet.prometheusOpen')}
            </a>
          </div>
        </section>
      ) : null}

      <section className="rounded-xl border border-slate-700/50 bg-slate-800/40 p-4 space-y-3">
        <h2 className="text-lg font-semibold">VM placement</h2>
        <p className="text-xs text-slate-500">
          Rank hypervisors by capacity headroom (CPU, memory, disk) minus requested VM size.
        </p>
        <div className="flex flex-wrap gap-3 items-end text-sm">
          <label>
            <span className="text-xs text-slate-500">vCPUs</span>
            <input
              type="number"
              min={1}
              className="input-field block mt-1 w-20"
              value={placementVcpus}
              onChange={(e) => setPlacementVcpus(Number(e.target.value) || 1)}
            />
          </label>
          <label>
            <span className="text-xs text-slate-500">Memory (MiB)</span>
            <input
              type="number"
              min={256}
              className="input-field block mt-1 w-28"
              value={placementMemMb}
              onChange={(e) => setPlacementMemMb(Number(e.target.value) || 256)}
            />
          </label>
          <button
            type="button"
            disabled={placementBusy}
            className="btn-secondary"
            onClick={async () => {
              setPlacementBusy(true)
              try {
                const res = await postFleetPlacement(placementVcpus, placementMemMb)
                setPlacement(res.candidates ?? [])
              } catch (e: unknown) {
                toast.error(formatUserError(e))
              } finally {
                setPlacementBusy(false)
              }
            }}
          >
            {placementBusy ? 'Ranking…' : 'Suggest peer'}
          </button>
          <label className="flex flex-col gap-1">
            <span className="text-xs text-slate-500">VM name (peer create)</span>
            <input
              className="input-field w-40"
              value={createVmName}
              onChange={(e) => setCreateVmName(e.target.value)}
              placeholder="my-vm"
            />
          </label>
          <button
            type="button"
            disabled={createBusy || !createVmName.trim()}
            className="btn-secondary"
            onClick={async () => {
              setCreateBusy(true)
              try {
                const res = await postFleetCreateVm(
                  {
                    name: createVmName.trim(),
                    vcpus: placementVcpus,
                    memory_mb: placementMemMb,
                    disk_gb: 20,
                  },
                  {
                    autoPlace: true,
                    placementVcpus,
                    placementMemoryMb: placementMemMb,
                  },
                )
                if (res.action === 'create_local') {
                  toast.info(res.message ?? 'Create this VM on the local host via VMs → Create')
                } else {
                  toast.success(`Create proxied to ${res.peer} (HTTP ${res.status ?? '?'})`)
                }
                await load()
              } catch (e: unknown) {
                toast.error(formatUserError(e))
              } finally {
                setCreateBusy(false)
              }
            }}
          >
            {createBusy ? 'Creating…' : 'Create on best peer'}
          </button>
        </div>
        {placement && placement.length > 0 ? (
          <ul className="text-xs text-slate-400 space-y-1">
            {placement.map((c) => (
              <li key={c.peer}>
                <span className={c.recommended ? `${statusToneClass('ok')} font-medium` : ''}>
                  {c.peer}
                  {c.recommended ? ' ← recommended' : ''}
                </span>
                {c.reachable && c.capacity.adjusted_score != null
                  ? ` · score ${c.capacity.adjusted_score} (${c.capacity.label})`
                  : ''}
                {c.error ? ` · ${c.error}` : ''}
              </li>
            ))}
          </ul>
        ) : null}
      </section>

      {metrics ? (
        <section className="rounded-xl border border-slate-700/50 bg-slate-800/40 p-4">
          <h2 className="text-lg font-semibold mb-3">Fleet capacity</h2>
          <div className="grid sm:grid-cols-2 lg:grid-cols-5 gap-3 text-sm">
            <div>
              <div className="text-slate-500 text-xs">Local CPU</div>
              <div className="text-slate-100">{metrics.local.host_cpu_percent.toFixed(1)}%</div>
            </div>
            <div>
              <div className="text-slate-500 text-xs">Local memory</div>
              <div className="text-slate-100">{metrics.local.host_memory_percent.toFixed(1)}%</div>
            </div>
            {metrics.local.host_disk_percent != null ? (
              <div>
                <div className="text-slate-500 text-xs">Local disk</div>
                <div className="text-slate-100">{metrics.local.host_disk_percent.toFixed(1)}%</div>
              </div>
            ) : null}
            <div>
              <div className="text-slate-500 text-xs">Local VMs</div>
              <div className="text-slate-100">
                {metrics.local.vms_running} / {metrics.local.vm_count} running
              </div>
            </div>
            <div>
              <div className="text-slate-500 text-xs">Load (1m)</div>
              <div className="text-slate-100">{metrics.local.load_1.toFixed(2)}</div>
            </div>
            {metrics.local.capacity ? (
              <div>
                <div className="text-slate-500 text-xs">Capacity score</div>
                <div className="text-slate-100">
                  {metrics.local.capacity.score} ({metrics.local.capacity.label})
                </div>
              </div>
            ) : null}
          </div>
          {metrics.peers.some((p) => p.capacity) ? (
            <ul className="mt-3 text-xs text-slate-400 space-y-1">
              {metrics.peers
                .filter((p) => p.capacity)
                .map((p) => (
                  <li key={p.name}>
                    {p.name}: capacity {p.capacity!.score} ({p.capacity!.label})
                    {p.host_cpu_percent != null
                      ? ` · CPU ${p.host_cpu_percent.toFixed(0)}%`
                      : ''}
                  </li>
                ))}
            </ul>
          ) : null}
        </section>
      ) : null}

      {fleetAlerts.length > 0 ? (
        <section className="rounded-xl border border-slate-700/50 bg-slate-800/40 p-4">
          <h2 className="text-lg font-semibold mb-2">
            Fleet alerts
            {fleetAlertsTotal > 0 ? (
              <span className={`ml-2 text-sm font-normal ${statusToneClass('warn')}`}>
                {fleetAlertsTotal} unacknowledged
              </span>
            ) : null}
          </h2>
          <div className="space-y-3 text-sm">
            {fleetAlerts.map((row) => (
              <div key={row.peer}>
                <div className="font-medium text-slate-200">{row.peer}</div>
                {row.error ? (
                  <p className={`text-xs ${statusToneClass('warn')}`}>{row.error}</p>
                ) : row.alerts.length === 0 ? (
                  <p className="text-xs text-slate-500">No alerts</p>
                ) : (
                  <ul className="mt-1 text-xs text-slate-400 list-disc pl-4">
                    {row.alerts
                      .filter((a) => !a.acknowledged)
                      .slice(0, 5)
                      .map((a) => (
                        <li key={a.id}>
                          [{a.severity}] {a.message}
                        </li>
                      ))}
                  </ul>
                )}
              </div>
            ))}
          </div>
        </section>
      ) : null}

      <section aria-labelledby="fleet-vms-heading">
        <h2 id="fleet-vms-heading" className="text-lg font-semibold mb-3">
          {t('fleet.allVms')}
        </h2>
        <div className="overflow-x-auto rounded-xl border border-slate-700/50">
          <table className="w-full text-sm">
            <thead className="bg-slate-800/60 text-slate-400">
              <tr>
                <th className="px-4 py-2 text-left">{t('fleet.colName')}</th>
                <th className="px-4 py-2 text-left">{t('fleet.colPeer')}</th>
                <th className="px-4 py-2 text-left">{t('fleet.colState')}</th>
                <th className="px-4 py-2 text-right">{t('fleet.colActions')}</th>
              </tr>
            </thead>
            <tbody>
              {vms.map((vm) => (
                <tr key={`${vm.peer}/${vm.name}`} className="border-t border-slate-700/40">
                  <td className="px-4 py-2">
                    {vm.peer === 'local' ? (
                      <Link
                        to={`/vms/${encodeURIComponent(vm.name)}`}
                        className={`${hubLinkClasses()} hover:underline`}
                      >
                        {vm.name}
                      </Link>
                    ) : (
                      vm.name
                    )}
                  </td>
                  <td className="px-4 py-2 text-slate-400">{vm.peer}</td>
                  <td className="px-4 py-2">{vm.state}</td>
                  <td className="px-4 py-2 text-right">
                    {vm.peer !== 'local' ? (
                      <div className="flex justify-end gap-1">
                        <button
                          type="button"
                          disabled={busy != null}
                          onClick={() => void peerAction(vm.peer, vm.name, 'start')}
                          className={`p-1 rounded hover:bg-[color-mix(in_srgb,var(--machina-status-ok)_25%,transparent)]`}
                          title={t('fleet.start')}
                          aria-label={t('fleet.start')}
                        >
                          <Play className="w-4 h-4" />
                        </button>
                        <button
                          type="button"
                          disabled={busy != null}
                          onClick={() => void peerAction(vm.peer, vm.name, 'shutdown')}
                          className={`p-1 rounded hover:bg-[color-mix(in_srgb,var(--machina-status-warn)_25%,transparent)]`}
                          title={t('fleet.shutdown')}
                          aria-label={t('fleet.shutdown')}
                        >
                          <Power className="w-4 h-4" />
                        </button>
                        <button
                          type="button"
                          disabled={busy != null}
                          onClick={() => void peerAction(vm.peer, vm.name, 'stop')}
                          className={`p-1 rounded hover:bg-[color-mix(in_srgb,var(--machina-status-error)_25%,transparent)]`}
                          title={t('fleet.stop')}
                          aria-label={t('fleet.stop')}
                        >
                          <Square className="w-4 h-4" />
                        </button>
                      </div>
                    ) : (
                      <span className="text-slate-600 text-xs">{t('fleet.localHost')}</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {vms.length === 0 ? (
            <p className="p-4 text-slate-500 text-sm">{t('fleet.noVms')}</p>
          ) : null}
        </div>
      </section>
    </PageLayout>
  )
}
