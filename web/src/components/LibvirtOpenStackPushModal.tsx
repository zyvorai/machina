// Copyright (c) 2026 ZyvorAI Labs Private Limited. All rights reserved.
// Proprietary software — see LICENSE in the repository root.
// https://zyvor.dev · info@zyvor.dev

import { useCallback, useEffect, useState } from 'react'
import { Cloud, Loader2, X } from 'lucide-react'
import { Link } from 'react-router'
import {
  getLibvirtOpenStackPushPreview,
  getOpenStackInstance,
  postLibvirtOpenStackPush,
  type GlanceUploadResult,
  type LibvirtOpenStackPushPreview,
} from '../api/openstack'
import { usePlatformInfo } from '../contexts/PlatformInfoContext'
import { useToastContext } from '../contexts/ToastContext'
import { useOpenStackConnection } from '../hooks/useOpenStackConnection'
import { useHypersdkConnection } from '../hooks/useHypersdkConnection'
import HypersdkStatusBanner from './HypersdkStatusBanner'
import { formatUserError } from '../utils/apiError'
import { statusToneClass } from '../utils/semanticColors'

type Props = {
  open: boolean
  vmName: string
  libvirtConnection?: string
  onClose: () => void
  onSuccess?: (result: GlanceUploadResult) => void
}

