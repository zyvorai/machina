// Copyright (c) 2026 ZyvorAI Labs Private Limited. All rights reserved.

import { Link, useNavigate, useSearchParams } from 'react-router'
import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  FolderOpen,
  Monitor,
  Plus,
  RefreshCw,
  Server,
  Tag,
} from 'lucide-react'
import PageLayout from '../../components/PageLayout'
import { StructuredErrorBanner } from '../../components/StructuredErrorBanner'
import PlatformEmptyState from '../../components/platform/PlatformEmptyState'
import FinderView, { type FinderViewMode } from '../../components/platform/mac/FinderView'
import { LaunchpadAppIcon } from '../../components/platform/mac/PlatformMacUi'
import SimpleCreateVmWizard, { sizeToSpec, type VmWizardInitial } from '../../components/platform/SimpleCreateVmWizard'
import WindowsCreateWizard from '../../components/platform/WindowsCreateWizard'
import MigratePrecheckModal from '../../components/platform/MigratePrecheckModal'
import {
  adoptPlatformVm,
  createPlatformVm,
  getFleetFinder,
  listPlatformHosts,
  listPlatformVms,
  type CreatePlatformVmBody,
  type FleetFinderOverview,
  type PlatformApiError,
  type PlatformHost,
  type PlatformVm,
} from '../../api/platform'
import { useToastContext } from '../../contexts/ToastContext'
import { formatUserError } from '../../utils/apiError'
import { hubLinkClasses } from '../../utils/semanticColors'

type ViewMode = 'launchpad' | 'list' | 'columns'

const VM_VIEW_STORAGE_KEY = 'platform-vms-view'

function readStoredView(): ViewMode {
  try {
    const v = localStorage.getItem(VM_VIEW_STORAGE_KEY)
    if (v === 'list' || v === 'launchpad' || v === 'columns') return v
    if (v === 'grid') return 'launchpad'
  } catch { /* private mode */ }
  return 'launchpad'
}

function SidebarRow({
  active,
  label,
  count,
  onClick,
}: {
  active: boolean
  label: string
  count: number
  onClick: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`w-full flex items-center justify-between gap-2 px-3 py-2 rounded-lg text-sm text-left transition ${
        active ? 'bg-blue-500/15 text-blue-200' : 'text-slate-300 hover:bg-slate-800/60'
      }`}
    >
      <span className="truncate">{label}</span>
      <span className="text-xs text-slate-500 shrink-0">{count}</span>
    </button>
  )
}

