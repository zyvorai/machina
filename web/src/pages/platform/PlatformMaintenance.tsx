// Copyright (c) 2026 ZyvorAI Labs Private Limited. All rights reserved.

import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router'
import {
  AlertTriangle,
  CalendarClock,
  Download,
  ListChecks,
  Loader2,
  Plus,
  RefreshCw,
  Trash2,
} from 'lucide-react'
import {
  MacGlassPanel,
  MacListRow,
  MacStatWidget,
} from '../../components/platform/mac/PlatformMacUi'
import DetailTabs from '../../components/platform/DetailTabs'
import PlatformPageChrome, { PlatformBackLink, PlatformRefreshButton } from '../../components/platform/PlatformPageChrome'
import { usePlatformTabState } from '../../hooks/usePlatformTabState'
import ErrorBanner from '../../components/ErrorBanner'
import PageSkeleton from '../../components/PageSkeleton'
import PlatformEmptyState from '../../components/platform/PlatformEmptyState'
import FleetSettingsPane from '../../components/platform/FleetSettingsPane'
import { BuildStepTimeline } from '../../components/BuildStepTimeline'
import {
  createMaintenanceSchedule,
  deleteMaintenanceSchedule,
  getFleetMaintenanceMission,
  getFleetUpdates,
  hostMaintenance,
  listMaintenanceSchedules,
  listPlatformHosts,
  upgradeHostAgent,
  type FleetMaintenanceMissionOverview,
  type FleetUpdatesOverview,
  type MaintenanceMissionHost,
  type MaintenanceSchedule,
  type MaintenanceStepStatus,
  type PlatformHost,
} from '../../api/platform'
import { useToastContext } from '../../contexts/ToastContext'
import { formatUserError } from '../../utils/apiError'
import { hubLinkClasses, statusChipClasses } from '../../utils/semanticColors'
import { operationsHubHref } from '../../utils/platformHubLinks'
import { usePlatformDesktopTier } from '../../hooks/usePlatformDesktopTier'

type TabId = 'mission' | 'updates' | 'schedules'

const MAINTENANCE_TABS = [
  { id: 'mission' as const, label: 'Mission' },
  { id: 'updates' as const, label: 'Updates' },
  { id: 'schedules' as const, label: 'Schedules' },
]

function missionTimelineProps(steps: MaintenanceMissionHost['steps']) {
  const labels = steps.map((s) => s.label)
  const firstActive = steps.findIndex((s) => s.status === 'ready' || s.status === 'pending' || s.status === 'blocked')
  const allComplete = steps.every((s) => s.status === 'done' || s.status === 'skipped')
  const failed = steps.some((s) => s.status === 'blocked')
  const activeIndex = firstActive < 0 ? (allComplete ? steps.length : 0) : firstActive
  return { labels, activeIndex, allComplete, failed }
}

function stepTone(status: MaintenanceStepStatus): string {
  if (status === 'done') return statusChipClasses('ok')
  if (status === 'ready') return statusChipClasses('info')
  if (status === 'blocked') return statusChipClasses('error')
  if (status === 'skipped') return 'text-slate-500 border-white/[0.06]'
  return 'text-slate-400 border-white/[0.08]'
}

