// Copyright (c) 2026 ZyvorAI Labs Private Limited. All rights reserved.

import { useCallback, useEffect, useState } from 'react'
import { Link, useParams } from 'react-router'
import { ArrowLeft, Camera, Loader2 } from 'lucide-react'
import {
  createOpenStackVolumeFromSnapshot,
  deleteOpenStackVolumeSnapshot,
  getOpenStackVolumeSnapshot,
  type OpenStackVolumeSnapshot,
} from '../api/openstackExtras'
import OpenStackGate from '../components/OpenStackGate'
import OpenStackSubNav from '../components/OpenStackSubNav'
import OpenStackFooter from '../components/OpenStackFooter'
import PageLayout from '../components/PageLayout'
import PageSkeleton from '../components/PageSkeleton'
import { useToastContext } from '../contexts/ToastContext'
import { formatUserError } from '../utils/apiError'

export default function OpenStackVolumeSnapshotDetailPage() {
  return (
    <OpenStackGate title="Volume snapshot">
      <OpenStackVolumeSnapshotDetailContent />
    </OpenStackGate>
  )
}

function OpenStackVolumeSnapshotDetailContent() {
  const { id } = useParams<{ id: string }>()
  const toast = useToastContext()
  const [snapshot, setSnapshot] = useState<OpenStackVolumeSnapshot | null>(null)
  const [restoreName, setRestoreName] = useState('')
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    if (!id) return
    setLoading(true)
    try {
      const { snapshot: s } = await getOpenStackVolumeSnapshot(id)
      setSnapshot(s)
      setRestoreName(`${s.name || 'vol'}-restored`)
    } catch (e: unknown) {
      toast.error(formatUserError(e))
      setSnapshot(null)
    } finally {
      setLoading(false)
    }
  }, [id, toast])

  useEffect(() => { void load() }, [load])

  if (loading) return <PageSkeleton />
  if (!snapshot) {
    return (
      <div className="space-y-4">
        <OpenStackSubNav />
        <Link to="/openstack/volume-snapshots" className="text-sky-400 hover:underline">Back</Link>
      </div>
    )
  }

  return (
    <PageLayout
      hideHeader
      className="max-w-3xl"
      prepend={<><OpenStackSubNav /></>}
    >
      <Link to="/openstack/volume-snapshots" className="inline-flex items-center gap-2 text-slate-400 hover:text-slate-200 text-sm">
        <ArrowLeft className="w-4 h-4" /> Volume snapshots
      </Link>
      <h1 className="text-2xl font-semibold flex items-center gap-2">
        <Camera className="w-7 h-7 text-sky-400" />
        {snapshot.name || snapshot.id.slice(0, 12)}
      </h1>
      <dl className="grid sm:grid-cols-2 gap-4 rounded-xl border border-slate-700 p-4 text-sm">
        <div><dt className="text-xs text-slate-500 uppercase">ID</dt><dd className="font-mono text-slate-200 mt-1 break-all">{snapshot.id}</dd></div>
        <div><dt className="text-xs text-slate-500 uppercase">Status</dt><dd className="text-slate-200 mt-1">{snapshot.status}</dd></div>
        <div><dt className="text-xs text-slate-500 uppercase">Size</dt><dd className="text-slate-200 mt-1">{snapshot.size_gb} GB</dd></div>
        <div><dt className="text-xs text-slate-500 uppercase">Source volume</dt><dd className="font-mono text-xs mt-1">
          <Link to={`/openstack/volumes/${snapshot.volume_id}`} className="text-sky-400 hover:underline">{snapshot.volume_id}</Link>
        </dd></div>
      </dl>
      <section className="rounded-xl border border-slate-700 p-4 space-y-3">
        <h2 className="text-sm font-medium text-slate-300">Restore to new volume</h2>
        <div className="flex flex-wrap gap-2 items-end">
          <input aria-label="Volume name" value={restoreName} onChange={(e) => setRestoreName(e.target.value)} placeholder="Volume name"
            className="px-2 py-1.5 rounded-lg bg-slate-900 border border-slate-700 text-sm min-w-[14rem]" />
          <button type="button" className="px-3 py-1.5 rounded-lg bg-sky-600 text-white text-sm"
            onClick={async () => {
              try {
                await createOpenStackVolumeFromSnapshot({
                  snapshot_id: snapshot.id,
                  name: restoreName.trim() || undefined,
                })
                toast.success('Volume created from snapshot')
              } catch (e: unknown) { toast.error(formatUserError(e)) }
            }}>Create volume</button>
        </div>
      </section>
      <button type="button" className="px-3 py-1.5 rounded-lg border border-red-500/50 text-red-300 text-sm"
        onClick={async () => {
          if (!confirm(`Delete snapshot ${snapshot.name || snapshot.id}?`)) return
          try {
            await deleteOpenStackVolumeSnapshot(snapshot.id)
            toast.success('Deleted')
            window.location.href = '/openstack/volume-snapshots'
          } catch (e: unknown) { toast.error(formatUserError(e)) }
        }}>Delete snapshot</button>
      <OpenStackFooter />
    </PageLayout>
  )
}
