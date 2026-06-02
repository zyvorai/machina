// Copyright (c) 2026 ZyvorAI Labs Private Limited. All rights reserved.

import { useCallback, useEffect, useRef, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router'
import { ArrowLeft, Disc, ExternalLink, Loader2 } from 'lucide-react'
import { getOpenStackImage } from '../api/openstack'
import { getOpenStackVolume, setOpenStackVolumeBootable, updateOpenStackVolume, uploadOpenStackVolumeToImage } from '../api/openstackExtras'
import type { OpenStackAttachedVolume } from '../api/openstack'
import OpenStackGate from '../components/OpenStackGate'
import OpenStackSubNav from '../components/OpenStackSubNav'
import OpenStackFooter from '../components/OpenStackFooter'
import PageLayout from '../components/PageLayout'
import { useToastContext } from '../contexts/ToastContext'
import { formatUserError } from '../utils/apiError'

export default function OpenStackVolumeDetailPage() {
  return (
    <OpenStackGate title="Cinder volume">
      <OpenStackVolumeDetailContent />
    </OpenStackGate>
  )
}

function OpenStackVolumeDetailContent() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const toast = useToastContext()
  const [vol, setVol] = useState<OpenStackAttachedVolume | null>(null)
  const [loading, setLoading] = useState(true)
  const [uploadBusy, setUploadBusy] = useState(false)
  const [uploadImageId, setUploadImageId] = useState<string | null>(null)
  const [uploadStatus, setUploadStatus] = useState<string | null>(null)
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const load = useCallback(async () => {
    if (!id) return
    setLoading(true)
    try {
      const { volume } = await getOpenStackVolume(id)
      setVol(volume)
    } catch (e: unknown) {
      toast.error(formatUserError(e))
      setVol(null)
    } finally {
      setLoading(false)
    }
  }, [id, toast])

  useEffect(() => {
    void load()
  }, [load])

  useEffect(() => {
    if (!uploadImageId) return
    let cancelled = false

    const poll = async () => {
      try {
        const { image } = await getOpenStackImage(uploadImageId)
        if (cancelled) return
        setUploadStatus(image.status)
        const st = image.status.toLowerCase()
        if (st === 'active') {
          if (pollRef.current) clearInterval(pollRef.current)
          pollRef.current = null
          setUploadBusy(false)
          toast.success('Glance image is active')
        } else if (st === 'killed' || st === 'deleted' || st.includes('error')) {
          if (pollRef.current) clearInterval(pollRef.current)
          pollRef.current = null
          setUploadBusy(false)
          toast.error(`Glance upload failed: ${image.status}`)
        }
      } catch {
        // keep polling — image may not appear in Glance immediately
      }
    }

    void poll()
    pollRef.current = setInterval(() => { void poll() }, 5000)
    return () => {
      cancelled = true
      if (pollRef.current) clearInterval(pollRef.current)
      pollRef.current = null
    }
  }, [uploadImageId, toast])

  if (loading) return <Loader2 className="w-8 h-8 animate-spin text-sky-400 mx-auto py-12" />
  if (!vol) {
    return (
      <div className="space-y-4">
        <OpenStackSubNav />
        <p className="text-slate-400">Volume not found.</p>
        <Link to="/openstack/volumes" className="text-sky-400 hover:underline">Back</Link>
      </div>
    )
  }

  return (
    <PageLayout
      hideHeader
      className="max-w-3xl"
      prepend={<><OpenStackSubNav /></>}
    >
      <Link to="/openstack/volumes" className="inline-flex items-center gap-2 text-slate-400 hover:text-slate-200 text-sm">
        <ArrowLeft className="w-4 h-4" /> Volumes
      </Link>
      <h1 className="text-2xl font-semibold flex items-center gap-2">
        <Disc className="w-7 h-7 text-sky-400" />
        {vol.name || vol.id.slice(0, 12)}
      </h1>
      <dl className="grid sm:grid-cols-2 gap-4 rounded-xl border border-slate-700 p-4 text-sm">
        <div><dt className="text-xs text-slate-500 uppercase">ID</dt><dd className="font-mono text-slate-200 mt-1 break-all">{vol.id}</dd></div>
        <div><dt className="text-xs text-slate-500 uppercase">Size</dt><dd className="text-slate-200 mt-1">{vol.size_gb} GB</dd></div>
        <div><dt className="text-xs text-slate-500 uppercase">Bootable</dt><dd className="mt-1">
          <button type="button" className="text-sky-400 hover:underline" onClick={async () => {
            try {
              await setOpenStackVolumeBootable(vol.id, !vol.bootable)
              toast.success('Updated')
              void load()
            } catch (e: unknown) { toast.error(formatUserError(e)) }
          }}>{vol.bootable ? 'Yes' : 'No'} (toggle)</button>
        </dd></div>
        <div><dt className="text-xs text-slate-500 uppercase">Attached</dt><dd className="mt-1 font-mono text-xs">
          {vol.server_id ? (
            <Link to={`/openstack/instances/${vol.server_id}`} className="text-sky-400 hover:underline">{vol.server_id}</Link>
          ) : '—'}
        </dd></div>
        {vol.device && <div><dt className="text-xs text-slate-500 uppercase">Device</dt><dd className="font-mono text-slate-200 mt-1">{vol.device}</dd></div>}
      </dl>
      <button type="button" className="px-3 py-1.5 rounded-lg border border-slate-600 text-sm"
        onClick={async () => {
          const n = prompt('Volume name', vol.name || '')
          if (n === null) return
          try {
            await updateOpenStackVolume(vol.id, { name: n.trim() || undefined })
            toast.success('Renamed')
            void load()
          } catch (e: unknown) { toast.error(formatUserError(e)) }
        }}>Rename</button>
      <section className="rounded-xl border border-slate-700 p-4 space-y-3">
        <h2 className="text-sm font-medium text-slate-300">Create Glance image from volume</h2>
        <p className="text-xs text-slate-500">Upload this Cinder volume to Glance (Cinder os-volume_upload_image).</p>
        {uploadImageId && (
          <div className="text-sm text-slate-300 space-y-1">
            <p>
              Image <span className="font-mono text-sky-300">{uploadImageId}</span>
              {uploadStatus && <> · status <span className="text-violet-300">{uploadStatus}</span></>}
              {uploadBusy && <Loader2 className="inline w-4 h-4 ml-2 animate-spin text-sky-400" />}
            </p>
            {!uploadBusy && uploadStatus?.toLowerCase() === 'active' && (
              <button type="button" className="inline-flex items-center gap-1 text-sky-400 hover:underline text-sm"
                onClick={() => navigate(`/openstack/images/${uploadImageId}`)}>
                Open image detail <ExternalLink className="w-3.5 h-3.5" />
              </button>
            )}
          </div>
        )}
        <button type="button" disabled={uploadBusy}
          className="px-3 py-1.5 rounded-lg bg-violet-600 hover:bg-violet-500 text-white text-sm disabled:opacity-50"
          onClick={async () => {
            const name = prompt('Glance image name', vol.name ? `${vol.name}-image` : 'volume-image')
            if (!name?.trim()) return
            try {
              setUploadBusy(true)
              setUploadStatus(null)
              const r = await uploadOpenStackVolumeToImage(vol.id, { image_name: name.trim() })
              setUploadImageId(r.upload.image_id)
              setUploadStatus(r.upload.status)
              toast.success(`Upload started — polling Glance for ${r.upload.image_id}`)
            } catch (e: unknown) {
              setUploadBusy(false)
              toast.error(formatUserError(e))
            }
          }}>Upload to Glance</button>
      </section>
      <OpenStackFooter />
    </PageLayout>
  )
}
