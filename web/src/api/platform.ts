// Copyright (c) 2026 ZyvorAI Labs Private Limited. All rights reserved.

const LS_CONTROLLER = 'machina_platform_controller'
const LS_BASIC = 'machina_platform_basic'
const LS_JWT = 'machina_platform_jwt'

/** Same-origin daemon proxy to co-located machina-controller (see daemon platform_controller routes). */
export const PLATFORM_CONTROLLER_PROXY = '/api/v1/platform/controller'

function sameOriginProxyBase(): string {
  if (typeof window === 'undefined') return ''
  return `${window.location.origin}${PLATFORM_CONTROLLER_PROXY}`
}

function directControllerBase(): string {
  if (typeof window === 'undefined') return 'http://127.0.0.1:5093'
  const { protocol, hostname } = window.location
  const p = protocol === 'https:' ? 'https:' : 'http:'
  return `${p}//${hostname}:5093`
}

function normalizeSavedController(url: string | null): string | null {
  if (!url) return null
  const u = url.replace(/\/$/, '')
  if (typeof window === 'undefined') return u
  const host = window.location.hostname
  if (
    (u === 'http://127.0.0.1:5093' || u === 'http://localhost:5093')
    && host !== 'localhost'
    && host !== '127.0.0.1'
  ) {
    return null
  }
  return u
}

export function getControllerBase(): string {
  const saved = normalizeSavedController(localStorage.getItem(LS_CONTROLLER))
  if (saved) return saved
  const env = import.meta.env.VITE_MACHINA_CONTROLLER_URL?.replace(/\/$/, '')
  if (env) return env
  return sameOriginProxyBase() || directControllerBase()
}

/** Direct controller URL (port 5093) — used for WebSocket console when HTTP goes via daemon proxy. */
export function getDirectControllerBase(): string {
  const saved = normalizeSavedController(localStorage.getItem(LS_CONTROLLER))
  if (saved && !saved.includes(PLATFORM_CONTROLLER_PROXY)) return saved
  const env = import.meta.env.VITE_MACHINA_CONTROLLER_URL?.replace(/\/$/, '')
  if (env) return env
  return directControllerBase()
}

export function setControllerConfig(base: string, user: string, pass: string) {
  localStorage.setItem(LS_CONTROLLER, base.replace(/\/$/, ''))
  localStorage.setItem(LS_BASIC, btoa(`${user}:${pass}`))
}

export function platformHeaders(extra?: HeadersInit): Headers {
  const h = new Headers(extra)
  if (!h.has('Content-Type')) h.set('Content-Type', 'application/json')
  const jwt = localStorage.getItem(LS_JWT)
  if (jwt) {
    h.set('Authorization', `Bearer ${jwt}`)
    return h
  }
  const basic = localStorage.getItem(LS_BASIC)
  if (basic) h.set('Authorization', `Basic ${basic}`)
  return h
}

import { formatHttpErrorBody } from '../utils/apiError'

export interface PlatformApiError extends Error {
  error_code?: string
  remediation?: string
  object_ref?: { kind: string; id: string; name?: string }
}

export async function platformFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const url = `${getControllerBase()}${path.startsWith('/') ? path : `/${path}`}`
  let res: Response
  try {
    res = await fetch(url, { credentials: 'same-origin', ...init, headers: platformHeaders(init?.headers) })
  } catch {
    throw new Error(
      `Cannot reach the Machina platform controller (${getControllerBase()}). ` +
      'Ensure machina-controller is running (systemctl status machina-controller) or set the controller URL on Platform Dashboard.',
    )
  }
  if (res.status === 429) {
    throw new Error('Rate limit exceeded — wait a minute and retry')
  }
  if (!res.ok) {
    const body = await res.text().catch(() => '')
    let parsed: PlatformApiError | null = null
    try {
      const j = JSON.parse(body) as { error?: string; error_code?: string; remediation?: string; object_ref?: unknown }
      if (j.error) {
        parsed = Object.assign(new Error(formatHttpErrorBody(res.status, res.statusText, body)), {
          error_code: j.error_code,
          remediation: j.remediation,
          object_ref: j.object_ref as PlatformApiError['object_ref'],
        })
      }
    } catch {
      /* plain text */
    }
    throw parsed ?? new Error(body || `${res.status} ${res.statusText}`)
  }
  if (res.status === 204) return undefined as T
  return (await res.json()) as T
}

export interface PlatformHost {
  id: string
  hostname: string
  address: string
  state: string
  maintenance_mode: boolean
  agent_grpc_addr: string
  vm_count: number
  cpu_percent?: number
  memory_used_mib?: number
  memory_total_mib?: number
  fenced?: boolean
  validation_status?: string
  last_heartbeat_at?: string | null
  site?: string
  rack?: string
  rack_u?: number | null
}

export interface PlatformHostDetail extends PlatformHost {
  agent_console_addr: string
  libvirt_uri: string
  agent_version: string
  cpu_model: string
  libvirt_version: string
  qemu_version: string
  notes: string
  validation_status?: string
  validation_report?: Array<{ name: string; passed: boolean; message: string; remediation?: string }>
}

export interface PlatformVm {
  id: string
  name: string
  host_id?: string | null
  desired_state: string
  observed_state: string
  lifecycle_phase?: string
  last_error?: string
  managed?: boolean
  uuid?: string | null
  vcpus: number
  memory_mib: number
  ha_enabled?: boolean
  project?: string | null
  tags?: string[]
  inventory_source?: string
  k8s_namespace?: string | null
  last_seen_at?: string | null
}

export interface PlatformTask {
  id: string
  operation: string
  status: string
  progress: number
  message?: string | null
  created_at: string
}

export interface PlatformTemplate {
  id: string
  name: string
  version: string
  source_disk: string
  cloud_init: boolean
  os_family?: string | null
  category?: string
  description?: string
  featured?: boolean
  marketplace?: boolean
  icon?: string | null
  firewall_profile?: string | null
}

export interface PlatformConsoleInfo {
  vm_id: string
  vm_name: string
  console_type: string
  ws_path: string
}

export interface EnrollmentToken {
  token: string
  expires_at: string
  install_command: string
}

export const listPlatformHosts = () => platformFetch<PlatformHost[]>('/api/v1/hosts')
export const getPlatformHostDetail = (id: string) => platformFetch<PlatformHostDetail>(`/api/v1/hosts/${id}/detail`)
export const syncAllHosts = () => platformFetch<{ task_id: string }[]>('/api/v1/hosts/sync-all', { method: 'POST' })
export const deleteHost = (id: string) => platformFetch<{ deleted: boolean }>(`/api/v1/hosts/${id}`, { method: 'DELETE' })
export const listPlatformVms = (params?: {
  project?: string
  host_id?: string
  managed?: boolean
  tag?: string
  folder?: string
  source?: string
}) => {
  const q = new URLSearchParams()
  if (params?.project) q.set('project', params.project)
  if (params?.host_id) q.set('host_id', params.host_id)
  if (params?.managed !== undefined) q.set('managed', String(params.managed))
  if (params?.tag) q.set('tag', params.tag)
  if (params?.folder) q.set('folder', params.folder)
  if (params?.source) q.set('source', params.source)
  const qs = q.toString()
  return platformFetch<PlatformVm[]>(`/api/v1/vms${qs ? `?${qs}` : ''}`)
}
export const getPlatformVmSpec = (id: string) => platformFetch<unknown>(`/api/v1/vms/${id}/spec`)
export const getVmHaPolicy = (id: string) => platformFetch<HaPolicy>('/api/v1/vms/' + id + '/ha')
export const listPlatformTasks = (params?: { status?: string; operation?: string }) => {
  const q = new URLSearchParams()
  if (params?.status) q.set('status', params.status)
  if (params?.operation) q.set('operation', params.operation)
  const qs = q.toString()
  return platformFetch<PlatformTask[]>(`/api/v1/tasks${qs ? `?${qs}` : ''}`)
}
export const getPlatformTask = (id: string) => platformFetch<PlatformTask>(`/api/v1/tasks/${id}`)
export const cancelTask = (id: string) => platformFetch<PlatformTask>(`/api/v1/tasks/${id}/cancel`, { method: 'POST' })
export const listPlatformEvents = (kind?: string) =>
  platformFetch<PlatformEvent[]>(`/api/v1/events${kind ? `?kind=${encodeURIComponent(kind)}` : ''}`)
