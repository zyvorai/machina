// Copyright (c) 2026 ZyvorAI Labs Private Limited. All rights reserved.
// Proprietary software — see LICENSE in the repository root.
// https://zyvor.dev · info@zyvor.dev

import { apiPost, apiDelete, readJsonObject } from './client'
import { parseResponseError } from './parseResponseError'

const API = '/api/v1'

export interface OpenStackConnectionStatus {
  enabled: boolean
  configured: boolean
  cloud_name: string
  connected: boolean
  /** Keystone identity OK (UI “live” phase). */
  reachable: boolean
  keystone_reachable?: boolean
  compute_reachable?: boolean
  error?: string
  instance_count?: number
  image_count?: number
  glance_reachable?: boolean
  neutron_reachable?: boolean
  cinder_reachable?: boolean
}

export interface OpenStackInstance {
  id: string
  name: string
  status: string
  power_state: string
  flavor_id?: string
  flavor_name?: string
  availability_zone: string
  project_id?: string
  key_name?: string
  image_id?: string
  created_at?: string
  updated_at?: string
  ip_addresses: string[]
  security_groups: string[]
  metadata: Record<string, string>
  locked?: boolean
}

export interface OpenStackFlavor {
  id: string
  name: string
  vcpus: number
  ram_mb: number
  disk_gb: number
}

export interface OpenStackNetwork {
  id: string
  name: string
  status: string
  shared: boolean
  external: boolean
}

export interface OpenStackImage {
  id: string
  name: string
  status: string
  min_disk_gb: number
  min_ram_mb: number
  size_bytes?: number
  created_at?: string
}

export interface OpenStackKeyPair {
  name: string
  fingerprint?: string
}

export interface OpenStackAttachedVolume {
  id: string
  name: string
  size_gb: number
  device: string
  bootable: boolean
  server_id?: string
}

export interface OpenStackFloatingIp {
  id: string
  address: string
  status: string
  instance_id?: string
  fixed_address?: string
  network_id?: string
}

export interface OpenStackConsoleOutput {
  output: string
}

export interface OpenStackRemoteConsole {
  console_type: string
  url: string
}

export interface OpenStackExportPlan {
  instance_id: string
  instance_name: string
  suggested_image_name: string
  image_id?: string
  pull?: GlancePullResult
  steps: string[]
  hypervisord_dashboard: string
}

export interface OpenStackExportRequest {
  image_name?: string
  dest_path?: string
  auto_pull?: boolean
  wait_for_active?: boolean
}

export type OpenStackBootSource = 'image' | 'volume' | 'new_volume' | 'snapshot'

export interface CreateInstanceRequest {
  name: string
  flavor: string
  image?: string
  boot_volume_id?: string
  boot_volume_image?: string
  boot_volume_size_gb?: number
  network?: string
  networks?: string[]
  server_group?: string
  key_name?: string
  availability_zone?: string
  security_groups?: string[]
  user_data?: string
  wait_until_active?: boolean
}

export interface OpenStackCreateVolumeRequest {
  size_gb: number
  name?: string
  description?: string
  volume_type?: string
}

export interface OpenStackSecurityGroupRule {
  id: string
  direction: string
  protocol?: string
  port_range_min?: number
  port_range_max?: number
  remote_ip_prefix?: string
  remote_group_id?: string
  ethertype?: string
  description?: string
}

export interface OpenStackSecurityGroup {
  id: string
  name: string
  description?: string
  rules: OpenStackSecurityGroupRule[]
}

export interface RebuildInstanceRequest {
  image: string
  name?: string
}

export interface UpdateMetadataRequest {
  metadata: Record<string, string>
}

export interface CreateInstanceResponse {
  id: string
  name: string
  status: string
}

export interface GlanceUploadPreview {
  qcow2_path: string
  file_size_bytes: number
  suggested_name: string
  disk_format: string
  container_format: string
}

export interface GlanceUploadRequest {
  qcow2_path: string
  glance_name?: string
  visibility?: string
  boot_instance?: boolean
  flavor?: string
  network?: string
  key_name?: string
  instance_name?: string
  availability_zone?: string
  security_groups?: string[]
  wait_until_active?: boolean
}

export interface GlancePullRequest {
  dest_path: string
  wait_for_active?: boolean
}

export interface GlancePullResult {
  image_id: string
  image_name: string
  dest_path: string
  bytes_written: number
}

export interface LibvirtOpenStackPushPreview {
  vm_name: string
  vm_state: string
  root_disk: string
  glance_preview: GlanceUploadPreview
  vm_running: boolean
}

