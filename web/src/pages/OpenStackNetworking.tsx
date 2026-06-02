// Copyright (c) 2026 ZyvorAI Labs Private Limited. All rights reserved.

import { useCallback, useEffect, useState, type ReactNode } from 'react'
import { Link } from 'react-router'
import {
  deleteOpenStackFloatingIp,
  dissociateOpenStackFloatingIp,
  listOpenStackFloatingIps,
  listOpenStackNetworks,
  type OpenStackFloatingIp,
} from '../api/openstack'
import {
  createOpenStackFloatingIp,
  createOpenStackNetwork,
  createOpenStackPort,
  addOpenStackRouterInterface,
  createOpenStackRouter,
  createOpenStackSubnet,
  deleteOpenStackNetwork,
  deleteOpenStackPort,
  deleteOpenStackRouter,
  deleteOpenStackSubnet,
  removeOpenStackRouterInterface,
  updateOpenStackNetwork,
  updateOpenStackPort,
  updateOpenStackRouter,
  listOpenStackPorts,
  listOpenStackRouters,
  listOpenStackSubnets,
  type OpenStackPort,
  type OpenStackRouter,
  type OpenStackSubnet,
} from '../api/openstackExtras'
import OpenStackGate from '../components/OpenStackGate'
import OpenStackSubNav from '../components/OpenStackSubNav'
import OpenStackFooter from '../components/OpenStackFooter'
import PageLayout from '../components/PageLayout'
import { useToastContext } from '../contexts/ToastContext'
import { formatUserError } from '../utils/apiError'
import { statusActionLinkClasses, statusDestructiveButtonClasses, statusToneClass } from '../utils/semanticColors'
import PageSkeleton from '../components/PageSkeleton'
import { Loader2, Network, Plus, RefreshCw } from 'lucide-react'

export default function OpenStackNetworkingPage() {
  return (
    <OpenStackGate title="Neutron topology">
      <OpenStackNetworkingContent />
    </OpenStackGate>
  )
}

