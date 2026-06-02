// Copyright (c) 2026 ZyvorAI Labs Private Limited. All rights reserved.

import { platformFetch, getControllerBase, platformHeaders } from './platform'

export interface AiSettings {
  enabled: boolean
  mode: string
  provider: string
  model: string
  api_key_configured: boolean
  autopilot_interval_secs: number
  autopilot_max_actions?: number
  fleet_peer_urls?: string[]
  autopilot_last_run?: string
}

export interface SpotlightIntent {
  id: string
  label: string
  review: string
  action: string
  vm_name?: string
  navigate?: string
  prefill?: Record<string, unknown>
}

export interface SpotlightResult {
  intents: SpotlightIntent[]
  search_hits: Array<{ kind: string; id: string; label: string; sublabel?: string }>
  suggested_action?: SpotlightIntent
}

export interface CopilotResponse {
  reply: string
  deterministic: boolean
  context_summary?: string
}

export interface VmDoctorReport {
  vm_id: string
  vm_name: string
  score: string
  score_numeric: number
  score_label: string
  healthy: boolean
  checks_passed: number
  checks_total: number
  issues: Array<{
    id: string
    severity: string
    message: string
    remediation?: string
    fix_action?: string
    fix_label?: string
  }>
  guest_tools_status: string
}

export interface MigrationAdvisorReport {
  vm_name: string
  provider: string
  readiness_percent: number
  safe: string[]
  risks: string[]
  recommended_target: Record<string, unknown>
  remediation: string[]
  guestkit_boot_score?: number
  guestkit_migration_score?: number
  guestkit_summary?: string
  firewall_dependencies?: string[]
  firewall_migration_summary?: string
}

export interface CostAnalysis {
  estimated_monthly_usd: number
  predicted_next_month_usd?: number
  vm_count: number
  idle_vm_count: number
  oversized_vm_count: number
  snapshot_heavy_count: number
  suggestions: string[]
}

export interface CapacityPlan {
  hosts_online: number
  memory_headroom_mib: number
  avg_cpu_percent: number
  storage_used_gib: number
  storage_capacity_gib: number
  storage_runway_days?: number
  cpu_headroom_percent: number
  estimated_small_vms_addable: number
  recommendations: string[]
}

export interface SecurityReport {
  risk_level: string
  findings: Array<{
    id: string
    severity: string
    title: string
    detail: string
    remediation: string
  }>
}

export const getAiSettings = () => platformFetch<AiSettings>('/api/v1/ai/settings')
export const patchAiSettings = (body: Partial<AiSettings & { api_key?: string }>) =>
  platformFetch<AiSettings>('/api/v1/ai/settings', { method: 'PATCH', body: JSON.stringify(body) })

export const aiSpotlight = (query: string) =>
  platformFetch<SpotlightResult>('/api/v1/ai/spotlight', { method: 'POST', body: JSON.stringify({ query }) })

export const getJarvisLanding = () =>
  platformFetch<SpotlightResult>('/api/v1/ai/jarvis/landing')

export const aiCopilotChat = (message: string, vmId?: string, hostId?: string) =>
  platformFetch<CopilotResponse>('/api/v1/ai/copilot/chat', {
    method: 'POST',
    body: JSON.stringify({ message, vm_id: vmId, host_id: hostId }),
  })

export interface CopilotStreamEvent {
  type: 'chunk' | 'done' | 'error'
  text?: string
  deterministic?: boolean
  context_summary?: string
  message?: string
}

