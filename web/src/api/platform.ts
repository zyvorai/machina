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

/** Ensure platform API calls use the daemon→controller proxy, not raw daemon /api/v1 routes. */
function normalizeControllerBase(raw: string | null): string {
  const saved = normalizeSavedController(raw)
  if (typeof window === 'undefined') {
    return saved ?? ''
  }
  const origin = window.location.origin
  const proxy = `${origin}${PLATFORM_CONTROLLER_PROXY}`

  if (!saved) return proxy

  const sameLogicalHost = (hostname: string) =>
    hostname === window.location.hostname
    || (hostname === '127.0.0.1' && ['127.0.0.1', 'localhost', window.location.hostname].includes(window.location.hostname))
    || (hostname === 'localhost' && ['127.0.0.1', 'localhost', window.location.hostname].includes(window.location.hostname))

  try {
    const u = new URL(saved, origin)

    // Proxy URL saved under another origin (IP vs hostname in the bar) breaks fetch — rewrite.
    if (saved.includes(PLATFORM_CONTROLLER_PROXY)) {
      if (u.origin !== origin) {
        localStorage.setItem(LS_CONTROLLER, proxy)
        return proxy
      }
      return saved
    }

    // Direct :5093 (or loopback) on the same machine while browsing daemon UI — use proxy.
    if (sameLogicalHost(u.hostname) && u.origin !== origin) {
      localStorage.setItem(LS_CONTROLLER, proxy)
      return proxy
    }

    if (u.origin !== origin) return saved

    const path = u.pathname.replace(/\/$/, '') || ''
    const onDaemonUi = u.port === window.location.port || (!u.port && !window.location.port)

    if (onDaemonUi && !path.includes('/platform/controller')) {
      localStorage.setItem(LS_CONTROLLER, proxy)
      return proxy
    }
  } catch {
    localStorage.setItem(LS_CONTROLLER, proxy)
    return proxy
  }

  return saved
}

/** Canonical same-origin proxy URL for settings display and localStorage. */
export function defaultControllerProxyUrl(): string {
  return sameOriginProxyBase()
}

/** True when API calls should go through the daemon→controller proxy on this page. */
export function usesCoLocatedControllerProxy(base: string): boolean {
  return base.includes(PLATFORM_CONTROLLER_PROXY)
}

/**
 * Build fetch URL for controller API paths. Uses a relative proxy path when co-located
 * so IP vs hostname in localStorage cannot break same-origin fetch.
 */
export function resolvePlatformApiUrl(apiPath: string, base = getControllerBase()): string {
  const path = apiPath.startsWith('/') ? apiPath : `/${apiPath}`
  if (typeof window !== 'undefined' && usesCoLocatedControllerProxy(base)) {
    return `${PLATFORM_CONTROLLER_PROXY}${path}`
  }
  return `${base}${path}`
}

/** Align stored controller URL with daemon platform-info (fixes IP/hostname drift). */
export function syncControllerProxyFromPlatformInfo(info: { control_plane?: { proxy_url?: string } }) {
  if (typeof window === 'undefined') return
  const proxyPath = info.control_plane?.proxy_url?.trim()
  if (!proxyPath) return
  const normalizedPath = proxyPath.startsWith('/') ? proxyPath : `/${proxyPath}`
  localStorage.setItem(LS_CONTROLLER, `${window.location.origin}${normalizedPath}`)
}

