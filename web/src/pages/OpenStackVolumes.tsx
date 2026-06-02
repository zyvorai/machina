// Copyright (c) 2026 ZyvorAI Labs Private Limited. All rights reserved.

import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router'
import {
  attachOpenStackVolume,
  createOpenStackVolume,
  deleteOpenStackVolume,
  detachOpenStackVolume,
  listOpenStackCinderVolumes,
  listOpenStackInstances,
  type OpenStackAttachedVolume,
} from '../api/openstack'
import {
  createOpenStackVolumeFromSnapshot,
  createOpenStackVolumeFromImage,
  extendOpenStackVolume,
  listOpenStackVolumeSnapshots,
  deleteOpenStackVolumeSnapshot,
  listOpenStackVolumeTypes,
  retypeOpenStackVolume,
  snapshotOpenStackVolume,
  cloneOpenStackVolume,
  createOpenStackVolumeTransfer,
  acceptOpenStackVolumeTransfer,
  listOpenStackVolumeTransfers,
  deleteOpenStackVolumeTransfer,
  setOpenStackVolumeBootable,
  updateOpenStackVolume,
  type OpenStackVolumeSnapshot,
  type OpenStackVolumeTransfer,
} from '../api/openstackExtras'
import { listOpenStackImages } from '../api/openstack'
import OpenStackGate from '../components/OpenStackGate'
import OpenStackSubNav from '../components/OpenStackSubNav'
import OpenStackFooter from '../components/OpenStackFooter'
import PageLayout from '../components/PageLayout'
import PageSkeleton from '../components/PageSkeleton'
import { useToastContext } from '../contexts/ToastContext'
import { formatUserError } from '../utils/apiError'
import { statusActionLinkClasses, statusDestructiveButtonClasses, statusToneClass } from '../utils/semanticColors'
import { HardDrive, Loader2, RefreshCw } from 'lucide-react'

export default function OpenStackVolumesPage() {
  return (
    <OpenStackGate title="Cinder volumes">
      <OpenStackVolumesContent />
    </OpenStackGate>
  )
}

