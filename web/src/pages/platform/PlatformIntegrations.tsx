// Copyright (c) 2026 ZyvorAI Labs Private Limited. All rights reserved.

import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router'
import {hostStateTone, httpStatusTone, migrationReadinessTone, riskTone, statusBadgeClasses, statusPillClasses, statusToneClass, taskStatusTone, webhookDeliveryTone, hubLinkClasses} from '../../utils/semanticColors'
import { ExternalLink, Puzzle, Sparkles, Boxes, Server } from 'lucide-react'
import HostEnrollWizard from '../../components/platform/HostEnrollWizard'
import PlatformEmptyState from '../../components/platform/PlatformEmptyState'
import { listPlatformHosts } from '../../api/platform'
import { LaunchpadAppIcon, MacGlassPanel } from '../../components/platform/mac/PlatformMacUi'
import PlatformPageChrome, { PlatformBackLink, platformStatSubtitle } from '../../components/platform/PlatformPageChrome'
import { usePlatformInfo } from '../../contexts/PlatformInfoContext'
import { integrationCards } from '../../utils/platformIntegrationsNav'
import { CLASSIC_TOOL_CARDS, LIBVIRT_ADMIN_TOOL_CARDS } from '../../utils/platformClassicTools'
import { PlatformClassicToolLinks } from '../../components/platform/PlatformCrossLinks'
import PlatformDesktopTierPicker from '../../components/platform/PlatformDesktopTierPicker'
import PlatformIntegrationEmbeds from '../../components/platform/PlatformIntegrationEmbeds'
import { usePlatformDesktopTier } from '../../hooks/usePlatformDesktopTier'

