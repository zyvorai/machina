// Copyright (c) 2026 ZyvorAI Labs Private Limited. All rights reserved.

import { useEffect, useMemo, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router'
import PageLayout from '../../../components/PageLayout'
import ConfirmDialog from '../../../components/ConfirmDialog'
import { StructuredErrorBanner } from '../../../components/StructuredErrorBanner'
import FleetCommandCenter from '../../../components/platform/fleet/FleetCommandCenter'
import SimpleCreateVmWizard, {
  cloudInitUserForOs,
  sizeToSpec,
  type VmWizardPayload,
} from '../../../components/platform/SimpleCreateVmWizard'
import MigratePrecheckModal from '../../../components/platform/MigratePrecheckModal'
import VmPlatformSshConnectDialog from '../../../components/vm/VmPlatformSshConnectDialog'
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
import ActionDropZones from './ActionDropZones'
import HostMachinePanels from './HostMachinePanels'
import MissionControlBriefing from './MissionControlBriefing'
import MissionControlGeography from './MissionControlGeography'
import MissionControlHero from './MissionControlHero'
import MissionControlLaunchpad from './MissionControlLaunchpad'
import LaunchpadMissionControlStrip from '../../../components/launchpad/LaunchpadMissionControlStrip'
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

  const lastRunningVm = state.vms.find((v) => v.observed_state === 'running') ?? null

  const handleCreate = async (payload: VmWizardPayload) => {
    try {
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
    } catch (e: unknown) {
      toast.error(formatUserError(e))
      throw e
    }
  }

  return (
    <PageLayout compact hideHeader contentClassName="mission-control-page pb-[calc(var(--dock-height,4.25rem)+1rem)]">
      <div className="flex flex-col xl:flex-row gap-4">
        <section className="mission-control-root flex-1 min-w-0 flex flex-col gap-4" data-testid="mission-control-page">
          {state.error && <StructuredErrorBanner error={{ message: state.error }} />}

          <MissionControlHero state={state} warnings={warnings} />
          <MissionControlBriefing
            state={state}
            missingImagesCount={missingImagesCount}
            onAnalyze={() => dispatchOpenSpotlight('analyze fleet health and guest agents')}
          />
          {tier === 'advanced' && <EnterpriseSecurityStrip />}
          {state.attentionMode && (
            <section className="flex flex-wrap gap-2 rounded-xl border border-amber-500/30 bg-amber-500/10 px-4 py-3" data-testid="attention-remediation">
              <p className="w-full text-xs font-medium text-amber-200">Attention mode — filtered to machines that need care</p>
              {state.unprotected > 0 && (
                <button type="button" className="btn-secondary text-xs" onClick={() => navigate('/platform/vms?folder=unprotected')}>Fix backups</button>
              )}
              <button type="button" className="btn-secondary text-xs" onClick={() => navigate('/platform/vms?folder=guest_agent_missing')}>Install guest agents</button>
              <button type="button" className="btn-secondary text-xs" onClick={() => navigate('/platform/vms?folder=needs_attention')}>Review stopped VMs</button>
              <button type="button" className="btn-secondary text-xs" onClick={() => dispatchOpenSpotlight('diagnose fleet attention items')}>Ask Zeus diagnose</button>
            </section>
          )}
          <MissionControlLaunchpad onCreateVm={() => setWizardOpen(true)} lastVm={lastRunningVm} />
          <LaunchpadMissionControlStrip />
          <ActionDropZones state={state} />
          <HostMachinePanels state={state} />
          <MissionControlGeography expanded={geoExpanded} onToggle={() => setGeoExpanded((v) => !v)} />
        </section>

        <FleetCommandCenter
          selectedVm={state.selectedVm}
          hosts={state.hosts}
          hostMap={state.hostMap}
          showTheatrePreview
          onSsh={(vm) => state.setSshVm(vm)}
          onMigrate={(vm, destId, destName) => state.setMigrateModal({ vm, destId, destName })}
          onPower={(vm, action) => void state.vmPowerAction(vm, action)}
          onSnapshot={(vm) => void state.vmSnapshotAction(vm)}
          onDelete={(vm) => void state.vmDeleteAction(vm)}
          onAdopt={(vm) => void state.adoptVm(vm)}
        />
      </div>

      <SimpleCreateVmWizard open={wizardOpen} onClose={() => setWizardOpen(false)} onCreate={handleCreate} />
      {state.migrateModal && (
        <MigratePrecheckModal
          vm={state.migrateModal.vm}
          destHostId={state.migrateModal.destId}
          destHostName={state.migrateModal.destName}
          onClose={() => state.setMigrateModal(null)}
          onDone={() => void state.load()}
        />
      )}
      {state.sshVm && (
        <VmPlatformSshConnectDialog
          open
          vm={state.sshVm}
          hosts={state.hosts}
          onClose={() => state.setSshVm(null)}
          onNotify={(m) => toast.success(m)}
        />
      )}
      <ConfirmDialog
        open={state.deleteVmTarget !== null}
        title="Delete VM"
        message={`Delete ${state.deleteVmTarget?.name}? This cannot be undone.`}
        confirmLabel="Delete"
        variant="danger"
        onCancel={() => state.setDeleteVmTarget(null)}
        onConfirm={() => {
          const vm = state.deleteVmTarget
          state.setDeleteVmTarget(null)
          if (vm) void state.doVmDeleteAction(vm)
        }}
      />
    </PageLayout>
  )
}
