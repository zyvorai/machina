// Copyright 2026 Zyvor AI Labs · https://zyvor.dev
// SPDX-License-Identifier: LicenseRef-Zyvor-Production-1.0

import { useEffect, useState } from 'react'
import { Link } from 'react-router'
import { ArrowLeft, CheckCircle2, GitBranch, Radar, XCircle } from 'lucide-react'
import { installK8sTetragon, getK8sExportStatus, type K8sExportForwarderStatus } from '../../../api/zeusSecurity'
import ConfirmDialog from '../../../components/ConfirmDialog'
import { MacGlassPanel, MacSheet } from '../../../components/platform/mac/PlatformMacUi'
import PageLayout from '../../../components/PageLayout'
import CopyButton from '../../../components/CopyButton'
import TerminalFrame from '../../../components/TerminalFrame'
import { renderHighlightedYaml } from '../../../utils/terminalHighlight'
import { getK8sFirewallStatus, planK8sFirewall, applyK8sFirewall } from '../../../api/zeusFirewall'
import { formatUserError } from '../../../utils/apiError'
import {hostStateTone, httpStatusTone, migrationReadinessTone, riskTone, statusBadgeClasses, statusPillClasses, statusSurfaceClasses, statusToneClass, taskStatusTone, webhookDeliveryTone, hubLinkClasses} from '../../../utils/semanticColors'
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
  const [clusterId, setClusterId] = useState('k3s')
  const [exportNs, setExportNs] = useState('kube-system')
  const [exportStatus, setExportStatus] = useState<K8sExportForwarderStatus | null>(null)
  const [tetragonBusy, setTetragonBusy] = useState(false)
  const [confirmApply, setConfirmApply] = useState(false)

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
      icon={<GitBranch className="w-6 h-6 text-[var(--text-muted)]" />}
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
            <p className="text-sm text-[var(--text-primary)]">{ready ? 'kubectl reachable' : 'Cluster not ready'}</p>
            <p className="text-xs text-[var(--text-muted)]">Backend: {backend}</p>
          </div>
        </div>
      </MacGlassPanel>
      <MacGlassPanel title="PacketWolf Tetragon (cluster)" subtitle="Helm install + export forwarder readiness">
        <div className="space-y-3 max-w-lg text-sm">
          <label className="block text-xs text-[var(--text-muted)]">Cluster ID</label>
          <input aria-label="Cluster ID" className="input text-sm w-full font-mono" value={clusterId} onChange={(e) => setClusterId(e.target.value)} placeholder="k3s" />
          <label className="block text-xs text-[var(--text-muted)]">Export namespace</label>
          <input aria-label="Export namespace" className="input text-sm w-full font-mono" value={exportNs} onChange={(e) => setExportNs(e.target.value)} />
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              className="btn-secondary text-xs inline-flex items-center gap-1"
              disabled={tetragonBusy || !clusterId.trim()}
              onClick={() => {
                setTetragonBusy(true)
                void installK8sTetragon(clusterId.trim())
                  .then((r) => toast.success(r.summary || 'Tetragon install queued'))
                  .catch((e: unknown) => toast.error(formatUserError(e)))
                  .finally(() => setTetragonBusy(false))
              }}
            >
              <Radar className="w-3.5 h-3.5" /> Install Tetragon
            </button>
            <button
              type="button"
              className="btn-secondary text-xs"
              disabled={tetragonBusy || !clusterId.trim()}
              onClick={() => {
                setTetragonBusy(true)
                void getK8sExportStatus(clusterId.trim(), exportNs.trim() || 'kube-system')
                  .then(setExportStatus)
                  .catch((e: unknown) => {
                    setExportStatus(null)
                    toast.error(formatUserError(e))
                  })
                  .finally(() => setTetragonBusy(false))
              }}
            >
              Check export forwarder
            </button>
          </div>
          {exportStatus && (
            <div className={`rounded-lg border p-3 text-xs ${statusSurfaceClasses(exportStatus.forwarder_deployed ? 'ok' : 'warn')}`}>
              <p className="font-medium text-[var(--text-primary)]">
                {exportStatus.forwarder_deployed ? 'Forwarder deployed' : 'Forwarder not ready'}
                {' · '}
                {exportStatus.ready_replicas} ready replica(s)
              </p>
              <p className="text-[var(--text-muted)] mt-1">{exportStatus.message}</p>
              {exportStatus.export_url && (
                <p className="font-mono text-[var(--text-muted)] mt-1 truncate">{exportStatus.export_url}</p>
              )}
            </div>
          )}
        </div>
      </MacGlassPanel>
      <MacGlassPanel title="Apply profile to namespace">
        <div className="space-y-3 max-w-md">
          <label className="block text-xs text-[var(--text-muted)]">Namespace</label>
          <input aria-label="Namespace" className="input text-sm w-full" value={namespace} onChange={(e) => setNamespace(e.target.value)} />
          <label className="block text-xs text-[var(--text-muted)]">Profile</label>
          <input aria-label="Profile" className="input text-sm w-full" value={profile} onChange={(e) => setProfile(e.target.value)} />
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
            onClick={() => setConfirmApply(true)}
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
            <TerminalFrame label="manifest.yaml" maxHeight="max-h-[60vh]">{renderHighlightedYaml(manifestYaml)}</TerminalFrame>
          </div>
        ) : (
          <p className="text-sm text-[var(--text-muted)]">No manifests generated — choose a namespace and profile, then Preview manifests.</p>
        )}
      </MacSheet>
      <ConfirmDialog
        open={confirmApply}
        title="Apply NetworkPolicy"
        message={`Apply the "${profile}" firewall profile to namespace "${namespace}"? This changes live network policy for workloads in that namespace.`}
        confirmLabel="Apply"
        variant="danger"
        onCancel={() => setConfirmApply(false)}
        onConfirm={() => {
          setConfirmApply(false)
          void applyK8sFirewall(namespace, profile, false).then((r) => {
            const n = r.operations?.length ?? 0
            toast.success(n > 0 ? `Applied to cluster · ${n} operation${n === 1 ? '' : 's'}` : 'Applied to cluster')
          }).catch((e: unknown) => toast.error(formatUserError(e)))
        }}
      />
    </PageLayout>
  )
}
