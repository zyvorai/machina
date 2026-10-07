// Copyright 2026 Zyvor AI Labs · https://zyvor.dev
// SPDX-License-Identifier: LicenseRef-Zyvor-Production-1.0

import { useCallback, useEffect, useState } from 'react'
import { Copy, KeyRound } from 'lucide-react'
import { MacGlassPanel } from '../../components/platform/mac/PlatformMacUi'
import OperatingSurfaceLayout from '../../components/platform/OperatingSurfaceLayout'
import PlatformEmptyState from '../../components/platform/PlatformEmptyState'
import PlatformPageChrome, { PlatformBackLink } from '../../components/platform/PlatformPageChrome'
import CopyButton from '../../components/CopyButton'
import JoinLivePanel from '../../components/platform/JoinLivePanel'
import { createEnrollmentToken, listEnrollmentTokens, revokeEnrollmentToken, type EnrollmentToken, type EnrollmentTokenRow } from '../../api/platform'
import { useToastContext } from '../../contexts/ToastContext'
import { formatUserError } from '../../utils/apiError'
import { statusActionLinkClasses } from '../../utils/semanticColors'

export default function PlatformEnroll() {
  const toast = useToastContext()
  const [token, setToken] = useState<EnrollmentToken | null>(null)
  const [history, setHistory] = useState<EnrollmentTokenRow[]>([])
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    try { setHistory(await listEnrollmentTokens()) } catch { /* optional */ }
    finally { setLoading(false) }
  }, [])

  useEffect(() => { void load() }, [load])

  const generate = async () => {
    setBusy(true)
    try {
      setToken(await createEnrollmentToken(24))
      toast.success('Enrollment token created')
      await load()
    } catch (e: unknown) {
      toast.error(formatUserError(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <PlatformPageChrome
      eyebrow="Platform"
      loading={loading && history.length === 0 && !token}
      prepend={<PlatformBackLink to="/platform/hosts" label="Hosts" />}
      title="Host Enrollment"
      subtitle="Join new KVM nodes to the control plane"
      icon={<KeyRound className="w-6 h-6 text-[var(--text-muted)]" />}
      contentClassName="space-y-4"
    >
      <OperatingSurfaceLayout testId="platform-enroll-page">
        <MacGlassPanel title="Join token" subtitle="Generate a one-time token and install command for new hypervisors.">
          <button type="button" className="btn-primary text-sm" disabled={busy} onClick={() => void generate()}>
            {busy ? 'Generating…' : 'Generate join token'}
          </button>
        </MacGlassPanel>

        {token && (
          <MacGlassPanel title="Active token" subtitle={`Expires ${token.expires_at}`}>
            <div className="space-y-4">
              <div>
                <div className="text-sm text-[var(--text-muted)] mb-1">Token</div>
                <div className="flex gap-2 items-start">
                  <code className="flex-1 p-2 bg-[var(--apple-surface)] rounded text-sm break-all">{token.token}</code>
                  <CopyButton text={token.token} />
                </div>
              </div>
              <div>
                <div className="text-sm text-[var(--text-muted)] mb-1 flex items-center gap-2">Install command <Copy className="w-3 h-3" /></div>
                <div className="flex gap-2 items-start">
                  <code className="flex-1 p-2 bg-[var(--apple-surface)] rounded text-xs break-all">{token.join_command ?? token.install_command}</code>
                  <CopyButton text={token.join_command ?? token.install_command} />
                </div>
              </div>
              <p className="text-sm text-[var(--text-muted)]">
                On the KVM host: <code className="text-[var(--text-primary)]">machina-agent join --controller URL --token TOKEN</code>
              </p>
            </div>
          </MacGlassPanel>
        )}

        {token && (
          <MacGlassPanel title="Live join" subtitle="Run the command on the host and watch it join the fleet.">
            <JoinLivePanel token={token.token} command={token.join_command ?? token.install_command} />
          </MacGlassPanel>
        )}

        <MacGlassPanel title="Recent tokens" subtitle={loading ? 'Loading…' : `${history.length} token(s)`}>
          {history.length === 0 && !loading ? (
            <PlatformEmptyState
              icon={KeyRound}
              title="No enrollment tokens yet"
              subtitle="Generate a join token above — revoked and used tokens appear here."
            />
          ) : (
            <ul className="text-xs text-[var(--text-muted)] space-y-1">{history.map((t) => (
              <li key={t.token} className="flex justify-between gap-2">
                <span><code>{t.token.slice(0, 20)}…</code> {t.used_at ? 'used' : 'open'}</span>
                {!t.used_at && (
                  <button type="button" className={statusActionLinkClasses('error')} onClick={async () => {
                    try { await revokeEnrollmentToken(t.token); toast.success('Revoked'); await load() } catch (e: unknown) { toast.error(formatUserError(e)) }
                  }}>Revoke</button>
                )}
              </li>
            ))}</ul>
          )}
        </MacGlassPanel>
      </OperatingSurfaceLayout>
    </PlatformPageChrome>
  )
}
