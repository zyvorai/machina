// Copyright (c) 2026 ZyvorAI Labs Private Limited. All rights reserved.

import { useCallback, useEffect, useState } from 'react'
import { Link, useParams } from 'react-router'
import { ArrowLeft, Loader2, Network } from 'lucide-react'
import { getOpenStackInstance, listOpenStackNetworks, type OpenStackInstance, type OpenStackNetwork } from '../api/openstack'
import {
  attachOpenStackInterface,
  detachOpenStackInterface,
  listOpenStackInstanceInterfaces,
  type OpenStackInstanceInterface,
} from '../api/openstackExtras'
import OpenStackGate from '../components/OpenStackGate'
import OpenStackSubNav from '../components/OpenStackSubNav'
import OpenStackFooter from '../components/OpenStackFooter'
import PageLayout from '../components/PageLayout'
import { useToastContext } from '../contexts/ToastContext'
import { formatUserError } from '../utils/apiError'
import { statusActionLinkClasses, statusDestructiveButtonClasses, statusToneClass } from '../utils/semanticColors'

export default function OpenStackInstanceInterfacesPage() {
  return (
    <OpenStackGate title="Instance interfaces">
      <OpenStackInstanceInterfacesContent />
    </OpenStackGate>
  )
}

function OpenStackInstanceInterfacesContent() {
  const { id } = useParams<{ id: string }>()
  const toast = useToastContext()
  const [inst, setInst] = useState<OpenStackInstance | null>(null)
  const [ifaces, setIfaces] = useState<OpenStackInstanceInterface[]>([])
  const [networks, setNetworks] = useState<OpenStackNetwork[]>([])
  const [attachNetId, setAttachNetId] = useState('')
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    if (!id) return
    setLoading(true)
    try {
      const [instance, ifc, nets] = await Promise.all([
        getOpenStackInstance(id),
        listOpenStackInstanceInterfaces(id),
        listOpenStackNetworks().catch(() => ({ networks: [] as OpenStackNetwork[] })),
      ])
      setInst(instance)
      setIfaces(ifc.interfaces)
      setNetworks(nets.networks)
    } catch (e: unknown) {
      toast.error(formatUserError(e))
      setInst(null)
    } finally {
      setLoading(false)
    }
  }, [id, toast])

  useEffect(() => { void load() }, [load])

  const run = async (fn: () => Promise<unknown>, ok: string) => {
    try {
      await fn()
      toast.success(ok)
      void load()
    } catch (e: unknown) {
      toast.error(formatUserError(e))
    }
  }

  if (loading) return <Loader2 className="w-8 h-8 animate-spin text-sky-400 mx-auto py-12" />
  if (!inst) {
    return (
      <div className="space-y-4">
        <OpenStackSubNav />
        <Link to="/openstack/instances" className="text-sky-400 hover:underline">Back</Link>
      </div>
    )
  }

  return (
    <PageLayout
      hideHeader
      className="max-w-3xl"
      prepend={<><OpenStackSubNav /></>}
    >
      <Link to={`/openstack/instances/${inst.id}`} className="inline-flex items-center gap-2 text-slate-400 hover:text-slate-200 text-sm">
        <ArrowLeft className="w-4 h-4" /> {inst.name}
      </Link>
      <h1 className="text-2xl font-semibold flex items-center gap-2">
        <Network className="w-7 h-7 text-sky-400" />
        Network interfaces
      </h1>
      <p className="text-sm text-slate-400 font-mono">{inst.id}</p>

      <section className="rounded-xl border border-slate-700 p-4 space-y-3">
        <h2 className="text-sm font-medium text-slate-300">Attached interfaces ({ifaces.length})</h2>
        {ifaces.length === 0 ? (
          <p className="text-sm text-slate-500">No interfaces attached.</p>
        ) : (
          <ul className="space-y-2 text-sm">
            {ifaces.map((i) => (
              <li key={i.port_id} className="flex flex-wrap items-center gap-3 rounded-lg border border-slate-800 px-3 py-2 font-mono">
                <span className="text-slate-200">{i.fixed_ips.join(', ') || '—'}</span>
                <span className="text-slate-500 text-xs">MAC {i.mac_addr}</span>
                <Link to={`/openstack/ports/${i.port_id}`} className="text-sky-400 text-xs hover:underline">Port</Link>
                <Link to={`/openstack/networks/${i.net_id}`} className="text-sky-400 text-xs hover:underline">Network</Link>
                <button type="button" className={statusActionLinkClasses('error', 'text-xs ml-auto')}
                  onClick={() => void run(() => detachOpenStackInterface(inst.id, i.port_id), 'Interface detached')}>
                  Detach
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="rounded-xl border border-slate-700 p-4 space-y-3">
        <h2 className="text-sm font-medium text-slate-300">Attach network</h2>
        <div className="flex flex-wrap gap-2 items-end">
          <select value={attachNetId} onChange={(e) => setAttachNetId(e.target.value)}
            className="px-2 py-1.5 rounded-lg bg-slate-900 border border-slate-700 text-sm min-w-[14rem]">
            <option value="">Select network…</option>
            {networks.map((n) => (
              <option key={n.id} value={n.id}>{n.name || n.id}</option>
            ))}
          </select>
          <button type="button" disabled={!attachNetId}
            className="px-3 py-1.5 rounded-lg bg-sky-600 text-white text-sm disabled:opacity-40"
            onClick={() => void run(
              () => attachOpenStackInterface(inst.id, { network_id: attachNetId }),
              'Interface attached',
            )}>Attach NIC</button>
        </div>
      </section>
      <OpenStackFooter />
    </PageLayout>
  )
}
