// Copyright 2026 Zyvor AI Labs · https://zyvor.dev
// SPDX-License-Identifier: LicenseRef-Zyvor-Production-1.0

import { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router'
import PageLayout from '../../../components/PageLayout'
import { StructuredErrorBanner } from '../../../components/StructuredErrorBanner'
import SimpleCreateVmWizard, {
  cloudInitUserForOs,
  sizeToSpec,
  type VmWizardPayload,
} from '../../../components/platform/SimpleCreateVmWizard'
import { toastQueuedOperation } from '../../../utils/platformTaskToast'
import { useToastContext } from '../../../contexts/ToastContext'
import { formatUserError } from '../../../utils/apiError'
import {
  createFromTemplate,
  createPlatformVm,
  listMissingTemplateImages,
  type CreatePlatformVmBody,
} from '../../../api/platform'
import { usePlatformDesktopTier } from '../../../hooks/usePlatformDesktopTier'
import { dispatchOpenSpotlight, SCROLL_GEOGRAPHY_EVENT } from '../../../utils/platformJarvisShell'
import MissionControlBriefing from './MissionControlBriefing'
import MissionControlGeography from './MissionControlGeography'
import MissionControlHero from './MissionControlHero'
import MissionControlLaunchpad from './MissionControlLaunchpad'
import { useMissionControlFleet } from './useMissionControlFleet'
import EnterpriseSecurityStrip from '../../../components/platform/EnterpriseSecurityStrip'

export default function MissionControlPage() {
  const toast = useToastContext()
  const navigate = useNavigate()
  const [tier] = usePlatformDesktopTier()
  const state = useMissionControlFleet()
  const [searchParams] = useSearchParams()
  const [wizardOpen, setWizardOpen] = useState(false)
  const [missingImagesCount, setMissingImagesCount] = useState(0)
  const [geoExpanded, setGeoExpanded] = useState(searchParams.get('mission') === '1')

  useEffect(() => {
    void listMissingTemplateImages()
      .then((r) => setMissingImagesCount(r.missing?.length ?? 0))
      .catch(() => setMissingImagesCount(0))
  }, [])

  useEffect(() => {
    const onGeo = () => {
      setGeoExpanded(true)
      requestAnimationFrame(() => document.getElementById('geography')?.scrollIntoView({ behavior: 'smooth' }))
    }
    window.addEventListener(SCROLL_GEOGRAPHY_EVENT, onGeo)
    return () => window.removeEventListener(SCROLL_GEOGRAPHY_EVENT, onGeo)
  }, [])

  useEffect(() => {
    if (searchParams.get('mission') === '1') {
      setGeoExpanded(true)
      requestAnimationFrame(() => {
        document.getElementById('geography')?.scrollIntoView({ behavior: 'smooth' })
      })
    }
  }, [searchParams])

  const warnings = useMemo(() => {
    const offline = state.hosts.length - state.onlineHosts
    return offline
  }, [state.hosts.length, state.onlineHosts])

  const handleCreate = async (payload: VmWizardPayload) => {
    try {
      if (payload.os === 'custom-iso') {
        navigate(`/platform/create-iso?name=${encodeURIComponent(payload.name)}`)
        return
      }
      if (payload.os === 'custom-virt-install') {
        const q = new URLSearchParams({ name: payload.name })
        if (payload.network) q.set('network', payload.network)
        navigate(`/platform/create-advanced?${q}`)
        return
      }
      if (payload.windows) {
        const wspec = sizeToSpec(payload.size)
        const labels: Record<string, string> = { os_family: 'windows' }
        if (payload.windows.tpm) labels.tpm = 'true'
        if (payload.windows.secureBoot) labels.secure_boot = 'true'
        if (payload.windows.virtio) {
          labels.virtio_win = 'true'
          if (payload.windows.virtioIsoPath.trim()) labels.virtio_win_iso = payload.windows.virtioIsoPath.trim()
        }
        const wbody: CreatePlatformVmBody = {
          api_version: 'virt.zyvor.dev/v1',
          kind: 'VirtualMachine',
          metadata: { name: payload.name, labels },
          tags: ['windows', payload.os, payload.network],
          spec: {
            cpu: { sockets: 1, cores: wspec.cores },
            memory: wspec.memory,
            firmware: payload.windows.uefi ? 'uefi' : 'bios',
            storage: [{ name: 'root', size: wspec.disk, class: 'silver' }],
            network: [{ network: payload.network, ip_mode: 'dhcp' }],
          },
        }
        const wr = await createPlatformVm(wbody)
        toastQueuedOperation(toast, `Creating ${payload.name}`, wr.task_id, tier)
        await state.load()
        navigate('/platform/vms')
        return
      }
      const spec = sizeToSpec(payload.size, payload.customSpec)
      if (payload.fromTemplate) {
        const r = await createFromTemplate({
          template_ref: `${payload.os}@${payload.templateVersion ?? '1.0.0'}`,
          name: payload.name,
          memory: spec.memory,
          template_vars: { hostname: payload.name, name: payload.name },
          cloud_init_user: cloudInitUserForOs(payload.os),
          cloud_init_ssh_pubkey: payload.cloudInitSshPubkey,
        })
        toastQueuedOperation(toast, `Deploying ${payload.name}`, r.task_id, tier)
      } else {
        const body: CreatePlatformVmBody = {
          api_version: 'virt.zyvor.dev/v1',
          kind: 'VirtualMachine',
          metadata: { name: payload.name },
          tags: [payload.os, payload.network],
          spec: {
            cpu: { sockets: 1, cores: spec.cores },
            memory: spec.memory,
            storage: [{ name: 'root', size: spec.disk, class: 'silver' }],
            network: [{ network: payload.network, ip_mode: 'dhcp' }],
          },
        }
        const r = await createPlatformVm(body)
        toastQueuedOperation(toast, `Creating ${payload.name}`, r.task_id, tier)
      }
      await state.load()
      navigate('/platform/vms')
    } catch (e: unknown) {
      toast.error(formatUserError(e))
      throw e
    }
  }

  return (
    <PageLayout
      compact
      hideHeader
      className="!space-y-0 w-full"
      contentClassName="mission-control-page w-full max-w-none px-0 pb-[calc(var(--dock-height,4.25rem)+1.5rem)] pt-0"
    >
      <div className="mission-control-root apple-story-stack w-full" data-testid="mission-control-page">
        {state.error && (
          <div className="apple-section apple-section--tight space-y-3">
            <StructuredErrorBanner error={{ message: state.error }} />
            <button type="button" className="btn-secondary text-sm" onClick={() => void state.load()}>Retry</button>
          </div>
        )}

        <MissionControlHero state={state} warnings={warnings} onCreateVm={() => setWizardOpen(true)} />

        <MissionControlBriefing
          state={state}
          missingImagesCount={missingImagesCount}
          onAnalyze={() => dispatchOpenSpotlight('analyze fleet health and guest agents')}
        />

        <section className="apple-section">
          <p className="apple-eyebrow">Inventory</p>
          {state.error && !state.loading ? (
            <>
              <h2 className="apple-display apple-display--sm">Inventory unavailable</h2>
              <p className="apple-lede">
                Host and guest lists come from the platform controller. Fix the control plane, then retry.
              </p>
              <div className="apple-cta-row">
                <button type="button" className="btn-primary" onClick={() => void state.load()}>
                  Retry inventory
                </button>
              </div>
            </>
          ) : !state.loading && state.hosts.length === 0 ? (
            <>
              <h2 className="apple-display apple-display--sm">No hosts yet</h2>
              <p className="apple-lede">
                Enroll a hypervisor, then manage guests from Machine Finder.
              </p>
              <div className="apple-cta-row">
                <Link to="/platform/enroll" className="btn-primary">Add host</Link>
                <Link to="/platform/vms" className="apple-text-link">Machine Finder <span aria-hidden>›</span></Link>
              </div>
            </>
          ) : (
            <>
              <h2 className="apple-display apple-display--sm">
                {state.loading ? '—' : `${state.onlineHosts}/${state.hosts.length}`} hosts online
              </h2>
              <p className="apple-lede">
                {state.loading ? 'Loading inventory…' : `${state.running} VMs running. Open VM Center to operate them.`}
              </p>
              <div className="apple-cta-row">
                <Link to="/platform/vms" className="apple-text-link">
                  Open Machine Finder <span aria-hidden>›</span>
                </Link>
              </div>
            </>
          )}
        </section>

        {tier === 'advanced' && (
          <div className="apple-section apple-section--tight">
            <EnterpriseSecurityStrip />
          </div>
        )}

        {state.attentionMode && (
          <section className="apple-section apple-section--tight" data-testid="attention-remediation">
            <p className="apple-eyebrow">Attention</p>
            <h2 className="apple-display apple-display--sm">Remediate</h2>
            <nav className="apple-cta-row">
              <Link to="/platform/vms?folder=unprotected" className="apple-text-link">Fix backups ›</Link>
              <Link to="/platform/vms?folder=guest_agent_missing" className="apple-text-link">Guest agents ›</Link>
              <Link to="/platform/vms?folder=needs_attention" className="apple-text-link">Stopped VMs ›</Link>
              <button type="button" className="apple-text-link" onClick={() => dispatchOpenSpotlight('diagnose fleet attention items')}>
                Ask Zyra ›
              </button>
            </nav>
          </section>
        )}

        <MissionControlLaunchpad onCreateVm={() => setWizardOpen(true)} />

        <div className="apple-section apple-section--tight">
          <MissionControlGeography expanded={geoExpanded} onToggle={() => setGeoExpanded((v) => !v)} />
        </div>
      </div>

      <SimpleCreateVmWizard open={wizardOpen} onClose={() => setWizardOpen(false)} onCreate={handleCreate} />
    </PageLayout>
  )
}