export async function aiCopilotStream(
  message: string,
  vmId: string | undefined,
  onEvent: (ev: CopilotStreamEvent) => void,
  hostId?: string,
): Promise<void> {
  const url = `${getControllerBase()}/api/v1/ai/copilot/stream`
  const res = await fetch(url, {
    method: 'POST',
    credentials: 'same-origin',
    headers: platformHeaders(),
    body: JSON.stringify({ message, vm_id: vmId, host_id: hostId }),
  })
  if (!res.ok) {
    throw new Error(`Copilot stream failed (HTTP ${res.status})`)
  }
  if (!res.body) throw new Error('Copilot stream: empty response body')

  const reader = res.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''

  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })
    const frames = buffer.split('\n\n')
    buffer = frames.pop() ?? ''
    for (const frame of frames) {
      for (const line of frame.split('\n')) {
        if (!line.startsWith('data: ')) continue
        const payload = line.slice(6).trim()
        if (!payload) continue
        onEvent(JSON.parse(payload) as CopilotStreamEvent)
      }
    }
  }
}

export const aiExplain = (screen: string, objectRef: Record<string, unknown> = {}) =>
  platformFetch<{ explanation: string }>('/api/v1/ai/explain', {
    method: 'POST',
    body: JSON.stringify({ screen, object_ref: objectRef }),
  })

export const aiRunbook = (incident: string, context: Record<string, unknown> = {}) =>
  platformFetch<{ incident: string; title: string; steps: string[]; commands: string[]; summary?: string }>(
    '/api/v1/ai/runbook',
    { method: 'POST', body: JSON.stringify({ incident, context }) },
  )

export const aiGenerateBlueprint = (prompt: string) =>
  platformFetch<{ name: string; description: string; actions: string[]; notes: string }>(
    '/api/v1/ai/blueprints/generate',
    { method: 'POST', body: JSON.stringify({ prompt }) },
  )

export const getAiCost = () => platformFetch<CostAnalysis>('/api/v1/ai/cost')
export const getAiCapacity = () => platformFetch<CapacityPlan>('/api/v1/ai/capacity')
export const getAiSecurity = () => platformFetch<SecurityReport>('/api/v1/ai/security')

export const getVmDoctor = (vmId: string) => platformFetch<VmDoctorReport>(`/api/v1/vms/${vmId}/doctor`)

export const getMigrationAdvisor = (vm: string, provider = 'vmware', os?: string, diskPath?: string) => {
  const q = new URLSearchParams({ vm, provider })
  if (os) q.set('os', os)
  if (diskPath) q.set('disk_path', diskPath)
  return platformFetch<MigrationAdvisorReport>(`/api/v1/migrations/advisor?${q}`)
}

export const aiNetworkExplain = (vm_a: string, vm_b: string, port?: number) =>
  platformFetch<{ can_reach: boolean; explanation: string; hops: string[]; remediation: string }>(
    '/api/v1/ai/network/explain',
    { method: 'POST', body: JSON.stringify({ vm_a, vm_b, port }) },
  )

export interface PolicyExport {
  yaml: string
  rule_count: number
  quota_count: number
}

export const getAiPolicyExport = () => platformFetch<PolicyExport>('/api/v1/ai/policy/export')

export interface ProposedAction {
  id: string
  label: string
  review: string
  risk: string
  action_type: string
  object_ref: Record<string, unknown>
}

export interface AutopilotProposal {
  mode: string
  actions: ProposedAction[]
}

export interface ComplianceReport {
  score: number
  grade: string
  summary: string
  checks: Array<{ id: string; name: string; passed: boolean; score: number; detail: string }>
  markdown: string
  finding_count: number
}

export const getAutopilotProposal = (vmId?: string) => {
  const q = vmId ? `?vm_id=${encodeURIComponent(vmId)}` : ''
  return platformFetch<AutopilotProposal>(`/api/v1/ai/autopilot/propose${q}`)
}

export const executeAutopilotAction = (action_type: string, object_ref: Record<string, unknown> = {}) =>
  platformFetch<{ message: string; task_ids: string[] }>('/api/v1/ai/autopilot/execute', {
    method: 'POST',
    body: JSON.stringify({ action_type, object_ref }),
  })

export const getAiCompliance = () => platformFetch<ComplianceReport>('/api/v1/ai/compliance')

export const getAiComplianceExportUrl = () => `${getControllerBase()}/api/v1/ai/compliance/export`

