// Copyright (c) 2026 ZyvorAI Labs Private Limited. All rights reserved.

import { useCallback, useEffect, useState } from 'react'
import { Link, useParams } from 'react-router'
import { ArrowLeft, Globe, Loader2 } from 'lucide-react'
import {
  deleteOpenStackFloatingIp,
  dissociateOpenStackFloatingIp,
  getOpenStackFloatingIp,
  type OpenStackFloatingIp,
} from '../api/openstack'
import OpenStackGate from '../components/OpenStackGate'
import OpenStackSubNav from '../components/OpenStackSubNav'
import OpenStackFooter from '../components/OpenStackFooter'
import PageLayout from '../components/PageLayout'
import { useToastContext } from '../contexts/ToastContext'
import { formatUserError } from '../utils/apiError'
import { statusBadgeClasses, statusDestructiveButtonClasses } from '../utils/semanticColors'

export default function OpenStackFloatingIpDetailPage() {
  return (
    <OpenStackGate title="Floating IP">
      <OpenStackFloatingIpDetailContent />
    </OpenStackGate>
  )
}

function OpenStackFloatingIpDetailContent() {
  const { id } = useParams<{ id: string }>()
  const toast = useToastContext()
  const [fip, setFip] = useState<OpenStackFloatingIp | null>(null)
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    if (!id) return
    setLoading(true)
    try {
      const { floating_ip } = await getOpenStackFloatingIp(id)
      setFip(floating_ip)
    } catch (e: unknown) {
      toast.error(formatUserError(e))
      setFip(null)
    } finally {
      setLoading(false)
    }
  }, [id, toast])

  useEffect(() => { void load() }, [load])

  if (loading) return <Loader2 className="w-8 h-8 animate-spin text-sky-400 mx-auto py-12" />
  if (!fip) {
    return (
      <div className="space-y-4">
        <OpenStackSubNav />
        <Link to="/openstack/floating-ips" className="text-sky-400 hover:underline">Back</Link>
      </div>
    )
  }

  return (
    <PageLayout
      hideHeader
      className="max-w-3xl"
      prepend={<><OpenStackSubNav /></>}
    >
      <Link to="/openstack/floating-ips" className="inline-flex items-center gap-2 text-slate-400 hover:text-slate-200 text-sm">
        <ArrowLeft className="w-4 h-4" /> Floating IPs
      </Link>
      <h1 className="text-2xl font-semibold flex items-center gap-2 font-mono">
        <Globe className="w-7 h-7 text-sky-400" />
        {fip.address}
      </h1>
      <dl className="grid sm:grid-cols-2 gap-4 rounded-xl border border-slate-700 p-4 text-sm">
        <div><dt className="text-xs text-slate-500 uppercase">ID</dt><dd className="font-mono text-slate-200 mt-1 break-all">{fip.id}</dd></div>
        <div><dt className="text-xs text-slate-500 uppercase">Status</dt><dd className="text-slate-200 mt-1">{fip.status}</dd></div>
        <div><dt className="text-xs text-slate-500 uppercase">Instance</dt><dd className="mt-1 font-mono text-xs">
          {fip.instance_id ? (
            <Link to={`/openstack/instances/${fip.instance_id}`} className="text-sky-400 hover:underline">{fip.instance_id}</Link>
          ) : '—'}
        </dd></div>
        <div><dt className="text-xs text-slate-500 uppercase">Fixed address</dt><dd className="text-slate-200 mt-1 font-mono">{fip.fixed_address || '—'}</dd></div>
        {fip.network_id && (
          <div className="sm:col-span-2"><dt className="text-xs text-slate-500 uppercase">Floating network</dt><dd className="font-mono text-xs mt-1">{fip.network_id}</dd></div>
        )}
      </dl>
      <div className="flex flex-wrap gap-2">
        {fip.instance_id && (
          <button type="button" className={`px-3 py-1.5 rounded-lg border text-sm ${statusBadgeClasses('warn')} border-[color-mix(in_srgb,var(--machina-status-warn)_40%,transparent)]`}
            onClick={async () => {
              try {
                await dissociateOpenStackFloatingIp(fip.id)
                toast.success('Dissociated')
                void load()
              } catch (e: unknown) { toast.error(formatUserError(e)) }
            }}>Dissociate</button>
        )}
        <button type="button" className={statusDestructiveButtonClasses()}
          onClick={async () => {
            if (!confirm(`Release floating IP ${fip.address}?`)) return
            try {
              await deleteOpenStackFloatingIp(fip.id)
              toast.success('Released')
              window.location.href = '/openstack/floating-ips'
            } catch (e: unknown) { toast.error(formatUserError(e)) }
          }}>Release</button>
      </div>
      <OpenStackFooter />
    </PageLayout>
  )
}
