// Copyright (c) 2026 ZyvorAI Labs Private Limited. All rights reserved.
// Proprietary software — see LICENSE in the repository root.
// https://zyvor.dev · info@zyvor.dev

import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router'
import { usePlatformInfo } from '../contexts/PlatformInfoContext'
import {
  listOpenStackInstances,
  startOpenStackInstance,
  stopOpenStackInstance,
  rebootOpenStackInstance,
  getOpenStackStatus,
  type OpenStackInstance,
  type OpenStackConnectionStatus,
} from '../api/openstack'
import { useToastContext } from '../contexts/ToastContext'
import { Play, Square, RotateCcw, Search, RefreshCw, Cloud, Plus, Lock, X } from 'lucide-react'
import OpenStackFooter from '../components/OpenStackFooter'
import OpenStackGate from '../components/OpenStackGate'
import OpenStackSubNav from '../components/OpenStackSubNav'
import OpenStackStatusBar from '../components/OpenStackStatusBar'
import { useOpenStackConnection } from '../hooks/useOpenStackConnection'
import EmptyState from '../components/EmptyState'
import PageLayout from '../components/PageLayout'
import { formatUserError } from '../utils/apiError'
import { openStackErrorHints } from '../utils/openstackHints'
import { openstackStatusTone, statusBadgeClasses, statusBorderClass, statusSurfaceClasses, statusToneClass } from '../utils/semanticColors'

const STATUS_CHIPS = ['', 'ACTIVE', 'SHUTOFF', 'ERROR', 'BUILD'] as const
const PAGE_SIZE = 25

function statusBadge(status: string) {
  return statusBadgeClasses(openstackStatusTone(status))
}

export default function OpenStackInstancesPage() {
  return (
    <OpenStackGate title="OpenStack Instances">
      <OpenStackInstancesContent />
    </OpenStackGate>
  )
}

