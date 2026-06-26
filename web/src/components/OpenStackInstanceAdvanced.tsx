// Copyright (c) 2026 ZyvorAI Labs Private Limited. All rights reserved.
// Proprietary software — see LICENSE in the repository root.
// https://zyvor.dev · info@zyvor.dev

import { useCallback, useEffect, useRef, useState } from 'react'
import { Link } from 'react-router'
import {
  attachOpenStackVolume,
  associateOpenStackFloatingIp,
  createOpenStackVolume,
  detachOpenStackVolume,
  dissociateOpenStackFloatingIp,
  getOpenStackConsoleOutput,
  getOpenStackRemoteConsole,
  listOpenStackCinderVolumes,
  listOpenStackFlavors,
  listOpenStackFloatingIps,
  listOpenStackImages,
  listOpenStackInstanceFloatingIps,
  listOpenStackNetworks,
  pauseOpenStackInstance,
  rebuildOpenStackInstance,
  confirmResizeOpenStackInstance,
  resizeOpenStackInstance,
  revertResizeOpenStackInstance,
  resumeOpenStackInstance,
  suspendOpenStackInstance,
  unpauseOpenStackInstance,
  addOpenStackSecurityGroup,
  removeOpenStackSecurityGroup,
  updateOpenStackMetadata,
  OPENSTACK_CONSOLE_TYPES,
  type OpenStackAttachedVolume,
  type OpenStackConsoleType,
  type OpenStackFloatingIp,
  type OpenStackImage,
  type OpenStackInstance,
  type OpenStackNetwork,
} from '../api/openstack'
import { useToastContext } from '../contexts/ToastContext'
import OpenStackExportModal from './OpenStackExportModal'
import {
  attachOpenStackInterface,
  backupOpenStackInstance,
  detachOpenStackInterface,
  listOpenStackInstanceInterfaces,
  migrateOpenStackInstance,
  rescueOpenStackInstance,
  shelveOpenStackInstance,
  unrescueOpenStackInstance,
  unshelveOpenStackInstance,
  renameOpenStackInstance,
  lockOpenStackInstance,
  unlockOpenStackInstance,
  resetOpenStackInstanceState,
} from '../api/openstackExtras'
import {
  Globe, HardDrive, Pause, PlayCircle, Terminal, Upload, Shield, Maximize2, ExternalLink, Monitor, RotateCcw, Tags, Archive, Plane,
} from 'lucide-react'
import { isFloatingIpAvailable } from '../utils/openstackFloatingIp'
import { formatUserError } from '../utils/apiError'
import { statusActionLinkClasses, statusDestructiveButtonClasses, statusSurfaceClasses, statusToneClass } from '../utils/semanticColors'

type Props = {
  inst: OpenStackInstance
  volumes: OpenStackAttachedVolume[]
  onRefresh: () => void
}

