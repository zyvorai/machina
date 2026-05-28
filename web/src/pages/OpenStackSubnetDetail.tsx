// Copyright (c) 2026 ZyvorAI Labs Private Limited. All rights reserved.

import { useCallback, useEffect, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router'
import { ArrowLeft, Loader2, Network, Trash2 } from 'lucide-react'
import { getOpenStackSubnet, updateOpenStackSubnet, deleteOpenStackSubnet, type OpenStackSubnet } from '../api/openstackExtras'
import OpenStackGate from '../components/OpenStackGate'
import OpenStackSubNav from '../components/OpenStackSubNav'
import OpenStackFooter from '../components/OpenStackFooter'
import { useToastContext } from '../contexts/ToastContext'
import { formatUserError } from '../utils/apiError'

export default function OpenStackSubnetDetailPage() {
  return (
    <OpenStackGate title="Subnet">
      <OpenStackSubnetDetailContent />
    </OpenStackGate>
  )
}

function OpenStackSubnetDetailContent() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const toast = useToastContext()
  const [subnet, setSubnet] = useState<OpenStackSubnet | null>(null)
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    if (!id) return
    setLoading(true)
    try {
      const { subnet: s } = await getOpenStackSubnet(id)
      setSubnet(s)
    } catch (e: unknown) {
      toast.error(formatUserError(e))
      setSubnet(null)
    } finally {
      setLoading(false)
    }
  }, [id, toast])

  useEffect(() => { void load() }, [load])

  if (loading) return <Loader2 className="w-8 h-8 animate-spin text-sky-400 mx-auto py-12" />
  if (!subnet) {
    return (
      <div className="space-y-4">
        <OpenStackSubNav />
        <Link to="/openstack/networking" className="text-sky-400 hover:underline">Back</Link>
      </div>
    )
  }

  const dhcpOn = subnet.enable_dhcp !== false

  return (
    <div className="space-y-6 max-w-3xl">
      <OpenStackSubNav />
      <Link to="/openstack/networking" className="inline-flex items-center gap-2 text-slate-400 hover:text-slate-200 text-sm">
        <ArrowLeft className="w-4 h-4" /> Networking
      </Link>
      <h1 className="text-2xl font-semibold flex items-center gap-2">
        <Network className="w-7 h-7 text-sky-400" />
        {subnet.name || subnet.cidr}
      </h1>
      <dl className="grid sm:grid-cols-2 gap-4 rounded-xl border border-slate-700 p-4 text-sm">
        <div><dt className="text-xs text-slate-500 uppercase">ID</dt><dd className="font-mono text-slate-200 mt-1 break-all">{subnet.id}</dd></div>
        <div><dt className="text-xs text-slate-500 uppercase">CIDR</dt><dd className="font-mono text-slate-200 mt-1">{subnet.cidr}</dd></div>
        <div><dt className="text-xs text-slate-500 uppercase">Network</dt><dd className="font-mono text-xs mt-1">
          <Link to={`/openstack/networks/${subnet.network_id}`} className="text-sky-400 hover:underline">{subnet.network_id}</Link>
        </dd></div>
        <div><dt className="text-xs text-slate-500 uppercase">Gateway</dt><dd className="text-slate-200 mt-1">{subnet.gateway_ip || '—'}</dd></div>
        <div><dt className="text-xs text-slate-500 uppercase">IP version</dt><dd className="text-slate-200 mt-1">{subnet.ip_version}</dd></div>
        <div><dt className="text-xs text-slate-500 uppercase">DHCP</dt><dd className="text-slate-200 mt-1">{dhcpOn ? 'Enabled' : 'Disabled'}</dd></div>
      </dl>
      <div className="flex flex-wrap gap-2">
        <button type="button" className="px-3 py-1.5 rounded-lg border border-slate-600 text-sm"
          onClick={async () => {
            const n = prompt('Subnet name', subnet.name)
            if (n === null || !n.trim()) return
            try {
              await updateOpenStackSubnet(subnet.id, { name: n.trim() })
              toast.success('Renamed')
              void load()
            } catch (e: unknown) { toast.error(formatUserError(e)) }
          }}>Rename</button>
        <button type="button" className="px-3 py-1.5 rounded-lg border border-slate-600 text-sm"
          onClick={async () => {
            const g = prompt('Gateway IP', subnet.gateway_ip || '')
            if (g === null) return
            try {
              await updateOpenStackSubnet(subnet.id, { gateway_ip: g.trim() || undefined })
              toast.success('Updated gateway')
              void load()
            } catch (e: unknown) { toast.error(formatUserError(e)) }
          }}>Set gateway</button>
        <button type="button" className="px-3 py-1.5 rounded-lg border border-violet-600/50 text-violet-200 text-sm"
          onClick={async () => {
            const next = !dhcpOn
            if (!confirm(`${next ? 'Enable' : 'Disable'} DHCP on this subnet?`)) return
            try {
              await updateOpenStackSubnet(subnet.id, { enable_dhcp: next })
              toast.success(next ? 'DHCP enabled' : 'DHCP disabled')
              void load()
            } catch (e: unknown) { toast.error(formatUserError(e)) }
          }}>{dhcpOn ? 'Disable DHCP' : 'Enable DHCP'}</button>
        <button type="button" className="px-3 py-1.5 rounded-lg border border-red-600/50 text-red-300 text-sm inline-flex items-center gap-1"
          onClick={async () => {
            if (!confirm(`Delete subnet ${subnet.name || subnet.cidr}?`)) return
            try {
              await deleteOpenStackSubnet(subnet.id)
              toast.success('Subnet deleted')
              navigate('/openstack/networking')
            } catch (e: unknown) { toast.error(formatUserError(e)) }
          }}>
          <Trash2 className="w-4 h-4" /> Delete
        </button>
      </div>
      <OpenStackFooter />
    </div>
  )
}
