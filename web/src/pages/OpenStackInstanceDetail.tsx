// Copyright (c) 2026 ZyvorAI Labs Private Limited. All rights reserved.
// Proprietary software — see LICENSE in the repository root.
// https://zyvor.dev · info@zyvor.dev

import { useCallback, useEffect, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router'
import {
  getOpenStackInstance,
  listOpenStackInstanceVolumes,
  startOpenStackInstance,
  stopOpenStackInstance,
  rebootOpenStackInstance,
  deleteOpenStackInstance,
  forceDeleteOpenStackInstance,
  snapshotOpenStackInstance,
  type OpenStackInstance,
  type OpenStackAttachedVolume,
} from '../api/openstack'
import { usePlatformInfo } from '../contexts/PlatformInfoContext'
import { useToastContext } from '../contexts/ToastContext'
import ConfirmDialog from '../components/ConfirmDialog'
import PageSkeleton from '../components/PageSkeleton'
import {
  ArrowLeft, Play, Square, RotateCcw, Trash2, Camera, Copy, Cloud, HardDrive, Layers, Lock, Network, Archive,
} from 'lucide-react'
import { getOpenStackInstanceStack, shelveOpenStackInstance, unshelveOpenStackInstance } from '../api/openstackExtras'
import OpenStackFooter from '../components/OpenStackFooter'
import PageLayout from '../components/PageLayout'
import OpenStackInstanceAdvanced from '../components/OpenStackInstanceAdvanced'
import OpenStackExportModal from '../components/OpenStackExportModal'
import OpenStackGate from '../components/OpenStackGate'
import OpenStackSubNav from '../components/OpenStackSubNav'
import OpenStackStatusBar from '../components/OpenStackStatusBar'
import { formatUserError } from '../utils/apiError'
import { statusActionLinkClasses, statusBadgeClasses, statusBorderClass, statusDestructiveButtonClasses, statusSurfaceClasses, statusToneClass } from '../utils/semanticColors'
import { openStackErrorHints } from '../utils/openstackHints'
import ErrorBanner from '../components/ErrorBanner'

function CopyBtn({ text }: { text: string }) {
  const toast = useToastContext()
  return (
    <button
      type="button"
      title="Copy"
      onClick={() => {
        navigator.clipboard.writeText(text).then(
          () => toast.success('Copied'),
          () => toast.error('Copy failed'),
        )
      }}
      className="p-1 rounded hover:bg-slate-700 text-slate-400"
    >
      <Copy className="w-3.5 h-3.5" />
    </button>
  )
}

export default function OpenStackInstanceDetailPage() {
  return (
    <OpenStackGate>
      <OpenStackInstanceDetailContent />
    </OpenStackGate>
  )
}

function OpenStackInstanceDetailContent() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const toast = useToastContext()
  const { lastEvent, refreshKey } = usePlatformInfo()
  const [inst, setInst] = useState<OpenStackInstance | null>(null)
  const [volumes, setVolumes] = useState<OpenStackAttachedVolume[]>([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [deleteOpen, setDeleteOpen] = useState(false)
  const [forceDeleteOpen, setForceDeleteOpen] = useState(false)
  const [snapshotName, setSnapshotName] = useState('')
  const [snapshotBusy, setSnapshotBusy] = useState(false)
  const [exportOpen, setExportOpen] = useState(false)
  const [heatStack, setHeatStack] = useState<{ stack_id?: string; stack_name?: string } | null>(null)
  const [actionError, setActionError] = useState<{ label: string; message: string } | null>(null)

  const load = useCallback(async () => {
    if (!id) return
    setLoadError(null)
    try {
      const [data, vols, stackR] = await Promise.all([
        getOpenStackInstance(id),
        listOpenStackInstanceVolumes(id).catch(() => ({ volumes: [] as OpenStackAttachedVolume[] })),
        getOpenStackInstanceStack(id).catch(() => ({ stack: null })),
      ])
      setInst(data)
      setVolumes(vols.volumes)
      setHeatStack(stackR.stack)
      setActionError(null)
      if (!snapshotName) setSnapshotName(`${data.name}-snap`)
    } catch (e: unknown) {
      const msg = formatUserError(e)
      setLoadError(msg)
      setInst(null)
      toast.error(`Failed to load instance: ${msg}`)
    } finally {
      setLoading(false)
    }
  }, [id, toast])

  useEffect(() => { load() }, [load])

  useEffect(() => {
    if (!lastEvent || !id) return
    if (lastEvent.kind.startsWith('openstack.instance') && lastEvent.target === id) {
      void load()
    }
  }, [refreshKey, lastEvent, id, load])

  const runAction = async (fn: () => Promise<unknown>, label: string) => {
    try {
      await fn()
      setActionError(null)
      toast.success(`${label} OK`)
      load()
    } catch (e: unknown) {
      const message = formatUserError(e)
      setActionError({ label, message })
      toast.error(`${label} failed: ${message}`)
    }
  }

  const handleDelete = async () => {
    if (!inst) return
    setDeleteOpen(false)
    try {
      await deleteOpenStackInstance(inst.id)
      toast.success(`Deleted '${inst.name}'`)
      navigate('/openstack/instances')
    } catch (e: unknown) {
      toast.error(`Delete failed: ${formatUserError(e)}`)
    }
  }

  const handleForceDelete = async () => {
    if (!inst) return
    setForceDeleteOpen(false)
    try {
      await forceDeleteOpenStackInstance(inst.id)
      toast.success(`Force-deleted '${inst.name}'`)
      navigate('/openstack/instances')
    } catch (e: unknown) {
      toast.error(`Force delete failed: ${formatUserError(e)}`)
    }
  }

  const handleSnapshot = async () => {
    if (!inst || !snapshotName.trim()) return
    setSnapshotBusy(true)
    try {
      await snapshotOpenStackInstance(inst.id, snapshotName.trim())
      toast.success(`Snapshot requested: ${snapshotName}`)
    } catch (e: unknown) {
      toast.error(`Snapshot failed: ${formatUserError(e)}`)
    } finally {
      setSnapshotBusy(false)
    }
  }

  if (loading) {
    return <PageSkeleton />
  }
  if (loadError) {
    return (
      <div className="space-y-4 max-w-4xl">
        <OpenStackSubNav />
        <OpenStackStatusBar />
        <ErrorBanner
          title="Could not load instance"
          headline={loadError}
          hints={openStackErrorHints(loadError)}
          onRetry={() => {
            setLoading(true)
            void load()
          }}
        />
        <Link to="/openstack/instances" className="text-sky-400 hover:underline inline-flex items-center gap-1">
          <ArrowLeft className="w-4 h-4" /> Back to instances
        </Link>
      </div>
    )
  }
  if (!inst) {
    return (
      <div className="space-y-4">
        <p className="text-slate-400">Instance not found.</p>
        <Link to="/openstack/instances" className="text-sky-400 hover:underline">Back to list</Link>
      </div>
    )
  }

  const statusUp = inst.status.toUpperCase()
  const canShelve = ['ACTIVE', 'SHUTOFF', 'PAUSED'].includes(statusUp)
  const canUnshelve = statusUp.startsWith('SHELVED')

  return (
    <PageLayout
      hideHeader
      className="max-w-4xl"
      prepend={<><OpenStackSubNav /></>}
      error={loadError}
      errorTitle="Failed to load"
      errorHints={loadError ? openStackErrorHints(loadError) : undefined}
      technicalDetail={loadError}
      errorTone="red"
      onErrorRetry={() => void load()}
      onErrorDismiss={() => setLoadError(null)}
      >{inst.status.toUpperCase() === 'ERROR' && (
        <ErrorBanner
          title="Instance in ERROR state"
          headline="Nova reported ERROR for this server. Guest may not exist if compute uses fake.FakeDriver."
          hints={[
            'On the hypervisor: openstack server show ' + inst.id,
            'Check: journalctl -u openstack-nova-compute -n 40',
            ...openStackErrorHints('entered error'),
          ]}
          tone="red"
        />
      )}

      {inst.status.toUpperCase() === 'BUILD' && (
        <div className={`rounded-xl px-4 py-3 text-sm ${statusSurfaceClasses('warn')}`}>
          Instance is still building — refresh in a few seconds. Neutron will assign addresses when ACTIVE.
        </div>
      )}

      {heatStack && (heatStack.stack_id || heatStack.stack_name) && (
        <div className="rounded-xl border border-violet-500/30 bg-violet-950/20 px-4 py-3 text-sm flex flex-wrap items-center gap-2">
          <Layers className="w-4 h-4 text-violet-400 shrink-0" />
          <span className="text-violet-200">Heat stack</span>
          {heatStack.stack_name && heatStack.stack_id && (
            <Link
              to={`/openstack/heat/${encodeURIComponent(heatStack.stack_name)}/${encodeURIComponent(heatStack.stack_id)}`}
              className="font-medium text-sky-400 hover:underline"
            >
              {heatStack.stack_name}
            </Link>
          )}
          {heatStack.stack_name && !heatStack.stack_id && (
            <span className="font-medium text-slate-100">{heatStack.stack_name}</span>
          )}
          {heatStack.stack_id && (
            <span className="font-mono text-xs text-slate-400 break-all">{heatStack.stack_id}</span>
          )}
        </div>
      )}

      <Link to="/openstack/instances" className="inline-flex items-center gap-2 text-slate-400 hover:text-slate-200 text-sm">
        <ArrowLeft className="w-4 h-4" />
        Instances
      </Link>

      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold flex items-center gap-2">
            <Cloud className="w-7 h-7 text-sky-400" />
            {inst.name}
            {inst.locked && (
              <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded border text-xs font-medium uppercase ${statusBadgeClasses('warn')} ${statusBorderClass('warn')}`}>
                <Lock className="w-3.5 h-3.5" /> Locked
              </span>
            )}
          </h1>
          <p className="text-slate-500 font-mono text-sm mt-1">{inst.id}</p>
          <Link to={`/openstack/instances/${inst.id}/interfaces`} className="inline-flex items-center gap-1.5 text-sm text-sky-400 hover:underline mt-2">
            <Network className="w-4 h-4" /> Manage network interfaces
          </Link>
        </div>
        <div className="flex flex-col gap-2 min-w-0 flex-1 sm:max-w-xl">
          {actionError && (
            <ErrorBanner
              title={`${actionError.label} failed`}
              headline={actionError.message}
              hints={openStackErrorHints(actionError.message)}
              onDismiss={() => setActionError(null)}
            />
          )}
          <div className="flex flex-wrap gap-2">
          <button type="button" onClick={() => runAction(() => startOpenStackInstance(inst.id), 'Start')}
            className="inline-flex items-center gap-1 px-3 py-2 rounded-lg bg-emerald-600/80 hover:bg-emerald-500 text-sm text-white">
            <Play className="w-4 h-4" /> Start
          </button>
          <button type="button" onClick={() => runAction(() => stopOpenStackInstance(inst.id), 'Stop')}
            className="inline-flex items-center gap-1 px-3 py-2 rounded-lg border border-slate-600 hover:bg-slate-800 text-sm">
            <Square className="w-4 h-4" /> Stop
          </button>
          <button type="button" onClick={() => runAction(() => rebootOpenStackInstance(inst.id, 'soft'), 'Soft reboot')}
            className="inline-flex items-center gap-1 px-3 py-2 rounded-lg border border-slate-600 hover:bg-slate-800 text-sm">
            <RotateCcw className="w-4 h-4" /> Soft reboot
          </button>
          <button type="button" onClick={() => runAction(() => rebootOpenStackInstance(inst.id, 'hard'), 'Hard reboot')}
            className={`inline-flex items-center gap-1 px-3 py-2 rounded-lg border text-sm ${statusBadgeClasses('warn')} border-[color-mix(in_srgb,var(--machina-status-warn)_40%,transparent)] hover:bg-[color-mix(in_srgb,var(--machina-status-warn)_10%,transparent)]`}>
            <RotateCcw className="w-4 h-4" /> Hard reboot
          </button>
          {canShelve && (
            <button type="button" onClick={() => runAction(() => shelveOpenStackInstance(inst.id), 'Shelve')}
              className="inline-flex items-center gap-1 px-3 py-2 rounded-lg border border-slate-600 hover:bg-slate-800 text-sm">
              <Archive className="w-4 h-4" /> Shelve
            </button>
          )}
          {canUnshelve && (
            <button type="button" onClick={() => runAction(() => unshelveOpenStackInstance(inst.id), 'Unshelve')}
              className="inline-flex items-center gap-1 px-3 py-2 rounded-lg border border-sky-600/50 text-sky-200 hover:bg-sky-500/10 text-sm">
              <Archive className="w-4 h-4" /> Unshelve
            </button>
          )}
          <button type="button" onClick={() => setDeleteOpen(true)}
            className={statusDestructiveButtonClasses('hover:opacity-90')}>
            <Trash2 className="w-4 h-4" /> Delete
          </button>
          <button type="button" onClick={() => setForceDeleteOpen(true)}
            className={statusDestructiveButtonClasses('text-sm hover:opacity-90')}
            title="Nova forceDelete — use when normal delete is stuck">
            <Trash2 className="w-4 h-4" /> Force delete
          </button>
          </div>
        </div>
      </div>

      <dl className="grid grid-cols-1 sm:grid-cols-2 gap-4 rounded-xl border border-slate-700/80 p-4 bg-slate-900/40">
        <div>
          <dt className="text-xs text-slate-500 uppercase">Status</dt>
          <dd className="text-slate-100 mt-1">{inst.status} · {inst.power_state}</dd>
        </div>
        <div>
          <dt className="text-xs text-slate-500 uppercase">Flavor</dt>
          <dd className="text-slate-100 mt-1">{inst.flavor_name || inst.flavor_id || '—'}</dd>
        </div>
        <div>
          <dt className="text-xs text-slate-500 uppercase">Availability zone</dt>
          <dd className="text-slate-100 mt-1">{inst.availability_zone || '—'}</dd>
        </div>
        <div>
          <dt className="text-xs text-slate-500 uppercase">Key pair</dt>
          <dd className="text-slate-100 mt-1">{inst.key_name || '—'}</dd>
        </div>
        <div>
          <dt className="text-xs text-slate-500 uppercase">Image</dt>
          <dd className="text-slate-100 mt-1 font-mono text-sm">{inst.image_id || '—'}</dd>
        </div>
        <div>
          <dt className="text-xs text-slate-500 uppercase">Created</dt>
          <dd className="text-slate-100 mt-1 text-sm">{inst.created_at || '—'}</dd>
        </div>
      </dl>

      <section className="rounded-xl border border-slate-700/80 p-4">
        <h2 className="font-medium text-slate-200 mb-3">Network addresses</h2>
        {inst.ip_addresses.length === 0 ? (
          <p className="text-slate-500 text-sm">No addresses reported.</p>
        ) : (
          <ul className="space-y-2">
            {inst.ip_addresses.map((ip) => (
              <li key={ip} className="flex items-center gap-2 font-mono text-sm text-slate-300">
                {ip}
                <CopyBtn text={ip} />
              </li>
            ))}
          </ul>
        )}
      </section>

      {inst.security_groups.length > 0 && (
        <section className="rounded-xl border border-slate-700/80 p-4">
          <h2 className="font-medium text-slate-200 mb-2">Security groups</h2>
          <p className="text-slate-400 text-sm">{inst.security_groups.join(', ')}</p>
        </section>
      )}

      <OpenStackInstanceAdvanced inst={inst} volumes={volumes} onRefresh={load} />

      <section className="rounded-xl border border-slate-700/80 p-4 space-y-4">
        <h2 className="font-medium text-slate-200">Migration &amp; export</h2>
        <p className="text-slate-400 text-sm">
          Snapshot creates a Glance image from this instance. After it reaches ACTIVE, pull it from{' '}
          <Link to="/openstack/images" className="text-sky-400 hover:underline">Glance images</Link>
          {' '}to the hypervisor, then import as libvirt. Push on-host qcow2 from Disk images, or use HyperSDK for bulk export.
        </p>
        <div className="flex flex-wrap gap-3 items-end">
          <div>
            <label className="block text-xs text-slate-500 mb-1">Snapshot image name</label>
            <input
              value={snapshotName}
              onChange={(e) => setSnapshotName(e.target.value)}
              className="px-3 py-2 rounded-lg bg-slate-900 border border-slate-700 text-sm text-slate-100"
            />
          </div>
          <button
            type="button"
            disabled={snapshotBusy}
            onClick={handleSnapshot}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-sky-600 hover:bg-sky-500 text-white text-sm disabled:opacity-50"
          >
            <Camera className="w-4 h-4" />
            Create snapshot
          </button>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => setExportOpen(true)}
            className="inline-flex items-center gap-2 px-3 py-2 rounded-lg bg-sky-600 hover:bg-sky-500 text-white text-sm"
          >
            <HardDrive className="w-4 h-4" />
            Export & pull to hypervisor
          </button>
          <Link
            to={`/disk-images?os=open&glance_name=${encodeURIComponent(inst.name)}`}
            className="inline-flex items-center gap-2 px-3 py-2 rounded-lg border border-sky-500/40 text-sky-300 hover:bg-sky-500/10 text-sm"
          >
            Push qcow2 to Glance
          </Link>
          <Link
            to="/openstack/migrations"
            className="inline-flex items-center gap-2 px-3 py-2 rounded-lg border border-slate-600 text-slate-300 hover:bg-slate-800 text-sm"
          >
            Bulk migrations
          </Link>
        </div>
      </section>

      {inst && (
        <OpenStackExportModal
          open={exportOpen}
          instanceId={inst.id}
          instanceName={inst.name}
          onClose={() => setExportOpen(false)}
        />
      )}

      <OpenStackFooter />

      <ConfirmDialog
        open={deleteOpen}
        title="Delete OpenStack instance"
        message={`This permanently deletes ${inst.name} in Nova.`}
        typeToMatch={inst.name}
        confirmLabel="Delete"
        variant="danger"
        onConfirm={handleDelete}
        onCancel={() => setDeleteOpen(false)}
      />
      <ConfirmDialog
        open={forceDeleteOpen}
        title="Force delete instance"
        message={`Nova forceDelete removes ${inst.name} even when soft-delete fails. Use only for stuck ERROR/BUILD servers.`}
        typeToMatch={inst.name}
        confirmLabel="Force delete"
        variant="danger"
        onConfirm={handleForceDelete}
        onCancel={() => setForceDeleteOpen(false)}
      />
    </PageLayout>
  )
}