export const getAiCompliancePdfUrl = () => `${getControllerBase()}/api/v1/ai/compliance/export.pdf`

export interface TerminalSuggestResult {
  vm_name: string
  observed_state: string
  suggestions: Array<{ label: string; command: string; description: string; scope: string }>
  notes: string
}

export const aiTerminalSuggest = (vmId?: string, vmName?: string) =>
  platformFetch<TerminalSuggestResult>('/api/v1/ai/terminal/suggest', {
    method: 'POST',
    body: JSON.stringify({ vm_id: vmId, vm_name: vmName }),
  })

export const runAutopilotSafe = (vmId?: string, maxActions = 3) =>
  platformFetch<{ executed_count: number; skipped_count: number; results: Array<{ message: string }> }>(
    '/api/v1/ai/autopilot/run',
    { method: 'POST', body: JSON.stringify({ vm_id: vmId, max_actions: maxActions }) },
  )

export interface AutopilotHistoryEntry {
  id: string
  actor: string
  action: string
  created_at: string
  detail: Record<string, unknown>
}

export const getAutopilotHistory = (limit = 20) =>
  platformFetch<AutopilotHistoryEntry[]>(`/api/v1/ai/autopilot/history?limit=${limit}`)

export const getAiCostExportUrl = () => `${getControllerBase()}/api/v1/ai/cost/export.csv`

export const getAiCapacityExportUrl = () => `${getControllerBase()}/api/v1/ai/capacity/export.csv`

export interface DigitalTwinGraph {
  nodes: Array<{ kind: string; id: string; name: string; state?: string }>
  edges: Array<{ from: string; to: string; label: string }>
  node_count: number
  edge_count: number
}

export interface ImpactAnalysis {
  action: string
  target: string
  severity: string
  summary: string
  affected_vms: string[]
  affected_applications: string[]
  storage_risks: string[]
  network_notes: string[]
  recommendations: string[]
}

export const getDigitalTwinGraph = () => platformFetch<DigitalTwinGraph>('/api/v1/ai/twin/graph')

export const analyzeTwinImpact = (body: { action: string; target_kind: string; target_id: string }) =>
  platformFetch<ImpactAnalysis>('/api/v1/ai/twin/impact', { method: 'POST', body: JSON.stringify(body) })

export interface TimelineEntry {
  at: string
  source: string
  kind: string
  message: string
  severity: string
}

export interface IncidentAnalysis {
  window_hours: number
  timeline: TimelineEntry[]
  root_cause: string
  confidence: number
  contributing_factors: string[]
  suggested_actions: string[]
}

export const analyzeIncident = (params?: { hours?: number; vm_id?: string; vm_name?: string }) => {
  const qs = new URLSearchParams()
  if (params?.hours) qs.set('hours', String(params.hours))
  if (params?.vm_id) qs.set('vm_id', params.vm_id)
  if (params?.vm_name) qs.set('vm_name', params.vm_name)
  const q = qs.toString()
  return platformFetch<IncidentAnalysis>(`/api/v1/ai/incidents/analyze${q ? `?${q}` : ''}`)
}

export interface EnvironmentResourcePlan {
  label: string
  review: string
  developer_count: number
  vm_count: number
  total_vcpus: number
  total_memory_gib: number
  storage_gib: number
  estimated_monthly_usd: number
  environment_type: string
  gpu_required: boolean
  preview_only: boolean
  build_steps: string[]
}

export const planEnvironment = (query: string) =>
  platformFetch<EnvironmentResourcePlan>('/api/v1/ai/intent/environment', {
    method: 'POST',
    body: JSON.stringify({ query }),
  })

export const executeEnvironment = (query: string, dryRun = true) =>
  platformFetch<{ summary: string; plan: EnvironmentResourcePlan; vm_tasks: Array<{ name: string; host: string }> }>(
    '/api/v1/ai/intent/environment/execute',
    { method: 'POST', body: JSON.stringify({ query, dry_run: dryRun }) },
  )

