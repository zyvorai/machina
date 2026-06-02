// Copyright (c) 2026 ZyvorAI Labs Private Limited. All rights reserved.

import { useCallback, useEffect, useState } from 'react'
import { Link, useParams, useLocation } from 'react-router'
import { ArrowLeft, ExternalLink, Network, Shield, Server, Activity, FileWarning, Bot } from 'lucide-react'
import PageLayout from '../../components/PageLayout'
import OsDiagnosePanel from '../../components/platform/OsDiagnosePanel'
import {
  MacSettingsPane,
  MacSettingsGroup,
  MacGlassPanel,
  MacListRow,
} from '../../components/platform/mac/PlatformMacUi'
import ErrorBanner from '../../components/ErrorBanner'
import PageSkeleton from '../../components/PageSkeleton'
import PlatformEmptyState from '../../components/platform/PlatformEmptyState'
import { StructuredErrorBanner } from '../../components/StructuredErrorBanner'
import { hostErrorPresentation } from '../../utils/hostErrorPresentation'
import { getLocalFirewallInventory } from '../../api/advanced'
import JsonInspector from '../../components/platform/JsonInspector'
import {
  getPlatformHostDetail,
  getHostLinuxObservability,
  getHostLinuxUpdates,
  getHostNetworkDiag,
  getHostLinuxAudit,
  getHostLldp,
  diagnoseHost,
  hostMaintenance,
  syncHost,
  fenceHost,
  patchHost,
  enqueueValidateHost,
  type PlatformHostDetail,
  type HostLinuxObservability,
  type HostLinuxUpdates,
  type HostNetworkDiag,
  type HostLinuxAuditReport,
  type HostLldpInventory,
  type HostOsDiagnoseReport,
} from '../../api/platform'
import { getFirewallTarget, type FirewallTargetDetail } from '../../api/zeusFirewall'
import { useAi } from '../../contexts/AiContext'
import { useToastContext } from '../../contexts/ToastContext'
import { formatUserError } from '../../utils/apiError'
import {hostStateTone, httpStatusTone, migrationReadinessTone, riskTone, statusBadgeClasses, statusPillClasses, statusToneClass, taskStatusTone, utilizationBarClass, webhookDeliveryTone, hubLinkClasses} from '../../utils/semanticColors'
import { openCenterPopout } from '../../utils/platformCenterPopout'
import { hostClassicTools } from '../../utils/platformClassicTools'
import { PlatformClassicToolLinks } from '../../components/platform/PlatformCrossLinks'

type HostSection = 'general' | 'network' | 'linux' | 'security' | 'audit'

const SECTIONS: Array<{ id: HostSection; label: string; icon: React.ReactNode }> = [
  { id: 'general', label: 'General', icon: <Server className="w-4 h-4" /> },
  { id: 'network', label: 'Network', icon: <Network className="w-4 h-4" /> },
  { id: 'linux', label: 'Linux', icon: <Activity className="w-4 h-4" /> },
  { id: 'security', label: 'Security', icon: <Shield className="w-4 h-4" /> },
  { id: 'audit', label: 'Audit', icon: <FileWarning className="w-4 h-4" /> },
]

function psiBar(label: string, pct: number) {
  return (
    <div key={label} className="space-y-1">
      <div className="flex justify-between text-xs text-slate-400">
        <span>{label}</span>
        <span>{pct.toFixed(1)}%</span>
      </div>
      <div className="h-1.5 rounded-full bg-slate-800 overflow-hidden">
        <div className={`h-full rounded-full ${utilizationBarClass(pct, { warn: 20, error: 50 })}`} style={{ width: `${Math.min(100, pct)}%` }} />
      </div>
    </div>
  )
}

