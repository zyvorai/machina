// Copyright 2026 Zyvor AI Labs · https://zyvor.dev
// SPDX-License-Identifier: LicenseRef-Zyvor-Production-1.0

import { useCallback, useEffect, useState } from 'react'
import { Bot, Terminal, X, Copy } from 'lucide-react'
import { aiCopilotChat, aiTerminalSuggest, type TerminalSuggestResult } from '../../api/ai'
import { sendGuestKey } from '../../api/vm'
import { usePlatformInfo } from '../../contexts/PlatformInfoContext'
import { useToastContext } from '../../contexts/ToastContext'
import { formatUserError } from '../../utils/apiError'

const TIPS = [
  'Host commands run on the hypervisor via SSH.',
  'Guest commands run inside the VM (SSH or guest agent).',
]

const QUICK_KEYS: { label: string; preset: 'ctrl_alt_del' | 'esc' }[] = [
  { label: 'Ctrl+Alt+Del', preset: 'ctrl_alt_del' },
  { label: 'Esc', preset: 'esc' },
]

export default function AiTerminalCompanion({
  vmName,
  vmId,
  libvirtConnection,
}: {
  vmName?: string
  vmId?: string
  libvirtConnection?: string
}) {
  const { info } = usePlatformInfo()
  const toast = useToastContext()
  const platform = Boolean(info?.control_plane?.proxy_url)
  const [open, setOpen] = useState(false)
  const [reply, setReply] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [suggest, setSuggest] = useState<TerminalSuggestResult | null>(null)

  const loadSuggest = useCallback(async () => {
    if (!platform) return
    try {
      setSuggest(await aiTerminalSuggest(vmId, vmName))
    } catch {
      setSuggest(null)
    }
  }, [platform, vmId, vmName])

  useEffect(() => {
    if (open) void loadSuggest()
  }, [open, loadSuggest])

  const sendKey = async (preset: 'ctrl_alt_del' | 'esc') => {
    if (!vmName) return
    try {
      await sendGuestKey(vmName, { preset }, libvirtConnection)
      toast.success(`Sent ${preset}`)
    } catch (e: unknown) {
      toast.error(formatUserError(e))
    }
  }

  const copyCmd = (cmd: string) => {
    void navigator.clipboard.writeText(cmd)
    toast.success('Copied command')
  }

  return (
    <>
      <button
        type="button"
        className="fixed bottom-6 right-6 z-40 btn-primary rounded-full p-3 shadow-lg"
        title="Zyra terminal tips"
        onClick={() => setOpen((o) => !o)}
      >
        <Bot className="w-5 h-5" />
      </button>
      {open && (
        <aside className="fixed bottom-20 right-6 z-40 w-96 max-w-[calc(100vw-2rem)] max-h-[70vh] overflow-y-auto rounded-2xl border border-white/10 bg-[var(--apple-surface-elevated)] backdrop-blur-xl shadow-2xl p-4 space-y-3 text-sm">
          <div className="flex items-center justify-between">
            <p className="font-semibold flex items-center gap-2"><Terminal className="w-4 h-4" /> Zyra terminal tips</p>
            <button type="button" onClick={() => setOpen(false)} className="text-[var(--text-muted)] hover:text-[var(--text-primary)]" aria-label="Close terminal tips"><X className="w-4 h-4" /></button>
          </div>
          {vmName && (
            <p className="text-xs text-[var(--text-muted)]">
              {vmName} · <span className="text-[var(--text-muted)]">{suggest?.observed_state ?? '…'}</span>
            </p>
          )}
          <div className="flex flex-wrap gap-1">
            {QUICK_KEYS.map((c) => (
              <button key={c.preset} type="button" className="btn-secondary text-[10px] px-2 py-1" disabled={!vmName} onClick={() => void sendKey(c.preset)}>
                {c.label}
              </button>
            ))}
          </div>
          {suggest && suggest.suggestions.length > 0 && (
            <div className="space-y-2 border-t border-white/[0.06] pt-2">
              <p className="text-[10px] font-semibold uppercase tracking-wider text-orange-400/80">Suggested commands</p>
              {suggest.suggestions.map((s) => (
                <div key={s.command} className="rounded-lg border border-white/[0.06] p-2 text-xs">
                  <div className="flex justify-between gap-2">
                    <span className="font-medium text-[var(--text-primary)]">{s.label}</span>
                    <span className="text-[var(--text-faint)] shrink-0">{s.scope}</span>
                  </div>
                  <code className="block mt-1 text-[10px] text-[var(--text-muted)] break-all">{s.command}</code>
                  <p className="text-[var(--text-muted)] mt-0.5">{s.description}</p>
                  <button type="button" className="btn-secondary text-[10px] mt-1 flex items-center gap-1" onClick={() => copyCmd(s.command)}>
                    <Copy className="w-3 h-3" /> Copy
                  </button>
                </div>
              ))}
              <p className="text-[10px] text-[var(--text-muted)]">{suggest.notes}</p>
            </div>
          )}
          <ul className="text-xs text-[var(--text-muted)] space-y-1 list-disc pl-4">
            {TIPS.map((t) => <li key={t}>{t}</li>)}
          </ul>
          {platform && (
            <button type="button" className="btn-secondary w-full text-xs" disabled={busy} onClick={async () => {
              setBusy(true)
              try {
                const r = await aiCopilotChat(vmName ? `Console troubleshooting for ${vmName}` : 'Console tips', vmId)
                setReply(r.reply)
              } catch (e: unknown) {
                setReply(formatUserError(e))
              } finally {
                setBusy(false)
              }
            }}>
              {busy ? 'Asking Zyra…' : 'Ask Zyra'}
            </button>
          )}
          {reply && <p className="text-xs text-[var(--text-secondary)] whitespace-pre-wrap border-t border-white/[0.06] pt-2">{reply}</p>}
        </aside>
      )}
    </>
  )
}