function OpenStackNetworkingContent() {
  const toast = useToastContext()
  const [subnets, setSubnets] = useState<OpenStackSubnet[]>([])
  const [routers, setRouters] = useState<OpenStackRouter[]>([])
  const [ports, setPorts] = useState<OpenStackPort[]>([])
  const [networks, setNetworks] = useState<{ id: string; name: string; external: boolean }[]>([])
  const [loading, setLoading] = useState(true)
  const [newNetName, setNewNetName] = useState('')
  const [newNetExternal, setNewNetExternal] = useState(false)
  const [subnetNetId, setSubnetNetId] = useState('')
  const [subnetCidr, setSubnetCidr] = useState('10.0.0.0/24')
  const [subnetName, setSubnetName] = useState('')
  const [routerName, setRouterName] = useState('')
  const [routerExtNet, setRouterExtNet] = useState('')
  const [linkRouterId, setLinkRouterId] = useState('')
  const [linkSubnetId, setLinkSubnetId] = useState('')
  const [portNetId, setPortNetId] = useState('')
  const [portName, setPortName] = useState('')
  const [fipExtNet, setFipExtNet] = useState('')
  const [floatingIps, setFloatingIps] = useState<OpenStackFloatingIp[]>([])

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const [s, r, p, n, f] = await Promise.all([
        listOpenStackSubnets(),
        listOpenStackRouters(),
        listOpenStackPorts(),
        listOpenStackNetworks(),
        listOpenStackFloatingIps().catch(() => ({ floating_ips: [] as OpenStackFloatingIp[] })),
      ])
      setSubnets(s.subnets)
      setRouters(r.routers)
      setPorts(p.ports)
      const nets = n.networks.map((x) => ({ id: x.id, name: x.name, external: x.external }))
      setNetworks(nets)
      setFloatingIps(f.floating_ips)
      if (!fipExtNet) {
        const ext = nets.find((x) => x.external)
        if (ext) setFipExtNet(ext.id)
      }
      if (!portNetId && nets.length > 0) setPortNetId(nets[0].id)
      if (!linkRouterId && r.routers.length > 0) setLinkRouterId(r.routers[0].id)
      if (!linkSubnetId && s.subnets.length > 0) setLinkSubnetId(s.subnets[0].id)
      if (!subnetNetId && nets.length > 0) {
        const internal = nets.find((x) => !x.external) ?? nets[0]
        setSubnetNetId(internal.id)
      }
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
      className="max-w-5xl"
      prepend={<><OpenStackSubNav /></>}
    >
      <div className="flex items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold flex items-center gap-2">
          <Network className="w-7 h-7 text-sky-400" />
          Networking
        </h1>
        <button type="button" onClick={() => void load()}
          className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg border border-slate-600 text-sm">
          <RefreshCw className="w-4 h-4" /> Refresh
        </button>
      </div>

      <div className="rounded-xl border border-slate-700 p-4 space-y-4 text-sm">
        <h2 className="text-sm font-medium text-slate-300 flex items-center gap-2">
          <Plus className="w-4 h-4 text-sky-400" />
          Create (lab clouds)
        </h2>
        <div className="flex flex-wrap gap-3 items-end">
          <div>
            <label className="block text-xs text-slate-500 mb-1">Network name</label>
            <input
              value={newNetName}
              onChange={(e) => setNewNetName(e.target.value)}
              className="px-2 py-1.5 rounded-lg bg-slate-900 border border-slate-700 min-w-[10rem]"
              placeholder="private"
            />
          </div>
          <label className="flex items-center gap-2 text-slate-400 text-xs pb-2">
            <input
              type="checkbox"
              checked={newNetExternal}
              onChange={(e) => setNewNetExternal(e.target.checked)}
              className="rounded border-slate-600"
            />
            External
          </label>
          <button
            type="button"
            className="px-3 py-1.5 rounded-lg bg-sky-600 text-white text-sm"
            onClick={async () => {
              const name = newNetName.trim()
              if (!name) return
              try {
                await createOpenStackNetwork({ name, external: newNetExternal })
                toast.success(`Network ${name} created`)
                setNewNetName('')
                void load()
              } catch (e: unknown) {
                toast.error(formatUserError(e))
              }
            }}
          >
            Create network
          </button>
        </div>
        <div className="flex flex-wrap gap-3 items-end border-t border-slate-800 pt-4">
          <div>
            <label className="block text-xs text-slate-500 mb-1">Network</label>
            <select
              value={subnetNetId}
              onChange={(e) => setSubnetNetId(e.target.value)}
              className="px-2 py-1.5 rounded-lg bg-slate-900 border border-slate-700 min-w-[12rem]"
            >
              {networks.map((n) => (
                <option key={n.id} value={n.id}>{n.name || n.id.slice(0, 8)}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-xs text-slate-500 mb-1">CIDR</label>
            <input
              value={subnetCidr}
              onChange={(e) => setSubnetCidr(e.target.value)}
              className="px-2 py-1.5 rounded-lg bg-slate-900 border border-slate-700 font-mono w-36"
            />
          </div>
          <div>
            <label className="block text-xs text-slate-500 mb-1">Subnet name (optional)</label>
            <input
              value={subnetName}
              onChange={(e) => setSubnetName(e.target.value)}
              className="px-2 py-1.5 rounded-lg bg-slate-900 border border-slate-700"
              placeholder="private-subnet"
            />
          </div>
          <button
            type="button"
            className="px-3 py-1.5 rounded-lg bg-sky-600 text-white text-sm"
            onClick={async () => {
              if (!subnetNetId || !subnetCidr.trim()) return
              try {
                await createOpenStackSubnet({
                  network_id: subnetNetId,
                  cidr: subnetCidr.trim(),
                  name: subnetName.trim() || undefined,
                })
                toast.success('Subnet created')
                void load()
              } catch (e: unknown) {
                toast.error(formatUserError(e))
              }
            }}
          >
            Create subnet
          </button>
        </div>
        <div className="flex flex-wrap gap-3 items-end border-t border-slate-800 pt-4">
          <div>
            <label className="block text-xs text-slate-500 mb-1">Router name</label>
            <input
              value={routerName}
              onChange={(e) => setRouterName(e.target.value)}
              className="px-2 py-1.5 rounded-lg bg-slate-900 border border-slate-700"
              placeholder="router1"
            />
          </div>
          <div>
            <label className="block text-xs text-slate-500 mb-1">External network (optional)</label>
            <select
              value={routerExtNet}
              onChange={(e) => setRouterExtNet(e.target.value)}
              className="px-2 py-1.5 rounded-lg bg-slate-900 border border-slate-700 min-w-[12rem]"
            >
              <option value="">None</option>
              {networks.filter((n) => n.external).map((n) => (
                <option key={n.id} value={n.id}>{n.name || n.id.slice(0, 8)}</option>
              ))}
            </select>
          </div>
          <button
            type="button"
            className="px-3 py-1.5 rounded-lg bg-sky-600 text-white text-sm"
            onClick={async () => {
              const name = routerName.trim()
              if (!name) return
              try {
                await createOpenStackRouter({
                  name,
                  external_network_id: routerExtNet || undefined,
                })
                toast.success(`Router ${name} created`)
                setRouterName('')
                void load()
              } catch (e: unknown) {
                toast.error(formatUserError(e))
              }
            }}
          >
            Create router
          </button>
        </div>
        <div className="flex flex-wrap gap-3 items-end border-t border-slate-800 pt-4">
          <div>
            <label className="block text-xs text-slate-500 mb-1">Router</label>
            <select
              value={linkRouterId}
              onChange={(e) => setLinkRouterId(e.target.value)}
              className="px-2 py-1.5 rounded-lg bg-slate-900 border border-slate-700 min-w-[12rem]"
            >
              {routers.map((r) => (
                <option key={r.id} value={r.id}>{r.name || r.id.slice(0, 8)}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-xs text-slate-500 mb-1">Subnet</label>
            <select
              value={linkSubnetId}
              onChange={(e) => setLinkSubnetId(e.target.value)}
              className="px-2 py-1.5 rounded-lg bg-slate-900 border border-slate-700 min-w-[12rem]"
            >
              {subnets.map((s) => (
                <option key={s.id} value={s.id}>{s.name} · {s.cidr}</option>
              ))}
            </select>
          </div>
          <button
            type="button"
            className="px-3 py-1.5 rounded-lg bg-violet-600 text-white text-sm"
            onClick={async () => {
              if (!linkRouterId || !linkSubnetId) return
              try {
                await addOpenStackRouterInterface({
                  router_id: linkRouterId,
                  subnet_id: linkSubnetId,
                })
                toast.success('Subnet linked to router')
                void load()
              } catch (e: unknown) {
                toast.error(formatUserError(e))
              }
            }}
          >
            Link subnet → router
          </button>
          <button
            type="button"
            className="px-3 py-1.5 rounded-lg border border-red-600/50 text-red-300 text-sm"
            onClick={async () => {
              if (!linkRouterId || !linkSubnetId) return
              try {
                await removeOpenStackRouterInterface({
                  router_id: linkRouterId,
                  subnet_id: linkSubnetId,
                })
                toast.success('Subnet unlinked from router')
                void load()
              } catch (e: unknown) {
                toast.error(formatUserError(e))
              }
            }}
          >
            Unlink subnet
          </button>
        </div>
        <div className="flex flex-wrap gap-3 items-end border-t border-slate-800 pt-4">
          <div>
            <label className="block text-xs text-slate-500 mb-1">Network (port)</label>
            <select
              value={portNetId}
              onChange={(e) => setPortNetId(e.target.value)}
              className="px-2 py-1.5 rounded-lg bg-slate-900 border border-slate-700 min-w-[12rem]"
            >
              {networks.map((n) => (
                <option key={n.id} value={n.id}>{n.name || n.id.slice(0, 8)}</option>
              ))}
            </select>
          </div>
          <input
            value={portName}
            onChange={(e) => setPortName(e.target.value)}
            placeholder="Port name (optional)"
            className="px-2 py-1.5 rounded-lg bg-slate-900 border border-slate-700"
          />
          <button
            type="button"
            className="px-3 py-1.5 rounded-lg bg-sky-600 text-white text-sm"
            onClick={async () => {
              if (!portNetId) return
              try {
                await createOpenStackPort({
                  network_id: portNetId,
                  name: portName.trim() || undefined,
                })
                toast.success('Port created')
                void load()
              } catch (e: unknown) {
                toast.error(formatUserError(e))
              }
            }}
          >
            Create port
          </button>
        </div>
        <div className="flex flex-wrap gap-3 items-end border-t border-slate-800 pt-4">
          <div>
            <label className="block text-xs text-slate-500 mb-1">External network (FIP)</label>
            <select
              value={fipExtNet}
              onChange={(e) => setFipExtNet(e.target.value)}
              className="px-2 py-1.5 rounded-lg bg-slate-900 border border-slate-700 min-w-[12rem]"
            >
              {networks.filter((n) => n.external).map((n) => (
                <option key={n.id} value={n.id}>{n.name || n.id.slice(0, 8)}</option>
              ))}
            </select>
          </div>
          <button
            type="button"
            className="px-3 py-1.5 rounded-lg bg-emerald-600 text-white text-sm"
            onClick={async () => {
              if (!fipExtNet) return
              try {
                await createOpenStackFloatingIp(fipExtNet)
                toast.success('Floating IP allocated')
                void load()
              } catch (e: unknown) {
                toast.error(formatUserError(e))
              }
            }}
          >
            Allocate FIP
          </button>
        </div>
      </div>

      {loading ? (
        <PageSkeleton />
      ) : (
        <div className="grid lg:grid-cols-2 gap-4">
          <Section title={`Networks (${networks.length})`}>
            <ul className="text-sm space-y-1 font-mono">
              {networks.map((n) => (
                <li key={n.id} className="text-slate-300 flex items-center gap-2">
                  <Link to={`/openstack/networks/${n.id}`} className="text-sky-300 hover:underline">{n.name}</Link>
                  {n.external && <span className={`text-xs ${statusToneClass('warn')}`}>external</span>}
                  <button type="button" className="text-sky-400 text-xs hover:underline" onClick={async () => {
                    const nn = prompt('Network name', n.name)
                    if (nn === null || !nn.trim()) return
                    try { await updateOpenStackNetwork(n.id, { name: nn.trim() }); toast.success('Renamed'); void load() }
                    catch (e: unknown) { toast.error(formatUserError(e)) }
                  }}>Rename</button>
                  <button type="button" className={statusActionLinkClasses('error', 'text-xs')} onClick={async () => {
                    if (!confirm(`Delete network ${n.name}?`)) return
                    try { await deleteOpenStackNetwork(n.id); toast.success('Network deleted'); void load() }
                    catch (e: unknown) { toast.error(formatUserError(e)) }
                  }}>Del</button>
                </li>
              ))}
            </ul>
          </Section>
          <Section title={`Subnets (${subnets.length})`}>
            <ul className="text-sm space-y-1 font-mono text-slate-300">
              {subnets.map((s) => (
                <li key={s.id} className="flex items-center gap-2">
                  <Link to={`/openstack/subnets/${s.id}`} className="text-sky-300 hover:underline">{s.name}</Link>
                  <span> · {s.cidr}</span>
                  <button type="button" className={statusActionLinkClasses('error', 'text-xs')} onClick={async () => {
                    if (!confirm(`Delete subnet ${s.name}?`)) return
                    try { await deleteOpenStackSubnet(s.id); toast.success('Subnet deleted'); void load() }
                    catch (e: unknown) { toast.error(formatUserError(e)) }
                  }}>Del</button>
                </li>
              ))}
            </ul>
          </Section>
          <Section title={`Routers (${routers.length})`}>
            <ul className="text-sm space-y-1 font-mono text-slate-300">
              {routers.map((r) => (
                <li key={r.id} className="flex items-center gap-2">
                  <Link to={`/openstack/routers/${r.id}`} className="text-sky-300 hover:underline">{r.name}</Link>
                  <span> · {r.status}</span>
                  <button type="button" className="text-sky-400 text-xs hover:underline" onClick={async () => {
                    const nn = prompt('Router name', r.name)
                    if (nn === null || !nn.trim()) return
                    try { await updateOpenStackRouter(r.id, { name: nn.trim() }); toast.success('Renamed'); void load() }
                    catch (e: unknown) { toast.error(formatUserError(e)) }
                  }}>Rename</button>
                  <button type="button" className={statusActionLinkClasses('error', 'text-xs')} onClick={async () => {
                    if (!confirm(`Delete router ${r.name}?`)) return
                    try { await deleteOpenStackRouter(r.id); toast.success('Router deleted'); void load() }
                    catch (e: unknown) { toast.error(formatUserError(e)) }
                  }}>Del</button>
                </li>
              ))}
            </ul>
          </Section>
          <Section title={`Ports (${ports.length})`}>
            <ul className="text-sm space-y-1 font-mono text-slate-300 max-h-64 overflow-y-auto">
              {ports.slice(0, 40).map((p) => (
                <li key={p.id} className="flex flex-wrap items-center gap-2">
                  <Link to={`/openstack/ports/${p.id}`} className="text-sky-300 hover:underline">{p.name || p.id.slice(0, 8)}</Link>
                  <span>· {p.fixed_ips.join(', ') || '—'}</span>
                  <button type="button" className="text-sky-400 text-xs hover:underline" onClick={async () => {
                    const nn = prompt('Port name', p.name || '')
                    if (nn === null) return
                    try { await updateOpenStackPort(p.id, { name: nn.trim() || undefined }); toast.success('Updated'); void load() }
                    catch (e: unknown) { toast.error(formatUserError(e)) }
                  }}>Rename</button>
                  <button type="button" className="text-violet-400 text-xs hover:underline" onClick={async () => {
                    const up = p.admin_state_up !== false
                    if (up && !confirm('Set port admin state down?')) return
                    try {
                      await updateOpenStackPort(p.id, { admin_state_up: !up })
                      toast.success(up ? 'Admin down' : 'Admin up')
                      void load()
                    } catch (e: unknown) { toast.error(formatUserError(e)) }
                  }}>{p.admin_state_up === false ? 'Admin up' : 'Admin down'}</button>
                  {!p.device_id && (
                    <button
                      type="button"
                      className={statusActionLinkClasses('error', 'text-xs')}
                      onClick={async () => {
                        if (!confirm(`Delete port ${p.name || p.id}?`)) return
                        try {
                          await deleteOpenStackPort(p.id)
                          toast.success('Port deleted')
                          void load()
                        } catch (e: unknown) {
                          toast.error(formatUserError(e))
                        }
                      }}
                    >
                      Delete
                    </button>
                  )}
                </li>
              ))}
            </ul>
          </Section>
          <Section title={`Floating IPs (${floatingIps.length})`}>
            <ul className="text-sm space-y-1 font-mono text-slate-300 max-h-48 overflow-y-auto">
              {floatingIps.map((fip) => (
                <li key={fip.id} className="flex flex-wrap items-center gap-2">
                  <span>{fip.address}</span>
                  <span className="text-slate-500 text-xs">{fip.status}</span>
                  {fip.instance_id && (
                    <span className="text-slate-500 text-xs">→ {fip.instance_id.slice(0, 8)}</span>
                  )}
                  {fip.instance_id && (
                    <button
                      type="button"
                      className={statusActionLinkClasses('warn', 'text-xs')}
                      onClick={async () => {
                        try {
                          await dissociateOpenStackFloatingIp(fip.id)
                          toast.success('Dissociated')
                          void load()
                        } catch (e: unknown) {
                          toast.error(formatUserError(e))
                        }
                      }}
                    >
                      Dissociate
                    </button>
                  )}
                  <button
                    type="button"
                    className={statusActionLinkClasses('error', 'text-xs')}
                    onClick={async () => {
                      if (!confirm(`Release floating IP ${fip.address}?`)) return
                      try {
                        await deleteOpenStackFloatingIp(fip.id)
                        toast.success('Floating IP released')
                        void load()
                      } catch (e: unknown) {
                        toast.error(formatUserError(e))
                      }
                    }}
                  >
                    Release
                  </button>
                </li>
              ))}
            </ul>
          </Section>
        </div>
      )}
      <OpenStackFooter />
    </PageLayout>
  )
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="rounded-xl border border-slate-700 p-4">
      <h2 className="text-sm font-medium text-slate-400 mb-2">{title}</h2>
      {children}
    </div>
  )
}
