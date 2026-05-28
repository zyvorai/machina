// Copyright (c) 2026 ZyvorAI Labs Private Limited. All rights reserved.
// Proprietary software — see LICENSE in the repository root.
// https://zyvor.dev · info@zyvor.dev

import { apiPost, apiPut, apiPatch, apiDelete, readJsonObject } from './client'
import { parseResponseError } from './parseResponseError'

const API = '/api/v1'
const inst = (id: string) => encodeURIComponent(id)

export interface OpenStackCloudEntry {
  name: string
  active: boolean
}

export interface OpenStackSubnet {
  id: string
  name: string
  network_id: string
  cidr: string
  ip_version: number
  gateway_ip?: string
  enable_dhcp?: boolean
}

export interface OpenStackRouter {
  id: string
  name: string
  status: string
  external_gateway: boolean
}

export interface OpenStackPort {
  id: string
  name: string
  network_id: string
  status: string
  device_id?: string
  fixed_ips: string[]
  admin_state_up?: boolean
}

export interface OpenStackVolumeType {
  id: string
  name: string
  is_public: boolean
}

export interface OpenStackServerGroup {
  id: string
  name: string
  policy: string
  members: string[]
}

export interface OpenStackInstanceInterface {
  port_id: string
  net_id: string
  mac_addr: string
  fixed_ips: string[]
}

export function listOpenStackClouds(): Promise<{ clouds: OpenStackCloudEntry[] }> {
  return readJsonObject(`${API}/openstack/clouds`)
}

export function selectOpenStackCloud(cloudName: string): Promise<{ status: string; cloud_name: string }> {
  return apiPost(`${API}/openstack/cloud`, { cloud_name: cloudName })
}

export function getOpenStackQuotas(): Promise<{ quotas: { compute: unknown; cinder?: unknown; neutron?: unknown } }> {
  return readJsonObject(`${API}/openstack/quotas`)
}

export function listOpenStackSubnets(): Promise<{ subnets: OpenStackSubnet[] }> {
  return readJsonObject(`${API}/openstack/subnets`)
}

export function listOpenStackRouters(): Promise<{ routers: OpenStackRouter[] }> {
  return readJsonObject(`${API}/openstack/routers`)
}

export function listOpenStackPorts(deviceId?: string): Promise<{ ports: OpenStackPort[] }> {
  const q = deviceId ? `?device_id=${encodeURIComponent(deviceId)}` : ''
  return readJsonObject(`${API}/openstack/ports${q}`)
}

export function listOpenStackVolumeTypes(): Promise<{ volume_types: OpenStackVolumeType[] }> {
  return readJsonObject(`${API}/openstack/volume-types`)
}

export function listOpenStackServerGroups(): Promise<{ server_groups: OpenStackServerGroup[] }> {
  return readJsonObject(`${API}/openstack/server-groups`)
}

export function createOpenStackKeypair(body: {
  name: string
  public_key?: string
}): Promise<{ keypair: { name: string; fingerprint?: string } }> {
  return apiPost(`${API}/openstack/keypairs`, body)
}

export async function deleteOpenStackKeypair(name: string): Promise<void> {
  const res = await fetch(`${API}/openstack/keypairs/${inst(name)}`, {
    method: 'DELETE',
    credentials: 'same-origin',
  })
  if (!res.ok) throw await parseResponseError(res)
}

export function createOpenStackSecurityGroup(body: {
  name: string
  description?: string
}): Promise<{ security_group: import('./openstack').OpenStackSecurityGroup }> {
  return apiPost(`${API}/openstack/security-groups`, body)
}

export async function deleteOpenStackSecurityGroup(id: string): Promise<void> {
  const res = await fetch(`${API}/openstack/security-groups/${inst(id)}`, {
    method: 'DELETE',
    credentials: 'same-origin',
  })
  if (!res.ok) throw await parseResponseError(res)
}

export function createOpenStackSecurityGroupRule(
  groupId: string,
  body: {
    direction: string
    protocol?: string
    port_range_min?: number
    port_range_max?: number
    remote_ip_prefix?: string
    ethertype?: string
  },
): Promise<{ rule: import('./openstack').OpenStackSecurityGroupRule }> {
  return apiPost(`${API}/openstack/security-groups/${inst(groupId)}/rules`, body)
}

