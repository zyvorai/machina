// Copyright (c) 2026 ZyvorAI Labs Private Limited. All rights reserved.
// Proprietary software — see LICENSE in the repository root.
// https://zyvor.dev · info@zyvor.dev

import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router'
import { Cloud, Server, HardDrive, Plus, GitBranch, Upload, Download, ArrowRight, Globe, Camera } from 'lucide-react'
import Hero from '../components/Hero'
import PageLayout from '../components/PageLayout'
import OpenStackSetupPanel from '../components/OpenStackSetupPanel'
import OpenStackSubNav from '../components/OpenStackSubNav'
import OpenStackStatusBar from '../components/OpenStackStatusBar'
import OpenStackUnreachablePanel from '../components/OpenStackUnreachablePanel'
import OpenStackFooter from '../components/OpenStackFooter'
import { usePlatformInfo } from '../contexts/PlatformInfoContext'
import { useOpenStackConnection } from '../hooks/useOpenStackConnection'
import { listOpenStackImages, listOpenStackInstances } from '../api/openstack'
import { formatUserError } from '../utils/apiError'
import { openStackErrorHints } from '../utils/openstackHints'
import OpenStackQuotasPanel from '../components/OpenStackQuotasPanel'
import OpenStackAdminPanel from '../components/OpenStackAdminPanel'

const QUICK_LINKS = [
  {
    to: '/openstack/instances',
    icon: Server,
    title: 'Nova instances',
    description: 'List, start, stop, reboot, console, volumes, floating IPs, security groups.',
  },
  {
    to: '/openstack/images',
    icon: HardDrive,
    title: 'Glance images',
    description: 'Pull images to the hypervisor, delete, boot new instances from golden images.',
  },
  {
    to: '/openstack/create',
    icon: Plus,
    title: 'Create instance',
    description: 'Wizard: image, flavor, network, keypair, security groups, cloud-init.',
  },
  {
    to: '/openstack/volumes',
    icon: HardDrive,
    title: 'Cinder volumes',
    description: 'Create, clone, transfer, attach, snapshots, bootable volumes.',
  },
  {
    to: '/openstack/flavors',
    icon: Cloud,
    title: 'Nova flavors',
    description: 'Nova flavor catalog — create and delete with admin role.',
  },
  {
    to: '/openstack/floating-ips',
    icon: Globe,
    title: 'Floating IPs',
    description: 'Allocate, associate, and release Neutron floating IPs.',
  },
  {
    to: '/openstack/volume-snapshots',
    icon: Camera,
    title: 'Volume snapshots',
    description: 'Cinder snapshot list and restore workflows.',
  },
  {
    to: '/openstack/migrations',
    icon: GitBranch,
    title: 'Bulk migrations',
    description: 'HyperSDK export pipelines when hypersdk is enabled on the daemon.',
  },
] as const

const PIPELINES = [
  {
    icon: Upload,
    title: 'qcow2 → Glance',
    description: 'Disk Images → Upload to OpenStack (needs upload_enabled).',
    to: '/disk-images',
  },
  {
    icon: Server,
    title: 'libvirt → Glance',
    description: 'VM detail → Push to OpenStack (running VM root disk).',
    to: '/vms',
  },
  {
    icon: Download,
    title: 'Glance → hypervisor',
    description: 'Pull qcow2 from Glance, then Import VM or Create VM with existing disk.',
    to: '/openstack/images',
  },
] as const

