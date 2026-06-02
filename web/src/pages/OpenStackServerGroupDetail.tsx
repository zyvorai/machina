// Copyright (c) 2026 ZyvorAI Labs Private Limited. All rights reserved.

import { useCallback, useEffect, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router'
import { ArrowLeft, Layers, Loader2 } from 'lucide-react'
import { getOpenStackServerGroup, deleteOpenStackServerGroup, type OpenStackServerGroup } from '../api/openstackExtras'
import OpenStackGate from '../components/OpenStackGate'
import OpenStackSubNav from '../components/OpenStackSubNav'
import OpenStackFooter from '../components/OpenStackFooter'
import PageLayout from '../components/PageLayout'
import { useToastContext } from '../contexts/ToastContext'
import { formatUserError } from '../utils/apiError'
import { statusActionLinkClasses, statusDestructiveButtonClasses, statusToneClass } from '../utils/semanticColors'

export default function OpenStackServerGroupDetailPage() {
  return (
    <OpenStackGate title="Server group">
      <OpenStackServerGroupDetailContent />
    </OpenStackGate>
  )
}

function OpenStackServerGroupDetailContent() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const toast = useToastContext()
  const [group, setGroup] = useState<OpenStackServerGroup | null>(null)
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    if (!id) return
    setLoading(true)
    try {
      const { server_group } = await getOpenStackServerGroup(id)
      setGroup(server_group)
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
        <Link to="/openstack/server-groups" className="text-sky-400 hover:underline">Back</Link>
      </div>
    )
  }

  return (
    <PageLayout
      hideHeader
      className="max-w-3xl"
      prepend={<><OpenStackSubNav /></>}
    >
      <Link to="/openstack/server-groups" className="inline-flex items-center gap-2 text-slate-400 hover:text-slate-200 text-sm">
        <ArrowLeft className="w-4 h-4" /> Server groups
      </Link>
      <h1 className="text-2xl font-semibold flex items-center gap-2">
        <Layers className="w-7 h-7 text-sky-400" />
        {group.name}
      </h1>
      <dl className="rounded-xl border border-slate-700 p-4 text-sm space-y-3">
        <div><dt className="text-xs text-slate-500 uppercase">ID</dt><dd className="font-mono text-slate-200 mt-1">{group.id}</dd></div>
        <div><dt className="text-xs text-slate-500 uppercase">Policy</dt><dd className="text-slate-200 mt-1">{group.policy}</dd></div>
        <div>
          <dt className="text-xs text-slate-500 uppercase">Members ({group.members.length})</dt>
          <ul className="mt-1 font-mono text-xs text-slate-400 space-y-1">
            {group.members.map((m) => (
              <li key={m}><Link to={`/openstack/instances/${m}`} className="text-sky-400 hover:underline">{m}</Link></li>
            ))}
            {group.members.length === 0 && <li>None</li>}
          </ul>
        </div>
      </dl>
      <button type="button" className={statusDestructiveButtonClasses('px-3 py-1.5 text-sm')}
        onClick={async () => {
          if (!confirm(`Delete server group ${group.name}?`)) return
          try {
            await deleteOpenStackServerGroup(group.id)
            toast.success('Deleted')
            navigate('/openstack/server-groups')
          } catch (e: unknown) { toast.error(formatUserError(e)) }
        }}>Delete group</button>
      <OpenStackFooter />
    </PageLayout>
  )
}
