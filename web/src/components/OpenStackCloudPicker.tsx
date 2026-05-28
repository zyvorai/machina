// Copyright (c) 2026 ZyvorAI Labs Private Limited. All rights reserved.

import { useCallback, useEffect, useState } from 'react'
import { Cloud } from 'lucide-react'
import { listOpenStackClouds, selectOpenStackCloud, type OpenStackCloudEntry } from '../api/openstackExtras'
import { useOpenStackConnection } from '../hooks/useOpenStackConnection'
import { formatUserError } from '../utils/apiError'

export default function OpenStackCloudPicker() {
  const { cloudName, refresh, phase } = useOpenStackConnection()
  const [clouds, setClouds] = useState<OpenStackCloudEntry[]>([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    if (phase === 'off' || phase === 'needsWire') return
    try {
      const { clouds: list } = await listOpenStackClouds()
      setClouds(list ?? [])
      setError(null)
    } catch (e: unknown) {
      setError(formatUserError(e))
    }
  }, [phase])

  useEffect(() => {
    void load()
  }, [load])

  if (clouds.length <= 1) return null

  return (
    <label className="hidden md:inline-flex items-center gap-1.5 ml-2 text-xs text-slate-400">
      <Cloud className="w-3.5 h-3.5 shrink-0" />
      <select
        value={cloudName}
        disabled={busy}
        onChange={async (e) => {
          const name = e.target.value
          if (!name || name === cloudName) return
          setBusy(true)
          try {
            await selectOpenStackCloud(name)
            await refresh()
          } catch (err: unknown) {
            setError(formatUserError(err))
          } finally {
            setBusy(false)
          }
        }}
        className="max-w-[8rem] truncate px-1.5 py-0.5 rounded bg-slate-900/80 border border-slate-700 text-slate-300"
        title={error ?? 'Switch clouds.yaml entry'}
      >
        {clouds.map((c) => (
          <option key={c.name} value={c.name}>
            {c.name}{c.active ? ' · active' : ''}
          </option>
        ))}
      </select>
    </label>
  )
}
