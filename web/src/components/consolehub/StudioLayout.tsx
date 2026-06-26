// Copyright (c) 2026 ZyvorAI Labs Private Limited. All rights reserved.

import type { ReactNode } from 'react'
import ViewLensBar, { type ConsoleLens } from './ViewLensBar'
import MachineCommandStrip from './MachineCommandStrip'

type Props = {
  vmName: string
  vmState?: string | null
  guestIp?: string | null
  nodeName?: string | null
  healthScore?: number | null
  osHint?: string
  lens: ConsoleLens
  onLensChange: (lens: ConsoleLens) => void
  displayProtocols?: string[]
  activeProtocol?: string
  onProtocolChange?: (p: string) => void
  recommended?: string
  onCommandCenter?: () => void
  onAi?: () => void
  onOpenCinema?: () => void
  primary: ReactNode
  secondary?: ReactNode
  timeline?: ReactNode
}

export default function StudioLayout({
  vmName,
  vmState,
  guestIp,
  nodeName,
  healthScore,
  osHint,
  lens,
  onLensChange,
  displayProtocols,
  activeProtocol,
  onProtocolChange,
  recommended,
  onCommandCenter,
  onAi,
  onOpenCinema,
  primary,
  secondary,
  timeline,
}: Props) {
  const split = lens === 'display' && secondary

  return (
    <div className="flex flex-col flex-1 min-h-0 w-full" data-testid="studio-layout">
      <MachineCommandStrip
        vmName={vmName}
        vmState={vmState}
        guestIp={guestIp}
        nodeName={nodeName}
        healthScore={healthScore}
        osHint={osHint}
        onEnterTheatre={onOpenCinema}
        onCommandCenter={onCommandCenter}
        onAi={onAi}
      />
      <ViewLensBar
        active={lens}
        onChange={onLensChange}
        displayProtocols={displayProtocols}
        activeProtocol={activeProtocol}
        onProtocolChange={onProtocolChange}
        recommended={recommended}
      />
      <div className={`flex-1 min-h-0 grid gap-2 ${split ? 'grid-cols-1 lg:grid-cols-[3fr_2fr]' : 'grid-cols-1'}`}>
        <div className="min-h-0 flex flex-col rounded-xl overflow-hidden bg-[#0a0a0c] border border-white/[0.06]">
          {primary}
        </div>
        {split && secondary ? (
          <div className="min-h-0 flex flex-col rounded-xl overflow-hidden bg-[#0a0a0c] border border-white/[0.06] hidden lg:flex">
            {secondary}
          </div>
        ) : null}
      </div>
      {timeline ? (
        <details className="shrink-0 mt-2 rounded-lg border border-white/[0.06] bg-black/40">
          <summary className="px-3 py-2 text-xs text-slate-400 cursor-pointer">Timeline</summary>
          <div className="max-h-40 overflow-y-auto px-2 pb-2">{timeline}</div>
        </details>
      ) : null}
    </div>
  )
}
