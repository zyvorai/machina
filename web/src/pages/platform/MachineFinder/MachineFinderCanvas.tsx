// Copyright (c) 2026 ZyvorAI Labs Private Limited. All rights reserved.

import PlatformEmptyState from '../../../components/platform/PlatformEmptyState'
import { openCenterPopout } from '../../../utils/platformCenterPopout'
import { cinemaPopoutPath } from '../../../utils/consoleExperienceMode'
import { groupVmsBySource } from './groupVmsBySource'
import LivingMachineCard from './LivingMachineCard'
import MachineFinderHeatmapLens from './MachineFinderHeatmapLens'
import MachineFinderTableLens from './MachineFinderTableLens'
import MachineFinderTimelineLens from './MachineFinderTimelineLens'
import MachineFinderTopologyLens from './MachineFinderTopologyLens'
import MigrationHeroZone from './MigrationHeroZone'
import type { MachineFinderState } from './useMachineFinder'

type Props = {
  state: MachineFinderState
}

export default function MachineFinderCanvas({ state }: Props) {
  const {
    lens,
    overlay,
    filteredVms,
    hostMap,
    setSelectedVmId,
    setDragVmId,
    setSshVm,
    error,
    folder,
    pruneBusy,
    pruneMissing,
  } = state

  if (lens === 'topology') return <MachineFinderTopologyLens state={state} />
  if (lens === 'table') return <MachineFinderTableLens state={state} />
  if (lens === 'timeline') return <MachineFinderTimelineLens />
  if (lens === 'heatmap') return <MachineFinderHeatmapLens />
  if (lens === 'migration') {
    return (
      <div className="space-y-4">
        <MigrationHeroZone state={state} />
        <GridLens state={state} compact />
      </div>
    )
  }

  return (
    <>
    <div className="machine-finder-canvas space-y-4 min-h-[40vh]" data-testid="machine-finder-canvas">
      {folder === 'missing' && filteredVms.length > 0 && (
        <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 p-4 text-sm text-amber-100">
          <p className="font-medium">Missing from hypervisor inventory</p>
          <p className="text-xs text-amber-200/80 mt-1">Prune removes stale database rows (admin only).</p>
          <button type="button" className="btn-danger text-sm mt-2" disabled={pruneBusy} onClick={() => pruneMissing()}>
            {pruneBusy ? 'Pruning…' : 'Prune missing records'}
          </button>
        </div>
      )}

      <GridLens state={state} />

      {!error && filteredVms.length === 0 && (
        <PlatformEmptyState title="No machines" subtitle="Try another smart folder or create a VM.">
          <button type="button" className="btn-primary mt-3" onClick={() => state.setWizardOpen(true)}>New VM</button>
        </PlatformEmptyState>
      )}

      <MigrationHeroZone state={state} compact />
    </div>
    </>
  )
}

function GridLens({ state, compact }: { state: MachineFinderState; compact?: boolean }) {
  const groups = groupVmsBySource(state.filteredVms, state.hostMap)

  if (groups.length === 0) return null

  return (
    <div className="space-y-6">
      {groups.map((group) => (
        <section key={group.key}>
          <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-500 mb-3">{group.label}</h3>
          <div className={`grid gap-4 ${compact ? 'grid-cols-2 sm:grid-cols-3 lg:grid-cols-4' : 'grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6'}`}>
            {group.vms.map((vm) => (
              <LivingMachineCard
                key={vm.id}
                vm={vm}
                selected={state.selectedVmId === vm.id}
                overlay={state.overlay}
                onSelect={() => state.setSelectedVmId(vm.id)}
                onDragStart={() => state.setDragVmId(vm.id)}
                onSsh={() => state.setSshVm(vm)}
                guestIp={state.displayGuestIp(vm)}
                onDoubleClickTheatre={() => openCenterPopout(cinemaPopoutPath(vm.id))}
                aiSecurity={state.aiSecurity}
              />
            ))}
          </div>
        </section>
      ))}
    </div>
  )
}
