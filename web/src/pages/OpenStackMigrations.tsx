// Copyright (c) 2026 ZyvorAI Labs Private Limited. All rights reserved.
// Proprietary software — see LICENSE in the repository root.
// https://zyvor.dev · info@zyvor.dev

import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router'
import {
  getHypersdkStatus,
  getHypersdkMigrationJob,
  listHypersdkMigrationJobs,
  listHypersdkProviders,
  listHypersdkProviderVms,
  submitHypersdkMigration,
  type HypersdkMigrationJob,
  type HypersdkProvider,
  type HypersdkProviderVm,
} from '../api/hypersdk'
import OpenStackFooter from '../components/OpenStackFooter'
import PageLayout from '../components/PageLayout'
import { usePlatformInfo } from '../contexts/PlatformInfoContext'
import { useToastContext } from '../contexts/ToastContext'
import OpenStackGate from '../components/OpenStackGate'
import OpenStackSubNav from '../components/OpenStackSubNav'
import OpenStackStatusBar from '../components/OpenStackStatusBar'
import { formatUserError } from '../utils/apiError'
import { statusSurfaceClasses, statusToneClass } from '../utils/semanticColors'
import ErrorBanner from '../components/ErrorBanner'
import { openStackErrorHints } from '../utils/openstackHints'
import HypersdkStatusBanner from '../components/HypersdkStatusBanner'
import { Cloud, ExternalLink, Loader2, Play, RefreshCw, Server } from 'lucide-react'

export default function OpenStackMigrationsPage() {
  return (
    <OpenStackGate title="OpenStack Migrations">
      <OpenStackMigrationsContent />
    </OpenStackGate>
  )
}

