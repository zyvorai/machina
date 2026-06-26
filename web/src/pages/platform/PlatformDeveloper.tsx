// Copyright (c) 2026 ZyvorAI Labs Private Limited. All rights reserved.

import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router'
import { Code2, Package, Shield, Terminal, Wrench } from 'lucide-react'
import PlatformApiConsole from '../../components/platform/PlatformApiConsole'
import DetailTabs from '../../components/platform/DetailTabs'
import { MacGlassPanel, MacStatWidget } from '../../components/platform/mac/PlatformMacUi'
import PlatformPageChrome, { PlatformBackLink, PlatformRefreshButton } from '../../components/platform/PlatformPageChrome'
import {
  getDeveloperOverview,
  getTerraformSchema,
  type DeveloperOverview,
  type TerraformResourceSchema,
} from '../../api/platform'
import { getGuestkitDaemonStatus, type GuestkitStatus } from '../../api/guestkit'
import { getZeusFirewallDaemonStatus } from '../../api/zeusFirewall'
import { formatUserError } from '../../utils/apiError'
import CopyButton from '../../components/CopyButton'
import { hubLinkClasses } from '../../utils/semanticColors'

type DevTab = 'sdk' | 'console'

export default function PlatformDeveloper() {
  const [tab, setTab] = useState<DevTab>('sdk')
  const [overview, setOverview] = useState<DeveloperOverview | null>(null)
  const [schemas, setSchemas] = useState<TerraformResourceSchema[]>([])
  const [error, setError] = useState<string | null>(null)
  const [guestkitDaemon, setGuestkitDaemon] = useState<GuestkitStatus | null>(null)
  const [zeusDaemon, setZeusDaemon] = useState<Record<string, unknown> | null>(null)

  const load = useCallback(async () => {
    setError(null)
    try {
      const [o, s, gk, zf] = await Promise.all([
        getDeveloperOverview(),
        getTerraformSchema(),
        getGuestkitDaemonStatus().catch(() => null),
        getZeusFirewallDaemonStatus().catch(() => null),
      ])
      setOverview(o)
      setSchemas(s)
      setGuestkitDaemon(gk)
      setZeusDaemon(zf?.zeus_firewall ?? null)
    } catch (e: unknown) {
      setError(formatUserError(e))
    }
  }, [])

  useEffect(() => { void load() }, [load])

  return (
    <PlatformPageChrome
      error={error}
      onErrorRetry={() => void load()}
      prepend={<PlatformBackLink to="/platform/operations" label="Operations" />}
      title="Developer"
      subtitle="TypeScript SDK, OpenAPI console, and Terraform schemas."
      icon={<Code2 className="w-6 h-6 text-slate-400" />}
      actions={<PlatformRefreshButton onClick={() => void load()} />}
      contentClassName="space-y-4"
    >
      {(guestkitDaemon || zeusDaemon) && (
        <MacGlassPanel title="Daemon health" subtitle="Co-located machina-daemon services (GET /api/v1/guestkit/status, /zeus-firewall/status)">
          <div className="grid gap-3 sm:grid-cols-2">
            {guestkitDaemon && (
              <MacStatWidget
                label="GuestKit"
                value={guestkitDaemon.reachable ? 'Reachable' : 'Unreachable'}
                icon={<Wrench className="w-4 h-4" />}
                tone={guestkitDaemon.reachable ? 'ok' : 'warn'}
              />
            )}
            {zeusDaemon && (
              <MacStatWidget
                label="Zeus Firewall"
                value={zeusDaemon.enabled === false ? 'Disabled' : 'Active'}
                icon={<Shield className="w-4 h-4" />}
                tone={zeusDaemon.enabled === false ? 'warn' : 'ok'}
              />
            )}
          </div>
        </MacGlassPanel>
      )}
      <DetailTabs
        primary={[
          { id: 'sdk', label: 'SDK & Terraform' },
          { id: 'console', label: 'API Console' },
        ]}
        active={tab}
        onChange={setTab}
      />
      {tab === 'console' ? (
        <PlatformApiConsole />
      ) : overview ? (
        <>
          <p className="text-sm text-slate-400">{overview.summary}</p>
          <div className="grid gap-4 sm:grid-cols-3">
            <MacStatWidget label="SDK version" value={overview.sdk_typescript.version} icon={<Package className="w-4 h-4" />} />
            <MacStatWidget label="Terraform resources" value={String(overview.terraform.resources?.length ?? 0)} icon={<Code2 className="w-4 h-4" />} />
            <MacStatWidget label="OpenAPI" value="v1" icon={<Terminal className="w-4 h-4" />} />
          </div>
          <MacGlassPanel title="TypeScript SDK">
            <p className="text-sm text-slate-300 mb-2">Path: <code className="text-blue-300">{overview.sdk_typescript.path}</code></p>
            <div className="flex items-start gap-2">
              <pre className="text-xs bg-slate-950/80 rounded-lg p-3 overflow-x-auto text-slate-300 flex-1">{overview.sdk_typescript.install}</pre>
              <CopyButton text={overview.sdk_typescript.install} label="Copy install" />
            </div>
            <ul className="mt-3 flex flex-wrap gap-2">
              {(overview.sdk_typescript.resources ?? []).map((r) => (
                <li key={r} className="text-xs px-2 py-1 rounded bg-slate-800 text-slate-300">{r}</li>
              ))}
            </ul>
          </MacGlassPanel>
          <MacGlassPanel title="Terraform">
            <p className="text-sm text-slate-300 mb-2">
              Provider: <code className="text-blue-300">{overview.terraform.provider_source}</code>
              · Examples: <code className="text-blue-300">{overview.terraform.examples_path}</code>
            </p>
            <p className="text-sm text-slate-400 mb-3">
              OpenAPI spec: <a className={`hover:underline ${hubLinkClasses()}`} href={overview.openapi_url}>{overview.openapi_url}</a>
            </p>
            <div className="overflow-x-auto">
              <table className="w-full text-sm text-left" aria-label="API resources">
                <thead className="text-xs text-slate-500 border-b border-slate-700">
                  <tr>
                    <th className="py-2 pr-4">Resource</th>
                    <th className="py-2 pr-4">Kind</th>
                    <th className="py-2 pr-4">API</th>
                    <th className="py-2">Attributes</th>
                  </tr>
                </thead>
                <tbody>
                  {schemas.map((row) => (
                    <tr key={row.name} className="border-b border-slate-800/60">
                      <td className="py-2 pr-4 text-slate-200">{row.name}</td>
                      <td className="py-2 pr-4 text-slate-400">{row.kind}</td>
                      <td className="py-2 pr-4 text-slate-400 font-mono text-xs">{row.api_path}</td>
                      <td className="py-2 text-slate-500 text-xs">{row.attributes.join(', ')}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </MacGlassPanel>
          <MacGlassPanel title="Agent & metrics ingest" subtitle="Push endpoints for machina-agent, Prometheus, and security sensors">
            <p className="text-sm text-slate-400 mb-3 leading-relaxed">
              These routes are for agents and observability pipelines — not browser forms. Use the API Console tab to try authenticated POSTs, or copy the examples below into your agent install.
            </p>
            <div className="space-y-3">
              <div>
                <p className="text-xs text-slate-500 mb-1">Zeus security telemetry (controller)</p>
                <div className="flex items-start gap-2">
                  <pre className="text-xs bg-slate-950/80 rounded-lg p-3 overflow-x-auto text-slate-300 flex-1">{`POST /api/v1/zeus-security/ingest/{host_id}
Authorization: Bearer <controller-jwt-or-api-key>
Content-Type: application/json

{"events":[...]}`}</pre>
                  <CopyButton
                    text={`curl -sS -X POST "$CONTROLLER/api/v1/zeus-security/ingest/$HOST_ID" -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" -d '{"events":[]}'`}
                    label="Copy curl"
                  />
                </div>
              </div>
              <div>
                <p className="text-xs text-slate-500 mb-1">Prometheus remote-write (daemon)</p>
                <div className="flex items-start gap-2">
                  <pre className="text-xs bg-slate-950/80 rounded-lg p-3 overflow-x-auto text-slate-300 flex-1">{`POST /api/v1/metrics/ingest/remote-write
Authorization: Bearer <session-or-token>
Content-Type: application/x-protobuf`}</pre>
                  <CopyButton
                    text={`curl -sS -X POST "$DAEMON/api/v1/metrics/ingest/remote-write" -H "Authorization: Bearer $TOKEN" --data-binary @metrics.pb`}
                    label="Copy curl"
                  />
                </div>
              </div>
              <div>
                <p className="text-xs text-slate-500 mb-1">Prometheus text scrape ingest (daemon)</p>
                <div className="flex items-start gap-2">
                  <pre className="text-xs bg-slate-950/80 rounded-lg p-3 overflow-x-auto text-slate-300 flex-1">{`POST /api/v1/metrics/ingest/prometheus
Content-Type: text/plain`}</pre>
                  <CopyButton
                    text={`curl -sS -X POST "$DAEMON/api/v1/metrics/ingest/prometheus" -H "Authorization: Bearer $TOKEN" -H "Content-Type: text/plain" --data-binary @scrape.txt`}
                    label="Copy curl"
                  />
                </div>
              </div>
            </div>
            <p className="text-xs text-slate-500 mt-3">
              Configure remote-write auth in <Link to="/settings" className={hubLinkClasses()}>Settings → Observability</Link>.
              Security sensors enroll via <Link to="/platform/zeus/security" className={hubLinkClasses()}>Security Center</Link>.
            </p>
          </MacGlassPanel>
        </>
      ) : null}
    </PlatformPageChrome>
  )
}
