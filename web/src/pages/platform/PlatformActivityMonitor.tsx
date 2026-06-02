// Copyright (c) 2026 ZyvorAI Labs Private Limited. All rights reserved.

import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router'
import { Activity, Server, Terminal } from 'lucide-react'
import PlatformEmptyState from '../../components/platform/PlatformEmptyState'
import DetailTabs from '../../components/platform/DetailTabs'
import { MacGlassPanel, MacListRow } from '../../components/platform/mac/PlatformMacUi'
import PlatformPageChrome, { PlatformBackLink, PlatformRefreshButton } from '../../components/platform/PlatformPageChrome'
import { getFleetActivity, type FleetActivityOverview } from '../../api/platform'
import { formatUserError } from '../../utils/apiError'
import {hostStateTone, httpStatusTone, migrationReadinessTone, riskTone, statusBadgeClasses, statusPillClasses, statusToneClass, taskStatusTone, utilizationBarClass, webhookDeliveryTone, hubLinkClasses} from '../../utils/semanticColors'

type Tab = 'vms' | 'hosts'

function bar(label: string, pct: number, tone: 'cpu' | 'mem' | 'io' | 'thermal') {
  const thresholds = tone === 'io' || tone === 'thermal'
    ? { warn: 20, error: 50 }
    : { warn: 60, error: 85 }
  return (
    <div className="flex items-center gap-2 text-[10px] text-slate-500">
      <span className="w-14 shrink-0">{label}</span>
      <div className="flex-1 h-1.5 rounded-full bg-slate-800 overflow-hidden">
        <div className={`h-full rounded-full ${utilizationBarClass(pct, thresholds)}`} style={{ width: `${Math.min(100, Math.max(0, pct))}%` }} />
      </div>
      <span className="w-10 text-right">{pct.toFixed(0)}%</span>
    </div>
  )
}

export default function PlatformActivityMonitor() {
  const [tab, setTab] = useState<Tab>('vms')
  const [data, setData] = useState<FleetActivityOverview | null>(null)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    setError(null)
    try {
      setData(await getFleetActivity())
    } catch (e: unknown) {
      setError(formatUserError(e))
      setData(null)
    }
  }, [])

  useEffect(() => { void load() }, [load])

  const maxVmMem = Math.max(1, ...(data?.top_vms.map((v) => v.memory_used_mib) ?? [1]))

  return (
    <PlatformPageChrome
      error={error}
      onErrorRetry={() => void load()}
      prepend={<PlatformBackLink to="/platform/operations" label="Operations" />}
      title="Activity Monitor"
      subtitle="Fleet-wide CPU, memory, and Linux PSI — macOS Activity Monitor for your hypervisors."
      icon={<Activity className="w-6 h-6 text-slate-400" />}
      actions={<PlatformRefreshButton onClick={() => void load()} />}
      contentClassName="space-y-4"
    >
      <div className="flex flex-wrap gap-3 text-xs">
        <Link to="/platform/placement" className={hubLinkClasses()}>HA status & fence events →</Link>
        <Link to="/platform/developer" className={hubLinkClasses()}>Developer SDK →</Link>
        <Link to="/platform/reports?tab=runbooks" className={hubLinkClasses()}>Ops runbooks →</Link>
        <Link to="/platform/integrations" className={hubLinkClasses()}>Classic tools →</Link>
      </div>
      {data && <p className="text-sm text-slate-400">{data.summary}</p>}

      <DetailTabs
        primary={[
          { id: 'vms', label: 'VMs' },
          { id: 'hosts', label: 'Hosts' },
        ]}
        active={tab}
        onChange={setTab}
      />

      {tab === 'vms' && (
        data?.top_vms.length ? (
          <ul className="space-y-2">
            {data.top_vms.map((vm) => {
              const memPct = Math.min(100, (vm.memory_used_mib / maxVmMem) * 100)
              return (
                <li key={vm.vm_id} className="platform-mac-stat rounded-xl border border-white/[0.06] bg-slate-900/50 p-4">
                  <div className="flex justify-between items-center mb-2">
                    <Link to={`/platform/vms/${vm.vm_id}`} className="font-medium text-slate-200 hover:text-blue-300">{vm.vm_name}</Link>
                    <span className="text-xs text-slate-500">{vm.memory_used_mib} / {vm.memory_mib} MiB</span>
                  </div>
                  <div className="space-y-1.5">
                    {bar('Memory', memPct, 'mem')}
                    {bar('CPU', vm.cpu_percent, 'cpu')}
                  </div>
                </li>
              )
            })}
          </ul>
        ) : (
          <PlatformEmptyState title="No running VMs" subtitle="Start a VM to see live CPU and memory usage." />
        )
      )}

      {tab === 'hosts' && (
        data?.hosts.length ? (
          <MacGlassPanel title="Hypervisor hosts" subtitle="Inventory CPU/memory + Linux PSI when agent online">
            {data.hosts.map((h) => (
              <div key={h.host_id} className="py-3 border-b border-white/[0.04] last:border-0">
                <MacListRow
                  title={h.hostname}
                  subtitle={`${h.vm_count} VM(s) · ${h.state} · ${h.status}`}
                  badge={
                    h.status !== 'ok' && h.status !== 'offline' ? (
                      <span className={`text-[10px] ${statusToneClass('warn')}`}>{h.status}</span>
                    ) : undefined
                  }
                  href={`/platform/hosts/${h.host_id}`}
                />
                <div className="mt-2 space-y-1 pl-1 max-w-md">
                  {bar('CPU', h.cpu_percent, 'cpu')}
                  {bar('Memory', h.memory_percent, 'mem')}
                  {h.io_pressure_pct > 0 && bar('IO PSI', h.io_pressure_pct, 'io')}
                  {h.thermal_max_c > 0 && bar('Thermal', Math.min(100, h.thermal_max_c), 'thermal')}
                </div>
              </div>
            ))}
          </MacGlassPanel>
        ) : (
          <PlatformEmptyState title="No hosts" subtitle="Enroll hypervisors to monitor fleet activity." />
        )
      )}
    </PlatformPageChrome>
  )
}