export interface GlanceUploadResult {
  image_id: string
  image_name: string
  status: string
  bytes_uploaded: number
  instance_id?: string
  instance_name?: string
}

function inst(id: string) {
  return encodeURIComponent(id)
}

export function getOpenStackStatus(): Promise<OpenStackConnectionStatus> {
  return readJsonObject<OpenStackConnectionStatus>(`${API}/openstack/status`)
}

export function postOpenStackTestConnection(): Promise<OpenStackConnectionStatus> {
  return apiPost<OpenStackConnectionStatus>(`${API}/openstack/test-connection`, {})
}

export function listOpenStackInstances(params?: {
  search?: string
  status?: string
  limit?: number
  marker?: string
}): Promise<{
  instances: OpenStackInstance[]
  total?: number
  next_marker?: string
  has_more?: boolean
  search_truncated?: boolean
}> {
  const q = new URLSearchParams()
  if (params?.search) q.set('search', params.search)
  if (params?.status) q.set('status', params.status)
  if (params?.limit != null) q.set('limit', String(params.limit))
  if (params?.marker) q.set('marker', params.marker)
  const suffix = q.toString() ? `?${q}` : ''
  return readJsonObject(`${API}/openstack/instances${suffix}`)
}

export function getOpenStackInstance(id: string): Promise<OpenStackInstance> {
  return readJsonObject<OpenStackInstance>(`${API}/openstack/instances/${inst(id)}`)
}

export function listOpenStackInstanceVolumes(id: string): Promise<{ volumes: OpenStackAttachedVolume[] }> {
  return readJsonObject(`${API}/openstack/instances/${inst(id)}/volumes`)
}

export function listOpenStackCinderVolumes(): Promise<{ volumes: OpenStackAttachedVolume[] }> {
  return readJsonObject(`${API}/openstack/volumes`)
}

export function startOpenStackInstance(id: string): Promise<{ status: string; id: string }> {
  return apiPost(`${API}/openstack/instances/${inst(id)}/start`, {})
}

export function stopOpenStackInstance(id: string): Promise<{ status: string; id: string }> {
  return apiPost(`${API}/openstack/instances/${inst(id)}/stop`, {})
}

export function pauseOpenStackInstance(id: string): Promise<{ status: string; id: string }> {
  return apiPost(`${API}/openstack/instances/${inst(id)}/pause`, {})
}

export function unpauseOpenStackInstance(id: string): Promise<{ status: string; id: string }> {
  return apiPost(`${API}/openstack/instances/${inst(id)}/unpause`, {})
}

export function suspendOpenStackInstance(id: string): Promise<{ status: string; id: string }> {
  return apiPost(`${API}/openstack/instances/${inst(id)}/suspend`, {})
}

export function resumeOpenStackInstance(id: string): Promise<{ status: string; id: string }> {
  return apiPost(`${API}/openstack/instances/${inst(id)}/resume`, {})
}

export function rebootOpenStackInstance(
  id: string,
  rebootType: 'soft' | 'hard' = 'hard',
): Promise<{ status: string; id: string; soft: boolean }> {
  return apiPost(`${API}/openstack/instances/${inst(id)}/reboot`, { reboot_type: rebootType })
}

export function resizeOpenStackInstance(
  id: string,
  flavor: string,
  opts?: { auto_confirm?: boolean },
): Promise<{ status: string; id: string }> {
  return apiPost(`${API}/openstack/instances/${inst(id)}/resize`, {
    flavor,
    auto_confirm: opts?.auto_confirm ?? true,
  })
}

export function confirmResizeOpenStackInstance(
  id: string,
): Promise<{ status: string; id: string }> {
  return apiPost(`${API}/openstack/instances/${inst(id)}/confirm-resize`, {})
}

export function revertResizeOpenStackInstance(
  id: string,
): Promise<{ status: string; id: string }> {
  return apiPost(`${API}/openstack/instances/${inst(id)}/revert-resize`, {})
}

export async function deleteOpenStackInstance(id: string): Promise<{ status: string; id: string }> {
  const res = await fetch(`${API}/openstack/instances/${inst(id)}`, {
    method: 'DELETE',
    credentials: 'same-origin',
  })
  if (!res.ok) {
    throw await parseResponseError(res)
  }
  return res.json()
}

export function snapshotOpenStackInstance(
  id: string,
  imageName: string,
): Promise<{ status: string; id: string; image_name: string }> {
  return apiPost(`${API}/openstack/instances/${inst(id)}/snapshot`, { image_name: imageName })
}

