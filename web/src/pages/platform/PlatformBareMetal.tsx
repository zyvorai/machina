// Copyright (c) 2026 ZyvorAI Labs Private Limited. All rights reserved.

import { useCallback, useEffect, useState } from 'react'
import {
  CheckCircle2,
  Cpu,
  HardDrive,
  Plus,
  Power,
  RefreshCw,
  Server,
} from 'lucide-react'
import PlatformPageChrome, { PlatformBackLink, PlatformRefreshButton } from '../../components/platform/PlatformPageChrome'
import { MacGlassPanel, MacListRow, MacStatWidget } from '../../components/platform/mac/PlatformMacUi'
import PlatformEmptyState from '../../components/platform/PlatformEmptyState'
import { useToastContext } from '../../contexts/ToastContext'
import { formatUserError } from '../../utils/apiError'
import {
  listBaremetalServers,
  registerBaremetalServer,
  baremetalServerPower,
  type BaremetalServer,
  type BmcPowerBody,
} from '../../api/platform'

type PowerAction = BmcPowerBody['action']

export default function PlatformBareMetal() {
  const toast = useToastContext()
  const [servers, setServers] = useState<BaremetalServer[]>([])
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [actionInProgress, setActionInProgress] = useState<string | null>(null)
  const [showRegister, setShowRegister] = useState(false)
  const [hostname, setHostname] = useState('')
  const [bmcAddress, setBmcAddress] = useState('')
  const [bmcType, setBmcType] = useState('redfish')
  const [saving, setSaving] = useState(false)

  const load = useCallback(async () => {
    setError(null)
    setLoading(true)
    try {
      setServers(await listBaremetalServers())
    } catch (e: unknown) {
      setError(formatUserError(e))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { void load() }, [load])

  const handlePower = async (id: string, name: string, action: PowerAction) => {
    setActionInProgress(id)
    try {
      const result = await baremetalServerPower(id, { action })
      if (result.success) {
        toast.success(`Power ${action} sent to ${name}`)
      } else {
        toast.error(result.message)
      }
      await load()
    } catch (e: unknown) {
      toast.error(formatUserError(e))
    } finally {
      setActionInProgress(null)
    }
  }

  const handleRegister = async () => {
    if (!hostname.trim() || !bmcAddress.trim()) return
    setSaving(true)
    try {
      await registerBaremetalServer({ hostname: hostname.trim(), bmc_address: bmcAddress.trim(), bmc_type: bmcType })
      toast.success(`${hostname.trim()} registered`)
      setHostname('')
      setBmcAddress('')
      setShowRegister(false)
      await load()
    } catch (e: unknown) {
      toast.error(formatUserError(e))
    } finally {
      setSaving(false)
    }
  }

  const onlineCount = servers.filter((s) => s.state === 'on').length
  const totalCores = servers.reduce((n, s) => n + s.cpu_cores, 0)
  const totalMemGib = Math.round(servers.reduce((n, s) => n + s.memory_mib, 0) / 1024)

  return (
    <PlatformPageChrome
      error={error}
      onErrorRetry={() => void load()}
      prepend={<PlatformBackLink to="/platform/hosts" label="Hosts" />}
      actions={
        <div className="flex items-center gap-2">
          <button
            onClick={() => setShowRegister((v) => !v)}
            className="flex items-center gap-1.5 px-3 py-1.5 text-sm rounded-lg bg-primary/10 text-primary hover:bg-primary/20"
          >
            <Plus className="w-4 h-4" /> Register Server
          </button>
          <PlatformRefreshButton onClick={() => void load()} />
        </div>
      }
    >
      <div className="space-y-6">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">Bare Metal</h1>
          <p className="text-sm text-muted-foreground mt-1">Physical servers managed via BMC (IPMI/Redfish).</p>
        </div>

        <div className="grid grid-cols-3 gap-4">
          <MacStatWidget label="Servers" value={String(servers.length)} icon={<Server className="w-4 h-4" />} />
          <MacStatWidget label="Online" value={String(onlineCount)} icon={<Power className="w-4 h-4" />} tone={onlineCount === servers.length && servers.length > 0 ? 'ok' : 'default'} />
          <MacStatWidget label="Total Capacity" value={`${totalCores} cores · ${totalMemGib} GiB`} icon={<Cpu className="w-4 h-4" />} />
        </div>

        {showRegister && (
          <MacGlassPanel title="Register Server" >
            <div className="grid grid-cols-3 gap-3">
              <div>
                <label className="text-xs text-muted-foreground block mb-1">Hostname</label>
                <input
                  value={hostname}
                  onChange={(e) => setHostname(e.target.value)}
                  placeholder="metal-01.example.com"
                  className="w-full rounded border border-border/50 bg-background/60 px-2 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-ring"
                />
              </div>
              <div>
                <label className="text-xs text-muted-foreground block mb-1">BMC Address</label>
                <input
                  value={bmcAddress}
                  onChange={(e) => setBmcAddress(e.target.value)}
                  placeholder="192.168.10.5"
                  className="w-full rounded border border-border/50 bg-background/60 px-2 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-ring"
                />
              </div>
              <div>
                <label className="text-xs text-muted-foreground block mb-1">BMC Type</label>
                <select
                  value={bmcType}
                  onChange={(e) => setBmcType(e.target.value)}
                  className="w-full rounded border border-border/50 bg-background/60 px-2 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-ring"
                >
                  <option value="redfish">Redfish</option>
                  <option value="ipmi">IPMI</option>
                  <option value="ilorest">iLO REST</option>
                </select>
              </div>
            </div>
            <div className="flex justify-end gap-2 mt-4">
              <button onClick={() => setShowRegister(false)} className="px-3 py-1.5 text-sm rounded-lg border border-border/50 hover:bg-accent/10">
                Cancel
              </button>
              <button
                onClick={() => void handleRegister()}
                disabled={saving || !hostname.trim() || !bmcAddress.trim()}
                className="flex items-center gap-1.5 px-3 py-1.5 text-sm rounded-lg bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
              >
                {saving ? <RefreshCw className="w-3 h-3 animate-spin" /> : <Plus className="w-3 h-3" />}
                Register
              </button>
            </div>
          </MacGlassPanel>
        )}

        <MacGlassPanel title="Bare Metal Servers" >
          {servers.length === 0 ? (
            <PlatformEmptyState
              icon={CheckCircle2}
              title="No bare metal servers"
              subtitle="Register a physical server to start managing it via BMC."
            />
          ) : (
            <div className="divide-y divide-border/40">
              {servers.map((s) => (
                <MacListRow
                  key={s.id}
                  title={s.hostname}
                  subtitle={`${s.bmc_type.toUpperCase()} · ${s.bmc_address} · ${s.cpu_cores} cores · ${Math.round(s.memory_mib / 1024)} GiB`}
                  badge={
                    <span className={`text-xs px-1.5 py-0.5 rounded ${s.state === 'on' ? 'bg-emerald-500/10 text-emerald-500' : 'bg-slate-500/10 text-slate-400'}`}>
                      {s.state}
                    </span>
                  }
                  trailing={
                    <div className="flex items-center gap-1">
                      <button
                        onClick={() => void handlePower(s.id, s.hostname, 'on')}
                        disabled={actionInProgress === s.id || s.state === 'on'}
                        className="px-2 py-1 text-xs rounded bg-emerald-500/10 text-emerald-600 hover:bg-emerald-500/20 disabled:opacity-40"
                      >
                        On
                      </button>
                      <button
                        onClick={() => void handlePower(s.id, s.hostname, 'off')}
                        disabled={actionInProgress === s.id || s.state === 'off'}
                        className="px-2 py-1 text-xs rounded bg-red-500/10 text-red-600 hover:bg-red-500/20 disabled:opacity-40"
                      >
                        Off
                      </button>
                      <button
                        onClick={() => void handlePower(s.id, s.hostname, 'reset')}
                        disabled={actionInProgress === s.id}
                        className="px-2 py-1 text-xs rounded bg-amber-500/10 text-amber-600 hover:bg-amber-500/20 disabled:opacity-40"
                      >
                        {actionInProgress === s.id ? <RefreshCw className="w-3 h-3 animate-spin" /> : 'Reset'}
                      </button>
                    </div>
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
