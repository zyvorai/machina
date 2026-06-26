// Copyright (c) 2026 ZyvorAI Labs Private Limited. All rights reserved.

import { X } from 'lucide-react'
import VmPortForwardPanel from '../vm/VmPortForwardPanel'

type Props = {
  open: boolean
  onClose: () => void
  vmId: string
  vmName: string
  guestIp?: string | null
  sshUser?: string
  hypervisorAddress?: string
  onPlanRefresh?: () => void
  onNotify?: (message: string) => void
}

export default function VmNetworkDrawer({
  open,
  onClose,
  vmId,
  vmName,
  guestIp,
  sshUser,
  hypervisorAddress,
  onPlanRefresh,
  onNotify,
}: Props) {
  if (!open) return null

  return (
    <>
      <button type="button" className="fixed inset-0 z-[75] bg-black/40 backdrop-blur-sm" aria-label="Close Network" onClick={onClose} />
      <aside className="fixed top-0 right-0 z-[80] h-full w-full max-w-md bg-slate-950/95 border-l border-white/10 shadow-2xl flex flex-col overflow-hidden" role="dialog" aria-modal="true" aria-label="Network settings" data-testid="vm-network-drawer">
        <header className="flex items-center justify-between px-4 py-3 border-b border-white/10 shrink-0">
          <div>
            <h2 className="font-semibold text-slate-100">Network</h2>
            <p className="text-xs text-slate-500">{vmName}</p>
          </div>
          <button type="button" onClick={onClose} aria-label="Close" className="p-1.5 rounded hover:bg-white/10 text-slate-400"><X className="w-5 h-5" aria-hidden="true" /></button>
        </header>
        <div className="flex-1 overflow-y-auto p-4">
          {guestIp ? (
            <VmPortForwardPanel
              platformVmId={vmId}
              vmName={vmName}
              guestIp={guestIp}
              sshUser={sshUser}
              hypervisorAddress={hypervisorAddress}
              onNotify={() => {
                onNotify?.('Port forward updated')
                onPlanRefresh?.()
              }}
            />
          ) : (
            <p className="text-sm text-slate-500">Guest IP not available — start the VM to configure NAT port forwards.</p>
          )}
        </div>
      </aside>
    </>
  )
}
