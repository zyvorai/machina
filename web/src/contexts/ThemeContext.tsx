// Copyright 2026 Zyvor AI Labs · https://zyvor.dev
// SPDX-License-Identifier: LicenseRef-Zyvor-Production-1.0

import { createContext, useContext, useState, useEffect, useCallback, ReactNode } from 'react'

/**
 * Product themes mapped 1:1 onto Zeus OS identities.
 * Default: `light` → apple.com white / tahoe-light.
 * `dark` → Classic Blue (`data-ui-shell=default`).
 */
export type AppTheme = 'dark' | 'steel' | 'aurora' | 'rack' | 'light'

/** Product default — apple.com white paper (Zeus tahoe-light). */
export const DEFAULT_THEME: AppTheme = 'light'

const THEME_CYCLE: AppTheme[] = ['light', 'dark', 'steel', 'aurora', 'rack']

const THEME_MIGRATION_APPLE = 'machina-theme-migrated-apple-light-v1'

export const THEME_LABELS: Record<AppTheme, string> = {
  light: 'Apple',
  dark: 'Classic Blue',
  steel: 'Dark Steel',
  aurora: 'Aurora',
  rack: 'Rack',
}

/** html[data-theme] values — match Zeus themeStore HTML_THEME. */
const HTML_THEME: Record<AppTheme, string> = {
  light: 'tahoe-light',
  dark: 'tahoe',
  steel: 'dark-steel',
  aurora: 'aurora',
  rack: 'rack',
}

/** html[data-ui-shell] — Zeus palette selectors. */
const HTML_UI_SHELL: Record<AppTheme, string> = {
  light: 'tahoe-light',
  dark: 'default',
  steel: 'dark-steel',
  aurora: 'aurora',
  rack: 'rack',
}

interface ThemeContextType {
  theme: AppTheme
  setTheme: (t: AppTheme) => void
  cycleTheme: () => void
}

const ThemeContext = createContext<ThemeContextType>({
  theme: DEFAULT_THEME,
  setTheme: () => {},
  cycleTheme: () => {},
})

function parseStoredTheme(raw: string | null): AppTheme {
  try {
    // One-time: previous product default was Classic Blue (`dark`). Move unset +
    // leftover dark defaults to apple.com white; other explicit themes stay.
    if (!localStorage.getItem(THEME_MIGRATION_APPLE)) {
      localStorage.setItem(THEME_MIGRATION_APPLE, '1')
      if (!raw || raw === 'dark') {
        localStorage.setItem('machina-theme', DEFAULT_THEME)
        return DEFAULT_THEME
      }
    }
  } catch {
    /* ignore */
  }
  if (raw === 'light' || raw === 'aurora' || raw === 'steel' || raw === 'rack' || raw === 'dark') {
    return raw
  }
  return DEFAULT_THEME
}

function applyHtmlThemeAttrs(theme: AppTheme) {
  const root = document.documentElement
  root.dataset.theme = HTML_THEME[theme]
  root.setAttribute('data-ui-shell', HTML_UI_SHELL[theme])
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setThemeState] = useState<AppTheme>(() =>
    parseStoredTheme(typeof localStorage !== 'undefined' ? localStorage.getItem('machina-theme') : null),
  )

  const setTheme = useCallback((t: AppTheme) => {
    setThemeState(t)
  }, [])

  useEffect(() => {
    localStorage.setItem('machina-theme', theme)
    const root = document.documentElement
    root.style.removeProperty('background-color')
    root.style.removeProperty('color-scheme')
    root.classList.remove(
      'steel-theme',
      'aurora-theme',
      'rack-theme',
      'liquid-glass-app',
      'apple-light',
      'light-theme',
    )
    root.classList.add('machina-clean')
    applyHtmlThemeAttrs(theme)
    if (theme === 'steel') {
      root.classList.add('steel-theme')
    } else if (theme === 'aurora') {
      root.classList.add('aurora-theme')
    } else if (theme === 'rack') {
      root.classList.add('rack-theme')
    } else if (theme === 'light') {
      root.classList.add('apple-light', 'light-theme')
      root.style.colorScheme = 'light'
    } else {
      // Classic Blue — Zeus graphite + Mist (not System Blue liquid-glass)
      root.classList.add('liquid-glass-app')
      root.style.colorScheme = 'dark'
    }
  }, [theme])

  const cycleTheme = useCallback(() => {
    setThemeState((t) => {
      const i = THEME_CYCLE.indexOf(t)
      return THEME_CYCLE[(i + 1) % THEME_CYCLE.length]
    })
  }, [])

  return (
    <ThemeContext.Provider value={{ theme, setTheme, cycleTheme }}>
      {children}
    </ThemeContext.Provider>
  )
}

export function useTheme() {
  return useContext(ThemeContext)
}
