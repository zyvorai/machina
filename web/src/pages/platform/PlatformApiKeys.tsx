// Copyright (c) 2026 ZyvorAI Labs Private Limited. All rights reserved.

import { useCallback, useEffect, useState } from 'react'
import { Key, Plus, Trash2 } from 'lucide-react'
import PlatformPageChrome, { PlatformRefreshButton } from '../../components/platform/PlatformPageChrome'
import { createApiKey, deleteApiKey, listApiKeys, type ApiKeyRow } from '../../api/platform'
import { useToastContext } from '../../contexts/ToastContext'
import { formatUserError } from '../../utils/apiError'
import { statusSurfaceClasses, statusToneClass } from '../../utils/semanticColors'

export default function PlatformApiKeys({ embedded }: { embedded?: boolean } = {}) {
  const toast = useToastContext()
  const [rows, setRows] = useState<ApiKeyRow[]>([])
  const [error, setError] = useState<string | null>(null)
  const [name, setName] = useState('automation')
  const [role, setRole] = useState('operator')
  const [newToken, setNewToken] = useState<string | null>(null)

  const load = useCallback(async () => {
    setError(null)
    try { setRows(await listApiKeys()) } catch (e: unknown) { setError(formatUserError(e)) }
  }, [])

  useEffect(() => { void load() }, [load])

  return (
    <PlatformPageChrome
      hideHeader={embedded}
      compact={embedded}
      error={error}
      onErrorRetry={() => void load()}
      title={embedded ? undefined : 'API keys'}
      subtitle={embedded ? undefined : 'Bearer tokens for automation (machina_*)'}
      icon={embedded ? undefined : <Key className="w-6 h-6 text-slate-400" />}
      actions={embedded ? undefined : <PlatformRefreshButton onClick={() => void load()} />}
      contentClassName="space-y-4"
    >
      {newToken && (
        <div className={`card p-4 text-sm ${statusSurfaceClasses('warn')}`}>
          <p className={`mb-2 ${statusToneClass('warn')}`}>Copy this token now — it will not be shown again:</p>
          <code className="block break-all text-xs text-slate-300">{newToken}</code>
        </div>
      )}
      <div className="card p-4 grid gap-3 md:grid-cols-4">
        <input className="input" placeholder="name" value={name} onChange={(e) => setName(e.target.value)} />
        <select className="input" value={role} onChange={(e) => setRole(e.target.value)}>
          <option value="admin">admin</option>
          <option value="operator">operator</option>
          <option value="viewer">viewer</option>
        </select>
        <button type="button" className="btn-primary w-fit flex items-center gap-2 md:col-span-2" onClick={async () => {
          try {
            const res = await createApiKey({ name, role })
            setNewToken(res.token)
            toast.success('API key created')
            await load()
          } catch (e: unknown) { toast.error(formatUserError(e)) }
        }}><Plus className="w-4 h-4" /> Create key</button>
      </div>
      <div className="card overflow-x-auto">
        <table className="w-full text-sm">
          <thead><tr className="text-slate-400 border-b border-slate-800"><th className="p-3 text-left">Name</th><th className="p-3">Role</th><th className="p-3">Last used</th><th className="p-3" /></tr></thead>
          <tbody>{rows.map((k) => (
            <tr key={k.id} className="border-b border-slate-900">
              <td className="p-3">{k.name}</td>
              <td className="p-3">{k.role}</td>
              <td className="p-3 text-slate-500">{k.last_used_at ? new Date(k.last_used_at).toLocaleString() : '—'}</td>
              <td className="p-3 text-right">
                <button type="button" className="btn-secondary text-xs" onClick={async () => {
                  try { await deleteApiKey(k.id); toast.success('Deleted'); await load() } catch (e: unknown) { toast.error(formatUserError(e)) }
                }}><Trash2 className="w-3 h-3 inline" /></button>
              </td>
            </tr>
          ))}</tbody>
        </table>
      </div>
    </PlatformPageChrome>
  )
}
