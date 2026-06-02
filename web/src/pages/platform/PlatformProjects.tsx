// Copyright (c) 2026 ZyvorAI Labs Private Limited. All rights reserved.

import { useCallback, useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router'
import { Boxes, LayoutGrid, Monitor, Server } from 'lucide-react'
import {
  MacGlassPanel,
  MacStatWidget,
} from '../../components/platform/mac/PlatformMacUi'
import PlatformPageChrome, { PlatformRefreshButton } from '../../components/platform/PlatformPageChrome'
import FleetSettingsPane from '../../components/platform/FleetSettingsPane'
import { getFleetSpaces, type FleetSpacesOverview } from '../../api/platform'
import { useActiveWorkspace } from '../../hooks/useActiveWorkspace'
import { formatUserError } from '../../utils/apiError'
import {hostStateTone, httpStatusTone, migrationReadinessTone, riskTone, statusBadgeClasses, statusPillClasses, statusToneClass, taskStatusTone, webhookDeliveryTone, hubLinkClasses} from '../../utils/semanticColors'

function SpaceCard({
  name,
  vmCount,
  runningCount,
  hostCount,
  isolation,
  active,
  onSelect,
}: {
  name: string
  vmCount: number
  runningCount: number
  hostCount: number
  isolation: string
  active: boolean
  onSelect: () => void
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      className={`shrink-0 w-44 rounded-2xl border p-4 text-left transition ${
        active
          ? 'border-violet-400/50 bg-violet-500/15 ring-1 ring-violet-400/30'
          : 'border-white/[0.08] bg-slate-900/50 hover:border-white/[0.14] hover:bg-slate-800/60'
      }`}
    >
      <div className="flex items-center gap-2 mb-2">
        <LayoutGrid className={`w-4 h-4 ${active ? 'text-violet-300' : 'text-slate-400'}`} />
        <span className="font-medium text-sm truncate">{name}</span>
      </div>
      <p className="text-xs text-slate-400">
        {runningCount}/{vmCount} running · {hostCount} host{hostCount === 1 ? '' : 's'}
      </p>
      <p className="text-[10px] uppercase tracking-wide text-slate-500 mt-2">{isolation}</p>
    </button>
  )
}

export default function PlatformProjects({ embedded }: { embedded?: boolean } = {}) {
  const navigate = useNavigate()
  const { workspace, setWorkspace } = useActiveWorkspace()
  const [fleet, setFleet] = useState<FleetSpacesOverview | null>(null)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    setError(null)
    try {
      setFleet(await getFleetSpaces())
    } catch (e: unknown) {
      setError(formatUserError(e))
    }
  }, [])

  useEffect(() => { void load() }, [load])

  const selectSpace = (name: string) => {
    const normalized = name === 'default' ? '' : name
    setWorkspace(normalized)
    if (normalized) navigate(`/platform/vms?project=${encodeURIComponent(normalized)}`)
    else navigate('/platform/vms')
  }

  const isActive = (name: string) => {
    const normalized = name === 'default' ? '' : name
    return workspace === normalized
  }

  return (
    <PlatformPageChrome
      hideHeader={embedded}
      compact={embedded}
      error={error}
      onErrorRetry={() => void load()}
      title={embedded ? undefined : 'Workspace Spaces'}
      subtitle={embedded ? undefined : 'macOS Stage Manager metaphor — each project is a space grouping fleet VMs. Click a space to focus the active workspace.'}
      icon={embedded ? undefined : <LayoutGrid className="w-6 h-6 text-slate-400" />}
      actions={embedded ? undefined : <PlatformRefreshButton onClick={() => void load()} />}
      contentClassName="space-y-4"
    >
      {fleet && <p className="text-sm text-slate-400">{fleet.summary}</p>}

      {fleet && (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <MacStatWidget label="Spaces" value={String(fleet.space_count)} icon={<LayoutGrid className="w-4 h-4" />} />
          <MacStatWidget label="Total VMs" value={String(fleet.total_vms)} icon={<Monitor className="w-4 h-4" />} />
          <MacStatWidget
            label="Running"
            value={String(fleet.running_vms)}
            icon={<Monitor className="w-4 h-4" />}
            tone={fleet.running_vms > 0 ? 'ok' : 'default'}
          />
          <MacStatWidget label="Active space" value={workspace || 'All'} icon={<Boxes className="w-4 h-4" />} />
        </div>
      )}

      {fleet && fleet.spaces.length > 0 && (
        <MacGlassPanel title="Spaces strip">
          <div className="flex gap-3 overflow-x-auto pb-2 -mx-1 px-1">
            <button
              type="button"
              onClick={() => selectSpace('')}
              className={`shrink-0 w-44 rounded-2xl border p-4 text-left transition ${
                !workspace
                  ? 'border-violet-400/50 bg-violet-500/15 ring-1 ring-violet-400/30'
                  : 'border-white/[0.08] bg-slate-900/50 hover:border-white/[0.14]'
              }`}
            >
              <div className="flex items-center gap-2 mb-2">
                <Boxes className="w-4 h-4 text-slate-400" />
                <span className="font-medium text-sm">All spaces</span>
              </div>
              <p className="text-xs text-slate-400">{fleet.total_vms} VM(s) fleet-wide</p>
            </button>
            {fleet.spaces.map((s) => (
              <SpaceCard
                key={s.name}
                name={s.name}
                vmCount={s.vm_count}
                runningCount={s.running_count}
                hostCount={s.host_count}
                isolation={s.network_isolation}
                active={isActive(s.name)}
                onSelect={() => selectSpace(s.name)}
              />
            ))}
          </div>
        </MacGlassPanel>
      )}

      {fleet && (
        <div className="card overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-slate-400 border-b border-slate-800">
                <th className="p-3 text-left">Space</th>
                <th className="p-3">VMs</th>
                <th className="p-3">Running</th>
                <th className="p-3">Hosts</th>
                <th className="p-3">Isolation</th>
                <th className="p-3">Quota</th>
                <th className="p-3" />
              </tr>
            </thead>
            <tbody>
              {fleet.spaces.map((s) => (
                <tr key={s.name} className="border-b border-slate-900">
                  <td className="p-3 font-medium">{s.name}</td>
                  <td className="p-3 text-center">{s.vm_count}</td>
                  <td className={`p-3 text-center ${statusToneClass('ok')}`}>{s.running_count}</td>
                  <td className="p-3 text-center">
                    <span className="inline-flex items-center gap-1 justify-center">
                      <Server className="w-3 h-3 text-slate-500" />
                      {s.host_count}
                    </span>
                  </td>
                  <td className="p-3 text-center text-xs uppercase text-slate-400">{s.network_isolation}</td>
                  <td className="p-3 text-center text-xs text-slate-400">{s.quota_status}</td>
                  <td className="p-3 text-right">
                    <Link
                      to={`/platform/vms?project=${encodeURIComponent(s.name === 'default' ? '' : s.name)}`}
                      className={`text-xs ${hubLinkClasses()}`}
                      onClick={() => selectSpace(s.name)}
                    >
                      Focus space
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <FleetSettingsPane kind="spaces" />
    </PlatformPageChrome>
  )
}
