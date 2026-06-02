// Copyright (c) 2026 ZyvorAI Labs Private Limited. All rights reserved.

import { useCallback, useEffect, useState } from 'react'
import { Link, useParams } from 'react-router'
import { ArrowLeft, Copy, Loader2, Share2 } from 'lucide-react'
import {
  deleteOpenStackVolumeTransfer,
  getOpenStackVolumeTransfer,
  type OpenStackVolumeTransfer,
} from '../api/openstackExtras'
import OpenStackGate from '../components/OpenStackGate'
import OpenStackSubNav from '../components/OpenStackSubNav'
import OpenStackFooter from '../components/OpenStackFooter'
import PageLayout from '../components/PageLayout'
import { useToastContext } from '../contexts/ToastContext'
import { formatUserError } from '../utils/apiError'
import { statusBadgeClasses, statusDestructiveButtonClasses, statusSurfaceClasses, statusToneClass } from '../utils/semanticColors'

export default function OpenStackVolumeTransferDetailPage() {
  return (
    <OpenStackGate title="Volume transfer">
      <OpenStackVolumeTransferDetailContent />
    </OpenStackGate>
  )
}

function OpenStackVolumeTransferDetailContent() {
  const { id } = useParams<{ id: string }>()
  const toast = useToastContext()
  const [transfer, setTransfer] = useState<OpenStackVolumeTransfer | null>(null)
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    if (!id) return
    setLoading(true)
    try {
      const { transfer: t } = await getOpenStackVolumeTransfer(id)
      setTransfer(t)
    } catch (e: unknown) {
      toast.error(formatUserError(e))
      setTransfer(null)
    } finally {
      setLoading(false)
    }
  }, [id, toast])

  useEffect(() => { void load() }, [load])

  const copy = (label: string, text: string) => {
    navigator.clipboard.writeText(text).then(
      () => toast.success(`${label} copied`),
      () => toast.error('Copy failed'),
    )
  }

  if (loading) return <Loader2 className="w-8 h-8 animate-spin text-sky-400 mx-auto py-12" />
  if (!transfer) {
    return (
      <div className="space-y-4">
        <OpenStackSubNav />
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
        <Share2 className="w-7 h-7 text-sky-400" />
        {transfer.name}
      </h1>
      <dl className="grid sm:grid-cols-2 gap-4 rounded-xl border border-slate-700 p-4 text-sm">
        <div><dt className="text-xs text-slate-500 uppercase">Transfer ID</dt>
          <dd className="font-mono text-slate-200 mt-1 break-all flex items-start gap-2">
            {transfer.id}
            <button type="button" className="text-slate-400 hover:text-sky-300 shrink-0" onClick={() => copy('Transfer ID', transfer.id)}>
              <Copy className="w-3.5 h-3.5" />
            </button>
          </dd>
        </div>
        <div><dt className="text-xs text-slate-500 uppercase">Volume</dt>
          <dd className="font-mono text-xs mt-1">
            <Link to={`/openstack/volumes/${transfer.volume_id}`} className="text-sky-400 hover:underline">{transfer.volume_id}</Link>
          </dd>
        </div>
        {transfer.auth_key && (
          <div className={`sm:col-span-2 rounded-lg p-3 ${statusSurfaceClasses('warn')}`}>
            <dt className={`text-xs uppercase mb-1 ${statusToneClass('warn')}`}>Auth key (share with recipient)</dt>
            <dd className={`font-mono break-all flex items-start gap-2 ${statusToneClass('warn')}`}>
              {transfer.auth_key}
              <button type="button" className={`shrink-0 hover:opacity-80 ${statusToneClass('warn')}`} onClick={() => copy('Auth key', transfer.auth_key!)}>
                <Copy className="w-3.5 h-3.5" />
              </button>
            </dd>
          </div>
        )}
      </dl>
      <button type="button" className={statusDestructiveButtonClasses()}
        onClick={async () => {
          if (!confirm(`Cancel transfer ${transfer.name}?`)) return
          try {
            await deleteOpenStackVolumeTransfer(transfer.id)
            toast.success('Transfer cancelled')
            window.location.href = '/openstack/volumes'
          } catch (e: unknown) { toast.error(formatUserError(e)) }
        }}>Cancel transfer</button>
      <OpenStackFooter />
    </PageLayout>
  )
}
