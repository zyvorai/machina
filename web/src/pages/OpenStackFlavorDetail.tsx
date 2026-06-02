// Copyright (c) 2026 ZyvorAI Labs Private Limited. All rights reserved.

import { useCallback, useEffect, useState } from 'react'
import { Link, useParams } from 'react-router'
import { ArrowLeft, Cpu, Loader2 } from 'lucide-react'
import { getOpenStackFlavor, type OpenStackFlavor } from '../api/openstack'
import OpenStackGate from '../components/OpenStackGate'
import OpenStackSubNav from '../components/OpenStackSubNav'
import OpenStackFooter from '../components/OpenStackFooter'
import PageLayout from '../components/PageLayout'
import { useToastContext } from '../contexts/ToastContext'
import { formatUserError } from '../utils/apiError'

export default function OpenStackFlavorDetailPage() {
  return (
    <OpenStackGate title="Flavor">
      <OpenStackFlavorDetailContent />
    </OpenStackGate>
  )
}

function OpenStackFlavorDetailContent() {
  const { id } = useParams<{ id: string }>()
  const toast = useToastContext()
  const [flavor, setFlavor] = useState<OpenStackFlavor | null>(null)
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    if (!id) return
    setLoading(true)
    try {
      const { flavor: f } = await getOpenStackFlavor(id)
      setFlavor(f)
    } catch (e: unknown) {
      toast.error(formatUserError(e))
      setFlavor(null)
    } finally {
      setLoading(false)
    }
  }, [id, toast])

  useEffect(() => { void load() }, [load])

  if (loading) return <Loader2 className="w-8 h-8 animate-spin text-sky-400 mx-auto py-12" />
  if (!flavor) {
    return (
      <div className="space-y-4">
        <OpenStackSubNav />
        <Link to="/openstack/flavors" className="text-sky-400 hover:underline">Back</Link>
      </div>
    )
  }

  return (
    <PageLayout
      hideHeader
      className="max-w-3xl"
      prepend={<><OpenStackSubNav /></>}
    >
      <Link to="/openstack/flavors" className="inline-flex items-center gap-2 text-slate-400 hover:text-slate-200 text-sm">
        <ArrowLeft className="w-4 h-4" /> Flavors
      </Link>
      <h1 className="text-2xl font-semibold flex items-center gap-2">
        <Cpu className="w-7 h-7 text-sky-400" />
        {flavor.name}
      </h1>
      <dl className="grid sm:grid-cols-2 gap-4 rounded-xl border border-slate-700 p-4 text-sm font-mono">
        <div><dt className="text-xs text-slate-500 uppercase font-sans">ID</dt><dd className="text-slate-200 mt-1">{flavor.id}</dd></div>
        <div><dt className="text-xs text-slate-500 uppercase font-sans">vCPU</dt><dd className="text-slate-200 mt-1">{flavor.vcpus}</dd></div>
        <div><dt className="text-xs text-slate-500 uppercase font-sans">RAM</dt><dd className="text-slate-200 mt-1">{flavor.ram_mb} MB</dd></div>
        <div><dt className="text-xs text-slate-500 uppercase font-sans">Disk</dt><dd className="text-slate-200 mt-1">{flavor.disk_gb} GB</dd></div>
      </dl>
      <Link to="/openstack/create" className="inline-block px-3 py-2 rounded-lg bg-sky-600 text-white text-sm">Create instance with this flavor</Link>
      <OpenStackFooter />
    </PageLayout>
  )
}