export async function deleteOpenStackSecurityGroupRule(ruleId: string): Promise<void> {
  const res = await fetch(`${API}/openstack/security-group-rules/${inst(ruleId)}`, {
    method: 'DELETE',
    credentials: 'same-origin',
  })
  if (!res.ok) throw await parseResponseError(res)
}

export function extendOpenStackVolume(
  id: string,
  newSizeGb: number,
): Promise<{ volume: import('./openstack').OpenStackAttachedVolume }> {
  return apiPost(`${API}/openstack/volumes/${inst(id)}/extend`, { new_size_gb: newSizeGb })
}

export function snapshotOpenStackVolume(
  id: string,
  name: string,
  force?: boolean,
): Promise<unknown> {
  return apiPost(`${API}/openstack/volumes/${inst(id)}/snapshot`, { name, force })
}

export function shelveOpenStackInstance(id: string): Promise<{ status: string }> {
  return apiPost(`${API}/openstack/instances/${inst(id)}/shelve`, {})
}

export function unshelveOpenStackInstance(id: string): Promise<{ status: string }> {
  return apiPost(`${API}/openstack/instances/${inst(id)}/unshelve`, {})
}

export function migrateOpenStackInstance(
  id: string,
  body: { live?: boolean; block_migration?: boolean; host?: string },
): Promise<{ status: string }> {
  return apiPost(`${API}/openstack/instances/${inst(id)}/migrate`, body)
}

export function rescueOpenStackInstance(
  id: string,
  body?: { image?: string; admin_pass?: string },
): Promise<{ status: string }> {
  return apiPost(`${API}/openstack/instances/${inst(id)}/rescue`, body ?? {})
}

export function unrescueOpenStackInstance(id: string): Promise<{ status: string }> {
  return apiPost(`${API}/openstack/instances/${inst(id)}/unrescue`, {})
}

export function backupOpenStackInstance(
  id: string,
  name: string,
): Promise<{ status: string }> {
  return apiPost(`${API}/openstack/instances/${inst(id)}/backup`, { name })
}

export function listOpenStackInstanceInterfaces(
  id: string,
): Promise<{ interfaces: OpenStackInstanceInterface[] }> {
  return readJsonObject(`${API}/openstack/instances/${inst(id)}/interfaces`)
}

export function attachOpenStackInterface(
  id: string,
  body: { network_id?: string; port_id?: string; fixed_ip?: string },
): Promise<{ interface: OpenStackInstanceInterface }> {
  return apiPost(`${API}/openstack/instances/${inst(id)}/interfaces`, body)
}

export async function detachOpenStackInterface(instanceId: string, portId: string): Promise<void> {
  const res = await fetch(
    `${API}/openstack/instances/${inst(instanceId)}/interfaces/${inst(portId)}`,
    { method: 'DELETE', credentials: 'same-origin' },
  )
  if (!res.ok) throw await parseResponseError(res)
}

export function getOpenStackConsoleTunnel(
  id: string,
  type = 'novnc',
): Promise<{ url: string; proxy_path: string; tunnel: boolean }> {
  return readJsonObject(`${API}/openstack/instances/${inst(id)}/console/tunnel?type=${encodeURIComponent(type)}`)
}

export function getOpenStackInstanceStack(
  id: string,
): Promise<{ stack: { stack_id?: string; stack_name?: string } | null }> {
  return readJsonObject(`${API}/openstack/instances/${inst(id)}/stack`)
}

export interface OpenStackImageMember {
  member_id: string
  status: string
}

export function listOpenStackImageMembers(
  imageId: string,
): Promise<{ members: OpenStackImageMember[] }> {
  return readJsonObject(`${API}/openstack/images/${inst(imageId)}/members`)
}

export function addOpenStackImageMember(
  imageId: string,
  memberId: string,
): Promise<{ member: OpenStackImageMember }> {
  return apiPost(`${API}/openstack/images/${inst(imageId)}/members`, { member_id: memberId })
}

export async function deleteOpenStackImageMember(
  imageId: string,
  memberId: string,
): Promise<void> {
  const res = await fetch(
    `${API}/openstack/images/${inst(imageId)}/members/${inst(memberId)}`,
    { method: 'DELETE', credentials: 'same-origin' },
  )
  if (!res.ok) throw await parseResponseError(res)
}

