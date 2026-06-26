// Copyright (c) 2026 ZyvorAI Labs Private Limited. All rights reserved.
// Proprietary software — see LICENSE in the repository root.
// https://zyvor.dev · info@zyvor.dev

import { useEffect, useState, useCallback } from 'react'
import { listNwfilters, deleteNwfilter, defineNwfilter, getNwfilterXml, NwfilterInfo } from '../api/advanced'
import { useToastContext } from '../contexts/ToastContext'
import ConfirmDialog from '../components/ConfirmDialog'
import EmptyState from '../components/EmptyState'
import PageLayout from '../components/PageLayout'
import { Shield, Trash2, RefreshCw, Search, Code, X, Plus } from 'lucide-react'
import { formatUserError } from '../utils/apiError'
import { statusToneClass } from '../utils/semanticColors'

const DEFAULT_FILTER_XML = `<filter name='my-filter' chain='root'>
  <rule action='accept' direction='in'>
    <tcp dstportstart='22'/>
  </rule>
</filter>`

export default function NWFiltersPage() {
  const [filters, setFilters] = useState<NwfilterInfo[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [deleteTarget, setDeleteTarget] = useState<string | null>(null)
  const [xmlContent, setXmlContent] = useState<string | null>(null)
  const [xmlName, setXmlName] = useState('')
  const [showCreate, setShowCreate] = useState(false)
  const [newFilterXml, setNewFilterXml] = useState(DEFAULT_FILTER_XML)
  const [creating, setCreating] = useState(false)
  const toast = useToastContext()

  const load = useCallback(async () => {
    try {
      setLoading(true)
      setFilters(await listNwfilters())
    } catch (e: unknown) {
      toast.error(`${formatUserError(e)}`)
    } finally {
      setLoading(false)
    }
  }, [toast])

  useEffect(() => { load() }, [load])

  const handleDelete = async () => {
    if (!deleteTarget) return
    try { await deleteNwfilter(deleteTarget); toast.success(`Deleted filter '${deleteTarget}'`); load() } catch (e: unknown) { toast.error(`${formatUserError(e)}`) }
    setDeleteTarget(null)
  }

  const showXml = async (name: string) => {
    try { const xml = await getNwfilterXml(name); setXmlContent(xml); setXmlName(name) } catch (e: unknown) { toast.error(`${formatUserError(e)}`) }
  }

  const handleCreate = async () => {
    if (!newFilterXml.trim()) return
    setCreating(true)
    try {
      const result = await defineNwfilter(newFilterXml)
      toast.success(`Filter '${result.name}' created`)
      setShowCreate(false)
      setNewFilterXml(DEFAULT_FILTER_XML)
      load()
    } catch (e: unknown) { toast.error(`${formatUserError(e)}`) }
    finally { setCreating(false) }
  }

  const filtered = filters.filter(f => search === '' || f.name.toLowerCase().includes(search.toLowerCase()))

  return (
    <PageLayout
      title="Network Filters"
      icon={<Shield className="w-6 h-6" />}
      subtitle={`${filters.length} libvirt nwfilters`}
      actions={
        <>
          <button onClick={() => setShowCreate(true)} className="flex items-center gap-1.5 px-3 py-1.5 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-sm font-medium transition"><Plus className="w-4 h-4" />Create Filter</button>
          <button onClick={load} className="p-2 hover:bg-slate-700 rounded-lg transition" title="Refresh" aria-label="Refresh"><RefreshCw className="w-4 h-4" /></button>
        </>
      }
    >
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
        <input type="text" aria-label="Search network filters" placeholder="Search filters..." value={search} onChange={(e) => setSearch(e.target.value)}
          className={`w-full pl-10 py-2 bg-slate-800 border border-slate-700 rounded-lg text-sm focus:outline-none focus:border-blue-500 ${search ? 'pr-8' : 'pr-4'}`} />
        {search && (
          <button type="button" aria-label="Clear search" onClick={() => setSearch('')}
            className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-200">
            <X className="w-4 h-4" />
          </button>
        )}
      </div>

      {loading ? (
        <div className="flex items-center justify-center h-32" aria-busy="true" aria-label="Loading network filters">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-500" />
        </div>
      ) : filtered.length === 0 ? (
        <EmptyState
          icon={<Shield className="w-6 h-6" />}
          title="No network filters"
          description={search ? 'Try a different search term.' : 'Create an nwfilter to apply iptables-style rules to VM interfaces.'}
          primaryAction={
            !search ? (
              <button type="button" onClick={() => setShowCreate(true)} className="px-4 py-2 rounded-lg bg-blue-600 hover:bg-blue-500 text-white text-sm font-medium">
                Create filter
              </button>
            ) : undefined
          }
        />
      ) : (
        <div className="bg-slate-800/50 rounded-xl border border-slate-700/50 overflow-hidden">
          <table className="w-full" aria-label="Network filters">
            <thead><tr className="border-b border-slate-700/50 text-left text-sm text-slate-400">
              <th className="px-6 py-3">Name</th><th className="px-6 py-3 hidden md:table-cell">UUID</th><th className="px-6 py-3 text-right">Actions</th>
            </tr></thead>
            <tbody className="divide-y divide-slate-700/30">
              {filtered.map(f => (
                <tr key={f.name} className="table-row-hover">
                  <td className="px-6 py-3 font-medium">{f.name}</td>
                  <td className="px-6 py-3 text-xs font-mono text-slate-500 hidden md:table-cell">{f.uuid}</td>
                  <td className="px-6 py-3 text-right">
                    <div className="flex items-center justify-end gap-1">
                      <button onClick={() => showXml(f.name)} className="p-1.5 hover:bg-blue-600/20 rounded transition" title="View XML" aria-label="View XML"><Code className={`w-4 h-4 ${statusToneClass('info')}`} /></button>
                      <button onClick={() => setDeleteTarget(f.name)} className="p-1.5 hover:bg-red-600/20 rounded transition" title="Delete" aria-label="Delete"><Trash2 className={`w-4 h-4 ${statusToneClass('error')}`} /></button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <ConfirmDialog open={!!deleteTarget} title="Delete Network Filter" message={`Delete filter '${deleteTarget}'?`} confirmLabel="Delete" onConfirm={handleDelete} onCancel={() => setDeleteTarget(null)} />

      {xmlContent !== null && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm" onClick={() => setXmlContent(null)}>
          <div className="bg-slate-800 border border-slate-700/50 rounded-2xl shadow-2xl w-full max-w-3xl mx-4 max-h-[80vh] flex flex-col" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between p-5 border-b border-slate-700/50">
              <span className="text-lg font-semibold font-mono">{xmlName}</span>
              <button onClick={() => setXmlContent(null)} className="text-slate-400 hover:text-white p-1 hover:bg-slate-700 rounded-lg transition"><X className="w-4 h-4" /></button>
            </div>
            <pre className="p-5 text-sm text-slate-300 overflow-auto whitespace-pre-wrap font-mono flex-1">{xmlContent}</pre>
          </div>
        </div>
      )}

      {showCreate && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm" onClick={() => setShowCreate(false)}>
          <div className="bg-slate-800 border border-slate-700/50 rounded-2xl shadow-2xl w-full max-w-3xl mx-4 max-h-[80vh] flex flex-col" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between p-5 border-b border-slate-700/50">
              <span className="text-lg font-semibold">Create Network Filter</span>
              <button onClick={() => setShowCreate(false)} className="text-slate-400 hover:text-white p-1 hover:bg-slate-700 rounded-lg transition"><X className="w-4 h-4" /></button>
            </div>
            <div className="p-5 flex-1 flex flex-col gap-4 overflow-auto">
              <label className="text-sm text-slate-400">Filter XML Definition</label>
              <textarea
                aria-label="Filter XML definition"
                value={newFilterXml}
                onChange={(e) => setNewFilterXml(e.target.value)}
                rows={12}
                className="w-full bg-slate-900 border border-slate-700 rounded-lg p-3 text-sm font-mono text-slate-300 focus:outline-none focus:border-blue-500 resize-y"
                spellCheck={false}
              />
              <div className="flex justify-end gap-2">
                <button onClick={() => setShowCreate(false)} className="px-4 py-2 text-sm text-slate-400 hover:text-white hover:bg-slate-700 rounded-lg transition">Cancel</button>
                <button onClick={handleCreate} disabled={creating || !newFilterXml.trim()} className="px-4 py-2 text-sm bg-blue-600 hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed text-white rounded-lg font-medium transition">
                  {creating ? 'Creating...' : 'Create Filter'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </PageLayout>
  )
}
