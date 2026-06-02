// Copyright (c) 2026 ZyvorAI Labs Private Limited. All rights reserved.
// Proprietary software — see LICENSE in the repository root.
// https://zyvor.dev · info@zyvor.dev

import { useEffect, useState, useCallback, useMemo } from 'react'
import { Link, useParams } from 'react-router'
import { Activity, ChevronLeft, RefreshCw } from 'lucide-react'
import { BuildStepTimeline } from '../components/BuildStepTimeline'
import { getJob, listJobs, JobDetail, JobSummary } from '../api/jobs'
import {
  computePackerJobTimeline,
  computeVirtImageBuildTimeline,
  computeVmCreateJobTimeline,
  GOLDEN_FORGE_TIMELINE_LABELS,
  VIRT_IMAGE_TIMELINE_LABELS,
  VM_CREATE_TIMELINE_LABELS,
} from '../utils/buildProgress'
import { useToastContext } from '../contexts/ToastContext'
import { formatUserError } from '../utils/apiError'
import PageLayout from '../components/PageLayout'
import { jobStatusTone, statusSurfaceClasses, statusToneClass } from '../utils/semanticColors'

function statusBadge(status: string) {
  return statusSurfaceClasses(jobStatusTone(status), 'px-2 py-0.5 rounded text-xs font-medium border')
}

