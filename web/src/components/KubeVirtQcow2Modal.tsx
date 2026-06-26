// Copyright (c) 2026 ZyvorAI Labs Private Limited. All rights reserved.
// Proprietary software — see LICENSE in the repository root.
// https://zyvor.dev · info@zyvor.dev

import { useCallback, useEffect, useState, type ReactNode } from 'react'
import { Boxes, Copy, Loader2, X } from 'lucide-react'
import {
  getQcow2KubeVirtBundle,
  postQcow2KubeVirtBundle,
  postQcow2KubeVirtApply,
  postQcow2KubeVirtStart,
  postQcow2KubeVirtUpload,
  type KubeVirtBundle,
  type KubeVirtClusterExecResult,
  type Qcow2KubeVirtRequest,
} from '../api/kubevirt'
import { useToastContext } from '../contexts/ToastContext'
import { formatUserError } from '../utils/apiError'
import { statusToneClass } from '../utils/semanticColors'

type Props = {
  open: boolean
  qcow2Path: string
  onClose: () => void
}

export default function KubeVirtQcow2Modal({ open, qcow2Path, onClose }: Props) {
  const toast = useToastContext()
  const [guestOs, setGuestOs] = useState<'auto' | 'linux' | 'windows'>('auto')
  const [namespace, setNamespace] = useState('')
  const [k8sName, setK8sName] = useState('')
  const [memoryMb, setMemoryMb] = useState('4096')
  const [vcpus, setVcpus] = useState('2')
  const [virtioCdrom, setVirtioCdrom] = useState<boolean | null>(null)
  const [bundle, setBundle] = useState<KubeVirtBundle | null>(null)
  const [loading, setLoading] = useState(false)
  const [execBusy, setExecBusy] = useState<'apply' | 'upload' | 'start' | null>(null)
  const [execLast, setExecLast] = useState<KubeVirtClusterExecResult | null>(null)

  const requestBody = useCallback((): Qcow2KubeVirtRequest => {
    const mb = parseInt(memoryMb, 10)
    const cpu = parseInt(vcpus, 10)
    return {
      qcow2_path: qcow2Path,
      guest_os: guestOs === 'auto' ? undefined : guestOs,
      namespace: namespace.trim() || undefined,
      k8s_vm_name: k8sName.trim() || undefined,
      memory_mb: Number.isFinite(mb) && mb > 0 ? mb : undefined,
      vcpus: Number.isFinite(cpu) && cpu > 0 ? cpu : undefined,
      include_virtio_cdrom: virtioCdrom ?? undefined,
    }
  }, [qcow2Path, guestOs, namespace, k8sName, memoryMb, vcpus, virtioCdrom])

  const loadBundle = useCallback(async () => {
    if (!qcow2Path) return
    setLoading(true)
    try {
      setBundle(await getQcow2KubeVirtBundle(requestBody()))
    } catch (e: unknown) {
      toast.error(formatUserError(e))
    } finally {
      setLoading(false)
    }
  }, [qcow2Path, requestBody, toast])

  useEffect(() => {
    if (!open || !qcow2Path) return
    setBundle(null)
    setExecLast(null)
    void loadBundle()
  }, [open, qcow2Path, guestOs, loadBundle])

  const runStep = async (kind: 'apply' | 'upload' | 'start') => {
    setExecBusy(kind)
    setExecLast(null)
    try {
      const fn =
        kind === 'apply' ? postQcow2KubeVirtApply : kind === 'upload' ? postQcow2KubeVirtUpload : postQcow2KubeVirtStart
      const res = await fn(requestBody())
      setExecLast(res)
      if (res.exit_code === 0) toast.success(`${kind} finished`)
      else toast.error(`${kind} exited ${res.exit_code}`)
    } catch (e: unknown) {
      toast.error(formatUserError(e))
    } finally {
      setExecBusy(null)
    }
  }

  if (!open) return null

  return (
    <ModalBackdrop onClose={onClose}>
      <ModalShell onClose={onClose} qcow2Path={qcow2Path}>
        <GuestOsFields
          guestOs={guestOs}
          setGuestOs={setGuestOs}
          onRegenerate={() => void loadBundle()}
          onPostBundle={async () => {
            setLoading(true)
            try {
              setBundle(await postQcow2KubeVirtBundle(requestBody()))
              toast.success('Bundle rebuilt via POST')
            } catch (e: unknown) {
              toast.error(formatUserError(e))
            } finally {
              setLoading(false)
            }
          }}
        />
        <OverrideFields
          namespace={namespace}
          setNamespace={setNamespace}
          k8sName={k8sName}
          setK8sName={setK8sName}
          vcpus={vcpus}
          setVcpus={setVcpus}
          memoryMb={memoryMb}
          setMemoryMb={setMemoryMb}
          virtioCdrom={virtioCdrom}
          setVirtioCdrom={setVirtioCdrom}
        />
        {loading && <Spinner />}
        {bundle && !loading && (
          <BundleView bundle={bundle} execBusy={execBusy} execLast={execLast} onStep={runStep} toast={toast} />
        )}
      </ModalShell>
    </ModalBackdrop>
  )
}

