// Copyright (c) 2026 ZyvorAI Labs Private Limited. All rights reserved.

import { useCallback, useEffect, useState } from 'react'
import { HardDrive, Layers } from 'lucide-react'
import PlatformPageChrome, { PlatformBackLink, PlatformRefreshButton } from '../../components/platform/PlatformPageChrome'
import { MacGlassPanel, MacListRow, MacStatWidget } from '../../components/platform/mac/PlatformMacUi'
import PlatformEmptyState from '../../components/platform/PlatformEmptyState'
import { formatUserError } from '../../utils/apiError'
import { getStorageTiersOverview, type StorageTierOverview, type StorageTiersOverview } from '../../api/platform'

export default function PlatformStorageTiers() {
  const [data, setData] = useState<StorageTiersOverview | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    setError(null)
    setLoading(true)
    try {
      setData(await getStorageTiersOverview())
    } catch (e: unknown) {
      setError(formatUserError(e))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { void load() }, [load])

  const tiers: StorageTierOverview[] = data?.tiers ?? []
  const totalCapacity = tiers.reduce((s, t) => s + t.capacity_gib, 0)
  const totalUsed = tiers.reduce((s, t) => s + t.used_gib, 0)

  return (
    <PlatformPageChrome
      error={error}
      onErrorRetry={() => void load()}
      prepend={<PlatformBackLink to="/platform/storage" label="Disk Utility" />}
      actions={<PlatformRefreshButton onClick={() => void load()} />}
    >
      <div className="space-y-6">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">Storage Tiers</h1>
          <p className="text-sm text-muted-foreground mt-1">
            {data?.summary ?? 'Storage tier classification and capacity overview.'}
          </p>
        </div>

        <div className="grid grid-cols-3 gap-4">
          <MacStatWidget label="Total Tiers" value={String(tiers.length)} icon={<Layers className="w-4 h-4" />} />
          <MacStatWidget label="Total Capacity" value={`${totalCapacity} GiB`} icon={<HardDrive className="w-4 h-4" />} />
          <MacStatWidget
            label="Total Used"
            value={`${totalUsed} GiB`}
            icon={<HardDrive className="w-4 h-4" />}
            tone={totalUsed / (totalCapacity || 1) > 0.85 ? 'warn' : 'default'}
          />
        </div>

        <MacGlassPanel title="Storage Tiers" >
          {tiers.length === 0 ? (
            <PlatformEmptyState
              icon={Layers}
              title="No storage tiers"
              subtitle="No storage tiers have been defined yet."
            />
          ) : (
            <div className="divide-y divide-border/40">
              {tiers.map((tier) => (
                <MacListRow
                  key={tier.id}
                  title={tier.name}
                  subtitle={`${tier.tier_class} · ${tier.iops_tier} IOPS · ${tier.replication} replication · ${tier.pool_count} pool${tier.pool_count !== 1 ? 's' : ''}`}
                  trailing={
                    <span className="text-xs text-muted-foreground shrink-0">
                      {tier.used_gib} / {tier.capacity_gib} GiB
                    </span>
                  }
                  badge={
                    tier.capacity_gib > 0 && tier.used_gib / tier.capacity_gib > 0.85 ? (
                      <span className="text-xs px-1.5 py-0.5 rounded bg-amber-500/10 text-amber-500">High</span>
                    ) : undefined
                  }
                />
              ))}
            </div>
          )}
        </MacGlassPanel>
      </div>
    </PlatformPageChrome>
  )
}