export const getSreRemediate = () =>
  platformFetch<{ summary: string; remediations: Array<{ label: string; review: string; action: string }> }>(
    '/api/v1/ai/sre/remediate',
  )

export const getComplianceRemediate = () =>
  platformFetch<{ summary: string; remediations: Array<{ label: string; framework: string; review: string }> }>(
    '/api/v1/ai/compliance/remediate',
  )

export const getZeusSummary = () =>
  platformFetch<{
    status: string
    tagline: string
    hosts_online: number
    vm_count: number
    monthly_cost_usd: number
    security_risk: string
    compliance_grade: string
    firewall_critical_hosts?: number
    firewall_drift_hosts?: number
    baremetal_critical_count?: number
    exposure_waste_usd?: number
    highlights: string[]
  }>('/api/v1/ai/zeus/summary')

export const getFleetPowerOptimize = () =>
  platformFetch<{ summary: string; total_savings_usd_month: number; optimizations: Array<{ host: string; action: string; reason: string }> }>(
    '/api/v1/ai/fleet/power/optimize',
  )

export const getBaremetalProvision = (id: string) =>
  platformFetch<{ summary: string; steps: string[] }>(`/api/v1/baremetal/servers/${id}/provision`)

export interface SreForecast {
  vm_id: string
  vm_name: string
  resource: string
  severity: string
  message: string
  hours_until_critical?: number
  confidence: number
}

export const getSreForecast = () =>
  platformFetch<{ forecasts: SreForecast[] }>('/api/v1/ai/sre/forecast')

export interface FleetHeatmap {
  hosts: Array<{ host_id: string; hostname: string; cpu_percent: number; memory_percent: number; vm_count: number; classification: string }>
  hotspots: string[]
  cold_hosts: string[]
  power_waste_hosts: string[]
}

export const getFleetHeatmap = () => platformFetch<FleetHeatmap>('/api/v1/ai/fleet/heatmap')

export const getFleetSummary = () =>
  platformFetch<{ summary: string; hosts: number; vms: number; alerts: string[] }>('/api/v1/ai/fleet/summary')

export const getFleetLocal = () =>
  platformFetch<{ summary: string; local_agent: Record<string, unknown> }>('/api/v1/ai/fleet/local')

export interface RebalanceProposal {
  moves: Array<{ vm_id: string; vm_name: string; from_host: string; to_host: string; reason: string; score: number }>
  estimated_savings_pct: number
  summary: string
}

export const getFleetRebalanceProposal = (maxMoves = 5) =>
  platformFetch<RebalanceProposal>(`/api/v1/ai/fleet/rebalance/propose?max_moves=${maxMoves}`)

export interface RebalanceExecuteResult {
  dry_run: boolean
  task_ids: string[]
  moves: RebalanceProposal['moves']
  summary: string
}

export const executeFleetRebalance = (dryRun = true, maxMoves = 5) =>
  platformFetch<RebalanceExecuteResult>('/api/v1/ai/fleet/rebalance/execute', {
    method: 'POST',
    body: JSON.stringify({ dry_run: dryRun, max_moves: maxMoves }),
  })

export interface CostAttributionReport {
  total_monthly_usd: number
  teams: Array<{ team: string; vm_count: number; estimated_monthly_usd: number; exposure_monthly_usd?: number; share_pct: number }>
  unattributed_monthly_usd: number
  summary: string
}

export const getCostAttribution = () => platformFetch<CostAttributionReport>('/api/v1/ai/cost/attribution')

export interface ComplianceFrameworksReport {
  frameworks: Array<{ framework: string; score: number; grade: string; control_count: number; failed_count: number }>
  controls: Array<{ id: string; framework: string; title: string; passed: boolean; score: number }>
  summary: string
}

export const getComplianceFrameworks = () =>
  platformFetch<ComplianceFrameworksReport>('/api/v1/ai/compliance/frameworks')

