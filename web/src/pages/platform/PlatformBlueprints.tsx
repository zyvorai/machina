// Copyright (c) 2026 ZyvorAI Labs Private Limited. All rights reserved.

import { useCallback, useEffect, useState } from 'react'
import ConfirmDialog from '../../components/ConfirmDialog'
import { Link } from 'react-router'
import { LayoutGrid, Play, Plus, Trash2, Workflow, Wrench } from 'lucide-react'
import {
  LaunchpadAppIcon,
  MacGlassPanel,
  MacStatWidget,
  NewLaunchpadCard,
} from '../../components/platform/mac/PlatformMacUi'
import DetailTabs from '../../components/platform/DetailTabs'
import PlatformPageChrome, { PlatformBackLink, PlatformRefreshButton } from '../../components/platform/PlatformPageChrome'
import { usePlatformTabState } from '../../hooks/usePlatformTabState'
import FleetSettingsPane from '../../components/platform/FleetSettingsPane'
import {
  createBlueprint,
  deleteBlueprint,
  getFleetShortcuts,
  listBlueprints,
  listPlatformVms,
  runBlueprint,
  type Blueprint,
  type FleetShortcutsOverview,
} from '../../api/platform'
import { aiGenerateBlueprint } from '../../api/ai'
import { useToastContext } from '../../contexts/ToastContext'
import { formatUserError } from '../../utils/apiError'
import { hubLinkClasses } from '../../utils/semanticColors'

type TabId = 'launchpad' | 'studio'

const BLUEPRINT_TABS = [
  { id: 'launchpad' as const, label: 'Launchpad' },
  { id: 'studio' as const, label: 'Studio' },
]

