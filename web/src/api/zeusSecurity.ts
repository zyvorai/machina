// Copyright (c) 2026 ZyvorAI Labs Private Limited. All rights reserved.

import { platformFetch } from './platform'

export interface ZeusSecurityStatus {
  packetwolf: {
    enabled: boolean
    reachable: boolean
    summary: string
    base_url: string
    storage?: {
      clickhouse?: { configured?: boolean; reachable?: boolean }
      opensearch?: { configured?: boolean; reachable?: boolean; document_count?: number }
      demo_mode?: boolean
    }
  }
  zeus_firewall: Record<string, unknown>
  fabric_reachable: boolean
}

export interface FleetThreatSummary {
  fleet_threat_score: number
  firewall_targets: number
  critical_events: Array<Record<string, unknown>>
  packetwolf: Record<string, unknown>
  security_graph_summary: string
}

export interface SecurityGraphNode {
  id: string
  kind: string
  label: string
  risk?: string
}

export interface SecurityGraph {
  nodes: SecurityGraphNode[]
  edges: Array<{ from: string; to: string; label: string }>
}

export interface SecurityEvent {
  id?: string
  host_id?: string
  timestamp?: string
  kind?: string
  severity?: string
  summary?: string
  process?: { pid?: number; ppid?: number; user?: string; binary?: string; args?: string }
  network?: { dst_ip?: string; port?: number; protocol?: string }
  dns?: { query?: string }
  file?: { path?: string; action?: string }
  k8s?: { namespace?: string; pod?: string; container?: string }
  verdict?: string
}

export const getZeusSecurityStatus = () => platformFetch<ZeusSecurityStatus>('/api/v1/zeus-security/status')
export const getFleetThreatSummary = () => platformFetch<FleetThreatSummary>('/api/v1/zeus-security/fleet/threat')
export const getZeusSecurityGraph = () => platformFetch<SecurityGraph>('/api/v1/zeus-security/graph')
export const getZeusSecuritySensors = () => platformFetch<{ sensors: Array<Record<string, unknown>> }>('/api/v1/zeus-security/sensors')
export const getZeusAssetInventory = () => platformFetch<Record<string, unknown>>('/api/v1/zeus-security/asset-inventory')

export const getFleetSecurityTimeline = (hours = 24) =>
  platformFetch<{ events: SecurityEvent[] }>(`/api/v1/zeus-security/fleet/timeline?hours=${hours}`)

export const getSecurityCorrelations = () =>
  platformFetch<{ correlations: Array<Record<string, unknown>> }>('/api/v1/zeus-security/correlations')

export interface FabricHealthIssue {
  severity?: string
  kind?: string
  summary?: string
  host_id?: string
}

export interface FabricHealth {
  status?: string
  sensors_total?: number
  sensors_healthy?: number
  summary?: string
  issues?: FabricHealthIssue[]
  hunt_index?: { configured?: boolean; reachable?: boolean; document_count?: number }
}

export const getFabricHealth = () =>
  platformFetch<FabricHealth>('/api/v1/zeus-security/fabric/health')

export interface HuntQuery {
  id: string
  name: string
  query: string
  description?: string
  severity?: string
}

export const getHuntQueries = () =>
  platformFetch<{ queries: HuntQuery[] }>('/api/v1/zeus-security/hunt/queries')

export const runHuntQuery = (queryId: string, hostId?: string) => {
  const q = hostId ? `?host_id=${encodeURIComponent(hostId)}` : ''
  return platformFetch<{
    ok?: boolean
    query_id?: string
    query_name?: string
    results?: Array<Record<string, unknown>>
    hit_count?: number
    backend?: string
  }>(`/api/v1/zeus-security/hunt/run/${encodeURIComponent(queryId)}${q}`, { method: 'POST' })
}

export const syncSecurityAlerts = () =>
  platformFetch<{ inserted: number; summary: string }>('/api/v1/zeus-security/alerts/sync', { method: 'POST' })

export const getHostSecuritySummary = (hostId: string) =>
  platformFetch<Record<string, unknown>>(`/api/v1/zeus-security/hosts/${hostId}/summary`)

export const getHostProcesses = (hostId: string, hours = 24) =>
  platformFetch<{ processes: SecurityEvent[] }>(`/api/v1/zeus-security/hosts/${hostId}/processes?hours=${hours}`)

