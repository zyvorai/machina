// Copyright (c) 2026 ZyvorAI Labs Private Limited. All rights reserved.
// Proprietary software — see LICENSE in the repository root.
// https://zyvor.dev · info@zyvor.dev

import { useState, useEffect, useRef } from 'react'
import { useNavigate, useSearchParams } from 'react-router'
import { importDisk, listDiskImages, ImageFile } from '../api/extras'
import { createVMWithProgress, CreateVmRequest } from '../api/vm'
import { listNetworks, NetworkInfo } from '../api/network'
import { BrowseHostPathModal, isHostDiskImageFileName } from '../components/BrowseHostPathModal'
import { useToastContext } from '../contexts/ToastContext'
import { formatUserError } from '../utils/apiError'
import { statusSurfaceClasses, statusToneClass } from '../utils/semanticColors'
import { ArrowLeft, Upload, HardDrive, FolderOpen } from 'lucide-react'
import { Link } from 'react-router'
import { usePlatformInfo } from '../contexts/PlatformInfoContext'
import { useOpenStackConnection } from '../hooks/useOpenStackConnection'
import { Cloud } from 'lucide-react'
import WizardStepper from '../components/WizardStepper'
import PageLayout from '../components/PageLayout'

const IMPORT_STEPS = ['Import disk', 'Configure VM'] as const

