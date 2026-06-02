// Copyright (c) 2026 ZyvorAI Labs Private Limited. All rights reserved.
// Proprietary software — see LICENSE in the repository root.
// https://zyvor.dev · info@zyvor.dev

import { useCallback, useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router'
import {
  createOpenStackInstance,
  listOpenStackCinderVolumes,
  listOpenStackFlavors,
  listOpenStackImages,
  listOpenStackNetworks,
  listOpenStackKeypairs,
  type OpenStackAttachedVolume,
  type OpenStackBootSource,
  type OpenStackFlavor,
  type OpenStackImage,
  type OpenStackNetwork,
  type OpenStackKeyPair,
} from '../api/openstack'
import { useToastContext } from '../contexts/ToastContext'
import { usePlatformInfo } from '../contexts/PlatformInfoContext'
import { useOpenStackConnection } from '../hooks/useOpenStackConnection'
import { ChoiceCard, ChoiceCardGrid } from '../components/ChoiceCards'
import { ArrowLeft, Cloud, Disc, Loader2, Network, RefreshCw } from 'lucide-react'
import OpenStackFooter from '../components/OpenStackFooter'
import PageLayout from '../components/PageLayout'
import OpenStackGate from '../components/OpenStackGate'
import OpenStackSubNav from '../components/OpenStackSubNav'
import OpenStackStatusBar from '../components/OpenStackStatusBar'
import ErrorBanner from '../components/ErrorBanner'
import { statusBadgeClasses, statusSurfaceClasses, statusToneClass } from '../utils/semanticColors'
import {
  createOpenStackVolumeFromSnapshot,
  listOpenStackServerGroups,
  listOpenStackVolumeSnapshots,
  listOpenStackAvailabilityZones,
  type OpenStackVolumeSnapshot,
  type OpenStackAvailabilityZone,
} from '../api/openstackExtras'
import { formatUserError } from '../utils/apiError'
import { openStackErrorHints } from '../utils/openstackHints'

const STEPS = ['Source', 'Flavor', 'Network & access', 'Review'] as const

type CatalogKey = 'flavors' | 'images' | 'networks' | 'keypairs' | 'volumes'

export default function OpenStackCreateInstancePage() {
  return (
    <OpenStackGate title="Create OpenStack Instance">
      <OpenStackCreateInstanceContent />
    </OpenStackGate>
  )
}

function OpenStackCreateInstanceContent() {
  const navigate = useNavigate()
  const toast = useToastContext()
  const { info } = usePlatformInfo()
  const { computeLive, connectionHint } = useOpenStackConnection()
  const [step, setStep] = useState(0)
  const [loading, setLoading] = useState(true)
  const [submitting, setSubmitting] = useState(false)
  const [createError, setCreateError] = useState<string | null>(null)
  const [catalogErrors, setCatalogErrors] = useState<Partial<Record<CatalogKey, string>>>({})

  const [flavors, setFlavors] = useState<OpenStackFlavor[]>([])
  const [images, setImages] = useState<OpenStackImage[]>([])
  const [allImages, setAllImages] = useState<OpenStackImage[]>([])
  const [networks, setNetworks] = useState<OpenStackNetwork[]>([])
  const [keypairs, setKeypairs] = useState<OpenStackKeyPair[]>([])
  const [cinderVolumes, setCinderVolumes] = useState<OpenStackAttachedVolume[]>([])

  const [name, setName] = useState('')
  const [bootSource, setBootSource] = useState<OpenStackBootSource>('image')
  const [imageId, setImageId] = useState('')
  const [bootVolumeId, setBootVolumeId] = useState('')
  const [bootVolumeImageId, setBootVolumeImageId] = useState('')
  const [bootVolumeSizeGb, setBootVolumeSizeGb] = useState('8')
  const [flavorId, setFlavorId] = useState('')
  const [networkId, setNetworkId] = useState('')
  const [keyName, setKeyName] = useState('')
  const [availabilityZone, setAvailabilityZone] = useState('')
  const [securityGroups, setSecurityGroups] = useState('')
  const [userData, setUserData] = useState('')
  const [waitActive, setWaitActive] = useState(true)
  const [serverGroupId, setServerGroupId] = useState('')
  const [extraNetworks, setExtraNetworks] = useState('')
  const [serverGroups, setServerGroups] = useState<{ id: string; name: string; policy: string }[]>([])
  const [availabilityZones, setAvailabilityZones] = useState<OpenStackAvailabilityZone[]>([])
  const [volumeSnapshots, setVolumeSnapshots] = useState<OpenStackVolumeSnapshot[]>([])
  const [bootSnapshotId, setBootSnapshotId] = useState('')

  const loadCatalogs = useCallback(async () => {
    setLoading(true)
    setCatalogErrors({})
    const [flavorsR, imagesR, networksR, keypairsR, volumesR, sgR, snapsR, azR] = await Promise.allSettled([
      listOpenStackFlavors(),
      listOpenStackImages(),
      listOpenStackNetworks(),
      listOpenStackKeypairs(),
      listOpenStackCinderVolumes(),
      listOpenStackServerGroups(),
      listOpenStackVolumeSnapshots(),
      listOpenStackAvailabilityZones(),
    ])

    const errs: Partial<Record<CatalogKey, string>> = {}
    const os = info?.openstack

    if (flavorsR.status === 'fulfilled') {
      const flavorsList = flavorsR.value.flavors
      setFlavors(flavorsList)
      if (os?.default_flavor) {
        const match = flavorsList.find(
          (fl) => fl.id === os.default_flavor || fl.name === os.default_flavor,
        )
        if (match) setFlavorId(match.id)
      }
    } else {
      errs.flavors = formatUserError(flavorsR.reason)
      setFlavors([])
    }

    if (imagesR.status === 'fulfilled') {
      const imagesList = imagesR.value.images
      setAllImages(imagesList)
      const active = imagesList.filter((img) => img.status === 'ACTIVE')
      setImages(active)
    } else {
      errs.images = formatUserError(imagesR.reason)
      setImages([])
      setAllImages([])
    }

    if (networksR.status === 'fulfilled') {
      const networksList = networksR.value.networks
      setNetworks(networksList)
      if (os?.default_network) {
        const match = networksList.find(
          (net) => net.id === os.default_network || net.name === os.default_network,
        )
        if (match) setNetworkId(match.id)
      }
    } else {
      errs.networks = formatUserError(networksR.reason)
      setNetworks([])
    }

    if (keypairsR.status === 'fulfilled') {
      const keypairsList = keypairsR.value.keypairs
      setKeypairs(keypairsList)
      if (os?.default_key_name) {
        const match = keypairsList.find((kp) => kp.name === os.default_key_name)
        if (match) setKeyName(match.name)
      }
    } else {
      errs.keypairs = formatUserError(keypairsR.reason)
      setKeypairs([])
    }

    if (volumesR.status === 'fulfilled') {
      const unattached = volumesR.value.volumes.filter((v) => !v.server_id)
      setCinderVolumes(unattached)
    } else {
      errs.volumes = formatUserError(volumesR.reason)
      setCinderVolumes([])
    }

    if (sgR.status === 'fulfilled') {
      setServerGroups(sgR.value.server_groups)
    } else {
      setServerGroups([])
    }

    if (snapsR.status === 'fulfilled') {
      setVolumeSnapshots(snapsR.value.snapshots)
    } else {
      setVolumeSnapshots([])
    }

    if (azR.status === 'fulfilled') {
      setAvailabilityZones(azR.value.availability_zones)
    } else {
      setAvailabilityZones([])
    }

    setCatalogErrors(errs)
    setLoading(false)

    const failed = Object.keys(errs)
    if (failed.length === 4) {
      toast.error('Could not load any OpenStack catalogs — see error panel')
    } else if (failed.length > 0) {
      toast.warning(`Some catalogs failed: ${failed.join(', ')}`)
    }
  }, [info?.openstack, toast])

  useEffect(() => {
    void loadCatalogs()
  }, [loadCatalogs])

  const selectedFlavor = flavors.find((f) => f.id === flavorId || f.name === flavorId)
  const selectedImage = images.find((i) => i.id === imageId)
  const selectedBootVolume = cinderVolumes.find((v) => v.id === bootVolumeId)
  const selectedBootVolumeImage = images.find((i) => i.id === bootVolumeImageId)
  const selectedNetwork = networks.find((n) => n.id === networkId || n.name === networkId)
  const bootVolumeSize = Number.parseInt(bootVolumeSizeGb, 10)

  const catalogErrorSummary = Object.entries(catalogErrors)
    .map(([k, v]) => `${k}: ${v}`)
    .join('\n')

  const canNext = () => {
    if (step === 0) {
      if (!name.trim()) return false
      if (bootSource === 'image') {
        if (catalogErrors.images) return false
        return imageId.length > 0
      }
      if (bootSource === 'volume') {
        if (catalogErrors.volumes) return false
        return bootVolumeId.length > 0
      }
      if (bootSource === 'new_volume') {
        if (catalogErrors.images) return false
        return bootVolumeImageId.length > 0 && Number.isFinite(bootVolumeSize) && bootVolumeSize > 0
      }
      if (bootSource === 'snapshot') return bootSnapshotId.length > 0
      return false
    }
    if (step === 1) {
      if (catalogErrors.flavors) return false
      return flavorId.length > 0
    }
    if (step === 2) {
      if (catalogErrors.networks) return false
      return networkId.length > 0
    }
    return true
  }

  const handleCreate = async () => {
    const hasBoot =
      (bootSource === 'image' && imageId) ||
      (bootSource === 'volume' && bootVolumeId) ||
      (bootSource === 'new_volume' && bootVolumeImageId && bootVolumeSize > 0) ||
      (bootSource === 'snapshot' && bootSnapshotId)
    if (!name.trim() || !flavorId || !hasBoot || !networkId) {
      toast.warning('Complete all required fields')
      return
    }
    setSubmitting(true)
    setCreateError(null)
    try {
      let resolvedBootVolumeId = bootSource === 'volume' ? bootVolumeId : undefined
      if (bootSource === 'snapshot') {
        const vol = await createOpenStackVolumeFromSnapshot({
          snapshot_id: bootSnapshotId,
          name: `${name.trim()}-boot`,
        })
        resolvedBootVolumeId = vol.volume.id
      }
      const sgList = securityGroups
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean)
      const extraNetList = extraNetworks
        .split(',')
        .map((s) => s.trim())
        .filter((n) => n && n !== networkId)
      const resp = await createOpenStackInstance({
        name: name.trim(),
        flavor: flavorId,
        image: bootSource === 'image' ? imageId : undefined,
        boot_volume_id: resolvedBootVolumeId,
        boot_volume_image: bootSource === 'new_volume' ? bootVolumeImageId : undefined,
        boot_volume_size_gb: bootSource === 'new_volume' ? bootVolumeSize : undefined,
        network: networkId,
        networks: extraNetList.length > 0 ? extraNetList : undefined,
        server_group: serverGroupId.trim() || undefined,
        key_name: keyName || undefined,
        availability_zone: availabilityZone.trim() || undefined,
        security_groups: sgList.length > 0 ? sgList : undefined,
        user_data: userData.trim() || undefined,
        wait_until_active: waitActive,
      })
      toast.success(`Instance ${resp.name} created (${resp.status})`)
      navigate(`/openstack/instances/${encodeURIComponent(resp.id)}`)
    } catch (e: unknown) {
      const msg = formatUserError(e)
      setCreateError(msg)
      toast.error(`Create failed: ${msg}`)
    } finally {
      setSubmitting(false)
    }
  }

  if (loading) {
    return (
      <PageLayout
      hideHeader
      className="max-w-3xl"
      prepend={<><OpenStackSubNav /></>}
    >
      <div className="text-slate-500 py-12 text-center flex flex-col items-center gap-3">
          <Loader2 className="w-8 h-8 animate-spin text-sky-400" />
          Loading OpenStack catalogs…
        </div>
      </PageLayout>
    )
  }

  return (
    <PageLayout
      className="max-w-3xl"
      prepend={<><OpenStackSubNav /><OpenStackStatusBar /></>}
      title="Create OpenStack instance"
      icon={<Cloud className="w-7 h-7 text-sky-400" />}
      actions={
        <Link to="/openstack/instances" className="inline-flex items-center gap-2 text-slate-400 hover:text-slate-200 text-sm">
          <ArrowLeft className="w-4 h-4" />
          Instances
        </Link>
      }
    >
      {!computeLive && connectionHint && (
        <div className={`rounded-xl px-4 py-3 text-sm ${statusSurfaceClasses('warn')}`}>
          {connectionHint}
        </div>
      )}

      {createError && (
        <ErrorBanner
          title="Create instance failed"
          headline={createError}
          hints={openStackErrorHints(createError)}
          technicalDetail={createError}
          tone="red"
          onDismiss={() => setCreateError(null)}
        />
      )}

      {catalogErrorSummary && (
        <ErrorBanner
          title="OpenStack catalog errors"
          headline={
            Object.keys(catalogErrors).length === 4
              ? 'Could not load flavors, images, networks, or keypairs from the API.'
              : `Failed to load: ${Object.keys(catalogErrors).join(', ')}. Other catalogs may still be usable.`
          }
          hints={openStackErrorHints(catalogErrorSummary)}
          technicalDetail={catalogErrorSummary}
          tone="red"
          onRetry={() => void loadCatalogs()}
          retryLabel="Reload catalogs"
        />
      )}

      <div className="flex gap-2 text-xs text-slate-500">
        {STEPS.map((label, i) => (
          <span key={label} className={i === step ? 'text-sky-400 font-medium' : ''}>
            {i + 1}. {label}
          </span>
        ))}
      </div>

      {step === 0 && (
        <div className="space-y-4">
          <div>
            <label className="block text-sm text-slate-400 mb-1">Instance name</label>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="w-full px-3 py-2 rounded-lg bg-slate-900 border border-slate-700 text-slate-100"
              placeholder="my-vm"
            />
          </div>
          <div>
            <label className="block text-sm text-slate-400 mb-2">Boot source</label>
            <div className="flex flex-wrap gap-2 mb-4">
              {([
                ['image', 'Glance image'],
                ['volume', 'Existing Cinder volume'],
                ['new_volume', 'New volume from image'],
                ['snapshot', 'Volume snapshot'],
              ] as const).map(([id, label]) => (
                <button
                  key={id}
                  type="button"
                  onClick={() => setBootSource(id)}
                  className={`px-3 py-1.5 rounded-lg text-sm border ${
                    bootSource === id
                      ? 'border-sky-500 bg-sky-500/15 text-sky-200'
                      : 'border-slate-600 text-slate-400 hover:bg-slate-800'
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>
          {bootSource === 'image' && (
            <div>
              <label className="block text-sm text-slate-400 mb-2">Glance image</label>
              {catalogErrors.images ? (
                <p className="text-sm text-red-300/90">{catalogErrors.images}</p>
              ) : (
                <ChoiceCardGrid>
                  {images.map((img) => (
                    <ChoiceCard
                      key={img.id}
                      tone="sky"
                      icon={<Disc className="w-4 h-4" />}
                      selected={imageId === img.id}
                      onClick={() => setImageId(img.id)}
                      title={img.name || img.id.slice(0, 8)}
                      description={`${img.min_disk_gb} GB disk · ${img.min_ram_mb} MB RAM min`}
                    />
                  ))}
                </ChoiceCardGrid>
              )}
              {!catalogErrors.images && images.length === 0 && (
                <div className={`rounded-xl px-4 py-3 text-sm space-y-2 ${statusSurfaceClasses('warn')}`}>
                  <p>No ACTIVE images in this project.</p>
                  {allImages.length > 0 && (
                    <p className={`text-xs opacity-80 ${statusToneClass('warn')}`}>
                      {allImages.length} image(s) exist but none are ACTIVE yet — wait for upload/import to finish.
                    </p>
                  )}
                  <p className="text-xs text-slate-400">
                    <Link to="/disk-images" className="text-sky-400 hover:underline">
                      Push qcow2 from Disk images
                    </Link>
                    {' · '}
                    <Link to="/import" className="text-sky-400 hover:underline">
                      Import VM
                    </Link>
                    {' · on host: '}
                    <code className="text-[11px]">openstack image list</code>
                  </p>
                </div>
              )}
            </div>
          )}
          {bootSource === 'volume' && (
            <div>
              <label className="block text-sm text-slate-400 mb-2">Cinder boot volume</label>
              {catalogErrors.volumes ? (
                <p className="text-sm text-red-300/90">{catalogErrors.volumes}</p>
              ) : cinderVolumes.length === 0 ? (
                <p className="text-sm text-slate-500">No unattached volumes. Create one on the instance detail page or via the API.</p>
              ) : (
                <ChoiceCardGrid>
                  {cinderVolumes.map((vol) => (
                    <ChoiceCard
                      key={vol.id}
                      tone="violet"
                      icon={<Disc className="w-4 h-4" />}
                      selected={bootVolumeId === vol.id}
                      onClick={() => setBootVolumeId(vol.id)}
                      title={vol.name || vol.id.slice(0, 8)}
                      description={`${vol.size_gb} GB${vol.bootable ? ' · bootable' : ''}`}
                    />
                  ))}
                </ChoiceCardGrid>
              )}
            </div>
          )}
          {bootSource === 'snapshot' && (
            <div>
              <label className="block text-sm text-slate-400 mb-2">Cinder snapshot</label>
              {volumeSnapshots.length === 0 ? (
                <p className="text-sm text-slate-500">No volume snapshots. Create one from the Volumes page.</p>
              ) : (
                <select
                  value={bootSnapshotId}
                  onChange={(e) => setBootSnapshotId(e.target.value)}
                  className="w-full px-3 py-2 rounded-lg bg-slate-900 border border-slate-700 text-slate-100"
                >
                  <option value="">Select snapshot…</option>
                  {volumeSnapshots.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name || s.id.slice(0, 8)} ({s.size_gb} GB · {s.status})
                    </option>
                  ))}
                </select>
              )}
              <p className="text-xs text-slate-500 mt-2">Creates a boot volume from the snapshot, then launches the instance.</p>
            </div>
          )}
          {bootSource === 'new_volume' && (
            <div className="space-y-4">
              <div>
                <label className="block text-sm text-slate-400 mb-2">Source Glance image</label>
                {catalogErrors.images ? (
                  <p className="text-sm text-red-300/90">{catalogErrors.images}</p>
                ) : (
                  <ChoiceCardGrid>
                    {images.map((img) => (
                      <ChoiceCard
                        key={img.id}
                        tone="sky"
                        icon={<Disc className="w-4 h-4" />}
                        selected={bootVolumeImageId === img.id}
                        onClick={() => {
                          setBootVolumeImageId(img.id)
                          const min = Math.max(img.min_disk_gb, 1)
                          setBootVolumeSizeGb(String(min))
                        }}
                        title={img.name || img.id.slice(0, 8)}
                        description={`min ${img.min_disk_gb} GB disk`}
                      />
                    ))}
                  </ChoiceCardGrid>
                )}
              </div>
              <div>
                <label className="block text-sm text-slate-400 mb-1">New boot volume size (GB)</label>
                <input
                  type="number"
                  min={1}
                  value={bootVolumeSizeGb}
                  onChange={(e) => setBootVolumeSizeGb(e.target.value)}
                  className="w-32 px-3 py-2 rounded-lg bg-slate-900 border border-slate-700 text-slate-100"
                />
              </div>
            </div>
          )}
        </div>
      )}

      {step === 1 && (
        <div>
          <label className="block text-sm text-slate-400 mb-2">Flavor</label>
          {catalogErrors.flavors ? (
            <p className="text-sm text-red-300/90">{catalogErrors.flavors}</p>
          ) : flavors.length === 0 ? (
            <p className="text-sm text-slate-500">No flavors returned from Nova.</p>
          ) : (
            <div className="overflow-x-auto rounded-xl border border-slate-700">
              <table className="w-full text-sm">
                <thead className="bg-slate-900 text-slate-400 text-left">
                  <tr>
                    <th className="px-3 py-2" />
                    <th className="px-3 py-2">Name</th>
                    <th className="px-3 py-2">vCPU</th>
                    <th className="px-3 py-2">RAM</th>
                    <th className="px-3 py-2">Disk</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800">
                  {flavors.map((f) => (
                    <tr
                      key={f.id}
                      className={`cursor-pointer hover:bg-slate-800/50 ${flavorId === f.id ? 'bg-sky-500/10' : ''}`}
                      onClick={() => setFlavorId(f.id)}
                    >
                      <td className="px-3 py-2">
                        <input type="radio" checked={flavorId === f.id} readOnly />
                      </td>
                      <td className="px-3 py-2 text-slate-200">{f.name}</td>
                      <td className="px-3 py-2">{f.vcpus}</td>
                      <td className="px-3 py-2">{f.ram_mb} MB</td>
                      <td className="px-3 py-2">{f.disk_gb} GB</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {step === 2 && (
        <div className="space-y-4">
          <div>
            <label className="block text-sm text-slate-400 mb-2">Network</label>
            {catalogErrors.networks ? (
              <p className="text-sm text-red-300/90">{catalogErrors.networks}</p>
            ) : networks.length === 0 ? (
              <p className="text-sm text-slate-500">
                No Neutron networks available. Fix Neutron on the host, then reload catalogs.
              </p>
            ) : (
              <ChoiceCardGrid>
                {networks.map((net) => (
                  <ChoiceCard
                    key={net.id}
                    tone="cyan"
                    icon={<Network className="w-4 h-4" />}
                    selected={networkId === net.id}
                    onClick={() => setNetworkId(net.id)}
                    title={net.name || net.id.slice(0, 8)}
                    description={net.external ? 'External' : 'Internal'}
                  />
                ))}
              </ChoiceCardGrid>
            )}
          </div>
          <div>
            <label className="block text-sm text-slate-400 mb-1">Additional networks (optional)</label>
            <input
              value={extraNetworks}
              onChange={(e) => setExtraNetworks(e.target.value)}
              className="w-full px-3 py-2 rounded-lg bg-slate-900 border border-slate-700 text-slate-100 font-mono text-sm"
              placeholder="net-uuid-2, net-uuid-3 (comma-separated, besides primary)"
            />
            <p className="text-xs text-slate-500 mt-1">Multi-NIC: primary network above plus these Neutron network IDs.</p>
          </div>
          <div>
            <label className="block text-sm text-slate-400 mb-1">Server group (optional)</label>
            <select
              value={serverGroupId}
              onChange={(e) => setServerGroupId(e.target.value)}
              className="w-full px-3 py-2 rounded-lg bg-slate-900 border border-slate-700 text-slate-100"
            >
              <option value="">None</option>
              {serverGroups.map((g) => (
                <option key={g.id} value={g.id}>
                  {g.name} ({g.policy})
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-sm text-slate-400 mb-1">SSH key pair (optional)</label>
            {catalogErrors.keypairs && (
              <p className={`text-xs mb-1 ${statusToneClass('warn')}`}>Keypairs unavailable: {catalogErrors.keypairs}</p>
            )}
            <select
              value={keyName}
              onChange={(e) => setKeyName(e.target.value)}
              className="w-full px-3 py-2 rounded-lg bg-slate-900 border border-slate-700 text-slate-100"
            >
              <option value="">None</option>
              {keypairs.map((kp) => (
                <option key={kp.name} value={kp.name}>{kp.name}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-sm text-slate-400 mb-1">Availability zone (optional)</label>
            <select
              value={availabilityZone}
              onChange={(e) => setAvailabilityZone(e.target.value)}
              className="w-full px-3 py-2 rounded-lg bg-slate-900 border border-slate-700 text-slate-100"
            >
              <option value="">Default</option>
              {availabilityZones.map((z) => (
                <option key={z.name} value={z.name}>{z.name} ({z.state})</option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-sm text-slate-400 mb-1">Security groups (comma-separated, optional)</label>
            <input
              value={securityGroups}
              onChange={(e) => setSecurityGroups(e.target.value)}
              className="w-full px-3 py-2 rounded-lg bg-slate-900 border border-slate-700 text-slate-100"
              placeholder="default"
            />
          </div>
          <div>
            <label className="block text-sm text-slate-400 mb-1">Cloud-init user_data (optional)</label>
            <textarea
              value={userData}
              onChange={(e) => setUserData(e.target.value)}
              rows={4}
              className="w-full px-3 py-2 rounded-lg bg-slate-900 border border-slate-700 text-slate-100 font-mono text-xs"
              placeholder="#cloud-config&#10;ssh_pwauth: true"
            />
          </div>
        </div>
      )}

      {step === 3 && (
        <div className="rounded-xl border border-slate-700 p-4 space-y-2 text-sm">
          <p><span className="text-slate-500">Name:</span> {name}</p>
          <p><span className="text-slate-500">Boot:</span>{' '}
            {bootSource === 'image' && `Glance · ${selectedImage?.name || imageId}`}
            {bootSource === 'volume' && `Volume · ${selectedBootVolume?.name || bootVolumeId}`}
            {bootSource === 'new_volume' &&
              `New ${bootVolumeSize} GB from ${selectedBootVolumeImage?.name || bootVolumeImageId}`}
            {bootSource === 'snapshot' &&
              `Snapshot · ${volumeSnapshots.find((s) => s.id === bootSnapshotId)?.name || bootSnapshotId}`}
          </p>
          <p><span className="text-slate-500">Flavor:</span> {selectedFlavor?.name} ({selectedFlavor?.vcpus} vCPU, {selectedFlavor?.ram_mb} MB)</p>
          <p><span className="text-slate-500">Network:</span> {selectedNetwork?.name || networkId}</p>
          <p><span className="text-slate-500">Extra networks:</span> {extraNetworks.trim() || '—'}</p>
          <p><span className="text-slate-500">Server group:</span>{' '}
            {serverGroups.find((g) => g.id === serverGroupId)?.name || serverGroupId || '—'}
          </p>
          <p><span className="text-slate-500">Key pair:</span> {keyName || '—'}</p>
          <p><span className="text-slate-500">AZ:</span> {availabilityZone || '—'}</p>
          <p><span className="text-slate-500">Security groups:</span> {securityGroups || '—'}</p>
          <p><span className="text-slate-500">user_data:</span> {userData.trim() ? `${userData.trim().length} chars` : '—'}</p>
          <label className="flex items-center gap-2 mt-3 text-slate-400">
            <input type="checkbox" checked={waitActive} onChange={(e) => setWaitActive(e.target.checked)} />
            Wait until ACTIVE (may take several minutes)
          </label>
        </div>
      )}

      <div className="flex justify-between pt-4">
        <button
          type="button"
          disabled={step === 0}
          onClick={() => setStep((s) => s - 1)}
          className="px-4 py-2 rounded-lg border border-slate-600 text-slate-300 disabled:opacity-40"
        >
          Back
        </button>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => void loadCatalogs()}
            className="inline-flex items-center gap-2 px-3 py-2 rounded-lg border border-slate-600 text-slate-300 text-sm hover:bg-slate-800"
          >
            <RefreshCw className="w-4 h-4" />
            Reload
          </button>
          {step < STEPS.length - 1 ? (
            <button
              type="button"
              disabled={!canNext()}
              onClick={() => setStep((s) => s + 1)}
              className="px-4 py-2 rounded-lg bg-sky-600 hover:bg-sky-500 text-white disabled:opacity-40"
            >
              Next
            </button>
          ) : (
            <button
              type="button"
              disabled={
                submitting ||
                Boolean(
                  catalogErrors.flavors ||
                    catalogErrors.networks ||
                    (bootSource !== 'volume' && catalogErrors.images) ||
                    (bootSource === 'volume' && catalogErrors.volumes),
                )
              }
              onClick={handleCreate}
              className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-sky-600 hover:bg-sky-500 text-white disabled:opacity-50"
            >
              {submitting && <Loader2 className="w-4 h-4 animate-spin" />}
              Create instance
            </button>
          )}
        </div>
      </div>

      <OpenStackFooter />
    </PageLayout>
  )
}