export function updateOpenStackImageVisibility(
  imageId: string,
  visibility: string,
): Promise<{ visibility: string }> {
  return apiPost(`${API}/openstack/images/${inst(imageId)}/visibility`, { visibility })
}

export function retypeOpenStackVolume(
  id: string,
  newType: string,
  migrationPolicy = 'on-demand',
): Promise<{ volume: import('./openstack').OpenStackAttachedVolume }> {
  return apiPost(`${API}/openstack/volumes/${inst(id)}/retype`, {
    new_type: newType,
    migration_policy: migrationPolicy,
  })
}

export async function deleteOpenStackVolumeSnapshot(id: string): Promise<void> {
  const res = await fetch(`${API}/openstack/volume-snapshots/${inst(id)}`, {
    method: 'DELETE',
    credentials: 'same-origin',
  })
  if (!res.ok) throw await parseResponseError(res)
}

export function createOpenStackPort(body: {
  network_id: string
  name?: string
}): Promise<{ port: { id: string; name: string; network_id: string; status: string } }> {
  return apiPost(`${API}/openstack/ports`, body)
}

export async function deleteOpenStackPort(portId: string): Promise<void> {
  const res = await fetch(`${API}/openstack/ports/${inst(portId)}`, {
    method: 'DELETE',
    credentials: 'same-origin',
  })
  if (!res.ok) throw await parseResponseError(res)
}

export function removeOpenStackRouterInterface(body: {
  router_id: string
  subnet_id: string
}): Promise<{ status: string }> {
  return apiPost(`${API}/openstack/routers/remove-interface`, body)
}

export function createOpenStackFloatingIp(
  floatingNetworkId: string,
): Promise<{ floating_ip: import('./openstack').OpenStackFloatingIp }> {
  return apiPost(`${API}/openstack/floating-ips`, { floating_network_id: floatingNetworkId })
}

export function addOpenStackRouterInterface(body: {
  router_id: string
  subnet_id: string
}): Promise<{ result: unknown }> {
  return apiPost(`${API}/openstack/routers/add-interface`, body)
}

export function updateOpenStackImageMetadata(
  imageId: string,
  properties: Record<string, string>,
): Promise<{ properties: Record<string, string> }> {
  return apiPost(`${API}/openstack/images/${inst(imageId)}/metadata`, { properties })
}

export function createOpenStackNetwork(body: {
  name: string
  external?: boolean
}): Promise<{ network: import('./openstack').OpenStackNetwork }> {
  return apiPost(`${API}/openstack/networks`, body)
}

export interface OpenStackVolumeSnapshot {
  id: string
  name: string
  volume_id: string
  size_gb: number
  status: string
}

export function listOpenStackVolumeSnapshots(): Promise<{ snapshots: OpenStackVolumeSnapshot[] }> {
  return readJsonObject(`${API}/openstack/volume-snapshots`)
}

export function createOpenStackVolumeFromSnapshot(body: {
  snapshot_id: string
  name?: string
  size_gb?: number
}): Promise<{ volume: import('./openstack').OpenStackAttachedVolume }> {
  return apiPost(`${API}/openstack/volumes/from-snapshot`, body)
}

export function createOpenStackRouter(body: {
  name: string
  external_network_id?: string
}): Promise<{ router: OpenStackRouter }> {
  return apiPost(`${API}/openstack/routers`, body)
}

export function createOpenStackSubnet(body: {
  network_id: string
  cidr: string
  name?: string
  gateway_ip?: string
  ip_version?: number
}): Promise<{ subnet: OpenStackSubnet }> {
  return apiPost(`${API}/openstack/subnets`, body)
}

export async function deleteOpenStackNetwork(id: string): Promise<void> {
  const res = await fetch(`${API}/openstack/networks/${inst(id)}`, { method: 'DELETE', credentials: 'same-origin' })
  if (!res.ok) throw await parseResponseError(res)
}

export async function deleteOpenStackSubnet(id: string): Promise<void> {
  const res = await fetch(`${API}/openstack/subnets/${inst(id)}`, { method: 'DELETE', credentials: 'same-origin' })
  if (!res.ok) throw await parseResponseError(res)
}