export default function PlatformHostDetailPage() {
  const { id } = useParams<{ id: string }>()
  const location = useLocation()
  const toast = useToastContext()
  const { openCopilot, setContextHostId } = useAi()
  const [section, setSection] = useState<HostSection>('general')
  const [host, setHost] = useState<PlatformHostDetail | null>(null)
  const [linuxObs, setLinuxObs] = useState<HostLinuxObservability | null>(null)
  const [linuxUpdates, setLinuxUpdates] = useState<HostLinuxUpdates | null>(null)
  const [netDiag, setNetDiag] = useState<HostNetworkDiag | null>(null)
  const [audit, setAudit] = useState<HostLinuxAuditReport | null>(null)
  const [lldp, setLldp] = useState<HostLldpInventory | null>(null)
  const [firewall, setFirewall] = useState<FirewallTargetDetail | null>(null)
  const [diagnose, setDiagnose] = useState<HostOsDiagnoseReport | null>(null)
  const [diagnoseLoading, setDiagnoseLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [notes, setNotes] = useState('')
  const [localFw, setLocalFw] = useState<Record<string, unknown> | null>(null)
  const [site, setSite] = useState('')
  const [rack, setRack] = useState('')
  const [rackU, setRackU] = useState('')
  const [fenceMethod, setFenceMethod] = useState('shell')
  const [ipmiAddress, setIpmiAddress] = useState('')
  const [ipmiUser, setIpmiUser] = useState('')
  const [ipmiPass, setIpmiPass] = useState('')

  const load = useCallback(async () => {
    if (!id) return
    setError(null)
    setLoading(true)
    try {
      const h = await getPlatformHostDetail(id)
      setHost(h)
      setNotes(h.notes || '')
      setSite(h.site || '')
      setRack(h.rack || '')
      setRackU(h.rack_u != null ? String(h.rack_u) : '')
    } catch (e: unknown) {
      setError(formatUserError(e))
    } finally {
      setLoading(false)
    }
  }, [id])

  const loadOs = useCallback(async () => {
    if (!id) return
    if (section === 'network') {
      const [d, l] = await Promise.all([
        getHostNetworkDiag(id).catch(() => null),
        getHostLldp(id).catch(() => null),
      ])
      setNetDiag(d)
      setLldp(l)
    }
    if (section === 'linux') {
      const [obs, updates] = await Promise.all([
        getHostLinuxObservability(id).catch(() => null),
        getHostLinuxUpdates(id).catch(() => null),
      ])
      setLinuxObs(obs)
      setLinuxUpdates(updates)
    }
    if (section === 'audit') {
      setAudit(await getHostLinuxAudit(id).catch(() => null))
    }
    if (section === 'security') {
      setFirewall(await getFirewallTarget(id).catch(() => null))
    }
  }, [id, section])

  const runDiagnose = useCallback(async (query?: string) => {
    if (!id) return
    setDiagnoseLoading(true)
    try {
      setDiagnose(await diagnoseHost(id, query))
    } catch {
      setDiagnose(null)
    } finally {
      setDiagnoseLoading(false)
    }
  }, [id])

  useEffect(() => { void load() }, [load])
  useEffect(() => { void loadOs() }, [loadOs])
  useEffect(() => {
    void getLocalFirewallInventory().then(setLocalFw).catch(() => setLocalFw(null))
  }, [])
  useEffect(() => {
    setContextHostId(id ?? null)
    return () => setContextHostId(null)
  }, [id, setContextHostId])

  if (!id) return null

  const cpuPsi = (linuxObs?.pressure?.cpu?.some ?? 0) * 100
  const memPsi = (linuxObs?.pressure?.memory?.some ?? 0) * 100
  const ioPsi = (linuxObs?.pressure?.io?.some ?? 0) * 100

  return (
    <PageLayout hideHeader compact contentClassName="space-y-4">
      <Link to="/platform/hosts" className={`text-sm flex items-center gap-1 ${hubLinkClasses()}`}>
        <ArrowLeft className="w-4 h-4" /> Hosts
      </Link>
      {error && (hostErrorPresentation(error) ? (
        <StructuredErrorBanner error={hostErrorPresentation(error)!} />
      ) : (
        <ErrorBanner message={error} />
      ))}
      {error && hostErrorPresentation(error)?.error_code === 'host_agent_offline' && (
        <p className="text-xs text-slate-500">
          <Link to="/platform/enroll" className={hubLinkClasses()}>Add Host / re-enroll agent</Link>
          {' · '}
          <Link to="/node" className={hubLinkClasses()}>Classic node tools</Link>
        </p>
      )}
      {loading && !host && <PageSkeleton />}
      {host && (
        <>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-sm text-slate-400">
              {host.validation_status || 'pending'} · {host.state}{host.fenced ? ' · fenced' : ''}
            </p>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                className="btn-secondary text-xs flex items-center gap-1"
                onClick={() => openCenterPopout(`${location.pathname}${location.search}`)}
              >
                <ExternalLink className="w-3 h-3" /> Pop Out
              </button>
              <button
                type="button"
                className="btn-secondary text-xs flex items-center gap-1"
                onClick={() => { openCopilot(); void runDiagnose('why is this host under pressure') }}
              >
                <Bot className="w-3 h-3" /> Ask Copilot about this host
              </button>
            </div>
          </div>
          <MacSettingsPane
            title={host.hostname}
            sections={SECTIONS}
            active={section}
            onSelect={(s) => setSection(s as HostSection)}
          >
            {section === 'general' && (
              <div className="space-y-6">
                {(host.validation_report?.length ?? 0) > 0 && (
                  <MacSettingsGroup title="Join validation">
                    <ul className="p-3 text-sm space-y-2">
                      {host.validation_report!.map((c) => (
                        <li key={c.name} className={statusToneClass(c.passed ? 'ok' : 'error')}>
                          <span className="font-mono text-xs">{c.name}</span>: {c.message}
                        </li>
                      ))}
                    </ul>
                  </MacSettingsGroup>
                )}
                <MacSettingsGroup title="Actions">
                  <div className="p-3 flex flex-wrap gap-2">
                    <button type="button" className="btn-secondary text-sm" onClick={() => void syncHost(id).then(() => toast.success('Sync queued')).catch((e: unknown) => setError(formatUserError(e)))}>Sync</button>
                    <button type="button" className="btn-secondary text-sm" onClick={() => void enqueueValidateHost(id).then(() => { toast.success('Validation queued'); return load() })}>Validate</button>
                    <button type="button" className="btn-secondary text-sm" onClick={() => void hostMaintenance(id, 'enter').then(() => toast.success('Maintenance'))}>Maintenance</button>
                    <button type="button" className="btn-danger text-sm" onClick={() => void fenceHost(id).then(() => { toast.success('Fence invoked'); return load() })}>Fence</button>
                  </div>
                </MacSettingsGroup>
                <MacSettingsGroup title="Hardware">
                  <div className="p-3 grid gap-2 text-sm md:grid-cols-2">
                    <div>CPU: {host.cpu_model || '—'}</div>
                    <div>Load: {host.cpu_percent?.toFixed(0)}% · {host.memory_used_mib}/{host.memory_total_mib} MiB</div>
                    <div>Libvirt: {host.libvirt_version || '—'}</div>
                    <div>QEMU: {host.qemu_version || '—'}</div>
                    <div className="md:col-span-2 font-mono text-xs text-slate-500">{host.libvirt_uri}</div>
                  </div>
                </MacSettingsGroup>
                <MacSettingsGroup title="Datacenter location">
                  <p className="px-3 pt-3 text-xs text-slate-500">
                    Organize this host on the Mission Control map (site → rack → U position).
                  </p>
                  <div className="p-3 grid gap-3 sm:grid-cols-3">
                    <label className="space-y-1 text-sm">
                      <span className="text-slate-400 text-xs">Site</span>
                      <input className="input w-full text-sm" value={site} onChange={(e) => setSite(e.target.value)} placeholder="e.g. Pune" />
                    </label>
                    <label className="space-y-1 text-sm">
                      <span className="text-slate-400 text-xs">Rack</span>
                      <input className="input w-full text-sm" value={rack} onChange={(e) => setRack(e.target.value)} placeholder="e.g. Rack 01" />
                    </label>
                    <label className="space-y-1 text-sm">
                      <span className="text-slate-400 text-xs">Rack U</span>
                      <input className="input w-full text-sm" type="number" min={1} max={52} value={rackU} onChange={(e) => setRackU(e.target.value)} placeholder="12" />
                    </label>
                  </div>
                  <div className="px-3 pb-3">
                    <button
                      type="button"
                      className="btn-secondary text-sm"
                      onClick={() => {
                        const parsedU = rackU.trim() === '' ? null : Number(rackU)
                        void patchHost(id, {
                          site: site.trim(),
                          rack: rack.trim(),
                          rack_u: parsedU != null && !Number.isNaN(parsedU) ? parsedU : null,
                        }).then(() => { toast.success('Location saved'); return load() })
                      }}
                    >
                      Save location
                    </button>
                  </div>
                </MacSettingsGroup>
                <MacSettingsGroup title="Notes">
                  <div className="p-3 space-y-2">
                    <textarea className="input min-h-20 text-sm w-full" value={notes} onChange={(e) => setNotes(e.target.value)} />
                    <button type="button" className="btn-secondary text-sm" onClick={() => void patchHost(id, { notes }).then(() => { toast.success('Notes saved'); return load() })}>Save</button>
                  </div>
                </MacSettingsGroup>
                <MacSettingsGroup title="Classic hypervisor tools">
                  <div className="p-3">
                    <p className="text-xs text-slate-500 mb-3 leading-relaxed">
                      Deep libvirt, device passthrough, host SSH, and capability matrix — classic Machina UI on this daemon.
                    </p>
                    <PlatformClassicToolLinks tools={hostClassicTools()} />
                    <Link to={`/node?host=${encodeURIComponent(host.hostname)}`} className={`text-xs inline-block mt-2 ${hubLinkClasses()}`}>Open NodeInfo →</Link>
                    {localFw ? (
                      <div className="mt-3">
                        <p className="text-xs text-slate-500 mb-2">Local firewall inventory (daemon fallback)</p>
                        <JsonInspector data={localFw} />
                      </div>
                    ) : null}
                    <Link to="/platform/placement" className={`text-xs inline-block mt-3 ${hubLinkClasses()}`}>
                      HA status & fence events →
                    </Link>
                  </div>
                </MacSettingsGroup>
              </div>
            )}

            {section === 'network' && (
              <div className="space-y-4">
                {netDiag ? (
                  <MacGlassPanel title="systemd networking">
                    <div className="grid gap-2 sm:grid-cols-2 text-sm mb-3">
                      <div>networkd: <span className={statusToneClass(netDiag.systemd_networkd_active ? 'ok' : 'warn')}>{netDiag.systemd_networkd_active ? 'active' : 'inactive'}</span></div>
                      <div>resolved: <span className={statusToneClass(netDiag.resolved_active ? 'ok' : 'warn')}>{netDiag.resolved_active ? 'active' : 'inactive'}</span></div>
                    </div>
                    {(netDiag.interfaces ?? []).slice(0, 8).map((iface) => (
                      <MacListRow key={iface.name} title={iface.name} subtitle={(iface.addresses ?? []).join(', ') || iface.state || '—'} />
                    ))}
                  </MacGlassPanel>
                ) : (
                  <PlatformEmptyState
                    icon={Network}
                    title="Network diagnostics unavailable"
                    subtitle="Install or reconnect the host agent to load systemd-networkd and interface data."
                    action={
                      <div className="flex flex-wrap gap-2">
                        <Link to="/platform/enroll" className="btn-primary text-sm">Enroll agent</Link>
                        <Link to="/node" className="btn-secondary text-sm">Classic node tools</Link>
                      </div>
                    }
                  />
                )}
                {lldp && lldp.neighbors.length > 0 && (
                  <MacGlassPanel title={`LLDP (${lldp.source})`}>
                    {lldp.neighbors.slice(0, 10).map((n, i) => (
                      <MacListRow key={i} title={n.system_name || n.chassis_id || 'neighbor'} subtitle={`${n.local_interface} → ${n.port_id || n.port_description}`} />
                    ))}
                  </MacGlassPanel>
                )}
              </div>
            )}

            {section === 'linux' && (
              <div className="space-y-4">
                {linuxObs ? (
                  <>
                    <MacGlassPanel title="Pressure stall (PSI)">
                      <div className="space-y-3">
                        {psiBar('CPU', cpuPsi)}
                        {psiBar('Memory', memPsi)}
                        {psiBar('I/O', ioPsi)}
                      </div>
                    </MacGlassPanel>
                    {(linuxObs.thermal ?? []).length > 0 && (
                      <MacGlassPanel title="Thermal">
                        {(linuxObs.thermal ?? []).map((t) => (
                          <MacListRow key={t.sensor} title={t.label || t.sensor} subtitle={`${t.temp_celsius.toFixed(1)}°C`} />
                        ))}
                      </MacGlassPanel>
                    )}
                    {(linuxObs.smart ?? []).length > 0 && (
                      <MacGlassPanel title="Disk SMART">
                        {(linuxObs.smart ?? []).map((d) => (
                          <MacListRow
                            key={d.device}
                            title={d.device}
                            subtitle={d.summary}
                            badge={!d.passed ? <span className={`text-[10px] ${statusToneClass('error')}`}>fail</span> : undefined}
                          />
                        ))}
                      </MacGlassPanel>
                    )}
                    {linuxUpdates && (
                      <MacGlassPanel title="Package updates" subtitle={linuxUpdates.summary}>
                        {(linuxUpdates.packages ?? []).length === 0 ? (
                          <p className="text-sm text-slate-400">No pending updates.</p>
                        ) : (
                          <ul className="divide-y divide-white/[0.04] -mx-1 max-h-48 overflow-y-auto">
                            {linuxUpdates.packages.slice(0, 20).map((p) => (
                              <MacListRow
                                key={p.name}
                                title={p.name}
                                subtitle={`${p.current} → ${p.available}`}
                                badge={p.security ? <span className={`text-[10px] ${statusToneClass('warn')}`}>security</span> : undefined}
                              />
                            ))}
                          </ul>
                        )}
                      </MacGlassPanel>
                    )}
                  </>
                ) : (
                  <PlatformEmptyState
                    icon={Activity}
                    title="Linux observability unavailable"
                    subtitle="PSI, thermal, SMART, and package data require a connected host agent."
                    action={
                      <div className="flex flex-wrap gap-2">
                        <Link to="/platform/enroll" className="btn-primary text-sm">Enroll agent</Link>
                        <Link to="/node" className={`text-sm self-center ${hubLinkClasses()}`}>Classic node tools →</Link>
                      </div>
                    }
                  />
                )}
                <OsDiagnosePanel
                  resourceId={id}
                  resourceKind="host"
                  defaultQuery="why is this host under pressure"
                  loading={diagnoseLoading}
                  report={diagnose}
                  onRun={(q) => void runDiagnose(q)}
                  onAskCopilot={openCopilot}
                />
              </div>
            )}

            {section === 'security' && (
              <div className="space-y-4">
                <MacGlassPanel title="Machine Security">
                  {firewall ? (
                    <div className="text-sm space-y-2 mb-3">
                      <div className="flex flex-wrap gap-3 text-slate-300">
                        <span>Profile: {firewall.target.profile || 'default'}</span>
                        <span>Risk: {firewall.target.risk}</span>
                        <span>Score: {firewall.target.score}</span>
                        <span>{firewall.target.open_ports} open port(s)</span>
                      </div>
                      <p className={`text-xs ${statusToneClass(riskTone(firewall.target.risk))}`}>
                        {firewall.target.agent_reachable ? 'Agent reachable' : 'Agent offline'} · backend {firewall.target.backend}
                      </p>
                    </div>
                  ) : (
                    <p className="text-sm text-slate-500 mb-3">Firewall summary unavailable.</p>
                  )}
                  <p className="text-sm text-slate-400 mb-3">Zeus Firewall profiles, stealth mode, and port exposure for this hypervisor.</p>
                  <div className="flex flex-wrap gap-2">
                    <Link to={`/platform/zeus/security/firewall/${id}`} className="btn-secondary text-sm inline-flex items-center gap-2">
                      <Shield className="w-4 h-4" /> Open Zeus Firewall
                    </Link>
                    <Link to="/platform/zeus/security/compliance" className="btn-secondary text-sm inline-flex items-center gap-2">
                      Compliance & SIEM
                    </Link>
                    <Link to="/platform/placement" className={`text-sm self-center ${hubLinkClasses()}`}>
                      Fence events →
                    </Link>
                  </div>
                </MacGlassPanel>
                <OsDiagnosePanel
                  resourceId={id}
                  resourceKind="host"
                  defaultQuery="firewall drift on this host"
                  loading={diagnoseLoading}
                  report={diagnose}
                  onRun={(q) => void runDiagnose(q)}
                  onAskCopilot={openCopilot}
                />
              </div>
            )}

            {section === 'audit' && (
              <MacGlassPanel title="Linux audit">
                {audit ? (
                  <div className="text-sm space-y-2">
                    <p className="text-slate-300">{audit.summary || 'Audit report loaded'}</p>
                    <div className="grid gap-2 sm:grid-cols-2 text-slate-400">
                      <div>auditd: {audit.auditd_active ? 'active' : 'inactive'}</div>
                      <div>rules: {audit.rules_count ?? '—'}</div>
                      <div>recent events: {audit.recent_events ?? '—'}</div>
                    </div>
                  </div>
                ) : (
                  <p className="text-sm text-slate-500">Audit report unavailable.</p>
                )}
              </MacGlassPanel>
            )}
          </MacSettingsPane>
        </>
      )}
    </PageLayout>
  )
}
