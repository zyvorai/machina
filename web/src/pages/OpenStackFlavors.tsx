// Copyright (c) 2026 ZyvorAI Labs Private Limited. All rights reserved.

import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router'
import {
  createOpenStackFlavor,
  deleteOpenStackFlavor,
  listOpenStackFlavors,
  type OpenStackFlavor,
} from '../api/openstack'
import OpenStackGate from '../components/OpenStackGate'
import OpenStackSubNav from '../components/OpenStackSubNav'
import OpenStackFooter from '../components/OpenStackFooter'
import PageLayout from '../components/PageLayout'
import { useToastContext } from '../contexts/ToastContext'
import { formatUserError } from '../utils/apiError'
import { statusActionLinkClasses, statusDestructiveButtonClasses, statusToneClass } from '../utils/semanticColors'
import { Cpu, Loader2, Plus, RefreshCw, Trash2 } from 'lucide-react'

export default function OpenStackFlavorsPage() {
  return (
    <OpenStackGate title="Nova flavors">
      <OpenStackFlavorsContent />
    </OpenStackGate>
  )
}

function OpenStackFlavorsContent() {
  const toast = useToastContext()
  const [flavors, setFlavors] = useState<OpenStackFlavor[]>([])
  const [loading, setLoading] = useState(true)
  const [name, setName] = useState('')
  const [vcpus, setVcpus] = useState('1')
  const [ram, setRam] = useState('2048')
  const [disk, setDisk] = useState('20')
  const [creating, setCreating] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const { flavors: list } = await listOpenStackFlavors()
      setFlavors(list)
    } catch (e: unknown) {
      toast.error(formatUserError(e))
    } finally {
      setLoading(false)
    }
  }, [toast])

  useEffect(() => {
    void load()
  }, [load])

  const handleCreate = async () => {
    if (!name.trim()) {
      toast.error('Name is required')
      return
    }
    setCreating(true)
    try {
      await createOpenStackFlavor({
        name: name.trim(),
        vcpus: Number(vcpus) || 1,
        ram_mb: Number(ram) || 512,
        disk_gb: Number(disk) || 0,
        is_public: true,
      })
      toast.success('Flavor created')
      setName('')
      void load()
    } catch (e: unknown) {
      toast.error(formatUserError(e))
    } finally {
      setCreating(false)
    }
  }

  return (
    <PageLayout
      hideHeader
      className="max-w-3xl"
      prepend={<><OpenStackSubNav /></>}
    >
      <h1 className="text-2xl font-semibold flex items-center gap-2">
        <Cpu className="w-7 h-7 text-sky-400" />
        Nova flavors
      </h1>
      <p className="text-sm text-slate-400">Flavor catalog — create and delete require admin role.</p>
      <section className="rounded-xl border border-slate-700 p-4 space-y-3">
        <h2 className="text-sm font-medium text-slate-300 flex items-center gap-2"><Plus className="w-4 h-4" /> Create flavor</h2>
        <div className="grid sm:grid-cols-2 gap-3">
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Name"
            className="px-3 py-2 rounded-lg bg-slate-900 border border-slate-700 text-sm" />
          <input value={vcpus} onChange={(e) => setVcpus(e.target.value)} placeholder="vCPUs" type="number" min={1}
            className="px-3 py-2 rounded-lg bg-slate-900 border border-slate-700 text-sm" />
          <input value={ram} onChange={(e) => setRam(e.target.value)} placeholder="RAM (MB)" type="number" min={512}
            className="px-3 py-2 rounded-lg bg-slate-900 border border-slate-700 text-sm" />
          <input value={disk} onChange={(e) => setDisk(e.target.value)} placeholder="Disk (GB)" type="number" min={0}
            className="px-3 py-2 rounded-lg bg-slate-900 border border-slate-700 text-sm" />
        </div>
        <button type="button" disabled={creating} onClick={() => void handleCreate()}
          className="px-3 py-1.5 rounded-lg bg-sky-600 hover:bg-sky-500 text-white text-sm disabled:opacity-50">
          Create
        </button>
      </section>
      <button type="button" onClick={() => void load()}
        className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg border border-slate-600 text-sm">
        <RefreshCw className="w-4 h-4" /> Refresh
      </button>
      {loading ? (
        <Loader2 className="w-8 h-8 animate-spin text-sky-400" />
      ) : (
        <div className="rounded-xl border border-slate-700 overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-slate-900/80 text-slate-400 text-left">
              <tr>
                <th className="px-3 py-2">Name</th>
                <th className="px-3 py-2">vCPU</th>
                <th className="px-3 py-2">RAM</th>
                <th className="px-3 py-2">Disk</th>
                <th className="px-3 py-2" />
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800">
              {flavors.map((f) => (
                <tr key={f.id}>
                  <td className="px-3 py-2">
                    <Link to={`/openstack/flavors/${f.id}`} className="font-mono text-slate-200 hover:text-sky-300 hover:underline">{f.name}</Link>
                    <span className="block text-xs text-slate-500 font-mono">{f.id}</span>
                  </td>
                  <td className="px-3 py-2">{f.vcpus}</td>
                  <td className="px-3 py-2">{f.ram_mb} MB</td>
                  <td className="px-3 py-2">{f.disk_gb} GB</td>
                  <td className="px-3 py-2 flex gap-2">
                    <Link to={`/openstack/flavors/${f.id}`} className="text-xs text-sky-400 hover:underline">Open</Link>
                    <button type="button" className={statusActionLinkClasses('error', 'text-xs inline-flex items-center gap-0.5')}
                      onClick={async () => {
                        if (!confirm(`Delete flavor ${f.name}?`)) return
                        try {
                          await deleteOpenStackFlavor(f.id)
                          toast.success('Deleted')
                          void load()
                        } catch (e: unknown) { toast.error(formatUserError(e)) }
                      }}>
                      <Trash2 className="w-3 h-3" /> Del
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {flavors.length === 0 && (
            <p className="p-6 text-center text-slate-500 text-sm">No flavors returned from Nova.</p>
          )}
        </div>
      )}
      <OpenStackFooter />
    </PageLayout>
  )
}