export async function deleteOpenStackRouter(id: string): Promise<void> {
  const res = await fetch(`${API}/openstack/routers/${inst(id)}`, { method: 'DELETE', credentials: 'same-origin' })
  if (!res.ok) throw await parseResponseError(res)
}

export interface OpenStackAvailabilityZone {
  name: string
  state: string
  hosts: string[]
}

export function listOpenStackAvailabilityZones(): Promise<{ availability_zones: OpenStackAvailabilityZone[] }> {
  return readJsonObject(`${API}/openstack/availability-zones`)
}

export interface OpenStackHypervisor {
  id: string
  hostname: string
  state: string
  status: string
  vcpus: number
  vcpus_used: number
  memory_mb: number
  memory_mb_used: number
  running_vms: number
}

export function listOpenStackHypervisors(): Promise<{ hypervisors: OpenStackHypervisor[] }> {
  return readJsonObject(`${API}/openstack/hypervisors`)
}

export interface OpenStackVolumeTransfer {
  id: string
  name: string
  volume_id: string
  auth_key?: string
}

export function listOpenStackVolumeTransfers(): Promise<{ transfers: OpenStackVolumeTransfer[] }> {
  return readJsonObject(`${API}/openstack/volume-transfers`)
}

export function cloneOpenStackVolume(body: {
  source_volume_id: string
  name?: string
  size_gb?: number
}): Promise<{ volume: import('./openstack').OpenStackAttachedVolume }> {
  return apiPost(`${API}/openstack/volumes/clone`, body)
}

export function createOpenStackVolumeTransfer(body: {
  volume_id: string
  name: string
}): Promise<{ transfer: OpenStackVolumeTransfer }> {
  return apiPost(`${API}/openstack/volume-transfers`, body)
}

export function acceptOpenStackVolumeTransfer(body: {
  transfer_id: string
  auth_key: string
}): Promise<{ transfer: OpenStackVolumeTransfer }> {
  return apiPost(`${API}/openstack/volume-transfers/accept`, body)
}

export async function deleteOpenStackVolumeTransfer(id: string): Promise<void> {
  const res = await fetch(`${API}/openstack/volume-transfers/${inst(id)}`, { method: 'DELETE', credentials: 'same-origin' })
  if (!res.ok) throw await parseResponseError(res)
}

export function createOpenStackServerGroup(body: {
  name: string
  policy: string
}): Promise<{ server_group: OpenStackServerGroup }> {
  return apiPost(`${API}/openstack/server-groups`, body)
}

export function getOpenStackServerGroup(id: string): Promise<{ server_group: OpenStackServerGroup }> {
  return readJsonObject(`${API}/openstack/server-groups/${inst(id)}`)
}

export function renameOpenStackInstance(id: string, name: string): Promise<{ status: string; id: string; name: string }> {
  return apiPost(`${API}/openstack/instances/${inst(id)}/rename`, { name })
}

export function lockOpenStackInstance(id: string): Promise<{ status: string; id: string }> {
  return apiPost(`${API}/openstack/instances/${inst(id)}/lock`, {})
}

export function unlockOpenStackInstance(id: string): Promise<{ status: string; id: string }> {
  return apiPost(`${API}/openstack/instances/${inst(id)}/unlock`, {})
}

export function resetOpenStackInstanceState(id: string): Promise<{ status: string; id: string }> {
  return apiPost(`${API}/openstack/instances/${inst(id)}/reset-state`, {})
}

export async function deleteOpenStackServerGroup(id: string): Promise<void> {
  const res = await fetch(`${API}/openstack/server-groups/${inst(id)}`, {
    method: 'DELETE',
    credentials: 'same-origin',
  })
  if (!res.ok) throw await parseResponseError(res)
}

export interface OpenStackComputeService {
  id: string
  binary: string
  host: string
  zone: string
  status: string
  state: string
  disabled_reason?: string
}

export function listOpenStackComputeServices(): Promise<{ services: OpenStackComputeService[] }> {
  return readJsonObject(`${API}/openstack/compute-services`)
}

export interface OpenStackNeutronAgent {
  id: string
  agent_type: string
  host: string
  alive: boolean
  admin_state_up: boolean
}

