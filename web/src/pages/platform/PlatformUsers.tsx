// Copyright (c) 2026 ZyvorAI Labs Private Limited. All rights reserved.

import { useCallback, useEffect, useState } from 'react'
import ConfirmDialog from '../../components/ConfirmDialog'
import { Link, useNavigate } from 'react-router'
import { Boxes, Plus, Users } from 'lucide-react'
import {
  MacGlassPanel,
  MacListRow,
  MacStatWidget,
} from '../../components/platform/mac/PlatformMacUi'
import DetailTabs from '../../components/platform/DetailTabs'
import GlassDataTable from '../../components/platform/GlassDataTable'
import OperatingSurfaceLayout from '../../components/platform/OperatingSurfaceLayout'
import PlatformEmptyState from '../../components/platform/PlatformEmptyState'
import PlatformPageChrome, { PlatformRefreshButton } from '../../components/platform/PlatformPageChrome'
import { usePlatformTabState } from '../../hooks/usePlatformTabState'
import FleetSettingsPane from '../../components/platform/FleetSettingsPane'
import {
  createUser,
  deleteUser,
  getCurrentUser,
  getFleetUsers,
  listUsers,
  pruneInvalidUsers,
  patchUser,
  type FleetUsersOverview,
  type PlatformUser,
} from '../../api/platform'
import { useActiveWorkspace } from '../../hooks/useActiveWorkspace'
import { useToastContext } from '../../contexts/ToastContext'
import { formatUserError } from '../../utils/apiError'
import { hubLinkClasses, statusToneClass } from '../../utils/semanticColors'

type TabId = 'users' | 'workspaces'

const USER_TABS = [
  { id: 'users' as const, label: 'Users' },
  { id: 'workspaces' as const, label: 'Groups' },
]

