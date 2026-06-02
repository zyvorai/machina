// Copyright (c) 2026 ZyvorAI Labs Private Limited. All rights reserved.

import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router'
import { MapPin, RefreshCw, Server } from 'lucide-react'
import PageLayout from '../../components/PageLayout'
import PageSkeleton from '../../components/PageSkeleton'
import PlatformEmptyState from '../../components/platform/PlatformEmptyState'
import InfrastructureEarthGlobe from '../../components/platform/InfrastructureEarthGlobe'
import MachineFinderGeography, { UNASSIGNED_SITE } from '../../components/platform/MachineFinderGeography'
import PlatformTahoeHero from '../../components/platform/tahoe/PlatformTahoeHero'
import FinderView from '../../components/platform/mac/FinderView'
import {
  getFleetMission,
  listPlatformVms,
  type FleetMissionOverview,
  type PlatformVm,
} from '../../api/platform'
import { formatUserError } from '../../utils/apiError'
import { hubLinkClasses } from '../../utils/semanticColors'

export default function PlatformMachineFinder() {
  const navigate = useNavigate()
  const [searchParams, setSearchParams] = useSearchParams()
  const [mission, setMission] = useState<FleetMissionOverview | null>(null)
  const [vms, setVms] = useState<PlatformVm[]>([])
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')

  const site = searchParams.get('site')
  const rack = searchParams.get('rack')
  const hostId = searchParams.get('host')
  const vmId = searchParams.get('vm')

  const load = useCallback(async () => {
    setError(null)
    setLoading(true)
    try {
      const [m, v] = await Promise.all([
        getFleetMission(),
        listPlatformVms(),
      ])
      setMission(m)
      setVms(v)
    } catch (e: unknown) {
      setError(formatUserError(e))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { void load() }, [load])

  const defaultSite = useMemo(() => {
    if (!mission) return null
    if (mission.sites.length > 0) return mission.sites[0].name
    if (mission.unassigned_hosts.length > 0) return UNASSIGNED_SITE
    return null
  }, [mission])

  const effectiveSite = site ?? defaultSite
  const effectiveRack = useMemo(() => {
    if (!mission || !effectiveSite) return null
    if (rack) return rack
    if (effectiveSite === UNASSIGNED_SITE) return 'All hosts'
    const siteNode = mission.sites.find((s) => s.name === effectiveSite)
    return siteNode?.racks[0]?.name ?? null
  }, [mission, effectiveSite, rack])

  const patchParams = (next: Record<string, string | null>) => {
    const p = new URLSearchParams(searchParams)
    for (const [key, val] of Object.entries(next)) {
      if (val == null || val === '') p.delete(key)
      else p.set(key, val)
    }
    setSearchParams(p, { replace: true })
  }

  const filteredMission = useMemo((): FleetMissionOverview | null => {
    if (!mission) return null
    const q = search.trim().toLowerCase()
    if (!q) return mission

    const matchHost = (hostname: string) => hostname.toLowerCase().includes(q)
    const matchVmHostIds = new Set(
      vms.filter((v) => v.name.toLowerCase().includes(q) && v.host_id).map((v) => v.host_id as string),
    )

    const filterHosts = (hosts: typeof mission.unassigned_hosts) =>
      hosts.filter((h) => matchHost(h.hostname) || matchVmHostIds.has(h.id))

    return {
      ...mission,
      sites: mission.sites
        .map((s) => ({
          ...s,
          racks: s.racks
            .map((r) => ({ ...r, hosts: filterHosts(r.hosts) }))
            .filter((r) => r.hosts.length > 0),
        }))
        .filter((s) => s.racks.length > 0),
      unassigned_hosts: filterHosts(mission.unassigned_hosts),
    }
  }, [mission, vms, search])

  const hasGeography = filteredMission && (
    filteredMission.sites.length > 0 || filteredMission.unassigned_hosts.length > 0
  )

  const toolbar = (
    <>
      <Link to="/platform?mission=1" className={`btn-secondary text-sm ${hubLinkClasses()}`}>Mission Control</Link>
      <button type="button" className="btn-secondary" onClick={() => void load()} aria-label="Refresh">
        <RefreshCw className="w-4 h-4" />
      </button>
    </>
  )

  return (
    <PageLayout hideHeader error={error} onErrorRetry={() => void load()}>
      <PlatformTahoeHero
        title="Machine Finder"
        subtitle="Browse datacenter geography — site, rack, host, and VM — aligned with Mission Control."
        icon={MapPin}
        stats={mission ? [
          { label: 'Sites', value: String(mission.sites.length), tone: 'sky' },
          { label: 'Hosts', value: String(mission.summary.hosts), tone: 'violet' },
          { label: 'VMs', value: String(mission.summary.vms), tone: 'emerald' },
        ] : []}
      />

      {!loading && mission && (
        <InfrastructureEarthGlobe mission={mission} className="mx-0" />
      )}

      <div className="tahoe-content space-y-4">
        {loading && <PageSkeleton />}

        {!loading && !error && !hasGeography && (
          <PlatformEmptyState
            icon={Server}
            title="No infrastructure geography"
            subtitle="Enroll hosts and set site/rack metadata on host detail to build your datacenter tree."
          >
            <Link to="/platform/enroll" className="tahoe-btn-primary text-sm">Add host</Link>
            <Link to="/platform/hosts" className={`tahoe-btn-ghost text-sm ${hubLinkClasses()}`}>Browse hosts</Link>
          </PlatformEmptyState>
        )}

        {!loading && filteredMission && hasGeography && (
          <FinderView
            title="Infrastructure"
            search={search}
            onSearchChange={setSearch}
            searchPlaceholder="Filter hosts or VMs…"
            viewMode="columns"
            onViewModeChange={() => {}}
            toolbarActions={toolbar}
            pathSegments={[
              { label: 'Platform', onClick: () => navigate('/platform') },
              { label: 'Hosts', onClick: () => navigate('/platform/hosts') },
              { label: 'Machine Finder' },
            ]}
            listContent={<div className="hidden" aria-hidden />}
            columnsContent={
              <MachineFinderGeography
                mission={filteredMission}
                vms={vms}
                selection={{
                  site: effectiveSite,
                  rack: effectiveRack,
                  hostId,
                  vmId,
                }}
                onSelectSite={(s) => patchParams({ site: s, rack: null, host: null, vm: null })}
                onSelectRack={(r) => patchParams({ rack: r, host: null, vm: null })}
                onSelectHost={(id) => patchParams({ host: id, vm: null })}
                onSelectVm={(id) => patchParams({ vm: id })}
              />
            }
            showInspector={false}
          />
        )}
      </div>
    </PageLayout>
  )
}
