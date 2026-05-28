// Copyright (c) 2026 ZyvorAI Labs Private Limited. All rights reserved.

import { useCallback, useEffect, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router'
import { ArrowLeft, Network, Loader2, Trash2 } from 'lucide-react'
import type { OpenStackNetwork } from '../api/openstack'
import { getOpenStackNetwork, updateOpenStackNetwork, deleteOpenStackNetwork } from '../api/openstackExtras'
import OpenStackGate from '../components/OpenStackGate'
import OpenStackSubNav from '../components/OpenStackSubNav'
import OpenStackFooter from '../components/OpenStackFooter'
import { useToastContext } from '../contexts/ToastContext'
import { formatUserError } from '../utils/apiError'

export default function OpenStackNetworkDetailPage() {
  return (
    <OpenStackGate title="Network">
      <OpenStackNetworkDetailContent />
    </OpenStackGate>
  )
}

function OpenStackNetworkDetailContent() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const toast = useToastContext()
  const [net, setNet] = useState<OpenStackNetwork | null>(null)
  const [loading, setLoading] = useState(true)
  const [deleteOpen, setDeleteOpen] = useState(false)

  const load = useCallback(async () => {
    if (!id) return
    setLoading(true)
    try {
      const { network } = await getOpenStackNetwork(id)
      setNet(network)
    } catch (e: unknown) {
      toast.error(formatUserError(e))
      setNet(null)
    } finally {
      setLoading(false)
    }
  }, [id, toast])

  useEffect(() => { void load() }, [load])

  if (loading) return <Loader2 className="w-8 h-8 animate-spin text-sky-400 mx-auto py-12" />
  if (!net) {
    return (
      <div className="space-y-4">
        <OpenStackSubNav />
        <p className="text-slate-400">Network not found.</p>
        <Link to="/openstack/networking" className="text-sky-400 hover:underline">Back</Link>
      </div>
    )
  }

  return (
    <div className="space-y-6 max-w-3xl">
      <OpenStackSubNav />
      <Link to="/openstack/networking" className="inline-flex items-center gap-2 text-slate-400 hover:text-slate-200 text-sm">
        <ArrowLeft className="w-4 h-4" /> Networking
      </Link>
      <h1 className="text-2xl font-semibold flex items-center gap-2">
        <Network className="w-7 h-7 text-sky-400" />
        {net.name || net.id.slice(0, 12)}
      </h1>
      <dl className="grid sm:grid-cols-2 gap-4 rounded-xl border border-slate-700 p-4 text-sm">
        <div><dt className="text-xs text-slate-500 uppercase">ID</dt><dd className="font-mono text-slate-200 mt-1 break-all">{net.id}</dd></div>
        <div><dt className="text-xs text-slate-500 uppercase">Status</dt><dd className="text-slate-200 mt-1">{net.status}</dd></div>
        <div><dt className="text-xs text-slate-500 uppercase">External</dt><dd className="text-slate-200 mt-1">{net.external ? 'Yes' : 'No'}</dd></div>
        <div><dt className="text-xs text-slate-500 uppercase">Shared</dt><dd className="text-slate-200 mt-1">{net.shared ? 'Yes' : 'No'}</dd></div>
      </dl>
      <div className="flex flex-wrap gap-2">
        <button type="button" className="px-3 py-1.5 rounded-lg border border-slate-600 text-sm"
          onClick={async () => {
            const n = prompt('Network name', net.name)
            if (n === null || !n.trim()) return
            try {
              await updateOpenStackNetwork(net.id, { name: n.trim() })
              toast.success('Renamed')
              void load()
            } catch (e: unknown) { toast.error(formatUserError(e)) }
          }}>Rename</button>
        <button type="button" className="px-3 py-1.5 rounded-lg border border-red-600/50 text-red-300 text-sm hover:bg-red-500/10 inline-flex items-center gap-1"
          onClick={() => setDeleteOpen(true)}>
          <Trash2 className="w-4 h-4" /> Delete
        </button>
      </div>
      {deleteOpen && (
        <div className="rounded-xl border border-red-500/40 bg-red-950/20 p-4 space-y-3">
          <p className="text-sm text-red-200">Delete network <span className="font-mono">{net.name || net.id}</span>? Subnets and ports must be removed first.</p>
          <div className="flex gap-2">
            <button type="button" className="px-3 py-1.5 rounded-lg bg-red-600 text-white text-sm"
              onClick={async () => {
                try {
                  await deleteOpenStackNetwork(net.id)
                  toast.success('Network deleted')
                  navigate('/openstack/networking')
                } catch (e: unknown) {
                  toast.error(formatUserError(e))
                  setDeleteOpen(false)
                }
              }}>Delete</button>
            <button type="button" className="px-3 py-1.5 rounded-lg border border-slate-600 text-sm"
              onClick={() => setDeleteOpen(false)}>Cancel</button>
          </div>
        </div>
      )}
      <OpenStackFooter />
    </div>
  )
}
