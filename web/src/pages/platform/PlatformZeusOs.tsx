// Copyright (c) 2026 ZyvorAI Labs Private Limited. All rights reserved.

import { useCallback, useEffect, useState } from 'react'
import { Link, useSearchParams } from 'react-router'
import { Cpu, Search, Server, Shield, Workflow } from 'lucide-react'
import { MacGlassPanel, MacListRow, MacSectionTitle } from '../../components/platform/mac/PlatformMacUi'
import PageLayout from '../../components/PageLayout'
import PageSkeleton from '../../components/PageSkeleton'
import PlatformEmptyState from '../../components/platform/PlatformEmptyState'
import PlatformZeusHubLaunchpad from '../../components/platform/tahoe/PlatformZeusHubLaunchpad'
import { formatUserError } from '../../utils/apiError'
import { hubLinkClasses, statusToneClass } from '../../utils/semanticColors'
import { getFleetLinuxHealth, type FleetLinuxHealthOverview } from '../../api/platform'
import {
  analyzeAttackPath,
  diagnoseKnowledge,
  diagnoseFleet,
  executeFleetRebalance,
  getComplianceFrameworks,
  getGpuPlacement,
  getFleetPowerOptimize,
  getFleetHeatmap,
  getFleetSummary,
  getFleetLocal,
  getZeusSummary,
  getRemediateHub,
  getKnowledgeRunbook,
  simulateServiceImpact,
  getFleetRebalanceProposal,
  getInfrastructureMemory,
  getSecurityGraph,
  getServiceGraph,
  getBaremetalProvision,
  listBaremetalServers,
  planBaremetalCapacity,
  registerBaremetalServer,
  searchKnowledge,
  setBaremetalPower,
  type BaremetalServer,
  type FleetHeatmap,
  type KnowledgeHit,
  type RebalanceProposal,
} from '../../api/ai'

type Tab = 'fleet' | 'security' | 'knowledge' | 'services' | 'baremetal'

