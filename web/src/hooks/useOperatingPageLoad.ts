// Copyright 2026 Zyvor AI Labs · https://zyvor.dev
// SPDX-License-Identifier: LicenseRef-Zyvor-Production-1.0

import { useCallback, useEffect, useState } from 'react'
import { formatUserError } from '../utils/apiError'

export function useOperatingPageLoad(loadFn: () => Promise<void>) {
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const reload = useCallback(async () => {
    setError(null)
    setLoading(true)
    try {
      await loadFn()
    } catch (e: unknown) {
      setError(formatUserError(e))
    } finally {
      setLoading(false)
    }
  }, [loadFn])

  useEffect(() => {
    void reload()
  }, [reload])

  return { loading, error, reload, setError }
}
