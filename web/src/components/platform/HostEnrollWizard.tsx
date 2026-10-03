// Copyright 2026 Zyvor AI Labs · https://zyvor.dev
// SPDX-License-Identifier: LicenseRef-Zyvor-Production-1.0

import { useState } from 'react'
import { Copy } from 'lucide-react'
import PlatformStepWizard from './PlatformStepWizard'
import { createEnrollmentToken } from '../../api/platform'
import { useToastContext } from '../../contexts/ToastContext'
import { formatUserError } from '../../utils/apiError'

const STEPS = ['Token', 'Install', 'Verify']

type Props = {
  open: boolean
  onClose: () => void
}

export default function HostEnrollWizard({ open, onClose }: Props) {
  const toast = useToastContext()
  const [step, setStep] = useState(0)
  const [token, setToken] = useState('')
  const [command, setCommand] = useState('')
  const [busy, setBusy] = useState(false)

  const issueToken = async () => {
    setBusy(true)
    try {
      const t = await createEnrollmentToken(24)
      setToken(t.token)
      setCommand(t.install_command ?? `curl -fsSL … | sudo machina-agent enroll ${t.token}`)
      setStep(1)
    } catch (e: unknown) {
      toast.error(formatUserError(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <PlatformStepWizard
      open={open}
      onClose={onClose}
      title="Enroll hypervisor host"
      subtitle="Generate a one-time token and run the agent installer on the host."
      steps={STEPS}
      step={step}
      onStepChange={setStep}
      canNext={step === 0 ? true : step === 1 ? Boolean(command) : true}
      busy={busy}
      finishLabel="Done"
      nextLabel={step === 0 ? 'Generate token' : 'Next'}
      onNext={step === 0 ? issueToken : undefined}
      onFinish={onClose}
    >
      {step === 0 && (
        <p className="text-sm text-[var(--text-muted)]">
          Machina will create an enrollment token. Run the install command on the hypervisor as root (or with sudo).
        </p>
      )}
      {step === 1 && (
        <div className="space-y-3">
          <p className="text-xs text-[var(--text-muted)] font-mono break-all">{token}</p>
          <pre className="text-xs bg-[var(--apple-surface)] p-3 rounded-lg overflow-x-auto text-[var(--text-secondary)]">{command}</pre>
          <button
            type="button"
            className="btn-secondary text-xs inline-flex items-center gap-1"
            onClick={() => {
              void navigator.clipboard.writeText(command)
              toast.success('Command copied')
            }}
          >
            <Copy className="w-3 h-3" /> Copy install command
          </button>
        </div>
      )}
      {step === 2 && (
        <p className="text-sm text-[var(--text-muted)]">
          After the agent connects, open <strong className="text-[var(--text-primary)]">Hosts</strong> and confirm the host shows{' '}
          <strong className="text-[var(--text-primary)]">online</strong>. Sync hosts from the dashboard if needed.
        </p>
      )}
    </PlatformStepWizard>
  )
}
