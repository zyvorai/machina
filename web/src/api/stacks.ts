// Copyright 2026 Zyvor AI Labs · https://zyvor.dev
// SPDX-License-Identifier: LicenseRef-Zyvor-Production-1.0

// Native declarative stacks (controller::api::stacks) — Phase 4 of the
// external-cloud-client replacement, the Heat equivalent. Goes through the platform
// controller proxy.
//
// Unlike Heat, a stack template here is NOT an arbitrary YAML resource graph —
// it's a fixed JSON shape describing security groups, volumes, and VMs (see
// StackTemplate on the controller). There is no free-form resource-type system.

import { platformFetch } from './platform'

export interface StackSecurityGroupRule {
  direction?: string
  protocol?: string
  port_min?: number
  port_max?: number
  remote_cidr?: string
}

export interface StackTemplate {
  security_groups?: { name: string; rules?: StackSecurityGroupRule[] }[]
  volumes?: { name: string; size_gib: number; volume_class?: string }[]
  vms?: {
    name: string
    memory?: string
    cpu_cores?: number
    disk_gib?: number
    network?: string
    attach_volumes?: string[]
  }[]
}

export interface StackResourceRef {
  kind: string
  id: string
  name: string
}

export interface NativeStack {
  id: string
  project_id: string | null
  name: string
  status: string
  last_error: string | null
  template_json: StackTemplate
  resources_json: StackResourceRef[]
}

export function listStacks(): Promise<NativeStack[]> {
  return platformFetch<NativeStack[]>('/api/v1/stacks')
}

export function getStack(id: string): Promise<NativeStack> {
  return platformFetch<NativeStack>(`/api/v1/stacks/${encodeURIComponent(id)}`)
}

export function createStack(body: { name: string; template: StackTemplate }): Promise<NativeStack> {
  return platformFetch<NativeStack>('/api/v1/stacks', {
    method: 'POST',
    body: JSON.stringify(body),
  })
}

export async function deleteStack(id: string): Promise<void> {
  await platformFetch<{ deleted: boolean }>(`/api/v1/stacks/${encodeURIComponent(id)}`, {
    method: 'DELETE',
  })
}
