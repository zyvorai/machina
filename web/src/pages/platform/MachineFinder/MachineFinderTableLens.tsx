// Copyright (c) 2026 ZyvorAI Labs Private Limited. All rights reserved.

import { Link } from 'react-router'
import { Copy, Monitor, Terminal } from 'lucide-react'
import PlatformEmptyState from '../../../components/platform/PlatformEmptyState'
import VmStatusBadge from '../../../components/VmStatusBadge'
import { guestToolsStatusLabel } from '../../../utils/guestAgentUx'
import { hubLinkClasses, statusPillClasses } from '../../../utils/semanticColors'
import { cinemaHubPath } from '../../../utils/consoleExperienceMode'
import { formatVmMemoryGiB } from '../../../utils/vmVisual'
import { useToastContext } from '../../../contexts/ToastContext'
import type { MachineFinderState } from './useMachineFinder'
import MachineFinderTableUsageCell from '../../../components/platform/MachineFinderTableUsageCell'
import MachineFinderParityBadges from '../../../components/platform/MachineFinderParityBadges'

type Props = {
  state: MachineFinderState
}

export default function MachineFinderTableLens({ state }: Props) {
  const toast = useToastContext()
  const {
    filteredVms,
    hostMap,
    selectedVmId,
    setSelectedVmId,
    selectedVmIds,
    toggleVmSelect,
    toggleAllVisible,
    setSshVm,
    displayGuestIp,
  } = state

  const runningLibvirtIds = filteredVms
    .filter((v) => v.observed_state === 'running' && v.inventory_source !== 'kubevirt')
    .map((v) => v.id)

  if (filteredVms.length === 0) {
    return (
      <PlatformEmptyState title="No machines" subtitle="Try another smart folder or create a VM.">
        <button type="button" className="btn-primary mt-3" onClick={() => state.setWizardOpen(true)}>New VM</button>
      </PlatformEmptyState>
    )
  }

  return (
    <div className="card overflow-x-auto" data-testid="machine-finder-table">
      <table className="w-full text-sm" aria-label="Virtual machines">
        <thead>
          <tr className="text-left text-slate-400 border-b border-white/[0.04]">
            <th className="p-3 w-10">
              <input
                type="checkbox"
                aria-label="Select all visible machines"
                checked={filteredVms.length > 0 && selectedVmIds.size === filteredVms.length}
                onChange={toggleAllVisible}
              />
            </th>
            <th className="p-3">Name</th>
            <th className="p-3">Source</th>
            <th className="p-3">State</th>
            <th className="p-3">Host</th>
            <th className="p-3">Guest IP</th>
            <th className="p-3">Guest agent</th>
            <th className="p-3">vCPU</th>
            <th className="p-3">Memory</th>
            <th className="p-3">Usage</th>
            <th className="p-3 text-right">Access</th>
          </tr>
        </thead>
        <tbody>
          {filteredVms.map((v) => {
            const running = v.observed_state === 'running'
            const libvirt = v.inventory_source !== 'kubevirt'
            return (
              <tr
                key={v.id}
                className={`border-b border-slate-900/80 cursor-pointer ${selectedVmId === v.id ? 'bg-sky-500/10' : 'hover:bg-white/[0.02]'}`}
                onClick={() => setSelectedVmId(v.id)}
              >
                <td className="p-3" onClick={(e) => e.stopPropagation()}>
                  <input type="checkbox" aria-label={`Select ${v.name}`} checked={selectedVmIds.has(v.id)} onChange={() => toggleVmSelect(v.id)} />
                </td>
                <td className="p-3">
                  <Link to={`/platform/vms/${v.id}`} className={`hover:underline ${hubLinkClasses()}`} onClick={(e) => e.stopPropagation()}>{v.name}</Link>
                  <MachineFinderParityBadges vm={v} batchVmIds={runningLibvirtIds} />
                </td>
                <td className="p-3 text-xs text-slate-500 capitalize">{v.inventory_source ?? 'libvirt'}</td>
                <td className="p-3"><VmStatusBadge state={v.observed_state} /></td>
                <td className="p-3 text-slate-500">
                  {v.inventory_source === 'kubevirt'
                    ? (v.k8s_namespace ? `${v.k8s_namespace}/` : 'k8s/')
                    : v.host_id ? hostMap.get(v.host_id) : '—'}
                </td>
                <td className="p-3 font-mono text-xs text-emerald-300/80">{displayGuestIp(v) || '—'}</td>
                <td className="p-3">
                  {libvirt ? (
                    <span className={statusPillClasses(v.guest_tools_status === 'healthy' || v.guest_tools_status === 'installed' ? 'ok' : 'warn')}>
                      {guestToolsStatusLabel(v.guest_tools_status)}
                    </span>
                  ) : '—'}
                </td>
                <td className="p-3">{v.vcpus}</td>
                <td className="p-3">{formatVmMemoryGiB(v.memory_mib)}</td>
                <td className="p-3">
                  <MachineFinderTableUsageCell vmId={v.id} running={running} memoryMib={v.memory_mib} />
                </td>
                <td className="p-3 text-right" onClick={(e) => e.stopPropagation()}>
                  {running && libvirt && (
                    <div className="inline-flex gap-1 justify-end">
                      <Link to={cinemaHubPath(v.id)} className="btn-secondary text-xs py-1 px-2" title="Open Cinema" aria-label="Open Cinema"><Monitor className="w-3.5 h-3.5" /></Link>
                      <button type="button" className="btn-secondary text-xs py-1 px-2" title="SSH" aria-label="SSH" onClick={() => setSshVm(v)}><Terminal className="w-3.5 h-3.5" /></button>
                      {(displayGuestIp(v)) && (
                        <button
                          type="button"
                          className="btn-secondary text-xs py-1 px-2"
                          title="Copy guest IP"
                          onClick={() => {
                            void navigator.clipboard.writeText(displayGuestIp(v))
                            toast.success('Guest IP copied')
                          }}
                        >
                          <Copy className="w-3.5 h-3.5" />
                        </button>
                      )}
                    </div>
                  )}
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}
