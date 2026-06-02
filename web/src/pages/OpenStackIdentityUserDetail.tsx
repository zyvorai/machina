// Copyright (c) 2026 ZyvorAI Labs Private Limited. All rights reserved.

import { useCallback, useEffect, useState } from 'react'
import { Link, useParams } from 'react-router'
import { ArrowLeft, Loader2, Users } from 'lucide-react'
import OpenStackGate from '../components/OpenStackGate'
import OpenStackSubNav from '../components/OpenStackSubNav'
import OpenStackFooter from '../components/OpenStackFooter'
import PageLayout from '../components/PageLayout'
import {
  getOpenStackIdentityUser,
  updateOpenStackIdentityUser,
  type OpenStackIdentityUser,
} from '../api/openstackExtras'
import { useToastContext } from '../contexts/ToastContext'
import { formatUserError } from '../utils/apiError'
import { statusActionLinkClasses, statusDestructiveButtonClasses, statusToneClass } from '../utils/semanticColors'

export default function OpenStackIdentityUserDetailPage() {
  return (
    <OpenStackGate title="User">
      <OpenStackIdentityUserDetailContent />
    </OpenStackGate>
  )
}

function OpenStackIdentityUserDetailContent() {
  const { id } = useParams<{ id: string }>()
  const toast = useToastContext()
  const [user, setUser] = useState<OpenStackIdentityUser | null>(null)
  const [email, setEmail] = useState('')
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    if (!id) return
    setLoading(true)
    try {
      const { user: u } = await getOpenStackIdentityUser(id)
      setUser(u)
      setEmail(u.email ?? '')
    } catch (e: unknown) {
      toast.error(formatUserError(e))
      setUser(null)
    } finally {
      setLoading(false)
    }
  }, [id, toast])

  useEffect(() => { void load() }, [load])

  if (loading) return <Loader2 className="w-8 h-8 animate-spin text-sky-400 mx-auto py-12" />
  if (!user) {
    return (
      <div className="space-y-4">
        <OpenStackSubNav />
        <Link to="/openstack/identity" className="text-sky-400 hover:underline">Back</Link>
      </div>
    )
  }

  return (
    <PageLayout
      hideHeader
      className="max-w-3xl"
      prepend={<><OpenStackSubNav /></>}
    >
      <Link to="/openstack/identity" className="inline-flex items-center gap-2 text-slate-400 hover:text-slate-200 text-sm">
        <ArrowLeft className="w-4 h-4" /> Identity
      </Link>
      <h1 className="text-2xl font-semibold flex items-center gap-2">
        <Users className={`w-7 h-7 ${statusToneClass('warn')}`} /> {user.name}
      </h1>
      <dl className="grid sm:grid-cols-2 gap-4 rounded-xl border border-slate-700 p-4 text-sm">
        <div><dt className="text-xs text-slate-500 uppercase">ID</dt><dd className="font-mono mt-1 break-all">{user.id}</dd></div>
        <div><dt className="text-xs text-slate-500 uppercase">Enabled</dt><dd className="mt-1">{user.enabled ? 'yes' : 'no'}</dd></div>
        <div><dt className="text-xs text-slate-500 uppercase">Default project</dt><dd className="font-mono text-xs mt-1">{user.default_project_id || '—'}</dd></div>
      </dl>
      <div className="rounded-xl border border-slate-700 p-4 space-y-3">
        <label className="block text-xs text-slate-500">Email</label>
        <input value={email} onChange={(e) => setEmail(e.target.value)}
          className="w-full px-3 py-2 rounded-lg bg-slate-900 border border-slate-700 text-sm" />
        <div className="flex gap-2">
          <button type="button" className="px-3 py-1.5 rounded-lg bg-sky-600 text-white text-sm"
            onClick={async () => {
              try {
                await updateOpenStackIdentityUser(user.id, { email: email.trim() || undefined })
                toast.success('User updated')
                void load()
              } catch (e: unknown) { toast.error(formatUserError(e)) }
            }}>Save email</button>
          <button type="button" className="px-3 py-1.5 rounded-lg border border-slate-600 text-sm"
            onClick={async () => {
              try {
                await updateOpenStackIdentityUser(user.id, { enabled: !user.enabled })
                toast.success(user.enabled ? 'User disabled' : 'User enabled')
                void load()
              } catch (e: unknown) { toast.error(formatUserError(e)) }
            }}>
            {user.enabled ? 'Disable' : 'Enable'}
          </button>
        </div>
      </div>
      <OpenStackFooter />
    </PageLayout>
  )
}
