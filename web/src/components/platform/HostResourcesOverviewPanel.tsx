// Copyright 2026 Zyvor AI Labs · https://zyvor.dev
// SPDX-License-Identifier: LicenseRef-Zyvor-Production-1.0

import { useEffect, useState } from 'react'
import { HardDrive, Loader2, Server } from 'lucide-react'
import { MacGlassPanel } from './mac/PlatformMacUi'
import { getHostLinuxFilesystems, getHostLinuxProcesses, type HostLinuxFilesystem, type HostLinuxProcess } from '../../api/platform'
import { formatUserError } from '../../utils/apiError'

type Props = {
  hostId: string
  hostname?: string
}

export default function HostResourcesOverviewPanel({ hostId, hostname }: Props) {
  const [loading, setLoading] = useState(true)
  const [filesystems, setFilesystems] = useState<HostLinuxFilesystem[]>([])
  const [processes, setProcesses] = useState<HostLinuxProcess[]>([])
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!hostId) return
    setLoading(true)
    setError(null)
    void Promise.all([
      getHostLinuxFilesystems(hostId).then((r) => setFilesystems(r.filesystems ?? [])),
      getHostLinuxProcesses(hostId, 'memory', 8).then((r) => setProcesses(r.processes ?? [])),
    ])
      .catch((e: unknown) => setError(formatUserError(e)))
      .finally(() => setLoading(false))
  }, [hostId])

  return (
    <MacGlassPanel
      title="Hypervisor resources"
      subtitle={hostname ? `${hostname} — host filesystems and top processes (Cockpit-style)` : 'Host filesystems and top processes'}
    >
      {loading ? (
        <p className="text-sm text-[var(--text-muted)] flex items-center gap-2"><Loader2 className="w-4 h-4 animate-spin" /> Loading host metrics…</p>
      ) : error ? (
        <p className="text-sm text-amber-600/90">{error}</p>
      ) : (
        <div className="grid gap-4 lg:grid-cols-2">
          <div>
            <h4 className="text-xs uppercase tracking-wide text-[var(--text-muted)] mb-2 flex items-center gap-2"><HardDrive className="w-3.5 h-3.5" /> Filesystems</h4>
            {filesystems.length === 0 ? (
              <p className="text-xs text-[var(--text-muted)]">No block-backed mounts reported.</p>
            ) : (
              <ul className="text-xs space-y-2 max-h-48 overflow-y-auto">
                {filesystems.slice(0, 8).map((fs) => (
                  <li key={fs.mount_point} className="text-[var(--text-secondary)]">
                    <span className="font-medium text-[var(--text-primary)]">{fs.mount_point}</span>
                    {' · '}
                    {Math.round(fs.use_percent)}% used
                    {' · '}
                    {Math.round(fs.used_bytes / (1024 ** 3))}/{Math.round(fs.size_bytes / (1024 ** 3))} GiB
                  </li>
                ))}
              </ul>
            )}
          </div>
          <div>
            <h4 className="text-xs uppercase tracking-wide text-[var(--text-muted)] mb-2 flex items-center gap-2"><Server className="w-3.5 h-3.5" /> Top processes</h4>
            {processes.length === 0 ? (
              <p className="text-xs text-[var(--text-muted)]">No process data from agent.</p>
            ) : (
              <ul className="text-xs space-y-2 max-h-48 overflow-y-auto">
                {processes.map((p) => (
                  <li key={p.pid} className="text-[var(--text-secondary)] truncate" title={p.args || p.command}>
                    <span className="font-mono text-[var(--text-muted)]">{p.pid}</span>
                    {' · '}
                    {p.command}
                    {' · '}
                    {Math.round(p.rss_kb / 1024)} MiB RSS
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      )}
    </MacGlassPanel>
  )
}
