// Copyright (c) 2026 ZyvorAI Labs Private Limited. All rights reserved.
// Proprietary software — see LICENSE in the repository root.
// https://zyvor.dev · info@zyvor.dev

import { useEffect, useState, useCallback } from 'react'
import { Link } from 'react-router'
import { getCapabilities, getSysinfo, CapabilitiesInfo } from '../api/advanced'
import { getOpenStackStatus, type OpenStackConnectionStatus } from '../api/openstack'
import { usePlatformInfo } from '../contexts/PlatformInfoContext'
import { useOpenStackConnection } from '../hooks/useOpenStackConnection'
import OpenStackUnreachablePanel from '../components/OpenStackUnreachablePanel'
import { useToastContext } from '../contexts/ToastContext'
import { RefreshCw, Cpu, Info, Cloud } from 'lucide-react'
import OpenStackSetupPanel from '../components/OpenStackSetupPanel'
import PageLayout from '../components/PageLayout'
import { ChoiceCard, ChoiceCardGrid } from '../components/ChoiceCards'
import SysinfoDisplay from '../components/SysinfoDisplay'
import { formatUserError } from '../utils/apiError'
import { statusBadgeClasses } from '../utils/semanticColors'

export default function CapabilitiesPage() {
  const [capabilities, setCapabilities] = useState<CapabilitiesInfo | null>(null)
  const [sysinfo, setSysinfo] = useState('')
  const [tab, setTab] = useState<'capabilities' | 'sysinfo'>('capabilities')
  const [loading, setLoading] = useState(true)
  const [openstackStatus, setOpenstackStatus] = useState<OpenStackConnectionStatus | null>(null)
  const toast = useToastContext()
  const { info } = usePlatformInfo()
  const { phase: osPhase } = useOpenStackConnection()

  const load = useCallback(async () => {
    try {
      setLoading(true)
      const [caps, sys, os] = await Promise.all([
        getCapabilities().catch(() => null),
        getSysinfo().catch(() => ''),
        getOpenStackStatus().catch(() => null),
      ])
      setCapabilities(caps)
      setSysinfo(sys)
      setOpenstackStatus(os)
    } catch (e: unknown) {
      toast.error(`${formatUserError(e)}`)
    } finally {
      setLoading(false)
    }
  }, [toast])

  useEffect(() => { load() }, [load])

  if (loading) return <PageLayout title="Capabilities" icon={<Cpu className="w-6 h-6" />} contentLoading />

  const tabs = [
    { key: 'capabilities' as const, label: 'Capabilities', icon: <Cpu className="w-4 h-4" /> },
    { key: 'sysinfo' as const, label: 'System Info', icon: <Info className="w-4 h-4" /> },
  ]

  return (
    <PageLayout
      title="Capabilities"
      icon={<Cpu className="w-6 h-6" />}
      subtitle="libvirt-reported guest architectures and host features for this QEMU/KVM worker."
      actions={
        <button onClick={load} className="p-2 hover:bg-slate-700 rounded transition shrink-0" title="Refresh" aria-label="Refresh">
          <RefreshCw className="w-4 h-4" />
        </button>
      }
    >
      <div>
        <h2 className="text-sm font-semibold text-slate-400 uppercase tracking-wide mb-2">View</h2>
        <ChoiceCardGrid>
          {tabs.map((t) => (
            <ChoiceCard
              key={t.key}
              compact
              tone="blue"
              selected={tab === t.key}
              onClick={() => setTab(t.key)}
              icon={t.icon}
              title={t.label}
            />
          ))}
        </ChoiceCardGrid>
      </div>

      {tab === 'capabilities' && (
        <div className="space-y-4">
          {osPhase === 'live' && openstackStatus ? (
            <div className="rounded-xl border border-sky-500/30 bg-sky-950/20 p-4 flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center gap-3">
                <Cloud className="w-6 h-6 text-sky-400" />
                <div>
                  <h3 className="font-semibold text-slate-100">OpenStack</h3>
                  <p className="text-sm text-slate-400">
                    {openstackStatus.cloud_name} · {openstackStatus.instance_count ?? 0} instances · live
                  </p>
                </div>
              </div>
              <Link to="/openstack" className="text-sm text-sky-400 hover:underline">
                Open cloud UI →
              </Link>
            </div>
          ) : osPhase === 'unreachable' ? (
            <OpenStackUnreachablePanel />
          ) : (
            <OpenStackSetupPanel compact />
          )}
        </div>
      )}

      {tab === 'capabilities' && capabilities && (
        <div className="space-y-6">
          <div className="bg-slate-800/50 rounded-xl p-6 border border-slate-700/50 space-y-4">
            <h3 className="text-lg font-semibold">Host</h3>
            <div className="flex items-center justify-between py-2 border-b border-slate-700/50">
              <span className="text-slate-400 text-sm">Architecture</span>
              <span className="text-sm font-medium">{capabilities.host_arch}</span>
            </div>
            <div className="flex items-center justify-between py-2 border-b border-slate-700/50">
              <span className="text-slate-400 text-sm">CPU Model</span>
              <span className="text-sm font-medium">{capabilities.host_cpu_model}</span>
            </div>
            <div className="flex items-center justify-between py-2">
              <span className="text-slate-400 text-sm">SPICE Graphics</span>
              <span className={`text-sm font-medium px-2 py-0.5 rounded ${statusBadgeClasses(capabilities.spice_available ? 'ok' : 'neutral')}`}>
                {capabilities.spice_available ? 'Available' : 'Not available'}
              </span>
            </div>
          </div>

          <div className="bg-slate-800/50 rounded-xl border border-slate-700/50 overflow-hidden">
            <div className="px-6 py-4 border-b border-slate-700/50">
              <h3 className="text-lg font-semibold">Guest Architectures</h3>
            </div>
            {capabilities.guests.length === 0 ? <div className="p-8 text-center text-slate-500">No guest capabilities.</div> : (
              <table className="w-full">
                <thead><tr className="border-b border-slate-700/50 text-left text-sm text-slate-400"><th className="px-6 py-3">OS Type</th><th className="px-6 py-3">Architecture</th><th className="px-6 py-3">Machines</th></tr></thead>
                <tbody className="divide-y divide-slate-700/50">
                  {capabilities.guests.map((g, i) => (
                    <tr key={i} className="hover:bg-slate-700/50">
                      <td className="px-6 py-3 text-sm font-medium">{g.os_type}</td>
                      <td className="px-6 py-3 text-sm">{g.arch}</td>
                      <td className="px-6 py-3 text-sm text-slate-400">{g.machines.slice(0, 5).join(', ')}{g.machines.length > 5 ? ` (+${g.machines.length - 5} more)` : ''}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>
      )}

      {tab === 'capabilities' && !capabilities && (
        <div className="bg-slate-800/50 rounded-xl border border-slate-700/50 p-8 text-center text-slate-500">No capabilities data available.</div>
      )}

      {tab === 'sysinfo' && (
        <div className="bg-slate-800/50 rounded-xl border border-slate-700/50 p-4 sm:p-6">
          <SysinfoDisplay xml={sysinfo} />
        </div>
      )}
    </PageLayout>
  )
}
