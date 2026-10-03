// Copyright 2026 Zyvor AI Labs · https://zyvor.dev
// SPDX-License-Identifier: LicenseRef-Zyvor-Production-1.0

// Native security groups + rules (controller::api::networking) — Phase 4 of the
// external-cloud-client replacement. Goes through the platform controller proxy.
//
// Narrower than Neutron security groups: only CIDR-based remote rules (no
// remote-group references) and no ethertype field — matches what the native
// backend actually stores. Rule enforcement is not yet wired to the firewall
// (advisory only), surfaced via the `enforced` field on every row.

import { platformFetch } from './platform'

export interface NativeSecurityGroup {
  id: string
  project_id: string | null
  name: string
  description: string
  enforced: boolean
}

export interface NativeSecurityGroupRule {
  id: string
  security_group_id: string
  direction: string
  protocol: string | null
  port_min: number | null
  port_max: number | null
  remote_cidr: string | null
  enforced: boolean
}

export function listSecurityGroups(): Promise<NativeSecurityGroup[]> {
  return platformFetch<NativeSecurityGroup[]>('/api/v1/security-groups')
}

export function getSecurityGroup(id: string): Promise<NativeSecurityGroup> {
  return platformFetch<NativeSecurityGroup>(`/api/v1/security-groups/${encodeURIComponent(id)}`)
}

export function createSecurityGroup(body: { name: string; description?: string }): Promise<NativeSecurityGroup> {
  return platformFetch<NativeSecurityGroup>('/api/v1/security-groups', {
    method: 'POST',
    body: JSON.stringify(body),
  })
}

export async function deleteSecurityGroup(id: string): Promise<void> {
  await platformFetch<{ deleted: boolean }>(`/api/v1/security-groups/${encodeURIComponent(id)}`, {
    method: 'DELETE',
  })
}

export function listSecurityGroupRules(groupId: string): Promise<NativeSecurityGroupRule[]> {
  return platformFetch<NativeSecurityGroupRule[]>(`/api/v1/security-groups/${encodeURIComponent(groupId)}/rules`)
}

export function createSecurityGroupRule(
  groupId: string,
  body: {
    direction?: string
    protocol?: string
    port_min?: number
    port_max?: number
    remote_cidr?: string
  },
): Promise<NativeSecurityGroupRule> {
  return platformFetch<NativeSecurityGroupRule>(`/api/v1/security-groups/${encodeURIComponent(groupId)}/rules`, {
    method: 'POST',
    body: JSON.stringify(body),
  })
}

export async function deleteSecurityGroupRule(id: string): Promise<void> {
  await platformFetch<{ deleted: boolean }>(`/api/v1/security-group-rules/${encodeURIComponent(id)}`, {
    method: 'DELETE',
  })
}
