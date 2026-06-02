// Copyright (c) 2026 ZyvorAI Labs Private Limited. All rights reserved.
// Proprietary software — see LICENSE in the repository root.
// https://zyvor.dev · info@zyvor.dev

import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router'
import { deleteOpenStackImage, listOpenStackImages, type OpenStackImage } from '../api/openstack'
import { useToastContext } from '../contexts/ToastContext'
import { usePlatformInfo } from '../contexts/PlatformInfoContext'
import ConfirmDialog from '../components/ConfirmDialog'
import OpenStackFooter from '../components/OpenStackFooter'
import { Cloud, RefreshCw, Plus, Trash2, Download, Share2 } from 'lucide-react'
import OpenStackImageSharingModal from '../components/OpenStackImageSharingModal'
import GlancePullModal from '../components/GlancePullModal'
import OpenStackGate from '../components/OpenStackGate'
import OpenStackSubNav from '../components/OpenStackSubNav'
import OpenStackStatusBar from '../components/OpenStackStatusBar'
import PageLayout from '../components/PageLayout'
import { formatUserError } from '../utils/apiError'
import { statusActionLinkClasses, statusDestructiveButtonClasses, statusToneClass } from '../utils/semanticColors'
import { openStackErrorHints } from '../utils/openstackHints'

function formatBytes(n?: number) {
  if (n == null || n === 0) return '—'
  const gb = n / (1024 ** 3)
  if (gb >= 1) return `${gb.toFixed(1)} GiB`
  const mb = n / (1024 ** 2)
  return `${mb.toFixed(0)} MiB`
}

export default function OpenStackImagesPage() {
  return (
    <OpenStackGate title="OpenStack Glance Images">
      <OpenStackImagesContent />
    </OpenStackGate>
  )
}

