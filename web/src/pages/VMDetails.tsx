// Copyright (c) 2026 ZyvorAI Labs Private Limited. All rights reserved.
// Proprietary software — see LICENSE in the repository root.
// https://zyvor.dev · info@zyvor.dev

import { useCallback, useEffect, useState, useRef, useMemo, Fragment } from 'react'
import { useParams, Link, useNavigate, useSearchParams } from 'react-router'
import {
  getVM, getVMMetrics, getVMXml, startVM, stopVM, shutdownVM, rebootVM, pauseVM, resumeVM,
  setAutostart, setVcpus, setMemory, setMemoryBalloon, setBootOrder,
  cloneVM, renameVM, migrateVM, resizeDisk, attachInterface, detachInterface,
  getInterfaces, getHostname, getBootConfig, hasManagedSave, managedSave, managedSaveRemove,
  getGuestObservability, getGuestHealth, type GuestObservability, type GuestHealthReport,
  insertCdrom, ejectCdrom, getVMLogs, getCpuTune, getMemTune, getKubeVirtBundle, KubeVirtBundle,
  postKubeVirtApply, postKubeVirtUpload, postKubeVirtStart, type KubeVirtClusterExecResult,
  getBlockJobInfo, blockCommit, blockPull, blockJobAbort, vmDetailRoute, vmConsoleRoute, appendVmConnection,
  setMemTune as applyMemTuneApi, setSchedulerTune, pinVcpu, getNumaTune, setNumaTune, pinEmulator,
  VmDetails, VmMetrics, GuestIpAddress, BootConfig, CpuTuneInfo, MemTuneInfo,
  VmDeleteUndefineOpts, BlockJobInfo,
  tuneVmDisk, tuneVmNic, setVmFirmware, attachVmTpm, detachVmTpm,
  attachVmWatchdog, attachVmSound, attachVmSerial, setVmVideoModel,
  addShare, removeShare,
} from '../api/vm'
import { listPlatformVms, getConsoleHubPlan, listVmPortForwards, listPlatformHosts, type VmPortForwardRule, type PlatformVm, type PlatformHost } from '../api/platform'
import { getVmDoctor, type VmDoctorReport } from '../api/ai'
import {
  attachPciHostdev, detachPciHostdev, detachNodeDevice, reattachNodeDevice,
  compareCpu, getVmJobStats, type VmJobStats, type CpuCompareResult,
} from '../api/advanced'
import { listNetworks, NetworkInfo } from '../api/network'
import { listSnapshots, createSnapshot, deleteSnapshot, revertSnapshot, SnapshotInfo, SnapshotDiskSpec } from '../api/snapshot'
import { getStateBadgeClasses, formatBytes } from '../utils/vm'
import { sessionBadgeClasses, statusActionLinkClasses, statusBadgeClasses, statusBgClass, statusSurfaceClasses, statusToneClass, utilizationTone } from '../utils/semanticColors'
import { loadVmSshPrefs } from '../utils/vmSshPrefs'
import VmDailyAccessStrip from '../components/vm/VmDailyAccessStrip'
import ClassicVmPlatformHardware from './classic/ClassicVmPlatformHardware'
import ClassicVmSpiceToVncButton from './classic/ClassicVmSpiceToVncButton'
import VmPortForwardPanel from '../components/vm/VmPortForwardPanel'
import VmSshConnectDialog, { navigateVmSshSession } from '../components/vm/VmSshConnectDialog'
import type { GuestAccessHints } from '../utils/guestAccessHints'
import { addRecentVM } from '../utils/recentVMs'
import { purgeVmShortcuts } from '../utils/vmShortcuts'
import { guestIpv4GatewayHints } from '../utils/guestIpv4GatewayHints'
import { getSession, type SessionRole } from '../api/auth'
import { snapshotForest, type SnapshotTreeNode } from '../utils/snapshotTree'
import { deleteVmWithNvramRetry } from '../utils/deleteVmWithNvramRetry'
import PageLayout from '../components/PageLayout'
import PageSkeleton from '../components/PageSkeleton'
import ConfirmDialog from '../components/ConfirmDialog'
import LibvirtOpenStackPushModal from '../components/LibvirtOpenStackPushModal'
import { usePlatformInfo } from '../contexts/PlatformInfoContext'
import { useOpenStackConnection } from '../hooks/useOpenStackConnection'
import { ChoiceCard, ChoiceCardDenseGrid } from '../components/ChoiceCards'
import { BrowseHostPathModal, isHostDiskImageFileName, isIsoFileName } from '../components/BrowseHostPathModal'
import { useToastContext } from '../contexts/ToastContext'
import { formatUserError } from '../utils/apiError'
import CollapsibleCodeBlock from '../components/CollapsibleCodeBlock'
import GuacamoleConsoleLink from '../components/GuacamoleConsoleLink'
import RdpConsoleLink from '../components/RdpConsoleLink'
import { libvirtErrorHints } from '../utils/libvirtHints'
import { triggerBackup } from '../api/backup'
import { listUsbDevices, attachUsb, detachUsb, listIsos, UsbDevice, ImageFile, liveSetVcpus, liveSetMemory, getVmTags, setVmTags as apiSetVmTags, listPciDevices, PciDevice, saveVmAsTemplate, listIommuGroups, IommuGroup } from '../api/extras'
import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts'
import {
  ArrowLeft, Play, Square, Power, RotateCcw, Pause, RefreshCw,
  ToggleLeft, ToggleRight, Cpu, HardDrive, Network, Camera, Terminal,
  Save, Disc, Archive, Copy, Pencil, ArrowRightLeft, Download,
  Plus, Trash2, RotateCw, Code, MemoryStick, Settings, Usb, Layers,
  ChevronUp, ChevronDown, X, Tag, Monitor, Shield, Sliders, FolderOpen, Cloud,
} from 'lucide-react'

interface MetricsPoint { time: string; memory: number; diskRd: number; diskWr: number; netRx: number; netTx: number }

function SnapshotTableRows({
  nodes,
  depth,
  onRevert,
  onDelete,
}: {
  nodes: SnapshotTreeNode[]
  depth: number
  onRevert: (n: string) => void
  onDelete: (n: string) => void
}) {
  return (
    <>
      {nodes.map(({ snap, children }) => (
        <Fragment key={snap.name}>
          <tr className="table-row-hover">
            <td className="px-6 py-3 text-sm text-slate-500" style={{ paddingLeft: `${1.5 + depth * 1}rem` }}>
              {snap.parent ? <span className="text-slate-600 mr-1">↳</span> : null}
              <span className="font-medium text-slate-200">{snap.name}</span>
              {snap.description ? <span className="text-xs text-slate-500 ml-2">{snap.description}</span> : null}
            </td>
            <td className="px-6 py-3 text-sm text-slate-400">{snap.state}</td>
            <td className="px-6 py-3 text-sm text-slate-400">{snap.creation_time ? new Date(snap.creation_time * 1000).toLocaleString() : '-'}</td>
            <td className="px-6 py-3">{snap.is_current && <span className={`text-xs font-medium ${statusToneClass('ok')}`}>Current</span>}</td>
            <td className="px-6 py-3 text-right">
              <div className="flex items-center justify-end gap-1">
                <button type="button" onClick={() => onRevert(snap.name)} className="p-1 hover:bg-blue-600/20 rounded transition" title="Revert" aria-label={`Revert ${snap.name}`}>
                  <RotateCw className={`w-4 h-4 ${statusToneClass('info')}`} />
                </button>
                <button type="button" onClick={() => onDelete(snap.name)} className="p-1 hover:bg-red-600/20 rounded transition" title="Delete" aria-label={`Delete ${snap.name}`}>
                  <Trash2 className={`w-4 h-4 ${statusToneClass('error')}`} />
                </button>
              </div>
            </td>
          </tr>
          <SnapshotTableRows nodes={children} depth={depth + 1} onRevert={onRevert} onDelete={onDelete} />
        </Fragment>
      ))}
    </>
  )
}

type Tab = 'overview' | 'disks' | 'network' | 'snapshots' | 'devices' | 'xml' | 'logs' | 'advanced'
type Dialog = null | 'cdrom' | 'clone' | 'rename' | 'migrate' | 'snapshot' | 'boot-order' | 'vcpus' | 'memory' | 'balloon' | 'attach-disk' | 'resize-disk' | 'attach-nic' | 'attach-usb' | 'save-template'
  | 'delete-vm' | 'scheduler-tune' | 'memtune' | 'numa-tune' | 'emulator-pin' | 'pin-vcpu' | 'block-commit'
  | 'disk-tune' | 'nic-tune' | 'firmware' | 'watchdog' | 'sound' | 'serial' | 'video'

