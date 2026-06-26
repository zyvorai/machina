// Copyright (c) 2026 ZyvorAI Labs Private Limited. All rights reserved.
// Proprietary software — see LICENSE in the repository root.
// https://zyvor.dev · info@zyvor.dev

import { useEffect, useState, useCallback, useRef } from 'react'
import { Link } from 'react-router'
import {
  listVMs, startVM, stopVM, shutdownVM, pauseVM, resumeVM,
  VmInfo, vmDetailRoute, vmConsoleRoute, vmScopeKey,
} from '../api/vm'
import { deleteVmWithNvramRetry } from '../utils/deleteVmWithNvramRetry'
import { purgeVmShortcuts } from '../utils/vmShortcuts'
import { getStateBadgeClasses } from '../utils/vm'
import { useToastContext } from '../contexts/ToastContext'
import { useWebSocketContext } from '../contexts/WebSocketContext'
import ConfirmDialog from '../components/ConfirmDialog'
import { getAllTags, getVmTags } from '../api/extras'
import { Play, Square, Power, Pause, RotateCcw, Trash2, Search, RefreshCw, Terminal, Tag, LayoutGrid, LayoutList, X, Download, Star, Server, Copy, Monitor } from 'lucide-react'
import VmResolvedSshConnectDialog from '../components/vm/VmResolvedSshConnectDialog'
import { ChoiceCard, ChoiceCardGrid } from '../components/ChoiceCards'
import { downloadJSON, downloadCSV } from '../utils/export'
import { isPinned, togglePin } from '../utils/pinnedVMs'
import EmptyState from '../components/EmptyState'
import PageLayout from '../components/PageLayout'
import { formatUserError } from '../utils/apiError'
import { libvirtErrorHints } from '../utils/libvirtHints'
import { sessionBadgeClasses, statusActionLinkClasses, statusBadgeClasses, statusToneClass } from '../utils/semanticColors'
import { usePlatformInfo } from '../contexts/PlatformInfoContext'

