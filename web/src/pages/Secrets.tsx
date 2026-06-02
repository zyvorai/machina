// Copyright (c) 2026 ZyvorAI Labs Private Limited. All rights reserved.
// Proprietary software — see LICENSE in the repository root.
// https://zyvor.dev · info@zyvor.dev

import { useEffect, useState, useCallback } from 'react'
import { listSecrets, deleteSecret, getSecretXml, defineSecret, SecretInfo } from '../api/advanced'
import { useToastContext } from '../contexts/ToastContext'
import ConfirmDialog from '../components/ConfirmDialog'
import EmptyState from '../components/EmptyState'
import PageLayout from '../components/PageLayout'
import { Shield, Trash2, RefreshCw, Search, Code, X, Plus } from 'lucide-react'
import { formatUserError } from '../utils/apiError'
import { statusToneClass } from '../utils/semanticColors'

export default function SecretsPage() {
  const [secrets, setSecrets] = useState<SecretInfo[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [deleteTarget, setDeleteTarget] = useState<string | null>(null)
  const [xmlContent, setXmlContent] = useState<string | null>(null)
  const [xmlUuid, setXmlUuid] = useState('')
  const [defineOpen, setDefineOpen] = useState(false)
  const [defXml, setDefXml] = useState('')
  const [defValueB64, setDefValueB64] = useState('')
  const [defValidate, setDefValidate] = useState(false)
  const [defSaving, setDefSaving] = useState(false)
  const toast = useToastContext()

  const load = useCallback(async () => {
    try {
      setLoading(true)
      setSecrets(await listSecrets())
    } catch (e: unknown) {
      toast.error(`${formatUserError(e)}`)
    } finally {
      setLoading(false)
    }
  }, [toast])

  useEffect(() => { load() }, [load])

  const handleDelete = async () => {
    if (!deleteTarget) return
    try { await deleteSecret(deleteTarget); toast.success(`Deleted secret '${deleteTarget}'`); load() } catch (e: unknown) { toast.error(`${formatUserError(e)}`) }
    setDeleteTarget(null)
  }

  const showXml = async (uuid: string) => {
    try { const xml = await getSecretXml(uuid); setXmlContent(xml); setXmlUuid(uuid) } catch (e: unknown) { toast.error(`${formatUserError(e)}`) }
  }

  const handleDefineSecret = async () => {
    if (!defXml.trim()) {
      toast.warning('Secret XML is required')
      return
    }
    setDefSaving(true)
    try {
      const r = await defineSecret({
        xml: defXml.trim(),
        value_base64: defValueB64.trim() || undefined,
        validate_xml: defValidate,
        set_value_flags: 0,
      })
      toast.success(`Secret defined: ${r.uuid}`)
      setDefineOpen(false)
      setDefXml('')
      setDefValueB64('')
      setDefValidate(false)
      load()
    } catch (e: unknown) {
      toast.error(`${formatUserError(e)}`)
    } finally {
      setDefSaving(false)
    }
  }

  const filtered = secrets.filter(s =>
    search === '' ||
    s.uuid.toLowerCase().includes(search.toLowerCase()) ||
    s.usage_type.toLowerCase().includes(search.toLowerCase()) ||
    s.usage_id.toLowerCase().includes(search.toLowerCase())
  )

  return (
    <PageLayout
      title="Secrets"
      icon={<Shield className="w-6 h-6" />}
      subtitle={`${secrets.length} libvirt secrets`}
      actions={
        <>
          <button type="button" onClick={() => setDefineOpen(true)} className="px-3 py-1.5 bg-blue-600 hover:bg-blue-500 rounded-lg text-sm font-medium transition flex items-center gap-1"><Plus className="w-4 h-4" /> Define secret</button>
          <button onClick={load} className="p-2 hover:bg-slate-700 rounded-lg transition" title="Refresh" aria-label="Refresh"><RefreshCw className="w-4 h-4" /></button>
        </>
      }
    >
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
        <input type="text" placeholder="Search secrets..." value={search} onChange={(e) => setSearch(e.target.value)}
          className="w-full pl-10 pr-4 py-2 bg-slate-800 border border-slate-700 rounded-lg text-sm focus:outline-none focus:border-blue-500" />
      </div>

      {loading ? (
        <div className="flex items-center justify-center h-32" aria-busy="true" aria-label="Loading secrets">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-500" />
        </div>
      ) : filtered.length === 0 ? (
        <EmptyState
          icon={<Shield className="w-6 h-6" />}
          title="No secrets found"
          description={search ? 'Try a different search term.' : 'Define a libvirt secret for encrypted storage pools (Ceph, iSCSI, etc.).'}
          primaryAction={
            !search ? (
              <button type="button" onClick={() => setDefineOpen(true)} className="px-4 py-2 rounded-lg bg-blue-600 hover:bg-blue-500 text-white text-sm font-medium">
                Define secret
              </button>
            ) : undefined
          }
        />
      ) : (
        <div className="bg-slate-800/50 rounded-xl border border-slate-700/50 overflow-hidden">
          <table className="w-full">
            <thead><tr className="border-b border-slate-700/50 text-left text-sm text-slate-400">
              <th className="px-6 py-3">UUID</th><th className="px-6 py-3 hidden md:table-cell">Usage Type</th><th className="px-6 py-3 hidden md:table-cell">Usage ID</th><th className="px-6 py-3 text-right">Actions</th>
            </tr></thead>
            <tbody className="divide-y divide-slate-700/30">
              {filtered.map(s => (
                <tr key={s.uuid} className="table-row-hover">
                  <td className="px-6 py-3 font-mono text-sm">{s.uuid}</td>
                  <td className="px-6 py-3 text-sm text-slate-300 hidden md:table-cell">{s.usage_type}</td>
                  <td className="px-6 py-3 text-sm text-slate-400 hidden md:table-cell">{s.usage_id}</td>
                  <td className="px-6 py-3 text-right">
                    <div className="flex items-center justify-end gap-1">
                      <button onClick={() => showXml(s.uuid)} className="p-1.5 hover:bg-blue-600/20 rounded transition" title="View XML"><Code className={`w-4 h-4 ${statusToneClass('info')}`} /></button>
                      <button onClick={() => setDeleteTarget(s.uuid)} className="p-1.5 hover:bg-red-600/20 rounded transition" title="Delete"><Trash2 className={`w-4 h-4 ${statusToneClass('error')}`} /></button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <ConfirmDialog open={!!deleteTarget} title="Delete Secret" message={`Delete secret '${deleteTarget}'?`} confirmLabel="Delete" onConfirm={handleDelete} onCancel={() => setDeleteTarget(null)} />

      {defineOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm" role="dialog" aria-modal="true" onClick={() => !defSaving && setDefineOpen(false)}>
          <div className="bg-slate-800 border border-slate-700/50 rounded-2xl shadow-2xl w-full max-w-2xl mx-4 max-h-[90vh] flex flex-col" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between p-5 border-b border-slate-700/50">
              <span className="text-lg font-semibold">Define libvirt secret</span>
              <button type="button" disabled={defSaving} onClick={() => setDefineOpen(false)} className="text-slate-400 hover:text-white p-1 hover:bg-slate-700 rounded-lg transition"><X className="w-4 h-4" /></button>
            </div>
            <div className="p-5 space-y-3 overflow-y-auto flex-1">
              <label className="block text-sm text-slate-400">Secret XML (<code className="text-slate-500">virSecretDefineXML</code>)</label>
              <textarea value={defXml} onChange={(e) => setDefXml(e.target.value)} rows={8} className="w-full px-3 py-2 bg-slate-900 border border-slate-700 rounded-lg text-sm font-mono text-slate-200 focus:outline-none focus:border-blue-500" placeholder={'<secret ephemeral=\'no\'>\n  <description>…</description>\n</secret>'} />
              <label className="block text-sm text-slate-400">Value (base64, optional)</label>
              <textarea value={defValueB64} onChange={(e) => setDefValueB64(e.target.value)} rows={2} className="w-full px-3 py-2 bg-slate-900 border border-slate-700 rounded-lg text-sm font-mono text-slate-200 focus:outline-none focus:border-blue-500" placeholder="Base64-encoded secret bytes (optional)" />
              <label className="flex items-center gap-2 text-sm text-slate-300 cursor-pointer">
                <input type="checkbox" checked={defValidate} onChange={(e) => setDefValidate(e.target.checked)} />
                Validate XML against schema
              </label>
              <p className="text-xs text-slate-500">After define, the secret UUID is returned. Use the XML usage section expected by your storage pool (Ceph, iSCSI, etc.).</p>
            </div>
            <div className="flex justify-end gap-3 px-5 pb-5 border-t border-slate-700/50 pt-4">
              <button type="button" disabled={defSaving} onClick={() => setDefineOpen(false)} className="px-4 py-2 bg-slate-700 hover:bg-slate-600 rounded-lg text-sm font-medium transition">Cancel</button>
              <button type="button" disabled={defSaving} onClick={handleDefineSecret} className="px-4 py-2 bg-blue-600 hover:bg-blue-500 rounded-lg text-sm text-white font-medium transition disabled:opacity-50">{defSaving ? 'Saving…' : 'Define'}</button>
            </div>
          </div>
        </div>
      )}

      {xmlContent !== null && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm" onClick={() => setXmlContent(null)}>
          <div className="bg-slate-800 border border-slate-700/50 rounded-2xl shadow-2xl w-full max-w-3xl mx-4 max-h-[80vh] flex flex-col" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between p-5 border-b border-slate-700/50">
              <span className="text-lg font-semibold font-mono">{xmlUuid}</span>
              <button onClick={() => setXmlContent(null)} className="text-slate-400 hover:text-white p-1 hover:bg-slate-700 rounded-lg transition"><X className="w-4 h-4" /></button>
            </div>
            <pre className="p-5 text-sm text-slate-300 overflow-auto whitespace-pre-wrap font-mono flex-1">{xmlContent}</pre>
          </div>
        </div>
      )}
    </PageLayout>
  )
}
