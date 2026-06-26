// Copyright (c) 2026 ZyvorAI Labs Private Limited. All rights reserved.

import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router'
import { Loader2 } from 'lucide-react'
import {
  getClassicHostCockpitInventory,
  getHostCockpitInventory,
  runClassicHostCockpitAction,
  runHostCockpitAction,
  type HostCockpitInventory,
  type HostCockpitNetwork,
  type HostCockpitStorage,
  type HostCockpitSystem,
} from '../../api/platformHostCockpit'
import { MacGlassPanel } from './mac/PlatformMacUi'
import HostNmCreateWizard from './HostNmCreateWizard'
import { formatUserError } from '../../utils/apiError'
import { useToastContext } from '../../contexts/ToastContext'

function StorageSection({ data }: { data: HostCockpitStorage }) {
  const groups: Array<[string, HostCockpitStorage['mdraid']]> = [
    ['RAID (mdadm)', data.mdraid],
    ['LUKS', data.luks],
    ['LVM', data.lvm],
    ['Stratis', data.stratis],
    ['VDO', data.vdo],
    ['Multipath', data.multipath],
    ['iSCSI sessions', data.iscsi],
  ]
  return (
    <div className="space-y-3 text-sm" data-testid="host-cockpit-storage">
      <p className="text-xs text-slate-500">{data.summary}</p>
      {groups.map(([title, items]) => (
        <div key={title}>
          <p className="text-xs font-medium text-slate-400 mb-1">{title}</p>
          {items.length === 0 ? (
            <p className="text-xs text-slate-600">None detected</p>
          ) : (
            <ul className="space-y-1">
              {items.slice(0, 8).map((item) => (
                <li key={`${title}-${item.name}`} className="rounded border border-slate-800/80 px-2 py-1">
                  <span className="font-mono text-slate-200">{item.name}</span>
                  <span className="text-slate-500 text-xs ml-2">{item.detail}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      ))}
    </div>
  )
}

function NetworkSection({
  hostId,
  classic,
  data,
  onRefresh,
}: {
  hostId?: string
  classic?: boolean
  data: HostCockpitNetwork
  onRefresh: () => void
}) {
  const toast = useToastContext()
  const [fwZone, setFwZone] = useState(data.firewalld.default_zone || 'public')
  const [fwService, setFwService] = useState('ssh')
  const [busy, setBusy] = useState(false)

  const runAction = async (action: string, payload: Record<string, unknown>) => {
    setBusy(true)
    try {
      const r = classic || !hostId
        ? await runClassicHostCockpitAction(action, payload)
        : await runHostCockpitAction(hostId, action, payload)
      toast.success(r.message ?? 'Applied')
      onRefresh()
    } catch (e: unknown) {
      toast.error(formatUserError(e))
    } finally {
      setBusy(false)
    }
  }

  const connGroups: Array<[string, HostCockpitNetwork['bonds']]> = [
    ['Bonds', data.bonds],
    ['Teams', data.teams],
    ['Bridges', data.bridges],
    ['VLANs', data.vlans],
    ['Wi-Fi', data.wifi],
    ['WireGuard', data.wireguard],
  ]

  return (
    <div className="space-y-4 text-sm" data-testid="host-cockpit-network">
      <p className="text-xs text-slate-500">{data.summary}</p>
      {connGroups.map(([title, items]) => (
        <div key={title}>
          <p className="text-xs font-medium text-slate-400 mb-1">{title}</p>
          {items.length === 0 ? (
            <p className="text-xs text-slate-600">None</p>
          ) : (
            <ul className="text-xs space-y-1">
              {items.map((c) => (
                <li key={c.uuid} className="font-mono text-slate-300">
                  {c.name} · {c.device || '—'} · {c.state}
                </li>
              ))}
            </ul>
          )}
        </div>
      ))}
      {data.ovs?.available ? (
        <MacGlassPanel title="Open vSwitch (OVS SDN)" subtitle={data.ovs.summary} data-testid="host-ovs-panel">
          {data.ovs.bridges.length === 0 ? (
            <p className="text-xs text-slate-600">No OVS bridges</p>
          ) : (
            <ul className="text-xs space-y-2">
              {data.ovs.bridges.map((b) => (
                <li key={b.name} className="rounded border border-slate-800/80 px-2 py-1">
                  <span className="font-mono text-slate-200">{b.name}</span>
                  <span className="text-slate-500 ml-2">{b.ports.length ? b.ports.join(', ') : 'no ports'}</span>
                </li>
              ))}
            </ul>
          )}
        </MacGlassPanel>
      ) : null}
      <HostNmCreateWizard hostId={hostId} classic={classic} onRefresh={onRefresh} />
      {data.firewalld.available && (
        <MacGlassPanel title="firewalld" subtitle={data.firewalld.running ? `default zone: ${data.firewalld.default_zone}` : 'not running'}>
          {data.firewalld.zones.slice(0, 4).map((z) => (
            <div key={z.name} className="text-xs text-slate-400 mb-2">
              <span className="text-slate-200">{z.name}</span> — services: {z.services.join(', ') || 'none'}
            </div>
          ))}
          <div className="flex flex-wrap gap-2 mt-2">
            <input aria-label="Firewall zone" className="input text-xs w-24" value={fwZone} onChange={(e) => setFwZone(e.target.value)} placeholder="zone" />
            <input aria-label="Firewall service" className="input text-xs w-28" value={fwService} onChange={(e) => setFwService(e.target.value)} placeholder="service" />
            <button type="button" className="btn-secondary text-xs" disabled={busy || !data.firewalld.running} onClick={() => void runAction('cockpit.firewalld.add_service', { zone: fwZone, service: fwService })}>
              Add service
            </button>
          </div>
        </MacGlassPanel>
      )}
    </div>
  )
}

function SystemSection({
  hostId,
  classic,
  data,
  classicHostPath,
  onRefresh,
}: {
  hostId?: string
  classic?: boolean
  data: HostCockpitSystem
  classicHostPath?: string
  onRefresh: () => void
}) {
  const toast = useToastContext()
  const [profile, setProfile] = useState(data.tuned.active_profile || 'balanced')
  const [busy, setBusy] = useState(false)

  const runAction = async (action: string, payload: Record<string, unknown>) => {
    setBusy(true)
    try {
      const r = classic || !hostId
        ? await runClassicHostCockpitAction(action, payload)
        : await runHostCockpitAction(hostId, action, payload)
      toast.success(r.message ?? 'Applied')
      onRefresh()
    } catch (e: unknown) {
      toast.error(formatUserError(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="space-y-4 text-sm" data-testid="host-cockpit-system">
      <p className="text-xs text-slate-500">{data.summary}</p>
      <div className="grid gap-2 sm:grid-cols-2 text-xs">
        <div className="rounded border border-slate-800 p-2"><span className="text-slate-500">kdump</span><p>{data.kdump.summary || 'n/a'}</p></div>
        <div className="rounded border border-slate-800 p-2"><span className="text-slate-500">SELinux</span><p>{data.selinux.mode || 'n/a'}</p></div>
        <div className="rounded border border-slate-800 p-2"><span className="text-slate-500">realmd</span><p>{data.realmd.summary || 'n/a'}</p></div>
        <div className="rounded border border-slate-800 p-2"><span className="text-slate-500">Failed units</span><p>{data.systemd_failed}</p></div>
      </div>
      {data.selinux.enforce_supported && (
        <div className="flex gap-2">
          <button type="button" className="btn-secondary text-xs" disabled={busy} onClick={() => void runAction('cockpit.selinux.set_enforce', { enforcing: true })}>Enforcing</button>
          <button type="button" className="btn-secondary text-xs" disabled={busy} onClick={() => void runAction('cockpit.selinux.set_enforce', { enforcing: false })}>Permissive</button>
        </div>
      )}
      {data.tuned.available && (
        <MacGlassPanel title="Tuned profile">
          <select aria-label="Tuned profile" className="input text-xs w-full" value={profile} onChange={(e) => setProfile(e.target.value)}>
            {data.tuned.profiles.map((p) => (
              <option key={p} value={p}>{p}</option>
            ))}
          </select>
          <button type="button" className="btn-secondary text-xs mt-2" disabled={busy} onClick={() => void runAction('cockpit.tuned.set_profile', { profile })}>
            Apply profile
          </button>
        </MacGlassPanel>
      )}
      {data.systemd_units.length > 0 && (
        <MacGlassPanel title="Services (sample)" subtitle="First 40 units from systemctl">
          <ul className="max-h-40 overflow-y-auto text-xs font-mono space-y-1">
            {data.systemd_units.map((u) => (
              <li key={u.unit} className={u.active === 'failed' ? 'text-red-300' : 'text-slate-400'}>
                {u.unit} · {u.active}/{u.sub}
              </li>
            ))}
          </ul>
        </MacGlassPanel>
      )}
      {data.journal_recent.length > 0 && (
        <MacGlassPanel title="Journal errors (1h)" subtitle={`${data.journal_errors_1h} total`}>
          <ul className="max-h-32 overflow-y-auto text-xs text-slate-500 space-y-1 font-mono">
            {data.journal_recent.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
        </MacGlassPanel>
      )}
      {classicHostPath && (
        <div className="flex flex-wrap gap-2 text-xs">
          <Link to="/services" className="btn-secondary">Classic Services</Link>
          <Link to="/logs" className="btn-secondary">Classic Logs</Link>
          <Link to={`${classicHostPath}?tab=terminal`} className="btn-secondary">Terminal</Link>
          <Link to={classicHostPath} className="btn-secondary">Host detail</Link>
        </div>
      )}
    </div>
  )
}

type Props = {
  hostId?: string
  classic?: boolean
  section?: 'storage' | 'network' | 'system' | 'all'
  classicHostPath?: string
}

export default function HostCockpitPanels({ hostId, classic = false, section = 'all', classicHostPath }: Props) {
  const [inv, setInv] = useState<HostCockpitInventory | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      if (classic) {
        setInv(await getClassicHostCockpitInventory(section))
      } else if (hostId) {
        setInv(await getHostCockpitInventory(hostId, section))
      }
    } catch (e: unknown) {
      setError(formatUserError(e))
      setInv(null)
    } finally {
      setLoading(false)
    }
  }, [hostId, section, classic])

  useEffect(() => {
    void load()
  }, [load])

  if (loading) {
    return (
      <p className="text-sm text-slate-500 flex items-center gap-2">
        <Loader2 className="w-4 h-4 animate-spin" /> Loading host Cockpit inventory…
      </p>
    )
  }
  if (error) {
    return <p className="text-sm text-red-300">{error}</p>
  }
  if (!inv) return null

  return (
    <div className="space-y-4">
      {inv.storage && (section === 'all' || section === 'storage') && (
        <MacGlassPanel title="Host block storage" subtitle="Cockpit storaged parity (read-only)">
          <StorageSection data={inv.storage} />
        </MacGlassPanel>
      )}
      {inv.network && (section === 'all' || section === 'network') && (
        <MacGlassPanel title="NetworkManager & firewalld" subtitle="Connections and zone editor">
          <NetworkSection hostId={hostId} classic={classic} data={inv.network} onRefresh={() => void load()} />
        </MacGlassPanel>
      )}
      {inv.system && (section === 'all' || section === 'system') && (
        <MacGlassPanel title="System modules" subtitle="kdump · SELinux · Tuned · realmd · journal">
          <SystemSection hostId={hostId} classic={classic} data={inv.system} classicHostPath={classicHostPath} onRefresh={() => void load()} />
        </MacGlassPanel>
      )}
    </div>
  )
}