function ModalBackdrop({ children, onClose }: { children: ReactNode; onClose: () => void }) {
  return (
    <div
      className="fixed inset-0 z-[95] flex items-center justify-center p-4 bg-black/60"
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      {children}
    </div>
  )
}

function ModalShell({
  children,
  onClose,
  qcow2Path,
}: {
  children: ReactNode
  onClose: () => void
  qcow2Path: string
}) {
  return (
    <div
      className="bg-slate-900 border border-slate-600 rounded-xl shadow-xl w-full max-w-3xl max-h-[90vh] flex flex-col"
      onClick={(e) => e.stopPropagation()}
      role="dialog"
      aria-modal="true"
      aria-labelledby="kv-qcow2-title"
    >
      <ModalHeader onClose={onClose} />
      <div className="p-4 overflow-y-auto space-y-4 text-sm">
        <p className="text-slate-300 leading-relaxed">
          CDI <code className="text-slate-200">image-upload</code> + KubeVirt VM for{' '}
          <code className="text-slate-200 break-all">{qcow2Path}</code>. Guest profiles follow hyper2kvm: Linux (SSH
          :22); Windows (RDP :3389, virtio-win CDROM).
        </p>
        {children}
      </div>
    </div>
  )
}

function ModalHeader({ onClose }: { onClose: () => void }) {
  return (
    <div className="p-4 border-b border-slate-700 flex items-center justify-between gap-2">
      <h2 id="kv-qcow2-title" className="text-lg font-semibold text-slate-100 flex items-center gap-2">
        <Boxes className="w-5 h-5 text-violet-400" />
        Upload qcow2 to Kubernetes
      </h2>
      <button type="button" className="p-1.5 rounded-lg hover:bg-slate-800 text-slate-400" onClick={onClose} aria-label="Close">
        <X className="w-4 h-4" />
      </button>
    </div>
  )
}

function FieldLabel({ children }: { children: ReactNode }) {
  return <div className="text-xs font-medium text-slate-400 uppercase tracking-wide">{children}</div>
}

function GuestOsFields({
  guestOs,
  setGuestOs,
  onRegenerate,
  onPostBundle,
}: {
  guestOs: 'auto' | 'linux' | 'windows'
  setGuestOs: (v: 'auto' | 'linux' | 'windows') => void
  onRegenerate: () => void
  onPostBundle: () => void
}) {
  return (
    <div className="rounded-lg border border-slate-700/60 bg-slate-950/40 p-3 space-y-3">
      <FieldLabel>Guest OS</FieldLabel>
      <select
        aria-label="Guest OS"
        value={guestOs}
        onChange={(e) => setGuestOs(e.target.value as 'auto' | 'linux' | 'windows')}
        className="input-field w-full max-w-xs"
      >
        <option value="auto">Auto (from filename)</option>
        <option value="linux">Linux</option>
        <option value="windows">Windows</option>
      </select>
      <div className="flex flex-wrap gap-3">
        <button type="button" className="text-xs text-violet-400 hover:underline" onClick={onRegenerate}>
          Regenerate YAML (GET)
        </button>
        <button type="button" data-testid="kubevirt-post-bundle" className="text-xs text-cyan-400 hover:underline" onClick={onPostBundle}>
          Rebuild bundle (POST)
        </button>
      </div>
    </div>
  )
}

function OverrideFields(props: {
  namespace: string
  setNamespace: (v: string) => void
  k8sName: string
  setK8sName: (v: string) => void
  vcpus: string
  setVcpus: (v: string) => void
  memoryMb: string
  setMemoryMb: (v: string) => void
  virtioCdrom: boolean | null
  setVirtioCdrom: (v: boolean | null) => void
}) {
  return (
    <div className="rounded-lg border border-slate-700/60 bg-slate-950/40 p-3 space-y-2">
      <FieldLabel>Overrides (optional)</FieldLabel>
      <div className="grid gap-2 sm:grid-cols-2">
        <input
          type="text"
          aria-label="Namespace"
          placeholder="namespace"
          value={props.namespace}
          onChange={(e) => props.setNamespace(e.target.value)}
          className="input-field text-sm"
        />
        <input
          type="text"
          aria-label="Kubernetes VM name"
          placeholder="K8s VM name"
          value={props.k8sName}
          onChange={(e) => props.setK8sName(e.target.value)}
          className="input-field text-sm"
        />
        <input
          type="number"
          aria-label="vCPUs"
          min={1}
          placeholder="vCPUs"
          value={props.vcpus}
          onChange={(e) => props.setVcpus(e.target.value)}
          className="input-field text-sm"
        />
        <input
          type="number"
          aria-label="Memory (MB)"
          min={512}
          step={512}
          placeholder="Memory MB"
          value={props.memoryMb}
          onChange={(e) => props.setMemoryMb(e.target.value)}
          className="input-field text-sm"
        />
      </div>
      <label className="flex items-center gap-2 text-xs text-slate-400 cursor-pointer">
        <input
          type="checkbox"
          checked={props.virtioCdrom === true}
          onChange={(e) => props.setVirtioCdrom(e.target.checked ? true : null)}
        />
        Force virtio-win CDROM (default: on for Windows, off for Linux)
      </label>
    </div>
  )
}