export function exportOpenStackInstance(
  id: string,
  body?: OpenStackExportRequest,
): Promise<OpenStackExportPlan> {
  return apiPost<OpenStackExportPlan>(`${API}/openstack/instances/${inst(id)}/export`, body ?? {})
}

export function getOpenStackConsoleOutput(
  id: string,
  lines?: number,
): Promise<OpenStackConsoleOutput> {
  const q = lines != null ? `?lines=${lines}` : ''
  return readJsonObject(`${API}/openstack/instances/${inst(id)}/console-output${q}`)
}

/** Remote console types supported by Nova (see daemon `get_remote_console`). */
export const OPENSTACK_CONSOLE_TYPES = [
  { id: 'novnc', label: 'noVNC (graphical)' },
  { id: 'spice', label: 'SPICE HTML5' },
  { id: 'serial', label: 'Serial' },
  { id: 'rdp', label: 'RDP HTML5' },
] as const

export type OpenStackConsoleType = (typeof OPENSTACK_CONSOLE_TYPES)[number]['id']

export function getOpenStackRemoteConsole(
  id: string,
  type: OpenStackConsoleType | string = 'novnc',
): Promise<OpenStackRemoteConsole> {
  const q = new URLSearchParams({ type })
  return readJsonObject(`${API}/openstack/instances/${inst(id)}/console?${q}`)
}

export function attachOpenStackVolume(
  instanceId: string,
  volumeId: string,
): Promise<{ status: string; id: string }> {
  return apiPost(`${API}/openstack/instances/${inst(instanceId)}/volumes/attach`, {
    volume_id: volumeId,
  })
}

export async function detachOpenStackVolume(
  instanceId: string,
  volumeId: string,
): Promise<{ status: string; id: string }> {
  const res = await fetch(
    `${API}/openstack/instances/${inst(instanceId)}/volumes/${inst(volumeId)}`,
    { method: 'DELETE', credentials: 'same-origin' },
  )
  if (!res.ok) {
    throw await parseResponseError(res)
  }
  return res.json()
}

export function addOpenStackSecurityGroup(
  instanceId: string,
  name: string,
): Promise<{ status: string }> {
  return apiPost(`${API}/openstack/instances/${inst(instanceId)}/security-groups`, { name })
}

export function removeOpenStackSecurityGroup(
  instanceId: string,
  name: string,
): Promise<{ status: string }> {
  return apiPost(`${API}/openstack/instances/${inst(instanceId)}/security-groups/remove`, { name })
}

export function listOpenStackFloatingIps(): Promise<{ floating_ips: OpenStackFloatingIp[] }> {
  return readJsonObject(`${API}/openstack/floating-ips`)
}

export function listOpenStackInstanceFloatingIps(
  instanceId: string,
): Promise<{ floating_ips: OpenStackFloatingIp[] }> {
  return readJsonObject(`${API}/openstack/instances/${inst(instanceId)}/floating-ips`)
}

export function associateOpenStackFloatingIp(
  instanceId: string,
  body: { floating_ip_id?: string; floating_network?: string },
): Promise<{ floating_ip: OpenStackFloatingIp }> {
  return apiPost(`${API}/openstack/instances/${inst(instanceId)}/floating-ips`, body)
}

export function getOpenStackFloatingIp(id: string): Promise<{ floating_ip: OpenStackFloatingIp }> {
  return readJsonObject(`${API}/openstack/floating-ips/${inst(id)}`)
}

export function dissociateOpenStackFloatingIp(fipId: string): Promise<{ status: string; id: string }> {
  return apiPost(`${API}/openstack/floating-ips/${inst(fipId)}/dissociate`, {})
}

export async function deleteOpenStackFloatingIp(fipId: string): Promise<{ status: string; id: string }> {
  const res = await fetch(`${API}/openstack/floating-ips/${inst(fipId)}`, {
    method: 'DELETE',
    credentials: 'same-origin',
  })
  if (!res.ok) throw await parseResponseError(res)
  return res.json() as Promise<{ status: string; id: string }>
}

export function createOpenStackInstance(
  body: CreateInstanceRequest,
): Promise<CreateInstanceResponse> {
  return apiPost<CreateInstanceResponse>(`${API}/openstack/instances`, body)
}

export function listOpenStackFlavors(): Promise<{ flavors: OpenStackFlavor[] }> {
  return readJsonObject(`${API}/openstack/flavors`)
}

export function createOpenStackFlavor(body: {
  name: string
  vcpus: number
  ram_mb: number
  disk_gb: number
  id?: string
  is_public?: boolean
}): Promise<{ flavor: OpenStackFlavor }> {
  return apiPost(`${API}/openstack/flavors`, body)
}