export const listAuditLogs = (params?: { action?: string; actor?: string }) => {
  const q = new URLSearchParams()
  if (params?.action) q.set('action', params.action)
  if (params?.actor) q.set('actor', params.actor)
  const qs = q.toString()
  return platformFetch<AuditLog[]>(`/api/v1/audit${qs ? `?${qs}` : ''}`)
}
export const listStoragePools = () => platformFetch<StoragePool[]>('/api/v1/storage/pools')
export const createStoragePool = (body: { name: string; storage_class?: string; path?: string; capacity_gib?: number }) =>
  platformFetch<StoragePool>('/api/v1/storage/pools', { method: 'POST', body: JSON.stringify(body) })
export const deleteStoragePool = (id: string) => platformFetch(`/api/v1/storage/pools/${id}`, { method: 'DELETE' })
export const discoverStoragePools = () =>
  platformFetch<{ imported: number; pools: StoragePool[] }>('/api/v1/storage/pools/discover', {
    method: 'POST',
    body: '{}',
  })

export const getStorageTiersOverview = () =>
  platformFetch<StorageTiersOverview>('/api/v1/storage/tiers/overview')

export const bindStoragePoolTier = (poolId: string, tierId: string) =>
  platformFetch(`/api/v1/storage/pools/${poolId}/tier/${tierId}`, { method: 'POST', body: '{}' })

export const getStorageBackupSla = () =>
  platformFetch<StorageBackupSlaOverview>('/api/v1/storage/backup-sla')

export const upsertStorageBackupSla = (poolId: string, body: { rpo_hours: number; rto_hours: number; retention_days: number }) =>
  platformFetch<StorageBackupSla>(`/api/v1/storage/pools/${poolId}/backup-sla`, {
    method: 'POST',
    body: JSON.stringify(body),
  })

export const getStorageSnapshotPolicy = (poolId: string) =>
  platformFetch<{ pool_name: string; snapshot_retention_days: number; summary: string }>(
    `/api/v1/storage/pools/${poolId}/snapshot-policy`,
  )

export type EnterpriseSecurityOverview = {
  vault_providers: number
  vault_connected: number
  mfa_policies: number
  mfa_required_roles: number
  air_gap_bundles: number
  mfa_enrolled_users: number
  tenant_policies: number
  fips_profiles: number
  summary: string
}

export type VaultProvider = {
  id: string
  name: string
  provider_type: string
  address: string
  namespace: string
  status: string
  last_sync_at?: string | null
}

export type MfaPolicy = {
  id: string
  role_name: string
  method: string
  required: boolean
  grace_days: number
}

export type AirGapBundle = {
  id: string
  name: string
  checksum: string
  manifest_json: Record<string, unknown>
  size_bytes: number
  exported_at: string
}

export const getEnterpriseSecurityOverview = () =>
  platformFetch<EnterpriseSecurityOverview>('/api/v1/enterprise/security/overview')

export const listVaultProviders = () =>
  platformFetch<VaultProvider[]>('/api/v1/enterprise/vault/providers')

export const registerVaultProvider = (body: {
  name: string
  provider_type?: string
  address?: string
  namespace?: string
}) =>
  platformFetch<VaultProvider>('/api/v1/enterprise/vault/providers', {
    method: 'POST',
    body: JSON.stringify(body),
  })

export const listMfaPolicies = () =>
  platformFetch<MfaPolicy[]>('/api/v1/enterprise/mfa/policies')

export const upsertMfaPolicy = (role: string, body: { method: string; required: boolean; grace_days?: number }) =>
  platformFetch<MfaPolicy>(`/api/v1/enterprise/mfa/policies/${encodeURIComponent(role)}`, {
    method: 'POST',
    body: JSON.stringify(body),
  })

export const listAirGapBundles = () =>
  platformFetch<AirGapBundle[]>('/api/v1/enterprise/air-gap/bundles')

export const createAirGapBundle = (body: { name: string }) =>
  platformFetch<AirGapBundle>('/api/v1/enterprise/air-gap/bundles', {
    method: 'POST',
    body: JSON.stringify(body),
  })

export type VaultSyncResult = {
  provider_id: string
  provider_name: string
  status: string
  message: string
  last_sync_at: string
}

export type MfaComplianceReport = {
  required_roles: number
  compliant_users: number
  non_compliant_users: number
  users: Array<{
    username: string
    role: string
    required_method: string
    enrolled: boolean
    compliant: boolean
  }>
  summary: string
}

export type FipsMatrix = {
  active_profile: string
  openssl_version: string
  profiles: Array<{
    id: string
    name: string
    tls_min_version: string
    fips_mode: string
    cipher_suites: string
    notes: string
  }>
  summary: string
}

export type TenantIsolationItem = {
  project_name: string
  vm_count: number
  network_isolation: string
  max_vms: number
  max_storage_gib: number
  enforce_quotas: boolean
  quota_status: string
}

export type TenantIsolationOverview = {
  projects: TenantIsolationItem[]
  enforced_count: number
  summary: string
}

export const syncVaultProvider = (id: string) =>
  platformFetch<VaultSyncResult>(`/api/v1/enterprise/vault/providers/${id}/sync`, { method: 'POST', body: '{}' })

export const syncAllVaultProviders = () =>
  platformFetch<{ synced: number; summary: string; results: VaultSyncResult[] }>(
    '/api/v1/enterprise/vault/sync-all',
    { method: 'POST', body: '{}' },
  )

export const getMfaCompliance = () =>
  platformFetch<MfaComplianceReport>('/api/v1/enterprise/mfa/compliance')

export const getFipsMatrix = () =>
  platformFetch<FipsMatrix>('/api/v1/enterprise/fips/matrix')

export const getTenantIsolationOverview = () =>
  platformFetch<TenantIsolationOverview>('/api/v1/enterprise/tenants/overview')

export const upsertTenantPolicy = (
  project: string,
  body: { network_isolation?: string; max_vms?: number; max_storage_gib?: number; enforce_quotas?: boolean },
) =>
  platformFetch<TenantIsolationItem>(`/api/v1/enterprise/tenants/policies/${encodeURIComponent(project)}`, {
    method: 'POST',
    body: JSON.stringify(body),
  })

export type OperationsOverview = {
  runbook_count: number
  executions_24h: number
  showback_projects: number
  compliance_grade: string
  summary: string
}

export type OpsRunbookCatalogItem = {
  id: string
  incident: string
  title: string
  category: string
  severity: string
  auto_trigger?: string | null
  enabled: boolean
}

export type OpsRunbookExecution = {
  id: string
  incident: string
  status: string
  steps_json: unknown
  actor?: string | null
  summary: string
  created_at: string
}

export type OpsShowbackOverview = {
  lines: Array<{
    project_name: string
    cost_usd: number
    compliance_grade: string
    vm_count: number
    notes: string
  }>
  total_cost_usd: number
  fleet_grade: string
  summary: string
}

export const getOperationsOverview = () =>
  platformFetch<OperationsOverview>('/api/v1/operations/overview')

export const listOpsRunbooks = () =>
  platformFetch<OpsRunbookCatalogItem[]>('/api/v1/operations/runbooks')

export const listOpsRunbookExecutions = (limit = 20) =>
  platformFetch<OpsRunbookExecution[]>(`/api/v1/operations/executions?limit=${limit}`)

export const executeOpsRunbook = (incident: string, context: Record<string, unknown> = {}) =>
  platformFetch<{
    execution_id: string
    incident: string
    title: string
    steps: string[]
    commands: string[]
    summary: string
  }>(`/api/v1/operations/runbooks/${encodeURIComponent(incident)}/execute`, {
    method: 'POST',
    body: JSON.stringify({ context }),
  })

export const getOpsShowback = () =>
  platformFetch<OpsShowbackOverview>('/api/v1/operations/showback')

export type SdkPackageInfo = {
  path: string
  version: string
  install: string
  resources: string[]
}

