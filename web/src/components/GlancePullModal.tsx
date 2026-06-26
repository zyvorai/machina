// Copyright (c) 2026 ZyvorAI Labs Private Limited. All rights reserved.
// Proprietary software — see LICENSE in the repository root.
// https://zyvor.dev · info@zyvor.dev

import { useState } from 'react'
import { Download, Loader2, X } from 'lucide-react'
import { Link } from 'react-router'
import { pullGlanceImage, type OpenStackImage } from '../api/openstack'
import { useToastContext } from '../contexts/ToastContext'
import { formatUserError } from '../utils/apiError'

type Props = {
  open: boolean
  image: OpenStackImage | null
  defaultDestDir?: string
  onClose: () => void
}

export default function GlancePullModal({ open, image, defaultDestDir, onClose }: Props) {
  const toast = useToastContext()
  const [destPath, setDestPath] = useState('')
  const [waitActive, setWaitActive] = useState(true)
  const [busy, setBusy] = useState(false)
  const [pulledPath, setPulledPath] = useState<string | null>(null)

  if (!open || !image) return null

  const suggested =
    `${defaultDestDir || '/var/lib/libvirt/images'}/${(image.name || image.id).replace(/[^a-zA-Z0-9._-]+/g, '-')}.qcow2`

  const runPull = async () => {
    const path = destPath.trim() || suggested
    setBusy(true)
    setPulledPath(null)
    try {
      const res = await pullGlanceImage(image.id, {
        dest_path: path,
        wait_for_active: waitActive,
      })
      setPulledPath(res.dest_path)
      toast.success(`Saved to ${res.dest_path}`)
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
        aria-label="Pull to hypervisor"
        className="bg-slate-900 border border-slate-600 rounded-xl w-full max-w-lg p-5 space-y-4"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex justify-between items-center">
          <h2 className="text-lg font-semibold text-white flex items-center gap-2">
            <Download className="w-5 h-5 text-sky-400" />
            Pull to hypervisor
          </h2>
          <button type="button" onClick={onClose} aria-label="Close" className="text-slate-400 hover:text-white">
            <X className="w-4 h-4" aria-hidden="true" />
          </button>
        </div>
        <p className="text-sm text-slate-400">
          Download Glance image <strong className="text-slate-200">{image.name || image.id}</strong> to a path under allowed disk-images directories.
        </p>
        <input
          aria-label="Destination path"
          className="input-field w-full text-sm font-mono"
          value={destPath}
          onChange={(e) => setDestPath(e.target.value)}
          placeholder={suggested}
        />
        <label className="flex items-center gap-2 text-sm text-slate-400">
          <input type="checkbox" checked={waitActive} onChange={(e) => setWaitActive(e.target.checked)} />
          Wait for image ACTIVE before download
        </label>
        <button
          type="button"
          disabled={busy}
          onClick={() => void runPull()}
          className="w-full py-2 rounded-lg bg-sky-600 hover:bg-sky-500 text-white text-sm font-medium disabled:opacity-50 flex items-center justify-center gap-2"
        >
          {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Download className="w-4 h-4" />}
          {busy ? 'Downloading…' : 'Download qcow2'}
        </button>
        {pulledPath && (
          <div className="text-xs text-slate-300 space-y-2 border border-slate-700 rounded-lg p-3">
            <p>Saved: <code className="text-green-300">{pulledPath}</code></p>
            <Link
              to={`/import?disk=${encodeURIComponent(pulledPath)}`}
              className="text-sky-400 hover:underline"
              onClick={onClose}
            >
              Import as libvirt VM →
            </Link>
          </div>
        )}
      </div>
    </div>
  )
}