function Spinner() {
  return (
    <div role="status" aria-label="Loading" className="flex justify-center py-8">
      <Loader2 className="w-6 h-6 animate-spin text-violet-400" aria-hidden="true" />
    </div>
  )
}

function BundleView({
  bundle,
  execBusy,
  execLast,
  onStep,
  toast,
}: {
  bundle: KubeVirtBundle
  execBusy: 'apply' | 'upload' | 'start' | null
  execLast: KubeVirtClusterExecResult | null
  onStep: (k: 'apply' | 'upload' | 'start') => Promise<void>
  toast: ReturnType<typeof useToastContext>
}) {
  return (
    <>
      <p className="text-xs text-slate-400">
        Profile <span className="text-slate-200">{bundle.guest_os ?? 'linux'}</span> · DataVolume{' '}
        <code className="text-slate-300">{bundle.datavolume_name}</code> · VM{' '}
        <code className="text-slate-300">{bundle.virtual_machine_name}</code> · namespace{' '}
        <code className="text-slate-300">{bundle.namespace}</code>
        {bundle.cluster_exec_enabled ? (
          <span className="text-violet-300"> · daemon exec enabled</span>
        ) : (
          <span className={statusToneClass('warn')}> · enable [kubevirt] exec_enabled for one-click upload</span>
        )}
      </p>
      {bundle.cluster_exec_enabled && (
        <div className="flex flex-wrap gap-2">
          <ExecBtn disabled={!!execBusy} busy={execBusy === 'upload'} onClick={() => void onStep('upload')}>
            virtctl image-upload
          </ExecBtn>
          <ExecBtn disabled={!!execBusy} busy={execBusy === 'apply'} onClick={() => void onStep('apply')}>
            kubectl apply
          </ExecBtn>
          <ExecBtn disabled={!!execBusy} busy={execBusy === 'start'} onClick={() => void onStep('start')}>
            virtctl start
          </ExecBtn>
        </div>
      )}
      {execLast && (
        <pre className="text-[10px] font-mono text-slate-200 bg-black/40 border border-slate-800 rounded-lg p-2 max-h-28 overflow-y-auto whitespace-pre-wrap">
          exit {execLast.exit_code}
          {'\n'}
          {execLast.stderr}
          {execLast.stdout}
        </pre>
      )}
      <div className="flex flex-wrap gap-2">
        <CopyBtn
          onClick={() => {
            void navigator.clipboard.writeText(bundle.yaml)
            toast.success('YAML copied')
          }}
        />
        <CopyBtn
          label="Copy virtctl upload"
          onClick={() => {
            void navigator.clipboard.writeText(bundle.virtctl_image_upload_example)
            toast.success('virtctl command copied')
          }}
        />
      </div>
      <pre className="text-[11px] font-mono text-slate-200 bg-black/40 border border-slate-800 rounded-lg p-3 max-h-[35vh] overflow-y-auto whitespace-pre-wrap">
        {bundle.yaml}
      </pre>
    </>
  )
}

function ExecBtn({
  children,
  disabled,
  busy,
  onClick,
}: {
  children: ReactNode
  disabled: boolean
  busy: boolean
  onClick: () => void
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className="text-xs px-2 py-1 rounded bg-violet-900/80 hover:bg-violet-800 disabled:opacity-50 text-violet-100"
    >
      {busy ? '…' : children}
    </button>
  )
}

function CopyBtn({ onClick, label = 'Copy YAML' }: { onClick: () => void; label?: string }) {
  return (
    <button
      type="button"
      className="text-xs px-2 py-1 rounded bg-slate-800 hover:bg-slate-700 text-slate-200 inline-flex items-center gap-1"
      onClick={onClick}
    >
      <Copy className="w-3 h-3" />
      {label}
    </button>
  )
}
