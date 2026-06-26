// Copyright (c) 2026 ZyvorAI Labs Private Limited. All rights reserved.

import { useState } from 'react'
import { convertVmSpiceToVnc } from '../../api/platform'
import { convertGraphicsSpiceToVnc } from '../../api/vm'
import { formatUserError } from '../../utils/apiError'
import ConfirmDialog from '../../components/ConfirmDialog'

type Props = {
  vmName: string
  connection?: string
  platformVmId?: string | null
  usePlatformApi?: boolean
  onSuccess: () => void
  onError: (message: string) => void
}

export default function ClassicVmSpiceToVncButton({
  vmName,
  connection,
  platformVmId,
  usePlatformApi,
  onSuccess,
  onError,
}: Props) {
  const [confirm, setConfirm] = useState(false)

  const run = () => {
    const task =
      usePlatformApi && platformVmId
        ? convertVmSpiceToVnc(platformVmId)
        : convertGraphicsSpiceToVnc(vmName, connection)
    void task
      .then(() => { onSuccess() })
      .catch((e: unknown) => onError(formatUserError(e)))
  }

  return (
    <>
      <ConfirmDialog
        open={confirm}
        title="Convert SPICE to VNC"
        message="Convert SPICE graphics to VNC? The guest may briefly lose display."
        confirmLabel="Convert"
        variant="warning"
        onCancel={() => setConfirm(false)}
        onConfirm={() => { setConfirm(false); run() }}
      />
      <button
        type="button"
        title="virt-xml --convert-to-vnc (requires virt-xml on host; may change live graphics)"
        className="px-3 py-1.5 bg-slate-800 hover:bg-slate-700 border border-slate-600 rounded-lg text-sm transition flex items-center gap-1 text-slate-300"
        onClick={() => setConfirm(true)}
        data-testid="classic-spice-to-vnc"
      >
        SPICE→VNC
      </button>
    </>
  )
}
