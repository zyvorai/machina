// Copyright (c) 2026 ZyvorAI Labs Private Limited. All rights reserved.

import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router'
import { Cable, Layers, Loader2, Network, Plus, RefreshCw, Router, Shield, Wifi } from 'lucide-react'
import DetailTabs from '../../components/platform/DetailTabs'
import PlatformPageChrome, { PlatformBackLink, PlatformRefreshButton } from '../../components/platform/PlatformPageChrome'
import { usePlatformTabState } from '../../hooks/usePlatformTabState'
import PageSkeleton from '../../components/PageSkeleton'
import PlatformEmptyState from '../../components/platform/PlatformEmptyState'
import FleetSettingsPane from '../../components/platform/FleetSettingsPane'
import { PlatformOpenStackNetworkLink } from '../../components/platform/PlatformCrossLinks'
import MachinaNetworkLens from '../../components/ai/MachinaNetworkLens'
import {
  MacGlassPanel,
  MacListRow,
  MacSheet,
  MacStatWidget,
  gradientForName,
} from '../../components/platform/mac/PlatformMacUi'
import {
  allocateIpam,
  bindNetworkToSegment,
  createNetworkSegment,
  createPlatformNetwork,
  deletePlatformNetwork,
  discoverPlatformNetworks,
  emergencyUnlockNetworkSegment,
  getFleetNetwork,
  getNetworkSegmentsOverview,
  listIpamPools,
  listPlatformHosts,
  listPlatformNetworks,
  listPlatformVms,
  simulateSegmentConnectivity,
  syncAllHosts,
  exportNetworkSegmentsGitops,
  type FleetNetworkOverview,
  type IpamPoolRow,
  type NetworkSegmentOverview,
  type PlatformNetwork,
  type SegmentConnectivityResult,
} from '../../api/platform'
import { useToastContext } from '../../contexts/ToastContext'
import { formatUserError } from '../../utils/apiError'
import {hostStateTone, httpStatusTone, migrationReadinessTone, riskTone, statusBadgeClasses, statusPillClasses, statusSurfaceClasses, statusToneClass, taskStatusTone, webhookDeliveryTone, hubLinkClasses} from '../../utils/semanticColors'

const PRESETS = [
  { name: 'default', bridge: 'virbr0', label: 'Default NAT', desc: 'Libvirt default — VMs get DHCP' },
  { name: 'vm-net', bridge: 'br0', label: 'VM network', desc: 'Linux bridge for production VMs' },
] as const

type TabId = 'networks' | 'segments' | 'ipam' | 'lens'

const NETWORK_TABS = [
  { id: 'networks' as const, label: 'Networks' },
  { id: 'segments' as const, label: 'Segments' },
  { id: 'ipam' as const, label: 'IPAM' },
  { id: 'lens' as const, label: 'Network Lens' },
]