export function getControllerBase(): string {
  const normalized = normalizeControllerBase(localStorage.getItem(LS_CONTROLLER))
  if (normalized) return normalized
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
import { redirectToLoginOnce } from './authRedirect'

export interface PlatformApiError extends Error {
  error_code?: string
  remediation?: string
  object_ref?: { kind: string; id: string; name?: string }
}

function sleepMs(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function platformFetchError(base: string, cause?: unknown): Error {
  const viaProxy = usesCoLocatedControllerProxy(base)
  const hint = cause instanceof Error && cause.message ? ` (${cause.message})` : ''
  const loadFailed = hint.toLowerCase().includes('load failed') || hint.toLowerCase().includes('failed to fetch')
  return new Error(
    viaProxy
      ? loadFailed
        ? `Machina daemon is not responding (${defaultControllerProxyUrl()}). `
          + 'The web UI cannot reach machina-daemon on this host — platform VM delete may have succeeded but refresh failed. '
          + 'On the host run: sudo systemctl restart machina-daemon && systemctl status machina-daemon machina-controller'
          + hint
        : `Cannot reach the Machina platform API (${defaultControllerProxyUrl()}). `
          + 'Confirm machina-daemon and machina-controller are running on this host '
          + '(systemctl status machina-daemon machina-controller). '
          + 'The UI uses the daemon proxy; a direct check is: curl -fsS http://127.0.0.1:5093/api/v1/health'
          + hint
      : `Cannot reach the Machina platform controller (${base}). `
        + 'Ensure machina-controller is running (systemctl status machina-controller) '
        + 'or set the controller URL in Platform Settings.',
  )
}

function controllerUnreachableMessage(body: string, status: number): string | null {
  const lower = body.toLowerCase()
  if (lower.includes('platform controller unreachable') || lower.includes('connection refused')) {
    return `Platform controller unreachable (HTTP ${status}). On the host run: systemctl status machina-controller && curl -fsS http://127.0.0.1:5093/api/v1/health`
  }
  return null
}

export async function platformFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const base = getControllerBase()
  const url = resolvePlatformApiUrl(path, base)
  const buildInit = (source?: RequestInit): RequestInit => {
    const headers = platformHeaders(source?.headers)
    if (source?.body == null || source.body === '') {
      headers.delete('Content-Type')
    }
    return { credentials: 'same-origin', ...source, headers }
  }
  let res: Response
  const max429Retries = 3
  for (let attempt = 0; attempt <= max429Retries; attempt++) {
    try {
      res = await fetch(url, buildInit(init))
    } catch (e: unknown) {
      throw platformFetchError(base, e)
    }
    if (res.status !== 429 || attempt === max429Retries) break
    await sleepMs(Math.min(60_000, 1000 * 2 ** attempt))
  }
  if (res!.status === 429) {
    throw new Error('Rate limit exceeded — wait a minute and retry')
  }
  // Stale platform JWT/basic can 401 against daemon routes when controller URL was misconfigured.
  if (res!.status === 401 && (localStorage.getItem(LS_JWT) || localStorage.getItem(LS_BASIC))) {
    localStorage.removeItem(LS_JWT)
    localStorage.removeItem(LS_BASIC)
    res = await fetch(url, buildInit(init))
  }
  // A 401 that survives the token-clear/retry means the session is truly expired. Send the
  // user to login instead of throwing a raw "401 " that a non-catching caller would surface
  // as an uncaught pageerror ("Application error").
  if (res!.status === 401) {
    redirectToLoginOnce()
  }
  if (!res!.ok) {
    const body = await res!.text().catch(() => '')
    const unreachable = controllerUnreachableMessage(body, res!.status)
    if (unreachable) {
      throw Object.assign(new Error(unreachable), { error_code: 'controller_unreachable' })
    }
    let parsed: PlatformApiError | null = null
    try {
      const j = JSON.parse(body) as { error?: string; error_code?: string; remediation?: string; object_ref?: unknown }
      if (j.error) {
        parsed = Object.assign(new Error(formatHttpErrorBody(res!.status, res!.statusText, body)), {
          error_code: j.error_code,
          remediation: j.remediation,
          object_ref: j.object_ref as PlatformApiError['object_ref'],
        })
      }
    } catch {
      /* plain text */
    }
    throw parsed ?? new Error(body || `${res!.status} ${res!.statusText}`)
  }
  if (res!.status === 204) return null as T
  return (await res!.json()) as T
}

/** Authenticated download for controller export endpoints (CSV, PDF, etc.). */
export async function downloadControllerExport(path: string, filename: string) {
  const url = resolvePlatformApiUrl(path)
  const res = await fetch(url, { credentials: 'same-origin', headers: platformHeaders() })
  if (!res.ok) {
    const body = await res.text().catch(() => '')
    throw new Error(body || `Export failed (${res.status})`)
  }
  const blob = await res.blob()
  const a = document.createElement('a')
  a.href = URL.createObjectURL(blob)
  a.download = filename
  a.click()
  URL.revokeObjectURL(a.href)
}

export interface PlatformHost {
  id: string
  hostname: string
  address: string
  state: string
  maintenance_mode: boolean
  agent_grpc_addr: string
  vm_count: number
  cpu_percent: number
  memory_used_mib: number
  memory_total_mib: number
  fenced: boolean
  schedulable: boolean
  validation_status: string
  last_heartbeat_at?: string | null
  site: string
  rack: string
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
  validation_report?: Array<{ name: string; passed: boolean; message: string; remediation?: string }>
}

export interface PlatformVm {
  id: string
  name: string
  host_id?: string | null
  desired_state: string
  observed_state: string
  lifecycle_phase: string
  last_error: string
  managed: boolean
  uuid?: string | null
  vcpus: number
  memory_mib: number
  ha_enabled: boolean
  project?: string | null
  tags: string[]
  inventory_source: string
  k8s_namespace?: string | null
  last_seen_at?: string | null
  guest_ip?: string | null
  guest_tools_status?: string | null
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
  workload?: string
  description?: string
  featured?: boolean
  marketplace?: boolean
  icon?: string | null
  firewall_profile?: string | null
  approval_status?: string
  git_ref?: string
  daemon_json_path?: string
  project?: string
  /** Present on marketplace list — golden image can be SSH-pulled on first deploy. */
  auto_fetch?: boolean
}

export interface PlatformConsoleInfo {
  vm_id: string
  vm_name: string
  console_type: string
  ws_path: string
}

export interface GuestAccessHints {
  auth_mode: string
  serial_password_login: boolean
  guest_ip_private: boolean
  ssh_nat_host_port?: number | null
}

export interface ConsolePermissions {
  role: string
  read_only: boolean
  can_power: boolean
  can_snapshot: boolean
  can_send_keys: boolean
}

export interface ConsoleHubPlan {
  vm_id: string
  vm_name: string
  recommended: string
  native: { console_type: string; ws_path: string; serial_ws_path?: string; available: boolean }
  guacamole: { available: boolean; protocols: string[] }
  guest_ip?: string | null
  ssh_user?: string | null
  os_hint: string
  protocols: string[]
  webrtc_spice_available: boolean
  guest_access?: GuestAccessHints
  hypervisor_address?: string | null
  ssh_connect_host?: string | null
  ssh_connect_port?: number | null
  session_recording_enabled?: boolean
  permissions?: ConsolePermissions
}

export interface ConsoleHubSessionResponse {
  session_id: string
  vm_id: string
  protocol: string
  backend: string
  embed_path: string
  emergency_url?: string | null
  audit_id: string
  expires_at: string
  spectator_token?: string | null
  recording_enabled?: boolean
}

export interface SpectatorValidateResponse {
  valid: boolean
  vm_id: string
  actor: string
  protocol: string
  read_only: boolean
}

export const getConsoleHubPlan = (id: string) =>
  platformFetch<ConsoleHubPlan>(`/api/v1/vms/${id}/consolehub/plan`)

export const createConsoleHubSession = (id: string, body: { protocol?: string; rdp_username?: string; rdp_domain?: string; break_glass?: boolean }) =>
  platformFetch<ConsoleHubSessionResponse>(`/api/v1/vms/${id}/consolehub/sessions`, {
    method: 'POST',
    body: JSON.stringify(body),
  })

export const breakGlassConsoleSession = (id: string, body: { protocol: string; reason?: string }) =>
  platformFetch<ConsoleHubSessionResponse>(`/api/v1/vms/${id}/consolehub/break-glass`, {
    method: 'POST',
    body: JSON.stringify(body),
  })

export const createConsoleCollaborateLink = (id: string, body: { protocol?: string; reason?: string }) =>
  platformFetch<ConsoleHubSessionResponse>(`/api/v1/vms/${id}/consolehub/collaborate`, {
    method: 'POST',
    body: JSON.stringify(body),
  })

export const validateConsoleSpectator = (sessionId: string, token: string) =>
  platformFetch<SpectatorValidateResponse>(
    `/api/v1/consolehub/spectator/validate?session_id=${encodeURIComponent(sessionId)}&token=${encodeURIComponent(token)}`,
  )

export const endConsoleHubSession = (sessionId: string) =>
  platformFetch<{ ended: boolean }>(`/api/v1/consolehub/sessions/${sessionId}/end`, { method: 'POST' })

export const uploadConsoleSessionReplay = async (sessionId: string, blob: Blob) => {
  const base = getControllerBase()
  const url = resolvePlatformApiUrl(`/api/v1/consolehub/sessions/${sessionId}/replay`, base)
  const headers = platformHeaders()
  headers.delete('Content-Type')
  headers.set('Content-Type', blob.type || 'video/webm')
  const res = await fetch(url, { method: 'PUT', body: blob, credentials: 'same-origin', headers })
  if (!res.ok) {
    const body = await res.text().catch(() => '')
    throw new Error(body || `Upload failed (${res.status})`)
  }
  return res.json() as Promise<{ uploaded: boolean; bytes: number }>
}

export const consoleSessionReplayUrl = (sessionId: string) =>
  resolvePlatformApiUrl(`/api/v1/consolehub/sessions/${sessionId}/replay`)

export const fetchConsoleSessionReplay = async (sessionId: string) => {
  const url = consoleSessionReplayUrl(sessionId)
  const res = await fetch(url, { credentials: 'same-origin', headers: platformHeaders() })
  if (!res.ok) {
    const body = await res.text().catch(() => '')
    throw new Error(body || `Replay unavailable (${res.status})`)
  }
  return res.blob()
}

export const requestConsoleAccess = (vmId: string, body: { protocol: string; reason?: string }) =>
  platformFetch<{ request_id: string; status: string }>(`/api/v1/vms/${vmId}/consolehub/access-requests`, {
    method: 'POST',
    body: JSON.stringify(body),
  })

export const listConsoleHubSessions = (vmId: string) =>
  platformFetch<Array<{
    session_id: string
    actor: string
    protocol: string
    backend: string
    started_at: string
    ended_at?: string | null
    recording_enabled?: boolean
    recording_path?: string | null
    replay_available?: boolean
  }>>(
    `/api/v1/vms/${vmId}/consolehub/sessions`,
  )

export const explainConsoleHub = (
  vmId: string,
  body: { intent?: string; lens?: string; guest_ip?: string; vm_state?: string; screen_snapshot?: string },
) =>
  platformFetch<{ explanation: string }>(`/api/v1/vms/${vmId}/consolehub/explain`, {
    method: 'POST',
    body: JSON.stringify(body),
  })

export interface EnrollmentToken {
  token: string
  expires_at: string
  install_command: string
}

export const listPlatformHosts = () => platformFetch<PlatformHost[]>('/api/v1/hosts')
export const createPlatformHost = (body: { hostname: string; address?: string; agent_grpc_addr?: string; libvirt_uri?: string }) =>
  platformFetch<PlatformHost>('/api/v1/hosts', { method: 'POST', body: JSON.stringify(body) })
export const getPlatformHost = (id: string) => platformFetch<PlatformHost>(`/api/v1/hosts/${id}`)
export const getPlatformHostDetail = (id: string) => platformFetch<PlatformHostDetail>(`/api/v1/hosts/${id}/detail`)
export const syncAllHosts = () => platformFetch<{ task_id: string }[]>('/api/v1/hosts/sync-all', { method: 'POST' })
export const deleteHost = (id: string, force = false) =>
  platformFetch<{ deleted: boolean; vms_pruned?: number }>(
    `/api/v1/hosts/${id}${force ? '?force=true' : ''}`,
    { method: 'DELETE' },
  )
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
export const getPlatformNetwork = (id: string) => platformFetch<PlatformNetwork>(`/api/v1/networks/${id}`)
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
    cpu?: { some: number; full: number; total?: number; available?: boolean }
    memory?: { some: number; full: number; total?: number; available?: boolean }
    io?: { some: number; full: number; total?: number; available?: boolean }
    available?: boolean
  }
  thermal?: Array<{ sensor: string; label: string; temp_celsius: number; critical_celsius?: number }>
  smart?: Array<{ device: string; passed: boolean; summary: string; probed: boolean }>
  disk_io?: Array<{ device: string; read_bytes: number; write_bytes: number; read_ios?: number; write_ios?: number }>
  cgroup?: Record<string, unknown>
  bpf?: Record<string, unknown>
  vm_cgroups?: Array<Record<string, unknown>>
}

