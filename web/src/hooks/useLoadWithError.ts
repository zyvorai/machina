// Copyright 2026 Zyvor AI Labs · https://zyvor.dev
// SPDX-License-Identifier: LicenseRef-Zyvor-Production-1.0

import { useCallback, useState } from 'react'
import { formatUserError } from '../utils/apiError'

/** Standard page load with `loadError` string for ErrorBanner. */
export function useLoadWithError() {
  const [loadError, setLoadError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  const wrapLoad = useCallback(<T,>(fn: () => Promise<T>): Promise<T | undefined> => {
    setLoadError(null)
    return fn()
      .then((v) => {
        setLoadError(null)
        return v
      })
      .catch((e: unknown) => {
        setLoadError(formatUserError(e))
        return undefined
      })
      .finally(() => setLoading(false))
  }, [])

  return { loadError, setLoadError, loading, setLoading, wrapLoad }
}