export function listOpenStackNeutronAgents(): Promise<{ agents: OpenStackNeutronAgent[] }> {
  return readJsonObject(`${API}/openstack/neutron-agents`)
}

export interface OpenStackHostAggregate {
  id: string
  name: string
  availability_zone?: string
  hosts: string[]
}

export function listOpenStackHostAggregates(): Promise<{ aggregates: OpenStackHostAggregate[] }> {
  return readJsonObject(`${API}/openstack/aggregates`)
}

export function createOpenStackVolumeFromImage(body: {
  image_id: string
  name?: string
  size_gb?: number
}): Promise<{ volume: import('./openstack').OpenStackAttachedVolume }> {
  return apiPost(`${API}/openstack/volumes/from-image`, body)
}

export function updateOpenStackVolume(
  id: string,
  body: { name?: string; description?: string },
): Promise<{ volume: import('./openstack').OpenStackAttachedVolume }> {
  return apiPut(`${API}/openstack/volumes/${inst(id)}`, body)
}

export function setOpenStackVolumeBootable(
  id: string,
  bootable: boolean,
): Promise<{ status: string; id: string; bootable: boolean }> {
  return apiPost(`${API}/openstack/volumes/${inst(id)}/bootable`, { bootable })
}

export function getOpenStackVolume(id: string): Promise<{ volume: import('./openstack').OpenStackAttachedVolume }> {
  return readJsonObject(`${API}/openstack/volumes/${inst(id)}`)
}

export function getOpenStackNetwork(id: string): Promise<{ network: import('./openstack').OpenStackNetwork }> {
  return readJsonObject(`${API}/openstack/networks/${inst(id)}`)
}

export function getOpenStackSubnet(id: string): Promise<{ subnet: OpenStackSubnet }> {
  return readJsonObject(`${API}/openstack/subnets/${inst(id)}`)
}

export function getOpenStackRouter(id: string): Promise<{ router: OpenStackRouter }> {
  return readJsonObject(`${API}/openstack/routers/${inst(id)}`)
}

export function getOpenStackPort(id: string): Promise<{ port: OpenStackPort }> {
  return readJsonObject(`${API}/openstack/ports/${inst(id)}`)
}

export function updateOpenStackNetwork(id: string, body: { name: string }): Promise<{ network: import('./openstack').OpenStackNetwork }> {
  return apiPut(`${API}/openstack/networks/${inst(id)}`, body)
}

export function updateOpenStackPort(
  id: string,
  body: { name?: string; admin_state_up?: boolean },
): Promise<{ port: { id: string; name: string; network_id: string; status: string } }> {
  return apiPut(`${API}/openstack/ports/${inst(id)}`, body)
}

export function getOpenStackVolumeSnapshot(id: string): Promise<{ snapshot: OpenStackVolumeSnapshot }> {
  return readJsonObject(`${API}/openstack/volume-snapshots/${inst(id)}`)
}

export function getOpenStackVolumeTransfer(id: string): Promise<{ transfer: OpenStackVolumeTransfer }> {
  return readJsonObject(`${API}/openstack/volume-transfers/${inst(id)}`)
}

export function getOpenStackHypervisor(id: string): Promise<{ hypervisor: OpenStackHypervisor }> {
  return readJsonObject(`${API}/openstack/hypervisors/${inst(id)}`)
}

export function updateOpenStackRouter(
  id: string,
  body: { name?: string; external_network_id?: string; clear_external_gateway?: boolean },
): Promise<{ router: OpenStackRouter }> {
  return apiPut(`${API}/openstack/routers/${inst(id)}`, body)
}

export function updateOpenStackSubnet(
  id: string,
  body: { name?: string; gateway_ip?: string; enable_dhcp?: boolean },
): Promise<{ subnet: OpenStackSubnet }> {
  return apiPut(`${API}/openstack/subnets/${inst(id)}`, body)
}

export function uploadOpenStackVolumeToImage(
  volumeId: string,
  body: { image_name: string; disk_format?: string; force?: boolean },
): Promise<{ upload: { image_id: string; status: string } }> {
  return apiPost(`${API}/openstack/volumes/${inst(volumeId)}/upload-image`, body)
}

