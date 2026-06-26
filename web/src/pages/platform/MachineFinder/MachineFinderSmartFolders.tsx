// Copyright (c) 2026 ZyvorAI Labs Private Limited. All rights reserved.

import { FolderOpen, Server, Tag } from 'lucide-react'
import type { MachineFinderState } from './useMachineFinder'
import type { PlatformVm } from '../../../api/platform'

function liveSmartFolderCount(folder: { id: string; count: number }, vms: PlatformVm[]): number {
  switch (folder.id) {
    case 'all':
      return vms.length
    case 'running':
      return vms.filter((v) => v.observed_state === 'running').length
    case 'stopped':
      return vms.filter((v) => v.observed_state !== 'running' && v.observed_state !== 'missing').length
    default:
      return folder.count
  }
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

type Props = {
  state: MachineFinderState
}

export default function MachineFinderSmartFolders({ state }: Props) {
  const {
    folder,
    tag,
    project,
    source,
    finder,
    sourceCounts,
    vms,
    setFilter,
    searchParams,
    setSearchParams,
  } = state

  const setSource = (src: string) => {
    const p = new URLSearchParams(searchParams)
    if (src) {
      p.set('source', src)
      p.delete('folder')
    } else {
      p.delete('source')
    }
    p.delete('tag')
    p.delete('project')
    setSearchParams(p, { replace: true })
  }

  return (
    <aside className="machine-finder-sidebar w-full xl:w-52 shrink-0 space-y-4" data-testid="machine-finder-smart-folders">
      <div>
        <p className="text-[10px] font-semibold uppercase tracking-wider text-white/40 flex items-center gap-1 mb-2">
          <FolderOpen className="w-3 h-3" /> Smart Folders
        </p>
        <div className="space-y-0.5">
          {(finder?.smart_folders ?? []).map((f) => (
            <SidebarRow
              key={f.id}
              active={!tag && !project && !source && folder === f.id}
              label={f.label}
              count={liveSmartFolderCount(f, vms)}
              onClick={() => setFilter({ folder: f.id })}
            />
          ))}
        </div>
      </div>

      <div>
        <p className="text-[10px] font-semibold uppercase tracking-wider text-white/40 flex items-center gap-1 mb-2">
          <Server className="w-3 h-3" /> Sources
        </p>
        <div className="space-y-0.5">
          <SidebarRow active={!source && folder === 'all' && !tag && !project} label="All Machines" count={state.vms.length} onClick={() => setFilter({ folder: 'all', source: '' })} />
          <SidebarRow active={source === 'libvirt'} label="Libvirt" count={sourceCounts.libvirt} onClick={() => setSource('libvirt')} />
          <SidebarRow active={source === 'kubevirt'} label="KubeVirt" count={sourceCounts.kubevirt} onClick={() => setSource('kubevirt')} />
          <SidebarRow active={source === 'vmware'} label="VMware" count={sourceCounts.vmware} onClick={() => setSource('vmware')} />
          <SidebarRow active={source === 'openstack'} label="OpenStack" count={sourceCounts.openstack} onClick={() => setSource('openstack')} />
          <SidebarRow active={!source && folder === 'discovered'} label="Discovered" count={sourceCounts.discovered} onClick={() => setFilter({ folder: 'discovered' })} />
        </div>
      </div>

      {(finder?.tags?.length ?? 0) > 0 && (
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-wider text-white/40 flex items-center gap-1 mb-2">
            <Tag className="w-3 h-3" /> Tags
          </p>
          <div className="space-y-0.5">
            {(finder?.tags ?? []).map((t) => (
              <SidebarRow key={t.tag} active={tag === t.tag} label={`#${t.tag}`} count={t.count} onClick={() => setFilter({ tag: t.tag })} />
            ))}
          </div>
        </div>
      )}

      {(finder?.projects?.length ?? 0) > 0 && (
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-wider text-white/40 mb-2">Projects</p>
          <div className="space-y-0.5">
            {(finder?.projects ?? []).map((p) => (
              <SidebarRow key={p.project} active={project === p.project} label={p.project} count={p.count} onClick={() => setFilter({ project: p.project })} />
            ))}
          </div>
        </div>
      )}
    </aside>
  )
}