export type TerraformResourceSchema = {
  name: string
  kind: string
  api_path: string
  attributes: string[]
}

export type DeveloperOverview = {
  openapi_url: string
  sdk_typescript: SdkPackageInfo
  terraform: {
    provider_source: string
    examples_path: string
    resources: TerraformResourceSchema[]
  }
  summary: string
}

export type SloStatusItem = {
  name: string
  target: string
  objective_pct: number
  current_pct: number
  burn_rate: number
  status: string
  description: string
}

export type ObservabilityOverview = {
  slos: SloStatusItem[]
  trace_count_1h: number
  p95_latency_ms: number
  summary: string
}

export type ApiTraceSpan = {
  id: string
  method: string
  path: string
  status_code: number
  duration_ms: number
  recorded_at: string
}

export const getDeveloperOverview = () =>
  platformFetch<DeveloperOverview>('/api/v1/developer/overview')

export const getTerraformSchema = () =>
  platformFetch<TerraformResourceSchema[]>('/api/v1/developer/terraform/schema')

export const getObservabilityOverview = () =>
  platformFetch<ObservabilityOverview>('/api/v1/observability/overview')

export const listApiTraces = (limit = 50) =>
  platformFetch<ApiTraceSpan[]>(`/api/v1/observability/traces?limit=${limit}`)

export const listPlatformNetworks = () => platformFetch<PlatformNetwork[]>('/api/v1/networks')
export const discoverPlatformNetworks = () =>
  platformFetch<{ imported: number; networks: PlatformNetwork[] }>('/api/v1/networks/discover', {
    method: 'POST',
    body: '{}',
  })
export const createPlatformNetwork = (body: {
  name: string
  vlan_id?: number
  bridge?: string
  segment_id?: string
  firewall_profile?: string
}) =>
  platformFetch<PlatformNetwork>('/api/v1/networks', { method: 'POST', body: JSON.stringify(body) })
export const deletePlatformNetwork = (id: string) => platformFetch(`/api/v1/networks/${id}`, { method: 'DELETE' })

export const getNetworkSegmentsOverview = () =>
  platformFetch<NetworkSegmentsOverview>('/api/v1/network/segments/overview')

export const createNetworkSegment = (body: {
  name: string
  tier: string
  cidr: string
  east_west_default?: string
  firewall_profile?: string
  gitops_namespace?: string
}) =>
  platformFetch('/api/v1/network/segments', { method: 'POST', body: JSON.stringify(body) })

export const listIpamPools = () => platformFetch<IpamPoolRow[]>('/api/v1/network/ipam/pools')

export const allocateIpam = (segmentId: string, body?: { hostname?: string; network_id?: string }) =>
  platformFetch<IpamAllocation>(`/api/v1/network/segments/${segmentId}/ipam/allocate`, {
    method: 'POST',
    body: JSON.stringify(body ?? {}),
  })

export const getHostLldp = (hostId: string) =>
  platformFetch<HostLldpInventory>(`/api/v1/hosts/${hostId}/lldp`)

export type HostLinuxObservability = {
  pressure?: {
    cpu?: { some: number; full: number; available?: boolean }
    memory?: { some: number; full: number; available?: boolean }
    io?: { some: number; full: number; available?: boolean }
    available?: boolean
  }
  thermal?: Array<{ sensor: string; label: string; temp_celsius: number; critical_celsius?: number }>
  smart?: Array<{ device: string; passed: boolean; summary: string; probed: boolean }>
  disk_io?: Array<{ device: string; read_bytes: number; write_bytes: number }>
}

export type HostNetworkDiag = {
  systemd_networkd_active?: boolean
  resolved_active?: boolean
  interfaces?: Array<{ name: string; state?: string; addresses?: string[] }>
  networkd_recent_logs?: string
  resolved_recent_logs?: string
}

export type HostLinuxAuditReport = {
  auditd_active?: boolean
  auditd_enabled?: boolean
  rules_count?: number
  recent_events?: number
  summary?: string
}

export const getHostLinuxObservability = (hostId: string) =>
  platformFetch<HostLinuxObservability>(`/api/v1/hosts/${hostId}/linux/observability`)

export const getHostNetworkDiag = (hostId: string) =>
  platformFetch<HostNetworkDiag>(`/api/v1/hosts/${hostId}/linux/network-diag`)

export const getHostLinuxAudit = (hostId: string) =>
  platformFetch<HostLinuxAuditReport>(`/api/v1/hosts/${hostId}/linux/audit`)

export type VmGuestHealthReport = {
  vm_id: string
  vm_name: string
  agent_reachable: boolean
  healthy: boolean
  os_pretty_name: string
  guest_ip: string
  guest_hostname: string
  issues: string[]
  summary: string
}

export type VmGuestServicesReport = {
  vm_id: string
  vm_name: string
  agent_reachable: boolean
  services: Array<{ name: string; status: string; detail: string }>
  summary: string
}

export const getVmGuestHealth = (vmId: string) =>
  platformFetch<VmGuestHealthReport>(`/api/v1/vms/${vmId}/guest/health`)

export const getVmGuestServices = (vmId: string) =>
  platformFetch<VmGuestServicesReport>(`/api/v1/vms/${vmId}/guest/services`)

export type OsDiagnoseHypothesis = {
  title: string
  confidence: number
  evidence: string
  action: string
}

export type OsDiagnoseAction = {
  label: string
  action: string
  detail: string
}

export type HostOsDiagnoseReport = {
  host_id: string
  hostname: string
  query: string
  summary: string
  hypotheses: OsDiagnoseHypothesis[]
  fix_actions: OsDiagnoseAction[]
}

export type VmOsDiagnoseReport = {
  vm_id: string
  vm_name: string
  query: string
  summary: string
  guest_healthy: boolean
  hypotheses: OsDiagnoseHypothesis[]
  fix_actions: OsDiagnoseAction[]
}

export const diagnoseHost = (hostId: string, query?: string) =>
  platformFetch<HostOsDiagnoseReport>(`/api/v1/hosts/${hostId}/diagnose`, {
    method: 'POST',
    body: JSON.stringify({ query }),
  })

export const diagnoseVm = (vmId: string, query?: string) =>
  platformFetch<VmOsDiagnoseReport>(`/api/v1/vms/${vmId}/diagnose`, {
    method: 'POST',
    body: JSON.stringify({ query }),
  })

export type FleetDesktopOverview = {
  summary: string
  zeus_status: string
  zeus_highlights: string[]
  slo_count: number
  slo_breach_count: number
  p95_latency_ms: number
  hosts_online: number
  hosts_total: number
  vm_count: number
  active_tasks: number
  failed_tasks_24h: number
  unread_notifications: number
  pressure_hosts: number
  linux_summary: string
}

export const getFleetDesktop = () =>
  platformFetch<FleetDesktopOverview>('/api/v1/fleet/desktop')

export type MissionHost = {
  id: string
  hostname: string
  address: string
  state: string
  maintenance_mode: boolean
  vm_count: number
  cpu_percent: number
  memory_used_mib: number
  memory_total_mib: number
  site: string
  rack: string
  rack_u?: number | null
}

export type FleetMissionOverview = {
  sites: Array<{ name: string; racks: Array<{ name: string; hosts: MissionHost[] }> }>
  unassigned_hosts: MissionHost[]
  summary: {
    hosts: number
    vms: number
    hosts_online: number
    health_pct: number
  }
}

export const getFleetMission = () =>
  platformFetch<FleetMissionOverview>('/api/v1/fleet/mission')

export type GpuProfileKind = 'mig' | 'vgpu' | 'passthrough' | 'cuda' | 'unknown'

export type GpuHostItem = {
  host_id: string
  hostname: string
  site: string
  rack: string
  state: string
  gpu_capable: boolean
  profile: GpuProfileKind
  model_hint: string
  vm_count: number
  gpu_vm_count: number
  vgpu_slices: number
  cuda_ready: boolean
}

export type GpuVmItem = {
  vm_id: string
  vm_name: string
  host_id?: string | null
  hostname?: string | null
  observed_state: string
  profile: GpuProfileKind
  tags: string[]
}