export default function PlatformZeusOs() {
  const [searchParams] = useSearchParams()
  const initialTab = searchParams.get('tab')
  const [tab, setTab] = useState<Tab>(
    initialTab === 'baremetal' || initialTab === 'security' || initialTab === 'knowledge' || initialTab === 'services'
      ? initialTab
      : 'fleet',
  )
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [heatmap, setHeatmap] = useState<FleetHeatmap | null>(null)
  const [rebalance, setRebalance] = useState<RebalanceProposal | null>(null)
  const [attackSummary, setAttackSummary] = useState<string | null>(null)
  const [knowledgeQuery, setKnowledgeQuery] = useState('payments')
  const [knowledgeHits, setKnowledgeHits] = useState<KnowledgeHit[]>([])
  const [serviceCount, setServiceCount] = useState(0)
  const [memoryCount, setMemoryCount] = useState(0)
  const [baremetal, setBaremetal] = useState<BaremetalServer[]>([])
  const [bmcHost, setBmcHost] = useState('')
  const [bmcAddr, setBmcAddr] = useState('')
  const [bmcVlan, setBmcVlan] = useState('')
  const [pxeVlan, setPxeVlan] = useState('')
  const [metalProfile, setMetalProfile] = useState('BareMetalBmc')
  const [capacitySummary, setCapacitySummary] = useState<string | null>(null)
  const [rebalancePreview, setRebalancePreview] = useState<string | null>(null)
  const [frameworksSummary, setFrameworksSummary] = useState<string | null>(null)
  const [gpuSummary, setGpuSummary] = useState<string | null>(null)
  const [diagnosisSummary, setDiagnosisSummary] = useState<string | null>(null)
  const [serviceImpact, setServiceImpact] = useState<string | null>(null)
  const [powerSummary, setPowerSummary] = useState<string | null>(null)
  const [zeusSummary, setZeusSummary] = useState<string | null>(null)
  const [hubSummary, setHubSummary] = useState<string | null>(null)
  const [hubItems, setHubItems] = useState<Array<{ id: string; source: string; label: string; review: string }>>([])
  const [runbookSummary, setRunbookSummary] = useState<string | null>(null)
  const [linuxHealth, setLinuxHealth] = useState<FleetLinuxHealthOverview | null>(null)
  const [fleetDiagnoseQuery, setFleetDiagnoseQuery] = useState('fleet linux pressure and failed tasks')
  const [fleetDiagnoseSummary, setFleetDiagnoseSummary] = useState<string | null>(null)
  const [fleetSummaryLine, setFleetSummaryLine] = useState<string | null>(null)

  const loadFleet = useCallback(async () => {
    setError(null)
    setLoading(true)
    try {
      const [h, r, gpu, power, linux, summary, local] = await Promise.all([
        getFleetHeatmap(),
        getFleetRebalanceProposal(),
        getGpuPlacement('inference'),
        getFleetPowerOptimize(),
        getFleetLinuxHealth().catch(() => null),
        getFleetSummary().catch(() => null),
        getFleetLocal().catch(() => null),
      ])
      setHeatmap(h)
      setRebalance(r)
      setGpuSummary(gpu.summary)
      setPowerSummary(power.summary)
      setLinuxHealth(linux)
      setFleetSummaryLine([summary?.summary, local?.summary].filter(Boolean).join(' · ') || null)
    } catch (e: unknown) {
      setError(formatUserError(e))
    } finally {
      setLoading(false)
    }
  }, [])

  const loadSecurity = useCallback(async () => {
    setError(null)
    try {
      await getSecurityGraph()
      const path = await analyzeAttackPath('attacker', 'db-prod')
      setAttackSummary(path.summary)
      const fw = await getComplianceFrameworks()
      setFrameworksSummary(
        fw.frameworks.map((f) => `${f.framework} ${f.grade} (${f.score})`).join(' · ') || fw.summary,
      )
    } catch (e: unknown) {
      setError(formatUserError(e))
    }
  }, [])

  const loadServices = useCallback(async () => {
    setError(null)
    try {
      const [sg, mem, impact] = await Promise.all([
        getServiceGraph(),
        getInfrastructureMemory(),
        simulateServiceImpact('payments').catch(() => null),
      ])
      setServiceCount(sg.service_count)
      setMemoryCount(mem.incidents.length)
      if (impact) setServiceImpact(impact.summary)
    } catch (e: unknown) {
      setError(formatUserError(e))
    }
  }, [])

  const loadBaremetal = useCallback(async () => {
    setError(null)
    try {
      setBaremetal(await listBaremetalServers())
    } catch (e: unknown) {
      setError(formatUserError(e))
    }
  }, [])

  useEffect(() => {
    void getZeusSummary().then((z) => setZeusSummary(`${z.status} · ${z.highlights?.[0] ?? z.tagline}`)).catch(() => {})
    void getRemediateHub().then((h) => {
      setHubSummary(h.summary)
      setHubItems(h.items.slice(0, 6))
    }).catch(() => {})
  }, [])

  useEffect(() => {
    if (tab === 'fleet') void loadFleet()
    if (tab === 'security') void loadSecurity()
    if (tab === 'services') void loadServices()
    if (tab === 'baremetal') void loadBaremetal()
  }, [tab, loadFleet, loadSecurity, loadServices, loadBaremetal])

  const runKnowledge = async () => {
    try {
      const [r, diag, rb] = await Promise.all([
        searchKnowledge(knowledgeQuery),
        diagnoseKnowledge(knowledgeQuery),
        getKnowledgeRunbook(knowledgeQuery),
      ])
      setKnowledgeHits(r.hits)
      setDiagnosisSummary(diag.hypotheses[0]?.title ?? diag.summary)
      setRunbookSummary(`${rb.runbook_title}: ${rb.steps[0] ?? rb.summary}`)
    } catch (e: unknown) {
      setError(formatUserError(e))
    }
  }

  const tabs: { id: Tab; label: string; icon: React.ReactNode }[] = [
    { id: 'fleet', label: 'Fleet', icon: <Cpu className="w-4 h-4" /> },
    { id: 'security', label: 'Security', icon: <Shield className="w-4 h-4" /> },
    { id: 'knowledge', label: 'Knowledge', icon: <Search className="w-4 h-4" /> },
    { id: 'services', label: 'Services', icon: <Workflow className="w-4 h-4" /> },
    { id: 'baremetal', label: 'Bare Metal', icon: <Server className="w-4 h-4" /> },
  ]

  return (
    <PageLayout hideHeader error={error}>
      <MacSectionTitle
        title="Machina Zeus OS"
        subtitle="Fleet intelligence · AI security graph · knowledge engine · service fabric · bare metal"
      />
      {loading && tab === 'fleet' && !heatmap && <PageSkeleton />}
      {zeusSummary && <p className="text-sm text-orange-200/90">{zeusSummary}</p>}
      {hubSummary && (
        <MacGlassPanel title="Remediation hub" subtitle="SRE · compliance · fleet power — unified review queue">
          <p className="text-sm text-slate-300">{hubSummary}</p>
          {hubItems.length > 0 && (
            <ul className="mt-2 text-xs space-y-1 text-slate-400">
              {hubItems.map((i) => (
                <li key={i.id}><span className="text-orange-300/80">{i.source}</span> · {i.label} — {i.review}</li>
              ))}
            </ul>
          )}
        </MacGlassPanel>
      )}
      <PlatformZeusHubLaunchpad activeTab={tab} />
      <div className="flex flex-wrap gap-2">
        {tabs.map((t) => (
          <button
            key={t.id}
            type="button"
            className={`flex items-center gap-2 px-3 py-1.5 rounded-full text-xs border ${
              tab === t.id ? 'border-orange-400/50 bg-orange-500/10 text-orange-200' : 'border-white/[0.08] text-slate-400'
            }`}
            onClick={() => setTab(t.id)}
          >
            {t.icon} {t.label}
          </button>
        ))}
        <Link to="/mission-control" className={`text-xs self-center ml-2 ${hubLinkClasses()}`}>Mission Control →</Link>
      </div>

      {tab === 'fleet' && heatmap && (
        <div className="space-y-4">
          {fleetSummaryLine && <p className="text-sm text-slate-400">{fleetSummaryLine}</p>}
          {linuxHealth && (
            <MacGlassPanel title="Fleet Linux health" subtitle="PSI · thermal · SMART rollup from hypervisors">
              <p className="text-sm text-slate-300">{linuxHealth.summary}</p>
              {linuxHealth.hosts.length > 0 && (
                <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3 text-xs mt-3">
                  {linuxHealth.hosts.slice(0, 6).map((h) => (
                    <Link key={h.host_id} to={`/platform/hosts/${h.host_id}`} className="rounded-lg border border-white/[0.06] p-2 hover:bg-slate-800/40">
                      <p className="font-medium text-slate-200">{h.hostname}</p>
                      <p className="text-slate-500">IO {h.io_pressure_pct.toFixed(0)}% · {h.status}</p>
                    </Link>
                  ))}
                </div>
              )}
            </MacGlassPanel>
          )}
          <MacGlassPanel title="Fleet AI diagnose" subtitle="NL diagnosis across Zeus + Linux health">
            <div className="flex flex-wrap gap-2 mb-2">
              <input className="input text-sm flex-1 min-w-[12rem]" value={fleetDiagnoseQuery} onChange={(e) => setFleetDiagnoseQuery(e.target.value)} />
              <button
                type="button"
                className="btn-secondary text-xs"
                onClick={() => void diagnoseFleet(fleetDiagnoseQuery).then((d) => setFleetDiagnoseSummary(d.summary)).catch((e: unknown) => setFleetDiagnoseSummary(formatUserError(e)))}
              >
                Diagnose fleet
              </button>
            </div>
            {fleetDiagnoseSummary && <p className="text-sm text-slate-300">{fleetDiagnoseSummary}</p>}
          </MacGlassPanel>
          <MacGlassPanel title="Fleet heat map" subtitle="Hot, cold, and power-waste hosts">
            <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3 text-xs">
              {heatmap.hosts.map((h) => (
                <div key={h.host_id} className="rounded-lg border border-white/[0.06] p-2">
                  <p className="font-medium text-slate-200">{h.hostname}</p>
                  <p className="text-slate-500">CPU {h.cpu_percent.toFixed(0)}% · Mem {h.memory_percent.toFixed(0)}% · {h.classification}</p>
                </div>
              ))}
            </div>
          </MacGlassPanel>
          {powerSummary && (
            <MacGlassPanel title="Fleet power optimizer" subtitle="Consolidate cold hosts and relieve hotspots">
              <p className="text-sm text-slate-300">{powerSummary}</p>
            </MacGlassPanel>
          )}
          {gpuSummary && (
            <MacGlassPanel title="GPU / NUMA placement" subtitle="Tag hosts with gpu or nvidia for affinity">
              <p className="text-sm text-slate-300">{gpuSummary}</p>
            </MacGlassPanel>
          )}
          {rebalance && (
            <MacGlassPanel title="Autonomous rebalancer" subtitle={rebalance.summary}>
              <ul className="text-xs space-y-2 text-slate-400">
                {rebalance.moves.map((m) => (
                  <li key={m.vm_id}>{m.vm_name}: {m.from_host} → {m.to_host}</li>
                ))}
              </ul>
              <button
                type="button"
                className="btn-secondary text-xs mt-3"
                onClick={async () => {
                  const r = await executeFleetRebalance(true)
                  setRebalancePreview(r.summary)
                }}
              >
                Preview execute
              </button>
              {rebalancePreview && <p className="text-xs text-slate-400 mt-2">{rebalancePreview}</p>}
            </MacGlassPanel>
          )}
        </div>
      )}

      {tab === 'security' && (
        <div className="space-y-4">
          <MacGlassPanel title="Security hubs" subtitle="Threat intelligence and host firewall — open a hub for full detail">
            <div className="flex flex-wrap gap-3">
              <Link to="/platform/zeus/security" className="btn-secondary text-sm">
                Security Center
              </Link>
              <Link to="/platform/zeus/security/firewall" className="btn-secondary text-sm">
                Zeus Firewall
              </Link>
            </div>
            <p className="text-xs text-slate-500 mt-3">
              Threat hunting, runtime enforcement, ports, policies, and cloud rules live inside these hubs.
            </p>
          </MacGlassPanel>
          <MacGlassPanel title="Attack path discovery" subtitle="Example: attacker → db-prod">
            <p className="text-sm text-slate-300">{attackSummary ?? 'Loading…'}</p>
            <p className="text-xs text-slate-500 mt-2">Use Spotlight: &quot;show attack path to database VM&quot;</p>
          </MacGlassPanel>
          {frameworksSummary && (
            <MacGlassPanel title="Compliance frameworks" subtitle="CIS · PCI · SOC2 · HIPAA mapping">
              <p className="text-sm text-slate-300">{frameworksSummary}</p>
            </MacGlassPanel>
          )}
        </div>
      )}

      {tab === 'knowledge' && (
        <MacGlassPanel title="Infrastructure knowledge engine" subtitle="Global search + NL diagnose">
          <div className="flex gap-2">
            <input className="input flex-1 text-sm" value={knowledgeQuery} onChange={(e) => setKnowledgeQuery(e.target.value)} />
            <button type="button" className="btn-primary text-xs" onClick={() => void runKnowledge()}>Search</button>
          </div>
          {diagnosisSummary && <p className={`text-xs mt-2 ${statusToneClass('warn')}`}>Diagnosis: {diagnosisSummary}</p>}
          {runbookSummary && <p className={`text-xs mt-1 ${statusToneClass('ok')}`}>Runbook: {runbookSummary}</p>}
          <ul className="mt-3 space-y-1.5 text-xs">
            {knowledgeHits.map((h) => (
              <li key={`${h.kind}-${h.id}`}>
                {h.navigate ? <Link to={h.navigate} className={`hover:underline ${hubLinkClasses()}`}>{h.title}</Link> : h.title}
                <span className="text-slate-500"> — {h.snippet}</span>
              </li>
            ))}
          </ul>
        </MacGlassPanel>
      )}

      {tab === 'services' && (
        <MacGlassPanel title="Service graph & infrastructure memory" subtitle="Application → VM dependencies + incident recall">
          <p className="text-sm text-slate-400">{serviceCount} application service(s) mapped · {memoryCount} remembered incident(s)</p>
          {serviceImpact && <p className="text-xs text-slate-400 mt-2">{serviceImpact}</p>}
          <Link to="/platform/applications" className={`text-xs mt-2 inline-block ${hubLinkClasses()}`}>Open applications →</Link>
        </MacGlassPanel>
      )}

      {tab === 'baremetal' && (
        <div className="space-y-4">
          <MacGlassPanel title="Bare metal servers" subtitle="Redfish / IPMI inventory + Zeus Firewall policy">
            <div className="flex flex-wrap gap-2 mb-3">
              <input className="input text-sm" placeholder="hostname" value={bmcHost} onChange={(e) => setBmcHost(e.target.value)} />
              <input className="input text-sm" placeholder="BMC address" value={bmcAddr} onChange={(e) => setBmcAddr(e.target.value)} />
              <input className="input text-sm w-24" placeholder="BMC VLAN" value={bmcVlan} onChange={(e) => setBmcVlan(e.target.value)} />
              <input className="input text-sm w-24" placeholder="PXE VLAN" value={pxeVlan} onChange={(e) => setPxeVlan(e.target.value)} />
              <select className="input text-sm" value={metalProfile} onChange={(e) => setMetalProfile(e.target.value)}>
                <option value="BareMetalBmc">BareMetal BMC</option>
                <option value="BareMetalPxe">BareMetal PXE</option>
                <option value="BareMetalRedfish">BareMetal Redfish</option>
                <option value="MetalLockdown">Metal Lockdown</option>
              </select>
              <button
                type="button"
                className="btn-secondary text-xs"
                onClick={async () => {
                  await registerBaremetalServer({
                    hostname: bmcHost,
                    bmc_address: bmcAddr,
                    bmc_vlan: bmcVlan,
                    pxe_vlan: pxeVlan,
                    firewall_profile: metalProfile,
                  })
                  setBmcHost('')
                  setBmcAddr('')
                  await loadBaremetal()
                }}
              >
                Register
              </button>
            </div>
            <div className="space-y-1">
              {baremetal.map((s) => (
                <MacListRow
                  key={s.id}
                  title={s.hostname}
                  subtitle={`${s.bmc_type} @ ${s.bmc_address || '—'} · ${s.firewall_profile || 'BareMetalBmc'} · ${s.state}`}
                  href={`/platform/zeus/security/firewall/${s.id}`}
                  trailing={
                    <span className="flex gap-2 text-[10px]">
                      <button type="button" className={hubLinkClasses()} onClick={(e) => {
                        e.preventDefault()
                        void setBaremetalPower(s.id, 'on', true).then((r) => setCapacitySummary(r.summary))
                      }}>Power</button>
                      <button type="button" className={hubLinkClasses()} onClick={(e) => {
                        e.preventDefault()
                        void getBaremetalProvision(s.id).then((r) => setCapacitySummary(r.summary))
                      }}>PXE</button>
                    </span>
                  }
                />
              ))}
              {baremetal.length === 0 && (
                <PlatformEmptyState
                  icon={Server}
                  title="No bare-metal servers"
                  subtitle="Register BMC targets from Zeus Firewall to manage power, PXE, and firewall profiles."
                  action={<Link to="/platform/zeus/security/firewall" className="btn-primary text-sm">Open Zeus Firewall</Link>}
                />
              )}
            </div>
            <Link to="/platform/zeus/security/firewall" className={`text-xs mt-3 inline-block ${hubLinkClasses()}`}>
              Open Zeus Firewall fleet →
            </Link>
          </MacGlassPanel>
          <MacGlassPanel title="AI capacity planner" subtitle="How many servers for N engineers?">
            <button
              type="button"
              className="btn-primary text-xs"
              onClick={async () => {
                const p = await planBaremetalCapacity('How many servers for 500 AI engineers?')
                setCapacitySummary(p.summary)
              }}
            >
              Plan 500 AI engineers
            </button>
            {capacitySummary && <p className="text-sm text-slate-300 mt-2">{capacitySummary}</p>}
          </MacGlassPanel>
        </div>
      )}
    </PageLayout>
  )
}
