// Copyright (c) 2026 ZyvorAI Labs Private Limited. All rights reserved.
// Proprietary software — see LICENSE in the repository root.
// https://zyvor.dev · info@zyvor.dev

import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router'
import { RefreshCw, Trash2, Users } from 'lucide-react'
import { useAuth } from '../contexts/AuthContext'
import { useToastContext } from '../contexts/ToastContext'
import { listAdminSessions, revokeAdminSession, AdminSessionsResponse } from '../api/adminSessions'
import { logout as apiLogout } from '../api/auth'
import { formatUserError } from '../utils/apiError'
import EmptyState from '../components/EmptyState'
import PageLayout from '../components/PageLayout'
import { statusActionLinkClasses, statusBadgeClasses, statusToneClass } from '../utils/semanticColors'

export default function AdminSessionsPage() {
  const { username, isRoot } = useAuth()
  const toast = useToastContext()
  const [data, setData] = useState<AdminSessionsResponse | null>(null)
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    if (!isRoot) return
    setLoading(true)
    try {
      setData(await listAdminSessions())
    } catch (e: unknown) {
      toast.error(formatUserError(e))
      setData(null)
    } finally {
      setLoading(false)
    }
  }, [isRoot, toast])

  useEffect(() => { void load() }, [load])

  if (!isRoot) {
    return (
      <div className="max-w-lg mx-auto text-center space-y-4 py-16">
        <h1 className="text-xl font-semibold text-slate-200">Web sessions</h1>
        <p className="text-slate-400 text-sm">
          Only the UNIX <strong className="text-slate-300">root</strong> user may list or revoke browser sessions.
          You are signed in as <code className="bg-slate-800 px-1 rounded text-slate-300">{username || '?'}</code>.
        </p>
        <Link to="/" className={`inline-block text-sm ${statusActionLinkClasses('info')}`}>Back to dashboard</Link>
      </div>
    )
  }

  return (
    <PageLayout
      className="max-w-5xl"
      title="Web sessions"
      icon={<Users className={`w-7 h-7 ${statusToneClass('info')}`} />}
      subtitle="In-memory browser logins for this machina daemon (not API bearer tokens). Revoking a session invalidates that cookie; the user must sign in again."
      actions={
        <button type="button" onClick={() => void load()} className="p-2 hover:bg-slate-700 rounded-lg transition" aria-label="Refresh" title="Refresh">
          <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
        </button>
      }
      contentLoading={loading && !data}
    >
      {data && (
        <div className="grid gap-4 sm:grid-cols-3">
          <div className="bg-slate-800/50 border border-slate-700/50 rounded-xl p-4">
            <div className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">Sessions</div>
            <div className="text-2xl font-semibold text-white mt-1">{data.total_sessions}</div>
          </div>
          <div className="bg-slate-800/50 border border-slate-700/50 rounded-xl p-4">
            <div className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">Distinct users</div>
            <div className="text-2xl font-semibold text-white mt-1">{data.users_logged_in}</div>
          </div>
          <div className="bg-slate-800/50 border border-slate-700/50 rounded-xl p-4 sm:col-span-1">
            <div className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">Per user</div>
            <div className="text-xs text-slate-300 mt-2 font-mono space-y-0.5">
              {Object.entries(data.sessions_per_username).map(([u, n]) => (
                <div key={u}>{u}: {n}</div>
              ))}
            </div>
          </div>
        </div>
      )}

      {!loading && data && data.sessions.length === 0 ? (
        <EmptyState title="No active sessions" description="No browser sessions are currently tracked by the daemon." />
      ) : (
      <div className="bg-slate-800/50 rounded-xl border border-slate-700/50 overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-slate-700/50 text-left text-slate-400">
              <th className="px-4 py-3">Session id</th>
              <th className="px-4 py-3">User</th>
              <th className="px-4 py-3">Age</th>
              <th className="px-4 py-3">TTL left</th>
              <th className="px-4 py-3 text-right">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-700/30">
            {(data?.sessions ?? []).map((s) => (
              <tr key={s.session_id} className="table-row-hover">
                <td className="px-4 py-3 font-mono text-xs text-slate-400 break-all max-w-[200px]">{s.session_id}</td>
                <td className="px-4 py-3 font-medium">
                  {s.username}
                  {s.is_current && <span className={`ml-2 text-[10px] uppercase ${statusBadgeClasses('info')}`}>This browser</span>}
                </td>
                <td className="px-4 py-3 text-slate-400">{formatDuration(s.age_secs)}</td>
                <td className="px-4 py-3 text-slate-400">{formatDuration(s.expires_in_secs)}</td>
                <td className="px-4 py-3 text-right">
                  <button
                    type="button"
                    className={`p-1.5 rounded-lg hover:bg-red-600/20 disabled:opacity-40 disabled:pointer-events-none ${statusToneClass('error')}`}
                    title={s.is_current ? 'Ends this browser session (you will need to sign in again)' : 'Revoke session'}
                    aria-label="Revoke session"
                    onClick={async () => {
                      if (!window.confirm(`Revoke session for ${s.username}?${s.is_current ? ' You will be signed out.' : ''}`)) return
                      try {
                        await revokeAdminSession(s.session_id)
                        toast.success('Session revoked')
                        if (s.is_current) {
                          await apiLogout()
                          window.location.href = '/'
                          return
                        }
                        await load()
                      } catch (e: unknown) {
                        toast.error(formatUserError(e))
                      }
                    }}
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      )}
    </PageLayout>
  )
}

function formatDuration(secs: number): string {
  if (secs < 60) return `${secs}s`
  if (secs < 3600) return `${Math.floor(secs / 60)}m`
  return `${Math.floor(secs / 3600)}h ${Math.floor((secs % 3600) / 60)}m`
}