export type FleetGpuOverview = {
  summary: string
  gpu_host_count: number
  gpu_vm_count: number
  cuda_ready_hosts: number
  mig_hosts: number
  vgpu_hosts: number
  hosts: GpuHostItem[]
  vms: GpuVmItem[]
  profiles: Array<{ kind: GpuProfileKind; label: string; host_count: number; vm_count: number }>
}

export const getFleetGpu = () =>
  platformFetch<FleetGpuOverview>('/api/v1/fleet/gpu')

export type MaintenanceMissionStepId =
  | 'scan'
  | 'assess'
  | 'schedule'
  | 'enter_maintenance'
  | 'evacuate'
  | 'apply_preview'
  | 'verify_exit'

export type MaintenanceStepStatus = 'pending' | 'ready' | 'done' | 'blocked' | 'skipped'

export type MaintenanceMissionStep = {
  id: MaintenanceMissionStepId
  label: string
  status: MaintenanceStepStatus
  detail?: string | null
}

export type MaintenanceMissionHost = {
  host_id: string
  hostname: string
  state: string
  maintenance_mode: boolean
  validation_status: string
  pending_packages?: number | null
  reboot_required: boolean
  agent_drift: boolean
  update_summary?: string | null
  recommended_step: MaintenanceMissionStepId
  steps: MaintenanceMissionStep[]
  blockers: string[]
}

export type FleetMaintenanceMissionOverview = {
  summary: string
  hosts_with_updates: number
  hosts_in_maintenance: number
  pending_schedules: number
  hosts: MaintenanceMissionHost[]
}

export const getFleetMaintenanceMission = () =>
  platformFetch<FleetMaintenanceMissionOverview>('/api/v1/fleet/maintenance-mission')

export type FleetDnaPillar = {
  id: string
  label: string
  score: number
  detail: string
}

export type FleetDnaOverview = {
  score: number
  grade: string
  summary: string
  pillars: FleetDnaPillar[]
}

export const getFleetDna = () =>
  platformFetch<FleetDnaOverview>('/api/v1/fleet/dna')

export type FleetLinuxHostItem = {
  host_id: string
  hostname: string
  io_pressure_pct: number
  thermal_max_c: number
  smart_failures: number
  status: string
}

export type FleetLinuxHealthOverview = {
  hosts_scanned: number
  pressure_hosts: number
  thermal_alerts: number
  smart_alerts: number
  hosts: FleetLinuxHostItem[]
  summary: string
}

export const getFleetLinuxHealth = () =>
  platformFetch<FleetLinuxHealthOverview>('/api/v1/fleet/linux-health')

export type VmActivityItem = {
  vm_id: string
  vm_name: string
  host_id?: string | null
  observed_state: string
  cpu_percent: number
  memory_used_mib: number
  memory_mib: number
}

export type HostActivityItem = {
  host_id: string
  hostname: string
  state: string
  cpu_percent: number
  memory_percent: number
  vm_count: number
  io_pressure_pct: number
  thermal_max_c: number
  status: string
}

export type FleetActivityOverview = {
  summary: string
  top_vms: VmActivityItem[]
  hosts: HostActivityItem[]
  pressure_hosts: number
  running_vms: number
}

export const getFleetActivity = () =>
  platformFetch<FleetActivityOverview>('/api/v1/fleet/activity')

export type FleetBackupEvent = {
  kind: string
  id: string
  vm_id: string
  vm_name: string
  label: string
  status: string
  created_at: string
}

export type FleetBackupOverview = {
  summary: string
  total_events: number
  backups_completed_24h: number
  backups_failed_24h: number
  snapshots_total: number
  vms_with_backup_7d: number
  recent: FleetBackupEvent[]
}

export const getFleetBackups = () =>
  platformFetch<FleetBackupOverview>('/api/v1/fleet/backups')

export type SmartFolder = {
  id: string
  label: string
  count: number
  icon: string
}

export type FleetFinderOverview = {
  summary: string
  smart_folders: SmartFolder[]
  tags: Array<{ tag: string; count: number }>
  projects: Array<{ project: string; count: number }>
}

export const getFleetFinder = () =>
  platformFetch<FleetFinderOverview>('/api/v1/fleet/finder')

export type FleetNetworkSegment = {
  id: string
  name: string
  tier: string
  cidr: string
  east_west_default: string
  vm_count: number
  network_count: number
  micro_seg_grade: string
}

export type FleetNetworkOverview = {
  summary: string
  network_count: number
  segment_count: number
  ipam_pool_count: number
  hosts_online: number
  deny_east_west_count: number
  segments: FleetNetworkSegment[]
}

export const getFleetNetwork = () =>
  platformFetch<FleetNetworkOverview>('/api/v1/fleet/network')

export type FleetStoragePoolItem = {
  id: string
  name: string
  storage_class: string
  used_gib: number
  capacity_gib: number
  used_pct: number
  tier_name?: string | null
  status: string
}

export type FleetSmartDiskItem = {
  host_id: string
  hostname: string
  device: string
  passed: boolean
  summary: string
}

export type FleetStorageOverview = {
  summary: string
  pool_count: number
  tier_count: number
  total_capacity_gib: number
  total_used_gib: number
  pools_over_85_pct: number
  smart_failure_count: number
  smart_hosts_affected: number
  pools: FleetStoragePoolItem[]
  smart_disks: FleetSmartDiskItem[]
}

export const getFleetStorage = () =>
  platformFetch<FleetStorageOverview>('/api/v1/fleet/storage')

export type FleetConsoleEntry = {
  source: string
  id: string
  severity: string
  actor?: string | null
  action: string
  message: string
  resource_type?: string | null
  created_at: string
}

export type FleetConsoleOverview = {
  summary: string
  total_24h: number
  audit_24h: number
  events_24h: number
  tasks_failed_24h: number
  audit_count: number
  event_count: number
  task_count: number
  entries: FleetConsoleEntry[]
}

export const getFleetConsole = () =>
  platformFetch<FleetConsoleOverview>('/api/v1/fleet/console')

export type FleetHostUpdateItem = {
  host_id: string
  hostname: string
  agent_version: string
  agent_update_available: boolean
  backend: string
  pending_count?: number | null
  summary?: string | null
  reboot_required: boolean
  status: string
}

export type FleetUpdatesOverview = {
  summary: string
  recommended_agent: string
  hosts_scanned: number
  hosts_with_updates: number
  hosts_reboot_required: number
  agent_drift_count: number
  total_pending_packages: number
  hosts: FleetHostUpdateItem[]
}

export const getFleetUpdates = () =>
  platformFetch<FleetUpdatesOverview>('/api/v1/fleet/updates')

export type FleetKeychainEntry = {
  kind: string
  id: string
  name: string
  status: string
  summary: string
}

export type FleetKeychainOverview = {
  summary: string
  vault_providers: number
  vault_connected: number
  mfa_policies: number
  mfa_enrolled_users: number
  air_gap_bundles: number
  api_keys: number
  disconnected_vaults: number
  entries: FleetKeychainEntry[]
}

export const getFleetKeychain = () =>
  platformFetch<FleetKeychainOverview>('/api/v1/fleet/keychain')

export type FleetUserItem = {
  id: string
  username: string
  role: string
}

export type FleetWorkspaceItem = {
  name: string
  vm_count: number
  network_isolation: string
  enforce_quotas: boolean
  quota_status: string
}

export type FleetUsersOverview = {
  summary: string
  user_count: number
  admin_count: number
  operator_count: number
  viewer_count: number
  workspace_count: number
  workspaces_enforced: number
  users: FleetUserItem[]
  workspaces: FleetWorkspaceItem[]
}

export const getFleetUsers = () =>
  platformFetch<FleetUsersOverview>('/api/v1/fleet/users')

export type FleetShortcutItem = {
  id: string
  name: string
  description: string
  actions: string[]
  vm_count: number
  action_count: number
}

export type FleetShortcutsOverview = {
  summary: string
  blueprint_count: number
  total_vms_covered: number
  runbook_count: number
  executions_24h: number
  shortcuts: FleetShortcutItem[]
}

export const getFleetShortcuts = () =>
  platformFetch<FleetShortcutsOverview>('/api/v1/fleet/shortcuts')

