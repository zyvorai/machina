// Copyright (c) 2026 ZyvorAI Labs Private Limited. All rights reserved.

import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router'
import { KeyRound, Loader2, Plus, Users } from 'lucide-react'
import OpenStackGate from '../components/OpenStackGate'
import OpenStackSubNav from '../components/OpenStackSubNav'
import OpenStackFooter from '../components/OpenStackFooter'
import PageLayout from '../components/PageLayout'
import EmptyState from '../components/EmptyState'
import {
  createOpenStackIdentityProject,
  createOpenStackIdentityUser,
  listOpenStackIdentityProjects,
  listOpenStackIdentityUsers,
  type OpenStackIdentityUser,
  type OpenStackProject,
} from '../api/openstackExtras'
import { useToastContext } from '../contexts/ToastContext'
import { formatUserError } from '../utils/apiError'
import { statusActionLinkClasses, statusDestructiveButtonClasses, statusToneClass } from '../utils/semanticColors'

type Tab = 'projects' | 'users'

export default function OpenStackIdentityPage() {
  return (
    <OpenStackGate title="Identity">
      <OpenStackIdentityContent />
    </OpenStackGate>
  )
}

function OpenStackIdentityContent() {
  const toast = useToastContext()
  const [tab, setTab] = useState<Tab>('projects')
  const [projects, setProjects] = useState<OpenStackProject[]>([])
  const [users, setUsers] = useState<OpenStackIdentityUser[]>([])
  const [loading, setLoading] = useState(true)
  const [projectName, setProjectName] = useState('')
  const [userName, setUserName] = useState('')
  const [userPassword, setUserPassword] = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const [p, u] = await Promise.all([
        listOpenStackIdentityProjects(),
        listOpenStackIdentityUsers(),
      ])
      setProjects(p.projects ?? [])
      setUsers(u.users ?? [])
    } catch (e: unknown) {
      toast.error(formatUserError(e))
      setProjects([])
      setUsers([])
    } finally {
      setLoading(false)
    }
  }, [toast])

  useEffect(() => { void load() }, [load])

  return (
    <PageLayout
      hideHeader
      prepend={<>
      </>}
      ><h1 className="text-2xl font-semibold flex items-center gap-2">
        <KeyRound className={`w-7 h-7 ${statusToneClass('warn')}`} /> Keystone identity
      </h1>
      <p className="text-slate-400 text-sm">Projects, users, and role assignments. Writes require admin credentials on the daemon.</p>

      <div className="flex gap-2">
        <button type="button" onClick={() => setTab('projects')}
          className={`px-3 py-1.5 rounded-lg text-sm ${tab === 'projects' ? 'bg-sky-600 text-white' : 'border border-slate-600 text-slate-400'}`}>
          Projects ({projects.length})
        </button>
        <button type="button" onClick={() => setTab('users')}
          className={`px-3 py-1.5 rounded-lg text-sm ${tab === 'users' ? 'bg-sky-600 text-white' : 'border border-slate-600 text-slate-400'}`}>
          <Users className="w-3.5 h-3.5 inline mr-1" /> Users ({users.length})
        </button>
      </div>

      {tab === 'projects' && (
        <div className="rounded-xl border border-slate-700 p-4 flex flex-wrap gap-2 items-center">
          <input aria-label="New project name" value={projectName} onChange={(e) => setProjectName(e.target.value)} placeholder="New project name"
            className="px-3 py-2 rounded-lg bg-slate-900 border border-slate-700 text-sm" />
          <button type="button" className="px-3 py-1.5 rounded-lg bg-amber-700 text-white text-sm inline-flex items-center gap-1"
            onClick={async () => {
              if (!projectName.trim()) return
              try {
                await createOpenStackIdentityProject({ name: projectName.trim() })
                toast.success('Project created')
                setProjectName('')
                void load()
              } catch (e: unknown) { toast.error(formatUserError(e)) }
            }}>
            <Plus className="w-4 h-4" /> Create project
          </button>
        </div>
      )}

      {tab === 'users' && (
        <div className="rounded-xl border border-slate-700 p-4 flex flex-wrap gap-2 items-center">
          <input aria-label="Username" value={userName} onChange={(e) => setUserName(e.target.value)} placeholder="Username"
            className="px-3 py-2 rounded-lg bg-slate-900 border border-slate-700 text-sm" />
          <input type="password" aria-label="Password" autoComplete="new-password" value={userPassword} onChange={(e) => setUserPassword(e.target.value)} placeholder="Password"
            className="px-3 py-2 rounded-lg bg-slate-900 border border-slate-700 text-sm" />
          <button type="button" className="px-3 py-1.5 rounded-lg bg-amber-700 text-white text-sm inline-flex items-center gap-1"
            onClick={async () => {
              if (!userName.trim() || !userPassword) return
              try {
                await createOpenStackIdentityUser({ name: userName.trim(), password: userPassword })
                toast.success('User created')
                setUserName('')
                setUserPassword('')
                void load()
              } catch (e: unknown) { toast.error(formatUserError(e)) }
            }}>
            <Plus className="w-4 h-4" /> Create user
          </button>
        </div>
      )}

      {loading ? (
        <Loader2 className="w-8 h-8 animate-spin text-sky-400 mx-auto" />
      ) : tab === 'projects' ? (
        projects.length === 0 ? (
          <EmptyState title="No projects" description="Insufficient scope or empty catalog." />
        ) : (
          <div className="overflow-x-auto rounded-xl border border-slate-700">
            <table className="w-full text-sm" aria-label="Projects">
              <thead className="bg-slate-900/80 text-slate-400 text-left">
                <tr><th className="px-3 py-2">Name</th><th className="px-3 py-2">ID</th><th className="px-3 py-2">Enabled</th></tr>
              </thead>
              <tbody>
                {projects.map((p) => (
                  <tr key={p.id} className="border-t border-slate-800">
                    <td className="px-3 py-2">
                      <Link to={`/openstack/identity/projects/${p.id}`} className="text-sky-400 hover:underline">{p.name}</Link>
                    </td>
                    <td className="px-3 py-2 font-mono text-xs">{p.id}</td>
                    <td className="px-3 py-2">{p.enabled ? 'yes' : 'no'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )
      ) : users.length === 0 ? (
        <EmptyState title="No users" description="Insufficient scope or empty catalog." />
      ) : (
        <div className="overflow-x-auto rounded-xl border border-slate-700">
          <table className="w-full text-sm" aria-label="Users">
            <thead className="bg-slate-900/80 text-slate-400 text-left">
              <tr><th className="px-3 py-2">Name</th><th className="px-3 py-2">Email</th><th className="px-3 py-2">Enabled</th></tr>
            </thead>
            <tbody>
              {users.map((u) => (
                <tr key={u.id} className="border-t border-slate-800">
                  <td className="px-3 py-2">
                    <Link to={`/openstack/identity/users/${u.id}`} className="text-sky-400 hover:underline">{u.name}</Link>
                  </td>
                  <td className="px-3 py-2 text-slate-400">{u.email || '—'}</td>
                  <td className="px-3 py-2">{u.enabled ? 'yes' : 'no'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <OpenStackFooter />
    </PageLayout>
  )
}