export default function VMList() {
  const [vms, setVMs] = useState<VmInfo[]>([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [search, setSearch] = useState('')
  const [deleteTarget, setDeleteTarget] = useState<{ name: string; libvirt_connection?: string } | null>(null)
  const [vmTagsMap, setVmTagsMap] = useState<Record<string, string[]>>({})
  const [allTagNames, setAllTagNames] = useState<string[]>([])
  const [tagFilter, setTagFilter] = useState('')
  const [selectedVMs, setSelectedVMs] = useState<Set<string>>(new Set())
  const [batchDeleteConfirm, setBatchDeleteConfirm] = useState(false)
  const [viewMode, setViewMode] = useState<'table' | 'grid'>(() => (localStorage.getItem('vmlist-view') as 'table' | 'grid') || 'table')
  const [pinnedRefresh, setPinnedRefresh] = useState(0)
  const [sshVm, setSshVm] = useState<VmInfo | null>(null)
  const toast = useToastContext()
  const { info } = usePlatformInfo()
  const { subscribe } = useWebSocketContext()
  const lastLoadErrorToastAt = useRef(0)

  const load = useCallback(async () => {
    try {
      setLoadError(null)
      const vmList = await listVMs()
      setVMs(vmList)
      // Load tags for all VMs
      const tagMap: Record<string, string[]> = {}
      await Promise.all(vmList.map(async (vm) => {
        try {
          const t = await getVmTags(vm.name)
          tagMap[vmScopeKey(vm)] = t.tags
        } catch { /* optional */ }
      }))
      setVmTagsMap(tagMap)
      // Load all unique tag names
      try { const counts = await getAllTags(); setAllTagNames(Object.keys(counts).sort()) } catch { /* optional */ }
    } catch (e: unknown) {
      const msg = formatUserError(e)
      setLoadError(msg)
      const now = Date.now()
      if (now - lastLoadErrorToastAt.current > 12_000) {
        lastLoadErrorToastAt.current = now
        toast.error(`Failed to load VMs: ${msg}`)
      }
    } finally {
      setLoading(false)
    }
  }, [toast])

  useEffect(() => { load() }, [load])
  useEffect(() => {
    const unsubscribe = subscribe(() => load())
    return () => unsubscribe()
  }, [subscribe, load])

  const action = async (
    vm: VmInfo,
    fn: (n: string, c?: string | null) => Promise<void>,
    label: string,
  ) => {
    try {
      await fn(vm.name, vm.libvirt_connection)
      toast.success(`${label} '${vm.name}' OK`)
      load()
    } catch (e: unknown) {
      toast.error(`${label} '${vm.name}' failed: ${formatUserError(e)}`)
    }
  }

  const handleDelete = async () => {
    if (!deleteTarget) return
    const t = deleteTarget
    setDeleteTarget(null)
    try {
      await deleteVmWithNvramRetry(t.name, undefined, undefined, t.libvirt_connection)
      toast.success(`Deleted '${t.name}'`)
      load()
    } catch (e: unknown) {
      toast.error(`Delete failed: ${formatUserError(e)}`)
    }
  }

  const filtered = vms.filter((v) => {
    const name = (v.name ?? '').toString()
    const state = (v.state ?? 'unknown').toString()
    const q = search.toLowerCase()
    const matchesSearch =
      name.toLowerCase().includes(q) || state.toLowerCase().includes(q)
    const matchesTag = !tagFilter || (vmTagsMap[vmScopeKey(v)] || []).includes(tagFilter)
    return matchesSearch && matchesTag
  })

  const sorted = [...filtered].sort((a, b) => {
    const ap = isPinned(vmScopeKey(a)) ? 0 : 1
    const bp = isPinned(vmScopeKey(b)) ? 0 : 1
    return ap - bp
  })

  const toggleSelect = (key: string) => {
    setSelectedVMs(prev => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }

  const toggleAll = () => {
    if (selectedVMs.size === filtered.length) setSelectedVMs(new Set())
    else setSelectedVMs(new Set(filtered.map(vmScopeKey)))
  }

  const batchRun = async (fn: (name: string, c?: string | null) => Promise<void>, label: string) => {
    const results = await Promise.allSettled(
      Array.from(selectedVMs).map((key) => {
        const vm = vms.find((v) => vmScopeKey(v) === key)
        if (!vm) return Promise.reject(new Error('VM not found'))
        return fn(vm.name, vm.libvirt_connection)
      }),
    )
    const ok = results.filter(r => r.status === 'fulfilled').length
    const fail = results.filter(r => r.status === 'rejected').length
    if (ok > 0) toast.success(`${label}: ${ok} succeeded`)
    if (fail > 0) toast.error(`${label}: ${fail} failed`)
    setSelectedVMs(new Set())
    load()
  }

  const handleBatchDelete = async () => {
    setBatchDeleteConfirm(false)
    const results = await Promise.allSettled(
      Array.from(selectedVMs).map((key) => {
        const vm = vms.find((v) => vmScopeKey(v) === key)
        if (!vm) return Promise.reject(new Error('VM not found'))
        return deleteVmWithNvramRetry(vm.name, undefined, undefined, vm.libvirt_connection)
      }),
    )
    const ok = results.filter((r) => r.status === 'fulfilled').length
    const fail = results.filter((r) => r.status === 'rejected').length
    if (ok > 0) {
      purgeVmShortcuts(
        Array.from(selectedVMs)
          .filter((_, i) => results[i].status === 'fulfilled')
          .map((key) => vms.find((v) => vmScopeKey(v) === key)?.name)
          .filter((n): n is string => Boolean(n)),
      )
      toast.success(`Delete: ${ok} succeeded`)
    }
    if (fail > 0) toast.error(`Delete: ${fail} failed`)
    setSelectedVMs(new Set())
    load()
  }

  useEffect(() => { setSelectedVMs(new Set()) }, [search, tagFilter])
  useEffect(() => { localStorage.setItem('vmlist-view', viewMode) }, [viewMode])

  return (
    <PageLayout
      loading={loading}
      title="Virtual machines"
      subtitle={
        <>
          QEMU/KVM guests on this hypervisor host (libvirt).
          {(info?.libvirt?.extra_uris?.length ?? 0) > 0 && (
            <> Federated read-only hosts: {info!.libvirt!.extra_uris!.join(', ')}.</>
          )}
          {' '}Use VM details for optional KubeVirt bundle / cluster actions when configured.
        </>
      }
      error={loadError}
      errorTitle="Failed to load virtual machines"
      errorTone="red"
      errorHints={loadError ? libvirtErrorHints(loadError) : undefined}
      technicalDetail={loadError}
      onErrorRetry={() => void load()}
      onErrorDismiss={() => setLoadError(null)}
      actions={
        <>
          <button onClick={() => downloadJSON(filtered, 'vms.json')} className="p-2 hover:bg-slate-700 rounded transition" title="Export JSON" aria-label="Export JSON"><Download className="w-4 h-4" /></button>
          <button onClick={() => downloadCSV(filtered as unknown as Record<string, unknown>[], 'vms.csv')} className="p-2 hover:bg-slate-700 rounded transition" title="Export CSV" aria-label="Export CSV"><Download className={`w-4 h-4 ${statusToneClass('ok')}`} /></button>
          <ChoiceCardGrid className="max-w-[220px] sm:max-w-[240px] [&_button]:min-h-0">
            <ChoiceCard
              compact
              tone="slate"
              selected={viewMode === 'table'}
              onClick={() => setViewMode('table')}
              icon={<LayoutList className="w-4 h-4" />}
              title="Table"
              description="Dense rows"
            />
            <ChoiceCard
              compact
              tone="slate"
              selected={viewMode === 'grid'}
              onClick={() => setViewMode('grid')}
              icon={<LayoutGrid className="w-4 h-4" />}
              title="Grid"
              description="Card tiles"
            />
          </ChoiceCardGrid>
          <button onClick={load} className="p-2 hover:bg-slate-700 rounded transition" title="Refresh" aria-label="Refresh VM list">
            <RefreshCw className="w-4 h-4" />
          </button>
          <Link to="/create" className="px-4 py-2 bg-blue-600 hover:bg-blue-700 rounded text-sm transition">+ Create VM</Link>
        </>
      }
    >
      <div className="flex items-center gap-3">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
          <input
            type="text"
            aria-label="Search VMs"
            placeholder="Search VMs..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className={`w-full pl-10 py-2 bg-slate-800/50 border border-slate-700/50 rounded-lg text-sm focus:outline-none focus:border-blue-500 ${search ? 'pr-8' : 'pr-4'}`}
          />
          {search && (
            <button type="button" aria-label="Clear search" onClick={() => setSearch('')}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-200">
              <X className="w-4 h-4" />
            </button>
          )}
        </div>
        {allTagNames.length > 0 && (
          <div className="flex items-center gap-1.5">
            <Tag className="w-4 h-4 text-slate-400" />
            <select
              value={tagFilter}
              onChange={(e) => setTagFilter(e.target.value)}
              aria-label="Filter by tag"
              className="bg-slate-800/50 border border-slate-700/50 rounded-lg text-sm py-2 px-3 focus:outline-none focus:border-blue-500 text-slate-300"
            >
              <option value="">All tags</option>
              {allTagNames.map(t => <option key={t} value={t}>{t}</option>)}
            </select>
          </div>
        )}
      </div>

      {filtered.length === 0 ? (
        <EmptyState
          icon={<Server className="w-6 h-6" />}
          title={search || tagFilter ? 'No VMs match your filters' : 'No guests on this host'}
          description={
            search || tagFilter
              ? 'Try a different search or clear the tag filter.'
              : 'Create a new VM or import an existing disk image to define a libvirt domain.'
          }
          primaryAction={
            !search && !tagFilter ? (
              <Link to="/create" className="px-4 py-2 rounded-lg bg-blue-600 hover:bg-blue-500 text-white text-sm font-medium">
                Create VM
              </Link>
            ) : undefined
          }
          secondaryAction={
            !search && !tagFilter ? (
              <Link to="/import" className="px-4 py-2 rounded-lg border border-slate-600 text-slate-300 hover:bg-slate-800 text-sm">
                Import VM
              </Link>
            ) : undefined
          }
        />
      ) : viewMode === 'table' ? (
        <div className="card overflow-hidden">
          <table className="w-full" aria-label="Virtual machines">
            <thead>
              <tr className="border-b border-slate-700/50 text-left text-sm text-slate-400">
                <th className="px-3 py-3 w-8">
                  <input type="checkbox" checked={selectedVMs.size === filtered.length && filtered.length > 0} onChange={toggleAll} className="rounded border-slate-600 bg-slate-900" />
                </th>
                <th className="px-6 py-3">Name</th>
                <th className="px-6 py-3">State</th>
                <th className="px-6 py-3 hidden md:table-cell">vCPUs</th>
                <th className="px-6 py-3 hidden md:table-cell">Memory</th>
                <th className="px-6 py-3 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-700/50">
              {sorted.map((vm) => (
                <tr key={vmScopeKey(vm)} className="hover:bg-slate-700/50 transition">
                  <td className="px-3 py-4">
                    <input type="checkbox" checked={selectedVMs.has(vmScopeKey(vm))} onChange={() => toggleSelect(vmScopeKey(vm))} className="rounded border-slate-600 bg-slate-900" />
                  </td>
                  <td className="px-6 py-4">
                    <div className="flex items-center gap-2 flex-wrap">
                      <button onClick={(e) => { e.preventDefault(); togglePin(vmScopeKey(vm)); setPinnedRefresh(n => n + 1) }} className="p-1 hover:bg-yellow-600/20 rounded transition" title={isPinned(vmScopeKey(vm)) ? 'Unpin' : 'Pin'}>
                        <Star className={`w-3.5 h-3.5 ${isPinned(vmScopeKey(vm)) ? `${statusToneClass('warn')} fill-[var(--machina-status-warn)]` : 'text-slate-500'}`} />
                      </button>
                      <Link to={vmDetailRoute(vm.name, vm.libvirt_connection)} className={`font-medium ${statusActionLinkClasses('info')}`}>{vm.name}</Link>
                      {vm.libvirt_connection === 'session' && (
                        <span className={sessionBadgeClasses()}>session</span>
                      )}
                      {(vmTagsMap[vmScopeKey(vm)] || []).map(t => (
                        <span key={t} className={`px-1.5 py-0.5 rounded-full text-[10px] font-medium ${statusBadgeClasses('info')}`}>{t}</span>
                      ))}
                    </div>
                  </td>
                  <td className="px-6 py-4">
                    <span className={`px-2 py-1 rounded text-xs font-medium ${getStateBadgeClasses(vm.state)}`}>{vm.state}</span>
                  </td>
                  <td className="px-6 py-4 hidden md:table-cell text-slate-300">{vm.vcpus}</td>
                  <td className="px-6 py-4 hidden md:table-cell text-slate-300">{vm.memory_mb} MB</td>
                  <td className="px-6 py-4">
                    <div className="flex items-center justify-end gap-1">
                      {vm.state === 'running' && (
                        <>
                          <Link to={vmConsoleRoute(vm.name, vm.libvirt_connection)} className="p-1.5 hover:bg-slate-600/30 rounded transition" title="VNC console" aria-label="VNC console">
                            <Monitor className="w-4 h-4 text-slate-300" />
                          </Link>
                          <button type="button" onClick={() => setSshVm(vm)} className="p-1.5 hover:bg-slate-600/30 rounded transition" title="SSH" aria-label="SSH">
                            <Terminal className="w-4 h-4 text-slate-300" />
                          </button>
                          {vm.guest_ip && (
                            <button
                              type="button"
                              onClick={() => { void navigator.clipboard.writeText(vm.guest_ip!); toast.success('Guest IP copied') }}
                              className="p-1.5 hover:bg-slate-600/30 rounded transition"
                              title="Copy guest IP"
                              aria-label="Copy guest IP"
                            >
                              <Copy className="w-4 h-4 text-slate-300" />
                            </button>
                          )}
                        </>
                      )}
                      {vm.state === 'shutoff' && (
                        <button onClick={() => action(vm, startVM, 'Start')} className={`p-1.5 rounded transition hover:bg-[color-mix(in_srgb,var(--machina-status-ok)_25%,transparent)]`} title="Start" aria-label="Start">
                          <Play className={`w-4 h-4 ${statusToneClass('ok')}`} />
                        </button>
                      )}
                      {vm.state === 'running' && (
                        <>
                          <button onClick={() => action(vm, shutdownVM, 'Shutdown')} className={`p-1.5 rounded transition hover:bg-[color-mix(in_srgb,var(--machina-status-warn)_25%,transparent)]`} title="Shutdown" aria-label="Shutdown">
                            <Power className={`w-4 h-4 ${statusToneClass('warn')}`} />
                          </button>
                          <button onClick={() => action(vm, stopVM, 'Stop')} className={`p-1.5 rounded transition hover:bg-[color-mix(in_srgb,var(--machina-status-error)_25%,transparent)]`} title="Force Stop" aria-label="Force Stop">
                            <Square className={`w-4 h-4 ${statusToneClass('error')}`} />
                          </button>
                          <button onClick={() => action(vm, pauseVM, 'Pause')} className={`p-1.5 rounded transition hover:bg-[color-mix(in_srgb,var(--machina-status-info)_25%,transparent)]`} title="Pause" aria-label="Pause">
                            <Pause className={`w-4 h-4 ${statusToneClass('info')}`} />
                          </button>
                        </>
                      )}
                      {vm.state === 'paused' && (
                        <button onClick={() => action(vm, resumeVM, 'Resume')} className={`p-1.5 rounded transition hover:bg-[color-mix(in_srgb,var(--machina-status-ok)_25%,transparent)]`} title="Resume" aria-label="Resume">
                          <RotateCcw className={`w-4 h-4 ${statusToneClass('ok')}`} />
                        </button>
                      )}
                      <button onClick={() => setDeleteTarget({ name: vm.name, libvirt_connection: vm.libvirt_connection })} className={`p-1.5 rounded transition hover:bg-[color-mix(in_srgb,var(--machina-status-error)_25%,transparent)]`} title="Delete" aria-label="Delete">
                        <Trash2 className={`w-4 h-4 ${statusToneClass('error')}`} />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {sorted.map((vm) => (
            <div key={vmScopeKey(vm)} className="card p-5 hover:border-white/15 transition-all">
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-2 min-w-0">
                  <input type="checkbox" checked={selectedVMs.has(vmScopeKey(vm))} onChange={() => toggleSelect(vmScopeKey(vm))} className="rounded border-slate-600 bg-slate-900 shrink-0" />
                  <button onClick={(e) => { e.preventDefault(); togglePin(vmScopeKey(vm)); setPinnedRefresh(n => n + 1) }} className="p-1 hover:bg-yellow-600/20 rounded transition" title={isPinned(vmScopeKey(vm)) ? 'Unpin' : 'Pin'}>
                    <Star className={`w-3.5 h-3.5 ${isPinned(vmScopeKey(vm)) ? `${statusToneClass('warn')} fill-[var(--machina-status-warn)]` : 'text-slate-500'}`} />
                  </button>
                  <Link to={vmDetailRoute(vm.name, vm.libvirt_connection)} className={`font-semibold truncate ${statusActionLinkClasses('info')}`}>{vm.name}</Link>
                  {vm.libvirt_connection === 'session' && (
                    <span className={sessionBadgeClasses('shrink-0')}>session</span>
                  )}
                </div>
                <span className={`px-2 py-0.5 rounded text-xs font-medium shrink-0 ${getStateBadgeClasses(vm.state)}`}>{vm.state}</span>
              </div>
              <div className="space-y-1 text-sm text-slate-300 mb-3">
                <div className="flex justify-between"><span className="text-slate-500">vCPUs</span><span>{vm.vcpus}</span></div>
                <div className="flex justify-between"><span className="text-slate-500">Memory</span><span>{vm.memory_mb} MB</span></div>
              </div>
              {(vmTagsMap[vmScopeKey(vm)] || []).length > 0 && (
                <div className="flex flex-wrap gap-1 mb-3">
                  {(vmTagsMap[vmScopeKey(vm)] || []).map(t => (
                    <span key={t} className={`px-1.5 py-0.5 rounded-full text-[10px] font-medium ${statusBadgeClasses('info')}`}>{t}</span>
                  ))}
                </div>
              )}
              <div className="flex items-center gap-1 pt-3 border-t border-slate-700/50">
                {vm.state === 'running' && (
                  <>
                    <Link to={vmConsoleRoute(vm.name, vm.libvirt_connection)} className="p-1.5 hover:bg-slate-600/30 rounded transition" title="VNC" aria-label="VNC"><Monitor className="w-4 h-4 text-slate-300" /></Link>
                    <button type="button" onClick={() => setSshVm(vm)} className="p-1.5 hover:bg-slate-600/30 rounded transition" title="SSH" aria-label="SSH"><Terminal className="w-4 h-4 text-slate-300" /></button>
                    {vm.guest_ip && (
                      <button type="button" onClick={() => { void navigator.clipboard.writeText(vm.guest_ip!); toast.success('Guest IP copied') }} className="p-1.5 hover:bg-slate-600/30 rounded transition" title="Copy IP" aria-label="Copy IP"><Copy className="w-4 h-4 text-slate-300" /></button>
                    )}
                    <button onClick={() => action(vm, shutdownVM, 'Shutdown')} className={`p-1.5 rounded transition hover:bg-[color-mix(in_srgb,var(--machina-status-warn)_25%,transparent)]`} title="Shutdown" aria-label="Shutdown"><Power className={`w-4 h-4 ${statusToneClass('warn')}`} /></button>
                    <button onClick={() => action(vm, stopVM, 'Stop')} className={`p-1.5 rounded transition hover:bg-[color-mix(in_srgb,var(--machina-status-error)_25%,transparent)]`} title="Force Stop" aria-label="Force Stop"><Square className={`w-4 h-4 ${statusToneClass('error')}`} /></button>
                    <button onClick={() => action(vm, pauseVM, 'Pause')} className={`p-1.5 rounded transition hover:bg-[color-mix(in_srgb,var(--machina-status-info)_25%,transparent)]`} title="Pause" aria-label="Pause"><Pause className={`w-4 h-4 ${statusToneClass('info')}`} /></button>
                  </>
                )}
                {vm.state === 'shutoff' && (
                  <button onClick={() => action(vm, startVM, 'Start')} className={`p-1.5 rounded transition hover:bg-[color-mix(in_srgb,var(--machina-status-ok)_25%,transparent)]`} title="Start" aria-label="Start"><Play className={`w-4 h-4 ${statusToneClass('ok')}`} /></button>
                )}
                {vm.state === 'paused' && (
                  <button onClick={() => action(vm, resumeVM, 'Resume')} className={`p-1.5 rounded transition hover:bg-[color-mix(in_srgb,var(--machina-status-ok)_25%,transparent)]`} title="Resume" aria-label="Resume"><RotateCcw className={`w-4 h-4 ${statusToneClass('ok')}`} /></button>
                )}
                <div className="flex-1" />
                <button onClick={() => setDeleteTarget({ name: vm.name, libvirt_connection: vm.libvirt_connection })} className={`p-1.5 rounded transition hover:bg-[color-mix(in_srgb,var(--machina-status-error)_25%,transparent)]`} title="Delete" aria-label="Delete"><Trash2 className={`w-4 h-4 ${statusToneClass('error')}`} /></button>
              </div>
            </div>
          ))}
        </div>
      )}

      {selectedVMs.size > 0 && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-40 bg-slate-800 border border-slate-700/50 rounded-xl shadow-2xl px-4 py-3 flex items-center gap-3 animate-fade-in">
          <span className="text-sm font-medium">{selectedVMs.size} selected</span>
          <div className="w-px h-5 bg-slate-700" />
          <button onClick={() => batchRun(startVM, 'Start')} className={`px-3 py-1.5 rounded-lg text-xs font-medium transition ${statusBadgeClasses('ok')}`}>Start</button>
          <button onClick={() => batchRun(shutdownVM, 'Shutdown')} className={`px-3 py-1.5 rounded-lg text-xs font-medium transition ${statusBadgeClasses('warn')}`}>Shutdown</button>
          <button onClick={() => batchRun(stopVM, 'Stop')} className={`px-3 py-1.5 rounded-lg text-xs font-medium transition ${statusBadgeClasses('error')}`}>Stop</button>
          <button onClick={() => setBatchDeleteConfirm(true)} className={`px-3 py-1.5 rounded-lg text-xs font-medium transition ${statusBadgeClasses('error')}`}>Delete</button>
          <button onClick={() => setSelectedVMs(new Set())} className="p-1.5 hover:bg-slate-700 rounded-lg transition" title="Clear selection" aria-label="Clear selection"><X className="w-4 h-4 text-slate-400" /></button>
        </div>
      )}

      <ConfirmDialog
        open={!!deleteTarget}
        title="Delete VM"
        message={`This will stop '${deleteTarget?.name ?? ''}' if it is running, then remove its libvirt definition. If you already deleted disk files on the host, the server still drops the VM record. Disks under libvirt storage are not removed unless you use separate storage tools.`}
        confirmLabel="Delete"
        typeToMatch={deleteTarget?.name ?? ''}
        onConfirm={handleDelete}
        onCancel={() => setDeleteTarget(null)}
      />

      <ConfirmDialog
        open={batchDeleteConfirm}
        title="Delete VMs"
        message={`This will permanently delete ${selectedVMs.size} VMs (stop if running, then undefine). Type DELETE to confirm. Missing backend disk files are tolerated when cleaning up definitions.`}
        confirmLabel="Delete All"
        typeToMatch="DELETE"
        typeToMatchLabel="Type DELETE (all caps) to confirm bulk delete:"
        onConfirm={handleBatchDelete}
        onCancel={() => setBatchDeleteConfirm(false)}
      />

      {sshVm && (
        <VmResolvedSshConnectDialog
          open
          vmName={sshVm.name}
          guestIp={sshVm.guest_ip ?? ''}
          defaultUser="root"
          onClose={() => setSshVm(null)}
          onNotify={(m) => toast.success(m)}
        />
      )}
    </PageLayout>
  )
}
