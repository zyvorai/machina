// Copyright (c) 2026 ZyvorAI Labs Private Limited. All rights reserved.

import { useCallback, useEffect, useState } from 'react'
import { Gauge, Loader2, Pencil, RefreshCw } from 'lucide-react'
import { getOpenStackQuotas, updateOpenStackQuotas } from '../api/openstackExtras'
import { parseQuotaRows, parseNeutronQuotaRows, type QuotaRow } from '../utils/openstackQuotas'
import { formatUserError } from '../utils/apiError'
import { useToastContext } from '../contexts/ToastContext'
import { statusToneClass } from '../utils/semanticColors'

type Props = {
  compact?: boolean
}

function QuotaTable({
  title,
  rows,
  onEdit,
}: {
  title: string
  rows: QuotaRow[]
  onEdit?: (row: QuotaRow) => void
}) {
  if (rows.length === 0) return null
  return (
    <div>
      <h3 className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-2">{title}</h3>
      <div className="overflow-x-auto rounded-lg border border-slate-800">
        <table className="w-full text-sm" aria-label={title}>
          <thead className="bg-slate-900/80 text-slate-400 text-left">
            <tr>
              <th className="px-3 py-2">Resource</th>
              <th className="px-3 py-2">Used</th>
              <th className="px-3 py-2">Limit</th>
              {onEdit && <th className="px-3 py-2 w-10" />}
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-800">
            {rows.map((r) => (
              <tr key={`${r.service}-${r.key ?? r.label}`}>
                <td className="px-3 py-2 text-slate-300">{r.label}</td>
                <td className="px-3 py-2 font-mono text-slate-400">{r.used}</td>
                <td className="px-3 py-2 font-mono text-slate-400">
                  {r.max >= 0 ? r.max : '—'}
                </td>
                {onEdit && (
                  <td className="px-3 py-2">
                    {r.key && r.service && r.max >= 0 && (
                      <button type="button" title="Edit limit" aria-label="Edit limit" className="p-1 rounded hover:bg-slate-800 text-slate-500 hover:text-sky-400"
                        onClick={() => onEdit(r)}>
                        <Pencil className="w-3.5 h-3.5" />
                      </button>
                    )}
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

export default function OpenStackQuotasPanel({ compact }: Props) {
  const toast = useToastContext()
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [computeRows, setComputeRows] = useState<QuotaRow[]>([])
  const [cinderRows, setCinderRows] = useState<QuotaRow[]>([])
  const [neutronRows, setNeutronRows] = useState<QuotaRow[]>([])

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const { quotas } = await getOpenStackQuotas()
      setComputeRows(parseQuotaRows(quotas.compute, 'compute'))
      setCinderRows(quotas.cinder ? parseQuotaRows(quotas.cinder, 'cinder') : [])
      setNeutronRows(quotas.neutron ? parseNeutronQuotaRows(quotas.neutron) : [])
    } catch (e: unknown) {
      setError(formatUserError(e))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const editLimit = async (row: QuotaRow) => {
    if (!row.key || !row.service) return
    const raw = prompt(`New limit for ${row.label}`, String(row.max))
    if (raw === null) return
    const limit = Number(raw.trim())
    if (!Number.isFinite(limit) || limit < 0) {
      toast.error('Enter a non-negative number')
      return
    }
    try {
      await updateOpenStackQuotas({
        service: row.service,
        quotas: { [row.key]: limit },
      })
      toast.success(`Updated ${row.label} limit`)
      void load()
    } catch (e: unknown) {
      toast.error(formatUserError(e))
    }
  }

  return (
    <section
      className={`rounded-xl border border-slate-700/50 bg-slate-800/30 ${
        compact ? 'p-4' : 'p-5'
      }`}
    >
      <div className="flex items-center justify-between gap-3 mb-3">
        <h2 className="text-sm font-semibold text-slate-300 uppercase tracking-wide flex items-center gap-2">
          <Gauge className="w-4 h-4 text-sky-400" />
          Project quotas
        </h2>
        <button
          type="button"
          onClick={() => void load()}
          disabled={loading}
          className="inline-flex items-center gap-1 px-2 py-1 rounded border border-slate-600 text-xs text-slate-400 hover:bg-slate-800"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
          Refresh
        </button>
      </div>
      <p className="text-xs text-slate-500 mb-3">Requires admin role on the cloud. Click the pencil to edit a limit.</p>
      {loading && (
        <div role="status" className="flex items-center gap-2 text-sm text-slate-500 py-4">
          <Loader2 className="w-4 h-4 animate-spin text-sky-400" aria-hidden="true" />
          Loading quotas…
        </div>
      )}
      {error && !loading && (
        <p className={`text-sm ${statusToneClass('error')}`}>{error}</p>
      )}
      {!loading && !error && computeRows.length === 0 && cinderRows.length === 0 && neutronRows.length === 0 && (
        <p className="text-sm text-slate-500">No quota data returned.</p>
      )}
      {!loading && !error && (computeRows.length > 0 || cinderRows.length > 0 || neutronRows.length > 0) && (
        <div className={compact ? 'space-y-4' : 'grid gap-6 lg:grid-cols-3'}>
          <QuotaTable title="Nova" rows={computeRows} onEdit={editLimit} />
          <QuotaTable title="Cinder" rows={cinderRows} onEdit={editLimit} />
          <QuotaTable title="Neutron" rows={neutronRows} onEdit={editLimit} />
        </div>
      )}
    </section>
  )
}
