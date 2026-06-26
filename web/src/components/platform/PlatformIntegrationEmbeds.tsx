// Copyright (c) 2026 ZyvorAI Labs Private Limited. All rights reserved.

import { Link } from 'react-router'
import { Cloud, Container, Loader2, RefreshCw } from 'lucide-react'
import { MacGlassPanel, MacListRow } from './mac/PlatformMacUi'
import { usePlatformInfo } from '../../contexts/PlatformInfoContext'
import { useIntegrationPreviewStats } from '../../hooks/useIntegrationPreviewStats'
import { statusToneClass } from '../../utils/semanticColors'

function PreviewStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-white/[0.06] bg-slate-950/40 px-3 py-2 text-center min-w-[4.5rem]">
      <p className="text-lg font-semibold text-slate-100">{value}</p>
      <p className="text-[10px] uppercase tracking-wide text-slate-500">{label}</p>
    </div>
  )
}

export default function PlatformIntegrationEmbeds() {
  const { info } = usePlatformInfo()
  const k8sEnabled = Boolean(info?.kubevirt?.exec_enabled)
  const {
    openstack,
    osStats,
    k8sStats,
    osLoading,
    k8sLoading,
    osError,
    k8sError,
    refreshOpenStack,
    refreshK8s,
  } = useIntegrationPreviewStats(k8sEnabled)

  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <MacGlassPanel title="OpenStack preview">
        <div className="flex items-start gap-3">
          <Cloud className="w-5 h-5 text-sky-400 shrink-0 mt-0.5" />
          <div className="min-w-0 flex-1 space-y-3">
            <p className="text-sm text-slate-300">
              {openstack.phase === 'live'
                ? 'Cloud operator shell is healthy — live inventory below.'
                : openstack.phase === 'needsWire'
                  ? 'OpenStack is enabled but needs wiring — run the wire script from Integrations.'
                  : openstack.phase === 'unreachable'
                    ? 'Configured but API unreachable — check clouds.yaml and Keystone.'
                    : 'Enable OpenStack in daemon config to unlock the operator shell.'}
            </p>
            {openstack.connectionHint && (
              <p className={`text-xs ${statusToneClass('warn')}`}>{openstack.connectionHint}</p>
            )}
            {openstack.phase === 'live' && (
              <div className="space-y-3">
                <div className="flex flex-wrap items-center gap-2">
                  {osLoading && !osStats ? (
                    <span className="inline-flex items-center gap-1.5 text-xs text-slate-500">
                      <Loader2 className="w-3.5 h-3.5 animate-spin" /> Loading cloud inventory…
                    </span>
                  ) : osStats ? (
                    <>
                      <PreviewStat label="Instances" value={String(osStats.instances)} />
                      <PreviewStat label="Networks" value={String(osStats.networks)} />
                      <PreviewStat label="Images" value={String(osStats.images)} />
                    </>
                  ) : osError ? (
                    <p className={`text-xs ${statusToneClass('error')}`}>{osError}</p>
                  ) : null}
                  <button
                    type="button"
                    className="tahoe-btn-ghost text-xs inline-flex items-center gap-1 ml-auto"
                    disabled={osLoading}
                    onClick={() => void refreshOpenStack()}
                  >
                    <RefreshCw className={`w-3 h-3 ${osLoading ? 'animate-spin' : ''}`} />
                    Refresh
                  </button>
                </div>
                {osStats?.preview.length ? (
                  <ul className="divide-y divide-white/[0.04] rounded-xl border border-white/[0.06] bg-slate-950/30">
                    {osStats.preview.map((inst) => (
                      <MacListRow
                        key={inst.id}
                        title={inst.name}
                        subtitle={`${inst.status ?? 'unknown'} · ${inst.id.slice(0, 8)}…`}
                        href={`/openstack/instances/${inst.id}`}
                      />
                    ))}
                  </ul>
                ) : openstack.computeLive && osStats && osStats.instances === 0 ? (
                  <p className="text-xs text-slate-500">No Nova instances in this project yet.</p>
                ) : null}
              </div>
            )}
            <div className="flex flex-wrap gap-2">
              <Link to="/openstack" className="tahoe-btn-ghost text-xs">Open overview</Link>
              {openstack.phase === 'live' && (
                <Link to="/openstack/instances" className="tahoe-btn-primary text-xs">Instances</Link>
              )}
            </div>
          </div>
        </div>
      </MacGlassPanel>

      <MacGlassPanel title="Kubernetes preview">
        <div className="flex items-start gap-3">
          <Container className="w-5 h-5 text-violet-400 shrink-0 mt-0.5" />
          <div className="min-w-0 flex-1 space-y-3">
            <p className="text-sm text-slate-300">
              {k8sEnabled
                ? 'KubeVirt and cluster workloads live in the K8s shell — inventory below when kubectl is reachable.'
                : 'Enable Kubernetes / KubeVirt in daemon config to unlock cluster operations.'}
            </p>
            {k8sEnabled && (
              <div className="space-y-3">
                <div className="flex flex-wrap items-center gap-2">
                  {k8sLoading && !k8sStats ? (
                    <span className="inline-flex items-center gap-1.5 text-xs text-slate-500">
                      <Loader2 className="w-3.5 h-3.5 animate-spin" /> Loading cluster overview…
                    </span>
                  ) : k8sStats ? (
                    <>
                      <PreviewStat label="Nodes" value={`${k8sStats.ready_nodes}/${k8sStats.nodes}`} />
                      <PreviewStat label="Pods" value={String(k8sStats.pods)} />
                      <PreviewStat label="Deploy" value={String(k8sStats.deployments)} />
                    </>
                  ) : k8sError ? (
                    <p className={`text-xs ${statusToneClass('warn')}`}>{k8sError}</p>
                  ) : null}
                  <button
                    type="button"
                    className="tahoe-btn-ghost text-xs inline-flex items-center gap-1 ml-auto"
                    disabled={k8sLoading}
                    onClick={() => void refreshK8s()}
                  >
                    <RefreshCw className={`w-3 h-3 ${k8sLoading ? 'animate-spin' : ''}`} />
                    Refresh
                  </button>
                </div>
                {k8sStats && (
                  <div className="flex flex-wrap gap-2">
                    <PreviewStat label="Distribution" value={k8sStats.distribution ?? 'unknown'} />
                    <PreviewStat label="Version" value={k8sStats.version || '—'} />
                  </div>
                )}
              </div>
            )}
            <div className="flex flex-wrap gap-2">
              <Link to="/k8s" className="tahoe-btn-ghost text-xs">Cluster overview</Link>
              {k8sEnabled && <Link to="/k8s/workloads" className="tahoe-btn-primary text-xs">Workloads</Link>}
            </div>
          </div>
        </div>
      </MacGlassPanel>
    </div>
  )
}
