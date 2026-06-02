// Copyright (c) 2026 ZyvorAI Labs Private Limited. All rights reserved.
// Proprietary software — see LICENSE in the repository root.
// https://zyvor.dev · info@zyvor.dev

import { ExternalLink, Zap } from 'lucide-react'
import { ZYVOR_URL, ZYVOR_BRAND, ZYVOR_COPY, ZYVOR_LINE } from './ZyvorBrand'
import { MACHINA_HELP, ZEUS_OS_HELP, ZYVOR_HELP, type HelpDocLink } from '../config/zyvorHelp'
import { statusToneClass } from '../utils/semanticColors'

export const MACHINA_PRODUCT = MACHINA_HELP.name
export const MACHINA_VERSION = MACHINA_HELP.version
export const MACHINA_TAGLINE = MACHINA_HELP.tagline
export const ZEUS_OS_PRODUCT = ZEUS_OS_HELP.name
export const ZEUS_OS_TAGLINE = ZEUS_OS_HELP.tagline

const ORANGE = '#f97316'

export type { HelpDocLink }

export const MACHINA_HELP_LINKS: HelpDocLink[] = [
  {
    label: 'Documentation index',
    href: 'https://github.com/ssahani/machina/blob/main/docs/README.md',
  },
  {
    label: 'Web UI & API',
    href: 'https://github.com/ssahani/machina/tree/main/web',
  },
  {
    label: 'KubeVirt migration guide',
    href: 'https://github.com/ssahani/machina/blob/main/docs/kubevirt-migration.md',
  },
  {
    label: 'OpenStack integration',
    href: 'https://github.com/ssahani/machina/blob/main/docs/openstack.md',
  },
  {
    label: 'Zyvor documentation',
    href: ZYVOR_HELP.docs,
  },
  {
    label: 'Machina on zyvor.dev',
    href: MACHINA_HELP.productUrl,
  },
  {
    label: 'Zeus platform',
    href: ZEUS_OS_HELP.productUrl,
  },
  {
    label: 'Zyvor — HyperSDK suite',
    href: ZYVOR_URL,
  },
]

export default function ZyvorAbout({ className = '' }: { className?: string }) {
  return (
    <div className={`space-y-5 text-sm text-slate-300 ${className}`.trim()}>
      <div className="flex items-start gap-4">
        <div className="shrink-0 w-14 h-14 rounded-2xl flex items-center justify-center bg-gradient-to-br from-blue-500/30 to-blue-700/50 border border-blue-400/30 shadow-lg shadow-blue-500/15">
          <Zap className={`w-8 h-8 ${statusToneClass('info')}`} aria-hidden />
        </div>
        <div className="min-w-0 pt-0.5">
          <h3 className="text-lg font-semibold text-white">{MACHINA_PRODUCT}</h3>
          <p className="text-xs text-slate-500 mt-0.5">Version {MACHINA_VERSION}</p>
          <p className="text-sm text-slate-400 mt-2 leading-relaxed">{MACHINA_TAGLINE}</p>
        </div>
      </div>

      <div className="rounded-xl border border-slate-700/60 bg-slate-900/50 p-4 space-y-3">
        <p className="leading-relaxed">
          Part of the{' '}
          <a
            href={ZYVOR_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="font-semibold hover:underline"
            style={{ color: ORANGE }}
          >
            {ZYVOR_BRAND}
          </a>{' '}
          product family — <span className="text-slate-200">{ZEUS_OS_PRODUCT}</span> is the enterprise virtualization platform.
          {MACHINA_PRODUCT} is the AI-native infrastructure operating system (Machina Zeus OS): libvirt/KVM and OpenStack control,
          fleet, observability, and Zeus (Spotlight, assistant, SRE, Autopilot, Digital Twin, Root Cause).
        </p>
        <p className="text-xs text-slate-500 leading-relaxed">
          <span style={{ color: ORANGE }} className="font-medium">
            {ZYVOR_LINE}
          </span>
          <br />
          Proprietary software. Redistribution and use are governed by the repository LICENSE.
        </p>
      </div>

      <div>
        <h4 className="text-xs font-semibold uppercase tracking-wider text-slate-500 mb-2">Help & documentation</h4>
        <ul className="space-y-1.5">
          {MACHINA_HELP_LINKS.map((link) => (
            <li key={link.href}>
              <a
                href={link.href}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1.5 text-slate-300 transition-colors hover:text-[var(--machina-status-info)]"
              >
                <span>{link.label}</span>
                <ExternalLink className="w-3.5 h-3.5 shrink-0 opacity-60" aria-hidden />
              </a>
            </li>
          ))}
        </ul>
      </div>

      <p className="text-center text-xs text-slate-500 pt-2 border-t border-slate-700/50">
        {ZYVOR_COPY} {ZYVOR_BRAND}. All rights reserved.
      </p>
    </div>
  )
}
