// Copyright 2026 Zyvor AI Labs · https://zyvor.dev
// SPDX-License-Identifier: LicenseRef-Zyvor-Production-1.0

const KEY = 'machina_recent_vms'

export function addRecentVM(name: string) {
  const list = getRecentVMs().filter(n => n !== name)
  list.unshift(name)
  localStorage.setItem(KEY, JSON.stringify(list.slice(0, 5)))
}

export function getRecentVMs(): string[] {
  try {
    const parsed = JSON.parse(localStorage.getItem(KEY) || '[]')
    return Array.isArray(parsed) ? parsed.filter((n): n is string => typeof n === 'string') : []
  } catch { return [] }
}

export function removeRecentVM(name: string) {
  removeRecentVMs([name])
}

export function removeRecentVMs(names: string[]) {
  if (!names.length) return
  const drop = new Set(names)
  const next = getRecentVMs().filter((n) => !drop.has(n))
  localStorage.setItem(KEY, JSON.stringify(next))
}
