// Copyright (c) 2026 ZyvorAI Labs Private Limited. All rights reserved.

import { useCallback, useEffect, useState } from 'react'
import ConfirmDialog from '../../components/ConfirmDialog'
import { Key, Plus, Trash2 } from 'lucide-react'
import GlassDataTable from '../../components/platform/GlassDataTable'
import OperatingSurfaceLayout from '../../components/platform/OperatingSurfaceLayout'
import PlatformPageChrome, { PlatformRefreshButton } from '../../components/platform/PlatformPageChrome'
import { MacGlassPanel, MacStatWidget } from '../../components/platform/mac/PlatformMacUi'
import { createApiKey, deleteApiKey, listApiKeys, type ApiKeyRow } from '../../api/platform'
import { useToastContext } from '../../contexts/ToastContext'
import { formatUserError } from '../../utils/apiError'
import { statusSurfaceClasses, statusToneClass } from '../../utils/semanticColors'

export default function PlatformApiKeys({ embedded }: { embedded?: boolean } = {}) {
  const toast = useToastContext()
  const [rows, setRows] = useState<ApiKeyRow[]>([])
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [name, setName] = useState('automation')
  const [role, setRole] = useState('operator')
  const [newToken, setNewToken] = useState<string | null>(null)
  const [deleteKeyId, setDeleteKeyId] = useState<string | null>(null)

  const load = useCallback(async () => {
    setError(null)
    try { setRows(await listApiKeys()) } catch (e: unknown) { setError(formatUserError(e)) }
    finally { setLoading(false) }
  }, [])

  useEffect(() => { void load() }, [load])

  const activeCount = rows.length

  return (
    <PlatformPageChrome
      hideHeader={embedded}
      compact={embedded}
      loading={loading && rows.length === 0}
      error={error}
      onErrorRetry={() => void load()}
      title={embedded ? undefined : 'API keys'}
      subtitle={embedded ? undefined : 'Bearer tokens for automation (machina_*)'}
      icon={embedded ? undefined : <Key className="w-6 h-6 text-slate-400" />}
      actions={embedded ? undefined : <PlatformRefreshButton onClick={() => void load()} />}
      contentClassName="space-y-4"
    >
      <OperatingSurfaceLayout testId="platform-api-keys-page">
        <div className="grid gap-3 sm:grid-cols-2">
          <MacStatWidget label="Active keys" value={String(activeCount)} icon={<Key className="w-4 h-4" />} tone={activeCount > 0 ? 'ok' : 'default'} />
          <MacStatWidget label="Total keys" value={String(rows.length)} icon={<Key className="w-4 h-4" />} />
        </div>

        {newToken && (
          <div className={`rounded-xl p-4 text-sm ${statusSurfaceClasses('warn')}`}>
            <p className={`mb-2 ${statusToneClass('warn')}`}>Copy this token now — it will not be shown again:</p>
            <code className="block break-all text-xs text-slate-300">{newToken}</code>
          </div>
        )}

        <MacGlassPanel title="Create API key" subtitle="Keys inherit RBAC role and appear as machina_* bearer tokens.">
          <div className="grid gap-3 md:grid-cols-4 md:items-end">
            <label className="block space-y-1">
              <span className="text-xs text-slate-400">Name</span>
              <input className="input w-full" placeholder="automation" value={name} onChange={(e) => setName(e.target.value)} />
            </label>
            <label className="block space-y-1">
              <span className="text-xs text-slate-400">Role</span>
              <select className="input w-full" value={role} onChange={(e) => setRole(e.target.value)}>
                <option value="admin">admin</option>
                <option value="operator">operator</option>
                <option value="viewer">viewer</option>
              </select>
            </label>
            <button type="button" className="btn-primary w-fit flex items-center gap-2 md:col-span-2" onClick={async () => {
              try {
                const res = await createApiKey({ name, role })
                setNewToken(res.token)
                toast.success('API key created')
                await load()
              } catch (e: unknown) { toast.error(formatUserError(e)) }
            }}><Plus className="w-4 h-4" /> Create key</button>
          </div>
        </MacGlassPanel>

        <GlassDataTable
          title="API keys"
          columns={
            <>
              <th className="p-3 text-left">Name</th>
              <th className="p-3 text-left">Role</th>
              <th className="p-3 text-left">Last used</th>
              <th className="p-3 text-right" />
            </>
          }
          isEmpty={rows.length === 0}
          empty={{
            icon: Key,
            title: 'No API keys yet',
            subtitle: 'Create a bearer token for CI/CD or automation scripts.',
          }}
        >
          {rows.map((k) => (
            <tr key={k.id} className="border-b border-white/[0.04]">
              <td className="p-3 text-slate-200">{k.name}</td>
              <td className="p-3 capitalize">{k.role}</td>
              <td className="p-3 text-slate-500">{k.last_used_at ? new Date(k.last_used_at).toLocaleString() : '—'}</td>
              <td className="p-3 text-right">
                <button type="button" className="btn-secondary text-xs" aria-label="Delete API key" onClick={() => setDeleteKeyId(k.id)}><Trash2 className="w-3 h-3 inline" /></button>
              </td>
            </tr>
          ))}
        </GlassDataTable>
      </OperatingSurfaceLayout>
      <ConfirmDialog
        open={deleteKeyId !== null}
        title="Delete API Key"
        message={`Delete API key "${rows.find((k) => k.id === deleteKeyId)?.name}"? Any integrations using this key will stop working immediately.`}
        confirmLabel="Delete"
        variant="danger"
        onCancel={() => setDeleteKeyId(null)}
        onConfirm={async () => {
          try { await deleteApiKey(deleteKeyId!); toast.success('Deleted'); await load() }
          catch (e: unknown) { toast.error(formatUserError(e)) }
          finally { setDeleteKeyId(null) }
        }}
      />
    </PlatformPageChrome>
  )
}