export interface SecurityGraph {
  nodes: Array<{ id: string; kind: string; label: string; risk?: string }>
  edges: Array<{ from: string; to: string; label: string }>
}

export const getSecurityGraph = () => platformFetch<SecurityGraph>('/api/v1/ai/security/graph')

export const analyzeAttackPath = (source: string, target_vm: string) =>
  platformFetch<{ summary: string; path: string[]; edges: string[]; risk_score: number }>(
    '/api/v1/ai/security/attack-path',
    { method: 'POST', body: JSON.stringify({ source, target_vm }) },
  )

export const searchKnowledge = (query: string) =>
  platformFetch<{ query: string; hits: KnowledgeHit[] }>('/api/v1/ai/knowledge/search', {
    method: 'POST',
    body: JSON.stringify({ query }),
  })

export interface KnowledgeHit {
  kind: string
  id: string
  title: string
  snippet: string
  score: number
  navigate?: string
}

export interface ServiceGraph {
  nodes: Array<{ kind: string; id: string; name: string }>
  edges: Array<{ from: string; to: string; label: string }>
  service_count: number
}

export const getServiceGraph = () => platformFetch<ServiceGraph>('/api/v1/ai/services/graph')

export interface InfrastructureMemory {
  incidents: Array<{ at: string; kind: string; summary: string; actor: string; lesson: string }>
  runbook_hints: string[]
}

export const getInfrastructureMemory = (limit = 20) =>
  platformFetch<InfrastructureMemory>(`/api/v1/ai/memory/incidents?limit=${limit}`)

export interface MissionStackPlan {
  label: string
  review: string
  gpu_node_count: number
  preview_only: boolean
  estimated_monthly_usd: number
  phases: Array<{ name: string; steps: string[]; automated: boolean }>
}

export const planMissionStack = (query: string) =>
  platformFetch<MissionStackPlan>('/api/v1/ai/mission/stack', {
    method: 'POST',
    body: JSON.stringify({ query }),
  })

export interface MissionStackExecuteResult {
  dry_run: boolean
  plan: MissionStackPlan
  vm_tasks: Array<{ name: string; host: string; task_id?: string }>
  summary: string
}

export const executeMissionStack = (query: string, dryRun = true) =>
  platformFetch<MissionStackExecuteResult>('/api/v1/ai/mission/stack/execute', {
    method: 'POST',
    body: JSON.stringify({ query, dry_run: dryRun }),
  })

export const getGpuPlacement = (workload = 'inference') =>
  platformFetch<{ summary: string; candidates: Array<{ hostname: string; gpu_capable: boolean; score: number; reason: string }> }>(
    `/api/v1/ai/fleet/gpu-placement?workload=${encodeURIComponent(workload)}`,
  )

export const diagnoseKnowledge = (query: string) =>
  platformFetch<{ summary: string; hypotheses: Array<{ title: string; confidence: number; evidence: string; action: string }> }>(
    '/api/v1/ai/knowledge/diagnose',
    { method: 'POST', body: JSON.stringify({ query }) },
  )

export const diagnoseFleet = (query: string) =>
  platformFetch<{
    query: string
    summary: string
    zeus_status: string
    linux_summary: string
    hypotheses: Array<{ title: string; confidence: number; evidence: string; action: string }>
  }>('/api/v1/ai/fleet/diagnose', { method: 'POST', body: JSON.stringify({ query }) })

export const simulateServiceImpact = (service: string) =>
  platformFetch<{ summary: string; severity: string; affected_vms: string[] }>(
    '/api/v1/ai/services/impact',
    { method: 'POST', body: JSON.stringify({ service }) },
  )

export const getSimilarIncidents = (q: string, limit = 10) =>
  platformFetch<{ summary: string; incidents: Array<{ kind: string; summary: string; similarity: number }> }>(
    `/api/v1/ai/memory/similar?q=${encodeURIComponent(q)}&limit=${limit}`,
  )

export interface RemediationHubItem {
  id: string
  source: string
  label: string
  review: string
  action: string
  priority: number
  risk: string
}

