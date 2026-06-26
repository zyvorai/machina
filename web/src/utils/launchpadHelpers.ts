// Copyright (c) 2026 ZyvorAI Labs Private Limited. All rights reserved.

import type { LaunchpadApp } from '../api/launchpad'
import { getLaunchpadConfig, pinLaunchpadFavorite } from '../api/launchpad'

export const LAUNCHPAD_FAVORITES_CHANGED = 'launchpad-favorites-changed'

export function dispatchLaunchpadFavoritesChanged() {
  window.dispatchEvent(new CustomEvent(LAUNCHPAD_FAVORITES_CHANGED))
}

export function launchpadStatusLabel(status: string): string {
  switch (status) {
    case 'healthy':
      return 'Healthy'
    case 'degraded':
      return 'Degraded'
    case 'broken':
      return 'Needs attention'
    default:
      return 'Unknown'
  }
}

export function launchpadStatusTone(status: string): string {
  switch (status) {
    case 'healthy':
      return 'ok'
    case 'degraded':
      return 'warn'
    case 'broken':
      return 'error'
    default:
      return 'neutral'
  }
}

export async function launchpadOpenUrl(app: LaunchpadApp): Promise<string> {
  if (app.publicUrl) return app.publicUrl
  const cfg = await getLaunchpadConfig()
  const base = (cfg.publicBase || window.location.origin).replace(/\/$/, '')
  const prefix = (cfg.pathPrefix || '/launchpad').replace(/\/$/, '')
  if (app.canonicalSlug) return `${base}${prefix}/apps/${app.canonicalSlug}`
  if (app.routePath.startsWith('/')) return `${base}${app.routePath}`
  return `${base}${prefix}/a/${app.namespace}/${app.slug}`
}

export async function openLaunchpadApp(app: LaunchpadApp) {
  const url = await launchpadOpenUrl(app)
  window.open(url, '_blank', 'noopener,noreferrer')
}

export async function copyLaunchpadUrl(app: LaunchpadApp) {
  const url = await launchpadOpenUrl(app)
  await navigator.clipboard.writeText(url)
  return url
}

export async function pinLaunchpadApp(app: LaunchpadApp) {
  await pinLaunchpadFavorite(app.id)
  dispatchLaunchpadFavoritesChanged()
}

export async function shareLaunchpadApp(app: LaunchpadApp): Promise<void> {
  const url = await launchpadOpenUrl(app)
  const title = app.displayName
  const text = app.description?.trim() || `${app.displayName} on Machina Launchpad`
  if (typeof navigator.share === 'function') {
    try {
      await navigator.share({ title, text, url })
      return
    } catch (e: unknown) {
      if (e instanceof DOMException && e.name === 'AbortError') return
    }
  }
  await navigator.clipboard.writeText(url)
}

export async function openLaunchpadInWorkspace(app: LaunchpadApp): Promise<void> {
  const route = app.routePath?.trim()
  if (route.startsWith('/platform')) {
    const { openCenterPopout } = await import('./platformCenterPopout')
    openCenterPopout(route)
    return
  }
  const url = await launchpadOpenUrl(app)
  const width = Math.min(1280, window.screen.availWidth - 48)
  const height = Math.min(860, window.screen.availHeight - 48)
  const left = Math.max(0, Math.round((window.screen.availWidth - width) / 2))
  const top = Math.max(0, Math.round((window.screen.availHeight - height) / 2))
  window.open(
    url,
    `machina-launchpad-${app.id.replace(/\W+/g, '-')}`,
    `popup=yes,width=${width},height=${height},left=${left},top=${top},menubar=no,toolbar=no,location=yes,status=no,resizable=yes,scrollbars=yes`,
  )
}

export function launchpadDetailPath(app: LaunchpadApp): string {
  const slug = app.canonicalSlug || app.id.split('/').pop() || app.slug
  return `/platform/launchpad/apps/${encodeURIComponent(slug)}`
}

export function launchpadInspectPath(app: LaunchpadApp): string {
  return `${launchpadDetailPath(app)}?inspect=1`
}
