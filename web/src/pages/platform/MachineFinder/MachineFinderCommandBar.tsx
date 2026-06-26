// Copyright (c) 2026 ZyvorAI Labs Private Limited. All rights reserved.

import { Link } from 'react-router'
import { Monitor, Plus, RefreshCw, Search, Sparkles } from 'lucide-react'
import { dispatchOpenSpotlight } from '../../../utils/platformJarvisShell'
import type { MachineFinderState } from './useMachineFinder'

type Props = {
  state: MachineFinderState
}

export default function MachineFinderCommandBar({ state }: Props) {
  const {
    search,
    setSearch,
    statsSubtitle,
    load,
    fleetGuestBusy,
    runFleetGuestQuery,
    setWizardOpen,
    setWizardInitial,
    setWindowsOpen,
  } = state

  return (
    <header className="machine-finder-command-bar flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between" data-testid="machine-finder-command-bar">
      <div className="min-w-0">
        <div className="flex items-center gap-2">
          <Monitor className="w-6 h-6 text-slate-400 shrink-0" />
          <h1 className="text-xl font-semibold text-white truncate">Machine Finder</h1>
        </div>
        <p className="text-sm text-slate-400 mt-0.5 truncate">{statsSubtitle}</p>
      </div>

      <div className="flex flex-wrap items-center gap-2 flex-1 sm:justify-end">
        <div className="relative flex-1 min-w-[12rem] max-w-md">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500 pointer-events-none" />
          <input
            type="search"
            aria-label="Search machines"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
                dispatchOpenSpotlight(search.trim() || undefined)
              }
            }}
            placeholder="Search machines or ⌘K…"
            className="w-full pl-9 pr-3 py-2 rounded-lg bg-slate-900/60 border border-white/[0.08] text-sm text-slate-100 placeholder:text-slate-500 focus:outline-none focus:ring-1 focus:ring-sky-500/40"
            data-testid="machine-finder-search"
          />
        </div>
        <button type="button" className="btn-secondary text-sm inline-flex items-center gap-1" disabled={fleetGuestBusy} onClick={() => void runFleetGuestQuery()}>
          {fleetGuestBusy ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />}
          Analyze
        </button>
        <button type="button" className="btn-secondary text-sm" onClick={() => state.setLens('migration')}>
          Migrate
        </button>
        <Link to="/platform/vm-builder" className="btn-secondary text-sm">AI Builder</Link>
        <button type="button" className="btn-secondary text-sm hidden sm:inline-flex" onClick={() => setWindowsOpen(true)}>Windows</button>
        <button type="button" className="btn-secondary p-2" onClick={() => void load()} aria-label="Refresh"><RefreshCw className="w-4 h-4" /></button>
        <button
          type="button"
          className="btn-primary text-sm inline-flex items-center gap-1"
          data-testid="machine-finder-new-vm"
          onClick={() => { setWizardInitial(undefined); setWizardOpen(true) }}
        >
          <Plus className="w-4 h-4" /> New VM
        </button>
      </div>
    </header>
  )
}
