// Copyright (c) 2026 ZyvorAI Labs Private Limited. All rights reserved.

import { useEffect, useState } from 'react'
import { HardDrive, Cpu, Layers, Network, Package } from 'lucide-react'
import PageLayout from '../../components/PageLayout'
import PlatformTahoeHero from '../../components/platform/tahoe/PlatformTahoeHero'
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
    <PageLayout hideHeader compact={embedded}>
      {!embedded && (
        <PlatformTahoeHero
          compact
          eyebrow="Platform"
          title="Resources"
          subtitle="Storage, networks, images, and templates — macOS Utility folder for your fleet."
          icon={HardDrive}
          stats={[
            { label: 'Storage tiers', value: poolCount != null ? String(poolCount) : '—', tone: 'sky' },
            { label: 'Network segments', value: segmentCount != null ? String(segmentCount) : '—', tone: 'violet' },
          ]}
        />
      )}

      <div className="tahoe-content">
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
      </div>
    </PageLayout>
  )
}
