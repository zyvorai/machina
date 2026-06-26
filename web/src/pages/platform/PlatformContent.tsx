// Copyright (c) 2026 ZyvorAI Labs Private Limited. All rights reserved.

import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router'
import { Check, Disc, Plus, RefreshCw, ShieldAlert, ShieldCheck, X } from 'lucide-react'
import ConfirmDialog from '../../components/ConfirmDialog'
import PlatformEmptyState from '../../components/platform/PlatformEmptyState'
import PlatformFilterPills from '../../components/platform/PlatformFilterPills'
import PlatformPageChrome, { PlatformBackLink, PlatformRefreshButton } from '../../components/platform/PlatformPageChrome'
import { MacSheet, MacStatWidget, gradientForName } from '../../components/platform/mac/PlatformMacUi'
import {
  approveContentImage,
  createContentImage,
  listContentImages,
  rejectContentImage,
  type ContentImage,
} from '../../api/platform'
import { useToastContext } from '../../contexts/ToastContext'
import { formatUserError } from '../../utils/apiError'
import { hubLinkClasses, statusBadgeClasses, statusSurfaceClasses, statusToneClass } from '../../utils/semanticColors'

const CATEGORIES = [
  'Operating Systems',
  'Ubuntu',
  'Debian',
  'Rocky Linux',
  'Windows Server',
  'Custom Appliances',
] as const

function guessCategory(name: string): string {
  const n = name.toLowerCase()
  if (n.includes('ubuntu')) return 'Ubuntu'
  if (n.includes('debian')) return 'Debian'
  if (n.includes('rocky') || n.includes('alma') || n.includes('rhel')) return 'Rocky Linux'
  if (n.includes('windows')) return 'Windows Server'
  return 'Custom Appliances'
}

function lifecycleBadge(status: string) {
  if (status === 'available') return { label: 'Approved', tone: statusToneClass('ok'), icon: ShieldCheck }
  if (status === 'pending') return { label: 'Pending approval', tone: statusToneClass('warn'), icon: ShieldAlert }
  if (status === 'rejected') return { label: 'Rejected', tone: statusToneClass('error'), icon: ShieldAlert }
  return { label: status, tone: statusToneClass('neutral'), icon: ShieldAlert }
}

