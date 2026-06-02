// Copyright (c) 2026 ZyvorAI Labs Private Limited. All rights reserved.

import { useCallback, useEffect, useState } from 'react'
import { Code2, Package, Terminal } from 'lucide-react'
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
import { formatUserError } from '../../utils/apiError'
import CopyButton from '../../components/CopyButton'
import { hubLinkClasses } from '../../utils/semanticColors'

type DevTab = 'sdk' | 'console'

export default function PlatformDeveloper() {
  const [tab, setTab] = useState<DevTab>('sdk')
  const [overview, setOverview] = useState<DeveloperOverview | null>(null)
  const [schemas, setSchemas] = useState<TerraformResourceSchema[]>([])
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    setError(null)
    try {
      const [o, s] = await Promise.all([getDeveloperOverview(), getTerraformSchema()])
      setOverview(o)
      setSchemas(s)
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
            <MacStatWidget label="Terraform resources" value={String(overview.terraform.resources.length)} icon={<Code2 className="w-4 h-4" />} />
            <MacStatWidget label="OpenAPI" value="v1" icon={<Terminal className="w-4 h-4" />} />
          </div>
          <MacGlassPanel title="TypeScript SDK">
            <p className="text-sm text-slate-300 mb-2">Path: <code className="text-blue-300">{overview.sdk_typescript.path}</code></p>
            <div className="flex items-start gap-2">
              <pre className="text-xs bg-slate-950/80 rounded-lg p-3 overflow-x-auto text-slate-300 flex-1">{overview.sdk_typescript.install}</pre>
              <CopyButton text={overview.sdk_typescript.install} label="Copy install" />
            </div>
            <ul className="mt-3 flex flex-wrap gap-2">
              {overview.sdk_typescript.resources.map((r) => (
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
              <table className="w-full text-sm text-left">
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
        </>
      ) : null}
    </PlatformPageChrome>
  )
}
