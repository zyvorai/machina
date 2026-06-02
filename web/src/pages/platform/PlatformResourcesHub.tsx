// Copyright (c) 2026 ZyvorAI Labs Private Limited. All rights reserved.

import { useEffect, useState } from 'react'
import { HardDrive, Cpu, Layers, Network, Package } from 'lucide-react'
import PlatformPageChrome, { PlatformBackLink, platformStatSubtitle } from '../../components/platform/PlatformPageChrome'
import PlatformHubLaunchpad from '../../components/platform/tahoe/PlatformHubLaunchpad'
import { getNetworkSegmentsOverview, getStorageTiersOverview } from '../../api/platform'

export default function PlatformResourcesHub({ embedded }: { embedded?: boolean } = {}) {
  const [poolCount, setPoolCount] = useState<number | null>(null)
  const [segmentCount, setSegmentCount] = useState<number | null>(null)

  useEffect(() => {
    void Promise.all([
      getStorageTiersOverview().catch(() => ({ tiers: [] })),
      getNetworkSegmentsOverview().catch(() => ({ segments: [] })),
    ]).then(([storage, segments]) => {
      setPoolCount(storage.tiers?.length ?? 0)
      setSegmentCount(segments.segments?.length ?? 0)
    })
  }, [])

  return (
    <PlatformPageChrome
      compact={embedded}
      hideHeader={embedded}
      prepend={embedded ? undefined : <PlatformBackLink to="/platform" label="Platform" />}
      title={embedded ? undefined : 'Resources'}
      subtitle={
        embedded ? undefined : (
          <span className="flex flex-col gap-1">
            <span className="text-slate-400">Storage, networks, images, and templates</span>
            {platformStatSubtitle([
              { label: 'Storage tiers', value: poolCount != null ? String(poolCount) : '—' },
              { label: 'Network segments', value: segmentCount != null ? String(segmentCount) : '—' },
            ])}
          </span>
        )
      }
      icon={embedded ? undefined : <HardDrive className="w-6 h-6 text-slate-400" />}
      contentClassName="space-y-4"
    >
        <PlatformHubLaunchpad
          groups={[
            {
              label: 'Infrastructure',
              subtitle: 'Disk, network, and content libraries',
              tiles: [
                { to: '/platform/gpu', label: 'GPU Command Center', icon: <Cpu className="w-8 h-8" strokeWidth={1.75} /> },
                { to: '/platform/storage', label: 'Disk Utility', icon: <HardDrive className="w-8 h-8" strokeWidth={1.75} /> },
                { to: '/platform/networks', label: 'Networks', icon: <Network className="w-8 h-8" strokeWidth={1.75} /> },
                { to: '/platform/content', label: 'Images & ISOs', icon: <Package className="w-8 h-8" strokeWidth={1.75} /> },
                { to: '/platform/templates', label: 'Templates', icon: <Layers className="w-8 h-8" strokeWidth={1.75} /> },
              ],
            },
          ]}
        />
    </PlatformPageChrome>
  )
}
