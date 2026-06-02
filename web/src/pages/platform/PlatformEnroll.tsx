// Copyright (c) 2026 ZyvorAI Labs Private Limited. All rights reserved.

import { useCallback, useEffect, useState } from 'react'
import { Copy, KeyRound } from 'lucide-react'
import PlatformPageChrome, { PlatformBackLink } from '../../components/platform/PlatformPageChrome'
import CopyButton from '../../components/CopyButton'
import { createEnrollmentToken, listEnrollmentTokens, revokeEnrollmentToken, type EnrollmentToken, type EnrollmentTokenRow } from '../../api/platform'
import { useToastContext } from '../../contexts/ToastContext'
import { formatUserError } from '../../utils/apiError'
import { statusActionLinkClasses } from '../../utils/semanticColors'

export default function PlatformEnroll() {
  const toast = useToastContext()
  const [token, setToken] = useState<EnrollmentToken | null>(null)
  const [history, setHistory] = useState<EnrollmentTokenRow[]>([])
  const [busy, setBusy] = useState(false)

  const load = useCallback(async () => {
    try { setHistory(await listEnrollmentTokens()) } catch { /* optional */ }
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
      prepend={<PlatformBackLink to="/platform/hosts" label="Hosts" />}
      title="Host Enrollment"
      subtitle="Join new KVM nodes to the control plane"
      icon={<KeyRound className="w-6 h-6 text-slate-400" />}
      contentClassName="space-y-4"
    >
      <button type="button" className="btn-primary" disabled={busy} onClick={() => void generate()}>Generate join token</button>
      {token && (
        <div className="card p-4 space-y-4">
          <div>
            <div className="text-sm text-slate-400 mb-1">Token (expires {token.expires_at})</div>
            <code className="block p-2 bg-slate-900 rounded text-sm break-all">{token.token}</code>
          </div>
          <div>
            <div className="text-sm text-slate-400 mb-1 flex items-center gap-2">Install command <Copy className="w-3 h-3" /></div>
            <div className="flex gap-2 items-start">
              <code className="flex-1 p-2 bg-slate-900 rounded text-xs break-all">{token.install_command}</code>
              <CopyButton text={token.install_command} />
            </div>
          </div>
          <p className="text-sm text-slate-400">
            On the KVM host: <code className="text-slate-200">machina-agent join --controller URL --token TOKEN</code>
          </p>
        </div>
      )}
      {history.length > 0 && (
        <section className="card p-4">
          <h2 className="font-semibold mb-2 text-sm">Recent tokens</h2>
          <ul className="text-xs text-slate-400 space-y-1">{history.map((t) => (
            <li key={t.token} className="flex justify-between gap-2">
              <span><code>{t.token.slice(0, 20)}…</code> {t.used_at ? 'used' : 'open'}</span>
              {!t.used_at && (
                <button type="button" className={statusActionLinkClasses('error')} onClick={async () => {
                  try { await revokeEnrollmentToken(t.token); toast.success('Revoked'); await load() } catch (e: unknown) { toast.error(formatUserError(e)) }
                }}>Revoke</button>
              )}
            </li>
          ))}</ul>
        </section>
      )}
    </PlatformPageChrome>
  )
}