function OpenStackLiveOverview() {
  const { info } = usePlatformInfo()
  const { cloudName, computeLive, glanceLive } = useOpenStackConnection()
  const hypersdkEnabled = Boolean(info?.hypersdk?.enabled)
  const [probeError, setProbeError] = useState<string | null>(null)
  const [probing, setProbing] = useState(true)

  const quickLinks = hypersdkEnabled
    ? QUICK_LINKS
    : QUICK_LINKS.filter((l) => l.to !== '/openstack/migrations')

  const probeApis = useCallback(async () => {
    setProbing(true)
    setProbeError(null)
    const tasks: Promise<unknown>[] = []
    if (computeLive) tasks.push(listOpenStackInstances())
    if (glanceLive) tasks.push(listOpenStackImages())
    if (tasks.length === 0) {
      setProbing(false)
      return
    }
    const results = await Promise.allSettled(tasks)
    const failed = results.filter((r) => r.status === 'rejected') as PromiseRejectedResult[]
    if (failed.length > 0) {
      setProbeError(failed.map((r) => formatUserError(r.reason)).join(' · '))
    }
    setProbing(false)
  }, [computeLive, glanceLive])

  useEffect(() => {
    void probeApis()
  }, [probeApis])

  return (
    <PageLayout
      hideHeader
      error={probeError}
      errorTitle="OpenStack API errors"
      errorHints={probeError ? openStackErrorHints(probeError) : undefined}
      technicalDetail={probeError}
      errorTone="red"
      onErrorRetry={() => void probeApis()}
      onErrorDismiss={() => setProbeError(null)}
    >
      <Hero
        title="OpenStack"
        subtitle={`Cloud ${cloudName || '—'} · Nova instances & Glance images without Horizon.`}
        icon={<Cloud className="w-6 h-6" />}
        actions={
          <Link
            to="/openstack/create"
            className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-sky-600 hover:bg-sky-500 text-white text-sm font-medium"
          >
            <Plus className="w-4 h-4" />
            Create instance
          </Link>
        }
      />
      <OpenStackSubNav />
      <OpenStackStatusBar />

      {probing && !probeError && (
        <p className="text-xs text-slate-500">Checking Nova/Glance APIs…</p>
      )}

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {quickLinks.map(({ to, icon: Icon, title, description }) => (
          <Link
            key={to}
            to={to}
            className="group rounded-xl border border-slate-700/60 bg-slate-800/40 p-4 hover:border-sky-500/40 hover:bg-sky-950/20 transition"
          >
            <Icon className="w-6 h-6 text-sky-400 mb-2" />
            <h3 className="font-semibold text-slate-100 flex items-center gap-2">
              {title}
              <ArrowRight className="w-4 h-4 opacity-0 -translate-x-1 group-hover:opacity-100 group-hover:translate-x-0 transition" />
            </h3>
            <p className="text-xs text-slate-400 mt-1 leading-relaxed">{description}</p>
          </Link>
        ))}
      </div>

      <OpenStackQuotasPanel />
      <OpenStackAdminPanel />

      <section className="rounded-xl border border-slate-700/50 bg-slate-800/30 p-5">
        <h2 className="text-sm font-semibold text-slate-300 uppercase tracking-wide mb-3">
          Disk migration pipelines
        </h2>
        <ul className="grid gap-3 sm:grid-cols-3">
          {PIPELINES.map(({ icon: Icon, title, description, to }) => (
            <li key={title}>
              <Link to={to} className="flex gap-3 p-3 rounded-lg border border-slate-700/50 hover:bg-slate-800/50 transition">
                <Icon className="w-5 h-5 text-sky-400 shrink-0 mt-0.5" />
                <div>
                  <div className="text-sm font-medium text-slate-200">{title}</div>
                  <p className="text-xs text-slate-500 mt-0.5">{description}</p>
                </div>
              </Link>
            </li>
          ))}
        </ul>
      </section>

      <OpenStackFooter />
    </PageLayout>
  )
}

export default function OpenStackOverviewPage() {
  const { phase, cloudName, loading, configured } = useOpenStackConnection()

  if (configured && loading) {
    return (
      <PageLayout hideHeader>
        <Hero
          title="OpenStack"
          subtitle="Nova & Glance on this hypervisor — wire Keystone once, manage from Machina."
          icon={<Cloud className="w-6 h-6" />}
        />
        <div className="flex items-center justify-center h-40">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-sky-500" />
        </div>
      </PageLayout>
    )
  }

  if (phase === 'off' || phase === 'needsWire') {
    return (
      <PageLayout hideHeader>
        <Hero
          title="OpenStack"
          subtitle="Nova & Glance on this hypervisor — wire Keystone once, manage from Machina."
          icon={<Cloud className="w-6 h-6" />}
        />
        <OpenStackSubNav />
        <OpenStackStatusBar />
        <OpenStackSetupPanel />
      </PageLayout>
    )
  }

  if (phase === 'unreachable') {
    return (
      <PageLayout hideHeader>
        <Hero
          title="OpenStack"
          subtitle={`Cloud ${cloudName || '—'} is configured but Keystone/API is not reachable.`}
          icon={<Cloud className="w-6 h-6" />}
        />
        <OpenStackSubNav />
        <OpenStackStatusBar />
        <OpenStackUnreachablePanel />
      </PageLayout>
    )
  }

  return <OpenStackLiveOverview />
}