export default function VMDetailsPage() {
  const { name } = useParams<{ name: string }>()
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const [vm, setVM] = useState<VmDetails | null>(null)
  const [metrics, setMetrics] = useState<VmMetrics | null>(null)
  const [metricsHistory, setMetricsHistory] = useState<MetricsPoint[]>([])
  const [snapshots, setSnapshots] = useState<SnapshotInfo[]>([])
  const [guestIps, setGuestIps] = useState<GuestIpAddress[]>([])
  const [guestObs, setGuestObs] = useState<GuestObservability | null>(null)
  const [guestApiHostname, setGuestApiHostname] = useState<string | null>(null)
  const [guestHostnameBusy, setGuestHostnameBusy] = useState(false)
  const [guestHealth, setGuestHealth] = useState<GuestHealthReport | null>(null)
  const [platformDoctor, setPlatformDoctor] = useState<VmDoctorReport | null>(null)
  const [linkedPlatformVm, setLinkedPlatformVm] = useState<PlatformVm | null>(null)
  const [platformHosts, setPlatformHosts] = useState<PlatformHost[]>([])
  const [classicPortForwards, setClassicPortForwards] = useState<VmPortForwardRule[]>([])
  const [classicGuestAccess, setClassicGuestAccess] = useState<GuestAccessHints | null>(null)
  const [classicHypervisorAddress, setClassicHypervisorAddress] = useState<string | undefined>()
  const [networkGateways, setNetworkGateways] = useState<Record<string, string>>({})
  const [guestIfQueriedAt, setGuestIfQueriedAt] = useState<string | null>(null)
  const [sessionRole, setSessionRole] = useState<SessionRole | null>(null)
  const [bootConfig, setBootConfig] = useState<BootConfig | null>(null)
  const [networks, setNetworks] = useState<NetworkInfo[]>([])
  const [hasSave, setHasSave] = useState(false)
  const [vmXml, setVmXml] = useState('')
  const [backingUp, setBackingUp] = useState(false)
  const [tab, setTab] = useState<Tab>('overview')
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [dialog, setDialog] = useState<Dialog>(null)
  const toast = useToastContext()
  const { info } = usePlatformInfo()
  const { phase: osPhase, glanceLive: osGlanceLive } = useOpenStackConnection()
  const openstackPushReady = osPhase === 'live' && osGlanceLive && Boolean(info?.openstack?.upload_enabled)
  const openstackPushDisabledReason =
    osPhase === 'unreachable'
      ? 'OpenStack configured but unreachable'
      : osPhase !== 'live' && info?.openstack?.upload_enabled
        ? 'Wire OpenStack and reach Keystone first'
        : !info?.openstack?.upload_enabled
          ? 'Enable upload_enabled in machina config'
          : null
  const prevMetricsRef = useRef<VmMetrics | null>(null)
  const lastLoadErrorToastAt = useRef(0)

  const conn = useMemo(
    () => searchParams.get('connection') ?? vm?.libvirt_connection ?? undefined,
    [searchParams, vm?.libvirt_connection],
  )

  useEffect(() => {
    if (!vm?.libvirt_connection || vm.libvirt_connection === 'system') return
    if (!searchParams.get('connection'))
      navigate(vmDetailRoute(vm.name, vm.libvirt_connection), { replace: true })
  }, [vm, searchParams, navigate])

  // Dialog form state
  const [cdromPath, setCdromPath] = useState('')
  const [cdromTarget, setCdromTarget] = useState('sda')
  const [cloneName, setCloneName] = useState('')
  const [cloneMode, setCloneMode] = useState<'linked' | 'full' | 'xml'>('linked')
  const [newName, setNewName] = useState('')
  const [migrateUri, setMigrateUri] = useState('')
  const [migrateLive, setMigrateLive] = useState(true)
  const [migrateBandwidth, setMigrateBandwidth] = useState('')
  const [migrateUnsafe, setMigrateUnsafe] = useState(false)
  const [migratePostcopy, setMigratePostcopy] = useState(false)
  const [migrateTunnelled, setMigrateTunnelled] = useState(false)
  const [snapName, setSnapName] = useState('')
  const [snapDesc, setSnapDesc] = useState('')
  const [editVcpus, setEditVcpus] = useState(1)
  const [editMemory, setEditMemory] = useState(1024)
  const [balloonMb, setBalloonMb] = useState(0)
  const [bootDevices, setBootDevices] = useState<string[]>([])
  const [attachSource, setAttachSource] = useState('')
  const [attachTarget, setAttachTarget] = useState('vdb')
  const [attachDriver, setAttachDriver] = useState('qcow2')
  const [attachBus, setAttachBus] = useState('virtio')
  const [attachCache, setAttachCache] = useState('')
  const [attachDiscard, setAttachDiscard] = useState('')
  const [attachReadonly, setAttachReadonly] = useState(false)
  const [attachShareable, setAttachShareable] = useState(false)
  const [cdromBrowseOpen, setCdromBrowseOpen] = useState(false)
  const [attachDiskBrowseOpen, setAttachDiskBrowseOpen] = useState(false)
  const [kubevirtOpen, setKubevirtOpen] = useState(false)
  const [openstackPushOpen, setOpenstackPushOpen] = useState(false)
  const [kubevirtBundle, setKubevirtBundle] = useState<KubeVirtBundle | null>(null)
  const [kubevirtLoading, setKubevirtLoading] = useState(false)
  /** Local checklist only (not sent to the server). */
  const [kubevirtDoneUpload, setKubevirtDoneUpload] = useState(false)
  const [kubevirtDoneApply, setKubevirtDoneApply] = useState(false)
  const [kubevirtDoneStart, setKubevirtDoneStart] = useState(false)
  const [kubevirtExecBusy, setKubevirtExecBusy] = useState<'apply' | 'upload' | 'start' | null>(null)
  const [kubevirtExecLast, setKubevirtExecLast] = useState<KubeVirtClusterExecResult | null>(null)
  const [resizeTarget, setResizeTarget] = useState('')
  const [resizeGb, setResizeGb] = useState(20)
  const [nicNetwork, setNicNetwork] = useState('default')
  const [nicModel, setNicModel] = useState('virtio')
  const [usbDevices, setUsbDevices] = useState<UsbDevice[]>([])
  const [selectedUsb, setSelectedUsb] = useState('')
  const [isoFiles, setIsoFiles] = useState<ImageFile[]>([])
  const [vmTags, setVmTags] = useState<string[]>([])
  const [newTag, setNewTag] = useState('')
  const [pciDevices, setPciDevices] = useState<PciDevice[]>([])
  const [iommuGroups, setIommuGroups] = useState<IommuGroup[]>([])
  const [shareSourceDir, setShareSourceDir] = useState('')
  const [shareMountTag, setShareMountTag] = useState('')
  const [shareXattr, setShareXattr] = useState(true)
  const [sshDialogOpen, setSshDialogOpen] = useState(false)
  const [templateName, setTemplateName] = useState('')
  const [snapDiskOnly, setSnapDiskOnly] = useState(false)
  const [snapStorageMode, setSnapStorageMode] = useState<'auto' | 'external' | 'internal'>('auto')
  const [snapAtomic, setSnapAtomic] = useState(true)
  const [snapReuseExternal, setSnapReuseExternal] = useState(false)
  const [snapExternalDiskDir, setSnapExternalDiskDir] = useState('')
  const [snapExternalMemoryDir, setSnapExternalMemoryDir] = useState('')
  const [snapMemorySnapshot, setSnapMemorySnapshot] = useState<'internal' | 'external' | ''>('')
  const [snapMemoryFile, setSnapMemoryFile] = useState('')
  const [snapDisks, setSnapDisks] = useState<SnapshotDiskSpec[]>([])
  const [logsContent, setLogsContent] = useState('')
  const [logsLines, setLogsLines] = useState(500)
  const [cpuTune, setCpuTune] = useState<CpuTuneInfo | null>(null)
  const [memTune, setMemTune] = useState<MemTuneInfo | null>(null)

  const [deleteUndefine, setDeleteUndefine] = useState<VmDeleteUndefineOpts>({})
  const [deleteVmTypeConfirm, setDeleteVmTypeConfirm] = useState('')
  const [blockDisk, setBlockDisk] = useState('')
  const [blockJob, setBlockJob] = useState<BlockJobInfo | null | undefined>(undefined)
  const [jobStats, setJobStats] = useState<VmJobStats | null>(null)
  const [cpuCompare, setCpuCompare] = useState<CpuCompareResult | null>(null)
  const [blockBase, setBlockBase] = useState('')
  const [blockTop, setBlockTop] = useState('')
  const [blockShallow, setBlockShallow] = useState(true)
  const [blockDelete, setBlockDelete] = useState(true)
  const [blockActive, setBlockActive] = useState(false)
  const [pciBdf, setPciBdf] = useState('')
  const [nodedevName, setNodedevName] = useState('')
  const [schedShares, setSchedShares] = useState('')
  const [schedPeriod, setSchedPeriod] = useState('')
  const [schedQuota, setSchedQuota] = useState('')
  const [memHardKb, setMemHardKb] = useState('')
  const [memSoftKb, setMemSoftKb] = useState('')
  const [memSwapKb, setMemSwapKb] = useState('')
  const [pinVcpuN, setPinVcpuN] = useState(0)
  const [pinMap, setPinMap] = useState<boolean[]>(() => Array.from({ length: 64 }, () => false))
  const [numaNodeSet, setNumaNodeSet] = useState('')
  const [numaModeInput, setNumaModeInput] = useState('')
  const [emuPinMap, setEmuPinMap] = useState<boolean[]>(() => Array.from({ length: 64 }, () => false))

  // Confirmation dialog state for destructive actions
  const [detachDiskTarget, setDetachDiskTarget] = useState<string | null>(null)
  const [detachNicMac, setDetachNicMac] = useState<string | null>(null)
  const [deleteSnapName, setDeleteSnapName] = useState<string | null>(null)

  const [tuneDiskTarget, setTuneDiskTarget] = useState('')
  const [tuneBus, setTuneBus] = useState('')
  const [tuneCache, setTuneCache] = useState('')
  const [tuneDiscard, setTuneDiscard] = useState('')
  const [tuneRo, setTuneRo] = useState('')
  const [tuneShare, setTuneShare] = useState('')
  const [tuneMac, setTuneMac] = useState('')
  const [tuneNicModel, setTuneNicModel] = useState('virtio')
  const [tuneNicNet, setTuneNicNet] = useState('')
  const [fwChoice, setFwChoice] = useState<'bios' | 'uefi'>('uefi')
  const [wdModel, setWdModel] = useState('i6300esb')
  const [wdAction, setWdAction] = useState('reset')
  const [sndModel, setSndModel] = useState('ich6')
  const [serPort, setSerPort] = useState(1)
  const [vidModel, setVidModel] = useState('qxl')

  const snapshotRoots = useMemo(() => snapshotForest(snapshots), [snapshots])

  const canDestroyVm = sessionRole === 'admin'
  const canUsbPci = sessionRole === 'admin' || sessionRole === 'operator'
  const canBrowseHost = sessionRole === 'admin'

  useEffect(() => {
    getSession()
      .then((s) => {
        if (s.authenticated) setSessionRole(s.role ?? 'admin')
        else setSessionRole(null)
      })
      .catch(() => setSessionRole(null))
  }, [])

  const load = useCallback(async () => {
    if (!name) return
    try {
      setLoadError(null)
      const [vmData, snapData] = await Promise.all([getVM(name, conn), listSnapshots(name, conn).catch(() => [])])
      setVM(vmData)
      setSnapshots(snapData)
      addRecentVM(name)
      if (vmData.state === 'running') {
        try { setMetrics(await getVMMetrics(name, conn)) } catch { /* no metrics */ }
        try {
          const gi = await getInterfaces(name, conn)
          setGuestIps(gi.addresses)
          setNetworkGateways(gi.network_gateways ?? {})
          setGuestIfQueriedAt(gi.queried_at)
        } catch {
          /* no addresses */
          setGuestIfQueriedAt(null)
          setNetworkGateways({})
        }
        try {
          setGuestObs(await getGuestObservability(name, conn))
        } catch {
          setGuestObs(null)
        }
        try {
          const hn = await getHostname(name, conn)
          setGuestApiHostname(hn.hostname?.trim() ? hn.hostname : null)
        } catch {
          setGuestApiHostname(null)
        }
        try {
          setGuestHealth(await getGuestHealth(name, conn))
        } catch {
          setGuestHealth(null)
        }
      } else {
        setMetrics(null)
        setGuestIps([])
        setGuestObs(null)
        setGuestHealth(null)
        setGuestApiHostname(null)
        setNetworkGateways({})
        setGuestIfQueriedAt(null)
      }
      try { setBootConfig(await getBootConfig(name, conn)) } catch { /* optional */ }
      try { const s = await hasManagedSave(name, conn); setHasSave(s.has_managed_save) } catch { /* optional */ }
      try { const t = await getVmTags(name); setVmTags(t.tags) } catch { /* optional */ }
      try { setCpuTune(await getCpuTune(name, conn)) } catch { /* optional */ }
      try { setMemTune(await getMemTune(name, conn)) } catch { /* optional */ }
      if (info?.control_plane?.proxy_url) {
        try {
          const [pvmList, hostList] = await Promise.all([listPlatformVms(), listPlatformHosts()])
          const pvm = pvmList.find((v) => v.name === name) ?? null
          setLinkedPlatformVm(pvm)
          setPlatformHosts(hostList)
          setPlatformDoctor(pvm ? await getVmDoctor(pvm.id).catch(() => null) : null)
        } catch {
          setLinkedPlatformVm(null)
          setPlatformHosts([])
          setPlatformDoctor(null)
        }
      } else {
        setLinkedPlatformVm(null)
        setPlatformHosts([])
        setPlatformDoctor(null)
      }
    } catch (e: unknown) {
      const msg = formatUserError(e)
      setLoadError(msg)
      setVM(null)
      const now = Date.now()
      if (now - lastLoadErrorToastAt.current > 12_000) {
        lastLoadErrorToastAt.current = now
        toast.error(`Failed to load VM: ${msg}`)
      }
    } finally {
      setLoading(false)
    }
  }, [name, toast, conn, info?.control_plane?.proxy_url])

  const platformVmId = linkedPlatformVm?.id ?? platformDoctor?.vm_id

  useEffect(() => {
    if (!platformVmId) {
      setClassicPortForwards([])
      setClassicGuestAccess(null)
      setClassicHypervisorAddress(undefined)
      return
    }
    const host = linkedPlatformVm?.host_id
      ? platformHosts.find((h) => h.id === linkedPlatformVm.host_id)
      : undefined
    void getConsoleHubPlan(platformVmId)
      .then((plan) => {
        setClassicGuestAccess(plan.guest_access ?? null)
        setClassicHypervisorAddress(plan.hypervisor_address?.trim() || host?.address?.trim() || undefined)
      })
      .catch(() => {
        setClassicGuestAccess(null)
        setClassicHypervisorAddress(undefined)
      })
  }, [platformVmId, linkedPlatformVm?.host_id, platformHosts])

  useEffect(() => {
    const ip = guestIps[0]?.address?.trim() || vm?.guest_ip?.trim() || ''
    if (!platformVmId || !ip) {
      setClassicPortForwards([])
      return
    }
    void listVmPortForwards(platformVmId).then(setClassicPortForwards).catch(() => setClassicPortForwards([]))
  }, [platformVmId, guestIps, vm?.guest_ip])

  useEffect(() => { load() }, [load])

  // Load network list, USB devices, ISOs for dialogs
  useEffect(() => {
    listNetworks().then(setNetworks).catch((e: unknown) => toast.warning(`Networks: ${formatUserError(e)}`))
    listUsbDevices().then(setUsbDevices).catch((e: unknown) => toast.warning(`USB devices: ${formatUserError(e)}`))
    listIsos().then((r) => setIsoFiles(r.files ?? [])).catch((e: unknown) => toast.warning(`ISO list: ${formatUserError(e)}`))
    listPciDevices().then(setPciDevices).catch((e: unknown) => toast.warning(`PCI devices: ${formatUserError(e)}`))
    listIommuGroups().then(setIommuGroups).catch((e: unknown) => toast.warning(`IOMMU groups: ${formatUserError(e)}`))
  }, [])

  useEffect(() => {
    if (dialog !== 'cdrom') setCdromBrowseOpen(false)
    if (dialog !== 'attach-disk') setAttachDiskBrowseOpen(false)
  }, [dialog])

  // Poll per-VM metrics every 5s for charts
  useEffect(() => {
    if (!name) return
    const poll = async () => {
      try {
        const m = await getVMMetrics(name, conn)
        setMetrics(m)
        const prev = prevMetricsRef.current
        const time = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })
        // Calculate deltas for I/O rates
        const diskRdDelta = prev ? Math.max(0, m.disk_rd_bytes - prev.disk_rd_bytes) : 0
        const diskWrDelta = prev ? Math.max(0, m.disk_wr_bytes - prev.disk_wr_bytes) : 0
        const netRxDelta = prev ? Math.max(0, m.net_rx_bytes - prev.net_rx_bytes) : 0
        const netTxDelta = prev ? Math.max(0, m.net_tx_bytes - prev.net_tx_bytes) : 0
        prevMetricsRef.current = m
        setMetricsHistory(h => [...h.slice(-59), {
          time, memory: parseFloat(m.memory_pct.toFixed(1)),
          diskRd: diskRdDelta, diskWr: diskWrDelta,
          netRx: netRxDelta, netTx: netTxDelta,
        }])
      } catch { /* VM may not be running */ }
    }
    poll()
    const interval = setInterval(poll, 5000)
    return () => clearInterval(interval)
  }, [name, conn])

  // Load XML when tab switches to xml
  useEffect(() => {
    if (tab === 'xml' && name && !vmXml) {
      getVMXml(name, conn).then(setVmXml).catch(() => setVmXml('Failed to load XML'))
    }
  }, [tab, name, vmXml, conn])

  // Load logs when tab switches to logs
  useEffect(() => {
    if (tab === 'logs' && name) {
      getVMLogs(name, logsLines, conn).then((r) => setLogsContent(r.content)).catch(() => setLogsContent('Failed to load logs'))
    }
  }, [tab, name, logsLines, conn])

  useEffect(() => {
    if (dialog === 'numa-tune' && name) {
      void getNumaTune(name, conn)
        .then((n) => {
          setNumaNodeSet(n.node_set ?? '')
          setNumaModeInput(n.mode != null ? String(n.mode) : '')
        })
        .catch(() => {
          setNumaNodeSet('')
          setNumaModeInput('')
        })
    }
  }, [dialog, name, conn])

  useEffect(() => {
    if (tab === 'advanced' && vm?.disks?.length && !blockDisk) {
      const t = vm.disks.find((d) => d.device === 'disk')?.target
      if (t) setBlockDisk(t)
    }
  }, [tab, vm, blockDisk])

  const action = async (fn: (n: string, c?: string | null) => Promise<void>, label: string) => {
    if (!name) return
    try { await fn(name, conn); toast.success(`${label} OK`); load() } catch (e: unknown) { toast.error(`${label} failed: ${formatUserError(e)}`) }
  }

  const openDialog = (d: Dialog) => {
    if (d === 'delete-vm' && !canDestroyVm) {
      toast.error('Destroying guests requires the admin role')
      return
    }
    if (vm) {
      if (d === 'vcpus') setEditVcpus(vm.vcpus)
      if (d === 'memory') setEditMemory(vm.memory_mb)
      if (d === 'balloon') setBalloonMb(vm.memory_mb)
      if (d === 'boot-order') setBootDevices(bootConfig?.boot_devices || [])
      if (d === 'clone') setCloneName(`${vm.name}-clone`)
      if (d === 'rename') setNewName(vm.name)
      if (d === 'save-template') setTemplateName(`${vm.name}-template`)
      if (d === 'snapshot') {
        setSnapDiskOnly(false)
        setSnapStorageMode('auto')
        setSnapAtomic(true)
        setSnapReuseExternal(false)
        setSnapExternalDiskDir('')
        setSnapExternalMemoryDir('')
        setSnapMemorySnapshot('')
        setSnapMemoryFile('')
        setSnapDisks(
          (vm.disks || [])
            .filter((x) => x.device === 'disk')
            .map((x) => ({ name: x.target, snapshot: 'external', file: '', driver: 'qcow2' })),
        )
      }
      if (d === 'scheduler-tune') {
        setSchedShares(cpuTune?.shares != null ? String(cpuTune.shares) : '')
        setSchedPeriod(cpuTune?.period != null ? String(cpuTune.period) : '')
        setSchedQuota(cpuTune?.quota != null ? String(cpuTune.quota) : '')
      }
      if (d === 'memtune') {
        setMemHardKb(memTune?.hard_limit_kb != null ? String(memTune.hard_limit_kb) : '')
        setMemSoftKb(memTune?.soft_limit_kb != null ? String(memTune.soft_limit_kb) : '')
        setMemSwapKb(memTune?.swap_hard_limit_kb != null ? String(memTune.swap_hard_limit_kb) : '')
      }
      if (d === 'pin-vcpu') {
        setPinVcpuN(0)
        setPinMap(Array.from({ length: 64 }, () => false))
      }
      if (d === 'emulator-pin') {
        setEmuPinMap(Array.from({ length: 64 }, () => false))
      }
      if (d === 'delete-vm') {
        setDeleteUndefine({})
        setDeleteVmTypeConfirm('')
      }
      if (d === 'block-commit') {
        const first = vm.disks.find((x) => x.device === 'disk')?.target || ''
        setBlockDisk((prev) => prev || first)
        setBlockBase('')
        setBlockTop('')
      }
    }
    setDialog(d)
  }

  const runKubevirtClusterStep = async (kind: 'apply' | 'upload' | 'start') => {
    if (!name) return
    setKubevirtExecBusy(kind)
    setKubevirtExecLast(null)
    try {
      const fn =
        kind === 'apply'
          ? postKubeVirtApply
          : kind === 'upload'
            ? postKubeVirtUpload
            : postKubeVirtStart
      const r = await fn(name, { connection: conn })
      setKubevirtExecLast(r)
      if (r.exit_code !== 0) {
        const hint = r.stderr?.trim() || r.stdout?.trim() || ''
        toast.error(`${kind}: exit ${r.exit_code}${hint ? ` — ${hint.slice(0, 200)}` : ''}`)
      } else {
        toast.success(`${kind === 'apply' ? 'kubectl apply' : kind === 'upload' ? 'virtctl image-upload' : 'virtctl start'} finished (exit 0)`)
      }
    } catch (e: unknown) {
      toast.error(`${kind}: ${formatUserError(e)}`)
    } finally {
      setKubevirtExecBusy(null)
    }
  }

  const loadKubevirtExport = async () => {
    if (!name) return
    setKubevirtLoading(true)
    setKubevirtBundle(null)
    setKubevirtDoneUpload(false)
    setKubevirtDoneApply(false)
    setKubevirtDoneStart(false)
    setKubevirtExecLast(null)
    try {
      const b = await getKubeVirtBundle(name, { connection: conn })
      setKubevirtBundle(b)
      setKubevirtOpen(true)
    } catch (e: unknown) {
      toast.error(`KubeVirt bundle: ${formatUserError(e)}`)
    } finally {
      setKubevirtLoading(false)
    }
  }

  // ── Dialog handlers ──────────────────────────────────────────────

  const handleClone = async () => {
    if (!name || !cloneName.trim()) return
    try { await cloneVM(name, cloneName.trim(), conn, cloneMode); toast.success(`Cloned to '${cloneName}' (${cloneMode})`); setDialog(null); load() } catch (e: unknown) { toast.error(`Clone failed: ${formatUserError(e)}`) }
  }

  const handleRename = async () => {
    if (!name || !newName.trim() || newName === name) return
    try {
      await renameVM(name, newName.trim(), conn)
      toast.success(`Renamed to '${newName}'`)
      setDialog(null)
      navigate(vmDetailRoute(newName.trim(), conn))
    } catch (e: unknown) { toast.error(`Rename failed: ${formatUserError(e)}`) }
  }

  const handleMigrate = async () => {
    if (!name || !migrateUri.trim()) return
    toast.info('Starting migration...')
    try {
      const bw = migrateBandwidth.trim() === '' ? NaN : parseInt(migrateBandwidth, 10)
      await migrateVM(name, migrateUri.trim(), migrateLive, {
        unsafe_migrate: migrateUnsafe,
        postcopy: migratePostcopy,
        tunnelled: migrateTunnelled,
        parameters: !Number.isNaN(bw) && bw > 0 ? { bandwidth: bw } : undefined,
      }, conn)
      toast.success('Migration completed')
      setDialog(null)
    } catch (e: unknown) {
      toast.error(`Migration failed: ${formatUserError(e)}`)
    }
  }

  const handleSetVcpus = async () => {
    if (!name) return
    try {
      if (vm?.state === 'running') {
        await liveSetVcpus(name, editVcpus)
        toast.success(`vCPUs live-set to ${editVcpus}`)
      } else {
        await setVcpus(name, editVcpus, conn)
        toast.success(`vCPUs set to ${editVcpus} (effective on next boot)`)
      }
      setDialog(null); load()
    } catch (e: unknown) { toast.error(`Failed: ${formatUserError(e)}`) }
  }

  const handleSetMemory = async () => {
    if (!name) return
    try {
      if (vm?.state === 'running') {
        await liveSetMemory(name, editMemory)
        toast.success(`Memory live-set to ${editMemory} MB`)
      } else {
        await setMemory(name, editMemory, conn)
        toast.success(`Memory set to ${editMemory} MB (effective on next boot)`)
      }
      setDialog(null); load()
    } catch (e: unknown) { toast.error(`Failed: ${formatUserError(e)}`) }
  }

  const handleBalloon = async () => {
    if (!name) return
    try { await setMemoryBalloon(name, balloonMb, conn); toast.success(`Memory ballooned to ${balloonMb} MB`); setDialog(null); load() } catch (e: unknown) { toast.error(`Failed: ${formatUserError(e)}`) }
  }

  const handleSetBootOrder = async () => {
    if (!name) return
    try { await setBootOrder(name, bootDevices, conn); toast.success('Boot order updated'); setDialog(null); load(); setVmXml('') } catch (e: unknown) { toast.error(`Failed: ${formatUserError(e)}`) }
  }

  const handleInsertCdrom = async () => {
    if (!name || !cdromPath) return
    try { await insertCdrom(name, cdromPath, cdromTarget, conn); toast.success('CD-ROM inserted'); setDialog(null); setCdromPath(''); load(); setVmXml('') } catch (e: unknown) { toast.error(`Insert failed: ${formatUserError(e)}`) }
  }

  const handleCreateSnapshot = async () => {
    if (!name || !snapName.trim()) return
    try {
      await createSnapshot(name, {
        name: snapName.trim(),
        description: snapDesc,
        disk_only: snapDiskOnly,
        storage_mode: snapStorageMode,
        memory_snapshot: snapMemorySnapshot || undefined,
        memory_file: snapMemoryFile.trim() || undefined,
        external_disk_dir: snapExternalDiskDir.trim() || undefined,
        external_memory_dir: snapExternalMemoryDir.trim() || undefined,
        disks: snapDisks,
        atomic: snapAtomic,
        reuse_external: snapReuseExternal,
      }, conn)
      toast.success(`Snapshot '${snapName}' created`)
      setDialog(null)
      setSnapName('')
      setSnapDesc('')
      setSnapDiskOnly(false)
      load()
    } catch (e: unknown) {
      toast.error(`Snapshot failed: ${formatUserError(e)}`)
    }
  }

  const handleDeleteSnapshot = async (snapN: string) => {
    if (!name) return
    try { await deleteSnapshot(name, snapN, conn); toast.success(`Snapshot '${snapN}' deleted`); load() } catch (e: unknown) { toast.error(`Delete failed: ${formatUserError(e)}`) }
  }

  const handleRevertSnapshot = async (snapN: string) => {
    if (!name) return
    try { await revertSnapshot(name, snapN, conn); toast.success(`Reverted to '${snapN}'`); load() } catch (e: unknown) { toast.error(`Revert failed: ${formatUserError(e)}`) }
  }

  const handleAttachDisk = async () => {
    if (!name || !attachSource.trim()) return
    try {
      const { apiPostVoid } = await import('../api/client')
      const body: Record<string, unknown> = {
        source: attachSource.trim(),
        target: attachTarget,
        driver: attachDriver,
        bus: attachBus,
      }
      if (attachCache.trim()) body.cache = attachCache.trim()
      if (attachDiscard.trim()) body.discard = attachDiscard.trim()
      if (attachReadonly) body.readonly = true
      if (attachShareable) body.shareable = true
      await apiPostVoid(appendVmConnection(`/api/v1/vms/${encodeURIComponent(name)}/disk/attach`, conn), body)
      toast.success('Disk attached'); setDialog(null); setAttachSource(''); load(); setVmXml('')
    } catch (e: unknown) { toast.error(`Attach failed: ${formatUserError(e)}`) }
  }

  const handleDiskTune = async () => {
    if (!name || !tuneDiskTarget) return
    try {
      const body: {
        target: string
        bus?: string
        cache?: string
        discard?: string
        readonly?: boolean
        shareable?: boolean
      } = { target: tuneDiskTarget }
      if (tuneBus.trim()) body.bus = tuneBus.trim()
      if (tuneCache.trim()) body.cache = tuneCache.trim()
      if (tuneDiscard.trim()) body.discard = tuneDiscard.trim()
      if (tuneRo === 'true') body.readonly = true
      if (tuneRo === 'false') body.readonly = false
      if (tuneShare === 'true') body.shareable = true
      if (tuneShare === 'false') body.shareable = false
      await tuneVmDisk(name, body, conn)
      toast.success('Disk updated')
      setDialog(null)
      load()
      setVmXml('')
    } catch (e: unknown) {
      toast.error(`Disk tune failed: ${formatUserError(e)}`)
    }
  }

  const handleNicTune = async () => {
    if (!name || !tuneMac.trim()) return
    try {
      await tuneVmNic(name, {
        mac_address: tuneMac.trim(),
        ...(tuneNicModel.trim() ? { model: tuneNicModel.trim() } : {}),
        ...(tuneNicNet.trim() ? { network: tuneNicNet.trim() } : {}),
      }, conn)
      toast.success('NIC updated')
      setDialog(null)
      load()
      setVmXml('')
    } catch (e: unknown) {
      toast.error(`NIC tune failed: ${formatUserError(e)}`)
    }
  }

  const handleFirmwareSet = async () => {
    if (!name) return
    try {
      await setVmFirmware(name, fwChoice === 'uefi', conn)
      toast.success(`Firmware set to ${fwChoice.toUpperCase()} (may require reboot / guest support)`)
      setDialog(null)
      load()
      setVmXml('')
    } catch (e: unknown) {
      toast.error(`Firmware: ${formatUserError(e)}`)
    }
  }

  const handleWatchdogAttach = async () => {
    if (!name) return
    try {
      await attachVmWatchdog(name, wdModel, wdAction, conn)
      toast.success('Watchdog attached')
      setDialog(null)
      load()
      setVmXml('')
    } catch (e: unknown) {
      toast.error(`${formatUserError(e)}`)
    }
  }

  const handleSoundAttach = async () => {
    if (!name) return
    try {
      await attachVmSound(name, sndModel, conn)
      toast.success('Sound card attached')
      setDialog(null)
      load()
      setVmXml('')
    } catch (e: unknown) {
      toast.error(`${formatUserError(e)}`)
    }
  }

  const handleSerialAttach = async () => {
    if (!name) return
    try {
      await attachVmSerial(name, serPort, conn)
      toast.success(`Serial port ${serPort} attached`)
      setDialog(null)
      load()
      setVmXml('')
    } catch (e: unknown) {
      toast.error(`${formatUserError(e)}`)
    }
  }

  const handleVideoSet = async () => {
    if (!name) return
    try {
      await setVmVideoModel(name, vidModel, conn)
      toast.success('Video model updated')
      setDialog(null)
      load()
      setVmXml('')
    } catch (e: unknown) {
      toast.error(`${formatUserError(e)}`)
    }
  }

  const handleDetachDisk = async (targetDev: string) => {
    if (!name) return
    try {
      const { apiPostVoid } = await import('../api/client')
      await apiPostVoid(appendVmConnection(`/api/v1/vms/${encodeURIComponent(name)}/disk/detach/${encodeURIComponent(targetDev)}`, conn))
      toast.success(`Disk '${targetDev}' detached`); load(); setVmXml('')
    } catch (e: unknown) { toast.error(`Detach failed: ${formatUserError(e)}`) }
  }

  const handleResizeDisk = async () => {
    if (!name || !resizeTarget) return
    try { await resizeDisk(name, resizeTarget, resizeGb, conn); toast.success(`Disk '${resizeTarget}' resized to ${resizeGb} GB`); setDialog(null); load() } catch (e: unknown) { toast.error(`Resize failed: ${formatUserError(e)}`) }
  }

  const handleAttachNic = async () => {
    if (!name || !nicNetwork.trim()) return
    try { await attachInterface(name, nicNetwork.trim(), nicModel, conn); toast.success(`NIC attached to '${nicNetwork}'`); setDialog(null); load(); setVmXml('') } catch (e: unknown) { toast.error(`Attach failed: ${formatUserError(e)}`) }
  }

  const handleAttachUsb = async (vendorId?: string, productId?: string) => {
    if (!name || !canUsbPci) return
    const vid = vendorId ?? selectedUsb.split(':')[0]
    const pid = productId ?? selectedUsb.split(':')[1]
    if (!vid || !pid) return
    try { await attachUsb(name, vid, pid); toast.success('USB device attached'); setDialog(null); load(); setVmXml('') } catch (e: unknown) { toast.error(`Failed: ${formatUserError(e)}`) }
  }

  const handleDetachUsb = async (vid: string, pid: string) => {
    if (!name || !canUsbPci) return
    try { await detachUsb(name, vid, pid); toast.success('USB device detached'); load(); setVmXml('') } catch (e: unknown) { toast.error(`Failed: ${formatUserError(e)}`) }
  }

  const handleDetachNic = async (mac: string) => {
    if (!name) return
    try { await detachInterface(name, mac, conn); toast.success(`NIC '${mac}' detached`); load(); setVmXml('') } catch (e: unknown) { toast.error(`Detach failed: ${formatUserError(e)}`) }
  }

  const handleSaveTemplate = async () => {
    if (!name || !templateName.trim()) return
    try {
      await saveVmAsTemplate(name, templateName.trim())
      toast.success(`Saved as template '${templateName.trim()}'`)
      setDialog(null)
    } catch (e: unknown) {
      toast.error(`Save template failed: ${formatUserError(e)}`)
    }
  }

  const handleDeleteVm = async () => {
    if (!name) return
    let nvramRetried = false
    try {
      await deleteVmWithNvramRetry(name, deleteUndefine, (merged) => {
        nvramRetried = true
        setDeleteUndefine(merged)
        toast.info('Retrying delete with UEFI NVRAM removal (same as virsh undefine --nvram)…')
      }, conn)
      purgeVmShortcuts([name])
      toast.success(
        nvramRetried
          ? 'VM deleted (UEFI NVRAM removed as required by libvirt)'
          : 'VM deleted',
      )
      setDialog(null)
      navigate('/vms')
    } catch (e: unknown) {
      toast.error(`Delete failed: ${formatUserError(e)}`)
    }
  }

  const handleSchedulerSave = async () => {
    if (!name) return
    try {
      const body: { cpu_shares?: number; vcpu_period?: number; vcpu_quota?: number } = {}
      if (schedShares.trim() !== '') body.cpu_shares = parseInt(schedShares, 10)
      if (schedPeriod.trim() !== '') body.vcpu_period = parseInt(schedPeriod, 10)
      if (schedQuota.trim() !== '') body.vcpu_quota = parseInt(schedQuota, 10)
      if (Object.keys(body).length === 0) {
        toast.warning('Enter at least one value')
        return
      }
      await setSchedulerTune(name, body, conn)
      toast.success('Scheduler updated')
      setDialog(null)
      load()
    } catch (e: unknown) {
      toast.error(`${formatUserError(e)}`)
    }
  }

  const handleMemtuneSave = async () => {
    if (!name) return
    try {
      const body: MemTuneInfo = {}
      if (memHardKb.trim() !== '') body.hard_limit_kb = parseInt(memHardKb, 10)
      if (memSoftKb.trim() !== '') body.soft_limit_kb = parseInt(memSoftKb, 10)
      if (memSwapKb.trim() !== '') body.swap_hard_limit_kb = parseInt(memSwapKb, 10)
      if (Object.keys(body).length === 0) {
        toast.warning('Enter at least one limit (KiB)')
        return
      }
      await applyMemTuneApi(name, body, conn)
      toast.success('Memory tuning updated')
      setDialog(null)
      load()
    } catch (e: unknown) {
      toast.error(`${formatUserError(e)}`)
    }
  }

  const handleNumaSave = async () => {
    if (!name) return
    const ns = numaNodeSet.trim()
    const ms = numaModeInput.trim()
    if (ns === '' && ms === '') {
      toast.warning('Enter node_set and/or mode to apply')
      return
    }
    let mode: number | null = null
    if (ms !== '') {
      const m = parseInt(ms, 10)
      if (Number.isNaN(m)) {
        toast.warning('Mode must be a libvirt mem mode integer')
        return
      }
      mode = m
    }
    try {
      await setNumaTune(name, {
        node_set: ns === '' ? null : ns,
        mode,
      }, conn)
      toast.success('NUMA tuning updated')
      setDialog(null)
      load()
    } catch (e: unknown) {
      toast.error(`${formatUserError(e)}`)
    }
  }

  const handleEmulatorPinSave = async () => {
    if (!name) return
    try {
      await pinEmulator(name, emuPinMap, conn)
      toast.success('Emulator threads pinned')
      setDialog(null)
      load()
    } catch (e: unknown) {
      toast.error(`${formatUserError(e)}`)
    }
  }

  const handlePinSave = async () => {
    if (!name) return
    try {
      await pinVcpu(name, pinVcpuN, pinMap, conn)
      toast.success(`vCPU ${pinVcpuN} pinning updated`)
      setDialog(null)
      load()
    } catch (e: unknown) {
      toast.error(`${formatUserError(e)}`)
    }
  }

  const handleBlockJobRefresh = async () => {
    if (!name || !blockDisk.trim()) {
      toast.warning('Select a disk target (e.g. vda)')
      return
    }
    try {
      const r = await getBlockJobInfo(name, blockDisk.trim(), true, conn)
      setBlockJob(r.job ?? null)
      toast.success(r.job ? 'Active block job' : 'No block job on this disk')
    } catch (e: unknown) {
      toast.error(`${formatUserError(e)}`)
    }
  }

  const handleBlockCommit = async () => {
    if (!name || !blockDisk.trim()) return
    try {
      await blockCommit(name, {
        disk: blockDisk.trim(),
        base: blockBase.trim() || null,
        top: blockTop.trim() || null,
        bandwidth: 0,
        shallow: blockShallow,
        delete: blockDelete,
        active: blockActive,
        relative: false,
        bandwidth_bytes: true,
      }, conn)
      toast.success('Block commit started')
      setDialog(null)
    } catch (e: unknown) {
      toast.error(`${formatUserError(e)}`)
    }
  }

  const handleBlockPull = async () => {
    if (!name || !blockDisk.trim()) return
    try {
      await blockPull(name, { disk: blockDisk.trim(), bandwidth: 0, bandwidth_bytes: true }, conn)
      toast.success('Block pull started')
    } catch (e: unknown) {
      toast.error(`${formatUserError(e)}`)
    }
  }

  const handleBlockAbort = async (asyncAbort: boolean, pivot: boolean) => {
    if (!name || !blockDisk.trim()) return
    try {
      await blockJobAbort(name, { disk: blockDisk.trim(), async: asyncAbort, pivot }, conn)
      toast.success('Block job abort requested')
      setBlockJob(undefined)
    } catch (e: unknown) {
      toast.error(`${formatUserError(e)}`)
    }
  }

  const downloadXml = () => {
    if (!vmXml || !vm) return
    const blob = new Blob([vmXml], { type: 'text/xml' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `${vm.name}.xml`
    a.click()
    URL.revokeObjectURL(url)
    toast.success('XML downloaded')
  }

  const confirmDetachDisk = async () => {
    if (detachDiskTarget) { await handleDetachDisk(detachDiskTarget); setDetachDiskTarget(null) }
  }

  const confirmDetachNic = async () => {
    if (detachNicMac) { await handleDetachNic(detachNicMac); setDetachNicMac(null) }
  }

  const confirmDeleteSnapshot = async () => {
    if (deleteSnapName) { await handleDeleteSnapshot(deleteSnapName); setDeleteSnapName(null) }
  }

  const toggleAutostart = async () => {
    if (!name || !vm) return
    try { await setAutostart(name, !vm.autostart, conn); toast.success(`Autostart ${!vm.autostart ? 'enabled' : 'disabled'}`); load() } catch (e: unknown) { toast.error(`${formatUserError(e)}`) }
  }

  const openVmSshDialog = useCallback(() => {
    if (!name) return
    setSshDialogOpen(true)
  }, [name])

  const classicGuestIp = guestIps[0]?.address?.trim() || vm?.guest_ip?.trim() || ''
  const classicSshUser = loadVmSshPrefs(name ?? '')?.user?.trim() || 'root'
  const classicDetectedIps = guestIps.map((g) => g.address).filter(Boolean)
  const classicNatHref = classicGuestIp
    ? `/host-networking?tab=portforward&vm_ip=${encodeURIComponent(classicGuestIp)}&vm_port=22`
    : undefined

  const moveBootDevice = (index: number, dir: -1 | 1) => {
    const newDevices = [...bootDevices]
    const target = index + dir
    if (target < 0 || target >= newDevices.length) return
    ;[newDevices[index], newDevices[target]] = [newDevices[target], newDevices[index]]
    setBootDevices(newDevices)
  }

  if (loading) return <PageSkeleton />
  if (!vm) {
    return (
      <PageLayout
        error={loadError}
        errorTitle="Could not load VM"
        errorHints={loadError ? libvirtErrorHints(loadError) : undefined}
        onErrorRetry={load}
        emptyState={
          !loadError ? (
            <div className="space-y-4">
              <div className="text-center text-slate-500 py-12">VM not found</div>
              <Link to="/vms" className={`inline-flex items-center gap-2 text-sm ${statusActionLinkClasses('info')}`}>
                <ArrowLeft className="w-4 h-4" /> Back to VMs
              </Link>
            </div>
          ) : undefined
        }
      >
        {loadError ? (
          <Link to="/vms" className={`inline-flex items-center gap-2 text-sm ${statusActionLinkClasses('info')}`}>
            <ArrowLeft className="w-4 h-4" /> Back to VMs
          </Link>
        ) : null}
      </PageLayout>
    )
  }

  const tabs: { key: Tab; label: string; icon: React.ReactNode }[] = [
    { key: 'overview', label: 'Overview', icon: <Cpu className="w-4 h-4" /> },
    { key: 'disks', label: `Disks (${vm.disks.length})`, icon: <HardDrive className="w-4 h-4" /> },
    { key: 'network', label: `Network (${vm.interfaces.length})`, icon: <Network className="w-4 h-4" /> },
    { key: 'snapshots', label: `Snapshots (${snapshots.length})`, icon: <Camera className="w-4 h-4" /> },
    { key: 'devices', label: 'Devices', icon: <Monitor className="w-4 h-4" /> },
    { key: 'xml', label: 'XML', icon: <Code className="w-4 h-4" /> },
    { key: 'logs', label: 'Logs', icon: <Terminal className="w-4 h-4" /> },
    { key: 'advanced', label: 'Advanced', icon: <Sliders className="w-4 h-4" /> },
  ]

  return (
    <PageLayout hideHeader title={vm.name}>
      {/* Header + lifecycle actions (sticky while scrolling) */}
      <div className="classic-detail-chrome-sticky -mx-1 px-1 py-2 bg-slate-950/90 backdrop-blur-md border-b border-slate-800/80 space-y-3">
      <div className="flex items-center gap-4">
        <Link to="/vms" className="p-2 hover:bg-slate-700 rounded-lg transition" aria-label="Back to VM list"><ArrowLeft className="w-5 h-5" /></Link>
        <div className="flex-1">
          <h1 className="text-2xl font-bold">{vm.name}</h1>
          <div className="flex items-center gap-3 mt-1">
            <span className={`px-2 py-0.5 rounded text-xs font-medium ${getStateBadgeClasses(vm.state)}`}>{vm.state}</span>
            {vm.libvirt_connection === 'session' && (
              <span className={sessionBadgeClasses('text-xs')} title="Domain on qemu:///session">
                session
              </span>
            )}
            <span className="text-sm text-slate-500 font-mono">{vm.uuid}</span>
            {vm.guest_ip && (
              <span className={`text-sm font-mono ${statusToneClass('ok')} opacity-90`} title="From libvirt lease / ARP / guest agent">
                · {vm.guest_ip}
              </span>
            )}
          </div>
          <div className="flex items-center gap-1.5 mt-1.5 flex-wrap">
            {vmTags.map((t) => (
              <span key={t} className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium ${statusBadgeClasses('info')}`}>
                <Tag className="w-3 h-3" />{t}
                <button onClick={async () => { const next = vmTags.filter(x => x !== t); try { await apiSetVmTags(vm.name, next); setVmTags(next) } catch (e: unknown) { toast.error(formatUserError(e)) } }} className={`ml-0.5 opacity-70 hover:opacity-100 ${statusToneClass('error')}`} aria-label={`Remove tag ${t}`}><X className="w-3 h-3" /></button>
              </span>
            ))}
            <form className="inline-flex items-center gap-1" onSubmit={async (e) => { e.preventDefault(); const tag = newTag.trim(); if (!tag || vmTags.includes(tag)) return; const next = [...vmTags, tag]; try { await apiSetVmTags(vm.name, next); setVmTags(next); setNewTag('') } catch (e: unknown) { toast.error(formatUserError(e)) } }}>
              <input type="text" aria-label="Add tag" value={newTag} onChange={(e) => setNewTag(e.target.value)} placeholder="+ tag" className="w-16 px-1.5 py-0.5 bg-slate-800 border border-slate-700 rounded text-xs focus:outline-none focus:border-blue-500 text-slate-300" />
            </form>
          </div>
        </div>
        <div className="flex items-center gap-2 flex-wrap justify-end">
          <Link to={vmConsoleRoute(vm.name, conn)} className="px-3 py-1.5 bg-slate-700 hover:bg-slate-600 rounded-lg text-sm transition flex items-center gap-1"><Terminal className="w-4 h-4" /> Console</Link>
          <GuacamoleConsoleLink vmName={vm.name} connection={conn} />
          <RdpConsoleLink vmName={vm.name} connection={conn} />
          <ClassicVmSpiceToVncButton
            vmName={vm.name}
            connection={conn}
            platformVmId={platformVmId}
            usePlatformApi={Boolean(platformVmId && linkedPlatformVm && linkedPlatformVm.inventory_source !== 'kubevirt')}
            onSuccess={() => {
              toast.success('SPICE→VNC completed — check Console / XML')
              load()
              setVmXml('')
            }}
            onError={(msg) => toast.error(msg)}
          />
          <button type="button" onClick={openVmSshDialog} className="px-3 py-1.5 bg-slate-700 hover:bg-slate-600 rounded-lg text-sm transition flex items-center gap-1">
            <Terminal className="w-4 h-4" /> SSH
          </button>
          {vm.state === 'shutoff' && <button onClick={() => action(startVM, 'Start')} className="px-3 py-1.5 bg-green-600 hover:bg-green-700 rounded-lg text-sm transition flex items-center gap-1"><Play className="w-4 h-4" /> Start</button>}
          {vm.state === 'running' && (
            <>
              <button onClick={() => action(shutdownVM, 'Shutdown')} className="px-3 py-1.5 bg-yellow-600 hover:bg-yellow-700 rounded-lg text-sm transition flex items-center gap-1"><Power className="w-4 h-4" /> Shutdown</button>
              <button onClick={() => action(rebootVM, 'Reboot')} className="px-3 py-1.5 bg-blue-600 hover:bg-blue-700 rounded-lg text-sm transition flex items-center gap-1"><RotateCcw className="w-4 h-4" /> Reboot</button>
              <button onClick={() => action(stopVM, 'Force Stop')} className="px-3 py-1.5 bg-red-600 hover:bg-red-700 rounded-lg text-sm transition flex items-center gap-1"><Square className="w-4 h-4" /> Stop</button>
              <button onClick={() => action(pauseVM, 'Pause')} className="px-3 py-1.5 bg-slate-600 hover:bg-slate-500 rounded-lg text-sm transition flex items-center gap-1"><Pause className="w-4 h-4" /> Pause</button>
              <button onClick={() => action(managedSave, 'Managed Save')} className="px-3 py-1.5 bg-purple-600 hover:bg-purple-700 rounded-lg text-sm transition flex items-center gap-1"><Save className="w-4 h-4" /> Save</button>
            </>
          )}
          {vm.state === 'paused' && <button onClick={() => action(resumeVM, 'Resume')} className="px-3 py-1.5 bg-green-600 hover:bg-green-700 rounded-lg text-sm transition flex items-center gap-1"><RefreshCw className="w-4 h-4" /> Resume</button>}
          {hasSave && <button onClick={() => action(managedSaveRemove, 'Remove Save')} className="px-3 py-1.5 bg-orange-600 hover:bg-orange-700 rounded-lg text-sm transition flex items-center gap-1"><Save className="w-4 h-4" /> Remove Save</button>}
        </div>
      </div>
      </div>

      {/* Settings Bar */}
      <div className="flex items-center gap-2 flex-wrap">
        <span className="text-xs text-slate-500 mr-1"><Settings className="w-3.5 h-3.5 inline -mt-0.5" /> Settings:</span>
        <button onClick={() => openDialog('vcpus')} className="px-2.5 py-1 bg-slate-800 hover:bg-slate-700 border border-slate-700 rounded text-xs transition"><Cpu className="w-3 h-3 inline -mt-0.5" /> vCPUs</button>
        <button onClick={() => openDialog('memory')} className="px-2.5 py-1 bg-slate-800 hover:bg-slate-700 border border-slate-700 rounded text-xs transition"><MemoryStick className="w-3 h-3 inline -mt-0.5" /> Memory</button>
        {vm.state === 'running' && <button onClick={() => openDialog('balloon')} className="px-2.5 py-1 bg-slate-800 hover:bg-slate-700 border border-slate-700 rounded text-xs transition"><MemoryStick className="w-3 h-3 inline -mt-0.5" /> Balloon</button>}
        <button onClick={() => openDialog('boot-order')} className="px-2.5 py-1 bg-slate-800 hover:bg-slate-700 border border-slate-700 rounded text-xs transition"><Settings className="w-3 h-3 inline -mt-0.5" /> Boot Order</button>
        <button onClick={() => openDialog('cdrom')} className="px-2.5 py-1 bg-slate-800 hover:bg-slate-700 border border-slate-700 rounded text-xs transition"><Disc className="w-3 h-3 inline -mt-0.5" /> CD-ROM</button>
        <button onClick={() => openDialog('clone')} className="px-2.5 py-1 bg-slate-800 hover:bg-slate-700 border border-slate-700 rounded text-xs transition"><Copy className="w-3 h-3 inline -mt-0.5" /> Clone</button>
        {vm.state === 'shutoff' && <button onClick={() => openDialog('rename')} className="px-2.5 py-1 bg-slate-800 hover:bg-slate-700 border border-slate-700 rounded text-xs transition"><Pencil className="w-3 h-3 inline -mt-0.5" /> Rename</button>}
        <button onClick={() => openDialog('migrate')} className="px-2.5 py-1 bg-slate-800 hover:bg-slate-700 border border-slate-700 rounded text-xs transition"><ArrowRightLeft className="w-3 h-3 inline -mt-0.5" /> Migrate</button>
        <button disabled={backingUp} onClick={async () => { if (backingUp) return; setBackingUp(true); toast.info('Backup started in background'); try { await triggerBackup({ vm_name: vm.name }); toast.success(`Backup triggered successfully for '${vm.name}'`) } catch (e: unknown) { toast.error(`${formatUserError(e)}`) } finally { setBackingUp(false) } }} className="px-2.5 py-1 bg-slate-800 hover:bg-slate-700 border border-slate-700 rounded text-xs transition disabled:opacity-50"><Archive className="w-3 h-3 inline -mt-0.5" /> {backingUp ? '...' : 'Backup'}</button>
        <button onClick={() => openDialog('save-template')} className="px-2.5 py-1 bg-slate-800 hover:bg-slate-700 border border-slate-700 rounded text-xs transition"><Layers className="w-3 h-3 inline -mt-0.5" /> Save Template</button>
        <button type="button" onClick={() => setTab('advanced')} className="px-2.5 py-1 bg-slate-800 hover:bg-slate-700 border border-slate-700 rounded text-xs transition"><Sliders className="w-3 h-3 inline -mt-0.5" /> Advanced</button>
        <button onClick={load} className="px-2.5 py-1 bg-slate-800 hover:bg-slate-700 border border-slate-700 rounded text-xs transition" aria-label="Refresh"><RefreshCw className="w-3 h-3" /></button>
      </div>

      <VmDailyAccessStrip
        vmName={vm.name}
        vmState={vm.state}
        sshUser={classicSshUser}
        guestIp={classicGuestIp}
        detectedIps={classicDetectedIps}
        guestIpWaiting={vm.state === 'running' && !classicGuestIp}
        onRefreshGuestIp={() => {
          if (!name) return
          void getGuestHealth(name, conn).then(setGuestHealth).catch(() => setGuestHealth(null))
          void load()
        }}
        consoleHref={vmConsoleRoute(vm.name, conn)}
        onExportXml={async () => {
          if (vmXml) return vmXml
          return getVMXml(name!, conn)
        }}
        natForwardHref={classicNatHref}
        platformVmId={platformVmId}
        hypervisorAddress={classicHypervisorAddress}
        guestAccess={classicGuestAccess}
        portForwardRules={classicPortForwards}
        onRefreshPortForwards={() => {
          if (!platformVmId) return
          void listVmPortForwards(platformVmId).then(setClassicPortForwards).catch(() => setClassicPortForwards([]))
          void getConsoleHubPlan(platformVmId).then((plan) => setClassicGuestAccess(plan.guest_access ?? null)).catch(() => undefined)
        }}
        onNotify={(m) => toast.success(m)}
      />

      {/* Tabs — card picker */}
      <div>
        <h2 className="text-sm font-semibold text-slate-400 uppercase tracking-wide mb-2">VM details</h2>
        <ChoiceCardDenseGrid>
          {tabs.map((t) => (
            <ChoiceCard
              key={t.key}
              compact
              tone="blue"
              selected={tab === t.key}
              onClick={() => setTab(t.key)}
              icon={t.icon}
              title={t.label}
            />
          ))}
        </ChoiceCardDenseGrid>
      </div>

      {/* ── Overview Tab ─────────────────────────────────────────── */}

      {tab === 'overview' && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <div className="bg-slate-800/50 rounded-xl p-6 border border-slate-700/50 space-y-3">
            <h3 className="text-lg font-semibold">Configuration</h3>
            <EditableRow label="vCPUs" value={vm.vcpus} onEdit={() => openDialog('vcpus')} />
            <EditableRow label="Memory" value={`${vm.memory_mb} MB`} onEdit={() => openDialog('memory')} />
            <InfoRow label="OS Type" value={vm.os_type} />
            <InfoRow label="Architecture" value={vm.arch} />
            <InfoRow label="Persistent" value={vm.persistent ? 'Yes' : 'No'} />
            <InfoRow label="Managed Save" value={hasSave ? 'Yes' : 'No'} />
            <div className="flex items-center justify-between py-2">
              <span className="text-slate-400 text-sm">Autostart</span>
              <button onClick={toggleAutostart} className="flex items-center gap-2 text-sm">
                {vm.autostart ? <ToggleRight className={`w-5 h-5 ${statusToneClass('ok')}`} /> : <ToggleLeft className="w-5 h-5 text-slate-500" />}
                <span className={vm.autostart ? statusToneClass('ok') : 'text-slate-500'}>{vm.autostart ? 'Enabled' : 'Disabled'}</span>
              </button>
            </div>
            <p className="text-xs text-slate-500 leading-snug">
              Starts when libvirt starts. If guests do not come up after a host reboot, check Host overview for systemd/libvirt boot settings.
            </p>
          </div>

          {bootConfig && (
            <div className="bg-slate-800/50 rounded-xl p-6 border border-slate-700/50 space-y-3">
              <div className="flex items-center justify-between gap-2 flex-wrap">
                <h3 className="text-lg font-semibold">Boot Configuration</h3>
                <div className="flex gap-2">
                  <button type="button" onClick={() => openDialog('boot-order')} className={`text-xs transition ${statusActionLinkClasses('info')}`}>Edit boot</button>
                  <button
                    type="button"
                    onClick={() => {
                      const f = bootConfig.firmware.toLowerCase()
                      setFwChoice(f.includes('efi') || f.includes('ovmf') || f.includes('uefi') ? 'uefi' : 'bios')
                      openDialog('firmware')
                    }}
                    className={`text-xs transition ${statusActionLinkClasses('warn')}`}
                  >
                    Firmware…
                  </button>
                </div>
              </div>
              <InfoRow label="Boot Devices" value={bootConfig.boot_devices.join(', ') || 'None'} />
              <InfoRow label="Firmware" value={bootConfig.firmware} />
              <InfoRow label="Secure Boot" value={bootConfig.secure_boot ? 'Yes' : 'No'} />
              {bootConfig.kernel && <InfoRow label="Kernel" value={bootConfig.kernel} />}
              {bootConfig.initrd && <InfoRow label="Initrd" value={bootConfig.initrd} />}
              {bootConfig.cmdline && <InfoRow label="Cmdline" value={bootConfig.cmdline} />}
            </div>
          )}

          {(guestApiHostname || vm?.state === 'running') && (
            <div className="bg-slate-800/50 rounded-xl p-4 border border-slate-700/50 flex flex-wrap items-center justify-between gap-3" data-testid="vm-api-hostname">
              <div>
                <div className="text-xs text-slate-500">Guest hostname (GET /vms/…/hostname)</div>
                <div className="text-sm font-mono text-slate-200">{guestApiHostname ?? '—'}</div>
              </div>
              <button
                type="button"
                disabled={guestHostnameBusy || vm?.state !== 'running'}
                className="text-xs px-2 py-1 rounded bg-slate-700 hover:bg-slate-600 disabled:opacity-50"
                onClick={() => {
                  if (!name) return
                  setGuestHostnameBusy(true)
                  void getHostname(name, conn)
                    .then((r) => setGuestApiHostname(r.hostname?.trim() ? r.hostname : null))
                    .catch((e: unknown) => toast.error(formatUserError(e)))
                    .finally(() => setGuestHostnameBusy(false))
                }}
              >
                {guestHostnameBusy ? 'Refreshing…' : 'Refresh hostname'}
              </button>
            </div>
          )}

          {guestIps.length > 0 && (
            <div className="bg-slate-800/50 rounded-xl p-6 border border-slate-700/50 space-y-3">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <h3 className="text-lg font-semibold">Guest IP addresses</h3>
                {guestIfQueriedAt && (
                  <span className="text-xs text-slate-500 font-mono" title="Hypervisor-side snapshot time">
                    Snapshot: {new Date(guestIfQueriedAt).toLocaleString()}
                  </span>
                )}
              </div>
              <p className="text-xs text-slate-500">
                Rows merge libvirt DHCP <strong className="text-slate-400">lease</strong>, kernel <strong className="text-slate-400">ARP</strong>, then QEMU guest <strong className="text-slate-400">agent</strong>; first hit wins per address. When libvirt exposes DHCP leases, machina adds hostname/expiry; PTR (reverse DNS) is resolved on the hypervisor when possible.
              </p>
              {guestIps.map((ip) => {
                const { xmlGateway, heuristicGateway } = guestIpv4GatewayHints(
                  ip,
                  vm,
                  networkGateways,
                )
                const leaseHint =
                  ip.lease_seconds_remaining != null
                    ? ip.lease_seconds_remaining < 0
                      ? 'DHCP lease expired — renew guest NIC or check dnsmasq.'
                      : `DHCP expires in ~${Math.max(1, Math.round(ip.lease_seconds_remaining / 60))} min`
                    : null
                return (
                  <div key={ip.address} className="py-3 border-b border-slate-700/30 space-y-2">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div>
                        <span className={`text-sm font-medium ${statusToneClass('info')}`}>
                          {ip.address}/{ip.prefix}
                        </span>
                        <span className="text-xs text-slate-500 ml-2">{ip.ip_type}</span>
                      </div>
                      <span
                        className="text-xs uppercase tracking-wide px-2 py-0.5 rounded bg-slate-700/80 text-slate-300 shrink-0"
                        title="Discovery source"
                      >
                        {ip.source || '—'}
                      </span>
                      <div className="text-right min-w-0">
                        <div className="text-xs font-mono text-slate-400 truncate">{ip.mac}</div>
                        <div className="text-xs text-slate-500 truncate">{ip.name}</div>
                      </div>
                    </div>
                    <div className="text-xs text-slate-500 space-y-1 pl-0.5 border-l border-slate-600/40">
                      {ip.dhcp_hostname ? (
                        <div>
                          DHCP name:{' '}
                          <span className="text-slate-300">{ip.dhcp_hostname}</span>
                        </div>
                      ) : null}
                      {ip.dns_ptr ? (
                        <div>
                          PTR: <span className="font-mono text-slate-300">{ip.dns_ptr}</span>
                        </div>
                      ) : null}
                      {xmlGateway ? (
                        <div>
                          Gateway from libvirt network XML:{' '}
                          <code className="text-slate-300">{xmlGateway}</code>
                        </div>
                      ) : null}
                      {heuristicGateway ? (
                        <div>
                          {xmlGateway && xmlGateway !== heuristicGateway ? (
                            <>
                              Heuristic (.1 on subnet):{' '}
                              <code className="text-slate-300">{heuristicGateway}</code>
                            </>
                          ) : !xmlGateway ? (
                            <>
                              Typical default gateway (subnet +1 guess):{' '}
                              <code className="text-slate-300">{heuristicGateway}</code>
                            </>
                          ) : (
                            <span className="text-slate-500">
                              Matches common .1 heuristic on this subnet.
                            </span>
                          )}
                        </div>
                      ) : null}
                      {ip.source === 'arp' ? (
                        <div className={`${statusToneClass('warn')} opacity-90`}>
                          ARP-derived — kernel cache; can be stale vs guest reality.
                        </div>
                      ) : null}
                      {leaseHint ? (
                        <div
                          className={
                            ip.lease_seconds_remaining != null && ip.lease_seconds_remaining < 0
                              ? `${statusToneClass('error')} opacity-90`
                              : 'text-slate-400'
                          }
                        >
                          {leaseHint}
                        </div>
                      ) : null}
                    </div>
                  </div>
                )
              })}
            </div>
          )}

          {guestHealth && (
            <div
              className={`rounded-xl p-4 border ${
                guestHealth.healthy
                  ? statusSurfaceClasses('ok')
                  : statusSurfaceClasses('warn')
              }`}
            >
              <div className="flex flex-wrap items-center justify-between gap-2 mb-1">
                <div className="text-sm font-medium text-slate-100">Guest agent</div>
                {platformDoctor?.vm_id && (
                  <Link
                    to={`/platform/vms/${platformDoctor.vm_id}?tab=guestHealth`}
                    className={`text-xs ${statusActionLinkClasses('info')}`}
                  >
                    Open platform Guest health →
                  </Link>
                )}
              </div>
              <div className="text-xs text-slate-400">
                Guest agent {guestHealth.agent_reachable ? 'reachable' : 'unreachable'}
                {guestHealth.metrics_available ? ' · metrics ok' : ''}
                {guestHealth.os_pretty_name ? ` · ${guestHealth.os_pretty_name}` : ''}
                {guestHealth.cloud_init_status
                  ? ` · cloud-init: ${guestHealth.cloud_init_status}`
                  : ''}
              </div>
              {guestHealth.issues.length > 0 ? (
                <ul className={`mt-2 text-xs list-disc pl-4 ${statusToneClass('warn')}`}>
                  {guestHealth.issues.map((issue) => (
                    <li key={issue}>{issue}</li>
                  ))}
                </ul>
              ) : (
                <p className={`mt-1 text-xs ${statusToneClass('ok')} opacity-90`}>No issues detected</p>
              )}
            </div>
          )}

          {platformDoctor && (
            <div className="rounded-xl p-4 border border-orange-500/30 bg-orange-950/20">
              <div className="text-sm font-medium text-slate-100 mb-1">Zeus SRE</div>
              <p className="text-xs text-slate-400">
                Platform score: <span className="text-orange-300 font-semibold">{platformDoctor.score_numeric}/100</span>
                {' · '}{platformDoctor.score_label}
              </p>
              <Link to={`/platform/vms/${platformDoctor.vm_id}?tab=doctor`} className={`text-xs mt-1 inline-block ${statusActionLinkClasses('info')}`}>
                Open Doctor tab →
              </Link>
            </div>
          )}

          {guestObs && guestObs.filesystems.length > 0 && (
            <div className="bg-slate-800/50 rounded-xl p-6 border border-slate-700/50 space-y-3">
              <h3 className="text-lg font-semibold">Guest filesystems (qemu-guest-agent)</h3>
              {guestObs.hostname && (
                <InfoRow label="Guest hostname" value={guestObs.hostname} />
              )}
              <div className="overflow-x-auto">
                <table className="w-full text-sm" aria-label="Filesystem mounts">
                  <thead>
                    <tr className="text-left text-slate-400 border-b border-slate-700/50">
                      <th className="py-2 pr-4 font-medium">Mount</th>
                      <th className="py-2 pr-4 font-medium">Type</th>
                      <th className="py-2 pr-4 font-medium text-right">Used</th>
                      <th className="py-2 font-medium text-right">Total</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-700/40">
                    {guestObs.filesystems.map((fs) => {
                      const pct = fs.total_bytes > 0 ? (fs.used_bytes / fs.total_bytes) * 100 : 0
                      return (
                        <tr key={fs.mountpoint}>
                          <td className="py-2 pr-4 font-mono text-slate-200">{fs.mountpoint}</td>
                          <td className="py-2 pr-4 text-slate-400">{fs.fs_type || '—'}</td>
                          <td className="py-2 pr-4 text-right text-slate-300">{formatBytes(fs.used_bytes)}</td>
                          <td className="py-2 text-right text-slate-400">{formatBytes(fs.total_bytes)} ({pct.toFixed(0)}%)</td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {metrics && (
            <div className="bg-slate-800/50 rounded-xl p-6 border border-slate-700/50 space-y-3">
              <h3 className="text-lg font-semibold">Live Metrics</h3>
              <InfoRow label="Memory Used" value={`${metrics.memory_used_mb} / ${metrics.memory_total_mb} MB (${metrics.memory_pct.toFixed(1)}%)`} />
              <InfoRow label="Disk Read" value={formatBytes(metrics.disk_rd_bytes)} />
              <InfoRow label="Disk Write" value={formatBytes(metrics.disk_wr_bytes)} />
              <InfoRow label="Net RX" value={formatBytes(metrics.net_rx_bytes)} />
              <InfoRow label="Net TX" value={formatBytes(metrics.net_tx_bytes)} />
              {metrics.cgroup?.available && metrics.cgroup.memory_current_bytes != null && (
                <InfoRow
                  label="Cgroup memory"
                  value={`${formatBytes(metrics.cgroup.memory_current_bytes)}${
                    metrics.cgroup.memory_max_bytes != null
                      ? ` / ${formatBytes(metrics.cgroup.memory_max_bytes)}`
                      : ''
                  }`}
                />
              )}
              <div className="mt-2">
                <div className="flex justify-between text-xs text-slate-400 mb-1"><span>Memory</span><span>{metrics.memory_pct.toFixed(0)}%</span></div>
                <div className="w-full bg-slate-700 rounded-full h-2"><div className={`h-2 rounded-full transition-all ${statusBgClass(utilizationTone(metrics.memory_pct))}`} style={{ width: `${metrics.memory_pct}%` }} /></div>
              </div>
            </div>
          )}

          {(cpuTune || memTune) && (
            <div className="bg-slate-800/50 rounded-xl p-6 border border-slate-700/50 space-y-3">
              <h3 className="text-lg font-semibold">Resource Limits</h3>
              {cpuTune && (
                <>
                  <InfoRow label="CPU Shares" value={cpuTune.shares != null ? cpuTune.shares : 'Not set'} />
                  <InfoRow label="CPU Period" value={cpuTune.period != null ? `${cpuTune.period} us` : 'Not set'} />
                  <InfoRow label="CPU Quota" value={cpuTune.quota != null ? `${cpuTune.quota} us` : 'Not set'} />
                </>
              )}
              {memTune && (
                <>
                  <InfoRow label="Memory Hard Limit" value={memTune.hard_limit_kb != null ? `${(memTune.hard_limit_kb / 1024).toFixed(0)} MB` : 'Not set'} />
                  <InfoRow label="Memory Soft Limit" value={memTune.soft_limit_kb != null ? `${(memTune.soft_limit_kb / 1024).toFixed(0)} MB` : 'Not set'} />
                  <InfoRow label="Swap Limit" value={memTune.swap_hard_limit_kb != null ? `${(memTune.swap_hard_limit_kb / 1024).toFixed(0)} MB` : 'Not set'} />
                </>
              )}
              {cpuTune && cpuTune.vcpupin.length > 0 && (
                <div className="pt-2">
                  <span className="text-sm text-slate-400">vCPU Pinning</span>
                  <div className="mt-1 space-y-1">
                    {cpuTune.vcpupin.map((pin) => (
                      <div key={pin.vcpu} className="flex items-center justify-between py-1 border-b border-slate-700/30">
                        <span className="text-xs text-slate-400">vCPU {pin.vcpu}</span>
                        <span className="text-xs font-mono font-medium">{pin.cpuset}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* Per-VM Metrics Charts (below overview, visible when running) */}
      {tab === 'overview' && metricsHistory.length > 1 && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <div className="bg-slate-800/50 rounded-xl p-5 border border-slate-700/50">
            <h3 className="text-sm font-semibold text-white flex items-center gap-2 mb-4"><MemoryStick className={`w-4 h-4 ${statusToneClass('info')}`} /> Memory Usage</h3>
            <ResponsiveContainer width="100%" height={180}>
              <AreaChart data={metricsHistory}>
                <defs><linearGradient id="memG" x1="0" y1="0" x2="0" y2="1"><stop offset="5%" stopColor="#3b82f6" stopOpacity={0.3} /><stop offset="95%" stopColor="#3b82f6" stopOpacity={0} /></linearGradient></defs>
                <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
                <XAxis dataKey="time" stroke="#475569" fontSize={10} tickLine={false} />
                <YAxis stroke="#475569" fontSize={10} domain={[0, 100]} tickLine={false} />
                <Tooltip contentStyle={{ backgroundColor: '#0f172a', border: '1px solid #1e293b', borderRadius: '0.5rem' }} labelStyle={{ color: '#94a3b8' }} />
                <Area type="monotone" dataKey="memory" name="Memory %" stroke="#3b82f6" strokeWidth={2} fillOpacity={1} fill="url(#memG)" />
              </AreaChart>
            </ResponsiveContainer>
          </div>
          <div className="bg-slate-800/50 rounded-xl p-5 border border-slate-700/50">
            <h3 className="text-sm font-semibold text-white flex items-center gap-2 mb-4"><HardDrive className={`w-4 h-4 ${statusToneClass('ok')}`} /> Disk I/O</h3>
            <ResponsiveContainer width="100%" height={180}>
              <AreaChart data={metricsHistory}>
                <defs>
                  <linearGradient id="rdG" x1="0" y1="0" x2="0" y2="1"><stop offset="5%" stopColor="#10b981" stopOpacity={0.3} /><stop offset="95%" stopColor="#10b981" stopOpacity={0} /></linearGradient>
                  <linearGradient id="wrG" x1="0" y1="0" x2="0" y2="1"><stop offset="5%" stopColor="#f59e0b" stopOpacity={0.3} /><stop offset="95%" stopColor="#f59e0b" stopOpacity={0} /></linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
                <XAxis dataKey="time" stroke="#475569" fontSize={10} tickLine={false} />
                <YAxis stroke="#475569" fontSize={10} tickLine={false} tickFormatter={(v: number) => formatBytes(v)} />
                <Tooltip contentStyle={{ backgroundColor: '#0f172a', border: '1px solid #1e293b', borderRadius: '0.5rem' }} labelStyle={{ color: '#94a3b8' }} formatter={(v: number) => formatBytes(v)} />
                <Area type="monotone" dataKey="diskRd" name="Read" stroke="#10b981" strokeWidth={1.5} fillOpacity={1} fill="url(#rdG)" />
                <Area type="monotone" dataKey="diskWr" name="Write" stroke="#f59e0b" strokeWidth={1.5} fillOpacity={1} fill="url(#wrG)" />
              </AreaChart>
            </ResponsiveContainer>
          </div>
          <div className="bg-slate-800/50 rounded-xl p-5 border border-slate-700/50 lg:col-span-2">
            <h3 className="text-sm font-semibold text-white flex items-center gap-2 mb-4"><Network className="w-4 h-4 text-cyan-400" /> Network Throughput</h3>
            <ResponsiveContainer width="100%" height={180}>
              <AreaChart data={metricsHistory}>
                <defs>
                  <linearGradient id="rxG" x1="0" y1="0" x2="0" y2="1"><stop offset="5%" stopColor="#06b6d4" stopOpacity={0.3} /><stop offset="95%" stopColor="#06b6d4" stopOpacity={0} /></linearGradient>
                  <linearGradient id="txG" x1="0" y1="0" x2="0" y2="1"><stop offset="5%" stopColor="#a855f7" stopOpacity={0.3} /><stop offset="95%" stopColor="#a855f7" stopOpacity={0} /></linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
                <XAxis dataKey="time" stroke="#475569" fontSize={10} tickLine={false} />
                <YAxis stroke="#475569" fontSize={10} tickLine={false} tickFormatter={(v: number) => formatBytes(v)} />
                <Tooltip contentStyle={{ backgroundColor: '#0f172a', border: '1px solid #1e293b', borderRadius: '0.5rem' }} labelStyle={{ color: '#94a3b8' }} formatter={(v: number) => formatBytes(v)} />
                <Area type="monotone" dataKey="netRx" name="RX" stroke="#06b6d4" strokeWidth={1.5} fillOpacity={1} fill="url(#rxG)" />
                <Area type="monotone" dataKey="netTx" name="TX" stroke="#a855f7" strokeWidth={1.5} fillOpacity={1} fill="url(#txG)" />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}

      {/* ── Disks Tab ────────────────────────────────────────────── */}

      {tab === 'disks' && (
        <div className="space-y-4">
          <div className="flex justify-end gap-2 flex-wrap">
            <button
              type="button"
              onClick={() => void loadKubevirtExport()}
              disabled={kubevirtLoading}
              className="px-3 py-1.5 bg-violet-600 hover:bg-violet-700 disabled:opacity-50 rounded-lg text-sm transition flex items-center gap-1"
              title="CDI upload DataVolume + KubeVirt VM (virtio root + virtio-win CDROM containerDisk)"
            >
              <Archive className="w-4 h-4" aria-hidden />
              {kubevirtLoading ? 'Loading…' : 'KubeVirt YAML'}
            </button>
            {name && (openstackPushReady || openstackPushDisabledReason) && (
              <button
                type="button"
                onClick={() => openstackPushReady && setOpenstackPushOpen(true)}
                disabled={!openstackPushReady}
                className="px-3 py-1.5 bg-orange-600 hover:bg-orange-700 disabled:opacity-40 disabled:cursor-not-allowed rounded-lg text-sm transition flex items-center gap-1"
                title={openstackPushReady ? 'Upload root disk to OpenStack Glance' : openstackPushDisabledReason ?? ''}
              >
                <Cloud className="w-4 h-4" aria-hidden />
                Push to OpenStack
              </button>
            )}
            <button onClick={() => openDialog('attach-disk')} className="px-3 py-1.5 bg-blue-600 hover:bg-blue-700 rounded-lg text-sm transition flex items-center gap-1"><Plus className="w-4 h-4" /> Attach Disk</button>
          </div>
          <div className="bg-slate-800/50 rounded-xl border border-slate-700/50 overflow-hidden">
            <table className="w-full" aria-label="Disk devices">
              <thead><tr className="border-b border-slate-700/50 text-left text-sm text-slate-400"><th className="px-6 py-3">Target</th><th className="px-6 py-3">Bus</th><th className="px-6 py-3">Cache</th><th className="px-6 py-3">Device</th><th className="px-6 py-3">Driver</th><th className="px-6 py-3">Source</th><th className="px-6 py-3 text-right">Actions</th></tr></thead>
              <tbody className="divide-y divide-slate-700/30">
                {vm.disks.map((d) => (
                  <tr key={d.target} className="table-row-hover">
                    <td className="px-6 py-3 font-mono text-sm">{d.target}</td>
                    <td className="px-6 py-3 text-sm text-slate-400">{d.bus || '—'}</td>
                    <td className="px-6 py-3 text-sm text-slate-400">{d.cache || '—'}</td>
                    <td className="px-6 py-3 text-sm">{d.device}</td>
                    <td className="px-6 py-3 text-sm">{d.driver}</td>
                    <td className="px-6 py-3 text-sm text-slate-400 truncate max-w-xs">{d.source}</td>
                    <td className="px-6 py-3 text-right">
                      <div className="flex items-center justify-end gap-1">
                        {d.device === 'disk' && (
                          <button
                            type="button"
                            onClick={() => {
                              setTuneDiskTarget(d.target)
                              setTuneBus(d.bus || '')
                              setTuneCache(d.cache || '')
                              setTuneDiscard('')
                              setTuneRo(d.readonly === true ? 'true' : d.readonly === false ? 'false' : '')
                              setTuneShare(d.shareable === true ? 'true' : d.shareable === false ? 'false' : '')
                              openDialog('disk-tune')
                            }}
                            className={`p-1 rounded transition hover:bg-[color-mix(in_srgb,var(--machina-status-warn)_25%,transparent)]`}
                            title="Tune disk"
                            aria-label={`Tune ${d.target}`}
                          >
                            <Sliders className={`w-4 h-4 ${statusToneClass('warn')}`} />
                          </button>
                        )}
                        {d.device === 'disk' && <button onClick={() => { setResizeTarget(d.target); setResizeGb(20); setDialog('resize-disk') }} className="p-1 hover:bg-blue-600/20 rounded transition" title="Resize disk" aria-label={`Resize ${d.target}`}>
                          <HardDrive className={`w-4 h-4 ${statusToneClass('info')}`} />
                        </button>}
                        <button onClick={() => setDetachDiskTarget(d.target)} className="p-1 hover:bg-red-600/20 rounded transition" title="Detach disk" aria-label={`Detach ${d.target}`}>
                          <Trash2 className={`w-4 h-4 ${statusToneClass('error')}`} />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
                {vm.disks.length === 0 && <tr><td colSpan={7} className="px-6 py-8 text-center text-slate-500">No disks attached</td></tr>}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ── Network Tab ──────────────────────────────────────────── */}

      {tab === 'network' && (
        <div className="space-y-4">
          <details className="bg-slate-800/50 rounded-xl border border-slate-700/50 p-4 group">
            <summary className="cursor-pointer text-sm font-medium text-slate-200 list-none flex items-center gap-2 [&::-webkit-details-marker]:hidden">
              <span className="text-slate-400 group-open:rotate-90 transition">▸</span>
              Guest networking basics (NAT vs bridge, no DHCP)
            </summary>
            <div className="mt-3 text-xs text-slate-400 space-y-2 pl-1 border-l-2 border-slate-600/50 ml-1">
              <p>
                <strong className="text-slate-300">NAT (default network)</strong>: libvirt&apos;s virtual router gives guests private IPs (usually DHCP). Outbound traffic is masqueraded on the host; inbound needs port forwards or host hooks.
              </p>
              <p>
                <strong className="text-slate-300">Bridged / macvtap</strong>: the VM sits on the same L2 segment as a physical NIC or bridge—DHCP often comes from your LAN router. Misconfigured firewall or Spanning Tree can still block traffic.
              </p>
              <p>
                <strong className="text-slate-300">No DHCP</strong>: check the NIC is attached to an active libvirt network, guest OS has a driver (virtio), and cloud-init / NetworkManager aren&apos;t pinning a wrong config. Use the Overview &quot;Guest IP addresses&quot; panel to see whether libvirt sees a lease, ARP, or agent-reported address.
              </p>
              <p>
                <strong className="text-slate-300">Routing</strong>: many libvirt NAT networks use{' '}
                <code className="text-slate-400">.1</code> as the default gateway on the guest subnet (e.g. 192.168.122.1 for 192.168.122.0/24). Bridged guests usually take the same gateway as other LAN hosts. If ping fails, verify firewall/NFT on the host and that the guest actually obtained an address.
              </p>
              {guestIps.filter((g) => g.ip_type === 'ipv4').length > 0 && (
                <div className="pt-1">
                  <span className="text-slate-300 font-medium">Snapshot predicted gateways</span>
                  <ul className="list-disc list-inside mt-1 space-y-0.5">
                    {guestIps
                      .filter((g) => g.ip_type === 'ipv4')
                      .map((g) => {
                        const { xmlGateway, heuristicGateway } = guestIpv4GatewayHints(
                          g,
                          vm,
                          networkGateways,
                        )
                        const showHeuristic = heuristicGateway && (!xmlGateway || xmlGateway !== heuristicGateway)
                        return (
                          <li key={`${g.address}-${g.prefix}`}>
                            <span className="font-mono text-slate-300">{g.address}/{g.prefix}</span>
                            {xmlGateway ? (
                              <>
                                {' '}
                                → libvirt XML gateway <code className="text-slate-300">{xmlGateway}</code>
                              </>
                            ) : null}
                            {showHeuristic ? (
                              <>
                                {xmlGateway ? ' · ' : ' '}
                                heuristic <code className="text-slate-300">{heuristicGateway}</code>
                              </>
                            ) : !xmlGateway && !heuristicGateway ? (
                              <span className="text-slate-500"> (prefix unsupported for guess)</span>
                            ) : null}
                          </li>
                        )
                      })}
                  </ul>
                </div>
              )}
            </div>
          </details>
          {platformVmId && classicGuestIp ? (
            <div className="bg-slate-800/50 rounded-xl border border-slate-700/50 p-4">
              <h3 className="text-sm font-semibold text-slate-200 mb-3">Hypervisor NAT (port forwards)</h3>
              <VmPortForwardPanel
                platformVmId={platformVmId}
                vmName={vm.name}
                guestIp={classicGuestIp}
                sshUser={classicSshUser}
                hypervisorAddress={classicHypervisorAddress}
                onNotify={(m) => toast.success(m)}
              />
            </div>
          ) : null}
          <div className="flex justify-end">
            <button onClick={() => { setNicNetwork(networks[0]?.name || 'default'); setDialog('attach-nic') }} className="px-3 py-1.5 bg-blue-600 hover:bg-blue-700 rounded-lg text-sm transition flex items-center gap-1"><Plus className="w-4 h-4" /> Add NIC</button>
          </div>
          <div className="bg-slate-800/50 rounded-xl border border-slate-700/50 overflow-hidden">
            <table className="w-full" aria-label="Network interfaces">
              <thead><tr className="border-b border-slate-700/50 text-left text-sm text-slate-400"><th className="px-6 py-3">MAC Address</th><th className="px-6 py-3">Source</th><th className="px-6 py-3">Model</th><th className="px-6 py-3 text-right">Actions</th></tr></thead>
              <tbody className="divide-y divide-slate-700/30">
                {vm.interfaces.map((iface) => (
                  <tr key={iface.mac_address} className="table-row-hover">
                    <td className="px-6 py-3 font-mono text-sm">{iface.mac_address}</td>
                    <td className="px-6 py-3 text-sm">{iface.source}</td>
                    <td className="px-6 py-3 text-sm">{iface.model}</td>
                    <td className="px-6 py-3 text-right">
                      <div className="flex items-center justify-end gap-1">
                        <button
                          type="button"
                          onClick={() => {
                            setTuneMac(iface.mac_address)
                            setTuneNicModel(iface.model)
                            setTuneNicNet(iface.source)
                            openDialog('nic-tune')
                          }}
                          className={`p-1 rounded transition hover:bg-[color-mix(in_srgb,var(--machina-status-warn)_25%,transparent)]`}
                          title="Tune NIC"
                          aria-label={`Tune ${iface.mac_address}`}
                        >
                          <Sliders className={`w-4 h-4 ${statusToneClass('warn')}`} />
                        </button>
                        <button onClick={() => setDetachNicMac(iface.mac_address)} className="p-1 hover:bg-red-600/20 rounded transition" title="Detach NIC" aria-label={`Detach ${iface.mac_address}`}>
                          <Trash2 className={`w-4 h-4 ${statusToneClass('error')}`} />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
                {vm.interfaces.length === 0 && <tr><td colSpan={4} className="px-6 py-8 text-center text-slate-500">No network interfaces</td></tr>}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ── Snapshots Tab ────────────────────────────────────────── */}

      {tab === 'snapshots' && (
        <div className="space-y-4">
          <div className="flex justify-end">
            <button onClick={() => openDialog('snapshot')} className="px-3 py-1.5 bg-blue-600 hover:bg-blue-700 rounded-lg text-sm transition flex items-center gap-1"><Plus className="w-4 h-4" /> Create Snapshot</button>
          </div>
          <div className="bg-slate-800/50 rounded-xl border border-slate-700/50 overflow-hidden">
            {snapshots.length === 0 ? (
              <div className="p-8 text-center text-slate-500">No snapshots. Create one to save the current VM state.</div>
            ) : (
              <table className="w-full" aria-label="VM snapshots">
                <thead><tr className="border-b border-slate-700/50 text-left text-sm text-slate-400"><th className="px-6 py-3">Snapshot</th><th className="px-6 py-3">State</th><th className="px-6 py-3">Created</th><th className="px-6 py-3">Current</th><th className="px-6 py-3 text-right">Actions</th></tr></thead>
                <tbody className="divide-y divide-slate-700/30">
                  <SnapshotTableRows
                    nodes={snapshotRoots}
                    depth={0}
                    onRevert={handleRevertSnapshot}
                    onDelete={(n) => setDeleteSnapName(n)}
                  />
                </tbody>
              </table>
            )}
          </div>
        </div>
      )}

      {/* ── Devices Tab (USB + PCI) ─────────────────────────────── */}

      {tab === 'devices' && (
        <div className="space-y-6">
          {platformVmId && linkedPlatformVm && linkedPlatformVm.inventory_source !== 'kubevirt' ? (
            <ClassicVmPlatformHardware
              platformVmId={platformVmId}
              vmName={vm.name}
              vmState={vm.state}
              hostId={linkedPlatformVm.host_id}
              managed={linkedPlatformVm.managed}
              portForwardRules={classicPortForwards}
              onPlanRefresh={() => {
                void listVmPortForwards(platformVmId).then(setClassicPortForwards).catch(() => setClassicPortForwards([]))
              }}
            />
          ) : null}
          <div className="bg-slate-800/50 rounded-xl border border-slate-700/50 p-5 space-y-3">
            <h3 className="text-lg font-semibold text-slate-200">Virtual hardware</h3>
            <p className="text-xs text-slate-500">TPM, watchdog, sound, extra serial, and video — shut off the guest when libvirt requires a static config change.</p>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                className="px-3 py-1.5 bg-slate-700 hover:bg-slate-600 rounded-lg text-sm transition"
                onClick={() => {
                  if (!name) return
                  void attachVmTpm(name, conn).then(() => { toast.success('TPM 2.0 attached'); load(); setVmXml('') }).catch((e: unknown) => toast.error(formatUserError(e)))
                }}
              >
                Add TPM 2.0
              </button>
              <button
                type="button"
                className="px-3 py-1.5 bg-slate-700 hover:bg-slate-600 rounded-lg text-sm transition"
                onClick={() => {
                  if (!name) return
                  void detachVmTpm(name, conn).then(() => { toast.success('TPM removed'); load(); setVmXml('') }).catch((e: unknown) => toast.error(formatUserError(e)))
                }}
              >
                Remove TPM
              </button>
              <button type="button" className="px-3 py-1.5 bg-slate-700 hover:bg-slate-600 rounded-lg text-sm transition" onClick={() => openDialog('watchdog')}>Watchdog…</button>
              <button type="button" className="px-3 py-1.5 bg-slate-700 hover:bg-slate-600 rounded-lg text-sm transition" onClick={() => openDialog('sound')}>Sound…</button>
              <button type="button" className="px-3 py-1.5 bg-slate-700 hover:bg-slate-600 rounded-lg text-sm transition" onClick={() => openDialog('serial')}>Extra serial…</button>
              <button type="button" className="px-3 py-1.5 bg-slate-700 hover:bg-slate-600 rounded-lg text-sm transition" onClick={() => openDialog('video')}>Video model…</button>
            </div>
          </div>

          {/* Shared directories (virtiofs) */}
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="text-lg font-semibold flex items-center gap-2"><FolderOpen className={`w-5 h-5 ${statusToneClass('ok')}`} /> Shared directories</h3>
              <span className="text-xs text-slate-500">virtiofs (Linux guests)</span>
            </div>
            <div className="bg-slate-800/50 rounded-xl border border-slate-700/50 p-5 space-y-4">
              <p className="text-xs text-slate-500">
                Cockpit-style host directory sharing via <code className="text-slate-300">virtiofs</code>. VM must be <strong>shut off</strong> to add/remove.
              </p>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                <div>
                  <label className="block text-xs text-slate-400 mb-1">Source path (host)</label>
                  <input value={shareSourceDir} onChange={(e) => setShareSourceDir(e.target.value)} placeholder="/data/share" className="input-field w-full" />
                </div>
                <div>
                  <label className="block text-xs text-slate-400 mb-1">Mount tag</label>
                  <input value={shareMountTag} onChange={(e) => setShareMountTag(e.target.value)} placeholder="hostshare" className="input-field w-full font-mono text-xs" />
                </div>
                <div className="flex items-end gap-3">
                  <label className="flex items-center gap-2 text-sm text-slate-300 pb-2 cursor-pointer select-none">
                    <input type="checkbox" className="rounded border-slate-600" checked={shareXattr} onChange={(e) => setShareXattr(e.target.checked)} />
                    <span>Extended attributes (xattr)</span>
                  </label>
                  <button
                    type="button"
                    onClick={async () => {
                      if (!name) return
                      if (!shareSourceDir.trim() || !shareMountTag.trim()) return
                      try {
                        await addShare(name, shareSourceDir.trim(), shareMountTag.trim(), shareXattr, conn)
                        toast.success('Shared directory added')
                        setShareSourceDir('')
                        setShareMountTag('')
                        load()
                        setVmXml('')
                      } catch (e: unknown) {
                        toast.error(formatUserError(e))
                      }
                    }}
                    className="ml-auto px-3 py-2 bg-emerald-700 hover:bg-emerald-600 rounded-lg text-sm transition"
                  >
                    Share
                  </button>
                </div>
              </div>
              <div className="bg-slate-900/40 rounded-lg border border-slate-700/40 overflow-hidden">
                <table className="w-full" aria-label="virtio-fs shares">
                  <thead>
                    <tr className="border-b border-slate-700/50 text-left text-xs text-slate-500">
                      <th className="px-5 py-2">Mount tag</th>
                      <th className="px-5 py-2">Source</th>
                      <th className="px-5 py-2">Driver</th>
                      <th className="px-5 py-2">xattr</th>
                      <th className="px-5 py-2 text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-700/30 text-sm">
                    {(vm?.filesystems || []).length === 0 ? (
                      <tr><td colSpan={5} className="px-5 py-6 text-center text-slate-500">No shared directories configured.</td></tr>
                    ) : (
                      (vm?.filesystems || []).map((fs, i) => (
                        <tr key={`${fs.mount_tag}-${i}`} className="table-row-hover">
                          <td className={`px-5 py-2 font-mono text-xs ${statusToneClass('ok')}`}>{fs.mount_tag}</td>
                          <td className="px-5 py-2 font-mono text-xs text-slate-300 break-all">{fs.source}</td>
                          <td className="px-5 py-2 text-slate-300">{fs.driver || '-'}</td>
                          <td className="px-5 py-2 text-slate-300">{fs.xattr ? 'on' : 'off'}</td>
                          <td className="px-5 py-2 text-right">
                            <button
                              type="button"
                              onClick={async () => {
                                if (!name) return
                                try {
                                  await removeShare(name, fs.mount_tag, conn)
                                  toast.success('Shared directory removed')
                                  load()
                                  setVmXml('')
                                } catch (e: unknown) {
                                  toast.error(formatUserError(e))
                                }
                              }}
                              className="px-2 py-0.5 bg-red-600/20 hover:bg-red-600/30 rounded text-xs text-red-300 transition"
                            >
                              Remove
                            </button>
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
              <p className="text-xs text-slate-500">
                Inside the guest: <code className="text-slate-300">mount -t virtiofs &lt;mount_tag&gt; /mnt</code>
              </p>
            </div>
          </div>

          <details className="rounded-xl border border-slate-700/50 bg-slate-800/30 overflow-hidden group">
            <summary className="px-5 py-3 cursor-pointer text-sm font-semibold text-slate-200 select-none flex items-center gap-2">
              <Sliders className="w-4 h-4 text-slate-400" />
              Advanced passthrough (USB, PCI, IOMMU)
              <span className="text-xs font-normal text-slate-500 ml-1">— expand for host devices and VFIO groups</span>
            </summary>
            <div className="p-5 pt-0 space-y-6 border-t border-slate-700/40">
          {/* USB Devices */}
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="text-lg font-semibold flex items-center gap-2"><Usb className={`w-5 h-5 ${statusToneClass('info')}`} /> USB Devices</h3>
              <button
                type="button"
                onClick={() => setDialog('attach-usb')}
                disabled={!canUsbPci}
                title={!canUsbPci ? 'USB passthrough requires operator or admin' : undefined}
                className="px-3 py-1.5 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed rounded-lg text-sm transition flex items-center gap-1"
              >
                <Plus className="w-4 h-4" /> Attach USB
              </button>
            </div>
            <div className="bg-slate-800/50 rounded-xl border border-slate-700/50 overflow-hidden">
              <table className="w-full" aria-label="USB devices">
                <thead><tr className="border-b border-slate-700/50 text-left text-xs text-slate-500"><th className="px-6 py-2">Bus</th><th className="px-6 py-2">Device</th><th className="px-6 py-2">ID</th><th className="px-6 py-2">Description</th><th className="px-6 py-2 text-right">Actions</th></tr></thead>
                <tbody className="divide-y divide-slate-700/30 text-sm">
                  {usbDevices.map((d) => (
                    <tr key={`${d.vendor_id}:${d.product_id}`} className="table-row-hover">
                      <td className="px-6 py-2 font-mono text-xs">{d.bus}</td>
                      <td className="px-6 py-2 font-mono text-xs">{d.device}</td>
                      <td className={`px-6 py-2 font-mono ${statusToneClass('info')}`}>{d.vendor_id}:{d.product_id}</td>
                      <td className="px-6 py-2 text-slate-300">{d.description}</td>
                      <td className="px-6 py-2 text-right">
                        <button
                          type="button"
                          onClick={() => void handleAttachUsb(d.vendor_id, d.product_id)}
                          disabled={!canUsbPci}
                          title={!canUsbPci ? 'USB passthrough requires operator or admin' : undefined}
                          className={`px-2 py-0.5 hover:bg-blue-600/30 disabled:opacity-50 rounded text-xs transition ${statusBadgeClasses('info')}`}
                        >
                          Attach
                        </button>
                      </td>
                    </tr>
                  ))}
                  {usbDevices.length === 0 && <tr><td colSpan={5} className="px-6 py-8 text-center text-slate-500">No USB devices found on host</td></tr>}
                </tbody>
              </table>
            </div>
          </div>

          {/* PCI Devices */}
          <div className="space-y-4">
            <h3 className="text-lg font-semibold flex items-center gap-2"><Monitor className="w-5 h-5 text-purple-400" /> PCI Devices</h3>
            <div className="bg-slate-800/50 rounded-xl border border-slate-700/50 overflow-hidden">
              <table className="w-full" aria-label="PCI devices">
                <thead><tr className="border-b border-slate-700/50 text-left text-xs text-slate-500"><th className="px-6 py-2">Slot</th><th className="px-6 py-2">Class</th><th className="px-6 py-2">Vendor</th><th className="px-6 py-2">Device</th><th className="px-6 py-2">IOMMU Group</th></tr></thead>
                <tbody className="divide-y divide-slate-700/30 text-sm">
                  {pciDevices.map((d) => (
                    <tr key={d.slot} className="table-row-hover">
                      <td className={`px-6 py-2 font-mono text-xs ${statusToneClass('info')}`}>{d.slot}</td>
                      <td className="px-6 py-2 text-slate-300">{d.class}</td>
                      <td className="px-6 py-2 text-slate-300">{d.vendor}</td>
                      <td className="px-6 py-2 text-slate-300">{d.device}</td>
                      <td className="px-6 py-2 font-mono text-xs text-slate-400">{d.iommu_group || '-'}</td>
                    </tr>
                  ))}
                  {pciDevices.length === 0 && <tr><td colSpan={5} className="px-6 py-8 text-center text-slate-500">No PCI devices found or lspci not available</td></tr>}
                </tbody>
              </table>
            </div>
          </div>

          {/* IOMMU Groups */}
          <div className="space-y-4">
            <h3 className="text-lg font-semibold flex items-center gap-2"><Shield className="w-5 h-5 text-orange-400" /> IOMMU Groups</h3>
            {iommuGroups.length === 0 ? (
              <div className="bg-slate-800/50 rounded-xl border border-slate-700/50 p-8 text-center text-slate-500">No IOMMU groups found. IOMMU may not be enabled or /sys/kernel/iommu_groups is empty.</div>
            ) : (
              <div className="space-y-3">
                {iommuGroups.map((g) => (
                  <div key={g.group_id} className="bg-slate-800/50 rounded-xl border border-slate-700/50 overflow-hidden">
                    <div className="px-5 py-2.5 bg-slate-800/80 border-b border-slate-700/50 text-sm font-medium text-orange-400">Group {g.group_id} ({g.devices.length} device{g.devices.length !== 1 ? 's' : ''})</div>
                    <table className="w-full" aria-label="IOMMU group devices">
                      <thead><tr className="border-b border-slate-700/50 text-left text-xs text-slate-500"><th className="px-5 py-2">BDF</th><th className="px-5 py-2">Vendor</th><th className="px-5 py-2">Device</th></tr></thead>
                      <tbody className="divide-y divide-slate-700/30 text-sm">
                        {g.devices.map((d) => (
                          <tr key={d.bdf} className="table-row-hover">
                            <td className={`px-5 py-2 font-mono text-xs ${statusToneClass('info')}`}>{d.bdf}</td>
                            <td className="px-5 py-2 text-slate-300">{d.vendor || '-'}</td>
                            <td className="px-5 py-2 text-slate-300">{d.device_name || '-'}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ))}
              </div>
            )}
          </div>
            </div>
          </details>
        </div>
      )}

      {/* ── Advanced (libvirt) ───────────────────────────────────── */}

      {tab === 'advanced' && (
        <div className="space-y-6">
          <div className={`rounded-xl p-4 text-sm ${statusSurfaceClasses('warn')}`}>
            These actions map directly to libvirt (<code className="opacity-90">virsh blockcommit</code>, <code className="opacity-90">undefine --nvram</code>, etc.). Wrong options can destroy data or make a VM unbootable. Prefer shutoff VMs for delete and PCI attach unless you know the guest is safe.
          </div>

          <div className="bg-slate-800/50 rounded-xl p-6 border border-slate-700/50 space-y-4">
            <h3 className="text-lg font-semibold flex items-center gap-2"><Trash2 className={`w-5 h-5 ${statusToneClass('error')}`} /> Delete VM</h3>
            <p className="text-xs text-slate-400">Optional <code className="text-slate-300">undefine</code> flags (query params on DELETE). Typically use with VM shut off.</p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-sm">
              <label className="flex items-center gap-2 cursor-pointer text-slate-300">
                <input type="checkbox" className="rounded border-slate-600" checked={!!deleteUndefine.undefine_managed_save} onChange={(e) => setDeleteUndefine((p) => ({ ...p, undefine_managed_save: e.target.checked }))} />
                <span>Remove managed save image</span>
              </label>
              <label className="flex items-center gap-2 cursor-pointer text-slate-300">
                <input type="checkbox" className="rounded border-slate-600" checked={!!deleteUndefine.undefine_snapshots_metadata} onChange={(e) => setDeleteUndefine((p) => ({ ...p, undefine_snapshots_metadata: e.target.checked }))} />
                <span>Drop snapshot metadata only</span>
              </label>
              <label className="flex items-center gap-2 cursor-pointer text-slate-300">
                <input type="checkbox" className="rounded border-slate-600" checked={!!deleteUndefine.undefine_nvram} onChange={(e) => setDeleteUndefine((p) => ({ ...p, undefine_nvram: e.target.checked }))} />
                <span>Delete UEFI NVRAM file</span>
              </label>
              <label className="flex items-center gap-2 cursor-pointer text-slate-300">
                <input type="checkbox" className="rounded border-slate-600" checked={!!deleteUndefine.undefine_keep_nvram} onChange={(e) => setDeleteUndefine((p) => ({ ...p, undefine_keep_nvram: e.target.checked }))} />
                <span>Keep NVRAM (exclusive with delete NVRAM)</span>
              </label>
              <label className="flex items-center gap-2 cursor-pointer text-slate-300">
                <input type="checkbox" className="rounded border-slate-600" checked={!!deleteUndefine.undefine_checkpoints_metadata} onChange={(e) => setDeleteUndefine((p) => ({ ...p, undefine_checkpoints_metadata: e.target.checked }))} />
                <span>Remove checkpoint metadata</span>
              </label>
              <label className="flex items-center gap-2 cursor-pointer text-slate-300">
                <input type="checkbox" className="rounded border-slate-600" checked={!!deleteUndefine.undefine_tpm} onChange={(e) => setDeleteUndefine((p) => ({ ...p, undefine_tpm: e.target.checked }))} />
                <span>Delete TPM state</span>
              </label>
              <label className="flex items-center gap-2 cursor-pointer text-slate-300">
                <input type="checkbox" className="rounded border-slate-600" checked={!!deleteUndefine.undefine_keep_tpm} onChange={(e) => setDeleteUndefine((p) => ({ ...p, undefine_keep_tpm: e.target.checked }))} />
                <span>Keep TPM (exclusive with delete TPM)</span>
              </label>
            </div>
            <p className={`text-xs ${statusToneClass('warn')}`}>
              UEFI: if libvirt returns “cannot undefine domain with nvram”, enable <strong>Delete UEFI NVRAM file</strong> (same as{' '}
              <code className="opacity-90">virsh undefine --nvram</code>). On delete failure the UI may enable this checkbox once so you can confirm again—uncheck if you need to keep NVRAM.
            </p>
            <button
              type="button"
              onClick={() => openDialog('delete-vm')}
              disabled={!canDestroyVm}
              title={!canDestroyVm ? 'Destroying VMs requires the admin role' : undefined}
              className="px-4 py-2 bg-red-600 hover:bg-red-500 disabled:opacity-50 disabled:cursor-not-allowed rounded-lg text-sm font-medium transition"
            >
              Delete this VM…
            </button>
            {!canDestroyVm && (
              <p className="text-xs text-slate-500">Your role cannot destroy guests. Ask an admin to grant the admin role in machina&apos;s roles map.</p>
            )}
          </div>

          <div className="bg-slate-800/50 rounded-xl p-6 border border-slate-700/50 space-y-4">
            <h3 className="text-lg font-semibold">CPU / memory tuning</h3>
            <div className="flex flex-wrap gap-2">
              <button type="button" onClick={() => openDialog('scheduler-tune')} className="px-3 py-1.5 bg-slate-700 hover:bg-slate-600 rounded-lg text-sm transition">Edit scheduler (shares / vCPU bandwidth)</button>
              <button type="button" onClick={() => openDialog('memtune')} className="px-3 py-1.5 bg-slate-700 hover:bg-slate-600 rounded-lg text-sm transition">Edit memtune (KiB)</button>
              <button type="button" onClick={() => openDialog('numa-tune')} className="px-3 py-1.5 bg-slate-700 hover:bg-slate-600 rounded-lg text-sm transition">NUMA memory tuning</button>
              <button type="button" onClick={() => openDialog('emulator-pin')} className="px-3 py-1.5 bg-slate-700 hover:bg-slate-600 rounded-lg text-sm transition">Pin QEMU emulator threads</button>
              <button type="button" onClick={() => openDialog('pin-vcpu')} className="px-3 py-1.5 bg-slate-700 hover:bg-slate-600 rounded-lg text-sm transition">Pin vCPU to host CPUs</button>
            </div>
          </div>

          <div className="bg-slate-800/50 rounded-xl p-6 border border-slate-700/50 space-y-4">
            <h3 className="text-lg font-semibold">Block jobs (snapshots / backing chain)</h3>
            <div className="flex flex-wrap gap-3 items-end">
              <div>
                <label className="block text-xs text-slate-400 mb-1">Disk target</label>
                <select aria-label="Disk target" value={blockDisk} onChange={(e) => setBlockDisk(e.target.value)} className="input-field min-w-[120px]">
                  <option value="">Select…</option>
                  {vm.disks.filter((d) => d.device === 'disk').map((d) => (
                    <option key={d.target} value={d.target}>{d.target}</option>
                  ))}
                </select>
              </div>
              <button type="button" onClick={handleBlockJobRefresh} className="px-3 py-2 bg-slate-700 hover:bg-slate-600 rounded-lg text-sm transition">Refresh job status</button>
              <button
                type="button"
                className="px-3 py-2 bg-slate-700 hover:bg-slate-600 rounded-lg text-sm transition"
                disabled={!name}
                onClick={async () => {
                  if (!name) return
                  try {
                    setJobStats(await getVmJobStats(name))
                    toast.success('Job stats loaded')
                  } catch (e: unknown) {
                    toast.error(formatUserError(e))
                  }
                }}
              >
                Job stats API
              </button>
              <button type="button" onClick={() => openDialog('block-commit')} className="px-3 py-2 bg-blue-600 hover:bg-blue-500 rounded-lg text-sm transition">Block commit…</button>
              <button type="button" onClick={handleBlockPull} className="px-3 py-2 bg-emerald-700 hover:bg-emerald-600 rounded-lg text-sm transition">Block pull</button>
              <button type="button" onClick={() => handleBlockAbort(false, false)} className="px-3 py-2 bg-slate-600 hover:bg-slate-500 rounded-lg text-sm transition">Abort job</button>
              <button type="button" onClick={() => handleBlockAbort(true, true)} className="px-3 py-2 bg-orange-700 hover:bg-orange-600 rounded-lg text-sm transition">Abort (async + pivot)</button>
            </div>
            {blockJob !== undefined && (
              blockJob === null ? (
                <p className="text-sm text-slate-400">No active block job on this disk.</p>
              ) : (
                <div className="rounded-lg border border-slate-700 bg-slate-900/80 p-4 space-y-3">
                  <div className="flex flex-wrap gap-3 text-sm">
                    <span className="text-slate-300">Operation type: <strong className="text-slate-100">{blockJob.job_type}</strong></span>
                    <span className="text-slate-300">Progress: <strong className={statusToneClass('ok')}>{blockJob.end > 0 ? Math.round((blockJob.cur / blockJob.end) * 100) : 0}%</strong></span>
                  </div>
                  <div className="h-2 rounded-full bg-slate-800 overflow-hidden">
                    <div className={`h-full rounded-full transition-all ${statusBgClass('info')}`} style={{ width: `${blockJob.end > 0 ? Math.min(100, (blockJob.cur / blockJob.end) * 100) : 0}%` }} />
                  </div>
                  <p className="text-xs text-slate-500">{blockJob.cur.toLocaleString()} / {blockJob.end.toLocaleString()} bytes · bandwidth {blockJob.bandwidth}</p>
                </div>
              )
            )}
            {jobStats && (
              <p className="text-xs text-slate-400 mt-2">API stats: {jobStats.cur} / {jobStats.end} · {jobStats.job_type ?? 'job'}</p>
            )}
          </div>

          <div className="bg-slate-800/50 rounded-xl p-6 border border-slate-700/50 space-y-4">
            <h3 className="text-lg font-semibold">CPU compatibility</h3>
            <button
              type="button"
              className="px-3 py-2 bg-slate-700 hover:bg-slate-600 rounded-lg text-sm transition"
              onClick={async () => {
                try {
                  setCpuCompare(await compareCpu({ guest_arch: vm?.arch ?? 'x86_64' }))
                } catch (e: unknown) {
                  toast.error(formatUserError(e))
                }
              }}
            >
              Compare host CPU
            </button>
            {cpuCompare && (
              <p className={`text-sm ${statusToneClass(cpuCompare.compatible ? 'ok' : 'warn')}`}>{cpuCompare.summary}</p>
            )}
          </div>

          <div className="bg-slate-800/50 rounded-xl p-6 border border-slate-700/50 space-y-4">
            <h3 className="text-lg font-semibold">PCI passthrough (VFIO)</h3>
            <p className="text-xs text-slate-400">BDF like <code className="text-slate-300">0000:03:00.0</code>. Detach the node device from the host first when required.</p>
            <div className="flex flex-wrap gap-2 items-end">
              <input aria-label="PCI BDF address" value={pciBdf} onChange={(e) => setPciBdf(e.target.value)} placeholder="0000:03:00.0" className="input-field flex-1 min-w-[200px]" />
              <button
                type="button"
                disabled={!canUsbPci}
                title={!canUsbPci ? 'PCI passthrough requires operator or admin' : undefined}
                onClick={async () => {
                  if (!canUsbPci || !name || !pciBdf.trim()) return
                  try {
                    await attachPciHostdev(name, pciBdf.trim())
                    toast.success('PCI attach requested')
                    load()
                    setVmXml('')
                  } catch (e: unknown) {
                    toast.error(`${formatUserError(e)}`)
                  }
                }}
                className="px-3 py-2 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 rounded-lg text-sm transition"
              >
                Attach
              </button>
              <button
                type="button"
                disabled={!canUsbPci}
                title={!canUsbPci ? 'PCI passthrough requires operator or admin' : undefined}
                onClick={async () => {
                  if (!canUsbPci || !name || !pciBdf.trim()) return
                  try {
                    await detachPciHostdev(name, pciBdf.trim())
                    toast.success('PCI detach requested')
                    load()
                    setVmXml('')
                  } catch (e: unknown) {
                    toast.error(`${formatUserError(e)}`)
                  }
                }}
                className="px-3 py-2 bg-slate-600 hover:bg-slate-500 disabled:opacity-50 rounded-lg text-sm transition"
              >
                Detach
              </button>
            </div>
          </div>

          <div className="bg-slate-800/50 rounded-xl p-6 border border-slate-700/50 space-y-4">
            <h3 className="text-lg font-semibold">Host node device</h3>
            <p className="text-xs text-slate-400">Name from <strong className="text-slate-300">Devices</strong> page or <code className="text-slate-300">pci_0000_03_00_0</code> style libvirt id.</p>
            <div className="flex flex-wrap gap-2 items-end">
              <input aria-label="Host node device name" value={nodedevName} onChange={(e) => setNodedevName(e.target.value)} placeholder="pci_0000_03_00_0" className="input-field flex-1 min-w-[220px]" />
              <button
                type="button"
                disabled={!canUsbPci}
                title={!canUsbPci ? 'Node device ops require operator or admin' : undefined}
                onClick={async () => {
                  if (!canUsbPci || !nodedevName.trim()) return
                  try {
                    await detachNodeDevice(nodedevName.trim())
                    toast.success('Node device detached')
                  } catch (e: unknown) {
                    toast.error(`${formatUserError(e)}`)
                  }
                }}
                className="px-3 py-2 bg-orange-700 hover:bg-orange-600 disabled:opacity-50 rounded-lg text-sm transition"
              >
                Detach from host
              </button>
              <button
                type="button"
                disabled={!canUsbPci}
                title={!canUsbPci ? 'Node device ops require operator or admin' : undefined}
                onClick={async () => {
                  if (!canUsbPci || !nodedevName.trim()) return
                  try {
                    await reattachNodeDevice(nodedevName.trim())
                    toast.success('Node device reattached')
                  } catch (e: unknown) {
                    toast.error(`${formatUserError(e)}`)
                  }
                }}
                className="px-3 py-2 bg-slate-600 hover:bg-slate-500 disabled:opacity-50 rounded-lg text-sm transition"
              >
                Reattach to host
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── XML Tab ──────────────────────────────────────────────── */}

      {tab === 'xml' && (
        <div className="bg-slate-800/50 rounded-xl border border-slate-700/50 overflow-hidden">
          <div className="px-6 py-3 border-b border-slate-700/50 flex items-center justify-between">
            <span className="text-sm text-slate-400">Domain XML Configuration</span>
            <div className="flex items-center gap-3">
              <button onClick={downloadXml} className={`text-xs transition flex items-center gap-1 ${statusActionLinkClasses('info')}`}><Download className="w-3 h-3" /> Download</button>
              <button onClick={() => { if (vmXml) navigator.clipboard.writeText(vmXml).then(() => toast.success('XML copied')) }} className={`text-xs transition flex items-center gap-1 ${statusActionLinkClasses('info')}`}><Copy className="w-3 h-3" /> Copy</button>
            </div>
          </div>
          <pre className="p-6 text-xs font-mono text-slate-300 overflow-x-auto max-h-[600px] whitespace-pre">{vmXml || 'Loading...'}</pre>
        </div>
      )}

      {/* ── Logs Tab ────────────────────────────────────────────── */}

      {tab === 'logs' && (
        <div className="bg-slate-800/50 rounded-xl border border-slate-700/50 overflow-hidden">
          <div className="px-6 py-3 border-b border-slate-700/50 flex items-center justify-between">
            <span className="text-sm text-slate-400">QEMU Log ({`/var/log/libvirt/qemu/${vm.name}.log`})</span>
            <div className="flex items-center gap-3">
              <select aria-label="Log lines" value={logsLines} onChange={(e) => setLogsLines(parseInt(e.target.value))} className="bg-slate-900 border border-slate-700 rounded px-2 py-1 text-xs text-slate-300">
                <option value={500}>500 lines</option>
                <option value={1000}>1000 lines</option>
                <option value={2000}>2000 lines</option>
                <option value={5000}>5000 lines</option>
              </select>
              <button onClick={() => { if (name) getVMLogs(name, logsLines, conn).then((r) => setLogsContent(r.content)).catch(() => setLogsContent('Failed to load logs')) }} className={`text-xs transition flex items-center gap-1 ${statusActionLinkClasses('info')}`}><RefreshCw className="w-3 h-3" /> Refresh</button>
            </div>
          </div>
          <pre className="p-6 text-xs font-mono text-slate-300 overflow-x-auto max-h-[600px] overflow-y-auto whitespace-pre">{logsContent || 'No log content available.'}</pre>
        </div>
      )}

      {/* ── Dialogs ─────────────────────────────────────────────── */}

      {dialog && (
        <DialogOverlay onClose={() => setDialog(null)}>
          {dialog === 'vcpus' && (
            <DialogBox title="Set vCPUs" icon={<Cpu className={`w-5 h-5 ${statusToneClass('info')}`} />} onClose={() => setDialog(null)} onConfirm={handleSetVcpus} confirmLabel="Apply">
              <label htmlFor="dlg-vcpus" className="block text-sm text-slate-400 mb-1">vCPU Count (1-256)</label>
              <input id="dlg-vcpus" type="number" min={1} max={256} autoFocus value={editVcpus} onChange={(e) => setEditVcpus(parseInt(e.target.value) || 1)} className="input-field" />
              <p className="text-xs text-slate-500 mt-2">Changes to a running VM take effect on next reboot.</p>
            </DialogBox>
          )}

          {dialog === 'memory' && (
            <DialogBox title="Set Memory" icon={<MemoryStick className={`w-5 h-5 ${statusToneClass('info')}`} />} onClose={() => setDialog(null)} onConfirm={handleSetMemory} confirmLabel="Apply">
              <label htmlFor="dlg-mem" className="block text-sm text-slate-400 mb-1">Memory (MB, 64 - 1048576)</label>
              <input id="dlg-mem" type="number" min={64} max={1048576} autoFocus value={editMemory} onChange={(e) => setEditMemory(parseInt(e.target.value) || 1024)} className="input-field" />
              <p className="text-xs text-slate-500 mt-2">Sets the maximum memory allocation. Takes effect on next reboot.</p>
            </DialogBox>
          )}

          {dialog === 'balloon' && (
            <DialogBox title="Memory Balloon" icon={<MemoryStick className="w-5 h-5 text-purple-400" />} onClose={() => setDialog(null)} onConfirm={handleBalloon} confirmLabel="Apply">
              <label htmlFor="dlg-balloon" className="block text-sm text-slate-400 mb-1">Target Memory (MB)</label>
              <input id="dlg-balloon" type="number" min={64} autoFocus value={balloonMb} onChange={(e) => setBalloonMb(parseInt(e.target.value) || 64)} className="input-field" />
              <p className="text-xs text-slate-500 mt-2">Dynamically adjust memory on a running VM. The guest must have balloon drivers installed.</p>
            </DialogBox>
          )}

          {dialog === 'clone' && (
            <DialogBox title="Clone VM" icon={<Copy className={`w-5 h-5 ${statusToneClass('ok')}`} />} onClose={() => setDialog(null)} onConfirm={handleClone} confirmLabel="Clone">
              <label htmlFor="dlg-clone" className="block text-sm text-slate-400 mb-1">New VM Name</label>
              <input id="dlg-clone" type="text" autoFocus value={cloneName} onChange={(e) => setCloneName(e.target.value)} className="input-field" placeholder="my-vm-clone" />
              <label htmlFor="dlg-clone-mode" className="block text-sm text-slate-400 mb-1 mt-3">Disk mode</label>
              <select id="dlg-clone-mode" className="input-field" value={cloneMode} onChange={(e) => setCloneMode(e.target.value as 'linked' | 'full' | 'xml')}>
                <option value="linked">Linked clone (qcow2 backing file)</option>
                <option value="full">Full clone (independent copy)</option>
                <option value="xml">XML only (shared disk — not recommended)</option>
              </select>
              <p className="text-xs text-slate-500 mt-2">Linked and full clones create a new disk image and new MAC addresses. Linked shares blocks with the source until written.</p>
            </DialogBox>
          )}

          {dialog === 'rename' && (
            <DialogBox title="Rename VM" icon={<Pencil className={`w-5 h-5 ${statusToneClass('warn')}`} />} onClose={() => setDialog(null)} onConfirm={handleRename} confirmLabel="Rename">
              <label htmlFor="dlg-rename" className="block text-sm text-slate-400 mb-1">New Name</label>
              <input id="dlg-rename" type="text" autoFocus value={newName} onChange={(e) => setNewName(e.target.value)} className="input-field" />
              <p className="text-xs text-slate-500 mt-2">VM must be shut off to rename.</p>
            </DialogBox>
          )}

          {dialog === 'migrate' && (
            <DialogBox title="Migrate VM" icon={<ArrowRightLeft className="w-5 h-5 text-cyan-400" />} onClose={() => setDialog(null)} onConfirm={handleMigrate} confirmLabel="Migrate">
              <label htmlFor="dlg-migrate" className="block text-sm text-slate-400 mb-1">Destination URI</label>
              <input id="dlg-migrate" type="text" autoFocus value={migrateUri} onChange={(e) => setMigrateUri(e.target.value)} className="input-field" placeholder="qemu+ssh://host/system" />
              <div className="flex items-center gap-2 mt-3">
                <input id="dlg-live" type="checkbox" checked={migrateLive} onChange={(e) => setMigrateLive(e.target.checked)} className="rounded border-slate-600 bg-slate-900" />
                <label htmlFor="dlg-live" className="text-sm text-slate-300">Live migration (minimal downtime)</label>
              </div>
              <label htmlFor="dlg-mig-bw" className="block text-sm text-slate-400 mb-1 mt-3">Bandwidth limit (MiB/s, optional)</label>
              <input id="dlg-mig-bw" type="number" min={1} className="input-field" value={migrateBandwidth} onChange={(e) => setMigrateBandwidth(e.target.value)} placeholder="e.g. 200" />
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 mt-3 text-sm text-slate-300">
                <label className="flex items-center gap-2 cursor-pointer">
                  <input type="checkbox" checked={migrateUnsafe} onChange={(e) => setMigrateUnsafe(e.target.checked)} className="rounded border-slate-600 bg-slate-900" />
                  Unsafe migration
                </label>
                <label className="flex items-center gap-2 cursor-pointer">
                  <input type="checkbox" checked={migratePostcopy} onChange={(e) => setMigratePostcopy(e.target.checked)} className="rounded border-slate-600 bg-slate-900" />
                  Post-copy
                </label>
                <label className="flex items-center gap-2 cursor-pointer">
                  <input type="checkbox" checked={migrateTunnelled} onChange={(e) => setMigrateTunnelled(e.target.checked)} className="rounded border-slate-600 bg-slate-900" />
                  Tunnelled
                </label>
              </div>
              <p className="text-xs text-slate-500 mt-2">Allowed URI schemes: qemu://, qemu+ssh://, qemu+tcp://, qemu+tls://, qemu+unix://</p>
            </DialogBox>
          )}

          {dialog === 'snapshot' && (
            <DialogBox
              title="Create Snapshot"
              icon={<Camera className={`w-5 h-5 ${statusToneClass('ok')}`} />}
              onClose={() => {
                setDialog(null)
                setSnapDiskOnly(false)
                setSnapStorageMode('auto')
                setSnapAtomic(true)
                setSnapReuseExternal(false)
                setSnapExternalDiskDir('')
                setSnapExternalMemoryDir('')
                setSnapMemorySnapshot('')
                setSnapMemoryFile('')
                setSnapDisks([])
              }}
              onConfirm={handleCreateSnapshot}
              confirmLabel="Create"
            >
              <label htmlFor="dlg-snap-name" className="block text-sm text-slate-400 mb-1">Snapshot Name</label>
              <input id="dlg-snap-name" type="text" autoFocus value={snapName} onChange={(e) => setSnapName(e.target.value)} className="input-field" placeholder="before-upgrade" />
              <label htmlFor="dlg-snap-desc" className="block text-sm text-slate-400 mb-1 mt-3">Description (optional)</label>
              <input id="dlg-snap-desc" type="text" value={snapDesc} onChange={(e) => setSnapDesc(e.target.value)} className="input-field" placeholder="Snapshot before kernel upgrade" />

              <label htmlFor="dlg-snap-mode" className="block text-sm text-slate-400 mb-1 mt-3">Storage mode</label>
              <select id="dlg-snap-mode" value={snapStorageMode} onChange={(e) => setSnapStorageMode(e.target.value as 'auto' | 'external' | 'internal')} className="input-field">
                <option value="auto">Auto (Cockpit-style: external on new libvirt)</option>
                <option value="external">External (overlay files)</option>
                <option value="internal">Internal (qcow2 only)</option>
              </select>

              <div className="flex items-center gap-2 mt-3">
                <input id="dlg-snap-disk-only" type="checkbox" checked={snapDiskOnly} onChange={(e) => setSnapDiskOnly(e.target.checked)} className="rounded border-slate-600 bg-slate-900" />
                <label htmlFor="dlg-snap-disk-only" className="text-sm text-slate-300">Disk-only snapshot (faster, no memory state)</label>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mt-3">
                <label className="flex items-center gap-2 cursor-pointer text-sm text-slate-300">
                  <input type="checkbox" checked={snapAtomic} onChange={(e) => setSnapAtomic(e.target.checked)} className="rounded border-slate-600 bg-slate-900" />
                  Atomic (all-or-nothing)
                </label>
                <label className="flex items-center gap-2 cursor-pointer text-sm text-slate-300">
                  <input type="checkbox" checked={snapReuseExternal} onChange={(e) => setSnapReuseExternal(e.target.checked)} className="rounded border-slate-600 bg-slate-900" />
                  Reuse existing external files (dangerous)
                </label>
              </div>

              {(snapStorageMode === 'external' || snapStorageMode === 'auto') && (
                <div className="mt-4 space-y-3">
                  <div>
                    <label htmlFor="dlg-snap-diskdir" className="block text-sm text-slate-400 mb-1">External disk snapshot directory (optional)</label>
                    <input
                      id="dlg-snap-diskdir"
                      type="text"
                      value={snapExternalDiskDir}
                      onChange={(e) => setSnapExternalDiskDir(e.target.value)}
                      className="input-field"
                      placeholder="Leave empty to let libvirt auto-generate"
                    />
                    <p className="text-xs text-slate-500 mt-1">If set, Machina generates per-disk overlay files under this directory.</p>
                  </div>

                  {!snapDiskOnly && vm?.state === 'running' && (
                    <div className="space-y-2">
                      <div>
                        <label htmlFor="dlg-snap-mem-mode" className="block text-sm text-slate-400 mb-1">Memory snapshot</label>
                        <select
                          id="dlg-snap-mem-mode"
                          value={snapMemorySnapshot}
                          onChange={(e) => setSnapMemorySnapshot(e.target.value as 'internal' | 'external' | '')}
                          className="input-field"
                        >
                          <option value="">Default (match storage mode)</option>
                          <option value="external">External (memory saved to file)</option>
                          <option value="internal">Internal</option>
                        </select>
                      </div>

                      {((snapMemorySnapshot || (snapStorageMode === 'external' ? 'external' : '')) === 'external') && (
                        <>
                          <div>
                            <label htmlFor="dlg-snap-memfile" className="block text-sm text-slate-400 mb-1">Memory file (optional)</label>
                            <input
                              id="dlg-snap-memfile"
                              type="text"
                              value={snapMemoryFile}
                              onChange={(e) => setSnapMemoryFile(e.target.value)}
                              className="input-field"
                              placeholder="Leave empty to auto-generate under an allowed image directory"
                            />
                          </div>
                          <div>
                            <label htmlFor="dlg-snap-memdir" className="block text-sm text-slate-400 mb-1">External memory directory (optional)</label>
                            <input
                              id="dlg-snap-memdir"
                              type="text"
                              value={snapExternalMemoryDir}
                              onChange={(e) => setSnapExternalMemoryDir(e.target.value)}
                              className="input-field"
                              placeholder="If set and memory file is empty, Machina generates memory file here"
                            />
                          </div>
                        </>
                      )}
                    </div>
                  )}
                </div>
              )}

              <div className="mt-5">
                <div className="flex items-center justify-between gap-2 mb-2">
                  <span className="text-sm font-semibold text-slate-200">Per-disk options</span>
                  <div className="flex gap-2">
                    <button
                      type="button"
                      onClick={() => setSnapDisks((p) => p.map((d) => ({ ...d, snapshot: 'external', driver: d.driver || 'qcow2' })))}
                      className="px-2 py-1 bg-slate-700 hover:bg-slate-600 rounded text-xs transition"
                    >
                      All external
                    </button>
                    <button
                      type="button"
                      onClick={() => setSnapDisks((p) => p.map((d) => ({ ...d, snapshot: 'no', file: '' })))}
                      className="px-2 py-1 bg-slate-700 hover:bg-slate-600 rounded text-xs transition"
                    >
                      All no
                    </button>
                  </div>
                </div>

                {snapDisks.length === 0 ? (
                  <div className="text-xs text-slate-500">No disks detected for this VM.</div>
                ) : (
                  <div className="space-y-2">
                    {snapDisks.map((d, idx) => {
                      const mode = (d.snapshot || '').toString()
                      const isExternal = mode === 'external' || mode === ''
                      return (
                        <div key={`${d.name}-${idx}`} className="p-3 bg-slate-900/60 border border-slate-700/60 rounded-lg">
                          <div className="flex flex-wrap items-end gap-2">
                            <div className="min-w-[90px]">
                              <label className="block text-xs text-slate-500 mb-1">Disk</label>
                              <div className="text-sm font-mono text-slate-200">{d.name}</div>
                            </div>
                            <div className="min-w-[160px]">
                              <label className="block text-xs text-slate-500 mb-1">Snapshot</label>
                              <select
                                aria-label="Snapshot mode"
                                value={d.snapshot || ''}
                                onChange={(e) => {
                                  const v = e.target.value
                                  setSnapDisks((p) => p.map((x, j) => (j === idx ? { ...x, snapshot: v, file: v === 'external' ? x.file : '' } : x)))
                                }}
                                className="input-field"
                              >
                                <option value="external">external</option>
                                <option value="internal">internal</option>
                                <option value="no">no</option>
                                <option value="manual">manual</option>
                              </select>
                            </div>
                            <div className="flex-1 min-w-[240px]">
                              <label className="block text-xs text-slate-500 mb-1">External file override (optional)</label>
                              <input
                                value={d.file || ''}
                                onChange={(e) => setSnapDisks((p) => p.map((x, j) => (j === idx ? { ...x, file: e.target.value } : x)))}
                                className="input-field"
                                disabled={!isExternal}
                                placeholder={isExternal ? "Leave empty for auto / dir-based generation" : "Disabled (not external)"}
                              />
                            </div>
                            <div className="min-w-[120px]">
                              <label className="block text-xs text-slate-500 mb-1">Driver</label>
                              <input
                                value={d.driver || ''}
                                onChange={(e) => setSnapDisks((p) => p.map((x, j) => (j === idx ? { ...x, driver: e.target.value } : x)))}
                                className="input-field"
                                disabled={!isExternal}
                                placeholder="qcow2"
                              />
                            </div>
                          </div>
                        </div>
                      )
                    })}
                  </div>
                )}
              </div>
            </DialogBox>
          )}

          {dialog === 'boot-order' && (
            <DialogBox title="Edit Boot Order" icon={<Settings className="w-5 h-5 text-orange-400" />} onClose={() => setDialog(null)} onConfirm={handleSetBootOrder} confirmLabel="Save">
              <p className="text-sm text-slate-400 mb-3">Drag to reorder boot devices. VM must be restarted for changes to take effect.</p>
              <div className="space-y-2">
                {bootDevices.map((dev, i) => (
                  <div key={dev} className="flex items-center gap-2 bg-slate-900 border border-slate-700 rounded-lg px-3 py-2">
                    <span className="text-xs text-slate-500 w-4">{i + 1}.</span>
                    <span className="flex-1 text-sm font-medium">{dev}</span>
                    <button onClick={() => moveBootDevice(i, -1)} disabled={i === 0} className="p-0.5 hover:bg-slate-700 rounded disabled:opacity-30" aria-label="Move up"><ChevronUp className="w-4 h-4" /></button>
                    <button onClick={() => moveBootDevice(i, 1)} disabled={i === bootDevices.length - 1} className="p-0.5 hover:bg-slate-700 rounded disabled:opacity-30" aria-label="Move down"><ChevronDown className="w-4 h-4" /></button>
                    <button onClick={() => setBootDevices(bootDevices.filter((_, j) => j !== i))} className="p-0.5 hover:bg-red-600/20 rounded" aria-label="Remove"><X className={`w-4 h-4 ${statusToneClass('error')}`} /></button>
                  </div>
                ))}
              </div>
              <div className="flex gap-2 mt-3">
                {['hd', 'cdrom', 'network', 'fd'].filter(d => !bootDevices.includes(d)).map(d => (
                  <button key={d} onClick={() => setBootDevices([...bootDevices, d])} className="px-2 py-1 bg-slate-900 border border-slate-700 rounded text-xs hover:bg-slate-700 transition">+ {d}</button>
                ))}
              </div>
            </DialogBox>
          )}

          {dialog === 'cdrom' && (() => {
            const cdromDisks = vm?.disks.filter(d => d.device === 'cdrom') || []
            return (
            <DialogBox title="CD-ROM Management" icon={<Disc className={`w-5 h-5 ${statusToneClass('info')}`} />} onClose={() => setDialog(null)} onConfirm={handleInsertCdrom} confirmLabel="Mount ISO">
              {/* Show existing CD-ROM devices */}
              {cdromDisks.length > 0 && (
                <div className="mb-4 p-3 bg-slate-900 rounded-lg border border-slate-700">
                  <span className="text-xs text-slate-500 block mb-2">Current CD-ROM devices:</span>
                  {cdromDisks.map((d) => (
                    <div key={d.target} className="flex items-center justify-between py-1">
                      <span className="text-sm"><span className={`font-mono ${statusToneClass('info')}`}>{d.target}</span> {d.source ? <span className="text-slate-400 text-xs ml-2">{d.source.split('/').pop()}</span> : <span className="text-slate-500 text-xs ml-2">(empty)</span>}</span>
                      {d.source && <button onClick={() => { if (name) { ejectCdrom(name, d.target, conn).then(() => { toast.success('CD-ROM ejected'); setDialog(null); load() }).catch((e: unknown) => toast.error(`Eject failed: ${formatUserError(e)}`)) } }} className={`px-2 py-0.5 rounded text-xs transition ${statusBadgeClasses('error')}`}>Eject</button>}
                    </div>
                  ))}
                </div>
              )}
              {cdromDisks.length === 0 && (
                <div className={`mb-3 p-2 rounded-lg text-xs ${statusSurfaceClasses('info')}`}>
                  No CD-ROM drive found. A new one will be attached automatically.
                </div>
              )}
              <label htmlFor="dlg-iso" className="block text-sm text-slate-400 mb-1">ISO File</label>
              <div className="space-y-2">
                {isoFiles.length > 0 ? (
                  <select id="dlg-iso" autoFocus value={cdromPath} onChange={(e) => setCdromPath(e.target.value)} className="input-field">
                    <option value="">Select ISO (from scan)…</option>
                    {isoFiles.map((f) => (
                      <option key={f.path} value={f.path}>
                        {f.name} ({(f.size_bytes / 1048576).toFixed(0)} MB)
                      </option>
                    ))}
                  </select>
                ) : null}
                <div className="flex gap-2">
                  <input
                    id="dlg-iso"
                    type="text"
                    autoFocus={isoFiles.length === 0}
                    value={cdromPath}
                    onChange={(e) => setCdromPath(e.target.value)}
                    placeholder="/var/lib/libvirt/images/image.iso"
                    className="input-field flex-1 min-w-0"
                  />
                  <button
                    type="button"
                    className="shrink-0 inline-flex items-center gap-1.5 px-3 py-2 rounded-lg border border-slate-600 bg-slate-700/50 hover:bg-slate-700 disabled:opacity-50 text-sm text-slate-200 transition"
                    onClick={() => {
                      if (canBrowseHost) setCdromBrowseOpen(true)
                    }}
                    disabled={!canBrowseHost}
                    title={!canBrowseHost ? 'Browsing host paths requires the admin role' : undefined}
                  >
                    <FolderOpen className="w-4 h-4" aria-hidden />
                    Browse
                  </button>
                </div>
              </div>
              <label htmlFor="dlg-cdtarget" className="block text-sm text-slate-400 mb-1 mt-3">Target Device</label>
              <select id="dlg-cdtarget" value={cdromTarget} onChange={(e) => setCdromTarget(e.target.value)} className="input-field">
                {cdromDisks.length > 0
                  ? cdromDisks.map(d => <option key={d.target} value={d.target}>{d.target}</option>)
                  : <><option value="sda">sda</option><option value="sdb">sdb</option><option value="hda">hda</option></>
                }
              </select>
              <p className="text-xs text-slate-500 mt-2">Enter the full path to an ISO file on the host. The VM {vm?.state === 'running' ? 'will see the change immediately' : 'will see it on next start'}.</p>
            </DialogBox>
            )
          })()}

          {dialog === 'attach-disk' && (
            <DialogBox title="Attach Disk" icon={<HardDrive className={`w-5 h-5 ${statusToneClass('info')}`} />} onClose={() => setDialog(null)} onConfirm={handleAttachDisk} confirmLabel="Attach">
              <label htmlFor="dlg-disk-src" className="block text-sm text-slate-400 mb-1">Disk Image Path</label>
              <div className="flex gap-2">
                <input
                  id="dlg-disk-src"
                  type="text"
                  autoFocus
                  value={attachSource}
                  onChange={(e) => setAttachSource(e.target.value)}
                  placeholder="/var/lib/libvirt/images/data.qcow2"
                  className="input-field flex-1 min-w-0"
                />
                <button
                  type="button"
                  className="shrink-0 inline-flex items-center gap-1.5 px-3 py-2 rounded-lg border border-slate-600 bg-slate-700/50 hover:bg-slate-700 disabled:opacity-50 text-sm text-slate-200 transition"
                  onClick={() => {
                    if (canBrowseHost) setAttachDiskBrowseOpen(true)
                  }}
                  disabled={!canBrowseHost}
                  title={!canBrowseHost ? 'Browsing host paths requires the admin role' : undefined}
                >
                  <FolderOpen className="w-4 h-4" aria-hidden />
                  Browse
                </button>
              </div>
              <div className="grid grid-cols-2 gap-3 mt-3">
                <div>
                  <label htmlFor="dlg-disk-target" className="block text-sm text-slate-400 mb-1">Target Device</label>
                  <input id="dlg-disk-target" type="text" value={attachTarget} onChange={(e) => setAttachTarget(e.target.value)} className="input-field" />
                </div>
                <div>
                  <label htmlFor="dlg-disk-driver" className="block text-sm text-slate-400 mb-1">Driver</label>
                  <select id="dlg-disk-driver" value={attachDriver} onChange={(e) => setAttachDriver(e.target.value)} className="input-field">
                    <option value="qcow2">qcow2</option>
                    <option value="raw">raw</option>
                  </select>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3 mt-3">
                <div>
                  <label htmlFor="dlg-disk-bus" className="block text-sm text-slate-400 mb-1">Bus</label>
                  <select id="dlg-disk-bus" value={attachBus} onChange={(e) => setAttachBus(e.target.value)} className="input-field">
                    <option value="virtio">virtio</option>
                    <option value="sata">sata</option>
                    <option value="scsi">scsi</option>
                    <option value="ide">ide</option>
                  </select>
                </div>
                <div>
                  <label htmlFor="dlg-disk-cache" className="block text-sm text-slate-400 mb-1">Cache (optional)</label>
                  <select id="dlg-disk-cache" value={attachCache} onChange={(e) => setAttachCache(e.target.value)} className="input-field">
                    <option value="">default</option>
                    <option value="none">none</option>
                    <option value="writethrough">writethrough</option>
                    <option value="writeback">writeback</option>
                  </select>
                </div>
                <div>
                  <label htmlFor="dlg-disk-discard" className="block text-sm text-slate-400 mb-1">Discard (optional)</label>
                  <select id="dlg-disk-discard" value={attachDiscard} onChange={(e) => setAttachDiscard(e.target.value)} className="input-field">
                    <option value="">—</option>
                    <option value="unmap">unmap</option>
                    <option value="ignore">ignore</option>
                  </select>
                </div>
                <div className="flex flex-col gap-2 justify-center">
                  <label className="flex items-center gap-2 text-sm text-slate-300 cursor-pointer">
                    <input type="checkbox" checked={attachReadonly} onChange={(e) => setAttachReadonly(e.target.checked)} className="rounded border-slate-600 bg-slate-900" />
                    Read-only
                  </label>
                  <label className="flex items-center gap-2 text-sm text-slate-300 cursor-pointer">
                    <input type="checkbox" checked={attachShareable} onChange={(e) => setAttachShareable(e.target.checked)} className="rounded border-slate-600 bg-slate-900" />
                    Shareable
                  </label>
                </div>
              </div>
            </DialogBox>
          )}

          {dialog === 'disk-tune' && (
            <DialogBox title={`Tune disk ${tuneDiskTarget}`} icon={<Sliders className={`w-5 h-5 ${statusToneClass('warn')}`} />} onClose={() => setDialog(null)} onConfirm={handleDiskTune} confirmLabel="Apply">
              <p className="text-xs text-slate-500 mb-2">Leave fields empty to skip. Readonly/shareable: choose “no change”, on, or off.</p>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-sm text-slate-400 mb-1">Bus</label>
                  <select aria-label="Bus" value={tuneBus} onChange={(e) => setTuneBus(e.target.value)} className="input-field">
                    <option value="">no change</option>
                    <option value="virtio">virtio</option>
                    <option value="sata">sata</option>
                    <option value="scsi">scsi</option>
                    <option value="ide">ide</option>
                  </select>
                </div>
                <div>
                  <label className="block text-sm text-slate-400 mb-1">Cache</label>
                  <select aria-label="Cache" value={tuneCache} onChange={(e) => setTuneCache(e.target.value)} className="input-field">
                    <option value="">no change</option>
                    <option value="none">none</option>
                    <option value="writethrough">writethrough</option>
                    <option value="writeback">writeback</option>
                  </select>
                </div>
                <div>
                  <label className="block text-sm text-slate-400 mb-1">Discard</label>
                  <select aria-label="Discard" value={tuneDiscard} onChange={(e) => setTuneDiscard(e.target.value)} className="input-field">
                    <option value="">no change</option>
                    <option value="unmap">unmap</option>
                    <option value="ignore">ignore</option>
                  </select>
                </div>
                <div>
                  <label className="block text-sm text-slate-400 mb-1">Read-only</label>
                  <select aria-label="Read-only" value={tuneRo} onChange={(e) => setTuneRo(e.target.value)} className="input-field">
                    <option value="">no change</option>
                    <option value="true">yes</option>
                    <option value="false">no</option>
                  </select>
                </div>
                <div>
                  <label className="block text-sm text-slate-400 mb-1">Shareable</label>
                  <select aria-label="Shareable" value={tuneShare} onChange={(e) => setTuneShare(e.target.value)} className="input-field">
                    <option value="">no change</option>
                    <option value="true">yes</option>
                    <option value="false">no</option>
                  </select>
                </div>
              </div>
            </DialogBox>
          )}

          {dialog === 'nic-tune' && (
            <DialogBox title="Tune network interface" icon={<Sliders className={`w-5 h-5 ${statusToneClass('warn')}`} />} onClose={() => setDialog(null)} onConfirm={handleNicTune} confirmLabel="Apply">
              <p className="text-xs text-slate-500 mb-2 font-mono">{tuneMac}</p>
              <label className="block text-sm text-slate-400 mb-1">Model</label>
              <select aria-label="NIC model" value={tuneNicModel} onChange={(e) => setTuneNicModel(e.target.value)} className="input-field">
                <option value="virtio">virtio</option>
                <option value="e1000">e1000</option>
                <option value="e1000e">e1000e</option>
                <option value="rtl8139">rtl8139</option>
                <option value="vmxnet3">vmxnet3</option>
              </select>
              <label className="block text-sm text-slate-400 mb-1 mt-3">Libvirt network name</label>
              <input type="text" value={tuneNicNet} onChange={(e) => setTuneNicNet(e.target.value)} className="input-field" placeholder="default" />
            </DialogBox>
          )}

          {dialog === 'firmware' && (
            <DialogBox title="Guest firmware" icon={<Settings className="w-5 h-5 text-orange-400" />} onClose={() => setDialog(null)} onConfirm={handleFirmwareSet} confirmLabel="Apply">
              <p className={`text-xs mb-2 ${statusToneClass('warn')}`}>Changing firmware can make a guest unbootable if disk layout/OS does not match. Prefer shutoff VMs.</p>
              <select aria-label="Firmware type" value={fwChoice} onChange={(e) => setFwChoice(e.target.value as 'bios' | 'uefi')} className="input-field">
                <option value="bios">BIOS (SeaBIOS)</option>
                <option value="uefi">UEFI (OVMF)</option>
              </select>
            </DialogBox>
          )}

          {dialog === 'watchdog' && (
            <DialogBox title="Attach watchdog" icon={<Settings className={`w-5 h-5 ${statusToneClass('error')}`} />} onClose={() => setDialog(null)} onConfirm={handleWatchdogAttach} confirmLabel="Attach">
              <label className="block text-sm text-slate-400 mb-1">Model</label>
              <select aria-label="Watchdog model" value={wdModel} onChange={(e) => setWdModel(e.target.value)} className="input-field">
                <option value="i6300esb">i6300esb</option>
                <option value="ib700">ib700</option>
                <option value="diag288">diag288</option>
              </select>
              <label className="block text-sm text-slate-400 mb-1 mt-3">Action</label>
              <select aria-label="Watchdog action" value={wdAction} onChange={(e) => setWdAction(e.target.value)} className="input-field">
                <option value="reset">reset</option>
                <option value="shutdown">shutdown</option>
                <option value="poweroff">poweroff</option>
                <option value="pause">pause</option>
                <option value="none">none</option>
                <option value="dump">dump</option>
              </select>
            </DialogBox>
          )}

          {dialog === 'sound' && (
            <DialogBox title="Attach sound" icon={<Settings className="w-5 h-5 text-cyan-400" />} onClose={() => setDialog(null)} onConfirm={handleSoundAttach} confirmLabel="Attach">
              <select aria-label="Sound model" value={sndModel} onChange={(e) => setSndModel(e.target.value)} className="input-field">
                <option value="ich6">ich6 (Intel HD Audio)</option>
                <option value="ich9">ich9</option>
                <option value="ac97">ac97</option>
              </select>
            </DialogBox>
          )}

          {dialog === 'serial' && (
            <DialogBox title="Extra serial + console" icon={<Terminal className={`w-5 h-5 ${statusToneClass('info')}`} />} onClose={() => setDialog(null)} onConfirm={handleSerialAttach} confirmLabel="Attach">
              <label className="block text-sm text-slate-400 mb-1">Guest serial port index</label>
              <input type="number" min={1} max={32} value={serPort} onChange={(e) => setSerPort(parseInt(e.target.value, 10) || 1)} className="input-field" />
              <p className="text-xs text-slate-500 mt-2">Adds PTY serial and matching console (e.g. 1 → ttyS1).</p>
            </DialogBox>
          )}

          {dialog === 'video' && (
            <DialogBox title="Video model" icon={<Monitor className="w-5 h-5 text-purple-400" />} onClose={() => setDialog(null)} onConfirm={handleVideoSet} confirmLabel="Apply">
              <select aria-label="Video model" value={vidModel} onChange={(e) => setVidModel(e.target.value)} className="input-field">
                <option value="qxl">qxl (SPICE)</option>
                <option value="virtio">virtio</option>
                <option value="vga">vga</option>
                <option value="bochs">bochs</option>
                <option value="cirrus">cirrus</option>
              </select>
            </DialogBox>
          )}

          {dialog === 'resize-disk' && (
            <DialogBox title={`Resize Disk (${resizeTarget})`} icon={<HardDrive className={`w-5 h-5 ${statusToneClass('ok')}`} />} onClose={() => setDialog(null)} onConfirm={handleResizeDisk} confirmLabel="Resize">
              <label htmlFor="dlg-resize" className="block text-sm text-slate-400 mb-1">New Size (GB)</label>
              <input id="dlg-resize" type="number" min={1} max={10240} autoFocus value={resizeGb} onChange={(e) => setResizeGb(parseInt(e.target.value) || 1)} className="input-field" />
              <p className="text-xs text-slate-500 mt-2">Can only grow, not shrink. VM must be running with guest agent or shut off.</p>
            </DialogBox>
          )}

          {dialog === 'attach-nic' && (
            <DialogBox title="Add Network Interface" icon={<Network className="w-5 h-5 text-cyan-400" />} onClose={() => setDialog(null)} onConfirm={handleAttachNic} confirmLabel="Attach">
              <label htmlFor="dlg-nic-net" className="block text-sm text-slate-400 mb-1">Network</label>
              {networks.length > 0 ? (
                <select id="dlg-nic-net" autoFocus value={nicNetwork} onChange={(e) => setNicNetwork(e.target.value)} className="input-field">
                  {networks.map(n => <option key={n.name} value={n.name}>{n.name}{n.active ? '' : ' (inactive)'}</option>)}
                </select>
              ) : (
                <input id="dlg-nic-net" type="text" autoFocus value={nicNetwork} onChange={(e) => setNicNetwork(e.target.value)} className="input-field" placeholder="default" />
              )}
              <label htmlFor="dlg-nic-model" className="block text-sm text-slate-400 mb-1 mt-3">Model</label>
              <select id="dlg-nic-model" value={nicModel} onChange={(e) => setNicModel(e.target.value)} className="input-field">
                <option value="virtio">virtio</option>
                <option value="e1000">e1000</option>
                <option value="rtl8139">rtl8139</option>
              </select>
            </DialogBox>
          )}

          {dialog === 'save-template' && (
            <DialogBox title="Save as Template" icon={<Layers className="w-5 h-5 text-purple-400" />} onClose={() => setDialog(null)} onConfirm={handleSaveTemplate} confirmLabel="Save">
              <label htmlFor="dlg-template-name" className="block text-sm text-slate-400 mb-1">Template Name</label>
              <input id="dlg-template-name" type="text" autoFocus value={templateName} onChange={(e) => setTemplateName(e.target.value)} className="input-field" placeholder="my-vm-template" />
              <p className="text-xs text-slate-500 mt-2">Saves the VM configuration as a reusable template. Disk images are not included.</p>
            </DialogBox>
          )}

          {dialog === 'delete-vm' && (
            <DialogBox
              title="Delete VM permanently"
              icon={<Trash2 className={`w-5 h-5 ${statusToneClass('error')}`} />}
              onClose={() => setDialog(null)}
              onConfirm={handleDeleteVm}
              confirmLabel="Delete"
              confirmDanger
              confirmDisabled={!vm?.name || deleteVmTypeConfirm !== vm.name}
            >
              <p className="text-sm text-slate-300 mb-3">
                This will stop <strong>{vm?.name}</strong> if running, then remove the libvirt definition.
              </p>

              {/* Disk deletion */}
              <div className={`rounded-lg border p-3 mb-3 ${deleteUndefine.delete_disks ? statusSurfaceClasses('error') : 'border-slate-700/50 bg-slate-800/40'}`}>
                <label className="flex items-start gap-2.5 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={!!deleteUndefine.delete_disks}
                    onChange={(e) => setDeleteUndefine(o => ({ ...o, delete_disks: e.target.checked }))}
                    className="mt-0.5 accent-red-500 w-4 h-4 shrink-0"
                  />
                  <div>
                    <span className="text-sm font-medium text-slate-200">Also delete disk image files</span>
                    <p className="text-xs text-slate-400 mt-0.5">Permanently removes the backing <code>.qcow2</code> / <code>.raw</code> files from the host. Cannot be undone.</p>
                    {deleteUndefine.delete_disks && vm?.disks && vm.disks.filter(d => d.device === 'disk').length > 0 && (
                      <ul className="mt-1.5 space-y-0.5">
                        {vm.disks.filter(d => d.device === 'disk').map(d => (
                          <li key={d.target} className={`flex items-center gap-1.5 text-xs font-mono ${statusToneClass('error')}`}>
                            <HardDrive className="w-3 h-3 shrink-0" />
                            {d.source}
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                </label>
              </div>

              <label htmlFor="dlg-delete-vm-confirm" className="block text-xs text-slate-400 mb-1">
                Type the VM name <span className="font-mono text-slate-200">{vm?.name}</span> to confirm:
              </label>
              <input
                id="dlg-delete-vm-confirm"
                type="text"
                autoComplete="off"
                spellCheck={false}
                value={deleteVmTypeConfirm}
                onChange={(e) => setDeleteVmTypeConfirm(e.target.value)}
                className="input-field font-mono text-sm"
                placeholder={vm?.name}
              />
            </DialogBox>
          )}

          {dialog === 'scheduler-tune' && (
            <DialogBox title="Scheduler tuning" icon={<Cpu className={`w-5 h-5 ${statusToneClass('info')}`} />} onClose={() => setDialog(null)} onConfirm={handleSchedulerSave} confirmLabel="Apply">
              <p className="text-xs text-slate-500 mb-3">Only filled fields are sent; others stay unchanged in libvirt.</p>
              <label className="block text-sm text-slate-400 mb-1">cpu_shares</label>
              <input className="input-field mb-2" value={schedShares} onChange={(e) => setSchedShares(e.target.value)} placeholder="e.g. 1024" />
              <label className="block text-sm text-slate-400 mb-1">vcpu_period (µs)</label>
              <input className="input-field mb-2" value={schedPeriod} onChange={(e) => setSchedPeriod(e.target.value)} />
              <label className="block text-sm text-slate-400 mb-1">vcpu_quota (µs)</label>
              <input className="input-field" value={schedQuota} onChange={(e) => setSchedQuota(e.target.value)} />
            </DialogBox>
          )}

          {dialog === 'memtune' && (
            <DialogBox title="Memory tuning (KiB)" icon={<MemoryStick className="w-5 h-5 text-purple-400" />} onClose={() => setDialog(null)} onConfirm={handleMemtuneSave} confirmLabel="Apply">
              <p className="text-xs text-slate-500 mb-3">Values are KiB (same unit as libvirt memtune XML). Leave blank to leave unchanged.</p>
              <label className="block text-sm text-slate-400 mb-1">hard_limit_kb</label>
              <input className="input-field mb-2" value={memHardKb} onChange={(e) => setMemHardKb(e.target.value)} />
              <label className="block text-sm text-slate-400 mb-1">soft_limit_kb</label>
              <input className="input-field mb-2" value={memSoftKb} onChange={(e) => setMemSoftKb(e.target.value)} />
              <label className="block text-sm text-slate-400 mb-1">swap_hard_limit_kb</label>
              <input className="input-field" value={memSwapKb} onChange={(e) => setMemSwapKb(e.target.value)} />
            </DialogBox>
          )}

          {dialog === 'numa-tune' && (
            <DialogBox title="NUMA memory tuning" icon={<Cpu className="w-5 h-5 text-violet-400" />} onClose={() => setDialog(null)} onConfirm={() => void handleNumaSave()} confirmLabel="Apply">
              <p className="text-xs text-slate-500 mb-2">Maps to libvirt <code className="text-slate-400">numatune</code>. Mode is the raw libvirt mem mode integer; leave blank to skip updating mode.</p>
              <label className="block text-sm text-slate-400 mb-1">node_set (e.g. 0-1 or 0)</label>
              <input className="input-field mb-3" value={numaNodeSet} onChange={(e) => setNumaNodeSet(e.target.value)} placeholder="0" />
              <label className="block text-sm text-slate-400 mb-1">mode (optional)</label>
              <input className="input-field" value={numaModeInput} onChange={(e) => setNumaModeInput(e.target.value)} placeholder="strict / preferred / … as int" />
            </DialogBox>
          )}

          {dialog === 'emulator-pin' && (
            <DialogBox title="Pin QEMU emulator to host CPUs" icon={<Cpu className={`w-5 h-5 ${statusToneClass('warn')}`} />} onClose={() => setDialog(null)} onConfirm={() => void handleEmulatorPinSave()} confirmLabel="Apply">
              <p className="text-xs text-slate-500 mb-2">Host CPUs 0–63 (first 64 logical CPUs), same grid as vCPU pinning.</p>
              <div className="max-h-40 overflow-y-auto border border-slate-700 rounded p-2 grid grid-cols-8 gap-1">
                {emuPinMap.map((on, i) => (
                  <label key={i} className="flex items-center gap-1 text-[10px] text-slate-400 cursor-pointer">
                    <input type="checkbox" checked={on} onChange={(e) => setEmuPinMap((m) => { const n = [...m]; n[i] = e.target.checked; return n })} />
                    {i}
                  </label>
                ))}
              </div>
            </DialogBox>
          )}

          {dialog === 'pin-vcpu' && (
            <DialogBox title="Pin vCPU to host CPUs" icon={<Cpu className="w-5 h-5 text-cyan-400" />} onClose={() => setDialog(null)} onConfirm={handlePinSave} confirmLabel="Apply pin">
              <label className="block text-sm text-slate-400 mb-1">vCPU index</label>
              <input type="number" min={0} max={Math.max(0, (vm?.vcpus ?? 1) - 1)} className="input-field mb-3" value={pinVcpuN} onChange={(e) => setPinVcpuN(parseInt(e.target.value, 10) || 0)} />
              <p className="text-xs text-slate-500 mb-2">Host CPUs 0–63 (first 64 logical CPUs).</p>
              <div className="max-h-40 overflow-y-auto border border-slate-700 rounded p-2 grid grid-cols-8 gap-1">
                {pinMap.map((on, i) => (
                  <label key={i} className="flex items-center gap-1 text-[10px] text-slate-400 cursor-pointer">
                    <input type="checkbox" checked={on} onChange={(e) => setPinMap((m) => { const n = [...m]; n[i] = e.target.checked; return n })} />
                    {i}
                  </label>
                ))}
              </div>
            </DialogBox>
          )}

          {dialog === 'block-commit' && (
            <DialogBox title="Block commit" icon={<HardDrive className={`w-5 h-5 ${statusToneClass('info')}`} />} onClose={() => setDialog(null)} onConfirm={handleBlockCommit} confirmLabel="Start commit">
              <p className="text-xs text-slate-500 mb-2">Disk: <code className="text-slate-300">{blockDisk || '—'}</code></p>
              <label className="block text-sm text-slate-400 mb-1">Base (optional)</label>
              <input className="input-field mb-2" value={blockBase} onChange={(e) => setBlockBase(e.target.value)} placeholder="backing file name or leave empty" />
              <label className="block text-sm text-slate-400 mb-1">Top (optional)</label>
              <input className="input-field mb-2" value={blockTop} onChange={(e) => setBlockTop(e.target.value)} />
              <label className="flex items-center gap-2 text-sm text-slate-300 mb-1"><input type="checkbox" checked={blockShallow} onChange={(e) => setBlockShallow(e.target.checked)} /> Shallow</label>
              <label className="flex items-center gap-2 text-sm text-slate-300 mb-1"><input type="checkbox" checked={blockDelete} onChange={(e) => setBlockDelete(e.target.checked)} /> Delete merged images</label>
              <label className="flex items-center gap-2 text-sm text-slate-300"><input type="checkbox" checked={blockActive} onChange={(e) => setBlockActive(e.target.checked)} /> Active commit</label>
            </DialogBox>
          )}
        </DialogOverlay>
      )}

      {/* Confirmation Dialogs for destructive actions */}
      <ConfirmDialog
        open={detachDiskTarget !== null}
        title="Detach Disk"
        message={`This will detach disk '${detachDiskTarget}' from the VM. The disk image will not be deleted.`}
        confirmLabel="Detach"
        onConfirm={confirmDetachDisk}
        onCancel={() => setDetachDiskTarget(null)}
      />
      <ConfirmDialog
        open={detachNicMac !== null}
        title="Detach Network Interface"
        message={`This will remove the network interface with MAC '${detachNicMac}' from the VM.`}
        confirmLabel="Detach"
        onConfirm={confirmDetachNic}
        onCancel={() => setDetachNicMac(null)}
      />
      <ConfirmDialog
        open={deleteSnapName !== null}
        title="Delete Snapshot"
        message={`This will permanently delete snapshot '${deleteSnapName}'. This cannot be undone.`}
        confirmLabel="Delete"
        onConfirm={confirmDeleteSnapshot}
        onCancel={() => setDeleteSnapName(null)}
      />

      <VmSshConnectDialog
        open={sshDialogOpen}
        vmName={vm.name}
        platformVmId={platformVmId}
        defaultIp={classicGuestIp}
        defaultUser={classicSshUser}
        detectedIps={classicDetectedIps}
        hypervisorAddress={classicHypervisorAddress}
        guestIpPrivate={classicGuestAccess?.guest_ip_private}
        portForwardRules={classicPortForwards}
        onRefreshPortForwards={() => {
          if (!platformVmId) return
          void listVmPortForwards(platformVmId).then(setClassicPortForwards).catch(() => setClassicPortForwards([]))
        }}
        onClose={() => setSshDialogOpen(false)}
        onConnect={(h, u, p) => navigateVmSshSession(vm.name, h, u, platformVmId, p)}
        onNotify={(m) => toast.success(m)}
      />

      {kubevirtOpen && kubevirtBundle && (
        <div
          className="fixed inset-0 z-[95] flex items-center justify-center p-4 bg-black/60"
          role="dialog"
          aria-modal="true"
          aria-labelledby="kubevirt-export-title"
          onClick={(e) => {
            if (e.target === e.currentTarget) setKubevirtOpen(false)
          }}
        >
          <div
            className="bg-slate-900 border border-slate-600 rounded-xl shadow-xl w-full max-w-3xl max-h-[90vh] flex flex-col"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="p-4 border-b border-slate-700 flex items-center justify-between gap-2">
              <h2 id="kubevirt-export-title" className="text-lg font-semibold text-slate-100">
                KubeVirt migration bundle
              </h2>
              <button
                type="button"
                className="text-xs px-2 py-1 rounded bg-slate-800 hover:bg-slate-700 text-slate-300"
                onClick={() => setKubevirtOpen(false)}
              >
                Close
              </button>
            </div>
            <div className="p-4 overflow-y-auto space-y-3 text-sm text-slate-300">
              <p className="text-sm text-slate-300 leading-relaxed">
                Move this QEMU/KVM guest from the bare-metal libvirt host into a Kubernetes cluster: CDI upload DataVolume plus KubeVirt{' '}
                <code className="text-slate-200">VirtualMachine</code> YAML. When <code className="text-slate-200">[kubevirt] exec_enabled</code> is true, the buttons below run{' '}
                <code className="text-slate-200">virtctl</code>/<code className="text-slate-200">kubectl</code> on the daemon host.
              </p>
              <p className="text-xs text-slate-400">
                Libvirt root disk <code className="text-slate-200">{kubevirtBundle.libvirt_root_disk}</code> → DataVolume{' '}
                <code className="text-slate-200">{kubevirtBundle.datavolume_name}</code> / VM{' '}
                <code className="text-slate-200">{kubevirtBundle.virtual_machine_name}</code> in namespace{' '}
                <code className="text-slate-200">{kubevirtBundle.namespace}</code>. The VM includes a virtio-win CDROM via{' '}
                <code className="text-slate-200">containerDisk</code> (cluster pulls the image instead of attaching <code className="text-slate-200">virtio-win.iso</code> from the hypervisor). Override image in{' '}
                <code className="text-slate-200">[kubevirt] virtio_container_disk_image</code> in machina config.
              </p>
              <div className="rounded-lg border border-slate-700/60 bg-slate-950/40 p-3 space-y-2">
                <div className="text-xs font-medium text-slate-400 uppercase tracking-wide">Cluster steps (tick when done)</div>
                <label className="flex items-start gap-2 cursor-pointer text-xs text-slate-300">
                  <input
                    type="checkbox"
                    className="mt-0.5 rounded border-slate-600 bg-slate-900"
                    checked={kubevirtDoneUpload}
                    onChange={(e) => setKubevirtDoneUpload(e.target.checked)}
                  />
                  <span>
                    <strong className="text-slate-200">1.</strong> Run <code className="text-slate-400">virtctl image-upload …</code> on a machine with kubeconfig so the libvirt qcow2 fills the upload DataVolume.
                  </span>
                </label>
                <label className="flex items-start gap-2 cursor-pointer text-xs text-slate-300">
                  <input
                    type="checkbox"
                    className="mt-0.5 rounded border-slate-600 bg-slate-900"
                    checked={kubevirtDoneApply}
                    onChange={(e) => setKubevirtDoneApply(e.target.checked)}
                  />
                  <span>
                    <strong className="text-slate-200">2.</strong> <code className="text-slate-400">kubectl apply -f</code> the YAML (or paste from below).
                  </span>
                </label>
                <label className="flex items-start gap-2 cursor-pointer text-xs text-slate-300">
                  <input
                    type="checkbox"
                    className="mt-0.5 rounded border-slate-600 bg-slate-900"
                    checked={kubevirtDoneStart}
                    onChange={(e) => setKubevirtDoneStart(e.target.checked)}
                  />
                  <span className="flex-1 min-w-0">
                    <strong className="text-slate-200">3.</strong> Start the VM when ready:{' '}
                    <code className="text-slate-400 break-all">
                      virtctl start {kubevirtBundle.virtual_machine_name} -n {kubevirtBundle.namespace}
                    </code>
                    <button
                      type="button"
                      className="ml-2 text-violet-400 hover:text-violet-300 underline-offset-2 hover:underline"
                      onClick={() => {
                        const cmd = `virtctl start ${kubevirtBundle.virtual_machine_name} -n ${kubevirtBundle.namespace}`
                        void navigator.clipboard.writeText(cmd)
                        toast.success('virtctl start copied')
                      }}
                    >
                      Copy
                    </button>
                  </span>
                </label>
              </div>
              {kubevirtBundle.cluster_exec_enabled && (
                <div className="rounded-lg border border-violet-800/40 bg-violet-950/20 p-3 space-y-2">
                  <div className="text-xs font-medium text-violet-300 uppercase tracking-wide">Run on daemon host</div>
                  <p className="text-[11px] text-slate-400 leading-relaxed">
                    <code className="text-slate-300">[kubevirt] exec_enabled = true</code> — uses this machine&apos;s kubeconfig (set{' '}
                    <code className="text-slate-300">kubeconfig_path</code> in machina config if needed).{' '}
                    <strong className="text-slate-300">virtctl image-upload</strong> may run for a long time; the browser request blocks until it finishes.
                  </p>
                  <div className="flex flex-wrap gap-2">
                    <button
                      type="button"
                      disabled={kubevirtExecBusy !== null}
                      className="text-xs px-2 py-1 rounded bg-violet-900/80 hover:bg-violet-800 disabled:opacity-50 text-violet-100"
                      onClick={() => { void runKubevirtClusterStep('upload') }}
                    >
                      {kubevirtExecBusy === 'upload' ? 'Upload…' : 'virtctl image-upload'}
                    </button>
                    <button
                      type="button"
                      disabled={kubevirtExecBusy !== null}
                      className="text-xs px-2 py-1 rounded bg-violet-900/80 hover:bg-violet-800 disabled:opacity-50 text-violet-100"
                      onClick={() => { void runKubevirtClusterStep('apply') }}
                    >
                      {kubevirtExecBusy === 'apply' ? 'Apply…' : 'kubectl apply'}
                    </button>
                    <button
                      type="button"
                      disabled={kubevirtExecBusy !== null}
                      className="text-xs px-2 py-1 rounded bg-violet-900/80 hover:bg-violet-800 disabled:opacity-50 text-violet-100"
                      onClick={() => { void runKubevirtClusterStep('start') }}
                    >
                      {kubevirtExecBusy === 'start' ? 'Start…' : 'virtctl start'}
                    </button>
                  </div>
                  {kubevirtExecLast && (
                    <div className={`rounded-lg border p-2 ${statusSurfaceClasses(kubevirtExecLast.exit_code === 0 ? 'ok' : 'error')}`}>
                      <CollapsibleCodeBlock
                        title={`Last command: exit ${kubevirtExecLast.exit_code}`}
                        content={[
                          kubevirtExecLast.stderr?.trim() ? `stderr:\n${kubevirtExecLast.stderr}` : '',
                          kubevirtExecLast.stdout?.trim() ? `stdout:\n${kubevirtExecLast.stdout}` : '',
                        ].filter(Boolean).join('\n\n') || '(no output)'}
                        defaultOpen={kubevirtExecLast.exit_code !== 0}
                        maxHeight="max-h-32"
                      />
                    </div>
                  )}
                </div>
              )}
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  className="text-xs px-2 py-1 rounded bg-slate-800 hover:bg-slate-700 text-slate-200"
                  onClick={() => {
                    void navigator.clipboard.writeText(kubevirtBundle.yaml)
                    toast.success('YAML copied')
                  }}
                >
                  Copy YAML
                </button>
                <button
                  type="button"
                  className="text-xs px-2 py-1 rounded bg-slate-800 hover:bg-slate-700 text-slate-200"
                  onClick={() => {
                    void navigator.clipboard.writeText(kubevirtBundle.virtctl_image_upload_example)
                    toast.success('virtctl command copied')
                  }}
                >
                  Copy virtctl upload
                </button>
              </div>
              <CollapsibleCodeBlock
                title="virtctl image-upload (run where kubeconfig points at your cluster)"
                content={kubevirtBundle.virtctl_image_upload_example}
              />
              <CollapsibleCodeBlock
                title="Kubernetes manifests"
                content={kubevirtBundle.yaml}
              />
            </div>
          </div>
        </div>
      )}

      {openstackPushReady && name && (
        <LibvirtOpenStackPushModal
          vmName={name}
          open={openstackPushOpen}
          onClose={() => setOpenstackPushOpen(false)}
          onSuccess={(r) => {
            toast.success(
              r.instance_id
                ? `OpenStack instance ${r.instance_name || r.instance_id}`
                : `Glance image ${r.image_name || r.image_id}`,
            )
          }}
        />
      )}

      <BrowseHostPathModal
        open={cdromBrowseOpen}
        onClose={() => setCdromBrowseOpen(false)}
        title="Browse for ISO"
        canSelectFile={isIsoFileName}
        onSelectPath={(p) => setCdromPath(p)}
      />
      <BrowseHostPathModal
        open={attachDiskBrowseOpen}
        onClose={() => setAttachDiskBrowseOpen(false)}
        title="Browse for disk image"
        canSelectFile={isHostDiskImageFileName}
        onSelectPath={(p) => setAttachSource(p)}
      />
    </PageLayout>
  )
}

// ── Shared components ──────────────────────────────────────────────

function InfoRow({ label, value }: { label: string; value: string | number | boolean }) {
  return (
    <div className="flex items-center justify-between py-2 border-b border-slate-700/30">
      <span className="text-slate-400 text-sm">{label}</span>
      <span className="text-sm font-medium">{String(value)}</span>
    </div>
  )
}

function EditableRow({ label, value, onEdit }: { label: string; value: string | number; onEdit: () => void }) {
  return (
    <div className="flex items-center justify-between py-2 border-b border-slate-700/30">
      <span className="text-slate-400 text-sm">{label}</span>
      <div className="flex items-center gap-2">
        <span className="text-sm font-medium">{String(value)}</span>
        <button onClick={onEdit} className="p-0.5 hover:bg-slate-700 rounded transition" aria-label={`Edit ${label}`}><Pencil className="w-3 h-3 text-slate-500 hover:text-[var(--machina-status-info)]" /></button>
      </div>
    </div>
  )
}

function DialogOverlay({ children, onClose }: { children: React.ReactNode; onClose: () => void }) {
  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  }, [onClose])

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm animate-fade-in" role="dialog" aria-modal="true" onClick={onClose}>
      {children}
    </div>
  )
}

function DialogBox({ title, icon, onClose, onConfirm, confirmLabel, children, confirmDisabled, confirmDanger }: {
  title: string
  icon: React.ReactNode
  onClose: () => void
  onConfirm: () => void
  confirmLabel: string
  children: React.ReactNode
  confirmDisabled?: boolean
  confirmDanger?: boolean
}) {
  const confirmClass = confirmDanger
    ? 'bg-red-600 hover:bg-red-500 disabled:opacity-40 disabled:cursor-not-allowed'
    : 'bg-blue-600 hover:bg-blue-500 disabled:opacity-40 disabled:cursor-not-allowed'
  return (
    <form
      className="bg-slate-800 border border-slate-700/50 rounded-2xl shadow-2xl w-full max-w-md mx-4 animate-fade-in"
      onClick={(e) => e.stopPropagation()}
      onSubmit={(e) => { e.preventDefault(); if (!confirmDisabled) onConfirm() }}
    >
      <div className="p-5 border-b border-slate-700/50 flex items-center justify-between">
        <span className="text-lg font-semibold flex items-center gap-2">{icon} {title}</span>
        <button type="button" onClick={onClose} className="p-1 hover:bg-slate-700 rounded transition" aria-label="Close"><X className="w-4 h-4 text-slate-400" /></button>
      </div>
      <div className="p-5 space-y-1">{children}</div>
      <div className="flex justify-end gap-3 px-5 pb-5">
        <button type="button" onClick={onClose} className="px-4 py-2 bg-slate-700 hover:bg-slate-600 rounded-lg text-sm font-medium transition">Cancel</button>
        <button type="submit" disabled={confirmDisabled} className={`px-4 py-2 rounded-lg text-sm text-white font-medium transition ${confirmClass}`}>{confirmLabel}</button>
      </div>
    </form>
  )
}
