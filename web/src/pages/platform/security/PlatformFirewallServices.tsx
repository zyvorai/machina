// Copyright (c) 2026 ZyvorAI Labs Private Limited. All rights reserved.

import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router'
import { MacGlassPanel, MacSectionTitle } from '../../../components/platform/mac/PlatformMacUi'
import PageLayout from '../../../components/PageLayout'
import { getFirewallOverview, getFirewallServices, type AllowedService } from '../../../api/zeusFirewall'
import { formatUserError } from '../../../utils/apiError'
import { firewallRiskClass, formatAllowedFrom } from '../../../utils/firewallDisplay'
import { statusToneClass } from '../../../utils/semanticColors'

type ServiceRow = AllowedService & { target: string; targetId: string; key: string }

export default function PlatformFirewallServices() {
  const [services, setServices] = useState<ServiceRow[]>([])
  const [error, setError] = useState<string | null>(null)
  const [filter, setFilter] = useState('')

  const load = useCallback(async () => {
    setError(null)
    try {
      const ov = await getFirewallOverview()
      const all: ServiceRow[] = []
      const seen = new Set<string>()
      for (const t of ov.targets) {
        const list = await getFirewallServices(t.id)
        for (const svc of list) {
          const key = `${t.id}:${svc.protocol}:${svc.port}:${svc.name}`
          if (seen.has(key)) continue
          seen.add(key)
          all.push({ ...svc, target: t.name, targetId: t.id, key })
        }
      }
      all.sort((a, b) => {
        const ra = String(a.status).toLowerCase()
        const rb = String(b.status).toLowerCase()
        if (ra !== rb) return ra === 'critical' ? -1 : rb === 'critical' ? 1 : 0
        return a.name.localeCompare(b.name)
      })
      setServices(all)
    } catch (e: unknown) {
      setError(formatUserError(e))
    }
  }, [])

  useEffect(() => { void load() }, [load])

  const visible = useMemo(() => {
    const q = filter.trim().toLowerCase()
    if (!q) return services
    return services.filter(
      (s) =>
        s.name.toLowerCase().includes(q)
        || s.target.toLowerCase().includes(q)
        || String(s.port).includes(q)
        || s.protocol.toLowerCase().includes(q),
    )
  }, [services, filter])

  return (
    <PageLayout hideHeader error={error}>
      <MacSectionTitle title="Allowed Apps & Services" subtitle="Service-centric firewall view — deduplicated rules per host." />
      <Link to="/platform/zeus/security/firewall" className="text-sm text-sky-400 hover:underline">← Firewall overview</Link>
      <MacGlassPanel title="Allowed services">
        <div className="flex flex-wrap gap-2 mb-4">
          <input
            className="input text-sm max-w-xs"
            placeholder="Filter by name, port, or host…"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
          />
          <span className="text-sm text-slate-500 self-center">{visible.length} service(s)</span>
        </div>
        <div className="space-y-2">
          {visible.map((s) => (
            <article
              key={s.key}
              className="rounded-xl border border-white/[0.08] bg-slate-950/40 px-4 py-3 flex flex-wrap items-start justify-between gap-3"
            >
              <div className="min-w-0 flex-1">
                <p className="font-medium text-slate-100 text-[15px] leading-snug">{s.name}</p>
                <p className="text-[13px] text-slate-400 mt-1 leading-relaxed">
                  <span className="text-slate-300">{s.target}</span>
                  {' · '}
                  <span className="font-mono text-slate-300">{s.protocol}/{s.port}</span>
                </p>
                <p className="text-[13px] text-slate-500 mt-1">
                  Allowed from: <span className="text-slate-300">{formatAllowedFrom(s.allowed_from)}</span>
                </p>
                {s.recommendation && (
                  <p className={`text-[13px] mt-2 leading-relaxed ${statusToneClass('warn')}`}>{s.recommendation}</p>
                )}
              </div>
              <span className={`text-xs px-2.5 py-1 rounded-full border shrink-0 ${firewallRiskClass(String(s.status))}`}>
                {String(s.status)}
              </span>
            </article>
          ))}
          {visible.length === 0 && (
            <p className="text-sm text-slate-500 py-6 text-center">No services match this filter.</p>
          )}
        </div>
      </MacGlassPanel>
    </PageLayout>
  )
}