export const getRemediateHub = () =>
  platformFetch<{ summary: string; items: RemediationHubItem[] }>('/api/v1/ai/remediate/hub')

export const getKnowledgeRunbook = (query: string) =>
  platformFetch<{
    query: string
    diagnosis_summary: string
    runbook_title: string
    steps: string[]
    commands: string[]
    summary: string
  }>('/api/v1/ai/knowledge/runbook', { method: 'POST', body: JSON.stringify({ query }) })

export interface CostBudgetReport {
  monthly_budget_usd: number
  current_spend_usd: number
  predicted_spend_usd: number
  utilization_pct: number
  status: string
  alerts: Array<{ id: string; severity: string; message: string }>
  summary: string
}

export const getCostBudget = () => platformFetch<CostBudgetReport>('/api/v1/ai/cost/budget')

export interface MissionStackStatus {
  gpu_vms: Array<{ name: string; observed_state: string; host: string | null; tags: string[] }>
  environment_vms: Array<{ name: string; observed_state: string; host: string | null; tags: string[] }>
  total_stack_vms: number
  running: number
  summary: string
}

export const getMissionStackStatus = () => platformFetch<MissionStackStatus>('/api/v1/ai/mission/stack/status')

export const getCostAttributionExportUrl = () => '/api/v1/platform/controller/api/v1/ai/cost/attribution/export.csv'

export interface BaremetalServer {
  id: string
  hostname: string
  bmc_address: string
  bmc_type: string
  state: string
  cpu_cores: number
  memory_mib: number
  firewall_profile?: string
  firewall_enabled?: boolean
  bmc_vlan?: string
  pxe_vlan?: string
  created_at?: string
}

export const listBaremetalServers = () => platformFetch<BaremetalServer[]>('/api/v1/baremetal/servers')

export const registerBaremetalServer = (body: {
  hostname: string
  bmc_address: string
  bmc_type?: string
  cpu_cores?: number
  memory_mib?: number
  firewall_profile?: string
  firewall_enabled?: boolean
  bmc_vlan?: string
  pxe_vlan?: string
}) =>
  platformFetch<BaremetalServer>('/api/v1/baremetal/servers', { method: 'POST', body: JSON.stringify(body) })

export const planBaremetalCapacity = (query: string) =>
  platformFetch<{ summary: string; servers_needed: number; total_cpu_cores: number; total_memory_gib: number }>(
    '/api/v1/baremetal/capacity/plan',
    { method: 'POST', body: JSON.stringify({ query }) },
  )

export const setBaremetalPower = (id: string, action: 'on' | 'off' | 'cycle', dryRun = true) =>
  platformFetch<{ summary: string; new_state: string; dry_run: boolean }>(
    `/api/v1/baremetal/servers/${id}/power`,
    { method: 'POST', body: JSON.stringify({ action, dry_run: dryRun }) },
  )

// --- Zeus AI redesign ---

export interface AiProviderRow {
  id: string
  name: string
  kind: string
  base_url: string
  org_id: string
  deployment_name: string
  api_key_configured: boolean
  enabled: boolean
  is_default: boolean
}

export interface AiModelRow {
  id: string
  provider_id: string
  model_id: string
  display_name: string
  context_window: number
  enabled: boolean
}

export interface ZeusAgentInfo {
  id: string
  name: string
  description: string
  task_class: string
}

export interface ZeusChatResponse {
  reply: string
  deterministic: boolean
  agent_id: string
  context_summary?: string
}

export interface AiPromptRow {
  id: string
  scope: string
  title: string
  body: string
  tags: string[]
  agent_id: string
}

export interface MemorySettings {
  enabled: boolean
  team_scope: boolean
  project_scope: boolean
  retention_days: number
}

export interface ZeusActionRow {
  id: string
  source: string
  action_type: string
  label: string
  review: string
  risk: string
  status: string
}