export default function PlatformNetworks() {
  const toast = useToastContext()
  const [tab, setTab] = usePlatformTabState<TabId>(NETWORK_TABS.map((t) => t.id), { defaultTab: 'networks' })

  const [loading, setLoading] = useState(true)
  const [rows, setRows] = useState<PlatformNetwork[]>([])
  const [segments, setSegments] = useState<NetworkSegmentOverview[]>([])
  const [ipamPools, setIpamPools] = useState<IpamPoolRow[]>([])
  const [hostCount, setHostCount] = useState(0)
  const [error, setError] = useState<string | null>(null)
  const [discovering, setDiscovering] = useState(false)
  const [sheetOpen, setSheetOpen] = useState(false)
  const [segmentSheetOpen, setSegmentSheetOpen] = useState(false)
  const [name, setName] = useState('vm-net')
  const [vlan, setVlan] = useState('')
  const [bridge, setBridge] = useState('br0')
  const [creating, setCreating] = useState(false)
  const [segName, setSegName] = useState('app-tier1')
  const [segTier, setSegTier] = useState('tier1')
  const [segCidr, setSegCidr] = useState('10.20.0.0/16')
  const [segEastWest, setSegEastWest] = useState('allow')
  const [segProfile, setSegProfile] = useState('ProductionServer')
  const [allocating, setAllocating] = useState<string | null>(null)
  const [ipamHostname, setIpamHostname] = useState('')
  const [bindDraft, setBindDraft] = useState<Record<string, string>>({})
  const [binding, setBinding] = useState<string | null>(null)
  const [connectivitySegment, setConnectivitySegment] = useState<NetworkSegmentOverview | null>(null)
  const [connectivity, setConnectivity] = useState<SegmentConnectivityResult | null>(null)
  const [connectivityLoading, setConnectivityLoading] = useState(false)
  const [fleetNetwork, setFleetNetwork] = useState<FleetNetworkOverview | null>(null)
  const [lensVmNames, setLensVmNames] = useState<string[]>([])

  const segmentName = (id?: string | null) =>
    segments.find((s) => s.id === id)?.name ?? null

  const load = useCallback(async (autoDiscover = false) => {
    setError(null)
    setLoading(true)
    try {
      const [nets, hosts, overview, pools] = await Promise.all([
        listPlatformNetworks(),
        listPlatformHosts(),
        getNetworkSegmentsOverview().catch(() => ({ segments: [], summary: '' })),
        listIpamPools().catch(() => []),
      ])
      setSegments(overview.segments)
      setIpamPools(pools)
      setHostCount(hosts.filter((h) => h.state === 'online').length)
      if (nets.length === 0 && autoDiscover && hosts.some((h) => h.state === 'online')) {
        setDiscovering(true)
        try {
          const r = await discoverPlatformNetworks()
          setRows(r.networks)
          if (r.networks.length > 0) {
            toast.success(`Imported ${r.networks.length} network(s) from libvirt`)
          }
        } catch (e: unknown) {
          setError(formatUserError(e))
        } finally {
          setDiscovering(false)
        }
      } else {
        setRows(nets)
      }
    } catch (e: unknown) {
      setError(formatUserError(e))
    } finally {
      setLoading(false)
    }
  }, [toast])

  useEffect(() => { void load(true) }, [load])

  useEffect(() => {
    if (tab !== 'lens') return
    void Promise.all([
      getFleetNetwork().then(setFleetNetwork).catch(() => setFleetNetwork(null)),
      listPlatformVms().then((v) => setLensVmNames(v.map((x) => x.name))).catch(() => setLensVmNames([])),
    ])
  }, [tab])

  const runDiscover = async () => {
    setDiscovering(true)
    setError(null)
    try {
      const r = await discoverPlatformNetworks()
      setRows(r.networks)
      toast.success(r.networks.length ? `Found ${r.networks.length} network(s)` : 'No libvirt networks found on online hosts')
    } catch (e: unknown) {
      toast.error(formatUserError(e))
    } finally {
      setDiscovering(false)
    }
  }

  const syncHosts = async () => {
    setDiscovering(true)
    try {
      await syncAllHosts()
      toast.success('Host sync queued — networks import with inventory')
      setTimeout(() => void load(false), 4000)
    } catch (e: unknown) {
      toast.error(formatUserError(e))
    } finally {
      setDiscovering(false)
    }
  }

  const createNet = async () => {
    setCreating(true)
    try {
      await createPlatformNetwork({
        name,
        vlan_id: vlan ? Number(vlan) : undefined,
        bridge: bridge || undefined,
      })
      toast.success('Network added and provision task queued')
      setSheetOpen(false)
      await load(false)
    } catch (e: unknown) {
      toast.error(formatUserError(e))
    } finally {
      setCreating(false)
    }
  }

  const createSegment = async () => {
    setCreating(true)
    try {
      await createNetworkSegment({
        name: segName,
        tier: segTier,
        cidr: segCidr,
        east_west_default: segEastWest,
        firewall_profile: segProfile || undefined,
      })
      toast.success('Overlay segment created')
      setSegmentSheetOpen(false)
      await load(false)
      setTab('segments')
    } catch (e: unknown) {
      toast.error(formatUserError(e))
    } finally {
      setCreating(false)
    }
  }

  const runAllocate = async (segmentId: string) => {
    setAllocating(segmentId)
    try {
      const r = await allocateIpam(segmentId, ipamHostname.trim() ? { hostname: ipamHostname.trim() } : undefined)
      toast.success(`Allocated ${r.ip_address}${r.hostname ? ` (${r.hostname})` : ''} on ${r.segment_name}`)
      setIpamHostname('')
      await load(false)
    } catch (e: unknown) {
      toast.error(formatUserError(e))
    } finally {
      setAllocating(null)
    }
  }

  const bindNetwork = async (networkId: string, segmentId: string) => {
    setBinding(networkId)
    try {
      await bindNetworkToSegment(segmentId, networkId)
      toast.success('Network bound to segment')
      await load(false)
    } catch (e: unknown) {
      toast.error(formatUserError(e))
    } finally {
      setBinding(null)
    }
  }

  const runSegmentConnectivity = async (segment: NetworkSegmentOverview) => {
    setConnectivitySegment(segment)
    setConnectivity(null)
    setConnectivityLoading(true)
    try {
      setConnectivity(await simulateSegmentConnectivity(segment.id))
    } catch (e: unknown) {
      toast.error(formatUserError(e))
      setConnectivitySegment(null)
    } finally {
      setConnectivityLoading(false)
    }
  }

  return (
    <PlatformPageChrome
      error={error}
      onErrorRetry={() => void load(false)}
      prepend={<PlatformBackLink to="/platform/resources" label="Resources" />}
      title="Networks"
      subtitle="Overlays, libvirt bridges, IPAM — NSX-class segments and micro-segmentation."
      icon={<Network className="w-6 h-6 text-slate-400" />}
      actions={
        <>
          {tab === 'networks' && (
            <>
              <button type="button" className="btn-secondary text-sm flex items-center gap-1.5" disabled={discovering} onClick={() => void runDiscover()}>
                {discovering ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
                Import from hosts
              </button>
              <button type="button" className="btn-primary text-sm flex items-center gap-1.5" onClick={() => setSheetOpen(true)}>
                <Plus className="w-4 h-4" /> New network
              </button>
            </>
          )}
          {tab === 'segments' && (
            <button type="button" className="btn-primary text-sm flex items-center gap-1.5" onClick={() => setSegmentSheetOpen(true)}>
              <Plus className="w-4 h-4" /> New segment
            </button>
          )}
          <PlatformRefreshButton onClick={() => void load(false)} />
        </>
      }
      contentClassName="space-y-4"
    >
      <DetailTabs primary={NETWORK_TABS} active={tab} onChange={setTab} />

      {loading && rows.length === 0 && !discovering && !error && <PageSkeleton />}

      {tab === 'networks' && (
        <>
          <div className="grid gap-3 sm:grid-cols-3">
            <MacStatWidget label="Networks" value={String(rows.length)} icon={<Network className="w-4 h-4" />} />
            <MacStatWidget label="Online hosts" value={String(hostCount)} icon={<Router className="w-4 h-4" />} href="/platform/hosts" tone={hostCount > 0 ? 'ok' : 'warn'} />
            <MacStatWidget label="Segments" value={String(segments.length)} icon={<Layers className="w-4 h-4" />} />
          </div>

          {rows.length === 0 && !discovering && !error && !loading && (
            <PlatformEmptyState
              icon={Network}
              title="No networks yet"
              subtitle="Import libvirt networks from online hosts or create a bridge-backed network for VMs."
              action={(
                <div className="flex flex-wrap gap-2">
                  <button type="button" className="btn-primary" onClick={() => void runDiscover()}>Import from hosts</button>
                  <button type="button" className="btn-secondary" onClick={() => void syncHosts()}>Sync all hosts</button>
                  <button type="button" className="btn-secondary" onClick={() => setSheetOpen(true)}>Create network</button>
                  {hostCount === 0 && (
                    <Link to="/platform/enroll" className="btn-secondary">Enroll a host</Link>
                  )}
                </div>
              )}
            />
          )}

          {discovering && rows.length === 0 && (
            <div className="flex items-center justify-center gap-2 text-sm text-slate-400 py-12">
              <Loader2 className="w-5 h-5 animate-spin" /> Discovering libvirt networks…
            </div>
          )}

          {rows.length > 0 && (
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {rows.map((n) => (
                <article
                  key={n.id}
                  className="platform-mac-stat rounded-2xl border border-white/[0.06] bg-slate-900/50 backdrop-blur-md p-5 flex flex-col gap-4 hover:border-white/10 transition"
                >
                  <div className="flex items-start gap-3">
                    <div className={`w-12 h-12 rounded-xl bg-gradient-to-br ${gradientForName(n.name)} flex items-center justify-center text-white shadow-md shrink-0`}>
                      <Wifi className="w-6 h-6" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <h3 className="font-semibold text-slate-100 truncate">{n.name}</h3>
                      <p className="text-xs text-slate-500 mt-0.5 capitalize">{n.backend.replace('-', ' ')}</p>
                      <PlatformOpenStackNetworkLink networkName={n.name} />
                    </div>
                  </div>
                  <dl className="grid grid-cols-2 gap-2 text-xs">
                    <div>
                      <dt className="text-slate-500">Bridge</dt>
                      <dd className="text-slate-200 font-mono mt-0.5">{n.bridge || '—'}</dd>
                    </div>
                    <div>
                      <dt className="text-slate-500">VLAN</dt>
                      <dd className="text-slate-200 mt-0.5">{n.vlan_id ?? '—'}</dd>
                    </div>
                    <div className="col-span-2">
                      <dt className="text-slate-500">Segment</dt>
                      <dd className="text-slate-200 mt-0.5">
                        {segmentName(n.segment_id) ?? 'Unbound'}
                      </dd>
                    </div>
                  </dl>
                  {segments.length > 0 && (
                    <div className="flex flex-wrap gap-2 items-center">
                      <select
                        className="input text-xs flex-1 min-w-[8rem]"
                        value={bindDraft[n.id] ?? n.segment_id ?? ''}
                        onChange={(e) => setBindDraft((d) => ({ ...d, [n.id]: e.target.value }))}
                      >
                        <option value="">Select segment…</option>
                        {segments.map((s) => (
                          <option key={s.id} value={s.id}>{s.name}</option>
                        ))}
                      </select>
                      <button
                        type="button"
                        className="btn-secondary text-xs"
                        disabled={binding === n.id || !(bindDraft[n.id] ?? n.segment_id)}
                        onClick={() => {
                          const seg = bindDraft[n.id] ?? n.segment_id
                          if (seg) void bindNetwork(n.id, seg)
                        }}
                      >
                        {binding === n.id ? <Loader2 className="w-3 h-3 animate-spin" /> : 'Bind'}
                      </button>
                    </div>
                  )}
                  <button
                    type="button"
                    className="btn-danger text-xs w-fit mt-auto"
                    onClick={async () => {
                      try {
                        await deletePlatformNetwork(n.id)
                        toast.success('Network removed')
                        await load(false)
                      } catch (e: unknown) {
                        toast.error(formatUserError(e))
                      }
                    }}
                  >
                    Remove
                  </button>
                </article>
              ))}
              <button
                type="button"
                onClick={() => setSheetOpen(true)}
                className="rounded-2xl border-2 border-dashed border-slate-600/60 bg-slate-900/20 p-5 flex flex-col items-center justify-center gap-2 text-slate-400 hover:border-blue-400/50 hover:text-blue-300 transition min-h-[10rem]"
              >
                <Plus className="w-8 h-8" />
                <span className="text-sm font-medium">New network</span>
              </button>
            </div>
          )}
        </>
      )}

      {tab === 'segments' && (
        <>
          <MacGlassPanel title="Overlay segments" subtitle="Tier-0/Tier-1 taxonomy with east-west defaults and micro-seg grade.">
            <div className="flex justify-end mb-3">
              <button
                type="button"
                className="tahoe-btn-ghost text-xs"
                onClick={async () => {
                  try {
                    const data = await exportNetworkSegmentsGitops()
                    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' })
                    const url = URL.createObjectURL(blob)
                    const a = document.createElement('a')
                    a.href = url
                    a.download = 'network-segments-gitops.json'
                    a.click()
                    URL.revokeObjectURL(url)
                    toast.success('GitOps export downloaded')
                  } catch (e: unknown) {
                    toast.error(formatUserError(e))
                  }
                }}
              >
                Export GitOps
              </button>
            </div>
            {segments.length === 0 ? (
              <PlatformEmptyState
                icon={Layers}
                title="No network segments"
                subtitle="Create a segment for east-west policy, or seed prod-tier1 / dmz-tier0 after migration."
                action={(
                  <button type="button" className="btn-primary text-sm" onClick={() => setSegmentSheetOpen(true)}>Create segment</button>
                )}
              />
            ) : (
              <div className="overflow-x-auto -mx-2">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left text-slate-500 border-b border-white/[0.06]">
                      <th className="py-2 px-2">Name</th>
                      <th className="py-2 px-2">Tier</th>
                      <th className="py-2 px-2">CIDR</th>
                      <th className="py-2 px-2">East-west</th>
                      <th className="py-2 px-2">Grade</th>
                      <th className="py-2 px-2">VMs</th>
                      <th className="py-2 px-2">Profile</th>
                      <th className="py-2 px-2">Networks</th>
                      <th className="py-2 px-2" />
                    </tr>
                  </thead>
                  <tbody>
                    {segments.map((s) => (
                      <tr key={s.id} className="border-b border-white/[0.04] text-slate-200">
                        <td className="py-2.5 px-2 font-medium">{s.name}</td>
                        <td className="py-2.5 px-2 font-mono text-xs">{s.tier}</td>
                        <td className="py-2.5 px-2 font-mono text-xs">{s.cidr}</td>
                        <td className="py-2.5 px-2">{s.east_west_default}</td>
                        <td className="py-2.5 px-2">
                          <span className={`px-2 py-0.5 rounded text-xs font-semibold ${
                            statusBadgeClasses(
                              s.micro_seg_grade === 'A' ? 'ok' : s.micro_seg_grade === 'B' ? 'info' : 'warn',
                            )
                          }`}>
                            {s.micro_seg_grade} ({s.micro_seg_score})
                          </span>
                        </td>
                        <td className="py-2.5 px-2">{s.vm_count}</td>
                        <td className="py-2.5 px-2 text-xs">
                          {s.firewall_profile ? (
                            <Link to="/platform/zeus/security/firewall" className="text-orange-300 hover:underline">{s.firewall_profile}</Link>
                          ) : '—'}
                        </td>
                        <td className="py-2.5 px-2">{s.network_count}</td>
                        <td className="py-2.5 px-2">
                          <div className="flex flex-wrap gap-1">
                            <button
                              type="button"
                              className="btn-secondary text-xs flex items-center gap-1"
                              onClick={() => void runSegmentConnectivity(s)}
                            >
                              <Cable className="w-3 h-3" /> Matrix
                            </button>
                            <button
                              type="button"
                              className="btn-danger text-xs"
                              onClick={() => {
                                if (!window.confirm(`Emergency unlock segment "${s.name}"? This bypasses micro-segmentation.`)) return
                                void emergencyUnlockNetworkSegment(s.id).then((r) => {
                                  toast.success(r.summary)
                                }).catch((e: unknown) => toast.error(formatUserError(e)))
                              }}
                            >
                              Unlock
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </MacGlassPanel>
        </>
      )}

      {tab === 'ipam' && (
        <MacGlassPanel title="IPAM pools" subtitle="Next-free allocation from segment CIDR pools.">
          <label className="block text-sm mb-4 max-w-md">
            <span className="text-slate-400">Default hostname (optional)</span>
            <input
              className="input w-full mt-1.5 font-mono text-sm"
              value={ipamHostname}
              onChange={(e) => setIpamHostname(e.target.value)}
              placeholder="app-01.prod"
            />
          </label>
          {ipamPools.length === 0 ? (
            <PlatformEmptyState
              title="No IPAM pools"
              subtitle="Create a network segment with IPAM enabled to allocate addresses from a CIDR."
              action={<button type="button" className="btn-secondary text-sm" onClick={() => setTab('segments')}>Open segments</button>}
            />
          ) : (
            <div className="overflow-x-auto -mx-2">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-slate-500 border-b border-white/[0.06]">
                    <th className="py-2 px-2">Segment</th>
                    <th className="py-2 px-2">CIDR</th>
                    <th className="py-2 px-2">Gateway</th>
                    <th className="py-2 px-2">Next offset</th>
                    <th className="py-2 px-2">Reservations</th>
                    <th className="py-2 px-2" />
                  </tr>
                </thead>
                <tbody>
                  {ipamPools.map((p) => (
                    <tr key={p.id} className="border-b border-white/[0.04] text-slate-200">
                      <td className="py-2.5 px-2">{p.segment_name}</td>
                      <td className="py-2.5 px-2 font-mono text-xs">{p.cidr}</td>
                      <td className="py-2.5 px-2 font-mono text-xs">{p.gateway || '—'}</td>
                      <td className="py-2.5 px-2">{p.next_offset}</td>
                      <td className="py-2.5 px-2">{p.reservation_count}</td>
                      <td className="py-2.5 px-2">
                        <button
                          type="button"
                          className="btn-secondary text-xs"
                          disabled={allocating === p.segment_id}
                          onClick={() => void runAllocate(p.segment_id)}
                        >
                          {allocating === p.segment_id ? <Loader2 className="w-3 h-3 animate-spin inline" /> : 'Allocate'}
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </MacGlassPanel>
      )}

      {tab === 'lens' && (
        <div className="space-y-4">
          {fleetNetwork && (
            <p className="text-sm text-slate-400">{fleetNetwork.summary}</p>
          )}
          <MachinaNetworkLens vmNames={lensVmNames} />
          <MacGlassPanel title="System Settings" subtitle="Fleet network pane — segments, firewall SLA, host systemd">
            <Link to="/platform/settings?section=network" className={`text-sm ${hubLinkClasses()}`}>
              Open Network in System Settings →
            </Link>
          </MacGlassPanel>
        </div>
      )}

      <MacSheet open={sheetOpen} onClose={() => setSheetOpen(false)} title="New network" subtitle="Define a cluster network and provision on an online host." wide>
        <div className="space-y-5">
          <div>
            <p className="text-xs font-medium text-slate-500 mb-2">Quick presets</p>
            <div className="grid gap-2 sm:grid-cols-2">
              {PRESETS.map((p) => (
                <button
                  key={p.name}
                  type="button"
                  className="text-left p-3 rounded-xl border border-white/[0.06] bg-slate-800/40 hover:bg-slate-800/70 transition"
                  onClick={() => { setName(p.name); setBridge(p.bridge) }}
                >
                  <p className="text-sm font-medium text-slate-100">{p.label}</p>
                  <p className="text-xs text-slate-500 mt-0.5">{p.desc}</p>
                </button>
              ))}
            </div>
          </div>
          <label className="block text-sm">
            <span className="text-slate-400">Name</span>
            <input className="input w-full mt-1.5" value={name} onChange={(e) => setName(e.target.value)} placeholder="vm-net" />
          </label>
          <label className="block text-sm">
            <span className="text-slate-400">Bridge (optional)</span>
            <input className="input w-full mt-1.5" value={bridge} onChange={(e) => setBridge(e.target.value)} placeholder="br0" />
          </label>
          <label className="block text-sm">
            <span className="text-slate-400">VLAN ID (optional)</span>
            <input className="input w-full mt-1.5" value={vlan} onChange={(e) => setVlan(e.target.value)} placeholder="100" />
          </label>
          <div className="flex gap-2 pt-2">
            <button type="button" className="btn-secondary flex-1" onClick={() => setSheetOpen(false)}>Cancel</button>
            <button type="button" className="btn-primary flex-1 flex items-center justify-center gap-2" disabled={creating} onClick={() => void createNet()}>
              {creating ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
              Add network
            </button>
          </div>
        </div>
      </MacSheet>

      <MacSheet open={segmentSheetOpen} onClose={() => setSegmentSheetOpen(false)} title="New overlay segment" subtitle="Tier-0 uplink / Tier-1 workload segment with optional Zeus profile." wide>
        <div className="space-y-4">
          <label className="block text-sm">
            <span className="text-slate-400">Name</span>
            <input className="input w-full mt-1.5" value={segName} onChange={(e) => setSegName(e.target.value)} />
          </label>
          <label className="block text-sm">
            <span className="text-slate-400">Tier</span>
            <select className="input w-full mt-1.5" value={segTier} onChange={(e) => setSegTier(e.target.value)}>
              <option value="tier1">tier1 — workload</option>
              <option value="tier0">tier0 — uplink / DMZ</option>
            </select>
          </label>
          <label className="block text-sm">
            <span className="text-slate-400">CIDR</span>
            <input className="input w-full mt-1.5 font-mono" value={segCidr} onChange={(e) => setSegCidr(e.target.value)} />
          </label>
          <label className="block text-sm">
            <span className="text-slate-400">East-west default</span>
            <select className="input w-full mt-1.5" value={segEastWest} onChange={(e) => setSegEastWest(e.target.value)}>
              <option value="allow">allow</option>
              <option value="deny">deny (micro-seg)</option>
            </select>
          </label>
          <label className="block text-sm">
            <span className="text-slate-400">Zeus firewall profile</span>
            <input className="input w-full mt-1.5" value={segProfile} onChange={(e) => setSegProfile(e.target.value)} placeholder="ProductionServer" />
          </label>
          <div className="flex gap-2 pt-2">
            <button type="button" className="btn-secondary flex-1" onClick={() => setSegmentSheetOpen(false)}>Cancel</button>
            <button type="button" className="btn-primary flex-1" disabled={creating} onClick={() => void createSegment()}>
              Create segment
            </button>
          </div>
        </div>
      </MacSheet>

      <MacSheet
        open={!!connectivitySegment}
        onClose={() => { setConnectivitySegment(null); setConnectivity(null) }}
        title={connectivitySegment ? `Connectivity — ${connectivitySegment.name}` : 'Connectivity'}
        subtitle="East-west micro-segmentation simulation for this overlay"
        wide
      >
        {connectivityLoading && (
          <p className="text-sm text-slate-400 flex items-center gap-2"><Loader2 className="w-4 h-4 animate-spin" /> Simulating…</p>
        )}
        {connectivity && (
          <div className="space-y-4">
            <p className="text-sm text-slate-400">{connectivity.matrix.summary}</p>
            {connectivity.matrix.warnings.length > 0 && (
              <div className={`rounded-xl p-3 text-sm space-y-1 ${statusSurfaceClasses('warn')}`}>
                {connectivity.matrix.warnings.map((w) => (
                  <p key={w}>{w}</p>
                ))}
              </div>
            )}
            <div className="grid md:grid-cols-2 gap-4">
              <div>
                <p className={`text-xs font-semibold uppercase mb-2 ${statusToneClass('ok')}`}>Allowed</p>
                <div className="rounded-xl border border-white/[0.06] overflow-hidden max-h-64 overflow-y-auto">
                  {connectivity.matrix.allows.map((c, i) => (
                    <MacListRow key={`a-${i}`} title={`${c.source} → ${c.destination}:${c.port}`} subtitle={c.reason} />
                  ))}
                  {connectivity.matrix.allows.length === 0 && (
                    <p className="px-4 py-3 text-sm text-slate-500">No allowed paths</p>
                  )}
                </div>
              </div>
              <div>
                <p className={`text-xs font-semibold uppercase mb-2 ${statusToneClass('error')}`}>Blocked</p>
                <div className="rounded-xl border border-white/[0.06] overflow-hidden max-h-64 overflow-y-auto">
                  {connectivity.matrix.blocks.map((c, i) => (
                    <MacListRow key={`b-${i}`} title={`${c.source} → ${c.destination}:${c.port}`} subtitle={c.reason} />
                  ))}
                  {connectivity.matrix.blocks.length === 0 && (
                    <p className="px-4 py-3 text-sm text-slate-500">No blocked paths</p>
                  )}
                </div>
              </div>
            </div>
          </div>
        )}
      </MacSheet>
      {tab === 'networks' && <FleetSettingsPane kind="network" />}
    </PlatformPageChrome>
  )
}
