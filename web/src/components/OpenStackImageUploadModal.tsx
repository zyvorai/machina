// Copyright (c) 2026 ZyvorAI Labs Private Limited. All rights reserved.
// Proprietary software — see LICENSE in the repository root.
// https://zyvor.dev · info@zyvor.dev

import { useCallback, useEffect, useState } from 'react'
import { Cloud, Loader2, X } from 'lucide-react'
import { Link } from 'react-router'
import {
  getGlanceUploadPreview,
  postGlanceUpload,
  type GlanceUploadPreview,
  type GlanceUploadRequest,
  type GlanceUploadResult,
} from '../api/openstack'
import { useToastContext } from '../contexts/ToastContext'
import { formatUserError } from '../utils/apiError'

type Props = {
  open: boolean
  qcow2Path: string
  initialGlanceName?: string
  onClose: () => void
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KiB`
  if (n < 1024 * 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(1)} MiB`
  return `${(n / (1024 * 1024 * 1024)).toFixed(2)} GiB`
}

export default function OpenStackImageUploadModal({
  open,
  qcow2Path,
  initialGlanceName,
  onClose,
}: Props) {
  const toast = useToastContext()
  const [glanceName, setGlanceName] = useState('')
  const [bootInstance, setBootInstance] = useState(false)
  const [flavor, setFlavor] = useState('')
  const [network, setNetwork] = useState('')
  const [keyName, setKeyName] = useState('')
  const [instanceName, setInstanceName] = useState('')
  const [visibility, setVisibility] = useState('private')
  const [securityGroup, setSecurityGroup] = useState('')
  const [availabilityZone, setAvailabilityZone] = useState('')
  const [waitActive, setWaitActive] = useState(false)
  const [preview, setPreview] = useState<GlanceUploadPreview | null>(null)
  const [loading, setLoading] = useState(false)
  const [uploadBusy, setUploadBusy] = useState(false)
  const [uploadResult, setUploadResult] = useState<GlanceUploadResult | null>(null)

  const requestBody = useCallback((): GlanceUploadRequest => {
    const body: GlanceUploadRequest = { qcow2_path: qcow2Path }
    if (glanceName.trim()) body.glance_name = glanceName.trim()
    if (bootInstance) body.boot_instance = true
    if (flavor.trim()) body.flavor = flavor.trim()
    if (network.trim()) body.network = network.trim()
    if (keyName.trim()) body.key_name = keyName.trim()
    if (instanceName.trim()) body.instance_name = instanceName.trim()
    if (visibility) body.visibility = visibility
    if (securityGroup.trim()) body.security_groups = [securityGroup.trim()]
    if (availabilityZone.trim()) body.availability_zone = availabilityZone.trim()
    if (waitActive) body.wait_until_active = true
    return body
  }, [qcow2Path, glanceName, bootInstance, flavor, network, keyName, instanceName, visibility, securityGroup, availabilityZone, waitActive])

  const loadPreview = useCallback(async () => {
    if (!qcow2Path) return
    setLoading(true)
    try {
      setPreview(await getGlanceUploadPreview(qcow2Path))
    } catch (e: unknown) {
      toast.error(formatUserError(e))
    } finally {
      setLoading(false)
    }
  }, [qcow2Path, toast])

  useEffect(() => {
    if (!open || !qcow2Path) return
    setPreview(null)
    setUploadResult(null)
    const base =
      initialGlanceName?.trim() ||
      qcow2Path.split('/').pop()?.replace(/\.[^.]+$/, '') ||
      ''
    setGlanceName(base)
    void loadPreview()
  }, [open, qcow2Path, initialGlanceName, loadPreview])

  const runUpload = async () => {
    setUploadBusy(true)
    setUploadResult(null)
    try {
      const res = await postGlanceUpload(requestBody())
      setUploadResult(res)
      toast.success(`Uploaded to Glance: ${res.image_name}`)
    } catch (e: unknown) {
      toast.error(formatUserError(e))
    } finally {
      setUploadBusy(false)
    }
  }

  if (!open) return null

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60"
      onClick={onClose}
      role="presentation"
    >
      <div
        className="bg-slate-900 border border-slate-600 rounded-xl shadow-xl w-full max-w-3xl max-h-[90vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby="os-upload-title"
      >
        <div className="p-4 border-b border-slate-700 flex items-center justify-between gap-2">
          <h2 id="os-upload-title" className="text-lg font-semibold text-slate-100 flex items-center gap-2">
            <Cloud className="w-5 h-5 text-orange-400" />
            Upload qcow2 to OpenStack Glance
          </h2>
          <button type="button" className="p-1.5 rounded-lg hover:bg-slate-800 text-slate-400" onClick={onClose} aria-label="Close">
            <X className="w-4 h-4" />
          </button>
        </div>
        <div className="p-4 overflow-y-auto space-y-4 text-sm">
          <p className="text-slate-300 leading-relaxed">
            Uploads <code className="text-slate-200 break-all">{qcow2Path}</code> to Glance using the machina-daemon
            native OpenStack API (Keystone + Glance v2). Auth comes from{' '}
            <code className="text-slate-200">clouds.yaml</code>, openrc, or{' '}
            <code className="text-slate-200">[openstack]</code> in machina config.
          </p>
          {preview && (
            <p className="text-xs text-slate-400">
              Size: {formatBytes(preview.file_size_bytes)} · format: {preview.disk_format} / {preview.container_format}
            </p>
          )}
          <div className="rounded-lg border border-slate-700/60 bg-slate-950/40 p-3 space-y-2">
            <div className="grid gap-2 sm:grid-cols-2">
              <input
                type="text"
                aria-label="Glance image name"
                placeholder="Glance image name"
                value={glanceName}
                onChange={(e) => setGlanceName(e.target.value)}
                className="input-field text-sm"
              />
              <select
                aria-label="Visibility"
                value={visibility}
                onChange={(e) => setVisibility(e.target.value)}
                className="input-field text-sm"
              >
                <option value="private">private</option>
                <option value="shared">shared</option>
                <option value="public">public</option>
              </select>
            </div>
            <label className="flex items-center gap-2 text-xs text-slate-400 cursor-pointer">
              <input type="checkbox" checked={bootInstance} onChange={(e) => setBootInstance(e.target.checked)} />
              Boot Nova instance after upload
            </label>
            {bootInstance && (
              <div className="grid gap-2 sm:grid-cols-3">
                <input
                  type="text"
                  aria-label="Nova flavor"
                  placeholder="flavor"
                  value={flavor}
                  onChange={(e) => setFlavor(e.target.value)}
                  className="input-field text-sm"
                />
                <input
                  type="text"
                  aria-label="Network"
                  placeholder="network"
                  value={network}
                  onChange={(e) => setNetwork(e.target.value)}
                  className="input-field text-sm"
                />
                <input
                  type="text"
                  aria-label="Key pair name"
                  placeholder="key_name"
                  value={keyName}
                  onChange={(e) => setKeyName(e.target.value)}
                  className="input-field text-sm"
                />
                <input
                  type="text"
                  aria-label="Instance name"
                  placeholder="instance name"
                  value={instanceName}
                  onChange={(e) => setInstanceName(e.target.value)}
                  className="input-field text-sm"
                />
                <input
                  type="text"
                  aria-label="Security group"
                  placeholder="security group"
                  value={securityGroup}
                  onChange={(e) => setSecurityGroup(e.target.value)}
                  className="input-field text-sm"
                />
                <input
                  type="text"
                  aria-label="Availability zone"
                  placeholder="availability zone"
                  value={availabilityZone}
                  onChange={(e) => setAvailabilityZone(e.target.value)}
                  className="input-field text-sm"
                />
                <label className="flex items-center gap-2 text-xs text-slate-400 sm:col-span-3">
                  <input type="checkbox" checked={waitActive} onChange={(e) => setWaitActive(e.target.checked)} />
                  Wait for Nova ACTIVE
                </label>
              </div>
            )}
            <button type="button" className="text-xs text-orange-400 hover:underline" onClick={() => void loadPreview()}>
              Refresh preview
            </button>
          </div>
          {loading && (
            <div role="status" aria-label="Loading preview" className="flex justify-center py-6">
              <Loader2 className="w-6 h-6 animate-spin text-orange-400" aria-hidden="true" />
            </div>
          )}
          {preview && !loading && (
            <>
              <button
                type="button"
                disabled={uploadBusy}
                onClick={() => void runUpload()}
                className="px-3 py-2 rounded-lg bg-orange-600 hover:bg-orange-500 text-white text-sm font-medium disabled:opacity-50"
              >
                {uploadBusy ? 'Uploading to Glance…' : 'Upload to Glance'}
              </button>
              {uploadResult && (
                <div className="rounded-lg border border-emerald-800/50 bg-emerald-950/30 p-3 text-xs text-slate-300 space-y-1">
                  <p>
                    Image <strong className="text-slate-100">{uploadResult.image_name}</strong> ({uploadResult.image_id})
                  </p>
                  <p>Status: {uploadResult.status} · {formatBytes(uploadResult.bytes_uploaded)} uploaded</p>
                  {uploadResult.instance_id && (
                    <p>
                      Instance:{' '}
                      <Link
                        to={`/openstack/instances/${encodeURIComponent(uploadResult.instance_id)}`}
                        className="text-orange-400 hover:underline"
                        onClick={onClose}
                      >
                        {uploadResult.instance_name ?? uploadResult.instance_id}
                      </Link>
                    </p>
                  )}
                  <Link to="/openstack/images" className="text-orange-400 hover:underline inline-block mt-1" onClick={onClose}>
                    View Glance images
                  </Link>
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  )
}