export type HostNetworkDiag = {
  systemd_networkd_active?: boolean
  networkd_active?: boolean
  network_manager_active?: boolean
  resolved_active?: boolean
  summary?: string
  interfaces?: Array<{ name: string; state?: string; kind?: string; addresses?: string[] }>
  networkctl_list?: string
  networkctl_status_all?: string
  resolvectl_status?: string
  networkd_recent_logs?: string
  resolved_recent_logs?: string
}

export type HostLinuxAuditReport = {
  auditd_active?: boolean
  auditd_enabled?: boolean
  available?: boolean
  rules_count?: number
  recent_events?: number
  avc_count?: number
  summary?: string
  events?: Array<Record<string, unknown>>
}

export const getHostLinuxObservability = (hostId: string) =>
  platformFetch<HostLinuxObservability>(`/api/v1/hosts/${hostId}/linux/observability`)

export const getHostNetworkDiag = (hostId: string) =>
  platformFetch<HostNetworkDiag>(`/api/v1/hosts/${hostId}/linux/network-diag`)

export const getHostLinuxAudit = (hostId: string) =>
  platformFetch<HostLinuxAuditReport>(`/api/v1/hosts/${hostId}/linux/audit`)

export type GuestAgentCheckRow = {
  id: string
  label: string
  passed: boolean
  detail: string
}

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
  install_state: 'none' | 'channel_only' | 'running' | string
  channel_attached: boolean
  channel_connected: boolean
  agent_ping: boolean
  agent_version?: string
  checks: GuestAgentCheckRow[]
  guest_observability?: GuestObservabilitySnapshot
}