export default function JobsPage() {
  const { jobId } = useParams<{ jobId?: string }>()
  const toast = useToastContext()
  const [jobs, setJobs] = useState<JobSummary[]>([])
  const [detail, setDetail] = useState<JobDetail | null>(null)
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)

  const selectedId = jobId || null

  const jobTimeline = useMemo(() => {
    if (!detail) return null
    if (detail.kind === 'packer_golden_build') {
      return {
        steps: GOLDEN_FORGE_TIMELINE_LABELS,
        variant: 'violet' as const,
        ...computePackerJobTimeline(detail.logs, detail.status),
      }
    }
    if (detail.kind === 'vm_create') {
      return {
        steps: VM_CREATE_TIMELINE_LABELS,
        variant: 'amber' as const,
        ...computeVmCreateJobTimeline(detail.logs, detail.status),
      }
    }
    return {
      steps: VIRT_IMAGE_TIMELINE_LABELS,
      variant: 'slate' as const,
      ...computeVirtImageBuildTimeline(detail.logs, detail.status),
    }
  }, [detail])

  const refreshList = useCallback(() => {
    return listJobs()
      .then((data) => {
        setJobs(data)
        setLoadError(null)
      })
      .catch((e: unknown) => {
        const msg = formatUserError(e)
        setLoadError(msg)
        toast.error(msg)
      })
  }, [toast])

  const refreshDetail = useCallback(() => {
    if (!selectedId) {
      setDetail(null)
      return
    }
    getJob(selectedId)
      .then(setDetail)
      .catch((e: unknown) => toast.error(formatUserError(e)))
  }, [selectedId, toast])

  useEffect(() => {
    setLoading(true)
    void refreshList().finally(() => setLoading(false))
  }, [refreshList])

  useEffect(() => {
    const t = window.setInterval(refreshList, 5000)
    return () => window.clearInterval(t)
  }, [refreshList])

  useEffect(() => {
    refreshDetail()
  }, [refreshDetail])

  useEffect(() => {
    if (!selectedId || !detail || detail.status !== 'running') return
    const t = window.setInterval(refreshDetail, 1200)
    return () => window.clearInterval(t)
  }, [selectedId, detail?.status, refreshDetail])

  return (
    <PageLayout
      className="mx-auto max-w-6xl px-4"
      title="Jobs"
      icon={<Activity className={`w-7 h-7 ${statusToneClass('warn')}`} />}
      subtitle={
        <>
          Monitor <strong className="text-slate-300">virt-image-build</strong>,{' '}
          <strong className="text-slate-300">Golden Forge</strong> (Packer qcow2), and{' '}
          <strong className="text-slate-300">Create VM</strong> progress after you navigate away. Logs update automatically while a job is running.
        </>
      }
      actions={
        <>
          <Link to="/" className="p-2 hover:bg-slate-700 rounded transition" aria-label="Dashboard" title="Back to dashboard">
            <ChevronLeft className="w-5 h-5" />
          </Link>
          <button
            type="button"
            onClick={() => {
              refreshList()
              refreshDetail()
            }}
            className="btn-secondary text-sm inline-flex items-center gap-1.5"
          >
            <RefreshCw className="w-4 h-4" aria-hidden />
            Refresh
          </button>
        </>
      }
      error={loadError}
      errorTitle="Could not load jobs"
      errorHints={['Confirm machina-daemon is running.', 'Jobs require a valid session with operator or admin role.']}
      onErrorRetry={() => void refreshList()}
    >
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="card p-4">
          <h2 className="text-lg font-semibold text-[var(--text-primary)] mb-3">Recent jobs</h2>
          {loading && jobs.length === 0 ? (
            <p className="text-slate-500 text-sm">Loading…</p>
          ) : jobs.length === 0 ? (
            <p className="text-slate-500 text-sm">
              No jobs yet. Start a disk build from <Link to="/disk-images" className={`${statusToneClass('warn')} hover:underline`}>Disk Images</Link>, Golden Forge from Create VM, or create a VM with streaming logs.
            </p>
          ) : (
            <ul className="space-y-2 max-h-[32rem] overflow-y-auto divide-y divide-slate-800/80">
              {jobs.map((j) => (
                <li key={j.id} className="pt-2 first:pt-0">
                  <Link
                    to={`/jobs/${encodeURIComponent(j.id)}`}
                    className={`block rounded-lg px-3 py-2 transition hover:bg-slate-800/80 ${
                      selectedId === j.id ? 'bg-slate-800 ring-1 ring-amber-500/40' : ''
                    }`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-mono text-xs text-slate-500 truncate">{j.id}</span>
                      <span className={`text-[10px] uppercase tracking-wide px-2 py-0.5 rounded ${statusBadge(j.status)}`}>
                        {j.status}
                      </span>
                    </div>
                    <div className="text-sm text-slate-200 mt-1">{j.title}</div>
                    <div className="text-[10px] text-slate-500 mt-0.5">
                      {j.kind.replace(/_/g, ' ')}
                      {j.vm_name ? ` · VM ${j.vm_name}` : ''}
                      {j.target_path ? ` · ${j.target_path}` : ''}
                    </div>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="card p-4 flex flex-col min-h-[20rem]">
          {!selectedId ? (
            <p className="text-slate-500 text-sm">Select a job from the list to view logs.</p>
          ) : !detail ? (
            <p className="text-slate-500 text-sm">Loading job…</p>
          ) : (
            <>
              <div className="flex flex-wrap items-start justify-between gap-2 mb-3">
                <div>
                  <h2 className="text-lg font-semibold text-slate-200">Job detail</h2>
                  <p className="font-mono text-xs text-slate-500 break-all mt-1">{detail.id}</p>
                </div>
                <span className={`text-[10px] uppercase tracking-wide px-2 py-1 rounded ${statusBadge(detail.status)}`}>
                  {detail.status}
                </span>
              </div>
              <p className="text-sm text-slate-300 mb-2">{detail.title}</p>
              {detail.error ? (
                <p className="text-sm text-rose-300 mb-2">{detail.error}</p>
              ) : null}
              {jobTimeline ? (
                <BuildStepTimeline
                  className="mb-3"
                  steps={jobTimeline.steps}
                  activeIndex={jobTimeline.activeIndex}
                  allComplete={jobTimeline.allComplete}
                  failed={jobTimeline.failed}
                  variant={jobTimeline.variant}
                />
              ) : null}
              <div className="flex-1 min-h-0 flex flex-col">
                <h3 className="text-xs font-medium text-slate-400 uppercase tracking-wide mb-1">Log</h3>
                <pre className="flex-1 text-[11px] leading-relaxed font-mono text-slate-300 bg-slate-950/80 border border-slate-800 rounded-lg p-3 overflow-auto max-h-[50vh] whitespace-pre-wrap break-words">
                  {detail.logs.length ? detail.logs.join('\n') : '(no log lines yet)'}
                </pre>
              </div>
            </>
          )}
        </div>
      </div>
    </PageLayout>
  )
}
