// Copyright (c) 2026 ZyvorAI Labs Private Limited. All rights reserved.

import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router'
import {
  deleteOpenStackFloatingIp,
  dissociateOpenStackFloatingIp,
  listOpenStackFloatingIps,
  listOpenStackInstances,
  listOpenStackNetworks,
  associateOpenStackFloatingIp,
  type OpenStackFloatingIp,
} from '../api/openstack'
import { createOpenStackFloatingIp } from '../api/openstackExtras'
import OpenStackGate from '../components/OpenStackGate'
import OpenStackSubNav from '../components/OpenStackSubNav'
import OpenStackFooter from '../components/OpenStackFooter'
import PageLayout from '../components/PageLayout'
import { useToastContext } from '../contexts/ToastContext'
import { formatUserError } from '../utils/apiError'
import { statusActionLinkClasses, statusDestructiveButtonClasses, statusToneClass } from '../utils/semanticColors'
import { Globe, Loader2, RefreshCw } from 'lucide-react'

export default function OpenStackFloatingIpsPage() {
  return (
    <OpenStackGate title="Floating IPs">
      <OpenStackFloatingIpsContent />
    </OpenStackGate>
  )
}

function OpenStackFloatingIpsContent() {
  const toast = useToastContext()
  const [fips, setFips] = useState<OpenStackFloatingIp[]>([])
  const [networks, setNetworks] = useState<{ id: string; name: string }[]>([])
  const [instances, setInstances] = useState<{ id: string; name: string }[]>([])
  const [loading, setLoading] = useState(true)
  const [extNet, setExtNet] = useState('')
  const [assocFip, setAssocFip] = useState('')
  const [assocInst, setAssocInst] = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const [f, n, inst] = await Promise.all([
        listOpenStackFloatingIps(),
        listOpenStackNetworks(),
        listOpenStackInstances().catch(() => ({ instances: [] })),
      ])
      setFips(f.floating_ips)
      const ext = n.networks.filter((x) => x.external)
      setNetworks(ext.map((x) => ({ id: x.id, name: x.name })))
      setInstances(inst.instances.map((i) => ({ id: i.id, name: i.name })))
      if (!extNet && ext.length > 0) setExtNet(ext[0].id)
      const free = f.floating_ips.filter((x) => !x.instance_id)
      if (!assocFip && free.length > 0) setAssocFip(free[0].id)
      if (!assocInst && inst.instances.length > 0) setAssocInst(inst.instances[0].id)
    } catch (e: unknown) {
      toast.error(formatUserError(e))
    } finally {
      setLoading(false)
    }
  }, [toast])

  useEffect(() => {
    void load()
  }, [load])

  return (
    <PageLayout
      hideHeader
      className="max-w-4xl"
      prepend={<><OpenStackSubNav /></>}
    >
      <h1 className="text-2xl font-semibold flex items-center gap-2">
        <Globe className="w-7 h-7 text-sky-400" />
        Floating IPs
      </h1>
      <div className="rounded-xl border border-slate-700 p-4 flex flex-wrap gap-3 items-end text-sm">
        <div>
          <label className="block text-xs text-slate-500 mb-1">External network</label>
          <select value={extNet} onChange={(e) => setExtNet(e.target.value)}
            className="px-2 py-1.5 rounded-lg bg-slate-900 border border-slate-700 min-w-[12rem]">
            {networks.map((n) => (
              <option key={n.id} value={n.id}>{n.name || n.id.slice(0, 8)}</option>
            ))}
          </select>
        </div>
        <button type="button" disabled={!extNet} className="px-3 py-1.5 rounded-lg bg-emerald-600 text-white"
          onClick={async () => {
            try {
              await createOpenStackFloatingIp(extNet)
              toast.success('Floating IP allocated')
              void load()
            } catch (e: unknown) { toast.error(formatUserError(e)) }
          }}>Allocate</button>
        <button type="button" onClick={() => void load()}
          className="ml-auto inline-flex items-center gap-1 px-3 py-1.5 rounded-lg border border-slate-600">
          <RefreshCw className="w-4 h-4" /> Refresh
        </button>
      </div>
      <div className="rounded-xl border border-slate-700 p-4 space-y-3 text-sm">
        <h2 className="text-sm font-medium text-slate-300">Associate to instance</h2>
        <div className="flex flex-wrap gap-3 items-end">
          <select value={assocFip} onChange={(e) => setAssocFip(e.target.value)}
            aria-label="Floating IP"
            className="min-w-[10rem] px-2 py-1.5 rounded-lg bg-slate-900 border border-slate-700">
            <option value="">FIP…</option>
            {fips.filter((f) => !f.instance_id).map((f) => (
              <option key={f.id} value={f.id}>{f.address}</option>
            ))}
          </select>
          <select value={assocInst} onChange={(e) => setAssocInst(e.target.value)}
            aria-label="Instance"
            className="min-w-[10rem] px-2 py-1.5 rounded-lg bg-slate-900 border border-slate-700">
            <option value="">Instance…</option>
            {instances.map((i) => (
              <option key={i.id} value={i.id}>{i.name || i.id.slice(0, 8)}</option>
            ))}
          </select>
          <button type="button" disabled={!assocFip || !assocInst}
            className="px-3 py-1.5 rounded-lg bg-sky-600 text-white disabled:opacity-40"
            onClick={async () => {
              try {
                await associateOpenStackFloatingIp(assocInst, { floating_ip_id: assocFip })
                toast.success('Associated')
                void load()
              } catch (e: unknown) { toast.error(formatUserError(e)) }
            }}>Associate</button>
        </div>
      </div>
      {loading ? (
        <Loader2 className="w-8 h-8 animate-spin text-sky-400 mx-auto" />
      ) : (
        <div className="rounded-xl border border-slate-700 overflow-hidden">
          <table className="w-full text-sm" aria-label="Floating IPs">
            <thead className="bg-slate-900/80 text-slate-400 text-left">
              <tr>
                <th className="px-3 py-2">Address</th>
                <th className="px-3 py-2">Status</th>
                <th className="px-3 py-2">Instance</th>
                <th className="px-3 py-2">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800">
              {fips.map((fip) => (
                <tr key={fip.id}>
                  <td className="px-3 py-2 font-mono text-slate-200">
                    <Link to={`/openstack/floating-ips/${fip.id}`} className="text-sky-300 hover:underline">{fip.address}</Link>
                  </td>
                  <td className="px-3 py-2 text-slate-400">{fip.status}</td>
                  <td className="px-3 py-2">
                    {fip.instance_id ? (
                      <Link to={`/openstack/instances/${fip.instance_id}`} className="text-sky-400 hover:underline font-mono text-xs">
                        {fip.instance_id.slice(0, 8)}
                      </Link>
                    ) : '—'}
                  </td>
                  <td className="px-3 py-2 flex flex-wrap gap-2">
                    <Link to={`/openstack/floating-ips/${fip.id}`} className="text-xs text-violet-400 hover:underline">Detail</Link>
                    {fip.instance_id && (
                      <button type="button" className={statusActionLinkClasses('warn', 'text-xs')}
                        onClick={async () => {
                          try {
                            await dissociateOpenStackFloatingIp(fip.id)
                            toast.success('Dissociated')
                            void load()
                          } catch (e: unknown) { toast.error(formatUserError(e)) }
                        }}>Dissociate</button>
                    )}
                    <button type="button" className={statusActionLinkClasses('error', 'text-xs')}
                      onClick={async () => {
                        if (!confirm(`Release ${fip.address}?`)) return
                        try {
                          await deleteOpenStackFloatingIp(fip.id)
                          toast.success('Released')
                          void load()
                        } catch (e: unknown) { toast.error(formatUserError(e)) }
                      }}>Release</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {fips.length === 0 && <p className="p-6 text-center text-slate-500">No floating IPs.</p>}
        </div>
      )}
      <OpenStackFooter />
    </PageLayout>
  )
}