export default function ImportVMPage() {
  const [source, setSource] = useState('')
  const [vmName, setVmName] = useState('')
  const [vcpus, setVcpus] = useState(1)
  const [memoryMb, setMemoryMb] = useState(1024)
  const [network, setNetwork] = useState('default')
  const [firmware, setFirmware] = useState('bios')
  const [networks, setNetworks] = useState<NetworkInfo[]>([])
  const [existingDisks, setExistingDisks] = useState<ImageFile[]>([])
  const [submitting, setSubmitting] = useState(false)
  const [createLog, setCreateLog] = useState<string[]>([])
  const logEndRef = useRef<HTMLDivElement>(null)
  const [step, setStep] = useState<'import' | 'configure'>('import')
  const [importedPath, setImportedPath] = useState('')
  const [sourceBrowseOpen, setSourceBrowseOpen] = useState(false)
  const toast = useToastContext()
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const { info } = usePlatformInfo()
  const { phase: osPhase } = useOpenStackConnection()

  useEffect(() => {
    listNetworks().then(setNetworks).catch((e: unknown) => toast.warning(`Networks: ${formatUserError(e)}`))
    listDiskImages().then((r) => setExistingDisks(r.files)).catch((e: unknown) => toast.warning(`Disk images: ${formatUserError(e)}`))
  }, [])

  useEffect(() => {
    const disk = searchParams.get('disk')?.trim()
    if (!disk) return
    const base = disk.split('/').pop()?.replace(/\.[^.]+$/, '') || 'imported-vm'
    setImportedPath(disk)
    setSource(disk)
    setVmName((prev) => prev || base)
    setStep('configure')
  }, [searchParams])

  useEffect(() => {
    if (createLog.length) logEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [createLog])

  const handleImport = async () => {
    if (!source || !vmName.trim()) { toast.warning('Source path and VM name required'); return }
    setSubmitting(true)
    try {
      const result = await importDisk(source, vmName.trim())
      setImportedPath(result.path)
      toast.success(`Disk imported to ${result.path}`)
      setStep('configure')
    } catch (e: unknown) {
      toast.error(`Import failed: ${formatUserError(e)}`)
    } finally {
      setSubmitting(false)
    }
  }

  const handleCreate = async () => {
    if (!vmName.trim() || !importedPath) return
    setSubmitting(true)
    setCreateLog([])
    try {
      const req: CreateVmRequest = {
        name: vmName.trim(),
        vcpus,
        memory_mb: memoryMb,
        disk_gb: 0,
        existing_disk: importedPath,
        network,
        firmware,
      }
      await createVMWithProgress(req, (line) => {
        setCreateLog((prev) => [...prev, line])
      })
      toast.success(`VM '${vmName}' created with imported disk`)
      navigate('/vms')
    } catch (e: unknown) {
      toast.error(`Create failed: ${formatUserError(e)}`)
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <PageLayout
      className="max-w-3xl mx-auto"
      title="Import guest VM"
      subtitle="Bring a disk image onto this hypervisor host and define a libvirt domain—useful for bare-metal lab or worker pools before optional KubeVirt migration."
      icon={<Upload className="w-6 h-6 text-cyan-400" />}
      actions={
        <Link to="/vms" className="p-2 hover:bg-slate-700 rounded transition" aria-label="Back"><ArrowLeft className="w-5 h-5" /></Link>
      }
      contentClassName="space-y-6"
    >
      <WizardStepper
        steps={IMPORT_STEPS}
        current={step === 'import' ? 0 : 1}
        onStep={(i) => {
          if (i === 0) setStep('import')
          else if (importedPath || source) setStep('configure')
        }}
      />

      {osPhase === 'live' && step === 'import' && (
        <div className="rounded-xl border border-sky-500/30 bg-sky-950/20 p-4 flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-start gap-3">
            <Cloud className="w-5 h-5 text-sky-400 shrink-0 mt-0.5" />
            <div>
              <p className="text-sm font-medium text-slate-200">Import from OpenStack Glance</p>
              <p className="text-xs text-slate-400 mt-0.5">
                Pull a cloud image to this host, then continue with configure below.
              </p>
            </div>
          </div>
          <Link
            to="/openstack/images"
            className="shrink-0 px-3 py-1.5 rounded-lg bg-sky-600 hover:bg-sky-500 text-white text-sm"
          >
            Glance images
          </Link>
        </div>
      )}

      {step === 'import' && (
        <div className="bg-slate-800/50 rounded-xl p-6 border border-slate-700/50 space-y-4">
          <h3 className="text-lg font-semibold flex items-center gap-2"><HardDrive className={`w-5 h-5 ${statusToneClass('info')}`} /> Import Disk Image</h3>
          <p className="text-sm text-slate-400">Convert VMDK, VDI, VHD, RAW, or IMG disk images to qcow2 format.</p>

          <div>
            <label htmlFor="import-name" className="block text-sm text-slate-400 mb-1">VM Name *</label>
            <input id="import-name" type="text" autoFocus value={vmName} onChange={e => setVmName(e.target.value)} className="input-field" placeholder="imported-vm" />
          </div>

          <div className="space-y-2">
            <label htmlFor="import-source" className="block text-sm text-slate-400 mb-1">Source Disk Image Path *</label>
            <div className="flex gap-2">
              <input
                id="import-source"
                type="text"
                value={source}
                onChange={(e) => setSource(e.target.value)}
                className="input-field flex-1 min-w-0"
                placeholder="/path/to/disk.vmdk on the hypervisor"
              />
              <button
                type="button"
                className="shrink-0 inline-flex items-center gap-1.5 px-3 py-2 rounded-lg border border-slate-600 bg-slate-700/50 hover:bg-slate-700 text-sm text-slate-200 transition"
                onClick={() => setSourceBrowseOpen(true)}
              >
                <FolderOpen className="w-4 h-4" aria-hidden />
                Browse
              </button>
            </div>
            <p className="text-xs text-slate-500">Supported: .vmdk, .vdi, .vhd, .vpc, .raw, .img, .qcow2 — browse from / on the hypervisor (daemon permissions).</p>
          </div>

          {existingDisks.length > 0 && (
            <div>
              <label className="block text-sm text-slate-400 mb-1">Or select existing image:</label>
              <select value="" onChange={e => { if (e.target.value) setSource(e.target.value) }} className="input-field">
                <option value="">Browse disk images...</option>
                {existingDisks.map(f => <option key={f.path} value={f.path}>{f.name} ({f.format}, {(f.size_bytes / 1073741824).toFixed(1)} GB)</option>)}
              </select>
            </div>
          )}

          <div className="flex justify-end gap-3 pt-4 border-t border-slate-700/50">
            <Link to="/vms" className="px-4 py-2 bg-slate-700 hover:bg-slate-600 rounded text-sm transition">Cancel</Link>
            <button onClick={handleImport} disabled={submitting} className="px-6 py-2 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 rounded text-sm transition">
              {submitting ? 'Importing...' : 'Import & Convert'}
            </button>
          </div>
        </div>
      )}

      {step === 'configure' && (
        <div className="bg-slate-800/50 rounded-xl p-6 border border-slate-700/50 space-y-4">
          <h3 className="text-lg font-semibold">Configure VM</h3>
          <div className={`p-3 rounded-lg border text-sm ${statusSurfaceClasses('ok')}`}>
            Disk imported to: <code className="font-mono">{importedPath}</code>
          </div>

          <div className="grid grid-cols-3 gap-4">
            <div>
              <label htmlFor="cfg-vcpus" className="block text-sm text-slate-400 mb-1">vCPUs</label>
              <input id="cfg-vcpus" type="number" min={1} max={256} value={vcpus} onChange={e => setVcpus(parseInt(e.target.value) || 1)} className="input-field" />
            </div>
            <div>
              <label htmlFor="cfg-memory" className="block text-sm text-slate-400 mb-1">Memory (MB)</label>
              <input id="cfg-memory" type="number" min={64} value={memoryMb} onChange={e => setMemoryMb(parseInt(e.target.value) || 1024)} className="input-field" />
            </div>
            <div>
              <label htmlFor="cfg-firmware" className="block text-sm text-slate-400 mb-1">Firmware</label>
              <select id="cfg-firmware" value={firmware} onChange={e => setFirmware(e.target.value)} className="input-field">
                <option value="bios">BIOS</option>
                <option value="uefi">UEFI</option>
              </select>
            </div>
          </div>

          <div>
            <label htmlFor="cfg-network" className="block text-sm text-slate-400 mb-1">Network</label>
            <select id="cfg-network" value={network} onChange={e => setNetwork(e.target.value)} className="input-field">
              {networks.map(n => <option key={n.name} value={n.name}>{n.name}</option>)}
            </select>
          </div>

          {(submitting || createLog.length > 0) && (
            <div className="rounded-lg border border-slate-700/60 bg-slate-950/40 p-3 space-y-2">
              <h4 className="text-xs font-semibold text-slate-300">virt-install progress</h4>
              <pre className="max-h-56 overflow-y-auto rounded bg-black/50 border border-slate-800 p-2 text-[11px] font-mono text-slate-200 whitespace-pre-wrap break-all">
                {createLog.length ? createLog.join('\n') : <span className="text-slate-500">Starting…</span>}
              </pre>
              <div ref={logEndRef} />
            </div>
          )}

          <div className="flex justify-end gap-3 pt-4 border-t border-slate-700/50">
            <button onClick={() => setStep('import')} className="px-4 py-2 bg-slate-700 hover:bg-slate-600 rounded text-sm transition">Back</button>
            <button onClick={handleCreate} disabled={submitting} className="px-6 py-2 bg-green-600 hover:bg-green-700 disabled:opacity-50 rounded text-sm transition">
              {submitting ? 'Creating...' : 'Create VM'}
            </button>
          </div>
        </div>
      )}

      <BrowseHostPathModal
        open={sourceBrowseOpen}
        onClose={() => setSourceBrowseOpen(false)}
        title="Browse for source disk image"
        canSelectFile={isHostDiskImageFileName}
        onSelectPath={(p) => setSource(p)}
      />
    </PageLayout>
  )
}