export type FleetSpaceItem = {
  name: string
  vm_count: number
  running_count: number
  stopped_count: number
  host_count: number
  network_isolation: string
  enforce_quotas: boolean
  quota_status: string
}

export type FleetSpacesOverview = {
  summary: string
  space_count: number
  total_vms: number
  running_vms: number
  spaces: FleetSpaceItem[]
}

export const getFleetSpaces = () =>
  platformFetch<FleetSpacesOverview>('/api/v1/fleet/spaces')

export type FleetGeneralWallpaperOption = { id: string; label: string }
export type FleetGeneralDockOption = { path: string; label: string }

export type FleetGeneralOverview = {
  summary: string
  cluster_name: string
  controller_version: string
  hosts_online: number
  hosts_total: number
  vm_count: number
  active_tasks: number
  wallpaper_options: FleetGeneralWallpaperOption[]
  dock_defaults: FleetGeneralDockOption[]
  settings_url: string
}

export const getFleetGeneral = () =>
  platformFetch<FleetGeneralOverview>('/api/v1/fleet/general')

export const exportNetworkSegmentsGitops = () =>
  platformFetch('/api/v1/network/segments/gitops/export')

export interface SegmentConnectivityCell {
  source: string
  destination: string
  port: number
  protocol: string
  verdict: string
  reason: string
}

export interface SegmentConnectivityResult {
  segment_id: string
  segment_name: string
  vm_count: number
  rules: number
  matrix: {
    allows: SegmentConnectivityCell[]
    blocks: SegmentConnectivityCell[]
    warnings: string[]
    summary: string
  }
}

export const bindNetworkToSegment = (segmentId: string, networkId: string) =>
  platformFetch<{ bound: boolean }>(`/api/v1/network/segments/${segmentId}/bind/${networkId}`, {
    method: 'POST',
    body: '{}',
  })

export const patchPlatformNetwork = (id: string, body: { segment_id?: string; vlan_id?: number; bridge?: string }) =>
  platformFetch<PlatformNetwork>(`/api/v1/networks/${id}`, { method: 'PATCH', body: JSON.stringify(body) })

export const simulateSegmentConnectivity = (segmentId: string) =>
  platformFetch<SegmentConnectivityResult>(`/api/v1/network/segments/${segmentId}/connectivity`, {
    method: 'POST',
    body: '{}',
  })

export interface MarketplacePlugin {
  id: string
  slug: string
  name: string
  category: string
  description: string
  version: string
  author: string
  featured: boolean
  installed: boolean
}

export interface MarketplaceOverview {
  plugins: MarketplacePlugin[]
  installed_count: number
  summary: string
}

export const getMarketplacePlugins = () =>
  platformFetch<MarketplaceOverview>('/api/v1/marketplace/plugins')

export const installMarketplacePlugin = (slug: string) =>
  platformFetch<{ slug: string; name: string; installed: boolean; summary: string }>(
    `/api/v1/marketplace/plugins/${encodeURIComponent(slug)}/install`,
    { method: 'POST', body: '{}' },
  )

export const uninstallMarketplacePlugin = (slug: string) =>
  platformFetch<{ slug: string; name: string; installed: boolean; summary: string }>(
    `/api/v1/marketplace/plugins/${encodeURIComponent(slug)}/uninstall`,
    { method: 'POST', body: '{}' },
  )

export const publishMarketplacePlugin = (body: {
  slug: string
  name: string
  category: string
  description: string
  version: string
  author?: string
  featured?: boolean
}) =>
  platformFetch<MarketplacePlugin>('/api/v1/marketplace/plugins', {
    method: 'POST',
    body: JSON.stringify(body),
  })
export const getClusterSummary = () => platformFetch<ClusterSummary>('/api/v1/cluster')
export const listMigrationJobs = () => platformFetch<MigrationJob[]>('/api/v1/migrations')
export const listFenceEvents = () => platformFetch<FenceEvent[]>('/api/v1/fence/events')
export const listEnrollmentTokens = () => platformFetch<EnrollmentTokenRow[]>('/api/v1/enrollment/tokens')
export const deleteTemplate = (name: string, version: string) =>
  platformFetch(`/api/v1/templates/${encodeURIComponent(name)}/${encodeURIComponent(version)}`, { method: 'DELETE' })
export const listVmSnapshots = (vmId: string) => platformFetch<SnapshotRecord[]>(`/api/v1/vms/${vmId}/snapshots`)
export const createVmSnapshot = (vmId: string, name: string) =>
  platformFetch<{ task_id: string }>(`/api/v1/vms/${vmId}/snapshots`, { method: 'POST', body: JSON.stringify({ name }) })
export const listVmBackups = (vmId: string) => platformFetch<BackupRecord[]>(`/api/v1/vms/${vmId}/backups`)

export interface BackupTimelineEntry {
  kind: string
  id: string
  vm_id: string
  vm_name: string
  label: string
  status: string
  created_at: string
}

export const listBackupTimeline = () => platformFetch<BackupTimelineEntry[]>('/api/v1/backups/timeline')
export const createVmBackup = (vmId: string) =>
  platformFetch<{ task_id: string }>(`/api/v1/vms/${vmId}/backups`, { method: 'POST', body: JSON.stringify({}) })
export const refreshPlacement = () => platformFetch<PlacementRecommendation[]>('/api/v1/placement/refresh', { method: 'POST' })
export const getPlatformVm = (id: string) => platformFetch<PlatformVm>(`/api/v1/vms/${id}`)

export const adoptPlatformVm = (id: string) =>
  platformFetch<PlatformVm>(`/api/v1/vms/${id}/adopt`, { method: 'POST' })

export const getPlatformVmMetrics = (id: string) =>
  platformFetch<{ vm_id: string; cpu_percent: number; memory_used_mib: number; updated_at: string }>(
    `/api/v1/vms/${id}/metrics`,
  )

export interface ContentImage {
  id: string
  name: string
  kind: string
  path: string
  size_gib: number
  status: string
  category?: string
  description?: string
  submitted_by?: string | null
  approved_by?: string | null
  approved_at?: string | null
  rejected_reason?: string | null
  created_at: string
}

export const listContentImages = (params?: { status?: string }) => {
  const q = params?.status ? `?status=${encodeURIComponent(params.status)}` : ''
  return platformFetch<ContentImage[]>(`/api/v1/content/images${q}`)
}

export const createContentImage = (body: {
  name: string
  kind?: string
  path: string
  size_gib?: number
  category?: string
  description?: string
}) => platformFetch<ContentImage>('/api/v1/content/images', { method: 'POST', body: JSON.stringify(body) })

export const approveContentImage = (id: string) =>
  platformFetch<ContentImage>(`/api/v1/content/images/${id}/approve`, { method: 'POST', body: '{}' })

export const rejectContentImage = (id: string, reason?: string) =>
  platformFetch<ContentImage>(`/api/v1/content/images/${id}/reject`, {
    method: 'POST',
    body: JSON.stringify({ reason }),
  })

export const attachVmDisk = (id: string, body: { disk_path: string; target_dev?: string; size_gib?: number }) =>
  platformFetch<{ task_id: string }>(`/api/v1/vms/${id}/disks/attach`, {
    method: 'POST',
    body: JSON.stringify(body),
  })

export const listPlatformTemplates = () => platformFetch<PlatformTemplate[]>('/api/v1/templates')
export const listMarketplaceTemplates = () => platformFetch<PlatformTemplate[]>('/api/v1/templates/marketplace')
export const seedDefaultTemplates = () =>
  platformFetch<{ inserted: number; templates: PlatformTemplate[] }>('/api/v1/templates/seed', {
    method: 'POST',
    body: '{}',
  })
export const getTemplateReadiness = (name: string, version: string) =>
  platformFetch<{
    disk_exists: boolean
    host_online: number
    cloud_init: boolean
    ready: boolean
    remediation: string
    source_disk: string
  }>(`/api/v1/templates/${encodeURIComponent(name)}/${encodeURIComponent(version)}/readiness`)
export const getPlatformHealth = () => platformFetch<{ status: string; leader?: boolean; controller_id?: string }>('/api/v1/health')

