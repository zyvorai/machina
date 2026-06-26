// Copyright (c) 2026 ZyvorAI Labs Private Limited. All rights reserved.
// Proprietary software — see LICENSE in the repository root.
// https://zyvor.dev · info@zyvor.dev

/** Renders libvirt `<sysinfo type='smbios'>` (or similar) as readable cards. */

import { statusToneClass } from '../utils/semanticColors'

const SECTION_LABELS: Record<string, string> = {
  bios: 'BIOS',
  system: 'System',
  baseboard: 'Motherboard',
  chassis: 'Chassis',
  processor: 'Processor',
  memory_device: 'Memory',
  oemstrings: 'OEM strings',
}

function sectionTitle(tag: string): string {
  const k = tag.toLowerCase()
  return SECTION_LABELS[k] ?? tag.replace(/_/g, ' ')
}

function parseEntries(section: Element): { name: string | null; value: string }[] {
  const out: { name: string | null; value: string }[] = []
  for (const child of Array.from(section.children)) {
    if (child.tagName.toLowerCase() !== 'entry') continue
    const name = child.getAttribute('name')
    const value = (child.textContent ?? '').trim()
    if (value || name) out.push({ name, value })
  }
  return out
}

function memorySubtitle(section: Element): string | undefined {
  for (const child of Array.from(section.children)) {
    if (child.tagName.toLowerCase() !== 'entry') continue
    if (child.getAttribute('name') === 'locator') {
      const v = (child.textContent ?? '').trim()
      if (v) return v
    }
  }
  return undefined
}

export default function SysinfoDisplay({ xml }: { xml: string }) {
  const trimmed = xml.trim()
  if (!trimmed) {
    return <p className="text-slate-500 text-sm px-1">No system info available.</p>
  }

  const doc = new DOMParser().parseFromString(trimmed, 'application/xml')
  if (doc.querySelector('parsererror')) {
    return (
      <div className="space-y-2">
        <p className={`${statusToneClass('warn')} opacity-90 text-sm`}>Could not parse as XML — raw output:</p>
        <pre className="p-4 text-xs text-slate-300 overflow-x-auto whitespace-pre-wrap font-mono bg-slate-950/50 rounded-lg border border-slate-700/50">{trimmed}</pre>
      </div>
    )
  }

  const sysinfo = doc.querySelector('sysinfo')
  if (!sysinfo) {
    return (
      <pre className="p-4 text-xs text-slate-300 overflow-x-auto whitespace-pre-wrap font-mono bg-slate-950/50 rounded-lg border border-slate-700/50">{trimmed}</pre>
    )
  }

  const sections = Array.from(sysinfo.children).filter((n) => n.nodeType === Node.ELEMENT_NODE) as Element[]

  return (
    <div className="space-y-4">
      {sysinfo.getAttribute('type') && (
        <p className="text-xs text-slate-500 uppercase tracking-wide">
          Type: <span className="text-slate-400 font-mono">{sysinfo.getAttribute('type')}</span>
        </p>
      )}
      {sections.map((section, idx) => {
        const tag = section.tagName
        const key = `${tag}-${idx}`
        const entries = parseEntries(section)
        const subtitle = tag.toLowerCase() === 'memory_device' ? memorySubtitle(section) : undefined

        return (
          <div
            key={key}
            className="rounded-xl border border-slate-700/50 bg-slate-900/40 overflow-hidden"
          >
            <div className="px-4 py-3 border-b border-slate-700/50 bg-slate-800/40 flex items-baseline justify-between gap-2 flex-wrap">
              <h3 className="text-sm font-semibold text-slate-100">{sectionTitle(tag)}</h3>
              {subtitle && <span className="text-xs text-slate-500 font-mono">{subtitle}</span>}
            </div>
            {entries.length === 0 ? (
              <div className="px-4 py-3 text-xs text-slate-500">No entries</div>
            ) : (
              <dl className="divide-y divide-slate-700/30">
                {entries.map((row, i) => (
                  <div key={row.name ?? i} className="grid grid-cols-1 sm:grid-cols-3 gap-1 sm:gap-3 px-4 py-2.5 text-sm">
                    {row.name ? (
                      <>
                        <dt className="text-slate-500 sm:col-span-1 font-medium break-words">{row.name}</dt>
                        <dd className="text-slate-200 sm:col-span-2 font-mono text-xs sm:text-sm break-words">{row.value || '—'}</dd>
                      </>
                    ) : (
                      <dd className="text-slate-300 sm:col-span-3 text-sm">{row.value}</dd>
                    )}
                  </div>
                ))}
              </dl>
            )}
          </div>
        )
      })}
    </div>
  )
}