export default function PlatformUsers({ embedded }: { embedded?: boolean } = {}) {
  const toast = useToastContext()
  const navigate = useNavigate()
  const [tab, setTab] = usePlatformTabState<TabId>(USER_TABS.map((t) => t.id), { defaultTab: 'users' })
  const { workspace, setWorkspace } = useActiveWorkspace()

  const [fleet, setFleet] = useState<FleetUsersOverview | null>(null)
  const [rows, setRows] = useState<PlatformUser[]>([])
  const [me, setMe] = useState<PlatformUser | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [formError, setFormError] = useState<string | null>(null)
  const [deleteUserId, setDeleteUserId] = useState<string | null>(null)
  const [newUsername, setNewUsername] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [role, setRole] = useState('operator')
  const [addBusy, setAddBusy] = useState(false)

  const load = useCallback(async () => {
    setError(null)
    try {
      await pruneInvalidUsers().catch(() => null)
      const [f, users, current] = await Promise.all([getFleetUsers(), listUsers(), getCurrentUser().catch(() => null)])
      setFleet(f)
      setRows(users.filter((u) => u.username?.trim()))
      setMe(current)
    } catch (e: unknown) {
      setError(formatUserError(e))
    } finally {
      setLoading(false)
    }
  }, [])

  const validateNewUser = () => {
    const username = newUsername.trim()
    if (!username) return 'Username is required.'
    if (!/^[a-zA-Z0-9._-]+$/.test(username)) {
      return 'Username may only contain letters, numbers, dot, dash, and underscore.'
    }
    if (newPassword.length < 8) return 'Password must be at least 8 characters.'
    return null
  }

  const handleAddUser = async () => {
    const validation = validateNewUser()
    if (validation) {
      setFormError(validation)
      return
    }
    setFormError(null)
    setAddBusy(true)
    try {
      await createUser({ username: newUsername.trim(), password: newPassword, role })
      toast.success(`User ${newUsername.trim()} created`)
      setNewUsername('')
      setNewPassword('')
      await load()
    } catch (e: unknown) {
      const message = formatUserError(e)
      setFormError(message)
      toast.error(message)
    } finally {
      setAddBusy(false)
    }
  }

  useEffect(() => { void load() }, [load])

  const switchWorkspace = (name: string) => {
    setWorkspace(name)
    navigate(name ? `/platform/vms?project=${encodeURIComponent(name)}` : '/platform/vms')
  }

  const scrollToAddUser = () => {
    document.getElementById('users-add-form')?.scrollIntoView({ behavior: 'smooth' })
  }

  return (
    <PlatformPageChrome
      hideHeader={embedded}
      compact={embedded}
      loading={loading && !fleet}
      error={error}
      onErrorRetry={() => void load()}
      title={embedded ? undefined : 'Access & Workspaces'}
      subtitle={embedded ? undefined : 'Platform RBAC accounts and tenant workspaces — switch active workspace from the menu bar.'}
      icon={embedded ? undefined : <Users className="w-6 h-6 text-slate-400" />}
      actions={embedded ? undefined : <PlatformRefreshButton onClick={() => void load()} />}
      contentClassName="space-y-4"
    >
      <OperatingSurfaceLayout testId="platform-users-page">
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

        <DetailTabs primary={USER_TABS} active={tab} onChange={setTab} />

        {tab === 'users' && (
          <>
            <MacGlassPanel
              title="Add platform user"
              subtitle="Controller database accounts (separate from OS/PAM users)."
            >
              <div id="users-add-form" className="grid gap-3 md:grid-cols-4 md:items-end">
                <label className="block space-y-1">
                  <span className="text-xs text-slate-400">Username</span>
                  <input
                    className="input w-full"
                    placeholder="jane.ops"
                    value={newUsername}
                    autoComplete="off"
                    onChange={(e) => { setNewUsername(e.target.value); setFormError(null) }}
                  />
                </label>
                <label className="block space-y-1">
                  <span className="text-xs text-slate-400">Password</span>
                  <input
                    className="input w-full"
                    type="password"
                    placeholder="min. 8 characters"
                    value={newPassword}
                    autoComplete="new-password"
                    onChange={(e) => { setNewPassword(e.target.value); setFormError(null) }}
                  />
                </label>
                <label className="block space-y-1">
                  <span className="text-xs text-slate-400">Role</span>
                  <select className="input w-full" value={role} onChange={(e) => setRole(e.target.value)}>
                    <option value="admin">admin</option>
                    <option value="operator">operator</option>
                    <option value="viewer">viewer</option>
                  </select>
                </label>
                <button
                  type="button"
                  className="btn-primary w-fit flex items-center gap-2"
                  disabled={addBusy}
                  onClick={() => void handleAddUser()}
                >
                  <Plus className="w-4 h-4" /> {addBusy ? 'Adding…' : 'Add user'}
                </button>
              </div>
              {formError && (
                <p className="text-sm text-red-300 mt-3" role="alert">{formError}</p>
              )}
            </MacGlassPanel>

            <GlassDataTable
              title="Platform users"
              columns={
                <>
                  <th className="p-3 text-left w-[40%]">User</th>
                  <th className="p-3 text-left w-[35%]">Role</th>
                  <th className="p-3 text-right w-[25%]">Actions</th>
                </>
              }
              isEmpty={rows.length === 0}
              empty={{
                icon: Users,
                title: 'No platform users yet',
                subtitle: 'Create the first RBAC account to grant fleet access.',
                action: (
                  <button type="button" className="btn-primary flex items-center gap-2" onClick={scrollToAddUser}>
                    <Plus className="w-4 h-4" /> Add user
                  </button>
                ),
              }}
            >
              {rows.map((u) => (
                <tr key={u.id} className="border-b border-white/[0.04]">
                  <td className="p-3 font-medium text-slate-200">{u.username}</td>
                  <td className="p-3">
                    <select
                      aria-label="User role"
                      className="input text-xs capitalize w-full max-w-[160px]"
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
                    <button
                      type="button"
                      className="btn-secondary text-xs"
                      disabled={me?.username === u.username}
                      title={me?.username === u.username ? 'Cannot delete your own account' : undefined}
                      onClick={() => setDeleteUserId(u.id)}
                    >
                      Delete
                    </button>
                  </td>
                </tr>
              ))}
            </GlassDataTable>
          </>
        )}

        {tab === 'workspaces' && (
          <MacGlassPanel title="Workspace groups" subtitle="Tenant isolation by project label — active workspace syncs with menu bar switcher.">
            {!fleet ? (
              <p className="text-sm text-slate-400 py-6 text-center">Loading workspaces…</p>
            ) : fleet.workspaces.length === 0 ? (
              <PlatformEmptyState
                icon={Boxes}
                title="No workspaces yet"
                subtitle="Assign VMs to a project label in Machine Finder to create tenant groups."
                action={
                  <Link to="/platform/vms" className="btn-primary text-sm">
                    Open Machine Finder
                  </Link>
                }
              />
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
      </OperatingSurfaceLayout>
      <FleetSettingsPane kind="users" />
      <ConfirmDialog
        open={deleteUserId !== null}
        title="Delete User"
        message={`Delete user "${rows.find((u) => u.id === deleteUserId)?.username}"? This cannot be undone.`}
        confirmLabel="Delete"
        variant="danger"
        onCancel={() => setDeleteUserId(null)}
        onConfirm={async () => {
          try { await deleteUser(deleteUserId!); toast.success('User deleted'); await load() }
          catch (e: unknown) { toast.error(formatUserError(e)) }
          finally { setDeleteUserId(null) }
        }}
      />
    </PlatformPageChrome>
  )
}