export const createPlatformVm = (body: unknown) =>
  platformFetch<{ task_id: string }>('/api/v1/vms', { method: 'POST', body: JSON.stringify(body) })

export type CreatePlatformVmBody = {
  api_version: string
  kind: string
  metadata: { name: string; project?: string; labels?: Record<string, string> }
  spec: Record<string, unknown>
  host_id?: string
  tags?: string[]
  desired_state?: string
}

export const vmPower = (id: string, action: 'start' | 'stop' | 'reboot') =>
  platformFetch<{ task_id: string }>(`/api/v1/vms/${id}/${action}`, { method: 'POST' })

export const vmDelete = (id: string, confirmed = false) =>
  platformFetch<{ task_id: string }>(`/api/v1/vms/${id}/delete`, {
    method: 'POST',
    body: JSON.stringify(confirmed ? { confirmed: true } : {}),
  })

export const installGuestTools = (id: string) =>
  platformFetch<{ task_id: string }>(`/api/v1/vms/${id}/guest-tools/install`, { method: 'POST', body: '{}' })

export const vmMigrate = (id: string, dest_host_id: string, live = true) =>
  platformFetch<{ task_id: string }>(`/api/v1/vms/${id}/migrate`, {
    method: 'POST',
    body: JSON.stringify({ dest_host_id, live }),
  })

export const vmClone = (id: string, new_name: string) =>
  platformFetch<{ task_id: string }>(`/api/v1/vms/${id}/clone`, {
    method: 'POST',
    body: JSON.stringify({ new_name }),
  })

export const syncHost = (id: string) =>
  platformFetch<{ task_id: string }>(`/api/v1/hosts/${id}/sync`, { method: 'POST' })

export const validateHost = (id: string) =>
  platformFetch<{ ok: boolean; checks: Array<{ name: string; passed: boolean; message: string; remediation?: string }> }>(
    `/api/v1/hosts/${id}/validate`,
  )

export const enqueueValidateHost = (id: string) =>
  platformFetch<{ task_id: string }>(`/api/v1/hosts/${id}/validate`, { method: 'POST' })

export const getSupportBundle = () => platformFetch<Record<string, unknown>>('/api/v1/support/bundle')

export const getUpgradeMatrix = () =>
  platformFetch<{ controller_version: string; recommended_agent: string; min_agent: string; notes: string }>(
    '/api/v1/upgrade/matrix',
  )

export const upgradeHostAgent = (id: string, target_version?: string) =>
  platformFetch<{ task_id: string }>(`/api/v1/hosts/${id}/upgrade`, {
    method: 'POST',
    body: JSON.stringify({ target_version: target_version ?? '' }),
  })

export const listProjectQuotas = () =>
  platformFetch<Array<{ project: string; max_vms: number; max_vcpu: number; max_memory_mib: number; max_storage_gib: number }>>(
    '/api/v1/policy/quotas',
  )

export interface PolicyRule {
  id: string
  name: string
  enabled: boolean
  rule_json: Record<string, unknown>
}

export const listPolicyRules = () => platformFetch<PolicyRule[]>('/api/v1/policy/rules')

export interface HostLinuxUpdates {
  host_id: string
  summary: string
  packages: Array<{ name: string; current: string; available: string; security?: boolean }>
}

export const getHostLinuxUpdates = (hostId: string) =>
  platformFetch<HostLinuxUpdates>(`/api/v1/hosts/${hostId}/linux/updates`)

export interface VmMigrationRecord {
  id: string
  vm_id: string
  source_host: string
  dest_host: string
  status: string
  started_at: string
  finished_at?: string | null
}

export const getVmMigrations = (vmId: string) =>
  platformFetch<VmMigrationRecord[]>(`/api/v1/vms/${vmId}/migrations`)

export const patchStoragePool = (id: string, body: { path?: string; capacity_gib?: number }) =>
  platformFetch<StoragePool>(`/api/v1/storage/pools/${id}`, { method: 'PATCH', body: JSON.stringify(body) })

export const emergencyUnlockNetworkSegment = (id: string) =>
  platformFetch<{ segment_id: string; unlocked: boolean; summary: string }>(
    `/api/v1/network/segments/${id}/emergency-unlock`,
    { method: 'POST', body: '{}' },
  )

export const getAirGapBundle = (id: string) =>
  platformFetch<AirGapBundle>(`/api/v1/enterprise/air-gap/bundles/${id}`)

export const markAllNotificationsDelivered = async (limit = 200) => {
  const rows = await listNotifications(true)
  const batch = rows.slice(0, limit)
  await Promise.all(batch.map((r) => markNotificationDelivered(r.id)))
  return batch.length
}

export const hostMaintenance = (id: string, action: 'enter' | 'exit', evacuate = true) =>
  platformFetch<{ task_id: string }>(`/api/v1/hosts/${id}/maintenance`, {
    method: 'POST',
    body: JSON.stringify({ action, evacuate }),
  })

export const createEnrollmentToken = (ttl_hours = 24) =>
  platformFetch<EnrollmentToken>('/api/v1/enrollment/tokens', {
    method: 'POST',
    body: JSON.stringify({ ttl_hours }),
  })

export const createTemplate = (body: {
  name: string
  version: string
  source_disk: string
  cloud_init?: boolean
  os_family?: string
  category?: string
  description?: string
  featured?: boolean
  marketplace?: boolean
  icon?: string
}) => platformFetch<PlatformTemplate>('/api/v1/templates', { method: 'POST', body: JSON.stringify(body) })

export const getVmConsole = (id: string) =>
  platformFetch<PlatformConsoleInfo>(`/api/v1/vms/${id}/console`)

export const getHaStatus = () => platformFetch<HaStatusResponse>('/api/v1/ha/status')

export const setVmHa = (id: string, body: Partial<HaPolicy> & { enabled: boolean }) =>
  platformFetch<{ vm_id: string; enabled: boolean }>(`/api/v1/vms/${id}/ha`, {
    method: 'POST',
    body: JSON.stringify({ restart_attempts: 3, restart_priority: 'medium', fence_on_failure: false, anti_affinity: false, ...body }),
  })

export const getPlacementRecommendations = () =>
  platformFetch<PlacementRecommendation[]>('/api/v1/placement/recommendations')

export const migratePrecheck = (vmId: string, dest_host_id: string, live = true) =>
  platformFetch<MigratePrecheckResult>(`/api/v1/vms/${vmId}/migrate/precheck`, {
    method: 'POST',
    body: JSON.stringify({ dest_host_id, live }),
  })

export const getClusterSettings = () =>
  platformFetch<ClusterSettings>('/api/v1/cluster/settings')

export const patchClusterSettings = (body: Partial<ClusterSettings>) =>
  platformFetch<ClusterSettings>('/api/v1/cluster/settings', {
    method: 'PATCH',
    body: JSON.stringify(body),
  })

export const createFromTemplate = (body: {
  template_ref: string
  name: string
  memory?: string
  host_id?: string
  cloud_init_user?: string
  cloud_init_password?: string
  cloud_init_ssh_pubkey?: string
}) =>
  platformFetch<{ task_id: string }>('/api/v1/vms/from-template', {
    method: 'POST',
    body: JSON.stringify(body),
  })

export interface PlacementRecommendation {
  vm_id: string
  vm_name: string
  from_host_id: string
  from_host_name: string
  to_host_id: string
  to_host_name: string
  reason: string
  score: number
}

export interface MigratePrecheckResult {
  ok: boolean
  checks: { name: string; passed: boolean; message: string; remediation?: string }[]
}

export interface HaStatusResponse {
  status: { enabled_vms: number; offline_hosts: number; recent_events: number }
  events: { id: string; action: string; message: string; created_at: string }[]
}

export interface ClusterSettings {
  drs_auto_migrate: boolean
  drs_cpu_threshold: number
  ha_enabled: boolean
  placement_policy: string
  inventory_sync_interval_secs: number
  require_vm_delete_approval?: boolean
  firewall_approval_sla_hours?: number
  finops_vcpu_hour_usd?: number
  finops_gib_hour_usd?: number
}

export interface ClusterSummary {
  id: string
  name: string
  host_count: number
  vm_count: number
  running_vms: number
  offline_hosts: number
  settings: ClusterSettings
}

