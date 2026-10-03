// Copyright 2026 Zyvor AI Labs · https://zyvor.dev
// SPDX-License-Identifier: LicenseRef-Zyvor-Production-1.0

import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router'
import { Maximize2, Monitor } from 'lucide-react'
import {
  getConsoleHubPlan,
  issuePlatformVmWsToken,
  platformVmVncWsUrl,
  platformVncWsUrl,
  type ConsoleHubPlan,
} from '../../../api/platform'
import VNCViewer from '../../VNCViewer'
import { embeddedVncPreviewProps } from '../../../utils/embeddedVnc'
import { openCenterPopout } from '../../../utils/platformCenterPopout'
import VmConsoleQuickLinks from './VmConsoleQuickLinks'
import { cinemaHubPath, cinemaPopoutPath } from '../../../utils/consoleExperienceMode'
import { consoleStatusLabel } from './vmConsoleLinks'

type Props = {
  vmId: string
  vmName: string
  connected?: boolean
  /** `tile` — VNC only (live wall). `panel` — full theatre chrome (command center). */
  variant?: 'panel' | 'tile'
}

export default function ConsoleTheatrePreview({
  vmId,
  vmName,
  connected = true,
  variant = 'panel',
}: Props) {
  const [plan, setPlan] = useState<ConsoleHubPlan | null>(null)
  const [wsUrl, setWsUrl] = useState<string | null>(null)
  const [connectKey, setConnectKey] = useState(0)
  const [loadError, setLoadError] = useState<string | null>(null)
  const tile = variant === 'tile'

  const load = useCallback(async () => {
    setLoadError(null)
    try {
      const [hubPlan, tokenRes] = await Promise.all([
        getConsoleHubPlan(vmId).catch(() => null),
        issuePlatformVmWsToken(vmId).catch(() => null),
      ])
      setPlan(hubPlan)
      // KubeVirt VMs (host_id is null) have no agent-backed generic proxy
      // session — the generic /ws/v1/platform/vnc/{vmId} URL closes the
      // socket immediately (empty Close frame -> browser reports code
      // 1005). getConsoleHubPlan already resolves the correct per-inventory
      // path (e.g. /ws/v1/k8s-kubevirt/{ns}/{name}/vnc); prefer it whenever
      // it's a VNC path, matching PlatformConsoleHub's own precedence.
      if (hubPlan?.native?.ws_path && hubPlan.native.console_type !== 'spice') {
        setWsUrl(platformVncWsUrl(hubPlan.native.ws_path))
      } else if (tokenRes?.token) {
        setWsUrl(platformVmVncWsUrl(vmId, tokenRes.token))
      } else {
        setWsUrl(null)
      }
    } catch (e: unknown) {
      setLoadError(e instanceof Error ? e.message : 'Console unavailable')
      setPlan(null)
      setWsUrl(null)
    }
  }, [vmId])

  useEffect(() => {
    void load()
  }, [load])

  const status = plan
    ? consoleStatusLabel(plan.protocols, plan.recommended)
    : connected
      ? 'VNC · Ready'
      : 'Disconnected'

  const showVnc = Boolean(wsUrl) && (plan?.protocols.includes('novnc') ?? true)

  if (tile) {
    return (
      <div className="flex flex-col h-full min-h-[10rem]" data-testid="console-theatre-preview">
        {loadError ? (
          <p className="px-3 py-2 text-xs text-amber-600/90">{loadError}</p>
        ) : showVnc ? (
          <div className="relative flex-1 min-h-0 overflow-hidden bg-black" data-testid="console-theatre-vnc">
            <VNCViewer
              vmName={vmName}
              wsUrl={wsUrl ?? undefined}
              connectKey={connectKey}
              onReconnect={() => {
                setConnectKey((k) => k + 1)
                void load()
              }}
              {...embeddedVncPreviewProps}
            />
          </div>
        ) : (
          <p className="px-3 py-3 text-xs text-[var(--text-muted)]">Console preview unavailable.</p>
        )}
      </div>
    )
  }

  return (
    <section className="rounded-lg border border-white/[0.08] bg-black/40 overflow-hidden" data-testid="console-theatre-preview">
      <div className="flex items-center justify-between px-3 py-2 border-b border-white/[0.06] text-xs gap-2">
        <span className="text-[var(--text-secondary)] font-medium shrink-0">Console Theatre</span>
        <span className={connected ? 'text-emerald-400 truncate text-right' : 'text-[var(--text-muted)] truncate text-right'} title={status}>
          {status}
        </span>
      </div>

      <div className="px-3 pt-2 pb-1">
        <VmConsoleQuickLinks vmId={vmId} running compact />
      </div>

      {loadError ? (
        <p className="px-3 py-2 text-xs text-amber-300/90">{loadError}</p>
      ) : showVnc ? (
        <div className="relative mx-2 mb-2 rounded-md border border-white/[0.06] overflow-hidden bg-black aspect-video w-[calc(100%-1rem)] max-h-[11rem] flex flex-col" data-testid="console-theatre-vnc">
          <VNCViewer
            vmName={vmName}
            wsUrl={wsUrl ?? undefined}
            connectKey={connectKey}
            onReconnect={() => {
              setConnectKey((k) => k + 1)
              void load()
            }}
            {...embeddedVncPreviewProps}
          />
        </div>
      ) : (
        <div className="px-3 py-3 text-xs text-[var(--text-muted)]">
          {plan?.protocols?.includes('spice') || plan?.protocols?.includes('webrtc_spice')
            ? 'This VM uses SPICE — open SPICE or Performance above.'
            : 'Open VNC above or use ConsoleHub for serial/SSH lenses.'}
        </div>
      )}

      <div className="flex border-t border-white/[0.06] divide-x divide-white/[0.06]">
        <Link
          to={cinemaHubPath(vmId, plan?.recommended && plan.recommended !== 'serial' ? { protocol: plan.recommended } : undefined)}
          className="flex-1 btn-secondary text-xs rounded-none border-0 py-2 inline-flex items-center justify-center gap-1"
        >
            <Monitor className="w-3.5 h-3.5" /> Open Cinema
        </Link>
        <button
          type="button"
          className="flex-1 btn-secondary text-xs rounded-none border-0 py-2 inline-flex items-center justify-center gap-1"
          onClick={() => openCenterPopout(cinemaPopoutPath(vmId))}
        >
          <Maximize2 className="w-3.5 h-3.5" /> Pop out
        </button>
      </div>
    </section>
  )
}
