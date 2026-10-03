// Copyright 2026 Zyvor AI Labs · https://zyvor.dev
// SPDX-License-Identifier: LicenseRef-Zyvor-Production-1.0

// Native golden-image catalog (controller::api::templates) used as the "image"
// backend for the Fleet Cloud pages — Phase 4 of the external-cloud-client
// replacement, the Glance equivalent. Goes through the platform controller
// proxy.
//
// Unlike Glance, there's no byte-upload endpoint here — a template registers an
// existing disk path already on the hypervisor (or is published from a running
// VM via POST /api/v1/vms/{id}/publish-template). Use the classic Disk Images /
// Import VM pages to get a qcow2 onto the host first.

import { platformFetch } from './platform'

export interface NativeTemplate {
  id: string
  name: string
  version: string
  source_disk: string
  cloud_init: boolean
  os_family: string | null
  category: string
  workload: string
  description: string
  featured: boolean
  marketplace: boolean
  icon: string | null
  firewall_profile: string | null
  approval_status: string
  git_ref: string
  daemon_json_path: string
  project: string
}

export function listTemplates(): Promise<NativeTemplate[]> {
  return platformFetch<NativeTemplate[]>('/api/v1/templates')
}

// The controller only has a get/delete route keyed on name+version (see mod.rs), not on the
// catalog's own opaque `id` — there's no single-id lookup endpoint. Callers that only have an
// `id` (e.g. from a URL param) should fetch listTemplates() and find the entry by id instead.
export function getTemplate(name: string, version: string): Promise<NativeTemplate> {
  return platformFetch<NativeTemplate>(
    `/api/v1/templates/${encodeURIComponent(name)}/${encodeURIComponent(version)}`,
  )
}

export function createTemplate(body: {
  name: string
  version: string
  source_disk: string
  description?: string
  os_family?: string
}): Promise<NativeTemplate> {
  return platformFetch<NativeTemplate>('/api/v1/templates', {
    method: 'POST',
    body: JSON.stringify(body),
  })
}

export async function deleteTemplate(name: string, version: string): Promise<void> {
  await platformFetch(
    `/api/v1/templates/${encodeURIComponent(name)}/${encodeURIComponent(version)}`,
    { method: 'DELETE' },
  )
}
