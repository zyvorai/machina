// Copyright (c) 2026 ZyvorAI Labs Private Limited. All rights reserved.

import { useCallback, useEffect, useState } from 'react'
import { Link, useParams } from 'react-router'
import { ArrowLeft, HardDrive, Loader2, Share2 } from 'lucide-react'
import { getOpenStackImage, type OpenStackImage } from '../api/openstack'
import OpenStackGate from '../components/OpenStackGate'
import OpenStackSubNav from '../components/OpenStackSubNav'
import OpenStackFooter from '../components/OpenStackFooter'
import PageLayout from '../components/PageLayout'
import OpenStackImageSharingModal from '../components/OpenStackImageSharingModal'
import { useToastContext } from '../contexts/ToastContext'
import { formatUserError } from '../utils/apiError'

function formatBytes(n?: number) {
  if (n == null || n === 0) return '—'
  const gb = n / (1024 ** 3)
  if (gb >= 1) return `${gb.toFixed(1)} GiB`
  return `${(n / (1024 ** 2)).toFixed(0)} MiB`
}

export default function OpenStackImageDetailPage() {
  return (
    <OpenStackGate title="Glance image">
      <OpenStackImageDetailContent />
    </OpenStackGate>
  )
}

function OpenStackImageDetailContent() {
  const { id } = useParams<{ id: string }>()
  const toast = useToastContext()
  const [image, setImage] = useState<OpenStackImage | null>(null)
  const [loading, setLoading] = useState(true)
  const [shareOpen, setShareOpen] = useState(false)

  const load = useCallback(async () => {
    if (!id) return
    setLoading(true)
    try {
      const { image: img } = await getOpenStackImage(id)
      setImage(img)
    } catch (e: unknown) {
      toast.error(formatUserError(e))
      setImage(null)
    } finally {
      setLoading(false)
    }
  }, [id, toast])

  useEffect(() => {
    void load()
  }, [load])

  if (loading) {
    return <Loader2 className="w-8 h-8 animate-spin text-sky-400 mx-auto py-12" />
  }

  if (!image) {
    return (
      <div className="space-y-4">
        <OpenStackSubNav />
        <p className="text-slate-400">Image not found.</p>
        <Link to="/openstack/images" className="text-sky-400 hover:underline">Back to images</Link>
      </div>
    )
  }

  return (
    <PageLayout
      hideHeader
      className="max-w-3xl"
      prepend={<><OpenStackSubNav /></>}
    >
      <Link to="/openstack/images" className="inline-flex items-center gap-2 text-slate-400 hover:text-slate-200 text-sm">
        <ArrowLeft className="w-4 h-4" /> Glance images
      </Link>
      <h1 className="text-2xl font-semibold flex items-center gap-2">
        <HardDrive className="w-7 h-7 text-sky-400" />
        {image.name || image.id.slice(0, 12)}
      </h1>
      <dl className="grid sm:grid-cols-2 gap-4 rounded-xl border border-slate-700 p-4 text-sm">
        <div><dt className="text-xs text-slate-500 uppercase">ID</dt><dd className="font-mono text-slate-200 mt-1 break-all">{image.id}</dd></div>
        <div><dt className="text-xs text-slate-500 uppercase">Status</dt><dd className="text-slate-200 mt-1">{image.status}</dd></div>
        <div><dt className="text-xs text-slate-500 uppercase">Size</dt><dd className="text-slate-200 mt-1">{formatBytes(image.size_bytes)}</dd></div>
        <div><dt className="text-xs text-slate-500 uppercase">Min disk</dt><dd className="text-slate-200 mt-1">{image.min_disk_gb} GB</dd></div>
        <div><dt className="text-xs text-slate-500 uppercase">Min RAM</dt><dd className="text-slate-200 mt-1">{image.min_ram_mb} MB</dd></div>
        <div><dt className="text-xs text-slate-500 uppercase">Created</dt><dd className="text-slate-200 mt-1">{image.created_at || '—'}</dd></div>
      </dl>
      <button type="button" onClick={() => setShareOpen(true)}
        className="inline-flex items-center gap-2 px-3 py-2 rounded-lg border border-violet-500/40 text-violet-200 hover:bg-violet-500/10 text-sm">
        <Share2 className="w-4 h-4" /> Sharing & metadata
      </button>
      <OpenStackImageSharingModal image={shareOpen ? image : null} onClose={() => setShareOpen(false)} />
      <OpenStackFooter />
    </PageLayout>
  )
}
