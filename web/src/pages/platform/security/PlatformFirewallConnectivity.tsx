// Copyright (c) 2026 ZyvorAI Labs Private Limited. All rights reserved.

import { useState } from 'react'
import { Link } from 'react-router'
import { MacGlassPanel, MacListRow, MacSectionTitle } from '../../../components/platform/mac/PlatformMacUi'
import PageLayout from '../../../components/PageLayout'
import { simulateConnectivity } from '../../../api/zeusFirewall'
import { formatUserError } from '../../../utils/apiError'
import { hubLinkClasses, statusSurfaceClasses, statusToneClass } from '../../../utils/semanticColors'

type Cell = { source: string; destination: string; port: number; protocol: string; verdict: string; reason: string }

export default function PlatformFirewallConnectivity() {
  const [targetId, setTargetId] = useState('local')
  const [profile, setProfile] = useState('ProductionServer')
  const [allows, setAllows] = useState<Cell[]>([])
  const [blocks, setBlocks] = useState<Cell[]>([])
  const [warnings, setWarnings] = useState<string[]>([])
  const [summary, setSummary] = useState('')
  const [error, setError] = useState<string | null>(null)

  const run = () => {
    void simulateConnectivity(targetId, profile).then((m) => {
      setAllows((m.allows as Cell[]) ?? [])
      setBlocks((m.blocks as Cell[]) ?? [])
      setWarnings((m.warnings as string[]) ?? [])
      setSummary(String(m.summary ?? ''))
    }).catch((e: unknown) => setError(formatUserError(e)))
  }

  return (
    <PageLayout hideHeader error={error}>
      <MacSectionTitle title="Connectivity Matrix" subtitle="Simulate paths before applying a profile" />
      <Link to="/platform/zeus/security/firewall" className={`text-sm ${hubLinkClasses()}`}>← Firewall overview</Link>
      <MacGlassPanel title="Simulation">
        <div className="flex flex-wrap gap-2 mb-4 max-w-xl">
          <input className="input text-sm flex-1 min-w-[8rem]" value={targetId} onChange={(e) => setTargetId(e.target.value)} placeholder="host id or local" />
          <input className="input text-sm flex-1 min-w-[8rem]" value={profile} onChange={(e) => setProfile(e.target.value)} placeholder="profile" />
          <button type="button" className="btn-primary text-sm" onClick={run}>Simulate</button>
        </div>
        {summary && <p className="text-sm text-slate-400 mb-4">{summary}</p>}
        {warnings.length > 0 && (
          <div className={`mb-4 p-3 rounded-xl ${statusSurfaceClasses('warn')}`}>
            {warnings.map((w) => (
              <p key={w} className="text-sm">{w}</p>
            ))}
          </div>
        )}
        <div className="grid md:grid-cols-2 gap-4">
          <div>
            <p className={`text-xs font-semibold uppercase mb-2 ${statusToneClass('ok')}`}>Allowed</p>
            <div className="rounded-xl border border-white/[0.06] overflow-hidden">
              {allows.length === 0 ? (
                <p className="px-4 py-3 text-sm text-slate-500">Run simulation</p>
              ) : (
                allows.map((c, i) => (
                  <MacListRow
                    key={`a-${i}`}
                    title={`${c.source} → ${c.destination}:${c.port}`}
                    subtitle={c.reason}
                  />
                ))
              )}
            </div>
          </div>
          <div>
            <p className={`text-xs font-semibold uppercase mb-2 ${statusToneClass('error')}`}>Blocked</p>
            <div className="rounded-xl border border-white/[0.06] overflow-hidden">
              {blocks.length === 0 ? (
                <p className="px-4 py-3 text-sm text-slate-500">Run simulation</p>
              ) : (
                blocks.map((c, i) => (
                  <MacListRow
                    key={`b-${i}`}
                    title={`${c.source} → ${c.destination}:${c.port}`}
                    subtitle={c.reason}
                  />
                ))
              )}
            </div>
          </div>
        </div>
      </MacGlassPanel>
    </PageLayout>
  )
}
