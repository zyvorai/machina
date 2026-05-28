// Copyright (c) 2026 ZyvorAI Labs Private Limited. All rights reserved.

import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router'
import { Layers, Loader2, Plus, Trash2 } from 'lucide-react'
import OpenStackGate from '../components/OpenStackGate'
import OpenStackSubNav from '../components/OpenStackSubNav'
import OpenStackFooter from '../components/OpenStackFooter'
import EmptyState from '../components/EmptyState'
import {
  createOpenStackHeatStack,
  deleteOpenStackHeatStack,
  listOpenStackHeatStacks,
  type OpenStackHeatStack,
} from '../api/openstackExtras'
import { useToastContext } from '../contexts/ToastContext'
import { formatUserError } from '../utils/apiError'

const MINIMAL_TEMPLATE = `heat_template_version: 2016-10-14
description: Minimal Heat stack (Machina)
resources:
  nothing:
    type: OS::Heat::None
`

export default function OpenStackHeatPage() {
  return (
    <OpenStackGate title="Heat stacks">
      <OpenStackHeatContent />
    </OpenStackGate>
  )
}

function OpenStackHeatContent() {
  const toast = useToastContext()
  const [stacks, setStacks] = useState<OpenStackHeatStack[]>([])
  const [loading, setLoading] = useState(true)
  const [name, setName] = useState('')
  const [template, setTemplate] = useState(MINIMAL_TEMPLATE)
  const [parametersJson, setParametersJson] = useState('{}')
  const [timeoutMins, setTimeoutMins] = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const { stacks: s } = await listOpenStackHeatStacks()
      setStacks(s)
    } catch (e: unknown) {
      toast.error(formatUserError(e))
      setStacks([])
    } finally {
      setLoading(false)
    }
  }, [toast])

  useEffect(() => { void load() }, [load])

  return (
    <div className="space-y-6">
      <OpenStackSubNav />
      <h1 className="text-2xl font-semibold flex items-center gap-2">
        <Layers className="w-7 h-7 text-violet-400" /> Heat stacks
      </h1>
      <p className="text-slate-400 text-sm">Orchestration stacks via Heat API. Requires Heat in the cloud catalog.</p>

      <div className="rounded-xl border border-slate-700 p-4 space-y-3">
        <h2 className="text-sm font-medium text-slate-300 flex items-center gap-2"><Plus className="w-4 h-4" /> Create stack</h2>
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Stack name"
          className="w-full max-w-md px-3 py-2 rounded-lg bg-slate-900 border border-slate-700 text-sm" />
        <textarea value={template} onChange={(e) => setTemplate(e.target.value)} rows={8}
          className="w-full font-mono text-xs px-3 py-2 rounded-lg bg-slate-900 border border-slate-700" />
        <label className="block text-xs text-slate-500">Parameters (JSON)</label>
        <textarea value={parametersJson} onChange={(e) => setParametersJson(e.target.value)} rows={3}
          className="w-full font-mono text-xs px-3 py-2 rounded-lg bg-slate-900 border border-slate-700" />
        <div className="flex flex-wrap gap-3 items-center">
          <input type="file" accept=".yaml,.yml,.json,.template" className="text-sm text-slate-400"
            onChange={(e) => {
              const f = e.target.files?.[0]
              if (!f) return
              void f.text().then(setTemplate).catch(() => toast.error('Could not read template file'))
            }} />
          <input value={timeoutMins} onChange={(e) => setTimeoutMins(e.target.value)} placeholder="Timeout (min, optional)"
            className="w-40 px-3 py-2 rounded-lg bg-slate-900 border border-slate-700 text-sm" />
        </div>
        <button type="button" className="px-3 py-1.5 rounded-lg bg-violet-600 text-white text-sm"
          onClick={async () => {
            if (!name.trim()) { toast.warning('Stack name required'); return }
            let parameters: Record<string, unknown> = {}
            try {
              parameters = JSON.parse(parametersJson || '{}') as Record<string, unknown>
            } catch {
              toast.error('Parameters must be valid JSON')
              return
            }
            try {
              await createOpenStackHeatStack({
                stack_name: name.trim(),
                template_body: template,
                parameters,
                timeout_mins: timeoutMins ? Number(timeoutMins) : undefined,
              })
              toast.success('Stack create submitted')
              setName('')
              setParametersJson('{}')
              setTimeoutMins('')
              void load()
            } catch (e: unknown) { toast.error(formatUserError(e)) }
          }}>Create</button>
      </div>

      {loading ? (
        <Loader2 className="w-8 h-8 animate-spin text-sky-400 mx-auto" />
      ) : stacks.length === 0 ? (
        <EmptyState title="No Heat stacks" description="Heat may be unreachable or no stacks in this project." />
      ) : (
        <div className="overflow-x-auto rounded-xl border border-slate-700">
          <table className="w-full text-sm">
            <thead className="bg-slate-900/80 text-slate-400 text-left">
              <tr>
                <th className="px-3 py-2">Name</th>
                <th className="px-3 py-2">Status</th>
                <th className="px-3 py-2">Created</th>
                <th className="px-3 py-2" />
              </tr>
            </thead>
            <tbody>
              {stacks.map((s) => (
                <tr key={s.id} className="border-t border-slate-800">
                  <td className="px-3 py-2">
                    <Link to={`/openstack/heat/${encodeURIComponent(s.stack_name)}/${encodeURIComponent(s.id)}`}
                      className="text-sky-400 hover:underline">{s.stack_name}</Link>
                  </td>
                  <td className="px-3 py-2">{s.stack_status}</td>
                  <td className="px-3 py-2 text-slate-500">{s.creation_time || '—'}</td>
                  <td className="px-3 py-2 text-right">
                    <button type="button" className="text-red-400 hover:underline inline-flex items-center gap-1"
                      onClick={async () => {
                        if (!confirm(`Delete stack ${s.stack_name}?`)) return
                        try {
                          await deleteOpenStackHeatStack(s.stack_name, s.id)
                          toast.success('Delete submitted')
                          void load()
                        } catch (e: unknown) { toast.error(formatUserError(e)) }
                      }}>
                      <Trash2 className="w-3.5 h-3.5" /> Delete
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <OpenStackFooter />
    </div>
  )
}
