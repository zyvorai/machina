// Copyright 2026 Zyvor AI Labs · https://zyvor.dev
// SPDX-License-Identifier: LicenseRef-Zyvor-Production-1.0

import type { ReactNode } from 'react'
import { useState } from 'react'
import FinderView, { type FinderViewMode } from './FinderView'

/** Lightweight Finder chrome for resource pages (storage, networks, templates). */
export default function PlatformFinderShell({
  title,
  search,
  onSearchChange,
  searchPlaceholder,
  toolbarActions,
  children,
}: {
  title: string
  search?: string
  onSearchChange?: (v: string) => void
  searchPlaceholder?: string
  toolbarActions?: ReactNode
  children: ReactNode
}) {
  const [viewMode, setViewMode] = useState<FinderViewMode>('list')

  return (
    <FinderView
      title={title}
      search={search ?? ''}
      onSearchChange={onSearchChange ?? (() => {})}
      searchPlaceholder={searchPlaceholder}
      viewMode={viewMode}
      onViewModeChange={setViewMode}
      toolbarActions={toolbarActions}
      listContent={children}
      showInspector={false}
    />
  )
}
