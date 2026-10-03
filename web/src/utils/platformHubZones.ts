// Copyright 2026 Zyvor AI Labs · https://zyvor.dev
// SPDX-License-Identifier: LicenseRef-Zyvor-Production-1.0

import type { PlatformDesktopTier } from './platformDesktopTier'
import { tierAtLeast } from './platformDesktopTier'
import {
  DESKTOP_HUB_TILES,
  hubTilesForTier,
  hubTileById,
  type DesktopHubTile,
} from './platformNavRegistry'

export type { DesktopHubTile }

export { DESKTOP_HUB_TILES, hubTilesForTier, hubTileById }

export function showPlatformHubsForTier(tier: PlatformDesktopTier): boolean {
  return tierAtLeast(tier, 'power')
}

/** Shown on Normal tier as muted dock previews until Power user is enabled. */
export const DOCK_PREVIEW_HUB_PATHS: string[] = ['/platform/infrastructure', '/platform/operations']

export function dockPreviewPathsForTier(tier: PlatformDesktopTier): string[] {
  return tier === 'normal' ? DOCK_PREVIEW_HUB_PATHS : []
}
