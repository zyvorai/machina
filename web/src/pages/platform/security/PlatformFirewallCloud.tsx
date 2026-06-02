// Copyright (c) 2026 ZyvorAI Labs Private Limited. All rights reserved.

import { useEffect, useState } from 'react'
import { Link } from 'react-router'
import { ArrowLeft, Cloud } from 'lucide-react'
import { MacGlassPanel, MacListRow, MacStatWidget } from '../../../components/platform/mac/PlatformMacUi'
import PageLayout from '../../../components/PageLayout'
import { getCloudFirewallOverview } from '../../../api/zeusFirewall'
import { formatUserError } from '../../../utils/apiError'
import { hubLinkClasses, statusSurfaceClasses, statusToneClass } from '../../../utils/semanticColors'

export default function PlatformFirewallCloud() {
  const [summary, setSummary] = useState('')
  const [provider, setProvider] = useState('unknown')
  const [reachable, setReachable] = useState(false)
  const [rules, setRules] = useState<Array<{ group_name: string; port_range: string; source: string; protocol: string }>>([])
  const [criticalPorts, setCriticalPorts] = useState(0)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    getCloudFirewallOverview()
      .then((r) => {
        const inv = r.inventory as {
          provider?: string
          reachable?: boolean
          summary?: string
          security_groups?: Array<{ group_name: string; port_range: string; source: string; protocol: string }>
          open_ports?: unknown[]
        }
        setProvider(String(inv.provider ?? 'unknown'))
        setReachable(Boolean(inv.reachable))
        setSummary(String(inv.summary ?? ''))
        setRules(inv.security_groups ?? [])
        setCriticalPorts(Array.isArray(inv.open_ports) ? inv.open_ports.length : 0)
      })
      .catch((e: unknown) => setError(formatUserError(e)))
  }, [])

  return (
    <PageLayout
      compact
      error={error}
      prepend={
        <Link to="/platform/zeus/security/firewall" className={`text-sm inline-flex items-center gap-1 ${hubLinkClasses()}`}>
          <ArrowLeft className="w-4 h-4" /> Firewall
        </Link>
      }
      title="Cloud Security Groups"
      subtitle={summary || 'AWS · Azure · GCP edge inventory'}
      icon={<Cloud className="w-6 h-6 text-slate-400" />}
      contentClassName="space-y-4"
    >
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <MacStatWidget label="Provider" value={provider} icon={<span className="text-lg">☁</span>} />
        <MacStatWidget label="Rules" value={String(rules.length)} icon={<span className="text-lg">#</span>} tone={reachable ? 'ok' : 'warn'} />
        <MacStatWidget label="Public exposure" value={String(criticalPorts)} icon={<span className="text-lg">!</span>} tone={criticalPorts > 0 ? 'warn' : 'ok'} />
      </div>
      {criticalPorts > 0 && (
        <MacGlassPanel title="Critical exposure" subtitle="0.0.0.0/0 on sensitive ports">
          <p className={`text-sm ${statusToneClass('warn')}`}>{criticalPorts} cloud rule(s) expose critical ports to the internet.</p>
        </MacGlassPanel>
      )}
      <MacGlassPanel title="Security groups" subtitle={summary || 'Configure cloud CLI on controller host'}>
        {rules.length === 0 ? (
          <p className="text-sm text-slate-500">No cloud security groups detected. Install and configure aws/az/gcloud CLI.</p>
        ) : (
          <div className="rounded-xl border border-white/[0.06] overflow-hidden max-h-96 overflow-y-auto">
            {rules.slice(0, 50).map((r, i) => (
              <MacListRow
                key={`${r.group_name}-${i}`}
                title={r.group_name}
                subtitle={`${r.protocol} ${r.port_range} ← ${r.source}`}
              />
            ))}
          </div>
        )}
      </MacGlassPanel>
    </PageLayout>
  )
}