function OpenStackMigrationsContent() {
  const toast = useToastContext()
  const { info } = usePlatformInfo()
  const hypersdkEnabled = Boolean(info?.hypersdk?.enabled)

  const [status, setStatus] = useState<Awaited<ReturnType<typeof getHypersdkStatus>> | null>(null)
  const [providers, setProviders] = useState<HypersdkProvider[]>([])
  const [vms, setVms] = useState<HypersdkProviderVm[]>([])
  const [jobs, setJobs] = useState<HypersdkMigrationJob[]>([])
  const [selectedJobId, setSelectedJobId] = useState<string | null>(null)
  const [selectedJob, setSelectedJob] = useState<HypersdkMigrationJob | null>(null)
  const [jobDetailLoading, setJobDetailLoading] = useState(false)
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [submitVmName, setSubmitVmName] = useState('')
  const [submitVmId, setSubmitVmId] = useState('')
  const [submitDestPath, setSubmitDestPath] = useState('')
  const [submitAdvanced, setSubmitAdvanced] = useState(false)
  const [submitJson, setSubmitJson] = useState('')
  const [submitting, setSubmitting] = useState(false)

  const load = useCallback(async () => {
    if (!hypersdkEnabled) {
      setLoading(false)
      return
    }
    try {
      setLoadError(null)
      const [st, provRes, vmRes, jobRes] = await Promise.all([
        getHypersdkStatus(),
        listHypersdkProviders().catch(() => ({ providers: [] })),
        listHypersdkProviderVms('openstack').catch(() => ({ vms: [] })),
        listHypersdkMigrationJobs().catch(() => ({ jobs: [] })),
      ])
      setStatus(st)
      const provList = Array.isArray(provRes) ? provRes : provRes.providers ?? []
      setProviders(provList)
      const vmList = Array.isArray(vmRes) ? vmRes : vmRes.vms ?? []
      setVms(vmList)
      setJobs(jobRes.jobs ?? [])
    } catch (e: unknown) {
      toast.error(formatUserError(e))
    } finally {
      setLoading(false)
    }
  }, [hypersdkEnabled, toast])

  useEffect(() => {
    void load()
  }, [load])

  const loadJobDetail = useCallback(async (jobId: string) => {
    setSelectedJobId(jobId)
    setJobDetailLoading(true)
    try {
      const job = await getHypersdkMigrationJob(jobId)
      setSelectedJob(job)
    } catch (e: unknown) {
      setSelectedJob(null)
      toast.error(formatUserError(e))
    } finally {
      setJobDetailLoading(false)
    }
  }, [toast])

  const buildMigrationPayload = (): Record<string, unknown> => {
    if (submitAdvanced && submitJson.trim()) {
      const parsed = JSON.parse(submitJson) as Record<string, unknown>
      if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
        throw new Error('Advanced payload must be a JSON object')
      }
      return parsed
    }
    const body: Record<string, unknown> = { provider: 'openstack' }
    if (submitVmName.trim()) body.vm_name = submitVmName.trim()
    if (submitVmId.trim()) body.vm_id = submitVmId.trim()
    if (submitDestPath.trim()) body.dest_path = submitDestPath.trim()
    return body
  }

  const handleSubmitMigration = async () => {
    if (submitAdvanced) {
      if (!submitJson.trim()) {
        toast.warning('Enter JSON in advanced mode, or turn off Advanced JSON')
        return
      }
    } else if (!submitVmName.trim() && !submitVmId.trim()) {
      toast.warning('Enter a VM name or ID, or use advanced JSON')
      return
    }
    setSubmitting(true)
    try {
      const payload = buildMigrationPayload()
      const res = await submitHypersdkMigration(payload)
      const jobId = res.job_id ?? res.id
      toast.success(jobId ? `Migration job ${jobId} submitted` : 'Migration submitted')
      setSubmitVmName('')
      setSubmitVmId('')
      setSubmitDestPath('')
      void load()
    } catch (e: unknown) {
      toast.error(formatUserError(e))
    } finally {
      setSubmitting(false)
    }
  }

  const dashboardUrl = info?.openstack?.hypersdk_base_url
    ? `${info.openstack.hypersdk_base_url.replace(/\/$/, '')}/web/dashboard/`
    : info?.hypersdk?.base_url
      ? `${info.hypersdk.base_url.replace(/\/$/, '')}/web/dashboard/`
      : 'https://127.0.0.1:5080/web/dashboard/'

  return (
    <PageLayout
      hideHeader
      prepend={<>
      </>}
      error={loadError}
      errorTitle="Failed to load"
      errorHints={loadError ? openStackErrorHints(loadError) : undefined}
      technicalDetail={loadError}
      errorTone="red"
      onErrorRetry={() => void load()}
      onErrorDismiss={() => setLoadError(null)}
    >
      <HypersdkStatusBanner />
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold flex items-center gap-2">
            <Cloud className="w-7 h-7 text-sky-400" />
            Bulk migrations
          </h1>
          <p className="text-slate-400 text-sm mt-1">
            HyperSDK pipelines for multi-VM export and conversion (proxied through machina-daemon when enabled).
          </p>
        </div>
        <div className="flex gap-2">
          <a
            href={dashboardUrl}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-2 px-3 py-2 rounded-lg border border-slate-600 text-slate-200 hover:bg-slate-800 text-sm"
          >
            <ExternalLink className="w-4 h-4" />
            HyperSDK dashboard
          </a>
          <button
            type="button"
            onClick={() => { setLoading(true); void load() }}
            className="inline-flex items-center gap-2 px-3 py-2 rounded-lg border border-slate-600 text-slate-200 hover:bg-slate-800 text-sm"
          >
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
            Refresh
          </button>
        </div>
      </div>

      {!hypersdkEnabled && (
        <div className={`rounded-xl p-4 text-sm ${statusSurfaceClasses('warn')}`}>
          Enable <code className="opacity-90">[hypersdk] enabled = true</code> and set{' '}
          <code className="opacity-90">base_url</code> to hypervisord (default :5080), then restart machina-daemon.
        </div>
      )}

      {hypersdkEnabled && status?.reachable && (
        <section className="rounded-xl border border-sky-500/30 bg-sky-950/15 p-4 space-y-4">
          <h2 className="font-medium text-slate-200 flex items-center gap-2">
            <Play className="w-4 h-4 text-sky-400" />
            Submit migration job
          </h2>
          <p className="text-xs text-slate-500">
            Proxied to hypervisord <code className="text-slate-400">POST /api/v1/migrations/submit</code>.
            Pick a VM below or enter details manually.
          </p>
          {!submitAdvanced ? (
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              <div>
                <label className="block text-xs text-slate-500 mb-1">VM name</label>
                <input
                  value={submitVmName}
                  onChange={(e) => setSubmitVmName(e.target.value)}
                  list="hypersdk-vm-names"
                  className="w-full px-3 py-2 rounded-lg bg-slate-900 border border-slate-700 text-sm"
                  placeholder="from table or type…"
                />
                <datalist id="hypersdk-vm-names">
                  {vms.map((vm) => (
                    <option key={vm.id ?? vm.name} value={vm.name} />
                  ))}
                </datalist>
              </div>
              <div>
                <label className="block text-xs text-slate-500 mb-1">VM / instance ID (optional)</label>
                <input
                  value={submitVmId}
                  onChange={(e) => setSubmitVmId(e.target.value)}
                  className="w-full px-3 py-2 rounded-lg bg-slate-900 border border-slate-700 text-sm font-mono"
                  placeholder="Nova UUID"
                />
              </div>
              <div>
                <label className="block text-xs text-slate-500 mb-1">Destination path (optional)</label>
                <input
                  value={submitDestPath}
                  onChange={(e) => setSubmitDestPath(e.target.value)}
                  className="w-full px-3 py-2 rounded-lg bg-slate-900 border border-slate-700 text-sm font-mono"
                  placeholder="/var/lib/libvirt/images/export.qcow2"
                />
              </div>
            </div>
          ) : (
            <div>
              <label className="block text-xs text-slate-500 mb-1">JSON body (sent as-is)</label>
              <textarea
                aria-label="JSON body"
                value={submitJson}
                onChange={(e) => setSubmitJson(e.target.value)}
                rows={6}
                className="w-full px-3 py-2 rounded-lg bg-slate-900 border border-slate-700 text-xs font-mono"
                placeholder={'{\n  "provider": "openstack",\n  "vm_name": "my-vm"\n}'}
              />
            </div>
          )}
          <div className="flex flex-wrap items-center gap-3">
            <button
              type="button"
              disabled={submitting}
              onClick={() => void handleSubmitMigration()}
              className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-sky-600 hover:bg-sky-500 text-white text-sm font-medium disabled:opacity-50"
            >
              {submitting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Play className="w-4 h-4" />}
              {submitting ? 'Submitting…' : 'Submit job'}
            </button>
            <label className="flex items-center gap-2 text-sm text-slate-400 cursor-pointer">
              <input
                type="checkbox"
                checked={submitAdvanced}
                onChange={(e) => setSubmitAdvanced(e.target.checked)}
              />
              Advanced JSON
            </label>
          </div>
        </section>
      )}

      {hypersdkEnabled && status?.reachable && providers.length > 0 && (
        <section className="rounded-xl border border-slate-700/80 overflow-hidden">
          <h2 className="px-4 py-3 border-b border-slate-700/80 font-medium text-slate-200">HyperSDK providers</h2>
          <ul className="divide-y divide-slate-800 text-sm">
            {providers.map((p) => (
              <li key={p.provider} className="px-4 py-3 flex justify-between gap-4">
                <span className="text-slate-200">{p.name ?? p.provider}</span>
                <span className={statusToneClass(p.connected ? 'ok' : 'neutral')}>
                  {p.connected ? 'connected' : 'disconnected'}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="rounded-xl border border-slate-700/80 overflow-hidden">
        <div className="px-4 py-3 border-b border-slate-700/80 flex items-center gap-2">
          <Server className="w-4 h-4 text-sky-400" />
          <h2 className="font-medium text-slate-200">OpenStack VMs (HyperSDK)</h2>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm" aria-label="VM migrations">
            <thead className="bg-slate-900/80 text-slate-400 text-left">
              <tr>
                <th className="px-4 py-2">Name</th>
                <th className="px-4 py-2">Status</th>
                <th className="px-4 py-2">ID</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800">
              {loading && vms.length === 0 && (
                <tr><td colSpan={3} className="px-4 py-6 text-center text-slate-500">Loading…</td></tr>
              )}
              {!loading && vms.length === 0 && (
                <tr><td colSpan={3} className="px-4 py-6 text-center text-slate-500">
                  No VMs from HyperSDK. Connect OpenStack in the HyperSDK dashboard first.
                </td></tr>
              )}
              {vms.map((vm) => (
                <tr
                  key={vm.id ?? vm.name}
                  className="hover:bg-slate-800/40 cursor-pointer"
                  onClick={() => {
                    setSubmitVmName(vm.name)
                    if (vm.id) setSubmitVmId(vm.id)
                  }}
                  title="Click to use in submit form"
                >
                  <td className="px-4 py-2 text-slate-200">{vm.name}</td>
                  <td className="px-4 py-2">{vm.status ?? '—'}</td>
                  <td className="px-4 py-2 font-mono text-xs text-slate-500">{vm.id ?? '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="px-4 py-2 text-xs text-slate-500">
          Click a row to fill the submit form. Single-VM flows:{' '}
          <Link to="/openstack/instances" className="text-sky-400 hover:underline">Machina OpenStack instances</Link>
          {' '}or <Link to="/vms" className="text-sky-400 hover:underline">Push libvirt VM to Glance</Link>.
        </p>
      </section>

      <section className="rounded-xl border border-slate-700/80 overflow-hidden">
        <h2 className="px-4 py-3 border-b border-slate-700/80 font-medium text-slate-200">Recent migration jobs</h2>
        <ul className="divide-y divide-slate-800 text-sm">
          {jobs.length === 0 && (
            <li className="px-4 py-6 text-center text-slate-500">No jobs reported.</li>
          )}
          {jobs.map((j) => {
            const jobId = j.job_id ?? j.id ?? ''
            const active = selectedJobId === jobId
            return (
              <li key={jobId || j.vm_name}>
                <button
                  type="button"
                  className={`w-full px-4 py-3 flex justify-between gap-4 text-left hover:bg-slate-800/40 ${active ? 'bg-slate-800/60' : ''}`}
                  onClick={() => jobId && void loadJobDetail(jobId)}
                  disabled={!jobId}
                >
                  <span className="text-slate-200">{j.vm_name ?? jobId}</span>
                  <span className="text-slate-400">{j.status ?? '—'}</span>
                </button>
              </li>
            )
          })}
        </ul>
        {selectedJobId && (
          <div className="border-t border-slate-700/80 px-4 py-3 text-sm text-slate-300 space-y-2">
            {jobDetailLoading && <p className="text-slate-400">Loading job detail…</p>}
            {!jobDetailLoading && selectedJob && (
              <>
                <div className="flex flex-wrap gap-3 text-xs">
                  <span className="px-2 py-1 rounded bg-slate-800">Status: {selectedJob.status ?? '—'}</span>
                  {selectedJob.vm_name && <span className="px-2 py-1 rounded bg-slate-800">VM: {selectedJob.vm_name}</span>}
                  {selectedJob.created_at && <span className="px-2 py-1 rounded bg-slate-800">Created: {selectedJob.created_at}</span>}
                </div>
                <ol className="list-decimal pl-5 text-xs text-slate-400 space-y-1">
                  <li>Submitted to HyperSDK</li>
                  <li className={selectedJob.status === 'running' || selectedJob.status === 'completed' ? statusToneClass('ok') : ''}>Conversion in progress</li>
                  <li className={selectedJob.status === 'completed' ? statusToneClass('ok') : ''}>Import to target hypervisor</li>
                </ol>
              </>
            )}
            {!jobDetailLoading && !selectedJob && <p className="text-slate-500">No detail returned.</p>}
          </div>
        )}
      </section>

      <OpenStackFooter />
    </PageLayout>
  )
}
