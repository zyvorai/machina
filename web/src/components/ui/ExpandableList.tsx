// Copyright 2026 Zyvor AI Labs · https://zyvor.dev
// SPDX-License-Identifier: LicenseRef-Zyvor-Production-1.0

import { type ReactNode } from 'react'
import { DEFAULT_TOP_N } from '../../utils/topN'
import { useExpandable } from '../../hooks/useExpandable'
import { ExpandableToggle } from './ExpandableToggle'

type Props<T> = {
  items: readonly T[]
  renderItem: (item: T, index: number) => ReactNode
  /** Rows shown before the toggle. */
  limit?: number
  /** Optional ranking applied before truncating (e.g. `bySeverityDesc`). */
  compare?: (a: T, b: T) => number
  /** Plural noun for the toggle label, e.g. "events". */
  noun?: string
  className?: string
}

/**
 * A long list that shows its top rows and expands on request. The toggle reports its state
 * (`aria-expanded`) and controls the list it reveals. Lists at or under `limit` render as-is,
 * with no toggle.
 */
export function ExpandableList<T>({ items, renderItem, limit = DEFAULT_TOP_N, compare, noun = 'items', className }: Props<T>) {
  const { shown, hidden, expanded, toggle, listId, showToggle } = useExpandable(items, limit, compare)
  return (
    <>
      <div id={listId} className={className}>
        {shown.map((item, i) => renderItem(item, i))}
      </div>
      {showToggle && <ExpandableToggle expanded={expanded} hidden={hidden} listId={listId} onToggle={toggle} noun={noun} className="btn-secondary text-sm mt-3" />}
    </>
  )
}
