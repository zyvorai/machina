// Copyright (c) 2026 ZyvorAI Labs Private Limited. All rights reserved.
// Proprietary software — see LICENSE in the repository root.
// https://zyvor.dev · info@zyvor.dev

import { useEffect, useState, useCallback } from 'react'
import { Link } from 'react-router'
import { listPools, listVolumes, startPool, stopPool, refreshPool, deleteVolume, setPoolAutostart, createVolume, StoragePoolInfo, StorageVolumeInfo } from '../api/storage'
import { createPool, deletePool, getPoolXml, resizeVolume, cloneVolume } from '../api/advanced'
import { useToastContext } from '../contexts/ToastContext'
import ConfirmDialog from '../components/ConfirmDialog'
import { Play, Square, RefreshCw, Trash2, ArrowLeft, HardDrive, Plus, Code, X, Copy, Maximize, ToggleLeft, ToggleRight } from 'lucide-react'
import { formatUserError } from '../utils/apiError'
import { poolStateBadgeClasses, statusBadgeClasses, statusToneClass } from '../utils/semanticColors'
import PageLayout from '../components/PageLayout'
import EmptyState from '../components/EmptyState'
import { libvirtErrorHints } from '../utils/libvirtHints'

export default function StoragePage() {
  const [pools, setPools] = useState<StoragePoolInfo[]>([])
  const [volumes, setVolumes] = useState<StorageVolumeInfo[]>([])
  const [selectedPool, setSelectedPool] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [volumesLoading, setVolumesLoading] = useState(false)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<{ pool: string; vol: string } | null>(null)
  const [deletePoolTarget, setDeletePoolTarget] = useState<string | null>(null)
  const [showCreatePool, setShowCreatePool] = useState(false)
  const [newPoolName, setNewPoolName] = useState('')
  const [newPoolType, setNewPoolType] = useState('dir')
  const [newPoolPath, setNewPoolPath] = useState('')
  const [xmlContent, setXmlContent] = useState<string | null>(null)
  const [xmlName, setXmlName] = useState('')
  const [resizeTarget, setResizeTarget] = useState<{ pool: string; vol: string } | null>(null)
  const [resizeGb, setResizeGb] = useState('')
  const [cloneTarget, setCloneTarget] = useState<{ pool: string; vol: string } | null>(null)
  const [cloneName, setCloneName] = useState('')
  const [showCreateVol, setShowCreateVol] = useState(false)
  const [newVolName, setNewVolName] = useState('')
  const [newVolCapacity, setNewVolCapacity] = useState('10')
  const [newVolFormat, setNewVolFormat] = useState('qcow2')
  const toast = useToastContext()

  const loadPools = useCallback(async () => {
    try {
      setLoading(true)
      setLoadError(null)
      setPools(await listPools())
    } catch (e: unknown) {
      const msg = formatUserError(e)
      setLoadError(msg)
      toast.error(msg)
    } finally { setLoading(false) }
  }, [toast])

  const loadVolumes = async (pool: string) => {
    try {
      setVolumesLoading(true)
      setSelectedPool(pool)
      setVolumes(await listVolumes(pool))
    } catch (e: unknown) {
      toast.error(`${formatUserError(e)}`)
      setSelectedPool(null)
      setVolumes([])
    } finally {
      setVolumesLoading(false)
    }
  }

  useEffect(() => { loadPools() }, [loadPools])

  const poolAction = async (name: string, fn: (n: string) => Promise<void>, label: string) => {
    try { await fn(name); toast.success(`${label} '${name}' OK`); loadPools() } catch (e: unknown) { toast.error(`${formatUserError(e)}`) }
  }

  const handleDeleteVol = async () => {
    if (!deleteTarget) return
    try { await deleteVolume(deleteTarget.pool, deleteTarget.vol); toast.success(`Deleted volume '${deleteTarget.vol}'`); loadVolumes(deleteTarget.pool) } catch (e: unknown) { toast.error(`${formatUserError(e)}`) }
    setDeleteTarget(null)
  }

  const handleDeletePool = async () => {
    if (!deletePoolTarget) return
    try { await deletePool(deletePoolTarget); toast.success(`Deleted pool '${deletePoolTarget}'`); loadPools() } catch (e: unknown) { toast.error(`${formatUserError(e)}`) }
    setDeletePoolTarget(null)
  }

  const handleCreatePool = async () => {
    try { await createPool({ name: newPoolName, pool_type: newPoolType, target_path: newPoolPath }); toast.success(`Created pool '${newPoolName}'`); setShowCreatePool(false); setNewPoolName(''); setNewPoolPath(''); loadPools() } catch (e: unknown) { toast.error(`${formatUserError(e)}`) }
  }

  const showPoolXml = async (name: string) => {
    try { const xml = await getPoolXml(name); setXmlContent(xml); setXmlName(name) } catch (e: unknown) { toast.error(`${formatUserError(e)}`) }
  }

  const handleResize = async () => {
    if (!resizeTarget) return
    try { await resizeVolume(resizeTarget.pool, resizeTarget.vol, parseFloat(resizeGb)); toast.success(`Resized volume '${resizeTarget.vol}'`); loadVolumes(resizeTarget.pool) } catch (e: unknown) { toast.error(`${formatUserError(e)}`) }
    setResizeTarget(null); setResizeGb('')
  }

  const handleClone = async () => {
    if (!cloneTarget) return
    try { await cloneVolume(cloneTarget.pool, cloneTarget.vol, cloneName); toast.success(`Cloned volume '${cloneTarget.vol}' to '${cloneName}'`); loadVolumes(cloneTarget.pool) } catch (e: unknown) { toast.error(`${formatUserError(e)}`) }
    setCloneTarget(null); setCloneName('')
  }

  const togglePoolAutostart = async (pool: StoragePoolInfo) => {
    try {
      await setPoolAutostart(pool.name, !pool.autostart)
      toast.success(`Autostart ${!pool.autostart ? 'enabled' : 'disabled'} for '${pool.name}'`)
      loadPools()
    } catch (e: unknown) { toast.error(`${formatUserError(e)}`) }
  }

  const handleCreateVol = async () => {
    if (!selectedPool || !newVolName.trim()) return
    try {
      await createVolume(selectedPool, { name: newVolName.trim(), capacity_gb: parseFloat(newVolCapacity), format: newVolFormat })
      toast.success(`Created volume '${newVolName.trim()}'`)
      setShowCreateVol(false)
      setNewVolName('')
      loadVolumes(selectedPool)
    } catch (e: unknown) { toast.error(`${formatUserError(e)}`) }
  }

  if (selectedPool) {
    return (
      <PageLayout
        title={`Volumes in '${selectedPool}'`}
        actions={
          <>
            <button onClick={() => { setSelectedPool(null); setVolumes([]); setVolumesLoading(false) }} className="p-2 hover:bg-slate-700 rounded transition" title="Back" aria-label="Back"><ArrowLeft className="w-5 h-5" /></button>
            <button onClick={() => loadVolumes(selectedPool)} className="p-2 hover:bg-slate-700 rounded transition" title="Refresh" aria-label="Refresh"><RefreshCw className="w-4 h-4" /></button>
            <button onClick={() => setShowCreateVol(true)} className="px-3 py-1.5 bg-blue-600 hover:bg-blue-700 rounded text-sm transition flex items-center gap-1"><Plus className="w-4 h-4" /> Create Volume</button>
          </>
        }
        contentLoading={volumesLoading}
      >
        {volumes.length === 0 ? (
          <EmptyState
            icon={<HardDrive className="w-6 h-6" />}
            title="No volumes"
            description="Create a volume in this pool to attach to a VM."
            primaryAction={
              <button
                type="button"
                onClick={() => setShowCreateVol(true)}
                className="px-4 py-2 rounded-lg bg-blue-600 hover:bg-blue-500 text-white text-sm font-medium"
              >
                Create volume
              </button>
            }
          />
        ) : (
          <div className="bg-slate-800/50 rounded-xl border border-slate-700/50 overflow-hidden">
            <table className="w-full" aria-label="Storage volumes">
              <thead><tr className="border-b border-slate-700/50 text-left text-sm text-slate-400"><th className="px-6 py-3">Name</th><th className="px-6 py-3">Type</th><th className="px-6 py-3">Capacity</th><th className="px-6 py-3">Used</th><th className="px-6 py-3 hidden lg:table-cell">Path</th><th className="px-6 py-3 text-right">Actions</th></tr></thead>
              <tbody className="divide-y divide-slate-700/50">
                {volumes.map((v) => (
                  <tr key={v.name} className="hover:bg-slate-700/50">
                    <td className="px-6 py-3 font-medium">{v.name}</td>
                    <td className="px-6 py-3 text-sm text-slate-400">{v.vol_type}</td>
                    <td className="px-6 py-3 text-sm">{v.capacity_gb.toFixed(2)} GB</td>
                    <td className="px-6 py-3 text-sm">{v.allocation_gb.toFixed(2)} GB</td>
                    <td className="px-6 py-3 text-sm text-slate-400 truncate max-w-xs hidden lg:table-cell">{v.path}</td>
                    <td className="px-6 py-3 text-right">
                      <div className="flex items-center justify-end gap-1">
                        <button onClick={() => { setResizeTarget({ pool: selectedPool, vol: v.name }); setResizeGb(v.capacity_gb.toFixed(2)) }} className={`p-1.5 rounded transition ${statusBadgeClasses('info')} hover:opacity-80`} title="Resize" aria-label="Resize"><Maximize className={`w-4 h-4 ${statusToneClass('info')}`} /></button>
                        <button onClick={() => { setCloneTarget({ pool: selectedPool, vol: v.name }); setCloneName(`${v.name}-clone`) }} className="p-1.5 hover:bg-green-600/20 rounded transition" title="Clone" aria-label="Clone"><Copy className={`w-4 h-4 ${statusToneClass('ok')}`} /></button>
                        <button onClick={() => setDeleteTarget({ pool: selectedPool, vol: v.name })} className="p-1.5 hover:bg-red-600/20 rounded transition" title="Delete" aria-label="Delete"><Trash2 className={`w-4 h-4 ${statusToneClass('error')}`} /></button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <ConfirmDialog open={!!deleteTarget} title="Delete Volume" message={`Delete volume '${deleteTarget?.vol}'?`} confirmLabel="Delete" onConfirm={handleDeleteVol} onCancel={() => setDeleteTarget(null)} />

        {resizeTarget && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm" onClick={() => setResizeTarget(null)}>
            <div className="bg-slate-800 border border-slate-700/50 rounded-2xl shadow-2xl w-full max-w-md mx-4" onClick={(e) => e.stopPropagation()}>
              <div className="p-5 border-b border-slate-700/50"><span className="text-lg font-semibold">Resize Volume</span></div>
              <div className="p-5 space-y-4">
                <div className="text-sm text-slate-400">Volume: <span className="text-white font-medium">{resizeTarget.vol}</span></div>
                <div>
                  <label className="block text-sm text-slate-400 mb-1">New Size (GB)</label>
                  <input type="number" step="0.01" value={resizeGb} onChange={(e) => setResizeGb(e.target.value)} className="w-full px-3 py-2 bg-slate-900 border border-slate-700 rounded-lg text-sm" />
                </div>
              </div>
              <div className="flex justify-end gap-3 px-5 pb-5">
                <button onClick={() => setResizeTarget(null)} className="px-4 py-2 bg-slate-700 hover:bg-slate-600 rounded-lg text-sm font-medium transition">Cancel</button>
                <button onClick={handleResize} className="px-4 py-2 bg-blue-600 hover:bg-blue-500 rounded-lg text-sm text-white font-medium transition">Resize</button>
              </div>
            </div>
          </div>
        )}

        {cloneTarget && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm" onClick={() => setCloneTarget(null)}>
            <div className="bg-slate-800 border border-slate-700/50 rounded-2xl shadow-2xl w-full max-w-md mx-4" onClick={(e) => e.stopPropagation()}>
              <div className="p-5 border-b border-slate-700/50"><span className="text-lg font-semibold">Clone Volume</span></div>
              <div className="p-5 space-y-4">
                <div className="text-sm text-slate-400">Source: <span className="text-white font-medium">{cloneTarget.vol}</span></div>
                <div>
                  <label className="block text-sm text-slate-400 mb-1">New Volume Name</label>
                  <input type="text" value={cloneName} onChange={(e) => setCloneName(e.target.value)} className="w-full px-3 py-2 bg-slate-900 border border-slate-700 rounded-lg text-sm" />
                </div>
              </div>
              <div className="flex justify-end gap-3 px-5 pb-5">
                <button onClick={() => setCloneTarget(null)} className="px-4 py-2 bg-slate-700 hover:bg-slate-600 rounded-lg text-sm font-medium transition">Cancel</button>
                <button onClick={handleClone} className="px-4 py-2 bg-green-600 hover:bg-green-500 rounded-lg text-sm text-white font-medium transition">Clone</button>
              </div>
            </div>
          </div>
        )}

        {showCreateVol && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm" onClick={() => setShowCreateVol(false)}>
            <div className="bg-slate-800 border border-slate-700/50 rounded-2xl shadow-2xl w-full max-w-md mx-4" onClick={(e) => e.stopPropagation()}>
              <div className="p-5 border-b border-slate-700/50"><span className="text-lg font-semibold">Create Volume</span></div>
              <div className="p-5 space-y-4">
                <div>
                  <label className="block text-sm text-slate-400 mb-1">Name</label>
                  <input type="text" value={newVolName} onChange={(e) => setNewVolName(e.target.value)} placeholder="my-volume.qcow2" className="w-full px-3 py-2 bg-slate-900 border border-slate-700 rounded-lg text-sm" />
                </div>
                <div>
                  <label className="block text-sm text-slate-400 mb-1">Capacity (GB)</label>
                  <input type="number" step="0.01" value={newVolCapacity} onChange={(e) => setNewVolCapacity(e.target.value)} className="w-full px-3 py-2 bg-slate-900 border border-slate-700 rounded-lg text-sm" />
                </div>
                <div>
                  <label className="block text-sm text-slate-400 mb-1">Format</label>
                  <select aria-label="Volume format" value={newVolFormat} onChange={(e) => setNewVolFormat(e.target.value)} className="w-full px-3 py-2 bg-slate-900 border border-slate-700 rounded-lg text-sm">
                    <option value="qcow2">qcow2</option>
                    <option value="raw">raw</option>
                    <option value="qcow">qcow</option>
                  </select>
                </div>
              </div>
              <div className="flex justify-end gap-3 px-5 pb-5">
                <button onClick={() => setShowCreateVol(false)} className="px-4 py-2 bg-slate-700 hover:bg-slate-600 rounded-lg text-sm font-medium transition">Cancel</button>
                <button onClick={handleCreateVol} className="px-4 py-2 bg-blue-600 hover:bg-blue-500 rounded-lg text-sm text-white font-medium transition">Create</button>
              </div>
            </div>
          </div>
        )}
      </PageLayout>
    )
  }

  return (
    <PageLayout
      title="Storage Pools"
      icon={<HardDrive className="w-6 h-6" />}
      actions={
        <>
          <button onClick={() => setShowCreatePool(true)} className="px-3 py-1.5 bg-blue-600 hover:bg-blue-700 rounded text-sm transition flex items-center gap-1"><Plus className="w-4 h-4" /> Create Pool</button>
          <button onClick={loadPools} className="p-2 hover:bg-slate-700 rounded transition" title="Refresh" aria-label="Refresh"><RefreshCw className="w-4 h-4" /></button>
        </>
      }
      contentLoading={loading}
      error={loadError}
      errorTitle="Could not load storage pools"
      errorHints={loadError ? libvirtErrorHints(loadError) : undefined}
      onErrorRetry={loadPools}
    >
      {pools.length === 0 && !loadError ? (
        <EmptyState
          icon={<HardDrive className="w-6 h-6" />}
          title="No storage pools"
          description="Create a libvirt pool or import from an existing path on this host."
          primaryAction={<button type="button" className="btn-primary" onClick={() => setShowCreatePool(true)}>Create pool</button>}
        />
      ) : pools.length > 0 ? (
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {pools.map((pool) => (
          <div key={pool.name} className="bg-slate-800/50 rounded-xl p-6 border border-slate-700/50">
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-2">
                <HardDrive className="w-5 h-5 text-cyan-500" />
                <span className="font-semibold">{pool.name}</span>
              </div>
              <span className={`px-2 py-0.5 rounded text-xs font-medium ${poolStateBadgeClasses(pool.state)}`}>{pool.state}</span>
            </div>
            <div className="space-y-2 text-sm">
              <div className="flex justify-between"><span className="text-slate-400">Capacity</span><span>{pool.capacity_gb.toFixed(1)} GB</span></div>
              <div className="flex justify-between"><span className="text-slate-400">Used</span><span>{pool.allocation_gb.toFixed(1)} GB</span></div>
              <div className="flex justify-between"><span className="text-slate-400">Available</span><span>{pool.available_gb.toFixed(1)} GB</span></div>
              {pool.capacity_gb > 0 && (
                <div className="w-full bg-slate-700 rounded-full h-2 mt-2">
                  <div className="bg-cyan-500 h-2 rounded-full" style={{ width: `${(pool.allocation_gb / pool.capacity_gb * 100).toFixed(0)}%` }} />
                </div>
              )}
            </div>
            <div className="flex items-center gap-2 mt-4 pt-4 border-t border-slate-700/50">
              <Link to={`/storage/${encodeURIComponent(pool.name)}`} className="flex-1 px-3 py-1.5 bg-slate-700 hover:bg-slate-600 rounded text-sm transition text-center">Browse</Link>
              {pool.state !== 'running' && <button onClick={() => poolAction(pool.name, startPool, 'Start pool')} className="p-1.5 hover:bg-green-600/20 rounded transition"><Play className={`w-4 h-4 ${statusToneClass('ok')}`} /></button>}
              {pool.state === 'running' && (
                <>
                  <button onClick={() => poolAction(pool.name, refreshPool, 'Refresh pool')} className={`p-1.5 rounded transition ${statusBadgeClasses('info')} hover:opacity-80`}><RefreshCw className={`w-4 h-4 ${statusToneClass('info')}`} /></button>
                  <button onClick={() => poolAction(pool.name, stopPool, 'Stop pool')} className="p-1.5 hover:bg-red-600/20 rounded transition"><Square className={`w-4 h-4 ${statusToneClass('error')}`} /></button>
                </>
              )}
              <button onClick={() => togglePoolAutostart(pool)} className="p-1.5 hover:bg-blue-600/20 rounded transition" title={pool.autostart ? 'Disable Autostart' : 'Enable Autostart'} aria-label={pool.autostart ? 'Disable Autostart' : 'Enable Autostart'}>
                {pool.autostart ? <ToggleRight className={`w-4 h-4 ${statusToneClass('ok')}`} /> : <ToggleLeft className="w-4 h-4 text-slate-500" />}
              </button>
              <button onClick={() => showPoolXml(pool.name)} className={`p-1.5 rounded transition ${statusBadgeClasses('info')} hover:opacity-80`} title="View XML" aria-label="View XML"><Code className={`w-4 h-4 ${statusToneClass('info')}`} /></button>
              <button onClick={() => setDeletePoolTarget(pool.name)} className="p-1.5 hover:bg-red-600/20 rounded transition" title="Delete Pool" aria-label="Delete Pool"><Trash2 className={`w-4 h-4 ${statusToneClass('error')}`} /></button>
            </div>
          </div>
        ))}
      </div>
      ) : null}

      <ConfirmDialog open={!!deletePoolTarget} title="Delete Pool" message={`Delete storage pool '${deletePoolTarget}'? This cannot be undone.`} confirmLabel="Delete" onConfirm={handleDeletePool} onCancel={() => setDeletePoolTarget(null)} />

      {showCreatePool && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm" onClick={() => setShowCreatePool(false)}>
          <div className="bg-slate-800 border border-slate-700/50 rounded-2xl shadow-2xl w-full max-w-md mx-4" onClick={(e) => e.stopPropagation()}>
            <div className="p-5 border-b border-slate-700/50"><span className="text-lg font-semibold">Create Storage Pool</span></div>
            <div className="p-5 space-y-4">
              <div>
                <label className="block text-sm text-slate-400 mb-1">Name</label>
                <input type="text" value={newPoolName} onChange={(e) => setNewPoolName(e.target.value)} placeholder="my-pool" className="w-full px-3 py-2 bg-slate-900 border border-slate-700 rounded-lg text-sm" />
              </div>
              <div>
                <label className="block text-sm text-slate-400 mb-1">Type</label>
                <select aria-label="Pool type" value={newPoolType} onChange={(e) => setNewPoolType(e.target.value)} className="w-full px-3 py-2 bg-slate-900 border border-slate-700 rounded-lg text-sm">
                  <option value="dir">dir</option>
                  <option value="fs">fs</option>
                  <option value="netfs">netfs</option>
                  <option value="logical">logical</option>
                  <option value="disk">disk</option>
                  <option value="iscsi">iscsi</option>
                  <option value="zfs">zfs</option>
                </select>
              </div>
              <div>
                <label className="block text-sm text-slate-400 mb-1">Target Path</label>
                <input type="text" value={newPoolPath} onChange={(e) => setNewPoolPath(e.target.value)} placeholder="/var/lib/libvirt/images" className="w-full px-3 py-2 bg-slate-900 border border-slate-700 rounded-lg text-sm" />
              </div>
            </div>
            <div className="flex justify-end gap-3 px-5 pb-5">
              <button onClick={() => setShowCreatePool(false)} className="px-4 py-2 bg-slate-700 hover:bg-slate-600 rounded-lg text-sm font-medium transition">Cancel</button>
              <button onClick={handleCreatePool} className="px-4 py-2 bg-blue-600 hover:bg-blue-500 rounded-lg text-sm text-white font-medium transition">Create</button>
            </div>
          </div>
        </div>
      )}

      {xmlContent !== null && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm" onClick={() => setXmlContent(null)}>
          <div className="bg-slate-800 border border-slate-700/50 rounded-2xl shadow-2xl w-full max-w-3xl mx-4 max-h-[80vh] flex flex-col" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between p-5 border-b border-slate-700/50">
              <span className="text-lg font-semibold font-mono">{xmlName}</span>
              <button onClick={() => setXmlContent(null)} className="text-slate-400 hover:text-white p-1 hover:bg-slate-700 rounded-lg transition"><X className="w-4 h-4" /></button>
            </div>
            <pre className="p-5 text-sm text-slate-300 overflow-auto whitespace-pre-wrap font-mono flex-1">{xmlContent}</pre>
          </div>
        </div>
      )}
    </PageLayout>
  )
}
