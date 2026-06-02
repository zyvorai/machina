// Copyright (c) 2026 ZyvorAI Labs Private Limited. All rights reserved.

import { useCallback, useEffect, useState } from 'react'
import { Link, useParams } from 'react-router'
import { ArrowLeft, Loader2, Shield } from 'lucide-react'
import {
  getOpenStackSecurityGroup,
  type OpenStackSecurityGroup,
} from '../api/openstack'
import {
  createOpenStackSecurityGroupRule,
  deleteOpenStackSecurityGroup,
  deleteOpenStackSecurityGroupRule,
} from '../api/openstackExtras'
import OpenStackGate from '../components/OpenStackGate'
import OpenStackSubNav from '../components/OpenStackSubNav'
import OpenStackFooter from '../components/OpenStackFooter'
import PageLayout from '../components/PageLayout'
import { useToastContext } from '../contexts/ToastContext'
import { formatUserError } from '../utils/apiError'
import { statusActionLinkClasses, statusDestructiveButtonClasses, statusToneClass } from '../utils/semanticColors'

export default function OpenStackSecurityGroupDetailPage() {
  return (
    <OpenStackGate title="Security group">
      <OpenStackSecurityGroupDetailContent />
    </OpenStackGate>
  )
}

function OpenStackSecurityGroupDetailContent() {
  const { id } = useParams<{ id: string }>()
  const toast = useToastContext()
  const [group, setGroup] = useState<OpenStackSecurityGroup | null>(null)
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    if (!id) return
    setLoading(true)
    try {
      const { security_group } = await getOpenStackSecurityGroup(id)
      setGroup(security_group)
    } catch (e: unknown) {
      toast.error(formatUserError(e))
      setGroup(null)
    } finally {
      setLoading(false)
    }
  }, [id, toast])

  useEffect(() => { void load() }, [load])

  if (loading) return <Loader2 className="w-8 h-8 animate-spin text-sky-400 mx-auto py-12" />
  if (!group) {
    return (
      <div className="space-y-4">
        <OpenStackSubNav />
        <Link to="/openstack/security-groups" className="text-sky-400 hover:underline">Back</Link>
      </div>
    )
  }

  return (
    <PageLayout
      hideHeader
      className="max-w-3xl"
      prepend={<><OpenStackSubNav /></>}
    >
      <Link to="/openstack/security-groups" className="inline-flex items-center gap-2 text-slate-400 hover:text-slate-200 text-sm">
        <ArrowLeft className="w-4 h-4" /> Security groups
      </Link>
      <h1 className="text-2xl font-semibold flex items-center gap-2">
        <Shield className="w-7 h-7 text-sky-400" />
        {group.name}
      </h1>
      {group.description && <p className="text-sm text-slate-400">{group.description}</p>}
      <dl className="grid sm:grid-cols-2 gap-4 rounded-xl border border-slate-700 p-4 text-sm">
        <div><dt className="text-xs text-slate-500 uppercase">ID</dt><dd className="font-mono text-slate-200 mt-1 break-all">{group.id}</dd></div>
        <div><dt className="text-xs text-slate-500 uppercase">Rules</dt><dd className="text-slate-200 mt-1">{group.rules.length}</dd></div>
      </dl>
      <div className="flex flex-wrap gap-2">
        <button type="button" className="px-3 py-1.5 rounded-lg border border-slate-600 text-sm"
          onClick={async () => {
            try {
              await createOpenStackSecurityGroupRule(group.id, {
                direction: 'ingress',
                ethertype: 'IPv4',
                protocol: 'tcp',
                port_range_min: 22,
                port_range_max: 22,
              })
              toast.success('Added SSH rule')
              void load()
            } catch (e: unknown) { toast.error(formatUserError(e)) }
          }}>Add SSH ingress</button>
        <button type="button" className="px-3 py-1.5 rounded-lg border border-red-500/50 text-red-300 text-sm"
          onClick={async () => {
            if (!confirm(`Delete security group ${group.name}?`)) return
            try {
              await deleteOpenStackSecurityGroup(group.id)
              toast.success('Deleted')
              window.location.href = '/openstack/security-groups'
            } catch (e: unknown) { toast.error(formatUserError(e)) }
          }}>Delete group</button>
      </div>
      <section className="rounded-xl border border-slate-700 p-4">
        <h2 className="text-sm font-medium text-slate-300 mb-3">Rules</h2>
        {group.rules.length === 0 ? (
          <p className="text-sm text-slate-500">No rules.</p>
        ) : (
          <ul className="space-y-2 text-xs font-mono">
            {group.rules.map((r) => (
              <li key={r.id} className="flex flex-wrap items-center gap-2 rounded-lg border border-slate-800 px-3 py-2 text-slate-300">
                <span>{r.direction}</span>
                <span>{r.protocol || 'any'}</span>
                {(r.port_range_min != null || r.port_range_max != null) && (
                  <span>{r.port_range_min ?? '—'}–{r.port_range_max ?? '—'}</span>
                )}
                {r.remote_ip_prefix && <span>{r.remote_ip_prefix}</span>}
                <button type="button" className={statusActionLinkClasses('error', 'ml-auto')}
                  onClick={async () => {
                    try {
                      await deleteOpenStackSecurityGroupRule(r.id)
                      toast.success('Rule deleted')
                      void load()
                    } catch (e: unknown) { toast.error(formatUserError(e)) }
                  }}>Delete</button>
              </li>
            ))}
          </ul>
        )}
      </section>
      <OpenStackFooter />
    </PageLayout>
  )
}
