// Copyright 2026 Zyvor AI Labs · https://zyvor.dev
// SPDX-License-Identifier: LicenseRef-Zyvor-Production-1.0

export function shellLabel(pathname: string): string | null {
  if (pathname.startsWith('/platform')) return null
  if (pathname.startsWith('/fleet-cloud')) return 'Fleet Cloud'
  if (pathname.startsWith('/k8s')) return 'Kubernetes'
  if (pathname === '/login') return null
  return 'Classic Machina'
}
