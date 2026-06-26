// Copyright (c) 2026 ZyvorAI Labs Private Limited. All rights reserved.

import { useCallback, useEffect, useState } from 'react'
import { ArrowUpCircle, CheckCircle2, RefreshCw, Server } from 'lucide-react'
import PlatformPageChrome, { PlatformBackLink, PlatformRefreshButton } from '../../components/platform/PlatformPageChrome'
import { MacGlassPanel, MacListRow, MacStatWidget } from '../../components/platform/mac/PlatformMacUi'
import PlatformEmptyState from '../../components/platform/PlatformEmptyState'
import { useToastContext } from '../../contexts/ToastContext'
import { formatUserError } from '../../utils/apiError'
import { listPlatformHosts, platformFetch, type PlatformHost } from '../../api/platform'

interface UpgradeMatrix {
  controller_version: string
  recommended_agent: string
  min_agent: string
  notes: string
}

const getUpgradeMatrix = () =>
  platformFetch<UpgradeMatrix>('/api/v1/upgrade/matrix')

const upgradeHostAgent = (hostId: string, targetVersion?: string) =>
  platformFetch<{ task_id: string; status: string; operation: string }>(
    `/api/v1/hosts/${hostId}/upgrade`,
    { method: 'POST', body: JSON.stringify({ target_version: targetVersion }) },
  )

export default function PlatformUpgrade() {
  const toast = useToastContext()
  const [matrix, setMatrix] = useState<UpgradeMatrix | null>(null)
  const [hosts, setHosts] = useState<PlatformHost[]>([])
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [upgrading, setUpgrading] = useState<string | null>(null)

  const load = useCallback(async () => {
    setError(null)
    setLoading(true)
    try {
      const [m, h] = await Promise.all([getUpgradeMatrix(), listPlatformHosts()])
      setMatrix(m)
      setHosts(h)
    } catch (e: unknown) {
      setError(formatUserError(e))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { void load() }, [load])

  const handleUpgrade = async (host: PlatformHost) => {
    setUpgrading(host.id)
    try {
      const result = await upgradeHostAgent(host.id, matrix?.recommended_agent)
      toast.success(`Upgrade task queued for ${host.hostname} (task ${result.task_id.slice(0, 8)}…)`)
    } catch (e: unknown) {
      toast.error(formatUserError(e))
    } finally {
      setUpgrading(null)
    }
  }

  const onlineHosts = hosts.filter((h) => h.state === 'online')

  return (
    <PlatformPageChrome
      error={error}
      onErrorRetry={() => void load()}
      prepend={<PlatformBackLink to="/platform/settings" label="Settings" />}
      actions={<PlatformRefreshButton onClick={() => void load()} />}
    >
      <div className="space-y-6">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">Upgrade Matrix</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Controller version compatibility and host agent rollout.
          </p>
        </div>

        {matrix && (
          <div className="grid grid-cols-3 gap-4">
            <MacStatWidget
              label="Controller"
              value={`v${matrix.controller_version}`}
              icon={<CheckCircle2 className="w-4 h-4" />}
              tone="ok"
            />
            <MacStatWidget
              label="Recommended Agent"
              value={`v${matrix.recommended_agent}`}
              icon={<ArrowUpCircle className="w-4 h-4" />}
            />
            <MacStatWidget
              label="Min Compatible Agent"
              value={`v${matrix.min_agent}`}
              icon={<Server className="w-4 h-4" />}
            />
          </div>
        )}

        {matrix?.notes && (
          <MacGlassPanel title="Upgrade Guide">
            <p className="text-sm text-muted-foreground">{matrix.notes}</p>
            <ol className="mt-3 space-y-1 text-sm text-muted-foreground list-decimal list-inside">
              <li>Put the host into maintenance mode from the Hosts page.</li>
              <li>Click <strong className="text-foreground">Upgrade Agent</strong> below — this enqueues a <code className="font-mono text-xs">host.agent.upgrade</code> task.</li>
              <li>Monitor progress in <a href="/platform/tasks" className="text-primary hover:underline">Tasks</a>.</li>
              <li>Verify the agent heartbeat recovers, then disable maintenance mode.</li>
            </ol>
          </MacGlassPanel>
        )}

        <MacGlassPanel title="Hosts">
          {hosts.length === 0 ? (
            <PlatformEmptyState
              icon={Server}
              title="No hosts enrolled"
              subtitle="Enroll a host to manage agent upgrades."
            />
          ) : (
            <div className="divide-y divide-border/40">
              {hosts.map((h) => (
                <MacListRow
                  key={h.id}
                  title={h.hostname}
                  subtitle={`${h.address} · ${h.vm_count} VM${h.vm_count !== 1 ? 's' : ''}${h.maintenance_mode ? ' · maintenance' : ''}`}
                  badge={
                    <span className={`text-xs px-1.5 py-0.5 rounded ${
                      h.state === 'online'
                        ? 'bg-emerald-500/10 text-emerald-500'
                        : 'bg-slate-500/10 text-slate-400'
                    }`}>
                      {h.state}
                    </span>
                  }
                  trailing={
                    <button
                      onClick={() => void handleUpgrade(h)}
                      disabled={upgrading === h.id || h.state !== 'online'}
                      className="flex items-center gap-1.5 px-3 py-1 text-xs rounded-md bg-primary/10 text-primary hover:bg-primary/20 disabled:opacity-40"
                    >
                      {upgrading === h.id
                        ? <RefreshCw className="w-3 h-3 animate-spin" />
                        : <ArrowUpCircle className="w-3 h-3" />}
                      Upgrade Agent
                    </button>
                  }
                />
              ))}
            </div>
          )}
        </MacGlassPanel>

        {onlineHosts.length > 1 && (
          <div className="flex justify-end">
            <button
              onClick={async () => {
                for (const h of onlineHosts) {
                  try {
                    await upgradeHostAgent(h.id, matrix?.recommended_agent)
                  } catch { /* continue */ }
                }
                toast.success(`Upgrade queued for all ${onlineHosts.length} online hosts`)
              }}
              className="flex items-center gap-2 px-4 py-2 text-sm rounded-lg bg-primary text-primary-foreground hover:bg-primary/90"
            >
              <ArrowUpCircle className="w-4 h-4" />
              Upgrade All Online Hosts
            </button>
          </div>
        )}
      </div>
    </PlatformPageChrome>
  )
}