export type GuestObservabilitySnapshot = {
  hostname?: string
  os_pretty_name?: string
  os_kernel?: string
  os_arch?: string
  ip_addresses?: Array<{ name: string; address: string; source?: string; ip_type?: string; mac?: string }>
  filesystems?: Array<{ mountpoint: string; fs_type: string; used_bytes: number; total_bytes: number }>
  cloud_init_status?: string
  users?: Array<{ username: string; login_time?: string; host?: string }>
  time?: { guest_time_rfc3339: string; host_time_rfc3339: string; delta_ms: number }
  fs_freeze?: { frozen: boolean; detail: string }
}

export type GuestAgentActionResult = {
  action: string
  ok: boolean
  message: string
  time?: GuestObservabilitySnapshot['time']
  fs_freeze?: GuestObservabilitySnapshot['fs_freeze']
  fstrim?: Array<{ mountpoint: string; trimmed_bytes: number; error: string }>
}

export const guestSyncTime = (vmId: string) =>
  platformFetch<GuestAgentActionResult>(`/api/v1/vms/${vmId}/guest/sync-time`, { method: 'POST' })

export const guestFstrim = (vmId: string) =>
  platformFetch<GuestAgentActionResult>(`/api/v1/vms/${vmId}/guest/fstrim`, { method: 'POST' })

export const getGuestFsFreezeStatus = (vmId: string) =>
  platformFetch<GuestAgentActionResult>(`/api/v1/vms/${vmId}/guest/fs-freeze-status`)

export type GuestAiInsightRow = {
  title: string
  severity: string
  detail: string
}

export type GuestAiRecommendation = {
  label: string
  action: string
  risk: string
  rationale: string
}

export type GuestAiInsightsReport = {
  vm_id: string
  vm_name: string
  snapshot: GuestObservabilitySnapshot & { vm_id?: string; vm_name?: string; install_state?: string; agent_ping?: boolean }
  summary: string
  insights: GuestAiInsightRow[]
  recommendations: GuestAiRecommendation[]
  llm_powered: boolean
}

export const getVmGuestAiInsights = (
  vmId: string,
  opts?: { refresh?: boolean; focus?: string },
) => {
  const params = new URLSearchParams()
  if (opts?.refresh) params.set('refresh', '1')
  if (opts?.focus) params.set('focus', opts.focus)
  const q = params.toString()
  return platformFetch<GuestAiInsightsReport>(
    `/api/v1/vms/${vmId}/guest/ai-insights${q ? `?${q}` : ''}`,
    { method: 'POST' },
  )
}

export const getVmGuestObservability = (vmId: string) =>
  platformFetch<Record<string, unknown>>(`/api/v1/vms/${vmId}/guest/observability`)

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
  cpu_pressure_pct: number
  memory_pressure_pct: number
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

export interface LiveNetworkInfo {
  name: string
  uuid: string
  active: boolean
  persistent: boolean
  autostart: boolean
  bridge: string
}

export const listLivePlatformNetworks = (hostId?: string) => {
  const q = hostId ? `?host_id=${encodeURIComponent(hostId)}` : ''
  return platformFetch<{ host_id: string; networks: LiveNetworkInfo[] }>(`/api/v1/networks/live${q}`)
}

export const activatePlatformNetwork = (id: string, hostId?: string) =>
  platformFetch<{ status: string; name: string }>(
    `/api/v1/networks/${id}/activate${hostId ? `?host_id=${encodeURIComponent(hostId)}` : ''}`,
    { method: 'POST', body: '{}' },
  )

export const deactivatePlatformNetwork = (id: string, hostId?: string) =>
  platformFetch<{ status: string; name: string }>(
    `/api/v1/networks/${id}/deactivate${hostId ? `?host_id=${encodeURIComponent(hostId)}` : ''}`,
    { method: 'POST', body: '{}' },
  )

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
export type CreateVmSnapshotBody = {
  name: string
  description?: string
  disk_only?: boolean
  quiesce?: boolean
  storage_mode?: string
}

export const createVmSnapshot = (vmId: string, body: CreateVmSnapshotBody | string) => {
  const payload = typeof body === 'string' ? { name: body } : body
  return platformFetch<{ task_id: string }>(`/api/v1/vms/${vmId}/snapshots`, {
    method: 'POST',
    body: JSON.stringify(payload),
  })
}
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
  platformFetch<{ vm_id: string; cpu_percent: number; memory_used_mib: number; disk_read_iops: number; disk_write_iops: number; updated_at: string }>(
    `/api/v1/vms/${id}/metrics`,
  )

export const attachVmDisk = (id: string, body: { disk_path: string; target_dev?: string; size_gib?: number }) =>
  platformFetch<{ task_id: string }>(`/api/v1/vms/${id}/disks/attach`, {
    method: 'POST',
    body: JSON.stringify(body),
  })

