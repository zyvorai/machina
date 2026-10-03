// Copyright 2026 Zyvor AI Labs · https://zyvor.dev
// SPDX-License-Identifier: LicenseRef-Zyvor-Production-1.0

export function errorMessage(e: unknown): string {
  if (e instanceof Error) return e.message
  return String(e)
}
