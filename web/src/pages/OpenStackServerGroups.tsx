// Copyright (c) 2026 ZyvorAI Labs Private Limited. All rights reserved.

import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router'
import {
  createOpenStackServerGroup,
  deleteOpenStackServerGroup,
  listOpenStackServerGroups,
  type OpenStackServerGroup,
} from '../api/openstackExtras'
import OpenStackGate from '../components/OpenStackGate'
import OpenStackSubNav from '../components/OpenStackSubNav'
import OpenStackFooter from '../components/OpenStackFooter'
import PageLayout from '../components/PageLayout'
import { useToastContext } from '../contexts/ToastContext'
import { formatUserError } from '../utils/apiError'
import { statusActionLinkClasses, statusDestructiveButtonClasses, statusToneClass } from '../utils/semanticColors'
import { Layers, Loader2, RefreshCw } from 'lucide-react'

const POLICIES = ['affinity', 'anti-affinity', 'soft-affinity', 'soft-anti-affinity'] as const

export default function OpenStackServerGroupsPage() {
  return (
    <OpenStackGate title="Server groups">
      <OpenStackServerGroupsContent />
    </OpenStackGate>
  )
}

function OpenStackServerGroupsContent() {
  const toast = useToastContext()
  const [groups, setGroups] = useState<OpenStackServerGroup[]>([])
  const [loading, setLoading] = useState(true)
  const [name, setName] = useState('')
  const [policy, setPolicy] = useState<string>(POLICIES[1])

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const { server_groups } = await listOpenStackServerGroups()
      setGroups(server_groups)
    } catch (e: unknown) {
      toast.error(formatUserError(e))
    } finally {
      setLoading(false)
    }
  }, [toast])

  useEffect(() => {
    void load()
  }, [load])

  return (
    <PageLayout
      hideHeader
      className="max-w-3xl"
      prepend={<><OpenStackSubNav /></>}
    >
      <h1 className="text-2xl font-semibold flex items-center gap-2">
        <Layers className="w-7 h-7 text-sky-400" />
        Nova server groups
      </h1>
      <div className="rounded-xl border border-slate-700 p-4 flex flex-wrap gap-3 items-end">
        <div>
          <label className="block text-xs text-slate-500 mb-1">Name</label>
          <input value={name} onChange={(e) => setName(e.target.value)}
            className="px-2 py-1.5 rounded-lg bg-slate-900 border border-slate-700 text-sm" />
        </div>
        <div>
          <label className="block text-xs text-slate-500 mb-1">Policy</label>
          <select value={policy} onChange={(e) => setPolicy(e.target.value)}
            className="px-2 py-1.5 rounded-lg bg-slate-900 border border-slate-700 text-sm">
            {POLICIES.map((p) => (
              <option key={p} value={p}>{p}</option>
            ))}
          </select>
        </div>
        <button type="button" disabled={!name.trim()}
          className="px-3 py-1.5 rounded-lg bg-sky-600 text-white text-sm disabled:opacity-40"
          onClick={async () => {
            try {
              await createOpenStackServerGroup({ name: name.trim(), policy })
              toast.success('Server group created')
              setName('')
              void load()
            } catch (e: unknown) {
              toast.error(formatUserError(e))
            }
          }}>
          Create
        </button>
      </div>
      <button type="button" onClick={() => void load()}
        className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg border border-slate-600 text-sm">
        <RefreshCw className="w-4 h-4" /> Refresh
      </button>
      {loading ? (
        <Loader2 className="w-8 h-8 animate-spin text-sky-400" />
      ) : (
        <ul className="rounded-xl border border-slate-700 divide-y divide-slate-800">
          {groups.map((g) => (
            <li key={g.id} className="px-4 py-3 flex flex-wrap justify-between gap-2 text-sm">
              <div>
                <Link to={`/openstack/server-groups/${g.id}`} className="font-mono text-slate-200 hover:text-sky-300 hover:underline">{g.name}</Link>
                <span className="ml-2 text-xs text-slate-500">{g.policy}</span>
                <span className="block text-xs text-slate-500 font-mono mt-0.5">{g.id}</span>
                {g.members.length > 0 && (
                  <span className="block text-xs text-slate-400 mt-1">{g.members.length} member(s)</span>
                )}
              </div>
              <button type="button" className={statusActionLinkClasses('error', 'text-xs self-start')}
                onClick={async () => {
                  if (!confirm(`Delete server group ${g.name}?`)) return
                  try {
                    await deleteOpenStackServerGroup(g.id)
                    toast.success('Deleted')
                    void load()
                  } catch (e: unknown) {
                    toast.error(formatUserError(e))
                  }
                }}>Delete</button>
            </li>
          ))}
          {groups.length === 0 && (
            <li className="px-4 py-6 text-center text-slate-500">No server groups in this project.</li>
          )}
        </ul>
      )}
      <OpenStackFooter />
    </PageLayout>
  )
}
