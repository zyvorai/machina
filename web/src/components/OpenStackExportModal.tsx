// Copyright (c) 2026 ZyvorAI Labs Private Limited. All rights reserved.
// Proprietary software — see LICENSE in the repository root.
// https://zyvor.dev · info@zyvor.dev

import { useState } from 'react'
import { Download, Loader2, X } from 'lucide-react'
import { Link } from 'react-router'
import { exportOpenStackInstance } from '../api/openstack'
import { useToastContext } from '../contexts/ToastContext'
import { formatUserError } from '../utils/apiError'

type Props = {
  open: boolean
  instanceId: string
  instanceName: string
  defaultDestDir?: string
  onClose: () => void
}

export default function OpenStackExportModal({
  open,
  instanceId,
  instanceName,
  defaultDestDir,
  onClose,
}: Props) {
  const toast = useToastContext()
  const [imageName, setImageName] = useState(`${instanceName}-export`)
  const [destPath, setDestPath] = useState('')
  const [autoPull, setAutoPull] = useState(true)
  const [waitActive, setWaitActive] = useState(true)
  const [busy, setBusy] = useState(false)
  const [pulledPath, setPulledPath] = useState<string | null>(null)

  if (!open) return null

  const suggested =
    `${defaultDestDir || '/var/lib/libvirt/images'}/${imageName.replace(/[^a-zA-Z0-9._-]+/g, '-')}.qcow2`

  const runExport = async () => {
    setBusy(true)
    setPulledPath(null)
    try {
      const plan = await exportOpenStackInstance(instanceId, {
        image_name: imageName.trim() || undefined,
        auto_pull: autoPull,
        dest_path: autoPull ? (destPath.trim() || suggested) : undefined,
        wait_for_active: waitActive,
      })
      if (plan.pull?.dest_path) {
        setPulledPath(plan.pull.dest_path)
        toast.success(`Exported to ${plan.pull.dest_path}`)
      } else {
        toast.success(`Snapshot started: ${plan.suggested_image_name}`)
      }
    } catch (e: unknown) {
      toast.error(formatUserError(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60" onClick={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Export instance"
        className="bg-slate-900 border border-slate-600 rounded-xl w-full max-w-lg p-5 space-y-4"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex justify-between items-center">
          <h2 className="text-lg font-semibold text-white flex items-center gap-2">
            <Download className="w-5 h-5 text-sky-400" />
            Export {instanceName}
          </h2>
          <button type="button" onClick={onClose} aria-label="Close" className="text-slate-400 hover:text-white">
            <X className="w-4 h-4" aria-hidden="true" />
          </button>
        </div>
        <p className="text-sm text-slate-400">
          Snapshot this Nova instance to Glance, then optionally pull the qcow2 to this hypervisor for libvirt import.
        </p>
        <div>
          <label className="block text-xs text-slate-500 mb-1">Glance image name</label>
          <input className="input-field w-full text-sm" value={imageName} onChange={(e) => setImageName(e.target.value)} />
        </div>
        <label className="flex items-center gap-2 text-sm text-slate-300">
          <input type="checkbox" checked={autoPull} onChange={(e) => setAutoPull(e.target.checked)} />
          Auto-pull to hypervisor after snapshot
        </label>
        {autoPull && (
          <>
            <input
              aria-label="Destination path"
              className="input-field w-full text-sm font-mono"
              value={destPath}
              onChange={(e) => setDestPath(e.target.value)}
              placeholder={suggested}
            />
            <label className="flex items-center gap-2 text-sm text-slate-400">
              <input type="checkbox" checked={waitActive} onChange={(e) => setWaitActive(e.target.checked)} />
              Wait for Glance ACTIVE before download
            </label>
          </>
        )}
        <button
          type="button"
          disabled={busy}
          onClick={() => void runExport()}
          className="w-full py-2 rounded-lg bg-sky-600 hover:bg-sky-500 text-white text-sm font-medium disabled:opacity-50 flex items-center justify-center gap-2"
        >
          {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Download className="w-4 h-4" />}
          {busy ? 'Exporting…' : autoPull ? 'Snapshot & pull' : 'Snapshot only'}
        </button>
        {pulledPath && (
          <div className="text-xs text-slate-300 border border-slate-700 rounded-lg p-3 space-y-2">
            <p>Saved: <code className="text-green-300">{pulledPath}</code></p>
            <Link to={`/import?disk=${encodeURIComponent(pulledPath)}`} className="text-sky-400 hover:underline" onClick={onClose}>
              Import as libvirt VM →
            </Link>
          </div>
        )}
      </div>
    </div>
  )
}