export interface HaPolicy {
  enabled: boolean
  restart_attempts: number
  restart_priority: string
  fence_on_failure: boolean
  anti_affinity: boolean
}

export interface PlatformEvent {
  id: string
  kind: string
  message: string
  created_at: string
}

export interface AuditLog {
  id: string
  actor: string
  action: string
  resource_type?: string | null
  created_at: string
}

export interface StoragePool {
  id: string
  name: string
  storage_class: string
  backend: string
  path?: string | null
  capacity_gib: number
  used_gib: number
  tier_id?: string | null
}

export interface StorageTierOverview {
  id: string
  name: string
  tier_class: string
  iops_tier: string
  replication: string
  snapshot_retention_days: number
  backup_rpo_hours: number
  description: string
  pool_count: number
  capacity_gib: number
  used_gib: number
}

export interface StorageTiersOverview {
  tiers: StorageTierOverview[]
  summary: string
}

export interface StorageBackupSla {
  id: string
  pool_id: string
  pool_name: string
  tier_name?: string | null
  rpo_hours: number
  rto_hours: number
  retention_days: number
  last_backup_at?: string | null
  compliance_grade: string
}

export interface StorageBackupSlaOverview {
  policies: StorageBackupSla[]
  summary: string
}

export interface PlatformNetwork {
  id: string
  name: string
  backend: string
  vlan_id?: number | null
  bridge?: string | null
  segment_id?: string | null
}

export interface NetworkSegmentOverview {
  id: string
  name: string
  tier: string
  cidr: string
  east_west_default: string
  firewall_profile?: string | null
  gitops_namespace: string
  network_count: number
  vm_count: number
  micro_seg_grade: string
  micro_seg_score: number
}

export interface NetworkSegmentsOverview {
  segments: NetworkSegmentOverview[]
  summary: string
}

export interface IpamPoolRow {
  id: string
  segment_id: string
  segment_name: string
  cidr: string
  gateway?: string | null
  next_offset: number
  reservation_count: number
}

export interface IpamAllocation {
  reservation_id: string
  pool_id: string
  ip_address: string
  hostname?: string | null
  segment_id: string
  segment_name: string
}

export interface HostLldpNeighbor {
  local_interface: string
  chassis_id: string
  system_name: string
  port_id: string
  port_description: string
  system_description: string
  capabilities: string
}

export interface HostLldpInventory {
  source: string
  neighbors: HostLldpNeighbor[]
  raw_text: string
  summary: string
}

export interface MigrationJob {
  id: string
  vm_id: string
  source_host_id: string
  dest_host_id: string
  live: boolean
  status: string
  progress: number
  created_at: string
}

export interface FenceEvent {
  id: string
  host_id: string
  action: string
  success: boolean
  message?: string | null
  created_at: string
}

export interface EnrollmentTokenRow {
  token: string
  expires_at?: string | null
  used_at?: string | null
  created_at: string
}

export interface SnapshotRecord {
  id: string
  vm_id: string
  name: string
  status: string
  message?: string | null
  created_at: string
}

export interface BackupRecord {
  id: string
  vm_id: string
  backup_type: string
  status: string
  message?: string | null
  created_at: string
  restore_status?: string
}

export const retryTask = (id: string) =>
  platformFetch<{ task_id: string }>(`/api/v1/tasks/${id}/retry`, { method: 'POST' })

export const patchVm = (id: string, body: { desired_state?: string; project?: string; tags?: string[] }) =>
  platformFetch<PlatformVm>(`/api/v1/vms/${id}`, { method: 'PATCH', body: JSON.stringify(body) })

export const getVmDisks = (id: string) => platformFetch<VmDiskRow[]>(`/api/v1/vms/${id}/disks`)

export const revertVmSnapshot = (vmId: string, name: string) =>
  platformFetch<{ task_id: string }>(`/api/v1/vms/${vmId}/snapshots/${encodeURIComponent(name)}/revert`, { method: 'POST' })

export const cloneVmSnapshot = (
  vmId: string,
  name: string,
  newName: string,
  revertSource = false,
  destHostId?: string,
  live = true,
) =>
  platformFetch<{ task_id: string }>(`/api/v1/vms/${vmId}/snapshots/${encodeURIComponent(name)}/clone`, {
    method: 'POST',
    body: JSON.stringify({
      new_name: newName,
      revert_source: revertSource,
      dest_host_id: destHostId || undefined,
      live,
    }),
  })

export const createVmBackupWithTarget = (vmId: string, targetId?: string) =>
  platformFetch<{ task_id: string }>(`/api/v1/vms/${vmId}/backups`, {
    method: 'POST',
    body: JSON.stringify({ target_id: targetId || undefined }),
  })

export interface BackupTarget {
  id: string
  name: string
  kind: string
  config_json: Record<string, unknown>
}

export const listBackupTargets = () => platformFetch<BackupTarget[]>('/api/v1/backup-targets')

export const createBackupTarget = (body: { name: string; kind?: string; config_json?: Record<string, unknown> }) =>
  platformFetch<BackupTarget>('/api/v1/backup-targets', { method: 'POST', body: JSON.stringify(body) })

export const upsertProjectQuota = (body: {
  project: string
  max_vms: number
  max_vcpu: number
  max_memory_mib: number
  max_storage_gib: number
}) => platformFetch('/api/v1/policy/quotas', { method: 'POST', body: JSON.stringify(body) })

export const getClusterLeadership = () =>
  platformFetch<{ controller_id: string; is_leader: boolean; holder_id: string; lease_until: string }>(
    '/api/v1/cluster/leadership',
  )

export const restoreVmBackup = (vmId: string, backupId: string) =>
  platformFetch<{ task_id: string }>(`/api/v1/vms/${vmId}/backups/${backupId}/restore`, { method: 'POST' })

export const patchHost = (id: string, body: {
  notes?: string
  tags?: string[]
  site?: string
  rack?: string
  rack_u?: number | null
  fence_method?: string
  ipmi_address?: string
  ipmi_username?: string
  ipmi_password?: string
}) =>
  platformFetch<PlatformHostDetail>(`/api/v1/hosts/${id}`, { method: 'PATCH', body: JSON.stringify(body) })

export const getOidcLoginUrl = () => `${getControllerBase()}/api/v1/auth/oidc/redirect`

export const deleteVmSnapshot = (vmId: string, name: string) =>
  platformFetch<{ task_id: string }>(`/api/v1/vms/${vmId}/snapshots/${encodeURIComponent(name)}`, { method: 'DELETE' })

export const listUsers = () => platformFetch<PlatformUser[]>('/api/v1/users')
export const getCurrentUser = () => platformFetch<PlatformUser>('/api/v1/users/me')
export const createUser = (body: { username: string; password: string; role?: string }) =>
  platformFetch<PlatformUser>('/api/v1/users', { method: 'POST', body: JSON.stringify(body) })
export const patchUser = (id: string, body: { username?: string; role?: string }) =>
  platformFetch<PlatformUser>(`/api/v1/users/${id}`, { method: 'PATCH', body: JSON.stringify(body) })
export const deleteUser = (id: string) =>
  platformFetch<{ deleted: boolean }>(`/api/v1/users/${id}`, { method: 'DELETE' })

export const revokeEnrollmentToken = (token: string) =>
  platformFetch<{ revoked: boolean }>(`/api/v1/enrollment/tokens/${encodeURIComponent(token)}`, { method: 'DELETE' })

export const toggleWebhook = (id: string) =>
  platformFetch<WebhookRow>(`/api/v1/webhooks/${id}/toggle`, { method: 'POST' })
export const deleteWebhook = (id: string) =>
  platformFetch<{ deleted: boolean }>(`/api/v1/webhooks/${id}`, { method: 'DELETE' })

export const patchCluster = (body: { name?: string }) =>
  platformFetch<ClusterSummary>('/api/v1/cluster', { method: 'PATCH', body: JSON.stringify(body) })

export const getOidcSettings = () => platformFetch<OidcSettings>('/api/v1/auth/oidc')
export const patchOidcSettings = (body: Partial<OidcSettings>) =>
  platformFetch<OidcSettings>('/api/v1/auth/oidc', { method: 'PATCH', body: JSON.stringify(body) })