export const getHostConnections = (hostId: string, hours = 24) =>
  platformFetch<{ connections: SecurityEvent[] }>(`/api/v1/zeus-security/hosts/${hostId}/connections?hours=${hours}`)

export const getHostDns = (hostId: string, hours = 24) =>
  platformFetch<{ dns: SecurityEvent[] }>(`/api/v1/zeus-security/hosts/${hostId}/dns?hours=${hours}`)

export const getHostSecurityFiles = (hostId: string, hours = 168) =>
  platformFetch<{ files: SecurityEvent[] }>(`/api/v1/zeus-security/hosts/${hostId}/files?hours=${hours}`)

export const getHostSecurityPorts = (hostId: string) =>
  platformFetch<{ ports: Array<Record<string, unknown>> }>(`/api/v1/zeus-security/hosts/${hostId}/ports`)

export interface ContainerHierarchy {
  host_id?: string
  summary?: string
  namespaces?: Array<Record<string, unknown>>
}

export const getHostContainers = (hostId: string) =>
  platformFetch<ContainerHierarchy>(`/api/v1/zeus-security/hosts/${hostId}/containers`)

export const installK8sTetragon = (clusterId: string, clusterName?: string) =>
  platformFetch<{ task_id: string; summary: string }>(`/api/v1/zeus-security/k8s/${encodeURIComponent(clusterId)}/tetragon/install`, {
    method: 'POST',
    body: JSON.stringify({ cluster_name: clusterName ?? clusterId }),
  })

export interface K8sExportForwarderStatus {
  cluster_id: string
  host_id: string
  namespace: string
  forwarder_deployed: boolean
  ready_replicas: number
  export_url: string
  message: string
}

export const getK8sExportStatus = (clusterId: string, namespace = 'kube-system') =>
  platformFetch<K8sExportForwarderStatus>(
    `/api/v1/zeus-security/k8s/${encodeURIComponent(clusterId)}/export-status?namespace=${encodeURIComponent(namespace)}`,
  )

export const getHostSecurityTimeline = (hostId: string, hours = 24) =>
  platformFetch<{ events: SecurityEvent[] }>(`/api/v1/zeus-security/hosts/${hostId}/timeline?hours=${hours}`)

export const getHostProcessGraph = (hostId: string, pid?: number) => {
  const q = pid != null ? `?pid=${pid}` : ''
  return platformFetch<Record<string, unknown>>(`/api/v1/zeus-security/hosts/${hostId}/process-graph${q}`)
}

export const installTetragonSensor = (hostId: string) =>
  platformFetch<{ task_id: string; summary: string }>(`/api/v1/zeus-security/hosts/${hostId}/tetragon/install`, { method: 'POST' })

export interface SecurityFabricStatus {
  policy_dir?: string
  policy_files?: string[]
  install_script_present?: boolean
  tetragon_binary_found?: boolean
  tetragon_service_active?: boolean
  tetragon_export_timer_active?: boolean
  export_url?: string | null
}

export interface HostFabricStatusResponse {
  host_id: string
  agent_reachable: boolean
  message?: string
  fabric?: SecurityFabricStatus
}

export const getHostFabricStatus = (hostId: string) =>
  platformFetch<HostFabricStatusResponse>(`/api/v1/zeus-security/hosts/${hostId}/fabric-status`)

export const searchZeusSecurity = (query: string, hostId?: string) =>
  platformFetch<{ results: SecurityEvent[] }>('/api/v1/zeus-security/search', {
    method: 'POST',
    body: JSON.stringify({ query, host_id: hostId }),
  })

export const explainSecurityEvent = (event: SecurityEvent, hostId?: string) =>
  platformFetch<{ explanation: string; risk: string; recommendation: string; llm_powered?: boolean }>(
    '/api/v1/ai/security/explain-event',
    {
      method: 'POST',
      body: JSON.stringify({ event, host_id: hostId }),
    },
  )

export const reconstructAttack = (hostId: string, hours = 24) =>
  platformFetch<{ attack_chain: string[]; summary: string; llm_powered?: boolean }>(
    '/api/v1/ai/security/attack-reconstruct',
    {
      method: 'POST',
      body: JSON.stringify({ host_id: hostId, hours }),
    },
  )

export const nlSecuritySearch = (query: string, hostId?: string) =>
  platformFetch<{
    original_query: string
    search_query: string
    results: Record<string, unknown>
    hit_count?: number
    search_backend?: string
    llm_powered?: boolean
  }>('/api/v1/ai/security/nl-search', { method: 'POST', body: JSON.stringify({ query, host_id: hostId }) })