function OpenStackInstancesContent() {
  const { computeLive } = useOpenStackConnection()
  const [instances, setInstances] = useState<OpenStackInstance[]>([])
  const [status, setStatus] = useState<OpenStackConnectionStatus | null>(null)
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState('')
  const [marker, setMarker] = useState<string | undefined>(undefined)
  const [markerStack, setMarkerStack] = useState<string[]>([])
  const [nextMarker, setNextMarker] = useState<string | undefined>(undefined)
  const [hasMore, setHasMore] = useState(false)
  const [searchTruncated, setSearchTruncated] = useState(false)
  const [total, setTotal] = useState<number | undefined>(undefined)
  const toast = useToastContext()
  const { lastEvent, refreshKey } = usePlatformInfo()

  const load = useCallback(async () => {
    if (!computeLive) {
      setLoading(false)
      return
    }
    try {
      setLoadError(null)
      const [conn, list] = await Promise.all([
        getOpenStackStatus(),
        listOpenStackInstances({
          search: search.trim() || undefined,
          status: statusFilter || undefined,
          limit: PAGE_SIZE,
          marker,
        }),
      ])
      setStatus(conn)
      setInstances(list.instances)
      setNextMarker(list.next_marker)
      setHasMore(Boolean(list.has_more))
      setSearchTruncated(Boolean(list.search_truncated))
      setTotal(list.total)
    } catch (e: unknown) {
      const msg = formatUserError(e)
      setLoadError(msg)
      toast.error(`Failed to load OpenStack instances: ${msg}`)
    } finally {
      setLoading(false)
    }
  }, [search, statusFilter, marker, toast, computeLive])

  useEffect(() => {
    setMarker(undefined)
    setMarkerStack([])
  }, [search, statusFilter])

  useEffect(() => {
    setLoading(true)
    const t = setTimeout(() => { load() }, search ? 300 : 0)
    return () => clearTimeout(t)
  }, [load, search])

  useEffect(() => {
    if (!lastEvent) return
    if (lastEvent.kind.startsWith('openstack.instance')) void load()
  }, [refreshKey, lastEvent, load])

  const runAction = async (
    inst: OpenStackInstance,
    fn: (id: string) => Promise<unknown>,
    label: string,
  ) => {
    try {
      await fn(inst.id)
      toast.success(`${label} '${inst.name}' OK`)
      load()
    } catch (e: unknown) {
      toast.error(`${label} failed: ${formatUserError(e)}`)
    }
  }

  const goNextPage = () => {
    if (!nextMarker) return
    setMarkerStack((stack) => [...stack, marker ?? ''])
    setMarker(nextMarker)
  }

  const goPrevPage = () => {
    setMarkerStack((stack) => {
      if (stack.length === 0) return stack
      const next = [...stack]
      const prev = next.pop() ?? ''
      setMarker(prev === '' ? undefined : prev)
      return next
    })
  }

  const canGoPrev = markerStack.length > 0 || marker !== undefined
  const pageLabel = total != null
    ? `${instances.length} instance${instances.length === 1 ? '' : 's'}`
    : `Page ${markerStack.length + 1}${hasMore ? '+' : ''} · ${instances.length} row${instances.length === 1 ? '' : 's'}`

  return (
    <PageLayout
      prepend={<><OpenStackSubNav /><OpenStackStatusBar /></>}
      title="OpenStack Instances"
      subtitle={
        <>
          Nova instances for cloud{' '}
          <span className="text-slate-200">{status?.cloud_name || '—'}</span>
          {status?.connected && status.instance_count != null && (
            <> · {status.instance_count} in project</>
          )}
        </>
      }
      icon={<Cloud className="w-7 h-7 text-sky-400" />}
      error={loadError}
      errorTitle="Failed to load instances"
      errorHints={loadError ? openStackErrorHints(loadError) : undefined}
      technicalDetail={loadError}
      errorTone="red"
      onErrorRetry={() => void load()}
      onErrorDismiss={() => setLoadError(null)}
      actions={
        <div className="flex gap-2">
          <Link
            to="/openstack/images"
            className="inline-flex items-center gap-2 px-3 py-2 rounded-lg border border-slate-600 text-slate-200 hover:bg-slate-800 text-sm"
          >
            Glance images
          </Link>
          <Link
            to="/openstack/create"
            className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-sky-600 hover:bg-sky-500 text-white text-sm font-medium"
          >
            <Plus className="w-4 h-4" />
            Create instance
          </Link>
          <button
            type="button"
            onClick={() => { setLoading(true); load() }}
            className="inline-flex items-center gap-2 px-3 py-2 rounded-lg border border-slate-600 text-slate-200 hover:bg-slate-800 text-sm"
          >
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
            Refresh
          </button>
        </div>
      }
    >

      {status?.error && (
        <div className={`p-3 rounded-lg text-sm ${statusSurfaceClasses('warn')}`}>
          {status.error}
        </div>
      )}

      {!computeLive && (
        <EmptyState
          icon={<Cloud className="w-6 h-6" />}
          title="Keystone is up — Nova is not"
          description="Identity works, but the compute API is unavailable. Install or start Nova (openstack-nova-api) on this host, or finish a minimal Packstack pass with Horizon disabled."
          secondaryAction={
            <Link to="/settings?openstack=1" className="px-4 py-2 rounded-lg border border-slate-600 text-slate-300 hover:bg-slate-800 text-sm">
              OpenStack settings
            </Link>
          }
        />
      )}

      {computeLive && (
        <>
      <div className="flex flex-wrap gap-3 items-center">
        <div className="relative flex-1 min-w-[200px] max-w-md">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" />
          <input
            type="search"
            aria-label="Search instances"
            placeholder="Search name or ID…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className={`w-full pl-10 py-2 rounded-lg bg-slate-900 border border-slate-700 text-slate-100 text-sm ${search ? 'pr-8' : 'pr-3'}`}
          />
          {search && (
            <button type="button" aria-label="Clear search" onClick={() => setSearch('')}
              className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-200">
              <X className="w-4 h-4" />
            </button>
          )}
        </div>
        <div className="flex flex-wrap gap-1">
          {STATUS_CHIPS.map((chip) => (
            <button
              key={chip || 'all'}
              type="button"
              onClick={() => setStatusFilter(chip)}
              className={`px-3 py-1 rounded-full text-xs font-medium border transition-colors ${
                statusFilter === chip
                  ? 'bg-sky-600 border-sky-500 text-white'
                  : 'border-slate-600 text-slate-400 hover:border-slate-500'
              }`}
            >
              {chip || 'All'}
            </button>
          ))}
        </div>
      </div>

      <div className="overflow-x-auto rounded-xl border border-slate-700/80">
        <table className="w-full text-sm" aria-label="OpenStack instances">
          <thead className="bg-slate-900/80 text-slate-400 text-left">
            <tr>
              <th className="px-4 py-3 font-medium">Name</th>
              <th className="px-4 py-3 font-medium">Status</th>
              <th className="px-4 py-3 font-medium">Flavor</th>
              <th className="px-4 py-3 font-medium">IPs</th>
              <th className="px-4 py-3 font-medium text-right">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-800">
            {loading && instances.length === 0 && (
              <tr>
                <td colSpan={5} className="px-4 py-8 text-center text-slate-500">
                  Loading…
                </td>
              </tr>
            )}
            {!loading && instances.length === 0 && (
              <tr>
                <td colSpan={5} className="px-4 py-8 text-center text-slate-500">
                  No instances match your filters.
                </td>
              </tr>
            )}
            {instances.map((inst) => (
              <tr key={inst.id} className="hover:bg-slate-800/40">
                <td className="px-4 py-3">
                  <Link
                    to={`/openstack/instances/${encodeURIComponent(inst.id)}`}
                    className="font-medium text-sky-400 hover:text-sky-300 inline-flex items-center gap-1.5"
                  >
                    {inst.name || inst.id.slice(0, 8)}
                    {inst.locked && (
                      <span title="Locked" className={`inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded border text-[10px] uppercase ${statusBadgeClasses('warn')} ${statusBorderClass('warn')}`}>
                        <Lock className="w-3 h-3" /> Locked
                      </span>
                    )}
                  </Link>
                  <div className="text-xs text-slate-500 font-mono truncate max-w-[220px]">{inst.id}</div>
                </td>
                <td className="px-4 py-3">
                  <span className={`inline-block px-2 py-0.5 rounded border text-xs ${statusBadge(inst.status)}`}>
                    {inst.status}
                  </span>
                </td>
                <td className="px-4 py-3 text-slate-300">
                  {inst.flavor_name || inst.flavor_id || '—'}
                </td>
                <td className="px-4 py-3 text-slate-400 font-mono text-xs">
                  {inst.ip_addresses?.length ? inst.ip_addresses.join(', ') : '—'}
                </td>
                <td className="px-4 py-3">
                  <div className="flex justify-end gap-1">
                    <button
                      type="button"
                      title="Start"
                      onClick={() => runAction(inst, startOpenStackInstance, 'Start')}
                      className={`p-2 rounded hover:bg-[color-mix(in_srgb,var(--machina-status-ok)_25%,transparent)] ${statusToneClass('ok')}`}
                    >
                      <Play className="w-4 h-4" />
                    </button>
                    <button
                      type="button"
                      title="Stop"
                      onClick={() => runAction(inst, stopOpenStackInstance, 'Stop')}
                      className={`p-2 rounded hover:bg-[color-mix(in_srgb,var(--machina-status-error)_25%,transparent)] ${statusToneClass('error')}`}
                    >
                      <Square className="w-4 h-4" />
                    </button>
                    <button
                      type="button"
                      title="Reboot"
                      onClick={() => runAction(inst, (id) => rebootOpenStackInstance(id, 'hard'), 'Reboot')}
                      className={`p-2 rounded hover:bg-[color-mix(in_srgb,var(--machina-status-warn)_25%,transparent)] ${statusToneClass('warn')}`}
                    >
                      <RotateCcw className="w-4 h-4" />
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {(searchTruncated || canGoPrev || hasMore) && (
        <div className="flex flex-wrap items-center justify-between gap-3 text-sm text-slate-400">
          <span>
            {pageLabel}
            {searchTruncated && (
              <span className={`ml-2 ${statusToneClass('warn')}`}>Search capped at 500 matches — refine query</span>
            )}
          </span>
          {(canGoPrev || hasMore) && (
          <div className="flex gap-2">
            <button type="button" disabled={!canGoPrev}
              className="px-3 py-1.5 rounded-lg border border-slate-600 disabled:opacity-40 hover:bg-slate-800"
              onClick={goPrevPage}>Previous</button>
            <button type="button" disabled={!hasMore || !nextMarker}
              className="px-3 py-1.5 rounded-lg border border-slate-600 disabled:opacity-40 hover:bg-slate-800"
              onClick={goNextPage}>Next</button>
          </div>
          )}
        </div>
      )}
        </>
      )}

      <OpenStackFooter />
    </PageLayout>
  )
}
