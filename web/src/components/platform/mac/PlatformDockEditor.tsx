// Copyright (c) 2026 ZyvorAI Labs Private Limited. All rights reserved.

import { useMemo, useState } from 'react'
import { ChevronDown, ChevronUp, GripVertical, Plus, RotateCcw, Trash2, X } from 'lucide-react'
import {
  defaultDockPathsForTier,
  loadPlatformDockPaths,
  resetPlatformDockPaths,
  savePlatformDockPaths,
  PLATFORM_SIDEBAR_FLAT,
} from '../../../utils/platformDockPins'
import { isPathAllowedForTier, loadPlatformDesktopTier } from '../../../utils/platformDesktopTier'

interface PlatformDockEditorProps {
  open: boolean
  onClose: () => void
}

export default function PlatformDockEditor({ open, onClose }: PlatformDockEditorProps) {
  const tier = loadPlatformDesktopTier()
  const [paths, setPaths] = useState<string[]>(() => loadPlatformDockPaths())
  const [addPath, setAddPath] = useState('')

  const catalog = useMemo(
    () => PLATFORM_SIDEBAR_FLAT.filter((i) => isPathAllowedForTier(i.path, tier)),
    [tier],
  )

  const pinned = useMemo(
    () => paths.map((p) => catalog.find((i) => i.path === p)).filter(Boolean),
    [paths, catalog],
  )

  const available = useMemo(
    () => catalog.filter((i) => !paths.includes(i.path)),
    [paths, catalog],
  )

  if (!open) return null

  const move = (idx: number, dir: -1 | 1) => {
    const next = [...paths]
    const target = idx + dir
    if (target < 0 || target >= next.length) return
    ;[next[idx], next[target]] = [next[target], next[idx]]
    setPaths(next)
  }

  const remove = (path: string) => setPaths((p) => p.filter((x) => x !== path))

  const add = () => {
    if (!addPath || paths.includes(addPath)) return
    setPaths((p) => [...p, addPath])
    setAddPath('')
  }

  const save = () => {
    if (paths.length) savePlatformDockPaths(paths)
    onClose()
  }

  return (
    <div className="fixed inset-0 z-[400] flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} aria-hidden />
      <div className="mac-menu-panel relative w-full max-w-md p-5 space-y-4" role="dialog" aria-modal="true" aria-labelledby="dock-editor-title">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 id="dock-editor-title" className="text-lg font-semibold text-white">Customize Dock</h2>
            <p className="text-sm text-white/50">Reorder pinned apps — synced with Finder favorites.</p>
          </div>
          <button type="button" onClick={onClose} className="mac-menubar-icon-btn" title="Close" aria-label="Close">
            <X className="h-4 w-4" />
          </button>
        </div>

        <ul className="space-y-1 max-h-64 overflow-y-auto">
          {pinned.map((item, idx) => {
            if (!item) return null
            return (
              <li key={item.path} className="flex items-center gap-2 rounded-lg border border-white/[0.08] px-2 py-1.5">
                <GripVertical className="h-4 w-4 text-white/30 shrink-0" />
                <span className="flex-1 text-sm text-white truncate">{item.label}</span>
                <button type="button" className="mac-menubar-icon-btn" onClick={() => move(idx, -1)} disabled={idx === 0} title="Move up" aria-label="Move up">
                  <ChevronUp className="h-4 w-4" />
                </button>
                <button type="button" className="mac-menubar-icon-btn" onClick={() => move(idx, 1)} disabled={idx === paths.length - 1} title="Move down" aria-label="Move down">
                  <ChevronDown className="h-4 w-4" />
                </button>
                <button type="button" className="mac-menubar-icon-btn text-rose-300" onClick={() => remove(item.path)} title="Remove" aria-label="Remove">
                  <Trash2 className="h-4 w-4" />
                </button>
              </li>
            )
          })}
        </ul>

        <div className="flex gap-2">
          <select className="input flex-1 text-sm" aria-label="Add app to dock" value={addPath} onChange={(e) => setAddPath(e.target.value)}>
            <option value="">Add app…</option>
            {available.map((item) => (
              <option key={item.path} value={item.path}>{item.label}</option>
            ))}
          </select>
          <button type="button" className="btn-secondary" onClick={add} disabled={!addPath}>
            <Plus className="h-4 w-4" />
          </button>
        </div>

        <div className="flex flex-wrap gap-2 justify-end">
          <button
            type="button"
            className="btn-secondary text-sm inline-flex items-center gap-1"
            onClick={() => { resetPlatformDockPaths(); setPaths([...defaultDockPathsForTier(tier)]) }}
          >
            <RotateCcw className="h-3.5 w-3.5" /> Reset defaults
          </button>
          <button type="button" className="btn-primary text-sm" onClick={save}>Save</button>
        </div>
      </div>
    </div>
  )
}