function OpenStackImagesContent() {
  const [images, setImages] = useState<OpenStackImage[]>([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<OpenStackImage | null>(null)
  const [pullTarget, setPullTarget] = useState<OpenStackImage | null>(null)
  const [shareTarget, setShareTarget] = useState<OpenStackImage | null>(null)
  const [deleting, setDeleting] = useState(false)
  const toast = useToastContext()
  const { info, lastEvent, refreshKey } = usePlatformInfo()

  const load = useCallback(async () => {
    try {
      setLoadError(null)
      const { images: list } = await listOpenStackImages()
      setImages(list)
    } catch (e: unknown) {
      const msg = formatUserError(e)
      setLoadError(msg)
      toast.error(`Failed to load images: ${msg}`)
    } finally {
      setLoading(false)
    }
  }, [toast])

  useEffect(() => { load() }, [load])

  useEffect(() => {
    if (!lastEvent) return
    if (lastEvent.kind.startsWith('openstack.image') || lastEvent.kind.startsWith('openstack.instance')) {
      void load()
    }
  }, [refreshKey, lastEvent, load])

  const handleDelete = async () => {
    if (!deleteTarget) return
    setDeleting(true)
    try {
      await deleteOpenStackImage(deleteTarget.id)
      toast.success(`Deleted image '${deleteTarget.name || deleteTarget.id}'`)
      setDeleteTarget(null)
      await load()
    } catch (e: unknown) {
      toast.error(formatUserError(e))
    } finally {
      setDeleting(false)
    }
  }

  const uploadEnabled = Boolean(info?.openstack?.upload_enabled)

  return (
    <PageLayout
      prepend={<><OpenStackSubNav /><OpenStackStatusBar /></>}
      title="Glance Images"
      subtitle="Images in the connected OpenStack project."
      icon={<Cloud className="w-7 h-7 text-sky-400" />}
      error={loadError}
      errorTitle="Failed to load Glance images"
      errorHints={loadError ? openStackErrorHints(loadError) : undefined}
      technicalDetail={loadError}
      errorTone="red"
      onErrorRetry={() => void load()}
      onErrorDismiss={() => setLoadError(null)}
      actions={
        <div className="flex gap-2 flex-wrap">
          {uploadEnabled && (
            <Link
              to="/disk-images?os=open"
              className="inline-flex items-center gap-2 px-3 py-2 rounded-lg border border-sky-500/40 text-sky-300 hover:bg-sky-500/10 text-sm"
            >
              Upload qcow2 to Glance
            </Link>
          )}
          <Link
            to="/openstack/create"
            className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-sky-600 hover:bg-sky-500 text-white text-sm"
          >
            <Plus className="w-4 h-4" />
            Boot instance
          </Link>
          <button
            type="button"
            onClick={() => { setLoading(true); load() }}
            className="inline-flex items-center gap-2 px-3 py-2 rounded-lg border border-slate-600 text-slate-200 hover:bg-slate-800 text-sm"
          >
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
            Refresh
          </button>
        </div>
      }
    >

      <div className="overflow-x-auto rounded-xl border border-slate-700/80">
        <table className="w-full text-sm">
          <thead className="bg-slate-900/80 text-slate-400 text-left">
            <tr>
              <th className="px-4 py-3">Name</th>
              <th className="px-4 py-3">Status</th>
              <th className="px-4 py-3">Min disk</th>
              <th className="px-4 py-3">Min RAM</th>
              <th className="px-4 py-3">Size</th>
              <th className="px-4 py-3 w-16" />
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-800">
            {loading && images.length === 0 && (
              <tr><td colSpan={6} className="px-4 py-8 text-center text-slate-500">Loading…</td></tr>
            )}
            {!loading && images.length === 0 && (
              <tr><td colSpan={6} className="px-4 py-8 text-center text-slate-500">No images found.</td></tr>
            )}
            {images.map((img) => (
              <tr key={img.id} className="hover:bg-slate-800/40">
                <td className="px-4 py-3">
                  <Link to={`/openstack/images/${img.id}`} className="text-slate-200 hover:text-sky-300 hover:underline">
                    {img.name || '—'}
                  </Link>
                  <div className="text-xs text-slate-500 font-mono truncate max-w-xs">{img.id}</div>
                </td>
                <td className="px-4 py-3 text-slate-300">{img.status}</td>
                <td className="px-4 py-3">{img.min_disk_gb} GB</td>
                <td className="px-4 py-3">{img.min_ram_mb} MB</td>
                <td className="px-4 py-3">{formatBytes(img.size_bytes)}</td>
                <td className="px-4 py-3">
                  <div className="flex items-center gap-1">
                    <button
                      type="button"
                      title="Members & metadata"
                      onClick={() => setShareTarget(img)}
                      className="p-2 rounded hover:bg-violet-500/20 text-violet-400"
                    >
                      <Share2 className="w-4 h-4" />
                    </button>
                    <button
                      type="button"
                      title="Pull to hypervisor disk"
                      onClick={() => setPullTarget(img)}
                      className="p-2 rounded hover:bg-sky-500/20 text-sky-400"
                    >
                      <Download className="w-4 h-4" />
                    </button>
                    <button
                      type="button"
                      title="Delete image"
                      onClick={() => setDeleteTarget(img)}
                      className={`p-2 rounded hover:bg-[color-mix(in_srgb,var(--machina-status-error)_25%,transparent)] ${statusToneClass('error')}`}
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <OpenStackFooter />

      <GlancePullModal
        open={!!pullTarget}
        image={pullTarget}
        onClose={() => setPullTarget(null)}
      />

      <OpenStackImageSharingModal
        image={shareTarget}
        onClose={() => setShareTarget(null)}
      />

      <ConfirmDialog
        open={!!deleteTarget}
        title="Delete Glance image"
        message={`Permanently delete ${deleteTarget?.name || deleteTarget?.id} from Glance?`}
        confirmLabel={deleting ? 'Deleting…' : 'Delete'}
        variant="danger"
        onConfirm={handleDelete}
        onCancel={() => setDeleteTarget(null)}
      />
    </PageLayout>
  )
}