export default function PlatformContent() {
  const toast = useToastContext()
  const [rows, setRows] = useState<ContentImage[]>([])
  const [error, setError] = useState<string | null>(null)
  const [category, setCategory] = useState<string>('Operating Systems')
  const [filter, setFilter] = useState<'all' | 'pending' | 'available'>('all')
  const [name, setName] = useState('ubuntu-24.04.iso')
  const [path, setPath] = useState('/var/lib/libvirt/images/ubuntu-24.04.iso')
  const [description, setDescription] = useState('')
  const [sheetOpen, setSheetOpen] = useState(false)
  const [rejectTargetId, setRejectTargetId] = useState<string | null>(null)

  const load = useCallback(async () => {
    setError(null)
    try {
      setRows(await listContentImages())
    } catch (e: unknown) {
      setError(formatUserError(e))
    }
  }, [])

  useEffect(() => { void load() }, [load])

  const pending = useMemo(() => rows.filter((r) => r.status === 'pending'), [rows])

  const filtered = useMemo(() => {
    let list = rows
    if (filter === 'pending') list = list.filter((r) => r.status === 'pending')
    if (filter === 'available') list = list.filter((r) => r.status === 'available')
    if (category === 'Operating Systems') return list
    return list.filter((r) => (r.category ?? guessCategory(r.name)) === category)
  }, [rows, category, filter])

  const add = async () => {
    try {
      await createContentImage({
        name,
        kind: 'iso',
        path,
        category: guessCategory(name),
        description: description || undefined,
      })
      toast.success('ISO submitted for approval')
      await load()
    } catch (e: unknown) {
      toast.error(formatUserError(e))
    }
  }

  const approve = async (id: string) => {
    try {
      await approveContentImage(id)
      toast.success('ISO approved for production use')
      await load()
    } catch (e: unknown) {
      toast.error(formatUserError(e))
    }
  }

  const reject = async (id: string) => {
    try {
      await rejectContentImage(id)
      toast.success('ISO rejected')
      await load()
    } catch (e: unknown) {
      toast.error(formatUserError(e))
    } finally {
      setRejectTargetId(null)
    }
  }

  return (
    <PlatformPageChrome
      error={error}
      onErrorRetry={() => void load()}
      prepend={<PlatformBackLink to="/platform/infrastructure" label="Infrastructure" />}
      title="Content Library"
      subtitle="ISO grid with approval inbox — upload golden images for templates."
      icon={<Disc className="w-6 h-6 text-slate-400" />}
      actions={
        <>
          {pending.length > 0 && (
            <span className={`px-2 py-1 rounded-full text-xs border ${statusBadgeClasses('warn')}`}>{pending.length} pending</span>
          )}
          <PlatformRefreshButton onClick={() => void load()} />
          <Link to="/platform/create-iso" className="btn-secondary flex items-center gap-2 text-sm">
            <Disc className="w-4 h-4" /> Create from ISO
          </Link>
          <button type="button" className="btn-primary flex items-center gap-2" onClick={() => setSheetOpen(true)}><Plus className="w-4 h-4" /> Upload</button>
        </>
      }
      contentClassName="space-y-4"
    >

      {pending.length > 0 && (
        <section className={`card p-4 ${statusSurfaceClasses('warn')}`}>
          <h2 className={`text-sm font-semibold mb-3 ${statusToneClass('warn')}`}>Approval queue ({pending.length})</h2>
          <div className="space-y-2">
            {pending.map((r) => (
              <div key={r.id} className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-800 bg-slate-900/60 px-4 py-3">
                <div>
                  <p className="font-medium">{r.name}</p>
                  <p className="text-xs text-slate-500 font-mono truncate max-w-md">{r.path}</p>
                  {r.submitted_by && <p className="text-[10px] text-slate-600 mt-1">Submitted by {r.submitted_by}</p>}
                </div>
                <div className="flex gap-2">
                  <button type="button" className="btn-primary text-xs flex items-center gap-1" onClick={() => void approve(r.id)}>
                    <Check className="w-3 h-3" /> Approve
                  </button>
                  <button type="button" className="btn-danger text-xs flex items-center gap-1" onClick={() => setRejectTargetId(r.id)}>
                    <X className="w-3 h-3" /> Reject
                  </button>
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      <div className="grid gap-3 sm:grid-cols-3">
        <MacStatWidget label="Images" value={String(rows.length)} icon={<Disc className="w-4 h-4" />} />
        <MacStatWidget label="Pending" value={String(pending.length)} tone={pending.length ? 'warn' : 'ok'} icon={<ShieldAlert className="w-4 h-4" />} />
        <MacStatWidget label="Approved" value={String(rows.filter((r) => r.status === 'available').length)} tone="ok" icon={<ShieldCheck className="w-4 h-4" />} />
      </div>

      <PlatformFilterPills
        value={filter}
        onChange={(id) => setFilter(id as typeof filter)}
        options={[
          { id: 'all', label: 'All' },
          { id: 'pending', label: 'Pending', count: pending.length },
          { id: 'available', label: 'Approved' },
        ]}
      />

      <div className="flex flex-wrap gap-2">
        {CATEGORIES.map((c) => (
          <button
            key={c}
            type="button"
            onClick={() => setCategory(c)}
            className={`px-3 py-1.5 rounded-full text-xs ${category === c ? 'bg-slate-700 text-white' : 'bg-slate-900 text-slate-400 border border-slate-800'}`}
          >
            {c}
          </button>
        ))}
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {filtered.map((r) => {
          const badge = lifecycleBadge(r.status)
          const BadgeIcon = badge.icon
          return (
            <article key={r.id} className="platform-mac-stat rounded-2xl border border-white/[0.06] bg-slate-900/50 p-5">
              <div className="flex items-start gap-3">
                <div className={`w-10 h-10 rounded-xl bg-gradient-to-br ${gradientForName(r.name)} flex items-center justify-center`}>
                  <Disc className="w-5 h-5 text-white" />
                </div>
                <div className="min-w-0 flex-1">
                  <h3 className="font-semibold truncate">{r.name}</h3>
                  <span className={`text-[10px] flex items-center gap-1 ${badge.tone}`}>
                    <BadgeIcon className="w-3 h-3" /> {badge.label}
                  </span>
                </div>
              </div>
              <p className="text-xs text-slate-500 mt-1">
                {r.kind.toUpperCase()} · {r.category ?? guessCategory(r.name)}
              </p>
              {r.description && <p className="text-xs text-slate-400 mt-2">{r.description}</p>}
              <p className="text-xs font-mono text-slate-600 mt-2 truncate">{r.path}</p>
              <p className="text-[10px] text-slate-600 mt-3">
                {r.status === 'available'
                  ? 'Approved — safe for production VM creation.'
                  : r.status === 'pending'
                    ? 'Awaiting administrator approval.'
                    : r.rejected_reason ?? 'Not approved for production use.'}
              </p>
              {r.status === 'pending' && (
                <div className="flex gap-2 mt-3">
                  <button type="button" className="btn-primary text-xs" onClick={() => void approve(r.id)}>Approve</button>
                  <button type="button" className="btn-danger text-xs" onClick={() => setRejectTargetId(r.id)}>Reject</button>
                </div>
              )}
              {r.status === 'available' && r.kind === 'iso' && (
                <Link
                  to={`/platform/create-iso?iso_path=${encodeURIComponent(r.path)}`}
                  className={`btn-secondary text-xs mt-3 inline-block text-center w-full ${hubLinkClasses()}`}
                >
                  Create VM from ISO
                </Link>
              )}
            </article>
          )
        })}
      </div>
      {filtered.length === 0 && (
        <PlatformEmptyState title="No images" subtitle="Upload an ISO or qcow2 path for administrator approval." />
      )}

      <MacSheet open={sheetOpen} onClose={() => setSheetOpen(false)} title="Submit image" subtitle="Path must exist on a hypervisor — approval required for production.">
        <div className="space-y-3">
          <input className="input w-full" aria-label="Image name" placeholder="name" value={name} onChange={(e) => setName(e.target.value)} />
          <input className="input w-full" aria-label="Host path" placeholder="host path" value={path} onChange={(e) => setPath(e.target.value)} />
          <input className="input w-full" aria-label="Description" placeholder="description (optional)" value={description} onChange={(e) => setDescription(e.target.value)} />
          <button type="button" className="btn-primary w-full" onClick={async () => { await add(); setSheetOpen(false) }}>Submit for approval</button>
        </div>
      </MacSheet>
      <ConfirmDialog
        open={rejectTargetId !== null}
        title="Reject ISO"
        message={`Reject "${rows.find((r) => r.id === rejectTargetId)?.name}"? It will not be available for VM creation.`}
        confirmLabel="Reject"
        variant="danger"
        onCancel={() => setRejectTargetId(null)}
        onConfirm={() => { if (rejectTargetId) void reject(rejectTargetId) }}
      />
    </PlatformPageChrome>
  )
}
