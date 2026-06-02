// Copyright (c) 2026 ZyvorAI Labs Private Limited. All rights reserved.

import { useState } from 'react'
import { LifeBuoy, Download, RefreshCw } from 'lucide-react'
import PlatformPageChrome, { PlatformRefreshButton } from '../../components/platform/PlatformPageChrome'
import PlatformAboutHelp from '../../components/platform/PlatformAboutHelp'
import { getSupportBundle } from '../../api/platform'
import { useToastContext } from '../../contexts/ToastContext'
import { formatUserError } from '../../utils/apiError'
import JsonInspector from '../../components/platform/JsonInspector'
import { SupportBundleSummary } from '../../components/platform/FirewallComplianceViews'

const TIPS = [
  { q: 'VM won\'t start', a: 'Run a health check on the VM detail page. Check Tasks for failed vm.start operations.' },
  { q: 'Migration stuck', a: 'Open Tasks and look for vm.migrate. Verify destination host is online and libvirt is reachable.' },
  { q: 'Guest tools missing', a: 'Use Install tools on the VM overview tab, then install qemu-guest-agent inside the guest OS.' },
  { q: 'HyperSDK unreachable', a: 'Ensure hypervisord is running on :5080 and [hypersdk] is enabled in machina config.' },
]

export default function PlatformSupport({ embedded }: { embedded?: boolean } = {}) {
  const toast = useToastContext()
  const [bundle, setBundle] = useState<Record<string, unknown> | null>(null)
  const [loading, setLoading] = useState(false)

  const downloadBundle = async () => {
    setLoading(true)
    try {
      const data = await getSupportBundle()
      setBundle(data)
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `machina-support-${Date.now()}.json`
      a.click()
      URL.revokeObjectURL(url)
      toast.success('Support bundle downloaded')
    } catch (e: unknown) {
      toast.error(formatUserError(e))
    } finally {
      setLoading(false)
    }
  }

  return (
    <PlatformPageChrome
      hideHeader={embedded}
      compact={embedded}
      className={embedded ? 'max-w-none' : 'max-w-3xl'}
      title={embedded ? undefined : 'Support Assistant'}
      subtitle={embedded ? undefined : 'About Zyvor Platform, troubleshooting, and support bundle export.'}
      icon={embedded ? undefined : <LifeBuoy className="w-6 h-6 text-slate-400" />}
      contentClassName="space-y-4"
    >

      <PlatformAboutHelp />
      <div className="card p-5 flex flex-wrap gap-3 items-center justify-between">
        <div>
          <p className="font-medium">Export support bundle</p>
          <p className="text-xs text-slate-500 mt-1">Cluster summary, versions, and recent events for Zyvor support.</p>
        </div>
        <button type="button" className="btn-primary flex items-center gap-2" disabled={loading} onClick={() => void downloadBundle()}>
          {loading ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Download className="w-4 h-4" />}
          Download bundle
        </button>
      </div>
      {bundle && (
        <div className="card p-4 space-y-3">
          <p className="text-sm font-medium text-slate-200">Latest bundle summary</p>
          <SupportBundleSummary bundle={bundle} />
          <JsonInspector data={bundle} />
        </div>
      )}
      <section className="space-y-3">
        <h2 className="text-sm font-semibold text-slate-400">Common fixes</h2>
        {TIPS.map((t) => (
          <article key={t.q} className="card p-4">
            <p className="font-medium text-sm">{t.q}</p>
            <p className="text-xs text-slate-400 mt-1">{t.a}</p>
          </article>
        ))}
      </section>
    </PlatformPageChrome>
  )
}