export function updateOpenStackQuotas(body: {
  service: 'compute' | 'cinder' | 'neutron'
  project_id?: string
  quotas: Record<string, number>
}): Promise<{ status: string }> {
  return apiPut(`${API}/openstack/quotas`, body)
}

export function enableOpenStackComputeService(body: { binary: string; host: string }): Promise<{ status: string }> {
  return apiPost(`${API}/openstack/compute-services/enable`, { ...body, disabled: false })
}

export function disableOpenStackComputeService(body: { binary: string; host: string }): Promise<{ status: string }> {
  return apiPost(`${API}/openstack/compute-services/disable`, { ...body, disabled: true })
}

export function setOpenStackNeutronAgentAdmin(agentId: string, admin_state_up: boolean): Promise<{ status: string }> {
  return apiPut(`${API}/openstack/neutron-agents/${inst(agentId)}`, { admin_state_up })
}

export function setOpenStackHypervisorMaintenance(hypervisorId: string, maintenance: boolean): Promise<{ status: string }> {
  return apiPut(`${API}/openstack/hypervisors/${inst(hypervisorId)}`, { maintenance })
}

export function createOpenStackAggregate(body: { name: string; availability_zone?: string }): Promise<{ aggregate: OpenStackHostAggregate }> {
  return apiPost(`${API}/openstack/aggregates`, body)
}

export function updateOpenStackAggregate(
  id: string,
  body: { name?: string; availability_zone?: string },
): Promise<{ aggregate: OpenStackHostAggregate }> {
  return apiPut(`${API}/openstack/aggregates/${inst(id)}`, body)
}

export function addOpenStackAggregateHost(aggregateId: string, host: string): Promise<{ aggregate: OpenStackHostAggregate }> {
  return apiPost(`${API}/openstack/aggregates/${inst(aggregateId)}/add-host`, { host })
}

export function removeOpenStackAggregateHost(aggregateId: string, host: string): Promise<{ aggregate: OpenStackHostAggregate }> {
  return apiPost(`${API}/openstack/aggregates/${inst(aggregateId)}/remove-host`, { host })
}

export interface OpenStackHeatStack {
  id: string
  stack_name: string
  stack_status: string
  stack_status_reason?: string
  creation_time?: string
  updated_time?: string
  description?: string
  timeout_mins?: number
  parameters?: Record<string, unknown>
  outputs?: OpenStackHeatOutput[]
}

export interface OpenStackHeatOutput {
  output_key: string
  output_value?: string
  description?: string
}

export interface OpenStackHeatResource {
  logical_resource_id: string
  resource_name: string
  resource_status: string
  resource_type: string
  physical_resource_id?: string
}

export interface OpenStackHeatEvent {
  event_time?: string
  resource_name: string
  resource_status?: string
  resource_status_reason?: string
  resource_type?: string
}

export function listOpenStackHeatStacks(): Promise<{ stacks: OpenStackHeatStack[] }> {
  return readJsonObject(`${API}/openstack/heat/stacks`)
}

export function getOpenStackHeatStack(name: string, id: string): Promise<{ stack: OpenStackHeatStack }> {
  return readJsonObject(`${API}/openstack/heat/stacks/${encodeURIComponent(name)}/${encodeURIComponent(id)}`)
}

export function createOpenStackHeatStack(body: {
  stack_name: string
  template_body: string
  parameters?: Record<string, unknown>
  timeout_mins?: number
}): Promise<{ stack: OpenStackHeatStack }> {
  return apiPost(`${API}/openstack/heat/stacks`, body)
}

export function deleteOpenStackHeatStack(name: string, id: string): Promise<void> {
  return apiDelete(`${API}/openstack/heat/stacks/${encodeURIComponent(name)}/${encodeURIComponent(id)}`)
}

export function listOpenStackHeatResources(name: string, id: string): Promise<{ resources: OpenStackHeatResource[] }> {
  return readJsonObject(`${API}/openstack/heat/stacks/${encodeURIComponent(name)}/${encodeURIComponent(id)}/resources`)
}

export function listOpenStackHeatEvents(name: string, id: string): Promise<{ events: OpenStackHeatEvent[] }> {
  return readJsonObject(`${API}/openstack/heat/stacks/${encodeURIComponent(name)}/${encodeURIComponent(id)}/events`)
}

