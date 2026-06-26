// Copyright (c) 2026 ZyvorAI Labs Private Limited. All rights reserved.

import { useCallback, useEffect, useState } from 'react'
import {
  Activity,
  AlertTriangle,
  CheckCircle2,
  RefreshCw,
  ShieldCheck,
  Zap,
} from 'lucide-react'
import PlatformPageChrome, { PlatformBackLink, PlatformRefreshButton } from '../../components/platform/PlatformPageChrome'
import { MacGlassPanel, MacListRow, MacStatWidget } from '../../components/platform/mac/PlatformMacUi'
import PlatformEmptyState from '../../components/platform/PlatformEmptyState'
import { useToastContext } from '../../contexts/ToastContext'
import { formatUserError } from '../../utils/apiError'
import {
  getHaStatus,
  listFenceEvents,
  fenceHost,
  listPlatformHosts,
  type HaStatusResponse,
  type FenceEvent,
  type PlatformHost,
} from '../../api/platform'

export default function PlatformHa() {
  const toast = useToastContext()
  const [status, setStatus] = useState<HaStatusResponse | null>(null)
  const [fenceEvents, setFenceEvents] = useState<FenceEvent[]>([])
  const [hosts, setHosts] = useState<PlatformHost[]>([])
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [fencing, setFencing] = useState<string | null>(null)

  const load = useCallback(async () => {
    setError(null)
    setLoading(true)
    try {
      const [ha, events, hostList] = await Promise.all([
        getHaStatus(),
        listFenceEvents(),
        listPlatformHosts(),
      ])
      setStatus(ha)
      setFenceEvents(events)
      setHosts(hostList)
    } catch (e: unknown) {
      setError(formatUserError(e))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { void load() }, [load])

  const handleFence = async (hostId: string, hostname: string) => {
    setFencing(hostId)
    try {
      await fenceHost(hostId)
      toast.success(`Fence initiated for ${hostname}`)
      await load()
    } catch (e: unknown) {
      toast.error(formatUserError(e))
    } finally {
      setFencing(null)
    }
  }

  return (
    <PlatformPageChrome
      error={error}
      onErrorRetry={() => void load()}
      prepend={<PlatformBackLink to="/platform/operations" label="Operations" />}
      actions={<PlatformRefreshButton onClick={() => void load()} />}
    >
      <div className="space-y-6">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">High Availability</h1>
          <p className="text-sm text-muted-foreground mt-1">HA cluster status, policy, and host fencing controls.</p>
        </div>

        {status && (
          <div className="grid grid-cols-3 gap-4">
            <MacStatWidget
              label="HA-Protected VMs"
              value={String(status.status.enabled_vms)}
              icon={<ShieldCheck className="w-4 h-4" />}
            />
            <MacStatWidget
              label="Offline Hosts"
              value={String(status.status.offline_hosts)}
              icon={<AlertTriangle className="w-4 h-4" />}
              tone={status.status.offline_hosts > 0 ? 'warn' : 'default'}
            />
            <MacStatWidget
              label="Recent Events"
              value={String(status.status.recent_events)}
              icon={<Activity className="w-4 h-4" />}
            />
          </div>
        )}

        <MacGlassPanel title="HA Events" >
          {!status || status.events.length === 0 ? (
            <PlatformEmptyState icon={CheckCircle2} title="No HA events" subtitle="All hosts are healthy." />
          ) : (
            <div className="divide-y divide-border/40">
              {status.events.map((ev) => (
                <MacListRow
                  key={ev.id}
                  title={ev.message}
                  subtitle={ev.action}
                  trailing={<span className="text-xs text-muted-foreground">{new Date(ev.created_at).toLocaleString()}</span>}
                />
              ))}
            </div>
          )}
        </MacGlassPanel>

        <MacGlassPanel title="Host Fencing" >
          {hosts.length === 0 ? (
            <PlatformEmptyState icon={AlertTriangle} title="No hosts" subtitle="Enroll hosts to enable fencing." />
          ) : (
            <div className="divide-y divide-border/40">
              {hosts.map((h) => (
                <MacListRow
                  key={h.id}
                  title={h.hostname}
                  subtitle={h.state}
                  trailing={
                    <button
                      onClick={() => void handleFence(h.id, h.hostname)}
                      disabled={fencing === h.id}
                      className="px-3 py-1 text-xs rounded-md bg-destructive/10 text-destructive hover:bg-destructive/20 disabled:opacity-50"
                    >
                      {fencing === h.id ? (
                        <RefreshCw className="w-3 h-3 animate-spin inline" />
                      ) : (
                        'Fence'
                      )}
                    </button>
                  }
                />
              ))}
            </div>
          )}
        </MacGlassPanel>

        <MacGlassPanel title="Fence Events" >
          {fenceEvents.length === 0 ? (
            <PlatformEmptyState icon={CheckCircle2} title="No fence events" subtitle="No hosts have been fenced recently." />
          ) : (
            <div className="divide-y divide-border/40">
              {fenceEvents.map((ev) => (
                <MacListRow
                  key={ev.id}
                  title={ev.action}
                  subtitle={ev.message ?? undefined}
                  trailing={<span className="text-xs text-muted-foreground">{new Date(ev.created_at).toLocaleString()}</span>}
                  badge={
                    <span className={`text-xs px-1.5 py-0.5 rounded ${ev.success ? 'bg-emerald-500/10 text-emerald-500' : 'bg-red-500/10 text-red-500'}`}>
                      {ev.success ? 'OK' : 'Failed'}
                    </span>
                  }
                />
              ))}
            </div>
          )}
        </MacGlassPanel>
      </div>
    </PlatformPageChrome>
  )
}
