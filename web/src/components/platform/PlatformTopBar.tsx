// Copyright 2026 Zyvor AI Labs · https://zyvor.dev
// SPDX-License-Identifier: LicenseRef-Zyvor-Production-1.0

// Copyright (c) 2026 ZyvorAI Labs Private. All rights reserved.

import { useLocation } from 'react-router'
import { PLATFORM_PAGE_LABELS } from '../../utils/platformNav'

/** Centered menubar title (v9s MacMenuTitle pattern). */
export default function PlatformTopBar() {
  const { pathname } = useLocation()
  const base = pathname.split('/').slice(0, 3).join('/') || '/platform'
  const page = PLATFORM_PAGE_LABELS[pathname] ?? PLATFORM_PAGE_LABELS[base] ?? 'Platform'

  return (
    <h1 className="mac-menubar-title text-sm font-medium text-[var(--text-primary)] truncate max-w-[min(100%,20rem)]">
      {page}
    </h1>
  )
}