export interface AgentPluginRow {
  slug: string
  name: string
  description: string
  agent_id: string
  installed: boolean
}

export const listAiProviders = () => platformFetch<AiProviderRow[]>('/api/v1/ai/providers')
export const createAiProvider = (body: Record<string, unknown>) =>
  platformFetch<AiProviderRow>('/api/v1/ai/providers', { method: 'POST', body: JSON.stringify(body) })
export const patchAiProvider = (id: string, body: Record<string, unknown>) =>
  platformFetch<AiProviderRow>(`/api/v1/ai/providers/${id}`, { method: 'PATCH', body: JSON.stringify(body) })
export const deleteAiProvider = (id: string) =>
  platformFetch<{ deleted: boolean }>(`/api/v1/ai/providers/${id}`, { method: 'DELETE' })
export const testAiProvider = (id: string) =>
  platformFetch<{ ok: boolean }>(`/api/v1/ai/providers/${id}/test`, { method: 'POST' })
export const listAiProviderModels = (id: string) =>
  platformFetch<AiModelRow[]>(`/api/v1/ai/providers/${id}/models`)

export const listZeusAgents = () => platformFetch<ZeusAgentInfo[]>('/api/v1/ai/agents')

export const zeusChat = (body: {
  message: string
  agent?: string
  vm_id?: string
  host_id?: string
  page_path?: string
}) =>
  platformFetch<ZeusChatResponse>('/api/v1/ai/zeus/chat', { method: 'POST', body: JSON.stringify(body) })

export const listAiPrompts = () => platformFetch<AiPromptRow[]>('/api/v1/ai/prompts')
export const createAiPrompt = (body: Record<string, unknown>) =>
  platformFetch<AiPromptRow>('/api/v1/ai/prompts', { method: 'POST', body: JSON.stringify(body) })
export const deleteAiPrompt = (id: string) =>
  platformFetch<{ deleted: boolean }>(`/api/v1/ai/prompts/${id}`, { method: 'DELETE' })

export const getMemorySettings = () => platformFetch<MemorySettings>('/api/v1/ai/memory/settings')
export const patchMemorySettings = (body: Partial<MemorySettings>) =>
  platformFetch<MemorySettings>('/api/v1/ai/memory/settings', { method: 'PATCH', body: JSON.stringify(body) })

export const getZeusApprovalHub = () =>
  platformFetch<{ zeus_actions: ZeusActionRow[]; total_pending: number; firewall_pending: number }>(
    '/api/v1/ai/actions/hub',
  )

export const executeZeusAction = (id: string) =>
  platformFetch<{ message?: string }>(`/api/v1/ai/actions/${id}/execute`, { method: 'POST' })
export const rejectZeusAction = (id: string) =>
  platformFetch<{ rejected: boolean }>(`/api/v1/ai/actions/${id}/reject`, { method: 'POST' })

export const listAgentMarketplace = () => platformFetch<AgentPluginRow[]>('/api/v1/ai/marketplace/agents')
export const installAgentMarketplace = (slug: string) =>
  platformFetch<AgentPluginRow>(`/api/v1/ai/marketplace/agents/${encodeURIComponent(slug)}/install`, { method: 'POST' })
export const uninstallAgentMarketplace = (slug: string) =>
  platformFetch<AgentPluginRow>(`/api/v1/ai/marketplace/agents/${encodeURIComponent(slug)}/uninstall`, { method: 'POST' })

export const zeusAutonomousPlan = (goal: string, simulate = true, agent?: string) =>
  platformFetch<{ goal: string; agent_id: string; steps: Array<{ title: string; detail: string }> }>(
    '/api/v1/ai/zeus/plan',
    { method: 'POST', body: JSON.stringify({ goal, simulate, agent }) },
  )

export const zeusAutonomousExecute = (goal: string, agent?: string) =>
  platformFetch<{ message: string }>('/api/v1/ai/zeus/execute', {
    method: 'POST',
    body: JSON.stringify({ goal, agent }),
  })