export function getOpenStackHeatTemplate(name: string, id: string): Promise<{ template: string }> {
  return readJsonObject(`${API}/openstack/heat/stacks/${encodeURIComponent(name)}/${encodeURIComponent(id)}/template`)
}

export function updateOpenStackHeatStack(
  name: string,
  id: string,
  body: { template_body?: string; parameters?: Record<string, unknown>; timeout_mins?: number },
): Promise<{ stack: OpenStackHeatStack }> {
  return apiPatch(`${API}/openstack/heat/stacks/${encodeURIComponent(name)}/${encodeURIComponent(id)}`, body)
}

export interface OpenStackLoadBalancer {
  id: string
  name: string
  provisioning_status: string
  operating_status: string
  vip_address?: string
  vip_subnet_id?: string
  description?: string
}

export function listOpenStackLoadBalancers(): Promise<{ loadbalancers: OpenStackLoadBalancer[] }> {
  return readJsonObject(`${API}/openstack/load-balancers`)
}

export function getOpenStackLoadBalancer(id: string): Promise<{ loadbalancer: OpenStackLoadBalancer }> {
  return readJsonObject(`${API}/openstack/load-balancers/${inst(id)}`)
}

export function createOpenStackLoadBalancer(body: {
  name: string
  vip_subnet_id: string
  description?: string
}): Promise<{ loadbalancer: OpenStackLoadBalancer }> {
  return apiPost(`${API}/openstack/load-balancers`, body)
}

export function deleteOpenStackLoadBalancer(id: string): Promise<void> {
  return apiDelete(`${API}/openstack/load-balancers/${inst(id)}`)
}

export interface OpenStackLbListener {
  id: string
  name: string
  protocol: string
  protocol_port: number
  provisioning_status: string
  operating_status: string
  loadbalancer_id?: string
  default_pool_id?: string
}

export interface OpenStackLbPool {
  id: string
  name: string
  protocol: string
  lb_algorithm: string
  provisioning_status: string
  operating_status: string
  loadbalancer_id?: string
}

export interface OpenStackLbMember {
  id: string
  address: string
  protocol_port: number
  subnet_id?: string
  provisioning_status: string
  operating_status: string
}

export interface OpenStackLbHealthMonitor {
  id: string
  name: string
  type: string
  delay: number
  timeout: number
  max_retries: number
  provisioning_status: string
  operating_status: string
  pool_id?: string
}

export function listOpenStackLbListeners(lbId: string): Promise<{ listeners: OpenStackLbListener[] }> {
  return readJsonObject(`${API}/openstack/load-balancers/${inst(lbId)}/listeners`)
}

export function createOpenStackLbListener(
  lbId: string,
  body: { name: string; protocol: string; protocol_port: number; loadbalancer_id?: string },
): Promise<{ listener: OpenStackLbListener }> {
  return apiPost(`${API}/openstack/load-balancers/${inst(lbId)}/listeners`, { ...body, loadbalancer_id: lbId })
}

export function deleteOpenStackLbListener(id: string): Promise<void> {
  return apiDelete(`${API}/openstack/load-balancers/listeners/${inst(id)}`)
}

export function listOpenStackLbPools(lbId: string): Promise<{ pools: OpenStackLbPool[] }> {
  return readJsonObject(`${API}/openstack/load-balancers/${inst(lbId)}/pools`)
}

export function createOpenStackLbPool(body: {
  name: string
  protocol: string
  lb_algorithm: string
  listener_id: string
}): Promise<{ pool: OpenStackLbPool }> {
  return apiPost(`${API}/openstack/load-balancers/pools`, body)
}

export function deleteOpenStackLbPool(id: string): Promise<void> {
  return apiDelete(`${API}/openstack/load-balancers/pools/${inst(id)}`)
}

export function listOpenStackLbMembers(poolId: string): Promise<{ members: OpenStackLbMember[] }> {
  return readJsonObject(`${API}/openstack/load-balancers/pools/${inst(poolId)}/members`)
}

export function createOpenStackLbMember(
  poolId: string,
  body: { address: string; protocol_port: number; subnet_id?: string },
): Promise<{ member: OpenStackLbMember }> {
  return apiPost(`${API}/openstack/load-balancers/pools/${inst(poolId)}/members`, body)
}