export default function LibvirtOpenStackPushModal({
  open,
  vmName,
  libvirtConnection,
  onClose,
  onSuccess,
}: Props) {
  const toast = useToastContext()
  const { info } = usePlatformInfo()
  const { phase: osPhase } = useOpenStackConnection()
  const { phase: hsPhase } = useHypersdkConnection()
  const osReady = osPhase === 'live' && Boolean(info?.openstack?.upload_enabled)
  const hypersdkNeedsBanner = Boolean(info?.hypersdk?.enabled) && hsPhase === 'unreachable'

  const [preview, setPreview] = useState<LibvirtOpenStackPushPreview | null>(null)
  const [loading, setLoading] = useState(false)
  const [busy, setBusy] = useState(false)
  const [glanceName, setGlanceName] = useState('')
  const [visibility, setVisibility] = useState('private')
  const [bootInstance, setBootInstance] = useState(false)
  const [flavor, setFlavor] = useState('')
  const [network, setNetwork] = useState('')
  const [keyName, setKeyName] = useState('')
  const [instanceName, setInstanceName] = useState('')
  const [securityGroup, setSecurityGroup] = useState('')
  const [availabilityZone, setAvailabilityZone] = useState('')
  const [waitActive, setWaitActive] = useState(false)
  const [stopVm, setStopVm] = useState(true)
  const [useHyper2kvm, setUseHyper2kvm] = useState(false)
  const [guestFix, setGuestFix] = useState(true)
  const [result, setResult] = useState<{ mode: string; native?: GlanceUploadResult } | null>(null)
  const [deployStatus, setDeployStatus] = useState<string | null>(null)

  const loadPreview = useCallback(async () => {
    setLoading(true)
    try {
      const p = await getLibvirtOpenStackPushPreview(vmName, libvirtConnection)
      setPreview(p)
      setGlanceName(p.glance_preview.suggested_name)
      setStopVm(p.vm_running)
    } catch (e: unknown) {
      toast.error(formatUserError(e))
    } finally {
      setLoading(false)
    }
  }, [vmName, libvirtConnection, toast])

  useEffect(() => {
    if (!open || !osReady) return
    setPreview(null)
    setResult(null)
    setDeployStatus(null)
    void loadPreview()
  }, [open, osReady, loadPreview])

  useEffect(() => {
    const instanceId = result?.native?.instance_id
    if (!open || !instanceId) return
    let cancelled = false
    const poll = async () => {
      try {
        const inst = await getOpenStackInstance(instanceId)
        if (!cancelled) {
          setDeployStatus(inst.status)
          if (['ACTIVE', 'ERROR'].includes(inst.status.toUpperCase())) return
        }
      } catch {
        /* ignore transient errors while Nova boots */
      }
      if (!cancelled) window.setTimeout(() => void poll(), 5000)
    }
    void poll()
    return () => { cancelled = true }
  }, [open, result?.native?.instance_id])

  const runPush = async () => {
    setBusy(true)
    setResult(null)
    try {
      const sg = securityGroup.trim() ? [securityGroup.trim()] : undefined
      const res = await postLibvirtOpenStackPush(
        vmName,
        {
          glance_name: glanceName.trim() || undefined,
          visibility: visibility || undefined,
          boot_instance: bootInstance,
          flavor: flavor.trim() || undefined,
          network: network.trim() || undefined,
          key_name: keyName.trim() || undefined,
          instance_name: instanceName.trim() || undefined,
          availability_zone: availabilityZone.trim() || undefined,
          security_groups: sg,
          wait_until_active: waitActive,
          stop_vm: stopVm,
          use_hyper2kvm: useHyper2kvm,
          guest_fix: guestFix,
        },
        libvirtConnection,
      )
      if (res.mode === 'native' && res.result) {
        const native = res.result as GlanceUploadResult
        setResult({ mode: 'native', native })
        toast.success(`Uploaded to Glance: ${native.image_name}`)
        onSuccess?.(native)
      } else if (res.mode === 'hyper2kvm') {
        const code = res.exit_code as number
        if (code === 0) {
          toast.success('hyper2kvm OpenStack deploy finished')
          onClose()
        } else {
          toast.error(`hyper2kvm exited ${code}: see stderr in logs`)
        }
      }
    } catch (e: unknown) {
      toast.error(formatUserError(e))
    } finally {
      setBusy(false)
    }
  }

  if (!open) return null

  if (!osReady) {
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60" onClick={onClose}>
        <div role="dialog" aria-modal="true" aria-label="OpenStack upload disabled" className="bg-slate-900 border border-slate-600 rounded-xl p-6 max-w-md" onClick={(e) => e.stopPropagation()}>
          <p className="text-slate-300 text-sm">OpenStack upload is disabled. Enable <code className="text-slate-200">[openstack] upload_enabled</code> and configure the cloud in Settings.</p>
        </div>
      </div>
    )
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60" onClick={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Push to OpenStack"
        className="bg-slate-900 border border-slate-600 rounded-xl shadow-xl w-full max-w-3xl max-h-[90vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="p-4 border-b border-slate-700 flex justify-between items-center gap-2">
          <h2 className="text-lg font-semibold text-slate-100 flex items-center gap-2">
            <Cloud className="w-5 h-5 text-orange-400" />
            Push {vmName} to OpenStack
          </h2>
          <button type="button" className="p-1.5 rounded-lg hover:bg-slate-800 text-slate-400" onClick={onClose} aria-label="Close">
            <X className="w-4 h-4" aria-hidden="true" />
          </button>
        </div>
        <div className="p-4 overflow-y-auto space-y-4 text-sm">
          {hypersdkNeedsBanner && (
            <HypersdkStatusBanner
              compact
              title="HyperSDK needed for hyper2kvm"
            />
          )}
          {loading && (
            <div role="status" aria-label="Loading" className="flex justify-center py-8">
              <Loader2 className="w-6 h-6 animate-spin text-orange-400" aria-hidden="true" />
            </div>
          )}
          {preview && !loading && (
            <>
              <p className="text-slate-400">
                Root disk: <code className="text-slate-200 break-all">{preview.root_disk}</code>
                {preview.vm_running && (
                  <span className={`ml-2 ${statusToneClass('warn')}`}>(running — stop recommended before upload)</span>
                )}
              </p>
              <label className="flex items-center gap-2 text-slate-300">
                <input type="checkbox" checked={stopVm} onChange={(e) => setStopVm(e.target.checked)} />
                Stop VM before upload
              </label>
              <label className="flex items-center gap-2 text-slate-300">
                <input type="checkbox" checked={useHyper2kvm} onChange={(e) => setUseHyper2kvm(e.target.checked)} />
                Use hyper2kvm (convert + guest fix + deploy_openstack)
              </label>
              {useHyper2kvm && (
                <label className="flex items-center gap-2 text-slate-400 ml-6">
                  <input type="checkbox" checked={guestFix} onChange={(e) => setGuestFix(e.target.checked)} />
                  Guest fixes (initramfs, fstab, VMware tools)
                </label>
              )}
              <div className="grid gap-2 sm:grid-cols-2">
                <input className="input-field" placeholder="Glance name" value={glanceName} onChange={(e) => setGlanceName(e.target.value)} />
                <select className="input-field" aria-label="Visibility" value={visibility} onChange={(e) => setVisibility(e.target.value)}>
                  <option value="private">private</option>
                  <option value="shared">shared</option>
                  <option value="public">public</option>
                </select>
              </div>
              <label className="flex items-center gap-2 text-slate-300">
                <input type="checkbox" checked={bootInstance} onChange={(e) => setBootInstance(e.target.checked)} />
                Boot Nova instance
              </label>
              {bootInstance && (
                <div className="grid gap-2 sm:grid-cols-2">
                  <input aria-label="Nova flavor" className="input-field" placeholder="flavor" value={flavor} onChange={(e) => setFlavor(e.target.value)} />
                  <input aria-label="Network UUID" className="input-field" placeholder="network UUID" value={network} onChange={(e) => setNetwork(e.target.value)} />
                  <input aria-label="Key pair" className="input-field" placeholder="keypair" value={keyName} onChange={(e) => setKeyName(e.target.value)} />
                  <input aria-label="Instance name" className="input-field" placeholder="instance name" value={instanceName} onChange={(e) => setInstanceName(e.target.value)} />
                  <input aria-label="Security group" className="input-field" placeholder="security group" value={securityGroup} onChange={(e) => setSecurityGroup(e.target.value)} />
                  <input aria-label="Availability zone" className="input-field" placeholder="availability zone" value={availabilityZone} onChange={(e) => setAvailabilityZone(e.target.value)} />
                  <label className="flex items-center gap-2 text-slate-400 sm:col-span-2">
                    <input type="checkbox" checked={waitActive} onChange={(e) => setWaitActive(e.target.checked)} />
                    Wait for ACTIVE
                  </label>
                </div>
              )}
              <button
                type="button"
                disabled={busy}
                onClick={() => void runPush()}
                className="px-4 py-2 rounded-lg bg-orange-600 hover:bg-orange-500 text-white text-sm font-medium disabled:opacity-50"
              >
                {busy ? 'Uploading…' : useHyper2kvm ? 'Run hyper2kvm → Glance' : 'Upload to Glance'}
              </button>
              {result?.native && (
                <div className="rounded-lg border border-emerald-800/50 bg-emerald-950/30 p-3 text-xs">
                  <p>Image {result.native.image_name} ({result.native.image_id})</p>
                  {result.native.instance_id && (
                    <p className="mt-1">
                      Nova instance:{' '}
                      <Link to={`/openstack/instances/${encodeURIComponent(result.native.instance_id)}`} className="text-orange-400 hover:underline" onClick={onClose}>
                        {result.native.instance_name || result.native.instance_id}
                      </Link>
                      {deployStatus && (
                        <span className="text-slate-400 ml-2">({deployStatus})</span>
                      )}
                    </p>
                  )}
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  )
}