export default function PlatformMaintenance() {
  const toast = useToastContext()
  const [tier] = usePlatformDesktopTier()
  const [tab, setTab] = usePlatformTabState<TabId>(MAINTENANCE_TABS.map((t) => t.id), { defaultTab: 'updates' })

  const [fleet, setFleet] = useState<FleetUpdatesOverview | null>(null)
  const [mission, setMission] = useState<FleetMaintenanceMissionOverview | null>(null)
  const [rows, setRows] = useState<MaintenanceSchedule[]>([])
  const [hosts, setHosts] = useState<PlatformHost[]>([])
  const [error, setError] = useState<string | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)
  const [pageLoading, setPageLoading] = useState(true)
  const [loadingUpdates, setLoadingUpdates] = useState(false)
  const [hostId, setHostId] = useState('')
  const [missionHostId, setMissionHostId] = useState('')
  const [runAt, setRunAt] = useState('')
  const [defaultTabSet, setDefaultTabSet] = useState(false)

  const loadSchedules = useCallback(async () => {
    const [schedules, hostRows] = await Promise.all([listMaintenanceSchedules(), listPlatformHosts()])
    setRows(schedules)
    setHosts(hostRows)
    if (!hostId && hostRows[0]) setHostId(hostRows[0].id)
  }, [hostId])

  const loadUpdates = useCallback(async () => {
    setLoadingUpdates(true)
    setError(null)
    try {
      const data = await getFleetUpdates()
      setFleet(data)
      if (!defaultTabSet && data.hosts_with_updates > 0) {
        setDefaultTabSet(true)
        setTab('mission')
      }
    } catch (e: unknown) {
      setError(formatUserError(e))
      setFleet(null)
    } finally {
      setLoadingUpdates(false)
    }
  }, [defaultTabSet, setTab])

  const loadMission = useCallback(async () => {
    setError(null)
    const data = await getFleetMaintenanceMission()
    setMission(data)
    if (!missionHostId && data.hosts[0]) setMissionHostId(data.hosts[0].host_id)
    else if (missionHostId && !data.hosts.some((h) => h.host_id === missionHostId) && data.hosts[0]) {
      setMissionHostId(data.hosts[0].host_id)
    }
  }, [missionHostId])

  const load = useCallback(async () => {
    setError(null)
    setPageLoading(true)
    try {
      if (tab === 'updates') {
        await loadUpdates()
      } else if (tab === 'mission') {
        await loadMission()
      } else {
        await loadSchedules()
      }
    } catch (e: unknown) {
      setError(formatUserError(e))
    } finally {
      setPageLoading(false)
    }
  }, [tab, loadUpdates, loadSchedules, loadMission])

  useEffect(() => { void load() }, [load])

  const hostName = (id: string) => hosts.find((h) => h.id === id)?.hostname || id.slice(0, 8)
  const selectedMission = mission?.hosts.find((h) => h.host_id === missionHostId) ?? mission?.hosts[0] ?? null
  const timeline = selectedMission ? missionTimelineProps(selectedMission.steps) : null

  const runMissionAction = async (label: string, fn: () => Promise<unknown>) => {
    setActionError(null)
    try {
      await fn()
      toast.success(`${label} queued`)
      await loadMission()
    } catch (e: unknown) {
      setActionError(formatUserError(e))
    }
  }

  return (
    <PlatformPageChrome
      error={error}
      onErrorRetry={() => void load()}
      prepend={<PlatformBackLink to="/platform/operations" label="Operations" />}
      title="Maintenance"
      subtitle="Fleet patch catalog, maintenance mission timeline, and deferred windows — guided orchestration only."
      icon={<Download className="w-6 h-6 text-slate-400" />}
      actions={<PlatformRefreshButton onClick={() => void load()} />}
      contentClassName="space-y-4"
    >
      <DetailTabs primary={MAINTENANCE_TABS} active={tab} onChange={setTab} />

      {actionError && <ErrorBanner message={actionError} />}
      {pageLoading && <PageSkeleton />}

      {!pageLoading && tab === 'mission' && mission && (
        <div className="space-y-4">
          <p className="text-sm text-slate-400">{mission.summary}</p>
          <div className="grid gap-3 sm:grid-cols-3">
            <MacStatWidget label="Hosts with updates" value={String(mission.hosts_with_updates)} icon={<Download className="w-4 h-4" />} tone={mission.hosts_with_updates > 0 ? 'warn' : 'ok'} />
            <MacStatWidget label="In maintenance" value={String(mission.hosts_in_maintenance)} icon={<AlertTriangle className="w-4 h-4" />} tone={mission.hosts_in_maintenance > 0 ? 'warn' : 'ok'} />
            <MacStatWidget label="Pending schedules" value={String(mission.pending_schedules)} icon={<CalendarClock className="w-4 h-4" />} />
          </div>

          {mission.hosts.length === 0 ? (
            <PlatformEmptyState icon={ListChecks} title="No hosts" subtitle="Enroll hypervisors to run a maintenance mission." />
          ) : (
            <>
              <div className="flex flex-wrap gap-3 items-center">
                <label className="text-xs text-slate-500">Host</label>
                <select
                  className="input max-w-xs"
                  value={selectedMission?.host_id ?? ''}
                  onChange={(e) => setMissionHostId(e.target.value)}
                >
                  {mission.hosts.map((h) => (
                    <option key={h.host_id} value={h.host_id}>{h.hostname}</option>
                  ))}
                </select>
                <Link to={`/platform/hosts/${selectedMission?.host_id}`} className={`text-xs ${hubLinkClasses()}`}>
                  Host Linux tab →
                </Link>
                <Link to={operationsHubHref(tier)} className={`text-xs ${hubLinkClasses()}`}>
                  Operations hub →
                </Link>
              </div>

              {selectedMission && timeline && (
                <>
                  <BuildStepTimeline
                    steps={timeline.labels}
                    activeIndex={timeline.activeIndex}
                    allComplete={timeline.allComplete}
                    failed={timeline.failed}
                    variant="amber"
                  />
                  <div className="flex flex-wrap gap-2">
                    {selectedMission.steps.map((s) => (
                      <span key={s.id} className={`text-[10px] uppercase px-2 py-0.5 rounded border ${stepTone(s.status)}`}>
                        {s.label}: {s.status}
                      </span>
                    ))}
                  </div>
                  {selectedMission.blockers.length > 0 && (
                    <p className="text-sm text-amber-200/90">{selectedMission.blockers.join(' ')}</p>
                  )}
                  {selectedMission.update_summary && (
                    <p className="text-xs text-slate-500">{selectedMission.update_summary}</p>
                  )}

                  <MacGlassPanel title="Operator actions" subtitle="Confirmed steps only — no autonomous package apply.">
                    <div className="flex flex-wrap gap-2">
                      <button
                        type="button"
                        className="btn-secondary text-sm"
                        onClick={() => {
                          const dt = new Date(Date.now() + 3600_000)
                          const local = new Date(dt.getTime() - dt.getTimezoneOffset() * 60_000)
                            .toISOString()
                            .slice(0, 16)
                          setRunAt(local)
                          setTab('schedules')
                          setHostId(selectedMission.host_id)
                        }}
                      >
                        Open schedules
                      </button>
                      <button
                        type="button"
                        className="btn-primary text-sm"
                        disabled={selectedMission.maintenance_mode}
                        onClick={() => void runMissionAction('Enter maintenance', () =>
                          hostMaintenance(selectedMission.host_id, 'enter', true),
                        )}
                      >
                        Enter maintenance
                      </button>
                      <button
                        type="button"
                        className="btn-secondary text-sm"
                        disabled={!selectedMission.maintenance_mode}
                        onClick={() => void runMissionAction('Exit maintenance', () =>
                          hostMaintenance(selectedMission.host_id, 'exit', false),
                        )}
                      >
                        Exit maintenance
                      </button>
                      {selectedMission.agent_drift && (
                        <button
                          type="button"
                          className="btn-secondary text-sm"
                          onClick={() => void runMissionAction('Agent upgrade', () =>
                            upgradeHostAgent(selectedMission.host_id),
                          )}
                        >
                          Upgrade agent
                        </button>
                      )}
                      <Link
                        to={`/platform/hosts/${selectedMission.host_id}?tab=linux`}
                        className="btn-secondary text-sm inline-flex items-center"
                      >
                        Package preview (host)
                      </Link>
                    </div>
                  </MacGlassPanel>
                </>
              )}
            </>
          )}
        </div>
      )}

      {!pageLoading && tab === 'updates' && (
        <div className="space-y-4">
          {fleet && (
            <>
              <p className="text-sm text-slate-400">{fleet.summary}</p>
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                <MacStatWidget label="Hosts scanned" value={String(fleet.hosts_scanned)} icon={<Download className="w-4 h-4" />} />
                <MacStatWidget
                  label="OS updates"
                  value={String(fleet.hosts_with_updates)}
                  icon={<AlertTriangle className="w-4 h-4" />}
                  tone={fleet.hosts_with_updates > 0 ? 'warn' : 'ok'}
                />
                <MacStatWidget
                  label="Reboot required"
                  value={String(fleet.hosts_reboot_required)}
                  icon={<RefreshCw className="w-4 h-4" />}
                  tone={fleet.hosts_reboot_required > 0 ? 'warn' : 'ok'}
                />
                <MacStatWidget
                  label="Agent drift"
                  value={String(fleet.agent_drift_count)}
                  icon={<Download className="w-4 h-4" />}
                  tone={fleet.agent_drift_count > 0 ? 'warn' : 'ok'}
                />
              </div>
              <p className="text-xs text-slate-500">
                Recommended agent: <span className="text-slate-300 font-mono">{fleet.recommended_agent}</span>
                {fleet.total_pending_packages > 0 && (
                  <> · <span className="text-slate-300">{fleet.total_pending_packages}</span> pending package(s) counted</>
                )}
              </p>
            </>
          )}
          {!fleet && loadingUpdates && (
            <div className="flex items-center gap-2 text-sm text-slate-400 py-8">
              <Loader2 className="w-4 h-4 animate-spin" /> Probing host package managers…
            </div>
          )}
          {fleet && (
            <MacGlassPanel title="Host patch catalog" subtitle="Read-only apt/dnf/apk/pacman/zypper probes via enrolled agents.">
              {fleet.hosts.length === 0 ? (
                <p className="text-sm text-slate-400">No online hosts to scan.</p>
              ) : (
                <div className="divide-y divide-white/[0.04] -mx-1">
                  {fleet.hosts.map((h) => (
                    <MacListRow
                      key={h.host_id}
                      title={h.hostname}
                      subtitle={
                        h.summary
                        ?? (h.pending_count != null ? `${h.pending_count} pending (${h.backend})` : h.backend)
                      }
                      href={`/platform/hosts/${h.host_id}`}
                      badge={
                        <span className={`text-[10px] uppercase px-2 py-0.5 rounded border ${
                          h.status === 'ok'
                            ? statusChipClasses('ok', 'border')
                            : h.status === 'unreachable'
                              ? 'text-slate-400 border-white/[0.08]'
                              : statusChipClasses('warn', 'border')
                        }`}>
                          {h.reboot_required ? 'reboot' : h.status}
                        </span>
                      }
                      trailing={
                        <div className="flex flex-col items-end gap-1">
                          {h.agent_update_available ? (
                            <button
                              type="button"
                              className="text-[10px] text-violet-300 hover:underline"
                              onClick={(e) => {
                                e.preventDefault()
                                void upgradeHostAgent(h.host_id).then((r) => {
                                  toast.success(`Agent upgrade queued (${r.task_id})`)
                                }).catch((err: unknown) => toast.error(formatUserError(err)))
                              }}
                            >
                              Upgrade agent
                            </button>
                          ) : null}
                        </div>
                      }
                    />
                  ))}
                </div>
              )}
              <p className="text-xs text-slate-500 mt-4">
                Apply upgrades on-host or use the{' '}
                <button type="button" className="text-orange-300 hover:underline" onClick={() => setTab('mission')}>
                  Maintenance mission
                </button>{' '}
                tab. Package probes may take up to 45s per hypervisor.
              </p>
            </MacGlassPanel>
          )}
        </div>
      )}

      {tab === 'schedules' && !pageLoading && (
        <>
          <div className="card p-4 grid gap-3 md:grid-cols-4">
            <select className="input" value={hostId} onChange={(e) => setHostId(e.target.value)}>
              {hosts.map((h) => <option key={h.id} value={h.id}>{h.hostname}</option>)}
            </select>
            <input className="input md:col-span-2" type="datetime-local" value={runAt} onChange={(e) => setRunAt(e.target.value)} />
            <button
              type="button"
              className="btn-primary w-fit flex items-center gap-2"
              disabled={!hostId || !runAt}
              data-testid="schedule-maintenance-btn"
              onClick={async () => {
                setActionError(null)
                try {
                  await createMaintenanceSchedule({
                    host_id: hostId,
                    action: 'enter',
                    evacuate: true,
                    run_at: new Date(runAt).toISOString(),
                  })
                  toast.success('Schedule created')
                  await loadSchedules()
                } catch (e: unknown) {
                  setActionError(formatUserError(e))
                }
              }}
            >
              <Plus className="w-4 h-4" /> Schedule
            </button>
          </div>
          {rows.length === 0 ? (
            <PlatformEmptyState
              icon={CalendarClock}
              title="No maintenance windows"
              subtitle="Schedule deferred evacuate or patch windows for hypervisors."
            />
          ) : (
          <div className="card overflow-x-auto">
            <table className="w-full text-sm">
              <thead><tr className="text-slate-400 border-b border-slate-800"><th className="p-3 text-left">Host</th><th className="p-3">Action</th><th className="p-3">Run at</th><th className="p-3">Status</th><th className="p-3" /></tr></thead>
              <tbody>{rows.map((s) => (
                <tr key={s.id} className="border-b border-slate-900">
                  <td className="p-3">
                    <Link to={`/platform/hosts/${s.host_id}`} className={`hover:underline ${hubLinkClasses()}`}>{hostName(s.host_id)}</Link>
                  </td>
                  <td className="p-3">{s.action}{s.evacuate ? ' (evacuate)' : ''}</td>
                  <td className="p-3 text-slate-500">{new Date(s.run_at).toLocaleString()}</td>
                  <td className="p-3">{s.status}</td>
                  <td className="p-3 text-right">
                    {s.status === 'pending' && (
                      <button type="button" className="btn-secondary text-xs" onClick={async () => {
                        try { await deleteMaintenanceSchedule(s.id); toast.success('Cancelled'); await loadSchedules() } catch (e: unknown) { toast.error(formatUserError(e)) }
                      }}><Trash2 className="w-3 h-3 inline" /></button>
                    )}
                  </td>
                </tr>
              ))}</tbody>
            </table>
          </div>
          )}
        </>
      )}
      {tab === 'updates' && <FleetSettingsPane kind="updates" />}
    </PlatformPageChrome>
  )
}
