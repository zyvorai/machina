// Copyright (c) 2026 ZyvorAI Labs Private Limited. All rights reserved.

import { useCallback, useEffect, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router'
import { ArrowLeft, Loader2, Plus, Scale, Trash2 } from 'lucide-react'
import OpenStackGate from '../components/OpenStackGate'
import OpenStackSubNav from '../components/OpenStackSubNav'
import OpenStackFooter from '../components/OpenStackFooter'
import {
  createOpenStackLbHealthMonitor,
  createOpenStackLbListener,
  createOpenStackLbMember,
  createOpenStackLbPool,
  deleteOpenStackLbHealthMonitor,
  deleteOpenStackLbListener,
  deleteOpenStackLbMember,
  deleteOpenStackLbPool,
  deleteOpenStackLoadBalancer,
  getOpenStackLoadBalancer,
  listOpenStackLbHealthMonitors,
  listOpenStackLbListeners,
  listOpenStackLbMembers,
  listOpenStackLbPools,
  type OpenStackLbHealthMonitor,
  type OpenStackLbListener,
  type OpenStackLbMember,
  type OpenStackLbPool,
  type OpenStackLoadBalancer,
} from '../api/openstackExtras'
import { useToastContext } from '../contexts/ToastContext'
import { formatUserError } from '../utils/apiError'

export default function OpenStackLoadBalancerDetailPage() {
  return (
    <OpenStackGate title="Load balancer">
      <OpenStackLoadBalancerDetailContent />
    </OpenStackGate>
  )
}

function OpenStackLoadBalancerDetailContent() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const toast = useToastContext()
  const [lb, setLb] = useState<OpenStackLoadBalancer | null>(null)
  const [listeners, setListeners] = useState<OpenStackLbListener[]>([])
  const [pools, setPools] = useState<OpenStackLbPool[]>([])
  const [expandedPool, setExpandedPool] = useState<string | null>(null)
  const [members, setMembers] = useState<Record<string, OpenStackLbMember[]>>({})
  const [monitors, setMonitors] = useState<Record<string, OpenStackLbHealthMonitor[]>>({})
  const [loading, setLoading] = useState(true)

  const [listenerName, setListenerName] = useState('')
  const [listenerPort, setListenerPort] = useState('80')
  const [poolName, setPoolName] = useState('')
  const [poolListenerId, setPoolListenerId] = useState('')
  const [memberAddress, setMemberAddress] = useState('')
  const [memberPort, setMemberPort] = useState('80')
  const [memberPoolId, setMemberPoolId] = useState('')
  const [monitorPoolId, setMonitorPoolId] = useState('')

  const load = useCallback(async () => {
    if (!id) return
    setLoading(true)
    try {
      const [{ loadbalancer }, ls, ps] = await Promise.all([
        getOpenStackLoadBalancer(id),
        listOpenStackLbListeners(id).catch(() => ({ listeners: [] as OpenStackLbListener[] })),
        listOpenStackLbPools(id).catch(() => ({ pools: [] as OpenStackLbPool[] })),
      ])
      setLb(loadbalancer)
      setListeners(ls.listeners ?? [])
      setPools(ps.pools ?? [])
      if ((ls.listeners ?? []).length > 0) setPoolListenerId(ls.listeners[0].id)
      if ((ps.pools ?? []).length > 0) {
        setMemberPoolId(ps.pools[0].id)
        setMonitorPoolId(ps.pools[0].id)
      }
    } catch (e: unknown) {
      toast.error(formatUserError(e))
      setLb(null)
    } finally {
      setLoading(false)
    }
  }, [id, toast])

  const loadPoolDetails = useCallback(async (poolId: string) => {
    try {
      const [m, h] = await Promise.all([
        listOpenStackLbMembers(poolId).catch(() => ({ members: [] as OpenStackLbMember[] })),
        listOpenStackLbHealthMonitors(poolId).catch(() => ({ healthmonitors: [] as OpenStackLbHealthMonitor[] })),
      ])
      setMembers((prev) => ({ ...prev, [poolId]: m.members ?? [] }))
      setMonitors((prev) => ({ ...prev, [poolId]: h.healthmonitors ?? [] }))
    } catch (e: unknown) {
      toast.error(formatUserError(e))
    }
  }, [toast])

  useEffect(() => { void load() }, [load])

  useEffect(() => {
    if (expandedPool) void loadPoolDetails(expandedPool)
  }, [expandedPool, loadPoolDetails])

  if (loading) return <Loader2 className="w-8 h-8 animate-spin text-sky-400 mx-auto py-12" />
  if (!lb || !id) {
    return (
      <div className="space-y-4">
        <OpenStackSubNav />
        <Link to="/openstack/load-balancers" className="text-sky-400 hover:underline">Back</Link>
      </div>
    )
  }

  return (
    <div className="space-y-6 max-w-4xl">
      <OpenStackSubNav />
      <Link to="/openstack/load-balancers" className="inline-flex items-center gap-2 text-slate-400 hover:text-slate-200 text-sm">
        <ArrowLeft className="w-4 h-4" /> Load balancers
      </Link>
      <h1 className="text-2xl font-semibold flex items-center gap-2">
        <Scale className="w-7 h-7 text-emerald-400" /> {lb.name}
      </h1>
      <dl className="grid sm:grid-cols-2 gap-4 rounded-xl border border-slate-700 p-4 text-sm">
        <div><dt className="text-xs text-slate-500 uppercase">VIP</dt><dd className="font-mono mt-1">{lb.vip_address || '—'}</dd></div>
        <div><dt className="text-xs text-slate-500 uppercase">Provisioning</dt><dd className="mt-1">{lb.provisioning_status}</dd></div>
        <div><dt className="text-xs text-slate-500 uppercase">Operating</dt><dd className="mt-1">{lb.operating_status}</dd></div>
        <div><dt className="text-xs text-slate-500 uppercase">VIP subnet</dt><dd className="font-mono text-xs mt-1">{lb.vip_subnet_id || '—'}</dd></div>
      </dl>

      <section className="rounded-xl border border-slate-700 p-4 space-y-3">
        <h2 className="text-sm font-medium text-slate-300">Listeners</h2>
        <div className="flex flex-wrap gap-2">
          <input value={listenerName} onChange={(e) => setListenerName(e.target.value)} placeholder="Name"
            className="px-2 py-1 rounded bg-slate-900 border border-slate-700 text-sm" />
          <input value={listenerPort} onChange={(e) => setListenerPort(e.target.value)} placeholder="Port"
            className="w-20 px-2 py-1 rounded bg-slate-900 border border-slate-700 text-sm" />
          <button type="button" className="px-2 py-1 rounded bg-emerald-700 text-white text-sm inline-flex items-center gap-1"
            onClick={async () => {
              try {
                await createOpenStackLbListener(id, {
                  name: listenerName.trim() || `listener-${listenerPort}`,
                  protocol: 'HTTP',
                  protocol_port: Number(listenerPort) || 80,
                })
                toast.success('Listener created')
                setListenerName('')
                void load()
              } catch (e: unknown) { toast.error(formatUserError(e)) }
            }}>
            <Plus className="w-3.5 h-3.5" /> Add
          </button>
        </div>
        {(listeners ?? []).map((l) => (
          <div key={l.id} className="flex justify-between items-center text-sm border-t border-slate-800 pt-2">
            <span>{l.name} · {l.protocol}:{l.protocol_port} · {l.operating_status}</span>
            <button type="button" className="text-red-400 text-xs" onClick={async () => {
              if (!confirm(`Delete listener ${l.name}?`)) return
              try {
                await deleteOpenStackLbListener(l.id)
                toast.success('Deleted')
                void load()
              } catch (e: unknown) { toast.error(formatUserError(e)) }
            }}>Delete</button>
          </div>
        ))}
      </section>

      <section className="rounded-xl border border-slate-700 p-4 space-y-3">
        <h2 className="text-sm font-medium text-slate-300">Pools</h2>
        <div className="flex flex-wrap gap-2">
          <input value={poolName} onChange={(e) => setPoolName(e.target.value)} placeholder="Pool name"
            className="px-2 py-1 rounded bg-slate-900 border border-slate-700 text-sm" />
          <select value={poolListenerId} onChange={(e) => setPoolListenerId(e.target.value)}
            className="px-2 py-1 rounded bg-slate-900 border border-slate-700 text-sm">
            <option value="">Listener…</option>
            {listeners.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
          </select>
          <button type="button" className="px-2 py-1 rounded bg-emerald-700 text-white text-sm"
            disabled={!poolListenerId}
            onClick={async () => {
              try {
                await createOpenStackLbPool({
                  name: poolName.trim() || 'pool',
                  protocol: 'HTTP',
                  lb_algorithm: 'ROUND_ROBIN',
                  listener_id: poolListenerId,
                })
                toast.success('Pool created')
                setPoolName('')
                void load()
              } catch (e: unknown) { toast.error(formatUserError(e)) }
            }}>Add pool</button>
        </div>
        {(pools ?? []).map((p) => (
          <div key={p.id} className="border-t border-slate-800 pt-2">
            <button type="button" className="text-sm text-sky-400 hover:underline w-full text-left"
              onClick={() => setExpandedPool(expandedPool === p.id ? null : p.id)}>
              {p.name} · {p.lb_algorithm} · {p.operating_status}
            </button>
            {expandedPool === p.id && (
              <div className="mt-2 ml-3 space-y-2 text-sm">
                <div className="flex justify-end">
                  <button type="button" className="text-red-400 text-xs" onClick={async () => {
                    if (!confirm(`Delete pool ${p.name}?`)) return
                    try {
                      await deleteOpenStackLbPool(p.id)
                      toast.success('Deleted')
                      void load()
                    } catch (e: unknown) { toast.error(formatUserError(e)) }
                  }}>Delete pool</button>
                </div>
                <div className="text-slate-500 text-xs">Members</div>
                {(members[p.id] ?? []).map((m) => (
                  <div key={m.id} className="flex justify-between">
                    <span>{m.address}:{m.protocol_port}</span>
                    <button type="button" className="text-red-400 text-xs" onClick={async () => {
                      try {
                        await deleteOpenStackLbMember(p.id, m.id)
                        toast.success('Member removed')
                        void loadPoolDetails(p.id)
                      } catch (e: unknown) { toast.error(formatUserError(e)) }
                    }}>Remove</button>
                  </div>
                ))}
                <div className="text-slate-500 text-xs">Health monitors</div>
                {(monitors[p.id] ?? []).map((h) => (
                  <div key={h.id} className="flex justify-between">
                    <span>{h.name} · {h.type}</span>
                    <button type="button" className="text-red-400 text-xs" onClick={async () => {
                      try {
                        await deleteOpenStackLbHealthMonitor(h.id)
                        toast.success('Monitor removed')
                        void loadPoolDetails(p.id)
                      } catch (e: unknown) { toast.error(formatUserError(e)) }
                    }}>Remove</button>
                  </div>
                ))}
              </div>
            )}
          </div>
        ))}
      </section>

      <section className="rounded-xl border border-slate-700 p-4 space-y-3">
        <h2 className="text-sm font-medium text-slate-300">Add member / health monitor</h2>
        <div className="flex flex-wrap gap-2 items-center">
          <select value={memberPoolId} onChange={(e) => setMemberPoolId(e.target.value)}
            className="px-2 py-1 rounded bg-slate-900 border border-slate-700 text-sm">
            <option value="">Pool…</option>
            {pools.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
          <input value={memberAddress} onChange={(e) => setMemberAddress(e.target.value)} placeholder="Member IP"
            className="px-2 py-1 rounded bg-slate-900 border border-slate-700 text-sm" />
          <input value={memberPort} onChange={(e) => setMemberPort(e.target.value)} placeholder="Port"
            className="w-20 px-2 py-1 rounded bg-slate-900 border border-slate-700 text-sm" />
          <button type="button" className="px-2 py-1 rounded bg-slate-700 text-sm" disabled={!memberPoolId}
            onClick={async () => {
              try {
                await createOpenStackLbMember(memberPoolId, {
                  address: memberAddress.trim(),
                  protocol_port: Number(memberPort) || 80,
                })
                toast.success('Member added')
                setMemberAddress('')
                if (expandedPool === memberPoolId) void loadPoolDetails(memberPoolId)
              } catch (e: unknown) { toast.error(formatUserError(e)) }
            }}>Add member</button>
        </div>
        <div className="flex flex-wrap gap-2 items-center">
          <select value={monitorPoolId} onChange={(e) => setMonitorPoolId(e.target.value)}
            className="px-2 py-1 rounded bg-slate-900 border border-slate-700 text-sm">
            <option value="">Pool…</option>
            {pools.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
          <button type="button" className="px-2 py-1 rounded bg-slate-700 text-sm" disabled={!monitorPoolId}
            onClick={async () => {
              try {
                await createOpenStackLbHealthMonitor({
                  pool_id: monitorPoolId,
                  name: 'monitor',
                  type: 'HTTP',
                  delay: 5,
                  timeout: 4,
                  max_retries: 3,
                })
                toast.success('Health monitor added')
                if (expandedPool === monitorPoolId) void loadPoolDetails(monitorPoolId)
              } catch (e: unknown) { toast.error(formatUserError(e)) }
            }}>Add HTTP monitor</button>
        </div>
      </section>

      <button type="button" className="px-3 py-1.5 rounded-lg border border-red-600/50 text-red-300 text-sm inline-flex items-center gap-1"
        onClick={async () => {
          if (!confirm(`Delete ${lb.name}?`)) return
          try {
            await deleteOpenStackLoadBalancer(lb.id)
            toast.success('Deleted')
            navigate('/openstack/load-balancers')
          } catch (e: unknown) { toast.error(formatUserError(e)) }
        }}>
        <Trash2 className="w-4 h-4" /> Delete load balancer
      </button>
      <OpenStackFooter />
    </div>
  )
}