export default function PlatformIntegrations({ embedded }: { embedded?: boolean } = {}) {
  const { info } = usePlatformInfo()
  const [tier, setTier] = usePlatformDesktopTier()
  const [hostCount, setHostCount] = useState<number | null>(null)
  const [enrollOpen, setEnrollOpen] = useState(false)
  const cards = integrationCards(info)
  const enabledCount = cards.filter((c) => c.enabled).length

  const loadHosts = useCallback(async () => {
    try {
      const hosts = await listPlatformHosts()
      setHostCount(hosts.length)
    } catch {
      setHostCount(null)
    }
  }, [])

  useEffect(() => {
    void loadHosts()
  }, [loadHosts])

  return (
    <PlatformPageChrome
      hideHeader={embedded}
      compact={embedded}
      className={embedded ? '' : 'max-w-4xl'}
      prepend={embedded ? undefined : <PlatformBackLink to="/platform" label="Platform" />}
      title={embedded ? undefined : 'Apps & Integrations'}
      subtitle={
        embedded ? undefined : (
          <span className="flex flex-col gap-1">
            <span className="text-slate-400">OpenStack, K8s, migration tools, and classic UI</span>
            {platformStatSubtitle([
              { label: 'Available', value: String(cards.length) },
              { label: 'Enabled', value: String(enabledCount) },
              { label: 'Desktop tier', value: tier.charAt(0).toUpperCase() + tier.slice(1) },
            ])}
          </span>
        )
      }
      icon={embedded ? undefined : <Puzzle className="w-6 h-6 text-slate-400" />}
      contentClassName="space-y-6"
    >
        {hostCount === 0 && (
          <PlatformEmptyState
            icon={Server}
            title="No hypervisors enrolled"
            subtitle="Enroll a host before connecting OpenStack, migration tools, or fleet apps."
          >
            <button type="button" className="tahoe-btn-primary text-sm" onClick={() => setEnrollOpen(true)}>
              Enroll host
            </button>
          </PlatformEmptyState>
        )}

        <MacGlassPanel title="Fleet apps" subtitle="Launchpad and connected platforms">
          <div className="platform-launchpad-grid grid grid-cols-3 sm:grid-cols-4 md:grid-cols-5 gap-x-4 gap-y-8 -mt-1">
            <Link to="/platform/applications" className="block">
              <LaunchpadAppIcon name="Applications" icon={<Boxes className="w-8 h-8" strokeWidth={1.75} />} />
            </Link>
          </div>
        </MacGlassPanel>

        <MacGlassPanel title="Desktop density">
          <p className="text-sm text-slate-400 mb-3">
            Start with <strong className="text-slate-200">Normal</strong> for a clean Finder-style desktop. Switch to Power or Advanced when you need Zeus, firewall modules, and the full sidebar.
          </p>
          <PlatformDesktopTierPicker tier={tier} onChange={setTier} />
        </MacGlassPanel>

        <div className="grid gap-4 sm:grid-cols-2">
          {cards.map((c) => (
            <Link
              key={c.id}
              to={c.href}
              className={`tahoe-integration-card ${c.enabled ? 'tahoe-glass-card' : 'tahoe-integration-card-disabled'}`}
            >
              <div className="flex items-start justify-between gap-2">
                <h3 className="font-semibold text-slate-100">{c.title}</h3>
                {c.enabled ? (
                  <ExternalLink className="w-4 h-4 text-slate-500 shrink-0" />
                ) : (
                  <span className="text-[10px] uppercase text-slate-500">off</span>
                )}
              </div>
              <p className="text-sm text-slate-400 mt-2 leading-relaxed">{c.description}</p>
              {c.enabled && c.configured === false && (
                <p className={`text-xs mt-2 ${statusToneClass('warn')}`}>Configured but needs clouds.yaml or auth — open to finish setup.</p>
              )}
            </Link>
          ))}
        </div>

        <PlatformIntegrationEmbeds />

        <MacGlassPanel title="Libvirt admin (classic)" subtitle="NW filters, secrets vault, and capability matrix — daemon-only routes">
          <p className="text-sm text-slate-400 mb-4 leading-relaxed">
            These tools manage libvirt objects on the co-located hypervisor daemon. They open in the classic Machina shell with the same session.
          </p>
          <PlatformClassicToolLinks tools={LIBVIRT_ADMIN_TOOL_CARDS} />
        </MacGlassPanel>

        <MacGlassPanel title="Classic Machina tools">
          <p className="text-sm text-slate-400 mb-4 leading-relaxed">
            Import wizards, libvirt node tools, NW filters, secrets, and the classic audit viewer — same daemon, classic UI chrome.
          </p>
          <PlatformClassicToolLinks tools={CLASSIC_TOOL_CARDS} />
          <p className="text-sm text-slate-400 mt-4 pt-4 border-t border-white/[0.06]">
            Host REST catalog:{' '}
            <Link to="/api-docs" className={`hover:underline ${hubLinkClasses()}`}>Classic API explorer</Link>
            {' · '}
            <Link to="/platform/developer" className={`hover:underline ${hubLinkClasses()}`}>Platform Developer console</Link>
          </p>
        </MacGlassPanel>

        <MacGlassPanel title="Leaving the desktop">
          <p className="text-sm text-slate-400 leading-relaxed">
            OpenStack, HyperSDK, GuestKit, and classic routes open outside the Platform shell. You stay signed in to the same Machina session — use the sidebar or <Link to="/platform" className={hubLinkClasses()}>Platform home</Link> to return.
          </p>
        </MacGlassPanel>

        <MacGlassPanel title="Need more?">
          <p className="text-sm text-slate-400 flex items-center gap-2">
            <Sparkles className="w-4 h-4 text-violet-400" />
            Switch to <Link to="/platform/settings?section=general" className={hubLinkClasses()}>Settings → Appearance → Advanced</Link> for the full fleet sidebar, Zeus Firewall panes, and developer SDK routes.
          </p>
        </MacGlassPanel>

      <HostEnrollWizard open={enrollOpen} onClose={() => { setEnrollOpen(false); void loadHosts() }} />
    </PlatformPageChrome>
  )
}
