// Copyright (c) 2026 ZyvorAI Labs Private Limited. All rights reserved.

import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router'
import {
  addOpenStackAggregateHost,
  createOpenStackAggregate,
  disableOpenStackComputeService,
  enableOpenStackComputeService,
  listOpenStackAvailabilityZones,
  listOpenStackComputeServices,
  listOpenStackHostAggregates,
  listOpenStackHypervisors,
  listOpenStackNeutronAgents,
  removeOpenStackAggregateHost,
  setOpenStackNeutronAgentAdmin,
  updateOpenStackAggregate,
  type OpenStackAvailabilityZone,
  type OpenStackComputeService,
  type OpenStackHostAggregate,
  type OpenStackHypervisor,
  type OpenStackNeutronAgent,
} from '../api/openstackExtras'
import { formatUserError } from '../utils/apiError'
import { useToastContext } from '../contexts/ToastContext'
import { Loader2, Plus, Server } from 'lucide-react'
import { statusActionLinkClasses, statusToneClass } from '../utils/semanticColors'

export default function OpenStackAdminPanel() {
  const toast = useToastContext()
  const [azs, setAzs] = useState<OpenStackAvailabilityZone[]>([])
  const [hvs, setHvs] = useState<OpenStackHypervisor[]>([])
  const [services, setServices] = useState<OpenStackComputeService[]>([])
  const [agents, setAgents] = useState<OpenStackNeutronAgent[]>([])
  const [aggregates, setAggregates] = useState<OpenStackHostAggregate[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [downOnly, setDownOnly] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const [a, h, s, ag, agg] = await Promise.all([
        listOpenStackAvailabilityZones().catch(() => ({ availability_zones: [] })),
        listOpenStackHypervisors().catch(() => ({ hypervisors: [] })),
        listOpenStackComputeServices().catch(() => ({ services: [] })),
        listOpenStackNeutronAgents().catch(() => ({ agents: [] })),
        listOpenStackHostAggregates().catch(() => ({ aggregates: [] })),
      ])
      setAzs(a.availability_zones)
      setHvs(h.hypervisors)
      setServices(s.services)
      setAgents(ag.agents)
      setAggregates(agg.aggregates)
    } catch (e: unknown) {
      setError(formatUserError(e))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  if (loading) {
    return (
      <div role="status" aria-label="Loading" className="flex justify-center py-4">
        <Loader2 className="w-6 h-6 animate-spin text-sky-400" aria-hidden="true" />
      </div>
    )
  }

  const visibleServices = downOnly
    ? services.filter((s) => s.state !== 'up' || s.status !== 'enabled')
    : services
  const visibleAgents = downOnly
    ? agents.filter((a) => !a.alive || !a.admin_state_up)
    : agents

  const run = async (fn: () => Promise<unknown>, ok: string) => {
    try {
      await fn()
      toast.success(ok)
      void load()
    } catch (e: unknown) {
      toast.error(formatUserError(e))
    }
  }

  return (
    <div className="rounded-xl border border-slate-700 p-4 space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-sm font-medium text-slate-300 flex items-center gap-2">
          <Server className="w-4 h-4 text-sky-400" />
          Compute admin
        </h2>
        <label className="inline-flex items-center gap-2 text-xs text-slate-400 cursor-pointer">
          <input type="checkbox" checked={downOnly} onChange={(e) => setDownOnly(e.target.checked)}
            className="rounded border-slate-600" />
          Show down only
        </label>
      </div>
      <p className="text-xs text-slate-500">Admin write operations — requires cloud admin role.</p>
      {error && <p className={`text-sm ${statusToneClass('error')}`}>{error}</p>}
      <div className="grid md:grid-cols-2 gap-4 text-sm">
        <div>
          <h3 className="text-xs uppercase text-slate-500 mb-2">Availability zones</h3>
          <ul className="space-y-1 font-mono text-slate-300">
            {azs.map((z) => (
              <li key={z.name}>{z.name} · {z.state}</li>
            ))}
            {azs.length === 0 && <li className="text-slate-500">No AZ data</li>}
          </ul>
        </div>
        <div>
          <h3 className="text-xs uppercase text-slate-500 mb-2">Hypervisors</h3>
          <ul className="space-y-1 font-mono text-slate-300 max-h-40 overflow-y-auto">
            {hvs.map((h) => (
              <li key={h.id} className="flex flex-wrap items-center gap-2">
                <Link to={`/openstack/hypervisors/${encodeURIComponent(h.id)}`} className="text-left hover:text-sky-300">
                  {h.hostname} · {h.running_vms} VMs · {h.vcpus_used}/{h.vcpus} vCPU
                </Link>
              </li>
            ))}
            {hvs.length === 0 && <li className="text-slate-500">No hypervisor data</li>}
          </ul>
        </div>
        <div>
          <div className="flex items-center justify-between gap-2 mb-2">
            <h3 className="text-xs uppercase text-slate-500">Host aggregates</h3>
            <button type="button" className="text-xs text-sky-400 hover:underline inline-flex items-center gap-1"
              onClick={async () => {
                const name = prompt('Aggregate name')
                if (!name?.trim()) return
                const az = prompt('Availability zone (optional)', '') ?? ''
                await run(
                  () => createOpenStackAggregate({ name: name.trim(), availability_zone: az.trim() || undefined }),
                  'Aggregate created',
                )
              }}>
              <Plus className="w-3 h-3" /> New
            </button>
          </div>
          <ul className="space-y-2 font-mono text-slate-300 max-h-48 overflow-y-auto">
            {aggregates.map((a) => (
              <li key={a.id} className="space-y-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span>{a.name}</span>
                  {a.availability_zone && <span className="text-slate-500">· {a.availability_zone}</span>}
                  <button type="button" className="text-xs text-sky-400 hover:underline"
                    onClick={() => void run(async () => {
                      const n = prompt('Rename aggregate', a.name)
                      if (n === null || !n.trim()) return
                      await updateOpenStackAggregate(a.id, { name: n.trim() })
                    }, 'Aggregate updated')}>Rename</button>
                  <button type="button" className="text-xs text-violet-400 hover:underline"
                    onClick={() => void run(async () => {
                      const host = prompt('Host to add')
                      if (!host?.trim()) return
                      await addOpenStackAggregateHost(a.id, host.trim())
                    }, 'Host added')}>+ host</button>
                </div>
                {a.hosts.length > 0 && (
                  <ul className="pl-3 text-xs text-slate-500 space-y-0.5">
                    {a.hosts.map((h) => (
                      <li key={h} className="flex items-center gap-2">
                        {h}
                        <button type="button" className={statusActionLinkClasses('error', 'hover:underline')}
                          onClick={() => void run(
                            () => removeOpenStackAggregateHost(a.id, h),
                            'Host removed',
                          )}>remove</button>
                      </li>
                    ))}
                  </ul>
                )}
              </li>
            ))}
            {aggregates.length === 0 && <li className="text-slate-500">No aggregates</li>}
          </ul>
        </div>
        <div>
          <h3 className="text-xs uppercase text-slate-500 mb-2">Compute services</h3>
          <ul className="space-y-1 font-mono text-slate-300 max-h-48 overflow-y-auto">
            {visibleServices.map((s) => (
              <li key={s.id} className="flex flex-wrap items-center gap-2">
                <span>{s.binary} @ {s.host} · {s.state}/{s.status}</span>
                {s.status === 'enabled' ? (
                  <button type="button" className={`text-xs ${statusActionLinkClasses('warn', 'hover:underline')}`}
                    onClick={() => void run(
                      () => disableOpenStackComputeService({ binary: s.binary, host: s.host }),
                      'Service disabled',
                    )}>Disable</button>
                ) : (
                  <button type="button" className={`text-xs ${statusActionLinkClasses('ok', 'hover:underline')}`}
                    onClick={() => void run(
                      () => enableOpenStackComputeService({ binary: s.binary, host: s.host }),
                      'Service enabled',
                    )}>Enable</button>
                )}
              </li>
            ))}
            {visibleServices.length === 0 && <li className="text-slate-500">{downOnly ? 'All services up' : 'No service data'}</li>}
          </ul>
        </div>
        <div className="md:col-span-2">
          <h3 className="text-xs uppercase text-slate-500 mb-2">Neutron agents</h3>
          <ul className="space-y-1 font-mono text-slate-300 max-h-48 overflow-y-auto">
            {visibleAgents.map((a) => (
              <li key={a.id} className="flex flex-wrap items-center gap-2">
                <span>{a.agent_type} @ {a.host} · {a.alive ? 'alive' : 'down'} · admin {a.admin_state_up ? 'up' : 'down'}</span>
                {a.admin_state_up ? (
                  <button type="button" className={`text-xs ${statusActionLinkClasses('warn', 'hover:underline')}`}
                    onClick={() => void run(
                      () => setOpenStackNeutronAgentAdmin(a.id, false),
                      'Agent admin down',
                    )}>Admin down</button>
                ) : (
                  <button type="button" className={`text-xs ${statusActionLinkClasses('ok', 'hover:underline')}`}
                    onClick={() => void run(
                      () => setOpenStackNeutronAgentAdmin(a.id, true),
                      'Agent admin up',
                    )}>Admin up</button>
                )}
              </li>
            ))}
            {visibleAgents.length === 0 && <li className="text-slate-500">{downOnly ? 'All agents healthy' : 'No agent data'}</li>}
          </ul>
        </div>
      </div>
    </div>
  )
}