export const getSecurityHuntSummary = (hours = 48) =>
  platformFetch<{ summary: string; priority_actions?: string[]; llm_powered?: boolean }>(
    '/api/v1/ai/security/hunt-summary',
    { method: 'POST', body: JSON.stringify({ hours }) },
  )

export interface EnforcementPolicy {
  id?: string
  name: string
  kind: string
  match: string
  enabled?: boolean
  scope?: string
  applied_hosts?: string[]
  description?: string
  backend?: string
}

export interface EnforcementStatus {
  mode?: string
  policies_total?: number
  policies_enabled?: number
  applied_hosts?: string[]
  blocked_events?: number
  summary?: string
  attached?: boolean
  default_deny?: boolean
  api_mode?: string
}

export const attachEnforcement = () =>
  platformFetch<EnforcementStatus>('/api/v1/zeus-security/enforcement/attach', { method: 'POST', body: '{}' })

export const syncEnforcement = () =>
  platformFetch<EnforcementStatus>('/api/v1/zeus-security/enforcement/sync', { method: 'POST', body: '{}' })

export const detachEnforcement = () =>
  platformFetch<EnforcementStatus>('/api/v1/zeus-security/enforcement/detach', { method: 'POST', body: '{}' })

export const getEnforcementStatus = () =>
  platformFetch<EnforcementStatus>('/api/v1/zeus-security/enforcement/status')

export const getEnforcementPolicies = () =>
  platformFetch<{ policies: EnforcementPolicy[] }>('/api/v1/zeus-security/enforcement/policies')

export const createEnforcementPolicy = (body: {
  name: string
  kind: string
  match: string
  description?: string
}) =>
  platformFetch<{ policy: EnforcementPolicy }>('/api/v1/zeus-security/enforcement/policies', {
    method: 'POST',
    body: JSON.stringify(body),
  })

export const applyEnforcementPolicy = (policyId: string, hostIds: string[]) =>
  platformFetch<{ summary: string; task_ids?: string[] }>(`/api/v1/zeus-security/enforcement/policies/${encodeURIComponent(policyId)}/apply`, {
    method: 'POST',
    body: JSON.stringify({ host_ids: hostIds }),
  })

export const patchEnforcementPolicy = (
  policyId: string,
  body: { enabled?: boolean; match?: string; description?: string },
) =>
  platformFetch<{ summary: string; task_ids?: string[]; packetwolf?: Record<string, unknown> }>(
    `/api/v1/zeus-security/enforcement/policies/${encodeURIComponent(policyId)}`,
    { method: 'PATCH', body: JSON.stringify(body) },
  )

export const deleteEnforcementPolicy = (policyId: string) =>
  platformFetch<{ summary: string; task_ids?: string[] }>(
    `/api/v1/zeus-security/enforcement/policies/${encodeURIComponent(policyId)}`,
    { method: 'DELETE' },
  )

export const getEnforcementPolicyTetragon = (policyId: string) =>
  platformFetch<{ tetragon_policy?: Record<string, unknown>; tetragon_policy_name?: string }>(
    `/api/v1/zeus-security/enforcement/policies/${encodeURIComponent(policyId)}/tetragon`,
  )

export interface FleetSensorRow {
  host_id: string
  hostname: string
  host_state: string
  tetragon_status: string
  last_event_at?: string
  sensor?: Record<string, unknown>
}

export const getFleetSensors = () =>
  platformFetch<{ matrix: FleetSensorRow[]; summary?: string; sensors?: Array<Record<string, unknown>> }>(
    '/api/v1/zeus-security/fleet/sensors',
  )

export const installFleetTetragon = () =>
  platformFetch<{ task_ids: string[]; hosts: number; summary: string }>(
    '/api/v1/zeus-security/fleet/tetragon/install',
    { method: 'POST', body: '{}' },
  )

export const getHostEnforcement = (hostId: string) =>
  platformFetch<Record<string, unknown>>(`/api/v1/zeus-security/hosts/${hostId}/enforcement`)

export const getAgentSecurityBundle = (hostId: string) =>
  platformFetch<{
    host_id: string
    tracing_policies?: unknown[]
    policy_count?: number
    tetragon_install?: Record<string, unknown>
  }>(`/api/v1/zeus-security/agents/${hostId}/bundle`)
