// Copyright (c) 2026 ZyvorAI Labs Private Limited. All rights reserved.

import CommandPalette from '../CommandPalette'
import type { HelpTab } from '../HelpDialog'

/** Unified ⌘Space command bar — Zeus Spotlight (⌘K alias via CommandPalette). */
export default function ZeusSpotlight({ onOpenHelp }: { onOpenHelp?: (tab?: HelpTab) => void }) {
  return <CommandPalette onOpenHelp={onOpenHelp} spotlight />
}