export async function deleteOpenStackFlavor(id: string): Promise<void> {
  await apiDelete(`${API}/openstack/flavors/${inst(id)}`)
}

export function getOpenStackFlavor(id: string): Promise<{ flavor: OpenStackFlavor }> {
  return readJsonObject(`${API}/openstack/flavors/${inst(id)}`)
}

export function getOpenStackImage(id: string): Promise<{ image: OpenStackImage }> {
  return readJsonObject(`${API}/openstack/images/${inst(id)}`)
}

export async function forceDeleteOpenStackInstance(id: string): Promise<{ status: string; id: string }> {
  return apiPost(`${API}/openstack/instances/${inst(id)}/force-delete`, {})
}

export function listOpenStackNetworks(): Promise<{ networks: OpenStackNetwork[] }> {
  return readJsonObject(`${API}/openstack/networks`)
}

export function listOpenStackImages(): Promise<{ images: OpenStackImage[] }> {
  return readJsonObject(`${API}/openstack/images`)
}

export async function deleteOpenStackImage(id: string): Promise<{ status: string; id: string }> {
  const res = await fetch(`${API}/openstack/images/${inst(id)}`, {
    method: 'DELETE',
    credentials: 'same-origin',
  })
  if (!res.ok) {
    throw await parseResponseError(res)
  }
  return res.json()
}

export function listOpenStackKeypairs(): Promise<{ keypairs: OpenStackKeyPair[] }> {
  return readJsonObject(`${API}/openstack/keypairs`)
}

export function getGlanceUploadPreview(qcow2Path: string): Promise<GlanceUploadPreview> {
  const params = new URLSearchParams({ qcow2_path: qcow2Path })
  return readJsonObject<GlanceUploadPreview>(`${API}/openstack/images/upload/preview?${params}`)
}

export function postGlanceUpload(body: GlanceUploadRequest): Promise<GlanceUploadResult> {
  return apiPost<GlanceUploadResult>(`${API}/openstack/images/upload`, body)
}

export function pullGlanceImage(
  imageId: string,
  body: GlancePullRequest,
): Promise<GlancePullResult> {
  return apiPost<GlancePullResult>(`${API}/openstack/images/${inst(imageId)}/pull`, body)
}

export function getLibvirtOpenStackPushPreview(
  vmName: string,
  connection?: string,
): Promise<LibvirtOpenStackPushPreview> {
  const q = connection ? `?connection=${encodeURIComponent(connection)}` : ''
  return readJsonObject<LibvirtOpenStackPushPreview>(
    `${API}/vms/${encodeURIComponent(vmName)}/openstack-push/preview${q}`,
  )
}

export type LibvirtOpenStackPushBody = Partial<GlanceUploadRequest> & {
  stop_vm?: boolean
  use_hyper2kvm?: boolean
  guest_fix?: boolean
}

export function postLibvirtOpenStackPush(
  vmName: string,
  body: LibvirtOpenStackPushBody,
  connection?: string,
): Promise<Record<string, unknown>> {
  const q = connection ? `?connection=${encodeURIComponent(connection)}` : ''
  return apiPost(`${API}/vms/${encodeURIComponent(vmName)}/openstack-push${q}`, body)
}

export function listOpenStackSecurityGroups(): Promise<{ security_groups: OpenStackSecurityGroup[] }> {
  return readJsonObject(`${API}/openstack/security-groups`)
}

export function getOpenStackSecurityGroup(id: string): Promise<{ security_group: OpenStackSecurityGroup }> {
  return readJsonObject(`${API}/openstack/security-groups/${inst(id)}`)
}

export function createOpenStackVolume(
  body: OpenStackCreateVolumeRequest,
): Promise<{ volume: OpenStackAttachedVolume }> {
  return apiPost(`${API}/openstack/volumes`, body)
}

export async function deleteOpenStackVolume(id: string): Promise<{ status: string; id: string }> {
  const res = await fetch(`${API}/openstack/volumes/${inst(id)}`, {
    method: 'DELETE',
    credentials: 'same-origin',
  })
  if (!res.ok) {
    throw await parseResponseError(res)
  }
  return res.json()
}

export function rebuildOpenStackInstance(
  id: string,
  body: RebuildInstanceRequest,
): Promise<{ status: string; id: string }> {
  return apiPost(`${API}/openstack/instances/${inst(id)}/rebuild`, body)
}

export function updateOpenStackMetadata(
  id: string,
  body: UpdateMetadataRequest,
): Promise<{ metadata: Record<string, string> }> {
  return apiPost(`${API}/openstack/instances/${inst(id)}/metadata`, body)
}
