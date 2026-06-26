// Copyright (c) 2026 ZyvorAI Labs Private Limited. All rights reserved.
// Proprietary software — see LICENSE in the repository root.
// https://zyvor.dev · info@zyvor.dev

import { formatUserError } from '../utils/apiError'
import { serviceStateTone, statusBgClass, statusToneClass } from '../utils/semanticColors'
import { libvirtErrorHints } from '../utils/libvirtHints'
import { useEffect, useState, useCallback } from 'react'
import { listServices, serviceAction, SystemdService } from '../api/extras'
import PageLayout from '../components/PageLayout'
import { useToastContext } from '../contexts/ToastContext'
import { Search, RefreshCw, Play, Square, RotateCcw, ToggleLeft, ToggleRight, X } from 'lucide-react'

export default function ServicesPage() {
  const toast = useToastContext()
  const [services, setServices] = useState<SystemdService[]>([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [filter, setFilter] = useState('')
  const [acting, setActing] = useState<string | null>(null)

  const load = useCallback(async () => {
    try {
      setLoading(true)
      setLoadError(null)
      const data = await listServices()
      setServices(data)
    } catch (e: unknown) {
      setLoadError(formatUserError(e))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  const handleAction = async (name: string, action: string) => {
    setActing(`${name}:${action}`)
    try {
      await serviceAction(name, action)
      const verb = action === 'start' ? 'Started' : action === 'stop' ? 'Stopped' : action === 'restart' ? 'Restarted' : action === 'enable' ? 'Enabled' : action === 'disable' ? 'Disabled' : action === 'enable_now' ? 'Enabled and started' : 'Action applied'
      toast.success(`${verb}: ${name}`)
      setTimeout(load, 1000)
    } catch (e) {
      toast.error(formatUserError(e))
    } finally {
      setActing(null)
    }
  }

  const filtered = services.filter(s =>
    s.name.toLowerCase().includes(filter.toLowerCase()) ||
    s.description.toLowerCase().includes(filter.toLowerCase())
  )

  return (
    <PageLayout
      title="Systemd Services"
      subtitle={`${services.length} services total`}
      actions={
        <button onClick={load} className="p-2 hover:bg-slate-700 rounded-lg transition" title="Refresh" aria-label="Refresh">
          <RefreshCw className="w-4 h-4" />
        </button>
      }
      error={loadError}
      errorTitle="Could not load systemd services"
      errorHints={loadError ? libvirtErrorHints(loadError) : undefined}
      onErrorRetry={load}
    >
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" />
        <input
          type="text"
          aria-label="Filter services"
          placeholder="Filter services..."
          value={filter}
          onChange={e => setFilter(e.target.value)}
          className={`w-full pl-10 py-2.5 bg-slate-800/50 border border-slate-700/50 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/50 ${filter ? 'pr-8' : 'pr-4'}`}
        />
        {filter && (
          <button
            type="button"
            aria-label="Clear filter"
            onClick={() => setFilter('')}
            className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-200"
          >
            <X className="w-4 h-4" />
          </button>
        )}
      </div>

      {loading ? (
        <div className="flex items-center justify-center h-32" aria-busy="true" aria-label="Loading services">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-500" />
        </div>
      ) : (
        <div className="bg-slate-800/50 rounded-xl border border-slate-700/50 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm" aria-label="System services">
              <thead>
                <tr className="border-b border-slate-700/50 text-slate-400 text-xs uppercase tracking-wider">
                  <th className="text-left px-4 py-3">Service</th>
                  <th className="text-left px-4 py-3 hidden lg:table-cell">Description</th>
                  <th className="text-center px-4 py-3">Active</th>
                  <th className="text-center px-4 py-3">Sub State</th>
                  <th className="text-center px-4 py-3">Enabled</th>
                  <th className="text-center px-4 py-3">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-700/30">
                {filtered.map(svc => (
                  <tr key={svc.name} className="table-row-hover">
                    <td className="px-4 py-3 font-medium text-white">{svc.name}</td>
                    <td className="px-4 py-3 text-slate-400 hidden lg:table-cell max-w-xs truncate">{svc.description}</td>
                    <td className="px-4 py-3 text-center">
                      <span className="inline-flex items-center gap-1.5">
                        <span className={`w-2 h-2 rounded-full ${statusBgClass(serviceStateTone(svc.active_state))}`} />
                        <span className={statusToneClass(serviceStateTone(svc.active_state))}>
                          {svc.active_state}
                        </span>
                      </span>
                    </td>
                    <td className="px-4 py-3 text-center text-slate-400">{svc.sub_state}</td>
                    <td className="px-4 py-3 text-center">
                      <button
                        onClick={() => handleAction(svc.name, svc.enabled === 'enabled' ? 'disable' : 'enable')}
                        disabled={acting === `${svc.name}:enable` || acting === `${svc.name}:disable`}
                        className="inline-flex items-center gap-1 text-xs hover:opacity-80 transition"
                        title={svc.enabled === 'enabled' ? 'Click to disable' : 'Click to enable'}
                      >
                        {svc.enabled === 'enabled' ? (
                          <ToggleRight className={`w-5 h-5 ${statusToneClass('ok')}`} />
                        ) : (
                          <ToggleLeft className="w-5 h-5 text-slate-500" />
                        )}
                        <span className={statusToneClass(svc.enabled === 'enabled' ? 'ok' : 'neutral')}>{svc.enabled || 'n/a'}</span>
                      </button>
                    </td>
                    <td className="px-4 py-3 text-center">
                      <div className="flex items-center justify-center gap-1">
                        <button
                          onClick={() => handleAction(svc.name, 'start')}
                          disabled={acting !== null}
                          className={`p-1.5 hover:bg-green-500/20 rounded-lg transition ${statusToneClass('ok')}`}
                          title="Start"
                        >
                          <Play className="w-3.5 h-3.5" />
                        </button>
                        <button
                          onClick={() => handleAction(svc.name, 'stop')}
                          disabled={acting !== null}
                          className={`p-1.5 hover:bg-[color-mix(in_srgb,var(--machina-status-error)_25%,transparent)] rounded-lg transition ${statusToneClass('error')}`}
                          title="Stop"
                        >
                          <Square className="w-3.5 h-3.5" />
                        </button>
                        <button
                          onClick={() => handleAction(svc.name, 'restart')}
                          disabled={acting !== null}
                          className={`p-1.5 hover:bg-blue-500/20 rounded-lg transition ${statusToneClass('info')}`}
                          title="Restart"
                        >
                          <RotateCcw className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {filtered.length === 0 && (
            <div className="text-center text-slate-500 py-12">No services match your filter.</div>
          )}
        </div>
      )}
    </PageLayout>
  )
}
