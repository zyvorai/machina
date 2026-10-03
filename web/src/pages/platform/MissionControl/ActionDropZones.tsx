// Copyright 2026 Zyvor AI Labs · https://zyvor.dev
// SPDX-License-Identifier: LicenseRef-Zyvor-Production-1.0

import { Link } from 'react-router'
import {
  Camera,
  HardDrive,
  Network,
  Sparkles,
  Trash2,
} from 'lucide-react'
import { createVmBackup } from '../../../api/platform'
import { useToastContext } from '../../../contexts/ToastContext'
import { formatUserError } from '../../../utils/apiError'
import type { MissionControlFleetState } from './useMissionControlFleet'

const ZONES = [
  { id: 'backup', label: 'Backup', icon: HardDrive, color: 'border-emerald-500/40' },
  { id: 'migrate', label: 'Migrate', icon: Network, color: 'border-[var(--accent)]/40' },
  { id: 'snapshot', label: 'Snapshot', icon: Camera, color: 'border-[var(--accent)]/40' },
  { id: 'recovery', label: 'Recovery', icon: HardDrive, color: 'border-amber-500/40' },
  { id: 'trace', label: 'Network Trace', icon: Network, color: 'border-[var(--accent)]/40' },
  { id: 'diagnose', label: 'AI Diagnose', icon: Sparkles, color: 'border-fuchsia-500/40' },
  { id: 'delete', label: 'Delete', icon: Trash2, color: 'border-red-500/40' },
] as const

type Props = {
  state: MissionControlFleetState
}

export default function ActionDropZones({ state }: Props) {
  const toast = useToastContext()
  const { dragVmId, setDragVmId, vmSnapshotAction, vmDeleteAction, hosts } = state

  const handleDrop = async (zoneId: string) => {
    const vmId = dragVmId
    setDragVmId(null)
    if (!vmId) return
    const vm = state.vms.find((v) => v.id === vmId)
    if (!vm) return

    try {
      if (zoneId === 'backup') {
        await createVmBackup(vm.id)
        toast.success(`Backup queued for ${vm.name}`)
      } else if (zoneId === 'snapshot') {
        await vmSnapshotAction(vm)
      } else if (zoneId === 'delete') {
        await vmDeleteAction(vm)
      } else if (zoneId === 'migrate' && hosts.length > 1) {
        const dest = hosts.find((h) => h.id !== vm.host_id)
        if (dest) state.setMigrateModal({ vm, destId: dest.id, destName: dest.hostname })
      } else if (zoneId === 'recovery') {
        window.location.href = `/platform/vms/${vm.id}?tab=backups`
      } else if (zoneId === 'trace') {
        window.location.href = '/platform/zyra'
      } else if (zoneId === 'diagnose') {
        window.location.href = `/platform/vms/${vm.id}?tab=guestHealth`
      }
    } catch (e: unknown) {
      toast.error(formatUserError(e))
    }
  }

  if (!dragVmId) return null

  return (
    <section className="mc-action-zones rounded-2xl border border-dashed border-[var(--accent)]/40 bg-[var(--accent)]/5 p-4" data-testid="action-drop-zones">
      <p className="text-sm text-[var(--link)] mb-3">Drop machine on an action</p>
      <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 gap-2">
        {ZONES.map((z) => {
          const Icon = z.icon
          return (
            <div
              key={z.id}
              onDragOver={(e) => e.preventDefault()}
              onDrop={(e) => { e.preventDefault(); void handleDrop(z.id) }}
              className={`rounded-xl border p-3 text-center text-xs transition hover:scale-[1.02] ${z.color} bg-[var(--apple-surface)]/50`}
            >
              <Icon className="w-4 h-4 mx-auto mb-1 text-[var(--text-secondary)]" />
              {z.label}
            </div>
          )
        })}
      </div>
      <Link to={`/platform/vms?lens=migration`} className="text-xs text-[var(--link)]/80 mt-2 inline-block hover:underline">Open migration planner</Link>
    </section>
  )
}
