// Copyright (c) 2026 ZyvorAI Labs Private Limited. All rights reserved.

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'
import { useLocation, useParams } from 'react-router'
import { getAiSettings } from '../api/ai'
import { usePlatformInfo } from './PlatformInfoContext'

export type AiMode = 'off' | 'advisor' | 'autopilot_preview' | 'autopilot'

interface AiContextValue {
  mode: AiMode
  copilotOpen: boolean
  setMode: (m: AiMode) => void
  openCopilot: () => void
  closeCopilot: () => void
  toggleCopilot: () => void
  contextVmId: string | null
  setContextVmId: (id: string | null) => void
  contextHostId: string | null
  setContextHostId: (id: string | null) => void
  selectedAgent: string
  setSelectedAgent: (id: string) => void
  pagePath: string
  routeContext: Record<string, string | undefined>
}

const AiContext = createContext<AiContextValue | null>(null)

function parseMode(enabled: boolean, raw: string): AiMode {
  if (!enabled) return 'off'
  if (raw === 'autopilot') return 'autopilot'
  if (raw === 'autopilot_preview') return 'autopilot_preview'
  return 'advisor'
}

export function AiProvider({ children }: { children: React.ReactNode }) {
  const { info } = usePlatformInfo()
  const platform = Boolean(info?.control_plane?.proxy_url)
  const location = useLocation()
  const params = useParams()
  const [mode, setMode] = useState<AiMode>('advisor')
  const [copilotOpen, setCopilotOpen] = useState(false)
  const [contextVmId, setContextVmId] = useState<string | null>(null)
  const [contextHostId, setContextHostId] = useState<string | null>(null)
  const [selectedAgent, setSelectedAgent] = useState('auto')

  useEffect(() => {
    if (!platform) {
      setMode('advisor')
      return
    }
    void getAiSettings()
      .then((s) => setMode(parseMode(s.enabled, s.mode)))
      .catch(() => { /* keep default */ })
  }, [platform])

  useEffect(() => {
    const vm = params.id && location.pathname.includes('/vms/') ? params.id : null
    const host = params.id && location.pathname.includes('/hosts/') ? params.id : null
    if (vm) setContextVmId(vm)
    if (host) setContextHostId(host)
  }, [location.pathname, params.id])

  const openCopilot = useCallback(() => setCopilotOpen(true), [])
  const closeCopilot = useCallback(() => setCopilotOpen(false), [])
  const toggleCopilot = useCallback(() => setCopilotOpen((o) => !o), [])

  const routeContext = useMemo(
    () => ({
      vm_id: contextVmId ?? undefined,
      host_id: contextHostId ?? undefined,
      pathname: location.pathname,
      cluster: params.clusterId,
      namespace: params.namespace,
    }),
    [contextVmId, contextHostId, location.pathname, params.clusterId, params.namespace],
  )

  const value = useMemo(
    () => ({
      mode,
      copilotOpen,
      setMode,
      openCopilot,
      closeCopilot,
      toggleCopilot,
      contextVmId,
      setContextVmId,
      contextHostId,
      setContextHostId,
      selectedAgent,
      setSelectedAgent,
      pagePath: location.pathname,
      routeContext,
    }),
    [mode, copilotOpen, openCopilot, closeCopilot, toggleCopilot, contextVmId, contextHostId, selectedAgent, location.pathname, routeContext],
  )

  return <AiContext.Provider value={value}>{children}</AiContext.Provider>
}

export function useAi() {
  const ctx = useContext(AiContext)
  if (!ctx) throw new Error('useAi requires AiProvider')
  return ctx
}

/** Zeus-branded alias for ambient assistant context. */
export const useZeus = useAi
export const ZeusProvider = AiProvider
