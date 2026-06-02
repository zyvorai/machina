// Copyright (c) 2026 ZyvorAI Labs Private Limited. All rights reserved.

import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router'
import { Loader2, Plus, Scale, Trash2 } from 'lucide-react'
import OpenStackGate from '../components/OpenStackGate'
import OpenStackSubNav from '../components/OpenStackSubNav'
import OpenStackFooter from '../components/OpenStackFooter'
import PageLayout from '../components/PageLayout'
import EmptyState from '../components/EmptyState'
import {
  createOpenStackLoadBalancer,
  deleteOpenStackLoadBalancer,
  listOpenStackLoadBalancers,
  listOpenStackSubnets,
  type OpenStackLoadBalancer,
} from '../api/openstackExtras'
import { useToastContext } from '../contexts/ToastContext'
import { formatUserError } from '../utils/apiError'
import { statusActionLinkClasses, statusDestructiveButtonClasses, statusToneClass } from '../utils/semanticColors'

export default function OpenStackLoadBalancersPage() {
  return (
    <OpenStackGate title="Load balancers">
      <OpenStackLoadBalancersContent />
    </OpenStackGate>
  )
}

function OpenStackLoadBalancersContent() {
  const toast = useToastContext()
  const [lbs, setLbs] = useState<OpenStackLoadBalancer[]>([])
  const [subnets, setSubnets] = useState<{ id: string; name: string; cidr: string }[]>([])
  const [loading, setLoading] = useState(true)
  const [name, setName] = useState('')
  const [subnetId, setSubnetId] = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const [lbR, subR] = await Promise.all([
        listOpenStackLoadBalancers(),
        listOpenStackSubnets().catch(() => ({ subnets: [] })),
      ])
      setLbs(lbR.loadbalancers ?? [])
      setSubnets(subR.subnets.map((s) => ({ id: s.id, name: s.name, cidr: s.cidr })))
    } catch (e: unknown) {
      toast.error(formatUserError(e))
      setLbs([])
    } finally {
      setLoading(false)
    }
  }, [toast])

  useEffect(() => { void load() }, [load])

  return (
    <PageLayout
      hideHeader
      prepend={<>
      </>}
      ><h1 className="text-2xl font-semibold flex items-center gap-2">
        <Scale className={`w-7 h-7 ${statusToneClass('ok')}`} /> Octavia load balancers
      </h1>
      <p className="text-slate-400 text-sm">Requires Octavia (load-balancer) in the service catalog.</p>

      <div className="rounded-xl border border-slate-700 p-4 flex flex-wrap gap-3 items-end">
        <div>
          <label className="block text-xs text-slate-500 mb-1">Name</label>
          <input value={name} onChange={(e) => setName(e.target.value)} className="px-3 py-2 rounded-lg bg-slate-900 border border-slate-700 text-sm" />
        </div>
        <div>
          <label className="block text-xs text-slate-500 mb-1">VIP subnet</label>
          <select value={subnetId} onChange={(e) => setSubnetId(e.target.value)}
            className="px-3 py-2 rounded-lg bg-slate-900 border border-slate-700 text-sm min-w-[14rem]">
            <option value="">Select subnet…</option>
            {subnets.map((s) => (
              <option key={s.id} value={s.id}>{s.name || s.cidr}</option>
            ))}
          </select>
        </div>
        <button type="button" disabled={!name.trim() || !subnetId}
          className="px-3 py-1.5 rounded-lg bg-emerald-600 text-white text-sm disabled:opacity-40 inline-flex items-center gap-1"
          onClick={async () => {
            try {
              await createOpenStackLoadBalancer({ name: name.trim(), vip_subnet_id: subnetId })
              toast.success('Load balancer creating')
              setName('')
              void load()
            } catch (e: unknown) { toast.error(formatUserError(e)) }
          }}>
          <Plus className="w-4 h-4" /> Create
        </button>
      </div>

      {loading ? (
        <Loader2 className="w-8 h-8 animate-spin text-sky-400 mx-auto" />
      ) : lbs.length === 0 ? (
        <EmptyState title="No load balancers" description="Octavia may be unreachable or no LBs in this project." />
      ) : (
        <div className="overflow-x-auto rounded-xl border border-slate-700">
          <table className="w-full text-sm">
            <thead className="bg-slate-900/80 text-slate-400 text-left">
              <tr>
                <th className="px-3 py-2">Name</th>
                <th className="px-3 py-2">VIP</th>
                <th className="px-3 py-2">Provisioning</th>
                <th className="px-3 py-2">Operating</th>
                <th className="px-3 py-2" />
              </tr>
            </thead>
            <tbody>
              {lbs.map((lb) => (
                <tr key={lb.id} className="border-t border-slate-800">
                  <td className="px-3 py-2">
                    <Link to={`/openstack/load-balancers/${lb.id}`} className="text-sky-400 hover:underline">{lb.name}</Link>
                  </td>
                  <td className="px-3 py-2 font-mono">{lb.vip_address || '—'}</td>
                  <td className="px-3 py-2">{lb.provisioning_status}</td>
                  <td className="px-3 py-2">{lb.operating_status}</td>
                  <td className="px-3 py-2 text-right">
                    <button type="button" className={statusActionLinkClasses('error', 'inline-flex items-center gap-1')}
                      onClick={async () => {
                        if (!confirm(`Delete ${lb.name}?`)) return
                        try {
                          await deleteOpenStackLoadBalancer(lb.id)
                          toast.success('Deleted')
                          void load()
                        } catch (e: unknown) { toast.error(formatUserError(e)) }
                      }}>
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <OpenStackFooter />
    </PageLayout>
  )
}