export default function OpenStackInstanceAdvanced({ inst, volumes, onRefresh }: Props) {
  const toast = useToastContext()
  const extrasErrorShown = useRef(false)
  const [fips, setFips] = useState<OpenStackFloatingIp[]>([])
  const [poolFips, setPoolFips] = useState<OpenStackFloatingIp[]>([])
  const [cinderVols, setCinderVols] = useState<OpenStackAttachedVolume[]>([])
  const [networks, setNetworks] = useState<OpenStackNetwork[]>([])
  const [flavors, setFlavors] = useState<{ id: string; name: string }[]>([])
  const [attachVolId, setAttachVolId] = useState('')
  const [extNet, setExtNet] = useState('')
  const [existingFipId, setExistingFipId] = useState('')
  const [resizeFlavor, setResizeFlavor] = useState('')
  const [resizeAutoConfirm, setResizeAutoConfirm] = useState(true)
  const [sgName, setSgName] = useState('')
  const [consoleType, setConsoleType] = useState<OpenStackConsoleType>('novnc')
  const [consoleLog, setConsoleLog] = useState<string | null>(null)
  const [exportOpen, setExportOpen] = useState(false)
  const [images, setImages] = useState<OpenStackImage[]>([])
  const [rebuildImageId, setRebuildImageId] = useState('')
  const [metadataText, setMetadataText] = useState('')
  const [newVolSizeGb, setNewVolSizeGb] = useState('8')
  const [newVolName, setNewVolName] = useState('')
  const [ifaces, setIfaces] = useState<{ port_id: string; net_id: string; fixed_ips: string[] }[]>([])
  const [attachNetId, setAttachNetId] = useState('')

  const loadExtras = useCallback(async () => {
    try {
      const [f, allFips, cv, n, fl, imgs] = await Promise.all([
        listOpenStackInstanceFloatingIps(inst.id),
        listOpenStackFloatingIps(),
        listOpenStackCinderVolumes(),
        listOpenStackNetworks(),
        listOpenStackFlavors(),
        listOpenStackImages(),
      ])
      setFips(f.floating_ips)
      setPoolFips(allFips.floating_ips.filter((ip) => isFloatingIpAvailable(ip, inst.id)))
      setCinderVols(cv.volumes.filter((v) => !volumes.some((a) => a.id === v.id)))
      setNetworks(n.networks.filter((net) => net.external))
      setFlavors(fl.flavors.map((x) => ({ id: x.id, name: x.name })))
      setImages(imgs.images.filter((img) => img.status === 'ACTIVE'))
      try {
        const ifc = await listOpenStackInstanceInterfaces(inst.id)
        setIfaces(ifc.interfaces)
      } catch {
        setIfaces([])
      }
      setExtNet((prev) => {
        if (prev) return prev
        const ext = n.networks.find((net) => net.external)
        return ext ? ext.id : prev
      })
    } catch (e: unknown) {
      if (!extrasErrorShown.current) {
        extrasErrorShown.current = true
        toast.error(`Failed to load OpenStack networking extras: ${formatUserError(e)}`)
      }
    }
  }, [inst.id, volumes, toast])

  useEffect(() => {
    extrasErrorShown.current = false
    void loadExtras()
  }, [loadExtras])

  useEffect(() => {
    const lines = Object.entries(inst.metadata || {})
      .map(([k, v]) => `${k}=${v}`)
      .join('\n')
    setMetadataText(lines)
  }, [inst.metadata, inst.id])

  const run = async (fn: () => Promise<unknown>, ok: string) => {
    try {
      await fn()
      toast.success(ok)
      onRefresh()
      void loadExtras()
    } catch (e: unknown) {
      toast.error(formatUserError(e))
    }
  }

  const openRemoteConsole = async () => {
    try {
      const c = await getOpenStackRemoteConsole(inst.id, consoleType)
      window.open(c.url, '_blank', 'noopener,noreferrer')
      toast.success(`Opened ${c.console_type || consoleType} console`)
    } catch (e: unknown) {
      toast.error(formatUserError(e))
    }
  }

  const availablePool = poolFips.filter((ip) => !fips.some((a) => a.id === ip.id))

  return (
    <div className="space-y-4">
      <section className="rounded-xl border border-slate-700/80 p-4">
        <h2 className="font-medium text-slate-200 mb-3 flex items-center gap-2">
          <Archive className="w-4 h-4 text-violet-400" /> Extended lifecycle
        </h2>
        <div className="flex flex-wrap gap-2 mb-4">
          <button type="button" onClick={() => run(() => shelveOpenStackInstance(inst.id), 'Shelved')}
            className="px-3 py-1.5 rounded-lg border border-slate-600 text-sm hover:bg-slate-800">Shelve</button>
          <button type="button" onClick={() => run(() => unshelveOpenStackInstance(inst.id), 'Unshelved')}
            className="px-3 py-1.5 rounded-lg border border-slate-600 text-sm hover:bg-slate-800">Unshelve</button>
          <button type="button" onClick={() => {
            const n = prompt('New instance name', inst.name)
            if (!n?.trim()) return
            void run(() => renameOpenStackInstance(inst.id, n.trim()), 'Renamed')
          }}
            className="px-3 py-1.5 rounded-lg border border-slate-600 text-sm hover:bg-slate-800">Rename</button>
          <button type="button" onClick={() => run(() => lockOpenStackInstance(inst.id), 'Locked')}
            className="px-3 py-1.5 rounded-lg border border-slate-600 text-sm hover:bg-slate-800">Lock</button>
          <button type="button" onClick={() => run(() => unlockOpenStackInstance(inst.id), 'Unlocked')}
            className="px-3 py-1.5 rounded-lg border border-slate-600 text-sm hover:bg-slate-800">Unlock</button>
          <button type="button" onClick={() => run(() => resetOpenStackInstanceState(inst.id), 'State reset')}
            className={statusSurfaceClasses('warn', 'px-3 py-1.5 rounded-lg text-sm hover:bg-slate-800')}>Reset state</button>
          <button type="button" onClick={() => run(() => migrateOpenStackInstance(inst.id, { live: false }), 'Cold migrate')}
            className="px-3 py-1.5 rounded-lg border border-slate-600 text-sm hover:bg-slate-800">Migrate</button>
          <button type="button" onClick={() => run(() => migrateOpenStackInstance(inst.id, { live: true }), 'Live migrate')}
            className="px-3 py-1.5 rounded-lg border border-slate-600 text-sm hover:bg-slate-800">Live migrate</button>
          <button type="button" onClick={() => run(() => rescueOpenStackInstance(inst.id, {}), 'Rescue')}
            className={statusSurfaceClasses('warn', 'px-3 py-1.5 rounded-lg text-sm')}>Rescue</button>
          <button type="button" onClick={() => run(() => unrescueOpenStackInstance(inst.id), 'Unrescued')}
            className="px-3 py-1.5 rounded-lg border border-slate-600 text-sm hover:bg-slate-800">Unrescue</button>
          <button type="button" onClick={() => {
            const n = prompt('Backup name', `${inst.name}-backup`)
            if (!n) return
            void run(() => backupOpenStackInstance(inst.id, n), 'Backup started')
          }} className="px-3 py-1.5 rounded-lg border border-slate-600 text-sm hover:bg-slate-800">Backup</button>
        </div>
        <h3 className="text-xs text-slate-500 mb-2 flex items-center gap-1"><Plane className="w-3.5 h-3.5" /> Interfaces</h3>
        <ul className="text-xs font-mono text-slate-400 mb-2 space-y-1">
          {ifaces.map((i) => (
            <li key={i.port_id} className="flex gap-2 items-center">
              {i.fixed_ips.join(', ') || i.port_id.slice(0, 8)}
              <button type="button" className={statusActionLinkClasses('error', 'hover:underline')}
                onClick={() => run(() => detachOpenStackInterface(inst.id, i.port_id), 'Interface detached')}>Detach</button>
            </li>
          ))}
        </ul>
        <div className="flex flex-wrap gap-2 items-end">
          <select aria-label="Network to attach" value={attachNetId} onChange={(e) => setAttachNetId(e.target.value)}
            className="px-2 py-1.5 rounded-lg bg-slate-900 border border-slate-700 text-sm">
            <option value="">Network to attach…</option>
            {networks.map((n) => (
              <option key={n.id} value={n.id}>{n.name || n.id}</option>
            ))}
          </select>
          <button type="button" disabled={!attachNetId}
            onClick={() => run(
              () => attachOpenStackInterface(inst.id, { network_id: attachNetId }),
              'Interface attached',
            )}
            className="px-3 py-1.5 rounded-lg bg-sky-600 text-sm text-white disabled:opacity-40">Attach NIC</button>
        </div>
      </section>

      <section className="rounded-xl border border-slate-700/80 p-4">
        <h2 className="font-medium text-slate-200 mb-3">Power &amp; lifecycle</h2>
        <div className="flex flex-wrap gap-2">
          <button type="button" onClick={() => run(() => pauseOpenStackInstance(inst.id), 'Paused')}
            className="px-3 py-1.5 rounded-lg border border-slate-600 text-sm hover:bg-slate-800">
            <Pause className="w-3.5 h-3.5 inline mr-1" /> Pause
          </button>
          <button type="button" onClick={() => run(() => unpauseOpenStackInstance(inst.id), 'Unpaused')}
            className="px-3 py-1.5 rounded-lg border border-slate-600 text-sm hover:bg-slate-800">
            Unpause
          </button>
          <button type="button" onClick={() => run(() => suspendOpenStackInstance(inst.id), 'Suspended')}
            className="px-3 py-1.5 rounded-lg border border-slate-600 text-sm hover:bg-slate-800">
            Suspend
          </button>
          <button type="button" onClick={() => run(() => resumeOpenStackInstance(inst.id), 'Resumed')}
            className="px-3 py-1.5 rounded-lg border border-slate-600 text-sm hover:bg-slate-800">
            <PlayCircle className="w-3.5 h-3.5 inline mr-1" /> Resume
          </button>
        </div>
        <div className="flex flex-wrap gap-2 mt-3 items-end">
          <div>
            <label className="block text-xs text-slate-500 mb-1">Resize to flavor</label>
            <select aria-label="Resize to flavor" value={resizeFlavor} onChange={(e) => setResizeFlavor(e.target.value)}
              className="px-2 py-1.5 rounded-lg bg-slate-900 border border-slate-700 text-sm">
              <option value="">Select…</option>
              {flavors.map((f) => (
                <option key={f.id} value={f.id}>{f.name}</option>
              ))}
            </select>
          </div>
          <label className="flex items-center gap-2 text-xs text-slate-400 pb-2">
            <input
              type="checkbox"
              checked={resizeAutoConfirm}
              onChange={(e) => setResizeAutoConfirm(e.target.checked)}
              className="rounded border-slate-600"
            />
            Auto-confirm resize
          </label>
          <button type="button" disabled={!resizeFlavor}
            onClick={() => run(
              () => resizeOpenStackInstance(inst.id, resizeFlavor, { auto_confirm: resizeAutoConfirm }),
              resizeAutoConfirm ? 'Resize confirmed' : 'Resize scheduled',
            )}
            className={statusSurfaceClasses('warn', 'px-3 py-1.5 rounded-lg text-sm disabled:opacity-40')}>
            <Maximize2 className="w-3.5 h-3.5 inline mr-1" /> Resize
          </button>
          <button type="button"
            onClick={() => run(() => confirmResizeOpenStackInstance(inst.id), 'Resize confirmed')}
            className="px-3 py-1.5 rounded-lg border border-slate-600 text-sm hover:bg-slate-800">
            Confirm resize
          </button>
          <button type="button"
            onClick={() => run(() => revertResizeOpenStackInstance(inst.id), 'Resize reverted')}
            className={statusDestructiveButtonClasses('px-3 py-1.5 text-sm hover:opacity-90')}>
            Revert resize
          </button>
        </div>
      </section>

      <section className="rounded-xl border border-slate-700/80 p-4">
        <h2 className="font-medium text-slate-200 mb-3 flex items-center gap-2">
          <Terminal className="w-4 h-4 text-sky-400" /> Console
        </h2>
        <div className="flex flex-wrap gap-2 items-end">
          <div>
            <label className="block text-xs text-slate-500 mb-1">Remote console type</label>
            <select
              aria-label="Remote console type"
              value={consoleType}
              onChange={(e) => setConsoleType(e.target.value as OpenStackConsoleType)}
              className="px-2 py-1.5 rounded-lg bg-slate-900 border border-slate-700 text-sm min-w-[10rem]"
            >
              {OPENSTACK_CONSOLE_TYPES.map((t) => (
                <option key={t.id} value={t.id}>{t.label}</option>
              ))}
            </select>
          </div>
          <Link
            to={`/openstack/instances/${encodeURIComponent(inst.id)}/console?type=${consoleType}&tunnel=1`}
            className="px-3 py-1.5 rounded-lg bg-sky-600 hover:bg-sky-500 text-sm text-white inline-flex items-center gap-1.5"
          >
            <Monitor className="w-3.5 h-3.5" />
            Embedded console
          </Link>
          <button
            type="button"
            onClick={() => void openRemoteConsole()}
            className="px-3 py-1.5 rounded-lg border border-slate-600 text-sm hover:bg-slate-800 inline-flex items-center gap-1.5"
          >
            <ExternalLink className="w-3.5 h-3.5" />
            New tab
          </button>
          <button type="button" onClick={async () => {
            try {
              const { output } = await getOpenStackConsoleOutput(inst.id, 100)
              setConsoleLog(output || '(empty)')
            } catch (e: unknown) {
              toast.error(formatUserError(e))
            }
          }} className="px-3 py-1.5 rounded-lg border border-slate-600 text-sm hover:bg-slate-800">
            Serial log (100 lines)
          </button>
        </div>
        {consoleLog != null && (
          <pre className="mt-3 p-3 rounded-lg bg-black/60 text-xs text-slate-300 overflow-auto max-h-48 whitespace-pre-wrap">
            {consoleLog}
          </pre>
        )}
      </section>

      <section className="rounded-xl border border-slate-700/80 p-4">
        <h2 className="font-medium text-slate-200 mb-3 flex items-center gap-2">
          <Globe className="w-4 h-4 text-sky-400" /> Floating IPs
        </h2>
        {fips.length === 0 ? (
          <p className="text-slate-500 text-sm mb-3">No floating IPs on this instance.</p>
        ) : (
          <ul className="space-y-2 mb-3 text-sm font-mono text-slate-300">
            {fips.map((f) => (
              <li key={f.id} className="flex flex-wrap items-center gap-2">
                {f.address}
                {f.fixed_address && <span className="text-slate-500">→ {f.fixed_address}</span>}
                <span className="text-xs text-slate-600">({f.status})</span>
                <button type="button" onClick={() => run(() => dissociateOpenStackFloatingIp(f.id), 'Dissociated')}
                  className={`text-xs ${statusActionLinkClasses('error', 'hover:underline')}`}>Dissociate</button>
              </li>
            ))}
          </ul>
        )}

        <p className="text-xs text-slate-500 mb-2">Associate an existing unbound floating IP</p>
        <div className="flex flex-wrap gap-2 items-end mb-4 pb-4 border-b border-slate-700/60">
          <div>
            <label className="block text-xs text-slate-500 mb-1">Available in project</label>
            <select
              aria-label="Available floating IP"
              value={existingFipId}
              onChange={(e) => setExistingFipId(e.target.value)}
              className="px-2 py-1.5 rounded-lg bg-slate-900 border border-slate-700 text-sm max-w-md"
            >
              <option value="">Select floating IP…</option>
              {availablePool.map((f) => (
                <option key={f.id} value={f.id}>
                  {f.address} ({f.status}{f.instance_id ? ` · was ${f.instance_id.slice(0, 8)}` : ''})
                </option>
              ))}
            </select>
          </div>
          <button
            type="button"
            disabled={!existingFipId}
            onClick={() => run(
              () => associateOpenStackFloatingIp(inst.id, { floating_ip_id: existingFipId }),
              'Existing floating IP associated',
            )}
            className="px-3 py-1.5 rounded-lg border border-sky-500/50 text-sky-200 hover:bg-sky-500/10 text-sm disabled:opacity-40"
          >
            Associate existing
          </button>
          {availablePool.length === 0 && (
            <span className="text-xs text-slate-600">No unbound IPs in this project.</span>
          )}
        </div>

        <p className="text-xs text-slate-500 mb-2">Or allocate a new floating IP</p>
        <div className="flex flex-wrap gap-2 items-end">
          <div>
            <label className="block text-xs text-slate-500 mb-1">External network</label>
            <select aria-label="External network" value={extNet} onChange={(e) => setExtNet(e.target.value)}
              className="px-2 py-1.5 rounded-lg bg-slate-900 border border-slate-700 text-sm max-w-xs">
              <option value="">Select…</option>
              {networks.map((n) => (
                <option key={n.id} value={n.id}>{n.name || n.id}</option>
              ))}
            </select>
          </div>
          <button type="button" disabled={!extNet}
            onClick={() => run(
              () => associateOpenStackFloatingIp(inst.id, { floating_network: extNet }),
              'New floating IP allocated and associated',
            )}
            className="px-3 py-1.5 rounded-lg bg-sky-600 hover:bg-sky-500 text-sm text-white disabled:opacity-40">
            Allocate &amp; associate
          </button>
        </div>
      </section>

      <section className="rounded-xl border border-slate-700/80 p-4">
        <h2 className="font-medium text-slate-200 mb-3 flex items-center gap-2">
          <RotateCcw className={`w-4 h-4 ${statusToneClass('warn')}`} /> Rebuild
        </h2>
        <p className="text-xs text-slate-500 mb-2">Replace the instance disk from a Glance image (destructive).</p>
        <div className="flex flex-wrap gap-2 items-end">
          <select
            aria-label="Glance image for rebuild"
            value={rebuildImageId}
            onChange={(e) => setRebuildImageId(e.target.value)}
            className="px-2 py-1.5 rounded-lg bg-slate-900 border border-slate-700 text-sm min-w-[12rem]"
          >
            <option value="">Glance image…</option>
            {images.map((img) => (
              <option key={img.id} value={img.id}>{img.name || img.id}</option>
            ))}
          </select>
          <button
            type="button"
            disabled={!rebuildImageId}
            onClick={() => run(
              () => rebuildOpenStackInstance(inst.id, { image: rebuildImageId }),
              'Rebuild submitted',
            )}
            className={statusSurfaceClasses('warn', 'px-3 py-1.5 rounded-lg text-sm disabled:opacity-40')}
          >
            Rebuild
          </button>
        </div>
      </section>

      <section className="rounded-xl border border-slate-700/80 p-4">
        <h2 className="font-medium text-slate-200 mb-3 flex items-center gap-2">
          <Tags className="w-4 h-4 text-sky-400" /> Metadata
        </h2>
        <textarea
          aria-label="Instance metadata (key=value, one per line)"
          value={metadataText}
          onChange={(e) => setMetadataText(e.target.value)}
          rows={4}
          className="w-full px-3 py-2 rounded-lg bg-slate-900 border border-slate-700 text-slate-100 font-mono text-xs"
          placeholder="key=value (one per line)"
        />
        <button
          type="button"
          className="mt-2 px-3 py-1.5 rounded-lg border border-slate-600 text-sm hover:bg-slate-800"
          onClick={() => {
            const metadata: Record<string, string> = {}
            for (const line of metadataText.split('\n')) {
              const t = line.trim()
              if (!t || t.startsWith('#')) continue
              const eq = t.indexOf('=')
              if (eq <= 0) {
                toast.error(`Invalid line: ${t}`)
                return
              }
              metadata[t.slice(0, eq).trim()] = t.slice(eq + 1).trim()
            }
            void run(
              () => updateOpenStackMetadata(inst.id, { metadata }),
              'Metadata updated',
            )
          }}
        >
          Save metadata
        </button>
      </section>

      <section className="rounded-xl border border-slate-700/80 p-4">
        <h2 className="font-medium text-slate-200 mb-3 flex items-center gap-2">
          <HardDrive className="w-4 h-4 text-sky-400" /> Cinder volumes
        </h2>
        <div className="flex flex-wrap gap-2 items-end mb-4 pb-4 border-b border-slate-700/60">
          <div>
            <label className="block text-xs text-slate-500 mb-1">Create volume (GB)</label>
            <input
              type="number"
              min={1}
              value={newVolSizeGb}
              onChange={(e) => setNewVolSizeGb(e.target.value)}
              className="w-20 px-2 py-1.5 rounded-lg bg-slate-900 border border-slate-700 text-sm"
            />
          </div>
          <div>
            <label className="block text-xs text-slate-500 mb-1">Name (optional)</label>
            <input
              value={newVolName}
              onChange={(e) => setNewVolName(e.target.value)}
              className="px-2 py-1.5 rounded-lg bg-slate-900 border border-slate-700 text-sm"
              placeholder="data-vol"
            />
          </div>
          <button
            type="button"
            onClick={() => {
              const size = Number.parseInt(newVolSizeGb, 10)
              if (!Number.isFinite(size) || size < 1) {
                toast.warning('Enter a valid size in GB')
                return
              }
              void run(
                () => createOpenStackVolume({
                  size_gb: size,
                  name: newVolName.trim() || undefined,
                }),
                'Volume created',
              )
            }}
            className="px-3 py-1.5 rounded-lg bg-sky-600 hover:bg-sky-500 text-sm text-white"
          >
            Create volume
          </button>
        </div>
        <div className="flex flex-wrap gap-2 items-end mb-3">
          <div>
            <label className="block text-xs text-slate-500 mb-1">Attach volume</label>
            <select aria-label="Volume to attach" value={attachVolId} onChange={(e) => setAttachVolId(e.target.value)}
              className="px-2 py-1.5 rounded-lg bg-slate-900 border border-slate-700 text-sm max-w-md">
              <option value="">Select unattached volume…</option>
              {cinderVols.map((v) => (
                <option key={v.id} value={v.id}>{v.name || v.id} ({v.size_gb} GB)</option>
              ))}
            </select>
          </div>
          <button type="button" disabled={!attachVolId}
            onClick={() => run(() => attachOpenStackVolume(inst.id, attachVolId), 'Volume attached')}
            className="px-3 py-1.5 rounded-lg border border-slate-600 text-sm hover:bg-slate-800 disabled:opacity-40">
            Attach
          </button>
        </div>
        {volumes.length > 0 && (
          <ul className="space-y-2 text-sm">
            {volumes.map((v) => (
              <li key={v.id} className="flex flex-wrap items-center gap-2 font-mono text-slate-300">
                <span>{v.device || '—'}</span>
                <span className="text-slate-500">· {v.name || v.id}</span>
                <button type="button" onClick={() => run(() => detachOpenStackVolume(inst.id, v.id), 'Detached')}
                  className={`text-xs ${statusActionLinkClasses('error', 'hover:underline')}`}>Detach</button>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="rounded-xl border border-slate-700/80 p-4">
        <h2 className="font-medium text-slate-200 mb-3 flex items-center gap-2">
          <Shield className="w-4 h-4 text-sky-400" /> Security groups
          <Link to="/openstack/security-groups" className="text-xs text-sky-400 hover:underline ml-auto font-normal">
            View all rules
          </Link>
        </h2>
        <div className="flex flex-wrap gap-2 items-end mb-2">
          <input aria-label="Security group name" value={sgName} onChange={(e) => setSgName(e.target.value)} placeholder="group name"
            className="px-3 py-1.5 rounded-lg bg-slate-900 border border-slate-700 text-sm" />
          <button type="button" disabled={!sgName.trim()}
            onClick={() => run(() => addOpenStackSecurityGroup(inst.id, sgName.trim()), 'Security group added')}
            className="px-3 py-1.5 rounded-lg border border-slate-600 text-sm disabled:opacity-40">Add</button>
        </div>
        {inst.security_groups.length > 0 && (
          <ul className="flex flex-wrap gap-2">
            {inst.security_groups.map((g) => (
              <li key={g} className="flex items-center gap-1 px-2 py-1 rounded bg-slate-800 text-sm">
                {g}
                <button type="button" className={`${statusActionLinkClasses('error', 'text-xs ml-1')}`}
                  onClick={() => run(() => removeOpenStackSecurityGroup(inst.id, g), 'Removed')}>×</button>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="rounded-xl border border-slate-700/80 p-4">
        <h2 className="font-medium text-slate-200 mb-2 flex items-center gap-2">
          <Upload className="w-4 h-4 text-sky-400" /> Export to Glance
        </h2>
        <p className="text-slate-500 text-sm mb-3">
          Snapshot to Glance and optionally pull qcow2 to this hypervisor for libvirt import.
        </p>
        <button
          type="button"
          onClick={() => setExportOpen(true)}
          className="px-3 py-1.5 rounded-lg bg-sky-600 hover:bg-sky-500 text-sm text-white"
        >
          Export to hypervisor…
        </button>
      </section>

      <OpenStackExportModal
        open={exportOpen}
        instanceId={inst.id}
        instanceName={inst.name}
        onClose={() => setExportOpen(false)}
      />
    </div>
  )
}