export default function PlatformBlueprints() {
  const toast = useToastContext()
  const [tab, setTab] = usePlatformTabState<TabId>(BLUEPRINT_TABS.map((t) => t.id), { defaultTab: 'launchpad' })

  const [fleet, setFleet] = useState<FleetShortcutsOverview | null>(null)
  const [rows, setRows] = useState<Blueprint[]>([])
  const [error, setError] = useState<string | null>(null)
  const [running, setRunning] = useState<string | null>(null)
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null)
  const [name, setName] = useState('Nightly backup')
  const [actions, setActions] = useState('backup')
  const [nlPrompt, setNlPrompt] = useState('Nightly backup for all production VMs')
  const [preview, setPreview] = useState<{ name: string; description: string; actions: string[] } | null>(null)
  const [generating, setGenerating] = useState(false)

  const load = useCallback(async () => {
    setError(null)
    try {
      const [f, bps] = await Promise.all([getFleetShortcuts(), listBlueprints()])
      setFleet(f)
      setRows(bps)
    } catch (e: unknown) {
      setError(formatUserError(e))
    }
  }, [])

  useEffect(() => { void load() }, [load])

  const createFromVms = async () => {
    try {
      const vms = await listPlatformVms()
      const actionList = actions.split(',').map((a) => a.trim()).filter(Boolean)
      await createBlueprint({
        name,
        description: 'Automation blueprint',
        actions: actionList,
        vm_ids: vms.slice(0, 5).map((v) => v.id),
      })
      toast.success('Shortcut created')
      await load()
      setTab('launchpad')
    } catch (e: unknown) {
      toast.error(formatUserError(e))
    }
  }

  const runShortcut = async (id: string) => {
    setRunning(id)
    try {
      const r = await runBlueprint(id)
      toast.success(`Queued ${r.task_ids.length} task(s)`)
    } catch (e: unknown) {
      toast.error(formatUserError(e))
    } finally {
      setRunning(null)
    }
  }

  return (
    <PlatformPageChrome
      error={error}
      onErrorRetry={() => void load()}
      prepend={<PlatformBackLink to="/platform/operations" label="Operations" />}
      title="Blueprint Studio"
      subtitle="macOS Shortcuts-style Launchpad — tap a blueprint to run automation across VM sets."
      icon={<Workflow className="w-6 h-6 text-slate-400" />}
      actions={<PlatformRefreshButton onClick={() => void load()} />}
      contentClassName="space-y-4"
    >
      {fleet && <p className="text-sm text-slate-400">{fleet.summary}</p>}

      {fleet && tab === 'launchpad' && (
        <div className="grid gap-3 sm:grid-cols-3">
          <MacStatWidget label="Shortcuts" value={String(fleet.blueprint_count)} icon={<Workflow className="w-4 h-4" />} />
          <MacStatWidget label="VMs covered" value={String(fleet.total_vms_covered)} icon={<LayoutGrid className="w-4 h-4" />} />
          <MacStatWidget label="Runbooks (24h)" value={String(fleet.executions_24h)} icon={<Wrench className="w-4 h-4" />} />
        </div>
      )}

      <DetailTabs primary={BLUEPRINT_TABS} active={tab} onChange={setTab} />

      {tab === 'launchpad' && (
        <MacGlassPanel title="Shortcut Launchpad" subtitle="Click an icon to run — actions execute as queued tasks per VM.">
          {!fleet ? (
            <p className="text-sm text-slate-400 py-8 text-center">Loading shortcuts…</p>
          ) : (
            <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6 gap-6 py-2">
              <NewLaunchpadCard label="New shortcut" subtitle="Open Studio" onClick={() => setTab('studio')} />
              {(fleet.shortcuts.length ? fleet.shortcuts : rows.map((bp) => ({
                id: bp.id,
                name: bp.name,
                description: bp.description,
                actions: bp.actions ?? [],
                vm_count: bp.vm_ids?.length ?? 0,
                action_count: (bp.actions ?? []).length,
              }))).map((bp) => (
                <LaunchpadAppIcon
                  key={bp.id}
                  name={bp.name}
                  icon={running === bp.id ? <Play className="w-7 h-7 animate-pulse" /> : <Workflow className="w-7 h-7" />}
                  vmCount={bp.vm_count}
                  onClick={() => void runShortcut(bp.id)}
                />
              ))}
            </div>
          )}
          <div className="flex flex-wrap gap-3 mt-4 pt-2 border-t border-white/[0.04]">
            <Link to="/platform/reports?tab=runbooks" className={`text-sm ${hubLinkClasses()}`}>Operations runbooks →</Link>
          </div>
        </MacGlassPanel>
      )}

      {tab === 'studio' && (
        <>
          <MacGlassPanel title="Generate from description">
            <textarea className="input min-h-20" value={nlPrompt} onChange={(e) => setNlPrompt(e.target.value)} placeholder="Backup all Windows VMs every night" />
            <div className="flex gap-2 flex-wrap">
              <button type="button" className="btn-primary text-sm" disabled={generating} onClick={async () => {
                setGenerating(true)
                try {
                  const r = await aiGenerateBlueprint(nlPrompt)
                  setPreview({ name: r.name, description: r.description, actions: r.actions })
                  setName(r.name)
                  setActions(r.actions.join(','))
                } catch (e: unknown) { toast.error(formatUserError(e)) }
                finally { setGenerating(false) }
              }}>{generating ? 'Generating…' : 'Preview blueprint'}</button>
              {preview && (
                <button type="button" className="btn-secondary text-sm" onClick={() => void createFromVms()}>Save to Launchpad</button>
              )}
            </div>
            {preview && (
              <p className="text-xs text-slate-400">{preview.description} · actions: {preview.actions.join(', ')}</p>
            )}
          </MacGlassPanel>
          <MacGlassPanel title="Manual shortcut">
            <label className="text-sm">Name<input className="input block mt-1" value={name} onChange={(e) => setName(e.target.value)} /></label>
            <label className="text-sm">Actions (comma-separated)<input className="input block mt-1" value={actions} onChange={(e) => setActions(e.target.value)} placeholder="start,stop,backup" /></label>
            <button type="button" className="btn-primary flex items-center gap-2" onClick={() => void createFromVms()}><Plus className="w-4 h-4" /> Create from VMs</button>
          </MacGlassPanel>
          <div className="grid gap-4 md:grid-cols-2">
            {rows.map((bp) => (
              <MacGlassPanel key={bp.id} title={bp.name}>
                <p className="text-xs text-slate-500">{bp.description || 'No description'}</p>
                <p className="text-xs text-slate-400">{(bp.actions ?? []).join(', ')} · {bp.vm_ids?.length ?? 0} VMs</p>
                <div className="flex gap-2">
                  <button type="button" className="btn-primary text-xs flex items-center gap-1" onClick={() => void runShortcut(bp.id)}>
                    <Play className="w-3 h-3" /> Run
                  </button>
                  <button type="button" className="btn-danger text-xs flex items-center gap-1" onClick={() => setConfirmDeleteId(bp.id)}><Trash2 className="w-3 h-3" /> Delete</button>
                </div>
              </MacGlassPanel>
            ))}
          </div>
          {rows.length === 0 && !error && <p className="text-slate-500 text-sm">Create a shortcut in Studio to populate the Launchpad.</p>}
        </>
      )}
      <FleetSettingsPane kind="shortcuts" />
      <ConfirmDialog
        open={confirmDeleteId !== null}
        title="Delete Blueprint"
        message={`Delete "${rows.find((b) => b.id === confirmDeleteId)?.name}"? This cannot be undone.`}
        confirmLabel="Delete"
        variant="danger"
        onCancel={() => setConfirmDeleteId(null)}
        onConfirm={async () => {
          try { await deleteBlueprint(confirmDeleteId!); toast.success('Deleted'); await load() }
          catch (e: unknown) { toast.error(formatUserError(e)) }
          finally { setConfirmDeleteId(null) }
        }}
      />
    </PlatformPageChrome>
  )
}