export interface VmLibvirtDisk {
  device: string
  source: string
  driver: string
  target: string
  bus?: string
  cache?: string
  readonly?: boolean
  shareable?: boolean
  capacity_bytes?: number | null
  allocation_bytes?: number | null
  physical_bytes?: number | null
}

export interface VmLibvirtFilesystem {
  source: string
  mount_tag: string
  driver?: string
  accessmode?: string
  xattr?: boolean
}

export interface VmPendingChange {
  category: string
  summary: string
}

export interface VmPendingConfig {
  needs_shutdown: boolean
  state: string
  persistent: boolean
  pending_changes: VmPendingChange[]
}

export const getVmPendingConfig = (id: string) =>
  platformFetch<VmPendingConfig>(`/api/v1/vms/${id}/pending-config`)

export interface VmParitySummary {
  needs_shutdown: boolean
  spice: boolean
  state?: string
  error?: string
}

export const batchVmParitySummary = (vm_ids: string[]) =>
  platformFetch<{ items: Record<string, VmParitySummary> }>('/api/v1/vms/pending-config/batch', {
    method: 'POST',
    body: JSON.stringify({ vm_ids }),
  })

export type BatchGuestIpItem = { guest_ip?: string | null; nic_ip?: string | null }

export const batchVmGuestIps = (vm_ids: string[]) =>
  platformFetch<{ items: Record<string, BatchGuestIpItem> }>('/api/v1/vms/guest-ips/batch', {
    method: 'POST',
    body: JSON.stringify({ vm_ids }),
  })

export const getVmQemuLogs = (id: string, lines = 500) =>
  platformFetch<{ vm_name: string; log_path: string; content: string }>(
    `/api/v1/vms/${id}/qemu-logs?lines=${lines}`,
  )

export const renamePlatformVm = (id: string, new_name: string) =>
  platformFetch<{ status: string; new_name: string }>(`/api/v1/vms/${id}/rename`, {
    method: 'POST',
    body: JSON.stringify({ new_name }),
  })

export const injectVmNmi = (id: string) =>
  platformFetch<{ status: string }>(`/api/v1/vms/${id}/nmi`, { method: 'POST' })

export const convertVmSpiceToVnc = (id: string) =>
  platformFetch<{ status: string; message?: string }>(`/api/v1/vms/${id}/graphics/spice-to-vnc`, {
    method: 'POST',
  })

export const addVmGraphics = (id: string, graphics_type: 'vnc' | 'spice', listen?: string) =>
  platformFetch<{ status: string; message?: string }>(`/api/v1/vms/${id}/graphics/add`, {
    method: 'POST',
    body: JSON.stringify({ graphics_type, listen: listen ?? '127.0.0.1' }),
  })

export const removeVmGraphics = (id: string, graphics_type: 'vnc' | 'spice') =>
  platformFetch<{ status: string; message?: string }>(`/api/v1/vms/${id}/graphics/remove`, {
    method: 'POST',
    body: JSON.stringify({ graphics_type }),
  })

export interface VmLibvirtInterface {
  mac_address: string
  source: string
  model: string
  ip?: string | null
}

export interface VmLibvirtDetails {
  name: string
  uuid: string
  state: string
  vcpus: number
  memory_mb: number
  os_type: string
  arch: string
  autostart: boolean
  persistent: boolean
  interfaces: VmLibvirtInterface[]
  disks: VmLibvirtDisk[]
  filesystems?: VmLibvirtFilesystem[]
}

export const getVmLibvirtDetails = (id: string) =>
  platformFetch<VmLibvirtDetails>(`/api/v1/vms/${id}/libvirt-details`)

export interface VmHardwareSection {
  label: string
  value: string
  badges?: string[]
}

export interface VmHardwareWindowsItem {
  label: string
  status: string
  ok: boolean
}

export interface VmHardwareWindowsReadiness {
  is_windows: boolean
  items: VmHardwareWindowsItem[]
  ready: boolean
}

export interface VmHardwareCompatIssue {
  severity: string
  category: string
  message: string
  badges: string[]
}

export interface VmHardwareCompatReport {
  ok: boolean
  issues: VmHardwareCompatIssue[]
  cpu_modes_supported?: string[]
  tpm_supported?: boolean
  uefi_supported?: boolean
}

export interface VmDomainCapabilitiesReport {
  arch: string
  virttype: string
  cpu_modes_supported: string[]
  machine_types: string[]
  tpm_supported: boolean
  uefi_supported: boolean
}

export interface VmHardwareSummaryReport {
  vm_name: string
  state: string
  cpu: VmHardwareSection
  memory: VmHardwareSection
  firmware: VmHardwareSection
  tpm: VmHardwareSection
  display: VmHardwareSection
  video: VmHardwareSection
  disk_bus: VmHardwareSection
  nic: VmHardwareSection
  guest_agent: VmHardwareSection
  host_devices: VmHardwareSection
  migration: VmHardwareSection
  windows_readiness?: VmHardwareWindowsReadiness | null
  balloon_enabled?: boolean
  secure_boot?: boolean
  has_vfio_hostdev?: boolean
  needs_shutdown?: boolean
}

export const getVmHardwareSummary = (id: string) =>
  platformFetch<VmHardwareSummaryReport>(`/api/v1/vms/${id}/hardware-summary`)

export const getVmHardwareCompat = (id: string) =>
  platformFetch<VmHardwareCompatReport>(`/api/v1/vms/${id}/hardware-compat`)

export const getVmDomainCaps = (id: string) =>
  platformFetch<VmDomainCapabilitiesReport>(`/api/v1/vms/${id}/domain-caps`)

export const detachVmDisk = (id: string, target: string) =>
  platformFetch<{ task_id: string }>(
    `/api/v1/vms/${id}/disks/detach/${encodeURIComponent(target)}`,
    { method: 'POST' },
  )

