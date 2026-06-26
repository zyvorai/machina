// Copyright (c) 2026 ZyvorAI Labs Private Limited. All rights reserved.

import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  adoptPlatformVm,
  createVmSnapshot,
  getCapacityReport,
  getClusterSummary,
  getFleetFinder,
  listMissingTemplateImages,
  listPlatformHosts,
  listPlatformTasks,
  listPlatformVms,
  vmPower,
  type CapacityReport,
  type ClusterSummary,
  type FleetFinderOverview,
  type PlatformHost,
  type PlatformVm,
} from '../../../api/platform'
import { useToastContext } from '../../../contexts/ToastContext'
import { usePlatformDesktopTier } from '../../../hooks/usePlatformDesktopTier'
import { formatUserError } from '../../../utils/apiError'
import { toastQueuedOperation } from '../../../utils/platformTaskToast'
import { queuePlatformVmDelete } from '../../../utils/platformVmDelete'
import type { VmPowerAction } from '../../../components/platform/fleet/fleetCommandCenterTypes'

export function useMissionControlFleet() {
  const toast = useToastContext()
  const [tier] = usePlatformDesktopTier()
  const [hosts, setHosts] = useState<PlatformHost[]>([])
  const [vms, setVms] = useState<PlatformVm[]>([])
  const [finder, setFinder] = useState<FleetFinderOverview | null>(null)
  const [cluster, setCluster] = useState<ClusterSummary | null>(null)
  const [capacity, setCapacity] = useState<CapacityReport | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [selectedVmId, setSelectedVmId] = useState<string | null>(null)
  const [attentionMode, setAttentionMode] = useState(false)
  const [sshVm, setSshVm] = useState<PlatformVm | null>(null)
  const [migrateModal, setMigrateModal] = useState<{ vm: PlatformVm; destId: string; destName: string } | null>(null)
  const [dragVmId, setDragVmId] = useState<string | null>(null)
  const [deleteVmTarget, setDeleteVmTarget] = useState<PlatformVm | null>(null)

  const hostMap = useMemo(() => new Map(hosts.map((h) => [h.id, h.hostname])), [hosts])

  const load = useCallback(async () => {
    setError(null)
    try {
      const [h, v, f, c, cap] = await Promise.all([
        listPlatformHosts(),
        listPlatformVms(),
        getFleetFinder().catch(() => null),
        getClusterSummary().catch(() => null),
        getCapacityReport().catch(() => null),
        listPlatformTasks().catch(() => []),
        listMissingTemplateImages().catch(() => ({ missing: [], count: 0, auto_fetch_count: 0, summary: '' })),
      ])
      setHosts(Array.isArray(h) ? h : [])
      setVms(Array.isArray(v) ? v : [])
      setFinder(f)
      setCluster(c)
      setCapacity(cap)
    } catch (e: unknown) {
      setError(formatUserError(e))
    }
  }, [])

  useEffect(() => { void load() }, [load])

  const running = vms.filter((v) => v.observed_state === 'running').length
  const onlineHosts = hosts.filter((h) => h.state !== 'offline').length
  const storagePct = capacity && capacity.memory_total_mib > 0
    ? (capacity.memory_used_mib / capacity.memory_total_mib) * 100
    : null
  const needsAttention = finder?.smart_folders.find((f) => f.id === 'needs_attention')?.count ?? 0
  const unprotected = finder?.smart_folders.find((f) => f.id === 'unprotected')?.count ?? 0

  const attentionVmIds = useMemo(() => {
    const ids = new Set<string>()
    for (const v of vms) {
      const s = v.guest_tools_status?.toLowerCase()
      const noBackup = false // client-side backup check deferred
      const noIp = !v.guest_ip
      const badAgent = v.inventory_source !== 'kubevirt' && s !== 'healthy' && s !== 'installed'
      const stopped = v.observed_state !== 'running' && v.observed_state !== 'missing'
      if (noIp || badAgent || stopped || noBackup) ids.add(v.id)
    }
    return ids
  }, [vms])

  const displayVms = useMemo(() => {
    if (!attentionMode) return vms
    return vms.filter((v) => attentionVmIds.has(v.id))
  }, [vms, attentionMode, attentionVmIds])

  const vmsByHost = useMemo(() => {
    const map = new Map<string, PlatformVm[]>()
    for (const vm of displayVms) {
      const key = vm.host_id ?? '__unassigned__'
      const list = map.get(key) ?? []
      list.push(vm)
      map.set(key, list)
    }
    return map
  }, [displayVms])

  const selectedVm = selectedVmId ? vms.find((v) => v.id === selectedVmId) ?? null : null

  const vmPowerAction = async (vm: PlatformVm, action: VmPowerAction) => {
    if (vm.inventory_source === 'kubevirt') {
      toast.error('Power actions apply to libvirt VMs only')
      return
    }
    try {
      const r = await vmPower(vm.id, action)
      toastQueuedOperation(toast, `${action} ${vm.name}`, r.task_id, tier)
      await load()
    } catch (e: unknown) {
      toast.error(formatUserError(e))
    }
  }

  const vmSnapshotAction = async (vm: PlatformVm) => {
    if (vm.inventory_source === 'kubevirt') {
      toast.error('Snapshots apply to libvirt VMs only')
      return
    }
    const name = `snap-${Date.now()}`
    try {
      const r = await createVmSnapshot(vm.id, name)
      toastQueuedOperation(toast, `Snapshot ${vm.name}`, r.task_id, tier)
      await load()
    } catch (e: unknown) {
      toast.error(formatUserError(e))
    }
  }

  const vmDeleteAction = (vm: PlatformVm) => {
    if (vm.inventory_source === 'kubevirt') {
      toast.error('KubeVirt guests must be deleted from the cluster')
      return
    }
    setDeleteVmTarget(vm)
  }

  const doVmDeleteAction = async (vm: PlatformVm) => {
    try {
      await queuePlatformVmDelete(vm, toast, tier)
      if (selectedVmId === vm.id) setSelectedVmId(null)
      setVms((prev) => prev.filter((v) => v.id !== vm.id))
      void load()
    } catch (e: unknown) {
      toast.error(formatUserError(e))
    }
  }

  const adoptVm = async (vm: PlatformVm) => {
    try {
      await adoptPlatformVm(vm.id)
      toast.success('Adopted')
      await load()
    } catch (e: unknown) {
      toast.error(formatUserError(e))
    }
  }

  return {
    hosts,
    vms,
    displayVms,
    vmsByHost,
    finder,
    cluster,
    capacity,
    error,
    load,
    hostMap,
    running,
    onlineHosts,
    storagePct,
    needsAttention,
    unprotected,
    selectedVm,
    selectedVmId,
    setSelectedVmId,
    attentionMode,
    setAttentionMode,
    sshVm,
    setSshVm,
    migrateModal,
    setMigrateModal,
    dragVmId,
    setDragVmId,
    vmPowerAction,
    vmSnapshotAction,
    vmDeleteAction,
    doVmDeleteAction,
    deleteVmTarget,
    setDeleteVmTarget,
    adoptVm,
    tier,
  }
}

export type MissionControlFleetState = ReturnType<typeof useMissionControlFleet>