export function deleteOpenStackLbMember(poolId: string, memberId: string): Promise<void> {
  return apiDelete(`${API}/openstack/load-balancers/pools/${inst(poolId)}/members/${inst(memberId)}`)
}

export function listOpenStackLbHealthMonitors(poolId: string): Promise<{ healthmonitors: OpenStackLbHealthMonitor[] }> {
  return readJsonObject(`${API}/openstack/load-balancers/pools/${inst(poolId)}/health-monitors`)
}

export function createOpenStackLbHealthMonitor(body: {
  pool_id: string
  name: string
  type: string
  delay: number
  timeout: number
  max_retries: number
}): Promise<{ healthmonitor: OpenStackLbHealthMonitor }> {
  return apiPost(`${API}/openstack/load-balancers/health-monitors`, body)
}

export function deleteOpenStackLbHealthMonitor(id: string): Promise<void> {
  return apiDelete(`${API}/openstack/load-balancers/health-monitors/${inst(id)}`)
}

export interface OpenStackProject {
  id: string
  name: string
  enabled: boolean
  description?: string
}

export interface OpenStackIdentityUser {
  id: string
  name: string
  enabled: boolean
  email?: string
  default_project_id?: string
}

export function listOpenStackIdentityProjects(): Promise<{ projects: OpenStackProject[] }> {
  return readJsonObject(`${API}/openstack/identity/projects`)
}

export function getOpenStackIdentityProject(id: string): Promise<{ project: OpenStackProject }> {
  return readJsonObject(`${API}/openstack/identity/projects/${inst(id)}`)
}

export function createOpenStackIdentityProject(body: {
  name: string
  description?: string
  enabled?: boolean
}): Promise<{ project: OpenStackProject }> {
  return apiPost(`${API}/openstack/identity/projects`, body)
}

export function listOpenStackIdentityUsers(): Promise<{ users: OpenStackIdentityUser[] }> {
  return readJsonObject(`${API}/openstack/identity/users`)
}

export function getOpenStackIdentityUser(id: string): Promise<{ user: OpenStackIdentityUser }> {
  return readJsonObject(`${API}/openstack/identity/users/${inst(id)}`)
}

export function createOpenStackIdentityUser(body: {
  name: string
  password: string
  email?: string
  default_project_id?: string
  enabled?: boolean
}): Promise<{ user: OpenStackIdentityUser }> {
  return apiPost(`${API}/openstack/identity/users`, body)
}

export function updateOpenStackIdentityUser(
  id: string,
  body: { enabled?: boolean; email?: string },
): Promise<{ user: OpenStackIdentityUser }> {
  return apiPut(`${API}/openstack/identity/users/${inst(id)}`, body)
}

export interface OpenStackRole {
  id: string
  name: string
}

export interface OpenStackRoleAssignment {
  role_id: string
  user_id?: string
  project_id?: string
  role_name?: string
  user_name?: string
}

export function listOpenStackIdentityRoles(): Promise<{ roles: OpenStackRole[] }> {
  return readJsonObject(`${API}/openstack/identity/roles`)
}

export function listOpenStackRoleAssignments(projectId?: string): Promise<{ role_assignments: OpenStackRoleAssignment[] }> {
  const q = projectId ? `?project_id=${encodeURIComponent(projectId)}` : ''
  return readJsonObject(`${API}/openstack/identity/role-assignments${q}`)
}

export function grantOpenStackRoleAssignment(body: {
  project_id: string
  user_id: string
  role_id: string
}): Promise<{ status: string }> {
  return apiPut(`${API}/openstack/identity/role-assignments`, body)
}

export function revokeOpenStackRoleAssignment(body: {
  project_id: string
  user_id: string
  role_id: string
}): Promise<{ status: string }> {
  return apiPost(`${API}/openstack/identity/role-assignments/revoke`, body)
}

export interface TopologyNode {
  id: string
  label: string
  kind: string
  status?: string
  extra?: string
}

export interface TopologyEdge {
  from: string
  to: string
  label?: string
}

export function getOpenStackNetworkTopology(): Promise<{ graph: { nodes: TopologyNode[]; edges: TopologyEdge[] } }> {
  return readJsonObject(`${API}/openstack/network-topology`)
}