export const resizeVmDisk = (id: string, target: string, size_gb: number) =>
  platformFetch<{ task_id: string }>(
    `/api/v1/vms/${id}/disks/resize/${encodeURIComponent(target)}`,
    { method: 'POST', body: JSON.stringify({ size_gb }) },
  )

export const attachVmNic = (id: string, body: { network: string; model?: string }) =>
  platformFetch<{ task_id: string }>(`/api/v1/vms/${id}/nics/attach`, {
    method: 'POST',
    body: JSON.stringify(body),
  })

export const detachVmNic = (id: string, mac: string) =>
  platformFetch<{ task_id: string }>(
    `/api/v1/vms/${id}/nics/detach/${encodeURIComponent(mac)}`,
    { method: 'POST' },
  )

export const setVmAutostart = (id: string, enabled: boolean) =>
  platformFetch<{ task_id: string }>(`/api/v1/vms/${id}/autostart`, {
    method: 'POST',
    body: JSON.stringify({ enabled }),
  })

export const setVmVcpus = (id: string, count: number) =>
  platformFetch<{ task_id: string }>(`/api/v1/vms/${id}/vcpus`, {
    method: 'POST',
    body: JSON.stringify({ count }),
  })

export const setVmMemory = (id: string, memory_mb: number) =>
  platformFetch<{ task_id: string }>(`/api/v1/vms/${id}/memory`, {
    method: 'POST',
    body: JSON.stringify({ memory_mb }),
  })

export const batchVmPower = (
  vm_ids: string[],
  action: VmPowerAction,
  opts?: { mode?: 'agent' },
) =>
  platformFetch<{
    results: Array<{ vm_id: string; task_id?: string; error?: string }>
  }>('/api/v1/vms/batch/power', {
    method: 'POST',
    body: JSON.stringify({
      vm_ids,
      action,
      ...(opts?.mode ? { mode: opts.mode } : {}),
    }),
  })

export const listPlatformTemplates = () => platformFetch<PlatformTemplate[]>('/api/v1/templates')
export const listMarketplaceTemplates = () => platformFetch<PlatformTemplate[]>('/api/v1/templates/marketplace')
export const seedDefaultTemplates = () =>
  platformFetch<{ inserted: number; templates: PlatformTemplate[] }>('/api/v1/templates/seed', {
    method: 'POST',
    body: '{}',
  })

export type TemplateReadiness = {
  disk_exists: boolean
  host_online: number
  cloud_init: boolean
  ready: boolean
  auto_fetch: boolean
  remediation: string
  source_disk: string
}

export type MissingTemplateImage = {
  name: string
  version: string
  source_disk: string
  category: string
  icon?: string | null
  auto_fetch: boolean
}

export const getTemplateReadiness = (name: string, version: string) =>
  platformFetch<TemplateReadiness>(
    `/api/v1/templates/${encodeURIComponent(name)}/${encodeURIComponent(version)}/readiness`,
  )

export const listMissingTemplateImages = () =>
  platformFetch<{
    missing: MissingTemplateImage[]
    count: number
    auto_fetch_count: number
    summary: string
  }>('/api/v1/templates/missing-images')

export const prefetchMissingTemplateImages = (body: { host_id?: string } = {}) =>
  platformFetch<{ task_id: string }>('/api/v1/templates/prefetch-missing', {
    method: 'POST',
    body: JSON.stringify(body),
  })

export const getPlatformHealth = () => platformFetch<{ status: string; leader?: boolean; controller_id?: string }>('/api/v1/health')

export type VmPowerAction = 'start' | 'stop' | 'reboot' | 'reset' | 'shutdown' | 'pause' | 'resume'

export const vmPower = (id: string, action: VmPowerAction, opts?: { mode?: 'agent' }) =>
  platformFetch<{ task_id: string }>(`/api/v1/vms/${id}/${action}`, {
    method: 'POST',
    body: JSON.stringify(opts?.mode ? { mode: opts.mode } : {}),
  })

export const installPlatformVm = (id: string) =>
  platformFetch<{ task_id: string }>(`/api/v1/vms/${id}/install`, { method: 'POST' })

export const getVmDomainXml = (vmId: string) =>
  platformFetch<{ xml: string }>(`/api/v1/vms/${vmId}/domain-xml`)

export interface VmPortForwardRule {
  id: string
  protocol: string
  host_port: number
  vm_ip: string
  vm_port: number
  description: string
}

export const listVmPortForwards = (vmId: string) =>
  platformFetch<VmPortForwardRule[]>(`/api/v1/vms/${vmId}/port-forwards`)

export const createVmPortForward = (
  vmId: string,
  body: { protocol: string; host_port: number; vm_port: number; description?: string },
) =>
  platformFetch<{ ok: boolean }>(`/api/v1/vms/${vmId}/port-forwards`, {
    method: 'POST',
    body: JSON.stringify(body),
  })

export const deleteVmPortForward = (
  vmId: string,
  body: { protocol: string; host_port: number; vm_port: number },
) =>
  platformFetch<{ ok: boolean }>(`/api/v1/vms/${vmId}/port-forwards/delete`, {
    method: 'POST',
    body: JSON.stringify(body),
  })

export interface PortForwardTemplateRecord {
  id: string
  name: string
  vm_port: number
  host_port: number
  access: string
}

export const listVmPortForwardTemplates = (vmId: string) =>
  platformFetch<PortForwardTemplateRecord[]>(`/api/v1/vms/${vmId}/port-forward-templates`)

export const upsertVmPortForwardTemplate = (vmId: string, body: PortForwardTemplateRecord) =>
  platformFetch<PortForwardTemplateRecord[]>(`/api/v1/vms/${vmId}/port-forward-templates`, {
    method: 'POST',
    body: JSON.stringify(body),
  })

export const vmDelete = (id: string, confirmed = false) =>
  platformFetch<{ task_id: string; status?: string; operation?: string }>(`/api/v1/vms/${id}/delete`, {
    method: 'POST',
    body: JSON.stringify(confirmed ? { confirmed: true } : {}),
  })