export default function PlatformVms() {
  const toast = useToastContext()
  const navigate = useNavigate()
  const [searchParams, setSearchParams] = useSearchParams()
  const folder = searchParams.get('folder') || 'all'
  const tag = searchParams.get('tag') || ''
  const project = searchParams.get('project') || ''
  const source = searchParams.get('source') || ''

  const [vms, setVms] = useState<PlatformVm[]>([])
  const [finder, setFinder] = useState<FleetFinderOverview | null>(null)
  const [hosts, setHosts] = useState<PlatformHost[]>([])
  const [error, setError] = useState<{ message: string; error_code?: string; remediation?: string } | null>(null)
  const [view, setView] = useState<ViewMode>(() => readStoredView())
  const [wizardOpen, setWizardOpen] = useState(false)
  const [wizardInitial, setWizardInitial] = useState<VmWizardInitial | undefined>()
  const [windowsOpen, setWindowsOpen] = useState(false)
  const [dragVmId, setDragVmId] = useState<string | null>(null)
  const [migrateModal, setMigrateModal] = useState<{ vm: PlatformVm; destId: string; destName: string } | null>(null)
  const [dropHost, setDropHost] = useState<string | null>(null)
  const [search, setSearch] = useState('')
  const [selectedVmId, setSelectedVmId] = useState<string | null>(null)

  const hostMap = useMemo(() => new Map(hosts.map((h) => [h.id, h.hostname])), [hosts])
  const vmById = useMemo(() => new Map(vms.map((v) => [v.id, v])), [vms])

  const filteredVms = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return vms
    return vms.filter((v) => v.name.toLowerCase().includes(q) || (v.tags ?? []).some((t) => t.toLowerCase().includes(q)))
  }, [vms, search])

  const finderViewMode: FinderViewMode = view === 'list' ? 'list' : view === 'columns' ? 'columns' : 'icons'
  const setFinderViewMode = (mode: FinderViewMode) => {
    if (mode === 'list') setView('list')
    else if (mode === 'columns') setView('columns')
    else setView('launchpad')
  }

  const selectedVm = filteredVms.find((v) => v.id === selectedVmId) ?? filteredVms[0] ?? null

  const setFilter = useCallback((next: { folder?: string; tag?: string; project?: string; source?: string }) => {
    const p = new URLSearchParams(searchParams)
    if (next.source !== undefined) {
      if (next.source) p.set('source', next.source)
      else p.delete('source')
      p.delete('folder')
      p.delete('tag')
      p.delete('project')
    }
    if (next.folder !== undefined) {
      if (next.folder === 'all') p.delete('folder')
      else p.set('folder', next.folder)
      p.delete('tag')
      p.delete('project')
      p.delete('source')
    }
    if (next.tag !== undefined) {
      if (next.tag) p.set('tag', next.tag)
      else p.delete('tag')
      p.delete('folder')
      p.delete('project')
    }
    if (next.project !== undefined) {
      if (next.project) p.set('project', next.project)
      else p.delete('project')
      p.delete('folder')
      p.delete('tag')
    }
    setSearchParams(p, { replace: true })
  }, [searchParams, setSearchParams])

  const load = useCallback(async () => {
    setError(null)
    try {
      const listParams: Parameters<typeof listPlatformVms>[0] = {}
      if (source) listParams.source = source
      if (tag) listParams.tag = tag
      else if (project) listParams.project = project
      else if (folder && folder !== 'all') listParams.folder = folder

      const [v, h, f] = await Promise.all([
        listPlatformVms(listParams),
        listPlatformHosts(),
        getFleetFinder().catch(() => null),
      ])
      setVms(v)
      setHosts(h)
      setFinder(f)
    } catch (e: unknown) {
      const err = e as PlatformApiError
      setError({
        message: err.message || formatUserError(e),
        error_code: err.error_code,
        remediation: err.remediation,
      })
    }
  }, [folder, tag, project, source])

  useEffect(() => { void load() }, [load])

  useEffect(() => {
    try { localStorage.setItem(VM_VIEW_STORAGE_KEY, view) } catch { /* ignore */ }
  }, [view])

  useEffect(() => {
    const create = searchParams.get('create')
    if (!create) return
    setWizardInitial({
      name: create,
      os: searchParams.get('os') ?? undefined,
      size: searchParams.get('size') ?? undefined,
      network: searchParams.get('network') ?? undefined,
    })
    setWizardOpen(true)
    const next = new URLSearchParams(searchParams)
    next.delete('create')
    next.delete('os')
    next.delete('size')
    next.delete('network')
    setSearchParams(next, { replace: true })
  }, [searchParams, setSearchParams])

  const buildVmBody = (name: string, os: string, size: string, network: string, extraTags: string[] = []): CreatePlatformVmBody => {
    const spec = sizeToSpec(size)
    return {
      api_version: 'virt.zyvor.dev/v1',
      kind: 'VirtualMachine',
      metadata: { name },
      tags: [os, network, ...extraTags],
      spec: {
        cpu: { sockets: 1, cores: spec.cores },
        memory: spec.memory,
        storage: [{ name: 'root', size: spec.disk, class: 'silver' }],
        network: [{ network, ip_mode: 'dhcp' }],
      },
    }
  }

  const handleCreate = async (payload: { name: string; os: string; size: string; network: string }) => {
    await createPlatformVm(buildVmBody(payload.name, payload.os, payload.size, payload.network))
    toast.success('Create task queued')
    await load()
  }

  const handleWindowsCreate = async (payload: {
    name: string
    os: string
    size: string
    network: string
    windows: { virtio: boolean; uefi: boolean; tpm: boolean; secureBoot: boolean; rdp: boolean }
  }) => {
    const spec = sizeToSpec(payload.size)
    const labels: Record<string, string> = { os_family: 'windows' }
    if (payload.windows.tpm) labels.tpm = 'true'
    if (payload.windows.secureBoot) labels.secure_boot = 'true'
    if (payload.windows.virtio) labels.virtio_win = 'true'
    if (payload.windows.rdp) labels.rdp = 'true'
    const body: CreatePlatformVmBody = {
      api_version: 'virt.zyvor.dev/v1',
      kind: 'VirtualMachine',
      metadata: { name: payload.name, labels },
      tags: ['windows', payload.os, payload.network],
      spec: {
        cpu: { sockets: 1, cores: spec.cores },
        memory: spec.memory,
        firmware: payload.windows.uefi ? 'uefi' : 'bios',
        storage: [{ name: 'root', size: spec.disk, class: 'silver' }],
        network: [{ network: payload.network, ip_mode: 'dhcp' }],
      },
    }
    await createPlatformVm(body)
    toast.success('Windows VM create queued')
    await load()
  }

  const onHostDrop = (hostId: string) => {
    const vmId = dragVmId
    setDropHost(null)
    setDragVmId(null)
    if (!vmId) return
    const vm = vmById.get(vmId)
    const host = hosts.find((h) => h.id === hostId)
    if (!vm || !host || vm.host_id === hostId) return
    setMigrateModal({ vm, destId: hostId, destName: host.hostname })
  }

  const activeLabel =
    tag ? `#${tag}` :
    project ? project :
    finder?.smart_folders.find((f) => f.id === folder)?.label ?? 'All VMs'

  const toolbar = (
    <>
      <button type="button" className="btn-secondary" onClick={() => void load()}><RefreshCw className="w-4 h-4" /></button>
      <button type="button" className="btn-secondary" onClick={() => setWindowsOpen(true)}>Windows VM</button>
      <button type="button" className="btn-primary flex items-center gap-2" onClick={() => setWizardOpen(true)}><Plus className="w-4 h-4" /> Create VM</button>
    </>
  )

  const vmGrid = view === 'launchpad' ? (
    <div className="grid gap-6 grid-cols-3 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6">
      {filteredVms.map((v) => {
        const running = v.observed_state === 'running'
        return (
          <div
            key={v.id}
            draggable
            onDragStart={(e) => {
              e.dataTransfer.setData('application/x-platform-vm', v.id)
              e.dataTransfer.effectAllowed = 'move'
              setDragVmId(v.id)
            }}
            onClick={() => setSelectedVmId(v.id)}
            className={`cursor-grab active:cursor-grabbing rounded-2xl p-1 ${selectedVmId === v.id ? 'ring-1 ring-sky-400/40' : ''}`}
          >
            <Link to={`/platform/vms/${v.id}`} onClick={(e) => e.stopPropagation()} className="block">
              <LaunchpadAppIcon
                name={v.name}
                icon={<Monitor className={`w-8 h-8 sm:w-9 sm:h-9 ${running ? '' : 'opacity-60'}`} />}
                gradient={running ? 'from-emerald-600 to-teal-700' : 'from-slate-600 to-slate-800'}
              />
            </Link>
            {(v.tags ?? []).length > 0 && (
              <p className="text-[10px] text-slate-500 text-center truncate px-1">{(v.tags ?? []).slice(0, 2).join(' · ')}</p>
            )}
          </div>
        )
      })}
    </div>
  ) : (
    <div className="card overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="text-left text-slate-400 border-b border-white/[0.04]">
            <th className="p-3">Name</th>
            <th className="p-3">Source</th>
            <th className="p-3">State</th>
            <th className="p-3">Tags</th>
            <th className="p-3">Host</th>
            <th className="p-3">vCPU</th>
            <th className="p-3">Memory</th>
          </tr>
        </thead>
        <tbody>
          {filteredVms.map((v) => (
            <tr
              key={v.id}
              className={`border-b border-slate-900/80 cursor-pointer ${selectedVmId === v.id ? 'bg-sky-500/10' : 'hover:bg-white/[0.02]'}`}
              onClick={() => setSelectedVmId(v.id)}
            >
              <td className="p-3"><Link to={`/platform/vms/${v.id}`} className={`hover:underline ${hubLinkClasses()}`} onClick={(e) => e.stopPropagation()}>{v.name}</Link></td>
              <td className="p-3 text-xs text-slate-500 capitalize">{v.inventory_source ?? 'libvirt'}</td>
              <td className="p-3 capitalize">
                {v.observed_state}
                {v.observed_state === 'missing' && (
                  <span className="ml-1 text-[10px] text-amber-400/90">(missing)</span>
                )}
              </td>
              <td className="p-3 text-xs text-slate-500">{(v.tags ?? []).join(', ') || '—'}</td>
              <td className="p-3 text-slate-500">
                {v.inventory_source === 'kubevirt'
                  ? (v.k8s_namespace ? `${v.k8s_namespace}/` : 'k8s/')
                  : v.host_id
                    ? hostMap.get(v.host_id)
                    : '—'}
              </td>
              <td className="p-3">{v.vcpus}</td>
              <td className="p-3">{Math.round(v.memory_mib / 1024)} Gi</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )

  const inspector = selectedVm ? (
    <div className="p-4 space-y-3 h-full overflow-y-auto">
      <h3 className="font-semibold text-white">{selectedVm.name}</h3>
      <dl className="grid grid-cols-2 gap-2 text-xs">
        <div><dt className="text-white/40">Source</dt><dd className="capitalize text-white">{selectedVm.inventory_source ?? 'libvirt'}</dd></div>
        <div><dt className="text-white/40">State</dt><dd className="capitalize text-white">{selectedVm.observed_state}{selectedVm.observed_state === 'missing' ? ' (missing from inventory)' : ''}</dd></div>
        <div><dt className="text-white/40">Host</dt><dd className="text-white">{selectedVm.inventory_source === 'kubevirt' ? (selectedVm.k8s_namespace ?? 'default') : selectedVm.host_id ? hostMap.get(selectedVm.host_id) : '—'}</dd></div>
        <div><dt className="text-white/40">vCPU</dt><dd className="text-white">{selectedVm.vcpus}</dd></div>
        <div><dt className="text-white/40">Memory</dt><dd className="text-white">{Math.round(selectedVm.memory_mib / 1024)} Gi</dd></div>
      </dl>
      <Link to={`/platform/vms/${selectedVm.id}`} className="btn-primary text-sm block text-center">Open VM</Link>
      <Link to={`/platform/vms/${selectedVm.id}/console`} className="btn-secondary text-sm block text-center">Console</Link>
      {selectedVm.managed === false && (
        <button type="button" className="btn-secondary text-xs" onClick={async () => {
          try { await adoptPlatformVm(selectedVm.id); toast.success('Adopted'); await load() } catch (e: unknown) { toast.error(formatUserError(e)) }
        }}>Adopt discovered VM</button>
      )}
    </div>
  ) : null

  return (
    <PageLayout hideHeader compact contentClassName="space-y-4">
      {finder && <p className="text-sm text-white/45">{finder.summary}</p>}
      {error && <StructuredErrorBanner error={error} />}

      <FinderView
        title="Finder"
        search={search}
        onSearchChange={setSearch}
        searchPlaceholder="Search VMs…"
        viewMode={finderViewMode}
        onViewModeChange={setFinderViewMode}
        toolbarActions={toolbar}
        pathSegments={[
          { label: 'Platform', onClick: () => navigate('/platform') },
          { label: 'Finder', onClick: () => setFilter({ folder: 'all' }) },
          { label: activeLabel },
        ]}
        columnsContent={
          <div className="flex min-h-[420px] border border-white/[0.06] rounded-xl overflow-hidden">
            <aside className="w-44 shrink-0 border-r border-white/[0.06] p-2 space-y-0.5 overflow-y-auto">
              {(finder?.smart_folders ?? []).map((f) => (
                <SidebarRow key={f.id} active={!tag && !project && folder === f.id} label={f.label} count={f.count} onClick={() => setFilter({ folder: f.id })} />
              ))}
            </aside>
            <div className="w-52 shrink-0 border-r border-white/[0.06] overflow-y-auto">
              {filteredVms.map((v) => (
                <button
                  key={v.id}
                  type="button"
                  onClick={() => setSelectedVmId(v.id)}
                  className={`w-full text-left px-3 py-2 text-sm border-b border-white/[0.04] ${selectedVm?.id === v.id ? 'bg-sky-500/15 text-sky-100' : 'text-white/80 hover:bg-white/[0.03]'}`}
                >
                  {v.name}
                </button>
              ))}
            </div>
            <div className="flex-1 min-w-0 overflow-y-auto">
              {selectedVm ? inspector : <p className="p-4 text-sm text-white/40">Select a VM</p>}
            </div>
          </div>
        }
        listContent={
          <div className="flex flex-col xl:flex-row gap-4">
            <aside className="xl:w-52 shrink-0 space-y-4">
              <div>
                <p className="text-[10px] font-semibold uppercase tracking-wider text-white/40 flex items-center gap-1 mb-2">
                  <FolderOpen className="w-3 h-3" /> Smart Folders
                </p>
                <div className="space-y-0.5">
                  {(finder?.smart_folders ?? []).map((f) => (
                    <SidebarRow key={f.id} active={!tag && !project && !source && folder === f.id} label={f.label} count={f.count} onClick={() => setFilter({ folder: f.id })} />
                  ))}
                </div>
              </div>
              <div>
                <p className="text-[10px] font-semibold uppercase tracking-wider text-white/40 mb-2">Inventory</p>
                <div className="space-y-0.5">
                  <SidebarRow active={!source && !tag && !project && folder === 'all'} label="All sources" count={vms.length} onClick={() => { const p = new URLSearchParams(searchParams); p.delete('source'); setSearchParams(p, { replace: true }) }} />
                  <SidebarRow active={source === 'libvirt'} label="Libvirt" count={vms.filter((v) => (v.inventory_source ?? 'libvirt') === 'libvirt').length} onClick={() => { const p = new URLSearchParams(searchParams); p.set('source', 'libvirt'); p.delete('folder'); setSearchParams(p, { replace: true }) }} />
                  <SidebarRow active={source === 'kubevirt'} label="KubeVirt" count={vms.filter((v) => v.inventory_source === 'kubevirt').length} onClick={() => { const p = new URLSearchParams(searchParams); p.set('source', 'kubevirt'); p.delete('folder'); setSearchParams(p, { replace: true }) }} />
                  <SidebarRow active={folder === 'discovered'} label="Discovered" count={vms.filter((v) => v.managed === false).length} onClick={() => setFilter({ folder: 'discovered' })} />
                  <SidebarRow active={folder === 'missing'} label="Missing" count={vms.filter((v) => v.observed_state === 'missing').length} onClick={() => setFilter({ folder: 'missing' })} />
                </div>
              </div>
              {(finder?.tags.length ?? 0) > 0 && (
                <div>
                  <p className="text-[10px] font-semibold uppercase tracking-wider text-white/40 flex items-center gap-1 mb-2">
                    <Tag className="w-3 h-3" /> Tags
                  </p>
                  <div className="space-y-0.5 max-h-48 overflow-y-auto">
                    {finder!.tags.map((t) => (
                      <SidebarRow key={t.tag} active={tag === t.tag} label={`#${t.tag}`} count={t.count} onClick={() => setFilter({ tag: t.tag })} />
                    ))}
                  </div>
                </div>
              )}
              {(finder?.projects.length ?? 0) > 0 && (
                <div>
                  <p className="text-[10px] font-semibold uppercase tracking-wider text-white/40 mb-2">Projects</p>
                  <div className="space-y-0.5">
                    {finder!.projects.map((p) => (
                      <SidebarRow key={p.project} active={project === p.project} label={p.project} count={p.count} onClick={() => setFilter({ project: p.project })} />
                    ))}
                  </div>
                </div>
              )}
            </aside>
            <div className="flex-1 min-w-0">{vmGrid}</div>
            <aside className="xl:w-44 shrink-0 space-y-2 hidden xl:block">
              <p className="text-xs font-semibold uppercase tracking-wider text-white/40 flex items-center gap-1"><Server className="w-3 h-3" /> Drop to migrate</p>
              {hosts.map((h) => (
                <div
                  key={h.id}
                  onDragOver={(e) => { e.preventDefault(); setDropHost(h.id) }}
                  onDragLeave={() => setDropHost(null)}
                  onDrop={(e) => { e.preventDefault(); onHostDrop(h.id) }}
                  className={`rounded-xl border p-3 text-sm transition ${
                    dropHost === h.id ? 'border-blue-500 bg-blue-500/10' : 'border-white/[0.06] bg-slate-900/40'
                  }`}
                >
                  <p className="font-medium">{h.hostname}</p>
                  <p className="text-xs text-slate-500">{h.state} · {h.vm_count} VMs</p>
                </div>
              ))}
            </aside>
          </div>
        }
        inspector={inspector}
        isEmpty={filteredVms.length === 0 && !error}
        emptyState={
          <PlatformEmptyState title="No virtual machines" subtitle="Try another smart folder or create a VM.">
            <button type="button" className="btn-primary mt-3" onClick={() => setWizardOpen(true)}>Create VM</button>
          </PlatformEmptyState>
        }
      />

      <SimpleCreateVmWizard open={wizardOpen} onClose={() => setWizardOpen(false)} onCreate={handleCreate} initial={wizardInitial} />
      <WindowsCreateWizard open={windowsOpen} onClose={() => setWindowsOpen(false)} onCreate={handleWindowsCreate} />
      {migrateModal && (
        <MigratePrecheckModal
          vm={migrateModal.vm}
          destHostId={migrateModal.destId}
          destHostName={migrateModal.destName}
          onClose={() => setMigrateModal(null)}
          onDone={() => { toast.success('Migration queued'); void load() }}
        />
      )}
    </PageLayout>
  )
}
