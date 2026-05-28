// Copyright (c) 2026 ZyvorAI Labs Private Limited. All rights reserved.

import { useCallback, useEffect, useState } from 'react'
import { Link, useParams } from 'react-router'
import { ArrowLeft, KeyRound, Loader2 } from 'lucide-react'
import OpenStackGate from '../components/OpenStackGate'
import OpenStackSubNav from '../components/OpenStackSubNav'
import OpenStackFooter from '../components/OpenStackFooter'
import {
  getOpenStackIdentityProject,
  grantOpenStackRoleAssignment,
  listOpenStackIdentityRoles,
  listOpenStackIdentityUsers,
  listOpenStackRoleAssignments,
  revokeOpenStackRoleAssignment,
  type OpenStackProject,
  type OpenStackRole,
  type OpenStackRoleAssignment,
  type OpenStackIdentityUser,
} from '../api/openstackExtras'
import { useToastContext } from '../contexts/ToastContext'
import { formatUserError } from '../utils/apiError'

export default function OpenStackIdentityProjectDetailPage() {
  return (
    <OpenStackGate title="Project">
      <OpenStackIdentityProjectDetailContent />
    </OpenStackGate>
  )
}

function OpenStackIdentityProjectDetailContent() {
  const { id } = useParams<{ id: string }>()
  const toast = useToastContext()
  const [project, setProject] = useState<OpenStackProject | null>(null)
  const [assignments, setAssignments] = useState<OpenStackRoleAssignment[]>([])
  const [roles, setRoles] = useState<OpenStackRole[]>([])
  const [users, setUsers] = useState<OpenStackIdentityUser[]>([])
  const [grantUserId, setGrantUserId] = useState('')
  const [grantRoleId, setGrantRoleId] = useState('')
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    if (!id) return
    setLoading(true)
    try {
      const [p, a, r, u] = await Promise.all([
        getOpenStackIdentityProject(id),
        listOpenStackRoleAssignments(id),
        listOpenStackIdentityRoles(),
        listOpenStackIdentityUsers(),
      ])
      setProject(p.project)
      setAssignments(a.role_assignments ?? [])
      setRoles(r.roles ?? [])
      setUsers(u.users ?? [])
    } catch (e: unknown) {
      toast.error(formatUserError(e))
      setProject(null)
    } finally {
      setLoading(false)
    }
  }, [id, toast])

  useEffect(() => { void load() }, [load])

  if (loading) return <Loader2 className="w-8 h-8 animate-spin text-sky-400 mx-auto py-12" />
  if (!project) {
    return (
      <div className="space-y-4">
        <OpenStackSubNav />
        <Link to="/openstack/identity" className="text-sky-400 hover:underline">Back</Link>
      </div>
    )
  }

  return (
    <div className="space-y-6 max-w-3xl">
      <OpenStackSubNav />
      <Link to="/openstack/identity" className="inline-flex items-center gap-2 text-slate-400 hover:text-slate-200 text-sm">
        <ArrowLeft className="w-4 h-4" /> Identity
      </Link>
      <h1 className="text-2xl font-semibold flex items-center gap-2">
        <KeyRound className="w-7 h-7 text-amber-400" /> {project.name}
      </h1>
      <dl className="grid sm:grid-cols-2 gap-4 rounded-xl border border-slate-700 p-4 text-sm">
        <div><dt className="text-xs text-slate-500 uppercase">ID</dt><dd className="font-mono mt-1 break-all">{project.id}</dd></div>
        <div><dt className="text-xs text-slate-500 uppercase">Enabled</dt><dd className="mt-1">{project.enabled ? 'yes' : 'no'}</dd></div>
        <div className="sm:col-span-2"><dt className="text-xs text-slate-500 uppercase">Description</dt><dd className="mt-1">{project.description || '—'}</dd></div>
      </dl>

      <section className="rounded-xl border border-slate-700 p-4 space-y-3">
        <h2 className="text-sm font-medium text-slate-300">Role assignments</h2>
        <div className="flex flex-wrap gap-2">
          <select value={grantUserId} onChange={(e) => setGrantUserId(e.target.value)}
            className="px-2 py-1 rounded bg-slate-900 border border-slate-700 text-sm">
            <option value="">User…</option>
            {users.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
          </select>
          <select value={grantRoleId} onChange={(e) => setGrantRoleId(e.target.value)}
            className="px-2 py-1 rounded bg-slate-900 border border-slate-700 text-sm">
            <option value="">Role…</option>
            {roles.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
          </select>
          <button type="button" className="px-2 py-1 rounded bg-amber-700 text-white text-sm"
            disabled={!grantUserId || !grantRoleId}
            onClick={async () => {
              try {
                await grantOpenStackRoleAssignment({
                  project_id: project.id,
                  user_id: grantUserId,
                  role_id: grantRoleId,
                })
                toast.success('Role granted')
                void load()
              } catch (e: unknown) { toast.error(formatUserError(e)) }
            }}>Grant</button>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-slate-400 text-left">
              <tr><th className="py-1">User</th><th className="py-1">Role</th><th /></tr>
            </thead>
            <tbody>
              {assignments.map((a, i) => (
                <tr key={`${a.user_id}-${a.role_id}-${i}`} className="border-t border-slate-800">
                  <td className="py-2">{a.user_name || a.user_id || '—'}</td>
                  <td className="py-2">{a.role_name || a.role_id}</td>
                  <td className="py-2 text-right">
                    {a.user_id && (
                      <button type="button" className="text-red-400 text-xs" onClick={async () => {
                        try {
                          await revokeOpenStackRoleAssignment({
                            project_id: project.id,
                            user_id: a.user_id!,
                            role_id: a.role_id,
                          })
                          toast.success('Revoked')
                          void load()
                        } catch (e: unknown) { toast.error(formatUserError(e)) }
                      }}>Revoke</button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {assignments.length === 0 && <p className="text-slate-500 text-sm py-2">No role assignments.</p>}
        </div>
      </section>
      <OpenStackFooter />
    </div>
  )
}
