// Copyright 2026 Zyvor AI Labs · https://zyvor.dev
// SPDX-License-Identifier: LicenseRef-Zyvor-Production-1.0

// Native standalone storage volumes (controller::api::volumes) — Phase 4 of the
// external-cloud-client replacement, the Cinder equivalent. Goes through the platform
// controller proxy.
//
// Narrower than Cinder: no volume transfers (project-to-project ownership
// handoff), no retype, no clone, no bootable flag, no create-from-image — none
// of those have a native equivalent yet. Create/list/delete/attach/detach/
// extend/snapshot are fully native.

import { platformFetch } from './platform'

export interface NativeVolume {
  id: string
  project_id: string | null
  name: string
  size_gib: number
  volume_class: string
  status: string
  attached_vm_id: string | null
  attached_device: string | null
  atlas_backed: boolean
}

export interface NativeVolumeSnapshot {
  id: string
  volume_id: string
  name: string
  status: string
}

export interface NativeVolumeSnapshotWithVolume extends NativeVolumeSnapshot {
  volume_name: string
}

export function listVolumes(): Promise<NativeVolume[]> {
  return platformFetch<NativeVolume[]>('/api/v1/volumes')
}

export function getVolume(id: string): Promise<NativeVolume> {
  return platformFetch<NativeVolume>(`/api/v1/volumes/${encodeURIComponent(id)}`)
}

export function createVolume(body: { name: string; size_gib: number; volume_class?: string }): Promise<NativeVolume> {
  return platformFetch<NativeVolume>('/api/v1/volumes', {
    method: 'POST',
    body: JSON.stringify(body),
  })
}

export async function deleteVolume(id: string): Promise<void> {
  await platformFetch(`/api/v1/volumes/${encodeURIComponent(id)}`, { method: 'DELETE' })
}

export function attachVolume(id: string, body: { vm_id: string; target_dev?: string }): Promise<NativeVolume> {
  return platformFetch<NativeVolume>(`/api/v1/volumes/${encodeURIComponent(id)}/attach`, {
    method: 'POST',
    body: JSON.stringify(body),
  })
}

export function detachVolume(id: string): Promise<NativeVolume> {
  return platformFetch<NativeVolume>(`/api/v1/volumes/${encodeURIComponent(id)}/detach`, { method: 'POST' })
}

export function extendVolume(id: string, newSizeGib: number): Promise<NativeVolume> {
  return platformFetch<NativeVolume>(`/api/v1/volumes/${encodeURIComponent(id)}/extend`, {
    method: 'POST',
    body: JSON.stringify({ new_size_gib: newSizeGib }),
  })
}

export function listVolumeSnapshots(volumeId: string): Promise<NativeVolumeSnapshot[]> {
  return platformFetch<NativeVolumeSnapshot[]>(`/api/v1/volumes/${encodeURIComponent(volumeId)}/snapshots`)
}

export function listAllVolumeSnapshots(): Promise<NativeVolumeSnapshotWithVolume[]> {
  return platformFetch<NativeVolumeSnapshotWithVolume[]>('/api/v1/volume-snapshots')
}

export function createVolumeSnapshot(volumeId: string, name: string): Promise<NativeVolumeSnapshot> {
  return platformFetch<NativeVolumeSnapshot>(`/api/v1/volumes/${encodeURIComponent(volumeId)}/snapshots`, {
    method: 'POST',
    body: JSON.stringify({ name }),
  })
}

export async function deleteVolumeSnapshot(id: string): Promise<void> {
  await platformFetch(`/api/v1/volume-snapshots/${encodeURIComponent(id)}`, { method: 'DELETE' })
}