function OpenStackVolumesContent() {
  const toast = useToastContext()
  const [volumes, setVolumes] = useState<OpenStackAttachedVolume[]>([])
  const [snapshots, setSnapshots] = useState<OpenStackVolumeSnapshot[]>([])
  const [loading, setLoading] = useState(true)
  const [sizeGb, setSizeGb] = useState('10')
  const [name, setName] = useState('')
  const [volumeType, setVolumeType] = useState('')
  const [types, setTypes] = useState<{ id: string; name: string }[]>([])
  const [restoreSnapId, setRestoreSnapId] = useState('')
  const [restoreName, setRestoreName] = useState('')
  const [attachVolId, setAttachVolId] = useState('')
  const [attachInstId, setAttachInstId] = useState('')
  const [instances, setInstances] = useState<{ id: string; name: string }[]>([])
  const [cloneSrcId, setCloneSrcId] = useState('')
  const [cloneName, setCloneName] = useState('')
  const [xferVolId, setXferVolId] = useState('')
  const [xferName, setXferName] = useState('')
  const [xferAcceptId, setXferAcceptId] = useState('')
  const [xferAuthKey, setXferAuthKey] = useState('')
  const [transfers, setTransfers] = useState<OpenStackVolumeTransfer[]>([])
  const [fromImageId, setFromImageId] = useState('')
  const [fromImageName, setFromImageName] = useState('')
  const [fromImageSize, setFromImageSize] = useState('')
  const [images, setImages] = useState<{ id: string; name: string }[]>([])

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const [v, t, s, inst, tr, imgs] = await Promise.all([
        listOpenStackCinderVolumes(),
        listOpenStackVolumeTypes().catch(() => ({ volume_types: [] })),
        listOpenStackVolumeSnapshots().catch(() => ({ snapshots: [] })),
        listOpenStackInstances().catch(() => ({ instances: [] })),
        listOpenStackVolumeTransfers().catch(() => ({ transfers: [] })),
        listOpenStackImages().catch(() => ({ images: [] })),
      ])
      setVolumes(v.volumes)
      setTypes(t.volume_types.map((x) => ({ id: x.id, name: x.name })))
      setSnapshots(s.snapshots)
      setTransfers(tr.transfers)
      setImages(imgs.images.map((i) => ({ id: i.id, name: i.name || i.id.slice(0, 8) })))
      const instList = inst.instances.map((i) => ({ id: i.id, name: i.name }))
      setInstances(instList)
      if (!attachInstId && instList.length > 0) setAttachInstId(instList[0].id)
      const free = v.volumes.filter((vol) => !vol.server_id)
      if (!attachVolId && free.length > 0) setAttachVolId(free[0].id)
    } catch (e: unknown) {
      toast.error(formatUserError(e))
    } finally {
      setLoading(false)
    }
  }, [toast])

  useEffect(() => {
    void load()
  }, [load])

  const handleCreate = async () => {
    const size = Number.parseInt(sizeGb, 10)
    if (!Number.isFinite(size) || size < 1) {
      toast.warning('Enter valid size in GB')
      return
    }
    try {
      await createOpenStackVolume({
        size_gb: size,
        name: name.trim() || undefined,
        volume_type: volumeType || undefined,
      })
      toast.success('Volume created')
      void load()
    } catch (e: unknown) {
      toast.error(formatUserError(e))
    }
  }

  const handleRestore = async () => {
    if (!restoreSnapId.trim()) return
    try {
      await createOpenStackVolumeFromSnapshot({
        snapshot_id: restoreSnapId.trim(),
        name: restoreName.trim() || undefined,
      })
      toast.success('Volume created from snapshot')
      setRestoreSnapId('')
      setRestoreName('')
      void load()
    } catch (e: unknown) {
      toast.error(formatUserError(e))
    }
  }

  return (
    <PageLayout
      hideHeader
      className="max-w-4xl"
      prepend={<><OpenStackSubNav /></>}
    >
      <h1 className="text-2xl font-semibold flex items-center gap-2">
        <HardDrive className="w-7 h-7 text-sky-400" />
        Cinder volumes
      </h1>
      <div className="rounded-xl border border-slate-700 p-4 flex flex-wrap gap-3 items-end">
        <div>
          <label className="block text-xs text-slate-500 mb-1">Size (GB)</label>
          <input type="number" min={1} value={sizeGb} onChange={(e) => setSizeGb(e.target.value)}
            className="w-24 px-2 py-1.5 rounded-lg bg-slate-900 border border-slate-700 text-sm" />
        </div>
        <div>
          <label className="block text-xs text-slate-500 mb-1">Name</label>
          <input value={name} onChange={(e) => setName(e.target.value)}
            className="px-2 py-1.5 rounded-lg bg-slate-900 border border-slate-700 text-sm" />
        </div>
        <div>
          <label className="block text-xs text-slate-500 mb-1">Type</label>
          <select value={volumeType} onChange={(e) => setVolumeType(e.target.value)}
            className="px-2 py-1.5 rounded-lg bg-slate-900 border border-slate-700 text-sm">
            <option value="">Default</option>
            {types.map((t) => (
              <option key={t.id} value={t.id}>{t.name}</option>
            ))}
          </select>
        </div>
        <button type="button" onClick={() => void handleCreate()}
          className="px-3 py-1.5 rounded-lg bg-sky-600 hover:bg-sky-500 text-sm text-white">
          Create volume
        </button>
        <button type="button" onClick={() => void load()}
          className="ml-auto inline-flex items-center gap-1 px-3 py-1.5 rounded-lg border border-slate-600 text-sm">
          <RefreshCw className="w-4 h-4" /> Refresh
        </button>
      </div>

      <div className="rounded-xl border border-slate-700 p-4 space-y-3">
        <h2 className="text-sm font-medium text-slate-300">Create volume from Glance image</h2>
        <div className="flex flex-wrap gap-3 items-end">
          <select value={fromImageId} onChange={(e) => setFromImageId(e.target.value)}
            className="min-w-[14rem] px-2 py-1.5 rounded-lg bg-slate-900 border border-slate-700 text-sm">
            <option value="">Image…</option>
            {images.map((img) => (
              <option key={img.id} value={img.id}>{img.name}</option>
            ))}
          </select>
          <input value={fromImageName} onChange={(e) => setFromImageName(e.target.value)} placeholder="Volume name"
            className="px-2 py-1.5 rounded-lg bg-slate-900 border border-slate-700 text-sm" />
          <input value={fromImageSize} onChange={(e) => setFromImageSize(e.target.value)} placeholder="Size GB (opt)"
            className="w-28 px-2 py-1.5 rounded-lg bg-slate-900 border border-slate-700 text-sm" />
          <button type="button" disabled={!fromImageId}
            className="px-3 py-1.5 rounded-lg bg-violet-600 text-white text-sm disabled:opacity-40"
            onClick={async () => {
              try {
                const sz = fromImageSize.trim() ? Number.parseInt(fromImageSize, 10) : undefined
                await createOpenStackVolumeFromImage({
                  image_id: fromImageId,
                  name: fromImageName.trim() || undefined,
                  size_gb: Number.isFinite(sz) && sz! > 0 ? sz : undefined,
                })
                toast.success('Volume created from image')
                void load()
              } catch (e: unknown) { toast.error(formatUserError(e)) }
            }}>Create</button>
        </div>
      </div>

      <div className="rounded-xl border border-slate-700 p-4 space-y-3">
        <h2 className="text-sm font-medium text-slate-300">Clone volume</h2>
        <div className="flex flex-wrap gap-3 items-end">
          <select value={cloneSrcId} onChange={(e) => setCloneSrcId(e.target.value)}
            className="min-w-[14rem] px-2 py-1.5 rounded-lg bg-slate-900 border border-slate-700 text-sm">
            <option value="">Source volume…</option>
            {volumes.map((vol) => (
              <option key={vol.id} value={vol.id}>{vol.name || vol.id.slice(0, 8)}</option>
            ))}
          </select>
          <input value={cloneName} onChange={(e) => setCloneName(e.target.value)} placeholder="New name"
            className="px-2 py-1.5 rounded-lg bg-slate-900 border border-slate-700 text-sm" />
          <button type="button" disabled={!cloneSrcId} className="px-3 py-1.5 rounded-lg bg-violet-600 text-white text-sm disabled:opacity-40"
            onClick={async () => {
              try {
                await cloneOpenStackVolume({ source_volume_id: cloneSrcId, name: cloneName.trim() || undefined })
                toast.success('Volume cloned'); void load()
              } catch (e: unknown) { toast.error(formatUserError(e)) }
            }}>Clone</button>
        </div>
      </div>

      <div className="rounded-xl border border-slate-700 p-4 space-y-3">
        <h2 className="text-sm font-medium text-slate-300">Volume transfer</h2>
        <div className="flex flex-wrap gap-3 items-end">
          <select value={xferVolId} onChange={(e) => setXferVolId(e.target.value)}
            className="min-w-[12rem] px-2 py-1.5 rounded-lg bg-slate-900 border border-slate-700 text-sm">
            <option value="">Volume…</option>
            {volumes.filter((v) => !v.server_id).map((vol) => (
              <option key={vol.id} value={vol.id}>{vol.name || vol.id.slice(0, 8)}</option>
            ))}
          </select>
          <input value={xferName} onChange={(e) => setXferName(e.target.value)} placeholder="Transfer name"
            className="px-2 py-1.5 rounded-lg bg-slate-900 border border-slate-700 text-sm" />
          <button type="button" disabled={!xferVolId || !xferName.trim()}
            className="px-3 py-1.5 rounded-lg bg-sky-600 text-white text-sm disabled:opacity-40"
            onClick={async () => {
              try {
                const r = await createOpenStackVolumeTransfer({ volume_id: xferVolId, name: xferName.trim() })
                toast.success(`Transfer created — auth key: ${r.transfer.auth_key ?? 'see API'}`)
                void load()
              } catch (e: unknown) { toast.error(formatUserError(e)) }
            }}>Create transfer</button>
        </div>
        <div className="flex flex-wrap gap-3 items-end border-t border-slate-800 pt-3">
          <input value={xferAcceptId} onChange={(e) => setXferAcceptId(e.target.value)} placeholder="Transfer id"
            className="px-2 py-1.5 rounded-lg bg-slate-900 border border-slate-700 text-sm font-mono" />
          <input value={xferAuthKey} onChange={(e) => setXferAuthKey(e.target.value)} placeholder="Auth key"
            className="px-2 py-1.5 rounded-lg bg-slate-900 border border-slate-700 text-sm font-mono" />
          <button type="button" disabled={!xferAcceptId || !xferAuthKey}
            className="px-3 py-1.5 rounded-lg bg-emerald-600 text-white text-sm disabled:opacity-40"
            onClick={async () => {
              try {
                await acceptOpenStackVolumeTransfer({ transfer_id: xferAcceptId, auth_key: xferAuthKey })
                toast.success('Transfer accepted'); void load()
              } catch (e: unknown) { toast.error(formatUserError(e)) }
            }}>Accept</button>
        </div>
        {transfers.length > 0 && (
          <ul className="text-xs font-mono text-slate-400 space-y-1">
            {transfers.map((t) => (
              <li key={t.id} className="flex flex-wrap items-center gap-2">
                <Link to={`/openstack/volume-transfers/${t.id}`} className="text-sky-300 hover:underline">{t.name}</Link>
                <span>· vol {t.volume_id.slice(0, 8)} · {t.id.slice(0, 8)}</span>
                <button type="button" className={statusActionLinkClasses('error', 'text-xs')} onClick={async () => {
                  if (!confirm(`Cancel transfer ${t.name}?`)) return
                  try { await deleteOpenStackVolumeTransfer(t.id); toast.success('Transfer deleted'); void load() }
                  catch (e: unknown) { toast.error(formatUserError(e)) }
                }}>Cancel</button>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="rounded-xl border border-slate-700 p-4 space-y-3">
        <h2 className="text-sm font-medium text-slate-300">Attach volume to instance</h2>
        <div className="flex flex-wrap gap-3 items-end">
          <div className="min-w-[14rem]">
            <label className="block text-xs text-slate-500 mb-1">Volume</label>
            <select
              value={attachVolId}
              onChange={(e) => setAttachVolId(e.target.value)}
              className="w-full px-2 py-1.5 rounded-lg bg-slate-900 border border-slate-700 text-sm"
            >
              <option value="">Select volume…</option>
              {volumes.filter((vol) => !vol.server_id).map((vol) => (
                <option key={vol.id} value={vol.id}>
                  {vol.name || vol.id.slice(0, 8)} ({vol.size_gb} GB)
                </option>
              ))}
            </select>
          </div>
          <div className="min-w-[14rem]">
            <label className="block text-xs text-slate-500 mb-1">Instance</label>
            <select
              value={attachInstId}
              onChange={(e) => setAttachInstId(e.target.value)}
              className="w-full px-2 py-1.5 rounded-lg bg-slate-900 border border-slate-700 text-sm"
            >
              <option value="">Select instance…</option>
              {instances.map((i) => (
                <option key={i.id} value={i.id}>{i.name || i.id.slice(0, 8)}</option>
              ))}
            </select>
          </div>
          <button
            type="button"
            disabled={!attachVolId || !attachInstId}
            onClick={async () => {
              try {
                await attachOpenStackVolume(attachInstId, attachVolId)
                toast.success('Volume attached')
                void load()
              } catch (e: unknown) {
                toast.error(formatUserError(e))
              }
            }}
            className="px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-sm text-white disabled:opacity-40"
          >
            Attach
          </button>
        </div>
      </div>

      <div className="rounded-xl border border-slate-700 p-4 space-y-3">
        <h2 className="text-sm font-medium text-slate-300">Create volume from snapshot</h2>
        <div className="flex flex-wrap gap-3 items-end">
          <div className="min-w-[14rem]">
            <label className="block text-xs text-slate-500 mb-1">Snapshot</label>
            <select
              value={restoreSnapId}
              onChange={(e) => setRestoreSnapId(e.target.value)}
              className="w-full px-2 py-1.5 rounded-lg bg-slate-900 border border-slate-700 text-sm"
            >
              <option value="">Select snapshot…</option>
              {snapshots.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name || s.id.slice(0, 8)} ({s.size_gb} GB · {s.status})
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-xs text-slate-500 mb-1">New volume name</label>
            <input
              value={restoreName}
              onChange={(e) => setRestoreName(e.target.value)}
              className="px-2 py-1.5 rounded-lg bg-slate-900 border border-slate-700 text-sm"
              placeholder="optional"
            />
          </div>
          <button
            type="button"
            disabled={!restoreSnapId}
            onClick={() => void handleRestore()}
            className="px-3 py-1.5 rounded-lg bg-violet-600 hover:bg-violet-500 text-sm text-white disabled:opacity-40"
          >
            Restore
          </button>
        </div>
      </div>

      {loading ? (
        <PageSkeleton />
      ) : (
        <>
          <div className="rounded-xl border border-slate-700 overflow-hidden">
            <div className="px-3 py-2 bg-slate-900 text-xs text-slate-500 uppercase">Volumes</div>
            <table className="w-full text-sm">
              <thead className="bg-slate-900/80 text-slate-400 text-left">
                <tr>
                  <th className="px-3 py-2">Name</th>
                  <th className="px-3 py-2">Size</th>
                  <th className="px-3 py-2">Bootable</th>
                  <th className="px-3 py-2">Attached</th>
                  <th className="px-3 py-2">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800">
                {volumes.map((v) => (
                  <tr key={v.id}>
                    <td className="px-3 py-2 font-mono text-slate-200">
                      <Link to={`/openstack/volumes/${v.id}`} className="hover:text-sky-300 hover:underline">
                        {v.name || v.id.slice(0, 8)}
                      </Link>
                    </td>
                    <td className="px-3 py-2">{v.size_gb} GB</td>
                    <td className="px-3 py-2">
                      <button type="button" className="text-xs hover:underline"
                        title="Toggle bootable flag"
                        onClick={async () => {
                          try {
                            await setOpenStackVolumeBootable(v.id, !v.bootable)
                            toast.success(v.bootable ? 'Marked non-bootable' : 'Marked bootable')
                            void load()
                          } catch (e: unknown) { toast.error(formatUserError(e)) }
                        }}>
                        {v.bootable ? 'Yes' : 'No'}
                      </button>
                    </td>
                    <td className="px-3 py-2 text-slate-500 font-mono text-xs">
                      {v.server_id ? v.server_id.slice(0, 8) : '—'}
                    </td>
                    <td className="px-3 py-2 flex flex-wrap gap-2">
                      {v.server_id && (
                        <button
                          type="button"
                          className={statusActionLinkClasses('warn', 'text-xs')}
                          onClick={async () => {
                            try {
                              await detachOpenStackVolume(v.server_id!, v.id)
                              toast.success('Volume detached')
                              void load()
                            } catch (e: unknown) {
                              toast.error(formatUserError(e))
                            }
                          }}
                        >
                          Detach
                        </button>
                      )}
                      <button type="button" className="text-xs text-sky-400 hover:underline"
                        onClick={async () => {
                          const n = prompt('New volume name', v.name || '')
                          if (n === null) return
                          try {
                            await updateOpenStackVolume(v.id, { name: n.trim() || undefined })
                            toast.success('Volume updated')
                            void load()
                          } catch (e: unknown) { toast.error(formatUserError(e)) }
                        }}>Rename</button>
                      <button type="button" className="text-xs text-sky-400 hover:underline"
                        onClick={async () => {
                          const n = prompt('Snapshot name', `${v.name || 'vol'}-snap`)
                          if (!n) return
                          try {
                            await snapshotOpenStackVolume(v.id, n)
                            toast.success('Snapshot requested')
                            void load()
                          } catch (e: unknown) {
                            toast.error(formatUserError(e))
                          }
                        }}>Snapshot</button>
                      <button type="button" className="text-xs text-violet-400 hover:underline"
                        onClick={async () => {
                          const t = prompt('New volume type id/name')
                          if (!t) return
                          try {
                            await retypeOpenStackVolume(v.id, t)
                            toast.success('Retype requested')
                            void load()
                          } catch (e: unknown) {
                            toast.error(formatUserError(e))
                          }
                        }}>Retype</button>
                      <button type="button" className={statusActionLinkClasses('warn', 'text-xs')}
                        onClick={async () => {
                          const n = prompt('New size (GB)', String(v.size_gb + 1))
                          if (!n) return
                          try {
                            await extendOpenStackVolume(v.id, Number.parseInt(n, 10))
                            toast.success('Extended')
                            void load()
                          } catch (e: unknown) {
                            toast.error(formatUserError(e))
                          }
                        }}>Extend</button>
                      <button type="button" className={statusActionLinkClasses('error', 'text-xs')}
                        onClick={async () => {
                          if (!confirm(`Delete volume ${v.name || v.id}?`)) return
                          try {
                            await deleteOpenStackVolume(v.id)
                            toast.success('Deleted')
                            void load()
                          } catch (e: unknown) {
                            toast.error(formatUserError(e))
                          }
                        }}>Delete</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {volumes.length === 0 && (
              <p className="p-6 text-center text-slate-500 text-sm">No volumes in this project.</p>
            )}
          </div>

          {snapshots.length > 0 && (
            <div className="rounded-xl border border-slate-700 overflow-hidden">
              <div className="px-3 py-2 bg-slate-900 text-xs text-slate-500 uppercase flex justify-between">
                <span>Snapshots</span>
                <Link to="/openstack/volume-snapshots" className="text-sky-400 hover:underline normal-case">View all</Link>
              </div>
              <table className="w-full text-sm">
                <thead className="bg-slate-900/80 text-slate-400 text-left">
                  <tr>
                    <th className="px-3 py-2">Name</th>
                    <th className="px-3 py-2">Volume</th>
                    <th className="px-3 py-2">Size</th>
                    <th className="px-3 py-2">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800 font-mono text-xs">
                  {snapshots.map((s) => (
                    <tr key={s.id}>
                      <td className="px-3 py-2 text-slate-200">{s.name || s.id.slice(0, 8)}</td>
                      <td className="px-3 py-2 text-slate-500">{s.volume_id.slice(0, 8)}</td>
                      <td className="px-3 py-2">{s.size_gb} GB</td>
                      <td className="px-3 py-2">
                        <span className="text-slate-400">{s.status}</span>
                        <button
                          type="button"
                          className={statusActionLinkClasses('error', 'ml-2')}
                          onClick={async () => {
                            if (!confirm(`Delete snapshot ${s.name || s.id}?`)) return
                            try {
                              await deleteOpenStackVolumeSnapshot(s.id)
                              toast.success('Snapshot deleted')
                              void load()
                            } catch (e: unknown) {
                              toast.error(formatUserError(e))
                            }
                          }}
                        >
                          Del
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
      <OpenStackFooter />
    </PageLayout>
  )
}
