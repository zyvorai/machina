// Copyright (c) 2026 ZyvorAI Labs Private Limited. All rights reserved.

import { useEffect, useRef, useState } from 'react'
import { ChevronDown } from 'lucide-react'

export type DetailTabDef<T extends string> = {
  id: T
  label: string
  group?: string
}

function tabButtonClass(active: boolean): string {
  return `px-3 py-2 text-sm whitespace-nowrap rounded-lg transition-colors ${
    active
      ? 'bg-slate-800 text-white font-medium ring-1 ring-slate-700'
      : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/40'
  }`
}

export default function DetailTabs<T extends string>({
  primary,
  more = [],
  active,
  onChange,
}: {
  primary: DetailTabDef<T>[]
  more?: DetailTabDef<T>[]
  active: T
  onChange: (tab: T) => void
}) {
  const [moreOpen, setMoreOpen] = useState(false)
  const moreRef = useRef<HTMLDivElement>(null)
  const moreIds = new Set(more.map((t) => t.id))
  const moreActive = moreIds.has(active)
  const activeMoreLabel = more.find((t) => t.id === active)?.label

  useEffect(() => {
    if (!moreOpen) return
    const onDoc = (e: MouseEvent) => {
      if (moreRef.current && !moreRef.current.contains(e.target as Node)) setMoreOpen(false)
    }
    document.addEventListener('mousedown', onDoc)
    return () => document.removeEventListener('mousedown', onDoc)
  }, [moreOpen])

  let lastGroup = ''

  return (
    <div className="flex flex-wrap items-center gap-1 border-b border-slate-800/80 pb-3">
      {primary.map((tab) => (
        <button
          key={tab.id}
          type="button"
          onClick={() => onChange(tab.id)}
          className={tabButtonClass(active === tab.id)}
        >
          {tab.label}
        </button>
      ))}
      {more.length > 0 && (
        <div className="relative" ref={moreRef}>
          <button
            type="button"
            onClick={() => setMoreOpen((o) => !o)}
            className={`${tabButtonClass(moreActive)} inline-flex items-center gap-1`}
            aria-expanded={moreOpen}
            aria-haspopup="menu"
          >
            {moreActive && activeMoreLabel ? activeMoreLabel : 'More'}
            <ChevronDown className={`w-3.5 h-3.5 transition-transform ${moreOpen ? 'rotate-180' : ''}`} />
          </button>
          {moreOpen && (
            <div
              role="menu"
              className="absolute left-0 top-full z-30 mt-1 min-w-[12rem] rounded-xl border border-slate-700/80 bg-slate-900/95 backdrop-blur-md py-1 shadow-xl"
            >
              {more.map((tab) => {
                const showGroup = tab.group && tab.group !== lastGroup
                if (tab.group) lastGroup = tab.group
                return (
                  <div key={tab.id}>
                    {showGroup && (
                      <p className="px-3 pt-2 pb-1 text-[10px] uppercase tracking-wider text-slate-500">{tab.group}</p>
                    )}
                    <button
                      type="button"
                      role="menuitem"
                      onClick={() => {
                        onChange(tab.id)
                        setMoreOpen(false)
                      }}
                      className={`w-full text-left px-3 py-2 text-sm ${
                        active === tab.id ? 'bg-blue-500/15 text-blue-200' : 'text-slate-300 hover:bg-slate-800/80'
                      }`}
                    >
                      {tab.label}
                    </button>
                  </div>
                )
              })}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