export const installGuestTools = (id: string) =>
  platformFetch<{ task_id: string }>(`/api/v1/vms/${id}/guest-tools/install`, { method: 'POST', body: '{}' })

export { vmMigrate } from './platformVmMigrate'
export type { VmMigrateOptions } from './platformVmMigrate'
export { listVmTimeline } from './platformVmTimeline'
export type { VmTimelineEntry } from './platformVmTimeline'
export { getNetworkCanvas } from './platformNetworkCanvas'
export type { NetworkCanvasPayload, PacketWolfFlow } from './platformNetworkCanvas'

export const vmClone = (id: string, new_name: string, clone_mode: 'linked' | 'full' | 'xml' = 'linked') =>
  platformFetch<{ task_id: string }>(`/api/v1/vms/${id}/clone`, {
    method: 'POST',
    body: JSON.stringify({ new_name, clone_mode }),
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
  host_id?: string
  backend?: string
  pending_count?: number
  summary?: string
  reboot_required?: boolean
  packages?: Array<{ name: string; current?: string; available?: string; security?: boolean }>
}

export const getHostLinuxUpdates = (hostId: string) =>
  platformFetch<HostLinuxUpdates>(`/api/v1/hosts/${hostId}/linux/updates`)

export type HostLinuxFilesystem = {
  source: string
  fstype: string
  mount_point: string
  size_bytes: number
  used_bytes: number
  avail_bytes: number
  use_percent: number
}

export type HostLinuxProcess = {
  pid: number
  user: string
  cpu_percent: number
  rss_kb: number
  command: string
  args?: string
}

export const getHostLinuxFilesystems = (hostId: string) =>
  platformFetch<{ filesystems: HostLinuxFilesystem[] }>(`/api/v1/hosts/${hostId}/linux/filesystems`)

export const getHostLinuxProcesses = (hostId: string, order: 'cpu' | 'memory' = 'memory', limit = 20) =>
  platformFetch<{ processes: HostLinuxProcess[] }>(
    `/api/v1/hosts/${hostId}/linux/processes?order=${order}&limit=${limit}`,
  )

export const previewHostPackageUpgrade = (hostId: string) =>
  platformFetch<{ dry_run: boolean; result?: Record<string, unknown>; summary?: string }>(
    `/api/v1/hosts/${hostId}/linux/package-upgrade`,
    { method: 'POST', body: JSON.stringify({ dry_run: true }) },
  )

export const applyHostPackageUpgrade = (hostId: string) =>
  platformFetch<{ task_id: string; summary: string }>(
    `/api/v1/hosts/${hostId}/linux/package-upgrade`,
    { method: 'POST', body: JSON.stringify({ dry_run: false }) },
  )

export const rebootHostLinux = (hostId: string) =>
  platformFetch<{ task_id: string; summary: string }>(
    `/api/v1/hosts/${hostId}/linux/reboot`,
    { method: 'POST', body: '{}' },
  )

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

export const emergencyUnlockNetworkSegment = (id: string) =>
  platformFetch<{ segment_id: string; unlocked: boolean; summary: string }>(
    `/api/v1/network/segments/${id}/emergency-unlock`,
    { method: 'POST', body: '{}' },
  )

export const getAirGapBundle = (id: string) =>
  platformFetch<AirGapBundle>(`/api/v1/enterprise/air-gap/bundles/${id}`)

export const markAllNotificationsDelivered = async (limit = 200) => {
  const rows = await listNotifications(true)
  const batch = (rows ?? []).slice(0, limit)
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

export const issuePlatformVmWsToken = (id: string) =>
  platformFetch<{ token: string }>(`/api/v1/vms/${id}/ws-token`, { method: 'POST' })

/** Build platform VNC WebSocket URL for a VM id and short-lived token. */
export function platformVmVncWsUrl(vmId: string, token: string): string {
  return platformVncWsUrl(`/ws/v1/platform/vnc/${encodeURIComponent(vmId)}?token=${encodeURIComponent(token)}`)
}

/** Authenticated virt-viewer `.vv` download URL for a platform VM. */
export function platformVmViewerVvUrl(vmId: string): string {
  const base = getControllerBase()
  return resolvePlatformApiUrl(`/api/v1/vms/${encodeURIComponent(vmId)}/viewer.vv`, base)
}

/** Build platform serial WebSocket URL for a VM id and short-lived token. */
export function platformVmSerialWsUrl(vmId: string, token: string): string {
  return platformVncWsUrl(`/ws/v1/platform/serial/${encodeURIComponent(vmId)}?token=${encodeURIComponent(token)}`)
}

/** WebSocket path segment for platform SPICE (spice-html5 `path=` query). */
export function platformVmSpiceWsPath(vmId: string, token: string): string {
  return `ws/v1/platform/spice/${encodeURIComponent(vmId)}?token=${encodeURIComponent(token)}`
}

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
  template_vars?: Record<string, string>
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
  backup_path: string
  created_at: string
}

export const retryTask = (id: string) =>
  platformFetch<{ task_id: string; status: string; operation: string }>(`/api/v1/tasks/${id}/retry`, { method: 'POST' })

export const patchVm = (id: string, body: { desired_state?: string; project?: string; tags?: string[]; description?: string }) =>
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

export const createVmBackupWithTarget = (
  vmId: string,
  opts?: { target_id?: string; backup_type?: 'full' | 'incremental' },
) =>
  platformFetch<{ task_id: string }>(`/api/v1/vms/${vmId}/backups`, {
    method: 'POST',
    body: JSON.stringify({
      target_id: opts?.target_id,
      backup_type: opts?.backup_type ?? 'full',
    }),
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
export const deleteBackupTarget = (id: string) =>
  platformFetch<{ deleted: boolean }>(`/api/v1/backup-targets/${id}`, { method: 'DELETE' })

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

export function normalizePlatformUser(raw: Partial<PlatformUser> & { username?: string; role?: string }): PlatformUser | null {
  const username = raw.username?.trim()
  if (!username) return null
  return {
    id: raw.id ?? '',
    username,
    role: raw.role ?? 'viewer',
    created_at: raw.created_at ?? '',
  }
}

export const getCurrentUser = async () => {
  const raw = await platformFetch<Partial<PlatformUser> & { username: string; role: string }>('/api/v1/users/me')
  return normalizePlatformUser(raw) ?? { id: '', username: raw.username, role: raw.role, created_at: '' }
}
export const createUser = (body: { username: string; password: string; role?: string }) =>
  platformFetch<PlatformUser>('/api/v1/users', { method: 'POST', body: JSON.stringify(body) })
export const patchUser = (id: string, body: { username?: string; role?: string }) =>
  platformFetch<PlatformUser>(`/api/v1/users/${id}`, { method: 'PATCH', body: JSON.stringify(body) })
export const deleteUser = (id: string) =>
  platformFetch<{ deleted: boolean }>(`/api/v1/users/${id}`, { method: 'DELETE' })

export const pruneInvalidUsers = () =>
  platformFetch<{ deleted: number }>('/api/v1/users/prune-invalid', { method: 'POST', body: '{}' })

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
export const getMaintenanceSchedule = (id: string) =>
  platformFetch<MaintenanceSchedule>(`/api/v1/maintenance/schedules/${id}`)
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

export const purgeWebhookDeliveries = (body: { status?: string; url_contains?: string }) =>
  platformFetch<{ deleted: number }>('/api/v1/webhook-deliveries/purge', {
    method: 'POST',
    body: JSON.stringify(body),
  })

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
  storage_used_gib?: number
  storage_capacity_gib?: number
  estimated_small_vms_addable?: number
  forecast_30d_vms?: number
  planner_recommendations?: string[]
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
export const getBlueprint = (id: string) => platformFetch<Blueprint>(`/api/v1/blueprints/${id}`)

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

/** Roadmap APIs live in focused modules; re-exported here for backward compatibility. */
export {
  listContentImages,
  createContentImage,
  approveContentImage,
  rejectContentImage,
} from './platformContent'
export type { ContentImage } from './platformContent'
export { createPlatformVm, createVmFromIso, createVmFromVirtInstall } from './platformVmCreate'
export type { CreatePlatformVmBody, CreateFromIsoBody, CreateFromVirtInstallBody } from './platformVmCreate'
export { buildVmFromPrompt } from './platformAiVmBuilder'
export type { VmBuilderResult } from './platformAiVmBuilder'
export { syncProxmoxInventory } from './platformProxmoxSync'
export { syncVmwareInventory } from './platformVmwareSync'
export {
  listStoragePools,
  createStoragePool,
  deleteStoragePool,
  discoverStoragePools,
  getStorageTiersOverview,
  bindStoragePoolTier,
  getStorageBackupSla,
  upsertStorageBackupSla,
  getStorageSnapshotPolicy,
  patchStoragePool,
  activateStoragePool,
  deactivateStoragePool,
  refreshStoragePool,
  listLiveStoragePools,
} from './platformStorage'
export type {
  StoragePool,
  StorageTierOverview,
  StorageTiersOverview,
  StorageBackupSla,
  StorageBackupSlaOverview,
  StoragePoolBackend,
  LiveStoragePoolInfo,
} from './platformStorage'
export { validateCloudInit } from './platformCloudInit'
export type { CloudInitValidation } from './platformCloudInit'
export { syncGitTemplates, approvePlatformTemplate, publishVmAsTemplate } from './platformTemplatesExtra'

// ── Bare Metal ────────────────────────────────────────────────────────────────

export interface BaremetalServer {
  id: string
  hostname: string
  bmc_address: string
  bmc_type: string
  state: string
  cpu_cores: number
  memory_mib: number
  firewall_profile: string
  firewall_enabled: boolean
  bmc_vlan: string
  pxe_vlan: string
  created_at: string
}

export interface RegisterBaremetalBody {
  hostname: string
  bmc_address: string
  bmc_type?: string
  cpu_cores?: number
  memory_mib?: number
  firewall_profile?: string
  firewall_enabled?: boolean
  bmc_vlan?: string
  pxe_vlan?: string
}

export interface BmcPowerBody {
  action: 'on' | 'off' | 'reset' | 'soft'
}

export interface BmcPowerResult {
  server_id: string
  action: string
  success: boolean
  message: string
}

export const listBaremetalServers = () =>
  platformFetch<BaremetalServer[]>('/api/v1/baremetal/servers')

export const registerBaremetalServer = (body: RegisterBaremetalBody) =>
  platformFetch<BaremetalServer>('/api/v1/baremetal/servers', {
    method: 'POST',
    body: JSON.stringify(body),
  })

export const baremetalServerPower = (id: string, body: BmcPowerBody) =>
  platformFetch<BmcPowerResult>(`/api/v1/baremetal/servers/${id}/power`, {
    method: 'POST',
    body: JSON.stringify(body),
  })
export { retirePlatformVm, exportVmDisk, exportVmIac, downloadVmIacZip, downloadVmIacBundle } from './platformVmLifecycle'
export type { VmIacExportBundle } from './platformVmLifecycle'
export {
  listFleetSnapshotSchedules,
  createFleetSnapshotSchedule,
  deleteFleetSnapshotSchedule,
} from './platformFleetSnapshots'
export type { FleetSnapshotSchedule } from './platformFleetSnapshots'
export { syncKubevirtInventory } from './platformKubevirtSync'
export { getHostGpus } from './platformHostGpu'
export type { HostGpuDevice } from './platformHostGpu'
