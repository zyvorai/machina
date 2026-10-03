// Copyright 2026 Zyvor AI Labs · https://zyvor.dev
// SPDX-License-Identifier: LicenseRef-Zyvor-Production-1.0

import { Link } from 'react-router'
import { Monitor, Cpu, MemoryStick } from 'lucide-react'
import type { PlatformVm } from '../../api/platform'
import VmStatusBadge from '../VmStatusBadge'
import { statusBadgeClasses } from '../../utils/semanticColors'
import { vmCardAccentClass, vmSemanticKind } from '../../utils/vmVisual'

interface VmCardProps {
  vm: PlatformVm
  hostLabel?: string
  cpuPercent?: number
  memoryUsedMib?: number
  draggable?: boolean
  onDragStart?: () => void
}

export default function VmCard({ vm, hostLabel, cpuPercent, memoryUsedMib, draggable, onDragStart }: VmCardProps) {
  const kind = vmSemanticKind(vm.observed_state || vm.desired_state)
  const running = kind === 'running'
  const inner = (
    <>
      <div className="flex items-start gap-3">
        <div className={`p-2.5 rounded-xl ${running ? statusBadgeClasses('ok') : 'bg-[var(--apple-surface)] text-[var(--text-muted)]'}`}>
          <Monitor className="w-5 h-5" />
        </div>
        <div className="flex-1 min-w-0">
          <h2 className="font-semibold text-[var(--text-primary)] truncate group-hover:text-[var(--text-primary)]">{vm.name}</h2>
          <div className="mt-1">
            <VmStatusBadge state={vm.observed_state || vm.desired_state} />
          </div>
        </div>
        {vm.managed === false && (
          <span className={`text-[10px] px-1.5 py-0.5 rounded ${statusBadgeClasses('warn')}`}>Discovered</span>
        )}
      </div>
      <div className="mt-4 flex flex-wrap gap-3 text-xs text-[var(--text-muted)]">
        <span className="flex items-center gap-1"><Cpu className="w-3 h-3" /> {cpuPercent != null ? `${cpuPercent.toFixed(0)}%` : `${vm.vcpus} vCPU`}</span>
        <span className="flex items-center gap-1"><MemoryStick className="w-3 h-3" /> {memoryUsedMib != null ? `${memoryUsedMib} MiB` : `${Math.round(vm.memory_mib / 1024)} Gi`}</span>
      </div>
      {hostLabel && <p className="mt-2 text-[10px] text-[var(--text-faint)] truncate">{hostLabel}</p>}
    </>
  )
  const className = `platform-vm-card machina-vm-card-accent ${vmCardAccentClass(vm.observed_state || vm.desired_state)} group block rounded-2xl border border-[var(--apple-hairline)]/80 bg-[var(--apple-surface)] p-4 hover:border-[var(--apple-hairline)]/80 hover:bg-[var(--apple-surface)] transition-all hover:shadow-lg hover:shadow-black/20`
  if (draggable) {
    return (
      <div
        draggable
        onDragStart={(e) => {
          e.dataTransfer.setData('application/x-platform-vm', vm.id)
          e.dataTransfer.effectAllowed = 'move'
          onDragStart?.()
        }}
        className={`${className} cursor-grab active:cursor-grabbing`}
      >
        <Link to={`/platform/vms/${vm.id}`} onClick={(e) => e.stopPropagation()}>{inner}</Link>
      </div>
    )
  }
  return <Link to={`/platform/vms/${vm.id}`} className={className}>{inner}</Link>
}
