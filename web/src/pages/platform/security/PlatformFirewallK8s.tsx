// Copyright (c) 2026 ZyvorAI Labs Private Limited. All rights reserved.

import { useEffect, useState } from 'react'
import { Link } from 'react-router'
import { ArrowLeft, CheckCircle2, GitBranch, XCircle } from 'lucide-react'
import { MacGlassPanel, MacSheet } from '../../../components/platform/mac/PlatformMacUi'
import PageLayout from '../../../components/PageLayout'
import CopyButton from '../../../components/CopyButton'
import { getK8sFirewallStatus, planK8sFirewall, applyK8sFirewall } from '../../../api/zeusFirewall'
import { formatUserError } from '../../../utils/apiError'
import {hostStateTone, httpStatusTone, migrationReadinessTone, riskTone, statusBadgeClasses, statusPillClasses, statusToneClass, taskStatusTone, webhookDeliveryTone, hubLinkClasses} from '../../../utils/semanticColors'
import { useToastContext } from '../../../contexts/ToastContext'

export default function PlatformFirewallK8s() {
  const toast = useToastContext()
  const [ready, setReady] = useState(false)
  const [backend, setBackend] = useState('unknown')
  const [namespace, setNamespace] = useState('default')
  const [profile, setProfile] = useState('ProductionServer')
  const [manifestYaml, setManifestYaml] = useState('')
  const [sheetOpen, setSheetOpen] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    getK8sFirewallStatus()
      .then((s) => {
        setReady(Boolean(s.ready))
        setBackend(String(s.backend ?? 'unknown'))
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
      title="Kubernetes Firewall"
      subtitle={`NetworkPolicy and Cilium · ${ready ? backend : 'cluster not ready'}`}
      icon={<GitBranch className="w-6 h-6 text-slate-400" />}
      contentClassName="space-y-4"
    >
      <MacGlassPanel title="Cluster">
        <div className="flex items-center gap-3">
          {ready ? (
            <CheckCircle2 className={`w-5 h-5 ${statusToneClass('ok')}`} />
          ) : (
            <XCircle className={`w-5 h-5 ${statusToneClass('warn')}`} />
          )}
          <div>
            <p className="text-sm text-slate-100">{ready ? 'kubectl reachable' : 'Cluster not ready'}</p>
            <p className="text-xs text-slate-500">Backend: {backend}</p>
          </div>
        </div>
      </MacGlassPanel>
      <MacGlassPanel title="Apply profile to namespace">
        <div className="space-y-3 max-w-md">
          <label className="block text-xs text-slate-500">Namespace</label>
          <input className="input text-sm w-full" value={namespace} onChange={(e) => setNamespace(e.target.value)} />
          <label className="block text-xs text-slate-500">Profile</label>
          <input className="input text-sm w-full" value={profile} onChange={(e) => setProfile(e.target.value)} />
          <button
            type="button"
            className="btn-primary text-sm"
            onClick={() => void planK8sFirewall(namespace, profile).then((r) => {
              const manifests = (r.manifests as Array<{ yaml: string; kind: string; name: string }>) ?? []
              setManifestYaml(manifests.map((m) => `# ${m.kind} ${m.name}\n${m.yaml}`).join('\n---\n'))
              setSheetOpen(true)
            }).catch((e: unknown) => setError(formatUserError(e)))}
          >
            Preview manifests
          </button>
          <button
            type="button"
            className="btn-secondary text-sm"
            disabled={!ready}
            onClick={() => void applyK8sFirewall(namespace, profile, false).then((r) => {
              toast.success(String(r.summary ?? 'Applied to cluster'))
            }).catch((e: unknown) => toast.error(formatUserError(e)))}
          >
            Apply to cluster
          </button>
        </div>
      </MacGlassPanel>
      <MacSheet open={sheetOpen} onClose={() => setSheetOpen(false)} title="Manifest preview" subtitle="Dry-run YAML" wide>
        {manifestYaml ? (
          <div className="space-y-2">
            <div className="flex justify-end">
              <CopyButton text={manifestYaml} label="Copy YAML" />
            </div>
            <pre className="text-xs text-slate-300 whitespace-pre-wrap font-mono max-h-[60vh] overflow-auto">{manifestYaml}</pre>
          </div>
        ) : (
          <p className="text-sm text-slate-500">No manifests generated — choose a namespace and profile, then Preview manifests.</p>
        )}
      </MacSheet>
    </PageLayout>
  )
}
