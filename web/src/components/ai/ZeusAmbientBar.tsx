// Copyright (c) 2026 ZyvorAI Labs Private Limited. All rights reserved.

import { useEffect, useState } from 'react'
import { useLocation } from 'react-router'
import { Sparkles } from 'lucide-react'
import { getZeusApprovalHub } from '../../api/ai'
import { usePlatformInfo } from '../../contexts/PlatformInfoContext'
import { useAi } from '../../contexts/AiContext'

export default function ZeusAmbientBar() {
  const location = useLocation()
  const { info } = usePlatformInfo()
  const { mode, selectedAgent, openCopilot } = useAi()
  const platform = Boolean(info?.control_plane?.proxy_url)
  const onPlatformDesktop = location.pathname.startsWith('/platform')
  const [pending, setPending] = useState(0)

  useEffect(() => {
    if (!platform || mode === 'off') return
    void getZeusApprovalHub()
      .then((h) => setPending(Number(h.total_pending ?? 0)))
      .catch(() => setPending(0))
  }, [platform, mode])

  if (!platform || mode === 'off') return null

  return (
    <div
      className={`fixed left-1/2 -translate-x-1/2 z-[54] flex items-center gap-2 rounded-full border border-white/10 bg-slate-900/90 backdrop-blur px-4 py-2 shadow-xl text-xs ${
        onPlatformDesktop ? 'bottom-[5.75rem]' : 'bottom-4'
      }`}
    >
      <Sparkles className="w-3.5 h-3.5 text-orange-400" />
      <span className="text-slate-300">Zeus · {selectedAgent === 'auto' ? 'Auto' : selectedAgent}</span>
      {pending > 0 && (
        <button type="button" className="text-orange-300 hover:text-orange-200" onClick={openCopilot}>
          {pending} pending approval{pending === 1 ? '' : 's'}
        </button>
      )}
      <button type="button" className="text-slate-400 hover:text-white ml-1" onClick={openCopilot}>
        Open Zeus
      </button>
    </div>
  )
}
