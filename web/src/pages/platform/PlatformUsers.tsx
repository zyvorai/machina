// Copyright (c) 2026 ZyvorAI Labs Private Limited. All rights reserved.

import { useCallback, useEffect, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router'
import { Boxes, Plus, Users } from 'lucide-react'
import {
  MacGlassPanel,
  MacListRow,
  MacSectionTitle,
  MacStatWidget,
} from '../../components/platform/mac/PlatformMacUi'
import PageLayout from '../../components/PageLayout'
import FleetSettingsPane from '../../components/platform/FleetSettingsPane'
import {
  createUser,
  deleteUser,
  getCurrentUser,
  getFleetUsers,
  listUsers,
  patchUser,
  type FleetUsersOverview,
  type PlatformUser,
} from '../../api/platform'
import { useActiveWorkspace } from '../../hooks/useActiveWorkspace'
import { useToastContext } from '../../contexts/ToastContext'
import { formatUserError } from '../../utils/apiError'
import { hubLinkClasses, statusToneClass } from '../../utils/semanticColors'

type TabId = 'users' | 'workspaces'

const TAB_IDS: TabId[] = ['users', 'workspaces']

export default function PlatformUsers({ embedded }: { embedded?: boolean } = {}) {
  const toast = useToastContext()
  const navigate = useNavigate()
  const [searchParams, setSearchParams] = useSearchParams()
  const rawTab = searchParams.get('tab')
  const tab: TabId = TAB_IDS.includes(rawTab as TabId) ? (rawTab as TabId) : 'users'
  const { workspace, setWorkspace } = useActiveWorkspace()

  const [fleet, setFleet] = useState<FleetUsersOverview | null>(null)
  const [rows, setRows] = useState<PlatformUser[]>([])
  const [me, setMe] = useState<PlatformUser | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [user, setUser] = useState('')
  const [pass, setPass] = useState('')
  const [role, setRole] = useState('operator')

  const setTab = (next: TabId) => {
    setSearchParams(next === 'users' ? {} : { tab: next })
  }

  const load = useCallback(async () => {
    setError(null)
    try {
      const [f, users, current] = await Promise.all([getFleetUsers(), listUsers(), getCurrentUser().catch(() => null)])
      setFleet(f)
      setRows(users)
      setMe(current)
    } catch (e: unknown) {
      setError(formatUserError(e))
    }
  }, [])

  useEffect(() => { void load() }, [load])

  const switchWorkspace = (name: string) => {
    setWorkspace(name)
    navigate(name ? `/platform/vms?project=${encodeURIComponent(name)}` : '/platform/vms')
  }

  return (
    <PageLayout hideHeader compact={embedded} error={error}>
      {!embedded && (
        <header>
          <p className="text-xs font-semibold uppercase tracking-wider text-orange-400/80">Users & Groups</p>
          <MacSectionTitle
            title="Access & Workspaces"
            subtitle="Platform RBAC accounts and tenant workspaces — switch active workspace from the menu bar."
          />
        </header>
      )}
      {me && <p className="text-sm text-slate-400">Signed in as <strong className="text-slate-200">{me.username}</strong> ({me.role})</p>}
      {fleet && <p className="text-sm text-slate-400">{fleet.summary}</p>}

      {fleet && (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <MacStatWidget label="Users" value={String(fleet.user_count)} icon={<Users className="w-4 h-4" />} />
          <MacStatWidget label="Admins" value={String(fleet.admin_count)} icon={<Users className="w-4 h-4" />} />
          <MacStatWidget label="Workspaces" value={String(fleet.workspace_count)} icon={<Boxes className="w-4 h-4" />} />
          <MacStatWidget
            label="Quotas enforced"
            value={String(fleet.workspaces_enforced)}
            icon={<Boxes className="w-4 h-4" />}
            tone={fleet.workspaces_enforced > 0 ? 'ok' : 'default'}
          />
        </div>
      )}

      <div className="flex flex-wrap gap-2 border-b border-white/[0.06] pb-1">
        {([
          ['users', 'Users', Users],
          ['workspaces', 'Groups', Boxes],
        ] as const).map(([id, label, Icon]) => (
          <button
            key={id}
            type="button"
            onClick={() => setTab(id)}
            className={`px-4 py-2 text-sm rounded-t-lg flex items-center gap-2 transition ${
              tab === id ? 'bg-slate-800/80 text-orange-300 border-b-2 border-orange-400' : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            <Icon className="w-4 h-4" /> {label}
          </button>
        ))}
      </div>

      {tab === 'users' && (
        <>
          <div className="card p-4 grid gap-3 md:grid-cols-4">
            <input className="input" placeholder="username" value={user} onChange={(e) => setUser(e.target.value)} />
            <input className="input" type="password" placeholder="password" value={pass} onChange={(e) => setPass(e.target.value)} />
            <select className="input" value={role} onChange={(e) => setRole(e.target.value)}>
              <option value="admin">admin</option>
              <option value="operator">operator</option>
              <option value="viewer">viewer</option>
            </select>
            <button type="button" className="btn-primary w-fit flex items-center gap-2" onClick={async () => {
              try {
                await createUser({ username: user, password: pass, role })
                toast.success('User created')
                await load()
              } catch (e: unknown) { toast.error(formatUserError(e)) }
            }}><Plus className="w-4 h-4" /> Add user</button>
          </div>
          <div className="card overflow-x-auto">
            <table className="w-full text-sm">
              <thead><tr className="text-slate-400 border-b border-slate-800"><th className="p-3 text-left">User</th><th className="p-3">Role</th><th className="p-3" /></tr></thead>
              <tbody>{rows.map((u) => (
                <tr key={u.id} className="border-b border-slate-900">
                  <td className="p-3">{u.username}</td>
                  <td className="p-3">
                    <select
                      className="input text-xs capitalize"
                      value={u.role}
                      onChange={async (e) => {
                        try {
                          await patchUser(u.id, { role: e.target.value })
                          toast.success('Role updated')
                          await load()
                        } catch (err: unknown) { toast.error(formatUserError(err)) }
                      }}
                    >
                      <option value="admin">admin</option>
                      <option value="operator">operator</option>
                      <option value="viewer">viewer</option>
                    </select>
                  </td>
                  <td className="p-3 text-right">
                    <button type="button" className="btn-secondary text-xs" onClick={async () => {
                      try { await deleteUser(u.id); toast.success('Deleted'); await load() } catch (e: unknown) { toast.error(formatUserError(e)) }
                    }}>Delete</button>
                  </td>
                </tr>
              ))}</tbody>
            </table>
          </div>
        </>
      )}

      {tab === 'workspaces' && (
        <MacGlassPanel title="Workspace groups" subtitle="Tenant isolation by project label — active workspace syncs with menu bar switcher.">
          {!fleet ? (
            <p className="text-sm text-slate-400 py-6 text-center">Loading workspaces…</p>
          ) : fleet.workspaces.length === 0 ? (
            <p className="text-sm text-slate-400">No workspaces — assign VMs to a project label in Finder.</p>
          ) : (
            <div className="divide-y divide-white/[0.04] -mx-1">
              {fleet.workspaces.map((w) => (
                <MacListRow
                  key={w.name}
                  title={w.name}
                  subtitle={`${w.vm_count} VM(s) · ${w.network_isolation} · ${w.quota_status}`}
                  onClick={() => switchWorkspace(w.name)}
                  badge={
                    workspace === w.name ? (
                      <span className="text-[10px] text-violet-300 border border-violet-500/30 px-2 py-0.5 rounded">active</span>
                    ) : w.enforce_quotas ? (
                      <span className={`text-[10px] ${statusToneClass('ok')}`}>enforced</span>
                    ) : null
                  }
                  trailing={
                    <Link
                      to={`/platform/vms?project=${encodeURIComponent(w.name)}`}
                      className={`text-xs ${hubLinkClasses()}`}
                      onClick={(e) => e.stopPropagation()}
                    >
                      VMs →
                    </Link>
                  }
                />
              ))}
            </div>
          )}
          <div className="flex flex-wrap gap-3 mt-4 pt-2 border-t border-white/[0.04]">
            <Link to="/platform/projects" className={`text-sm ${hubLinkClasses()}`}>Projects list</Link>
            <Link to="/platform/enterprise?tab=tenants" className={`text-sm ${hubLinkClasses()}`}>Tenant isolation</Link>
          </div>
        </MacGlassPanel>
      )}
      <FleetSettingsPane kind="users" />
    </PageLayout>
  )
}
