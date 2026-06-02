// Copyright (c) 2026 ZyvorAI Labs Private Limited. All rights reserved.

import { useCallback, useEffect, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router'
import { ArrowLeft, Layers, Loader2, Save, Trash2 } from 'lucide-react'
import OpenStackGate from '../components/OpenStackGate'
import OpenStackSubNav from '../components/OpenStackSubNav'
import OpenStackFooter from '../components/OpenStackFooter'
import PageLayout from '../components/PageLayout'
import {
  deleteOpenStackHeatStack,
  getOpenStackHeatStack,
  getOpenStackHeatTemplate,
  listOpenStackHeatEvents,
  listOpenStackHeatResources,
  updateOpenStackHeatStack,
  type OpenStackHeatEvent,
  type OpenStackHeatResource,
  type OpenStackHeatStack,
} from '../api/openstackExtras'
import { useToastContext } from '../contexts/ToastContext'
import { formatUserError } from '../utils/apiError'
import { statusActionLinkClasses, statusDestructiveButtonClasses, statusToneClass } from '../utils/semanticColors'

type Tab = 'overview' | 'resources' | 'events' | 'template' | 'outputs'

export default function OpenStackHeatDetailPage() {
  return (
    <OpenStackGate title="Heat stack">
      <OpenStackHeatDetailContent />
    </OpenStackGate>
  )
}

function OpenStackHeatDetailContent() {
  const { name, id } = useParams<{ name: string; id: string }>()
  const toast = useToastContext()
  const navigate = useNavigate()
  const [stack, setStack] = useState<OpenStackHeatStack | null>(null)
  const [tab, setTab] = useState<Tab>('overview')
  const [loading, setLoading] = useState(true)
  const [resources, setResources] = useState<OpenStackHeatResource[]>([])
  const [events, setEvents] = useState<OpenStackHeatEvent[]>([])
  const [template, setTemplate] = useState('')
  const [editTemplate, setEditTemplate] = useState('')
  const [tabLoading, setTabLoading] = useState(false)

  const loadStack = useCallback(async () => {
    if (!name || !id) return
    setLoading(true)
    try {
      const { stack: s } = await getOpenStackHeatStack(name, id)
      setStack(s)
    } catch (e: unknown) {
      toast.error(formatUserError(e))
      setStack(null)
    } finally {
      setLoading(false)
    }
  }, [name, id, toast])

  useEffect(() => { void loadStack() }, [loadStack])

  const loadTab = useCallback(async () => {
    if (!name || !id || !stack) return
    setTabLoading(true)
    try {
      if (tab === 'resources') {
        const { resources: r } = await listOpenStackHeatResources(name, id)
        setResources(r ?? [])
      } else if (tab === 'events') {
        const { events: ev } = await listOpenStackHeatEvents(name, id)
        setEvents(ev ?? [])
      } else if (tab === 'template') {
        const { template: t } = await getOpenStackHeatTemplate(name, id)
        setTemplate(t ?? '')
        setEditTemplate(t ?? '')
      }
    } catch (e: unknown) {
      toast.error(formatUserError(e))
    } finally {
      setTabLoading(false)
    }
  }, [name, id, stack, tab, toast])

  useEffect(() => {
    if (tab === 'overview' || tab === 'outputs') return
    void loadTab()
  }, [tab, loadTab])

  if (loading) return <Loader2 className="w-8 h-8 animate-spin text-sky-400 mx-auto py-12" />
  if (!stack) {
    return (
      <div className="space-y-4">
        <OpenStackSubNav />
        <Link to="/openstack/heat" className="text-sky-400 hover:underline">Back</Link>
      </div>
    )
  }

  const tabs: { id: Tab; label: string }[] = [
    { id: 'overview', label: 'Overview' },
    { id: 'resources', label: 'Resources' },
    { id: 'events', label: 'Events' },
    { id: 'template', label: 'Template' },
    { id: 'outputs', label: 'Outputs' },
  ]

  return (
    <PageLayout
      hideHeader
      className="max-w-4xl"
      prepend={<><OpenStackSubNav /></>}
    >
      <Link to="/openstack/heat" className="inline-flex items-center gap-2 text-slate-400 hover:text-slate-200 text-sm">
        <ArrowLeft className="w-4 h-4" /> Heat stacks
      </Link>
      <h1 className="text-2xl font-semibold flex items-center gap-2">
        <Layers className="w-7 h-7 text-violet-400" /> {stack.stack_name}
      </h1>

      <div className="flex flex-wrap gap-2 border-b border-slate-700 pb-2">
        {tabs.map((t) => (
          <button
            key={t.id}
            type="button"
            className={`px-3 py-1.5 rounded-lg text-sm ${tab === t.id ? 'bg-violet-600/30 text-violet-200' : 'text-slate-400 hover:text-slate-200'}`}
            onClick={() => setTab(t.id)}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === 'overview' && (
        <dl className="grid sm:grid-cols-2 gap-4 rounded-xl border border-slate-700 p-4 text-sm">
          <div><dt className="text-xs text-slate-500 uppercase">ID</dt><dd className="font-mono mt-1 break-all">{stack.id}</dd></div>
          <div><dt className="text-xs text-slate-500 uppercase">Status</dt><dd className="mt-1">{stack.stack_status}</dd></div>
          <div className="sm:col-span-2"><dt className="text-xs text-slate-500 uppercase">Reason</dt><dd className="mt-1 text-slate-400">{stack.stack_status_reason || '—'}</dd></div>
          <div><dt className="text-xs text-slate-500 uppercase">Created</dt><dd className="mt-1">{stack.creation_time || '—'}</dd></div>
          <div><dt className="text-xs text-slate-500 uppercase">Updated</dt><dd className="mt-1">{stack.updated_time || '—'}</dd></div>
          <div><dt className="text-xs text-slate-500 uppercase">Timeout (min)</dt><dd className="mt-1">{stack.timeout_mins ?? '—'}</dd></div>
        </dl>
      )}

      {tab !== 'overview' && tabLoading ? (
        <Loader2 className="w-6 h-6 animate-spin text-sky-400 mx-auto" />
      ) : tab === 'resources' ? (
        <div className="overflow-x-auto rounded-xl border border-slate-700">
          <table className="w-full text-sm">
            <thead className="bg-slate-900/80 text-slate-400 text-left">
              <tr>
                <th className="px-3 py-2">Logical ID</th>
                <th className="px-3 py-2">Type</th>
                <th className="px-3 py-2">Status</th>
                <th className="px-3 py-2">Physical ID</th>
              </tr>
            </thead>
            <tbody>
              {(resources ?? []).map((r) => (
                <tr key={r.logical_resource_id} className="border-t border-slate-800">
                  <td className="px-3 py-2">{r.logical_resource_id}</td>
                  <td className="px-3 py-2 text-slate-400">{r.resource_type}</td>
                  <td className="px-3 py-2">{r.resource_status}</td>
                  <td className="px-3 py-2 font-mono text-xs">{r.physical_resource_id || '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {resources.length === 0 && <p className="p-4 text-slate-500 text-sm">No resources.</p>}
        </div>
      ) : tab === 'events' ? (
        <div className="space-y-2 max-h-96 overflow-y-auto">
          {(events ?? []).map((ev, i) => (
            <div key={`${ev.resource_name}-${ev.event_time}-${i}`} className="rounded-lg border border-slate-800 p-3 text-sm">
              <div className="text-slate-400 text-xs">{ev.event_time || '—'}</div>
              <div className="font-medium">{ev.resource_name}</div>
              <div>{ev.resource_status} {ev.resource_type ? `· ${ev.resource_type}` : ''}</div>
              {ev.resource_status_reason && <div className="text-slate-500 mt-1">{ev.resource_status_reason}</div>}
            </div>
          ))}
          {events.length === 0 && <p className="text-slate-500 text-sm">No events.</p>}
        </div>
      ) : tab === 'template' ? (
        <div className="space-y-3">
          <textarea
            value={editTemplate}
            onChange={(e) => setEditTemplate(e.target.value)}
            rows={16}
            className="w-full font-mono text-xs px-3 py-2 rounded-lg bg-slate-900 border border-slate-700"
          />
          <button
            type="button"
            className="px-3 py-1.5 rounded-lg bg-violet-600 text-white text-sm inline-flex items-center gap-1"
            onClick={async () => {
              if (!name || !id) return
              try {
                await updateOpenStackHeatStack(name, id, { template_body: editTemplate })
                toast.success('Stack update submitted')
                setTemplate(editTemplate)
                void loadStack()
              } catch (e: unknown) { toast.error(formatUserError(e)) }
            }}
          >
            <Save className="w-4 h-4" /> Update stack
          </button>
          {template && editTemplate !== template && (
            <p className={`text-xs ${statusToneClass('warn')}`}>Unsaved template changes</p>
          )}
        </div>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-slate-700">
          <table className="w-full text-sm">
            <thead className="bg-slate-900/80 text-slate-400 text-left">
              <tr>
                <th className="px-3 py-2">Key</th>
                <th className="px-3 py-2">Value</th>
                <th className="px-3 py-2">Description</th>
              </tr>
            </thead>
            <tbody>
              {(stack.outputs ?? []).map((o) => (
                <tr key={o.output_key} className="border-t border-slate-800">
                  <td className="px-3 py-2 font-mono">{o.output_key}</td>
                  <td className="px-3 py-2 break-all">{o.output_value || '—'}</td>
                  <td className="px-3 py-2 text-slate-500">{o.description || '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {(stack.outputs ?? []).length === 0 && <p className="p-4 text-slate-500 text-sm">No outputs.</p>}
        </div>
      )}

      <button type="button" className="px-3 py-1.5 rounded-lg border border-red-600/50 text-red-300 text-sm inline-flex items-center gap-1"
        onClick={async () => {
          if (!confirm(`Delete stack ${stack.stack_name}?`)) return
          try {
            await deleteOpenStackHeatStack(stack.stack_name, stack.id)
            toast.success('Delete submitted')
            navigate('/openstack/heat')
          } catch (e: unknown) { toast.error(formatUserError(e)) }
        }}>
        <Trash2 className="w-4 h-4" /> Delete stack
      </button>
      <OpenStackFooter />
    </PageLayout>
  )
}
