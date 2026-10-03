// Copyright 2026 Zyvor AI Labs · https://zyvor.dev
// SPDX-License-Identifier: LicenseRef-Zyvor-Production-1.0

// @vitest-environment jsdom
// Copyright (c) 2026 ZyvorAI Labs Private Limited. All rights reserved.

import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import React from 'react'
import { ExpandableList } from './ExpandableList'

afterEach(cleanup)

const items = Array.from({ length: 9 }, (_, i) => `row-${i}`)
const list = (limit = 4) => (
  <ExpandableList items={items} limit={limit} noun="events" renderItem={(t) => <p key={t}>{t}</p>} />
)

describe('ExpandableList', () => {
  it('shows the top rows with a labelled toggle, then expands and collapses', () => {
    render(list())
    expect(screen.getAllByText(/^row-/)).toHaveLength(4)
    const toggle = screen.getByRole('button', { name: 'Show 5 more events' })
    expect(toggle.getAttribute('aria-expanded')).toBe('false')
    expect(toggle.getAttribute('aria-controls')).toBeTruthy()
    fireEvent.click(toggle)
    expect(screen.getAllByText(/^row-/)).toHaveLength(9)
    const collapse = screen.getByRole('button', { name: 'Show fewer events' })
    expect(collapse.getAttribute('aria-expanded')).toBe('true')
    fireEvent.click(collapse)
    expect(screen.getAllByText(/^row-/)).toHaveLength(4)
  })

  it('renders short lists without a toggle', () => {
    render(list(20))
    expect(screen.getAllByText(/^row-/)).toHaveLength(9)
    expect(screen.queryByRole('button')).toBeNull()
  })
})
