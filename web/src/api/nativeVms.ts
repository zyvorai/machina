// Copyright 2026 Zyvor AI Labs · https://zyvor.dev
// SPDX-License-Identifier: LicenseRef-Zyvor-Production-1.0

// Native VM lifecycle (controller::api::vms) used as the "instance" backend for
// the Fleet Cloud compute pages — Phase 4 of the external-cloud-client replacement.
// Goes through the platform controller proxy, not the daemon's external-cloud
// client. Actions enqueue a task and return immediately (no synchronous
// completion), matching every other native create/action handler in this app.

import { platformFetch } from './platform'

export interface NativeVm {
  id: string
  name: string
  host_id: string | null
  desired_state: string
  observed_state: string
  lifecycle_phase: string
  last_error: string
  managed: boolean
  uuid: string | null
  vcpus: number
  memory_mib: number
  ha_enabled: boolean
  project: string | null
  tags: string[]
  inventory_source: string
  guest_ip: string | null
  guest_tools_status: string | null
}

export interface TaskResponse {
  task_id: string
  status: string
  operation: string
}

/** Best-effort display status derived from observed_state/lifecycle_phase — native
 * VMs don't have a single Nova-style status enum (ACTIVE/SHUTOFF/BUILD/ERROR). */
export function vmDisplayStatus(vm: Pick<NativeVm, 'observed_state' | 'lifecycle_phase' | 'last_error'>): string {
  if (vm.last_error) return 'ERROR'
  if (vm.lifecycle_phase && vm.lifecycle_phase !== 'ready') return vm.lifecycle_phase.toUpperCase()
  const s = vm.observed_state.toLowerCase()
  if (s === 'running') return 'ACTIVE'
  if (s === 'shutoff' || s === 'stopped') return 'SHUTOFF'
  if (s === 'paused') return 'PAUSED'
  return vm.observed_state.toUpperCase() || 'UNKNOWN'
}

export interface CreateFromTemplateBody {
  template_ref: string
  name: string
  memory?: string
  flavor_id?: string
  network?: string
  cloud_init_user?: string
  cloud_init_password?: string
  cloud_init_ssh_pubkey?: string
}

/** POST /api/v1/vms/from-template — boots an instance from a native image
 * (template) with a flavor (vcpus/memory) and network resolved server-side. */
export function createFromTemplate(body: CreateFromTemplateBody): Promise<TaskResponse> {
  return platformFetch<TaskResponse>('/api/v1/vms/from-template', {
    method: 'POST',
    body: JSON.stringify(body),
  })
}

export function listVms(params?: { project?: string }): Promise<NativeVm[]> {
  const qs = params?.project ? `?project=${encodeURIComponent(params.project)}` : ''
  return platformFetch<NativeVm[]>(`/api/v1/vms${qs}`)
}

export function getVm(id: string): Promise<NativeVm> {
  return platformFetch<NativeVm>(`/api/v1/vms/${encodeURIComponent(id)}`)
}

export function patchVmTags(id: string, tags: string[]): Promise<NativeVm> {
  return platformFetch<NativeVm>(`/api/v1/vms/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    body: JSON.stringify({ tags }),
  })
}

export function startVm(id: string): Promise<TaskResponse> {
  return platformFetch<TaskResponse>(`/api/v1/vms/${encodeURIComponent(id)}/start`, { method: 'POST' })
}

export function stopVm(id: string): Promise<TaskResponse> {
  return platformFetch<TaskResponse>(`/api/v1/vms/${encodeURIComponent(id)}/stop`, { method: 'POST' })
}

export function rebootVm(id: string): Promise<TaskResponse> {
  return platformFetch<TaskResponse>(`/api/v1/vms/${encodeURIComponent(id)}/reboot`, { method: 'POST' })
}

export function deleteVm(id: string): Promise<TaskResponse> {
  return platformFetch<TaskResponse>(`/api/v1/vms/${encodeURIComponent(id)}/delete`, {
    method: 'POST',
    body: JSON.stringify({ confirmed: true }),
  })
}

export interface NativeVmDisk {
  id: string
  name: string
  size_gib: number
  storage_class: string
  path: string | null
}

export interface NativeVmNic {
  mac_address: string
  network: string
  model: string
  ip?: string
}

export interface NativePortForward {
  id: string
  protocol: string
  host_port: number
  vm_ip: string
  vm_port: number
  description: string
}

/** Native equivalent of a "floating IP": a host_port -> vm_ip:vm_port NAT rule,
 * scoped to whichever VM currently holds that guest IP. There is no separate
 * allocatable floating-IP pool — see api/nativeVms.ts module doc. */
export function listVmPortForwards(id: string): Promise<NativePortForward[]> {
  return platformFetch<NativePortForward[]>(`/api/v1/vms/${encodeURIComponent(id)}/port-forwards`)
}

export async function createVmPortForward(
  id: string,
  body: { protocol: string; host_port: number; vm_port: number; description?: string },
): Promise<void> {
  await platformFetch(`/api/v1/vms/${encodeURIComponent(id)}/port-forwards`, {
    method: 'POST',
    body: JSON.stringify(body),
  })
}

export async function deleteVmPortForward(
  id: string,
  body: { protocol: string; host_port: number; vm_port: number },
): Promise<void> {
  await platformFetch(`/api/v1/vms/${encodeURIComponent(id)}/port-forwards/delete`, {
    method: 'POST',
    body: JSON.stringify(body),
  })
}

export function listVmDisks(id: string): Promise<NativeVmDisk[]> {
  return platformFetch<NativeVmDisk[]>(`/api/v1/vms/${encodeURIComponent(id)}/disks`)
}

export function listVmNics(id: string): Promise<NativeVmNic[]> {
  return platformFetch<NativeVmNic[]>(`/api/v1/vms/${encodeURIComponent(id)}/nics`)
}

export function attachVmNic(id: string, network: string, model = 'virtio'): Promise<TaskResponse> {
  return platformFetch<TaskResponse>(`/api/v1/vms/${encodeURIComponent(id)}/nics/attach`, {
    method: 'POST',
    body: JSON.stringify({ network, model }),
  })
}

export function detachVmNic(id: string, mac: string): Promise<TaskResponse> {
  return platformFetch<TaskResponse>(`/api/v1/vms/${encodeURIComponent(id)}/nics/detach/${encodeURIComponent(mac)}`, {
    method: 'POST',
  })
}