export const getCpuCompatMatrix = () => platformFetch<CpuCompatRule[]>('/api/v1/cpu-compat')
export const patchCpuCompatMatrix = (rules: CpuCompatRule[]) =>
  platformFetch<CpuCompatRule[]>('/api/v1/cpu-compat', { method: 'PATCH', body: JSON.stringify({ rules }) })

export const listNotifications = (undelivered?: boolean) =>
  platformFetch<NotificationRow[]>(`/api/v1/notifications${undelivered ? '?undelivered=true' : ''}`)
export const markNotificationDelivered = (id: string) =>
  platformFetch<{ delivered: boolean }>(`/api/v1/notifications/${id}/deliver`, { method: 'POST' })

export const listApiKeys = () => platformFetch<ApiKeyRow[]>('/api/v1/api-keys')
export const createApiKey = (body: { name: string; role?: string }) =>
  platformFetch<{ id: string; name: string; role: string; token: string }>('/api/v1/api-keys', { method: 'POST', body: JSON.stringify(body) })
export const deleteApiKey = (id: string) =>
  platformFetch<{ deleted: boolean }>(`/api/v1/api-keys/${id}`, { method: 'DELETE' })

export interface MaintenanceSchedule {
  id: string
  host_id: string
  action: string
  evacuate: boolean
  run_at: string
  status: string
}

export const listMaintenanceSchedules = () => platformFetch<MaintenanceSchedule[]>('/api/v1/maintenance/schedules')
export const createMaintenanceSchedule = (body: { host_id: string; action?: string; evacuate?: boolean; run_at: string }) =>
  platformFetch<MaintenanceSchedule>('/api/v1/maintenance/schedules', { method: 'POST', body: JSON.stringify(body) })
export const deleteMaintenanceSchedule = (id: string) =>
  platformFetch<{ deleted: boolean }>(`/api/v1/maintenance/schedules/${id}`, { method: 'DELETE' })

export const listWebhooks = () => platformFetch<WebhookRow[]>('/api/v1/webhooks')
export const createWebhook = (body: { url: string; events: string[]; secret?: string }) =>
  platformFetch<WebhookRow>('/api/v1/webhooks', { method: 'POST', body: JSON.stringify(body) })

export const listWebhookDeliveries = (status?: string) => {
  const q = status ? `?status=${encodeURIComponent(status)}` : ''
  return platformFetch<WebhookDeliveryRow[]>(`/api/v1/webhook-deliveries${q}`)
}

export const retryWebhookDelivery = (id: string) =>
  platformFetch<WebhookDeliveryRow>(`/api/v1/webhook-deliveries/${id}/retry`, { method: 'POST' })

export const listProjects = () => platformFetch<ProjectRow[]>('/api/v1/projects')
export const getCapacityReport = () => platformFetch<CapacityReport>('/api/v1/reports/capacity')
export const fenceHost = (id: string) =>
  platformFetch<{ fenced: boolean }>(`/api/v1/hosts/${id}/fence`, { method: 'POST' })

export interface PlatformUser {
  id: string
  username: string
  role: string
  created_at: string
}

export interface ApiKeyRow {
  id: string
  name: string
  role: string
  created_at: string
  last_used_at?: string | null
}

export interface WebhookRow {
  id: string
  url: string
  events: string[]
  enabled: boolean
}

export interface WebhookDeliveryRow {
  id: string
  webhook_id?: string | null
  url: string
  event_kind: string
  attempts: number
  max_attempts: number
  status: string
  last_error: string
  next_retry_at: string
  created_at: string
}

export interface ProjectRow {
  name: string
  vm_count: number
}

export interface CapacityReport {
  hosts_online: number
  hosts_offline: number
  total_vms: number
  running_vms: number
  memory_total_mib: number
  memory_used_mib: number
  memory_headroom_mib: number
  avg_cpu_percent: number
}

export interface VmDiskRow {
  id: string
  name: string
  size_gib: number
  storage_class: string
  path?: string | null
}

export interface OidcSettings {
  enabled: boolean
  issuer: string
  client_id: string
  client_secret: string
  redirect_uri: string
}

export interface CpuCompatRule {
  source: string
  compatible_with: string[]
}

export interface NotificationRow {
  id: string
  kind: string
  payload: Record<string, unknown>
  delivered: boolean
  created_at: string
  delivered_at?: string | null
}

export interface HealthIssue {
  id: string
  severity: string
  message: string
  remediation?: string
  fix_action?: string
  fix_label?: string
}

export interface VmHealthReport {
  vm_id: string
  vm_name: string
  score: string
  healthy: boolean
  checks_passed: number
  checks_total: number
  issues: HealthIssue[]
  guest_tools_status: string
  guest_ip?: string
  guest_hostname?: string
}

export interface PlatformRecommendation {
  id: string
  impact: string
  title: string
  why: string
  risk: string
  action: string
  fix_action: string
  object_ref?: Record<string, unknown>
}

export interface ApplicationGroup {
  id: string
  name: string
  description: string
  created_at: string
}

export interface ApplicationGroupDetail extends ApplicationGroup {
  vm_ids: string[]
  vm_names: string[]
}

export interface TopologyGraph {
  nodes: Array<{ kind: string; id: string; name: string; state?: string }>
  edges: Array<{ from: string; to: string; label: string }>
  warnings: Array<{ severity: string; message: string; fix_action?: string }>
}

export const runVmHealthCheck = (id: string) =>
  platformFetch<VmHealthReport>(`/api/v1/vms/${id}/health-check`, { method: 'POST' })

export const runHostHealthCheck = (id: string) =>
  platformFetch<{ ok: boolean; checks: Array<{ name: string; passed: boolean; message: string; remediation?: string }> }>(
    `/api/v1/hosts/${id}/health-check`,
    { method: 'POST' },
  )

export const listPlatformRecommendations = () =>
  platformFetch<PlatformRecommendation[]>('/api/v1/recommendations')

export const listApplications = () => platformFetch<ApplicationGroup[]>('/api/v1/applications')

export const getApplication = (id: string) => platformFetch<ApplicationGroupDetail>(`/api/v1/applications/${id}`)

export const createApplication = (body: { name: string; description?: string; vm_ids?: string[] }) =>
  platformFetch<ApplicationGroupDetail>('/api/v1/applications', { method: 'POST', body: JSON.stringify(body) })

export const runApplicationAction = (id: string, action: 'start' | 'stop' | 'backup') =>
  platformFetch<{ task_ids: string[] }>(`/api/v1/applications/${id}/actions`, {
    method: 'POST',
    body: JSON.stringify({ action }),
  })

export interface Blueprint {
  id: string
  name: string
  description: string
  actions: string[]
  vm_ids: string[]
  created_at: string
}

export const listBlueprints = () => platformFetch<Blueprint[]>('/api/v1/blueprints')

export const createBlueprint = (body: { name: string; description?: string; actions: string[]; vm_ids: string[] }) =>
  platformFetch<Blueprint>('/api/v1/blueprints', { method: 'POST', body: JSON.stringify(body) })

export const runBlueprint = (id: string) =>
  platformFetch<{ task_ids: string[] }>(`/api/v1/blueprints/${id}/run`, { method: 'POST', body: '{}' })

export const deleteBlueprint = (id: string) =>
  platformFetch(`/api/v1/blueprints/${id}`, { method: 'DELETE' })

export interface FinOpsReport {
  vm_count: number
  running_vms: number
  total_vcpu: number
  total_memory_gib: number
  vcpu_hour_usd: number
  gib_hour_usd: number
  estimated_monthly_usd: number
}

export const getFinOpsReport = () => platformFetch<FinOpsReport>('/api/v1/reports/finops')

export const getClusterTopology = () => platformFetch<TopologyGraph>('/api/v1/topology')

export const getVmTopology = (id: string) => platformFetch<TopologyGraph>(`/api/v1/vms/${id}/topology`)

/** VNC WebSocket on the daemon origin (proxied to machina-controller). */
export function platformVncWsUrl(wsPath: string): string {
  if (typeof window === 'undefined') return wsPath
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
  return `${protocol}//${window.location.host}${wsPath}`
}
