// Copyright (c) 2026 ZyvorAI Labs Private Limited. All rights reserved.

import type { Page } from '@playwright/test'

export const platformInfo = {
  version: '0.1.0-test',
  tls: { enabled: false },
  auth: { pam_service: 'sshd', oidc_enabled: false },
  control_plane: {
    proxy_url: '/api/v1/platform/controller',
    direct_url: 'http://127.0.0.1:5093',
  },
  kubevirt: { exec_enabled: true },
  openstack: {
    enabled: true,
    configured: true,
    cloud_name: 'test',
    upload_enabled: false,
    upload_timeout_secs: 300,
    default_os_cloud: 'test',
    default_boot_instance: false,
  },
  hypersdk: { enabled: true, base_url: 'http://127.0.0.1:8787', insecure_tls: true },
  guestkit: { enabled: true, base_url: 'http://127.0.0.1:8790', insecure_tls: true },
  fleet: { enabled: false, peer_count: 0 },
}

const fleetFinder = {
  summary: '2 VM(s) · 1 running',
  smart_folders: [
    { id: 'all', label: 'All VMs', count: 2, icon: 'all' },
    { id: 'running', label: 'Running', count: 1, icon: 'running' },
  ],
  tags: [],
  projects: [],
}

const fleetMission = {
  sites: [
    {
      name: 'DC-1',
      racks: [
        {
          name: 'Rack A',
          hosts: [
            {
              id: 'h1',
              hostname: 'host-1',
              address: '127.0.0.1',
              state: 'online',
              maintenance_mode: false,
              vm_count: 1,
              cpu_percent: 35,
              memory_used_mib: 4096,
              memory_total_mib: 16384,
              site: 'DC-1',
              rack: 'Rack A',
              rack_u: 10,
            },
          ],
        },
      ],
    },
  ],
  unassigned_hosts: [],
  summary: { hosts: 1, vms: 1, hosts_online: 1, health_pct: 100 },
}

const fleetMaintenanceMission = {
  summary: '1 host(s) with updates · 0 in maintenance · 0 pending schedule(s)',
  hosts_with_updates: 1,
  hosts_in_maintenance: 0,
  pending_schedules: 0,
  hosts: [
    {
      host_id: 'h1',
      hostname: 'host-1',
      state: 'online',
      maintenance_mode: false,
      validation_status: 'ok',
      pending_packages: 3,
      reboot_required: false,
      agent_drift: false,
      update_summary: '3 packages would be upgraded',
      recommended_step: 'schedule',
      steps: [
        { id: 'scan', label: 'Scan fleet', status: 'done', detail: null },
        { id: 'assess', label: 'Assess risk', status: 'done', detail: '3 packages would be upgraded' },
        { id: 'schedule', label: 'Schedule window', status: 'ready', detail: null },
        { id: 'enter_maintenance', label: 'Enter maintenance', status: 'blocked', detail: null },
        { id: 'evacuate', label: 'Evacuate VMs', status: 'skipped', detail: null },
        { id: 'apply_preview', label: 'Apply preview', status: 'blocked', detail: 'Preview on host' },
        { id: 'verify_exit', label: 'Verify & exit', status: 'pending', detail: null },
      ],
      blockers: ['Schedule a maintenance window before entering maintenance.'],
    },
  ],
}

const fleetDna = {
  score: 88,
  grade: 'B',
  summary: 'Infrastructure DNA 88/100 (grade B)',
  pillars: [
    { id: 'availability', label: 'Availability', score: 100, detail: '100% fleet health · 1 hosts online' },
    { id: 'patch_hygiene', label: 'Patch hygiene', score: 0, detail: '1 of 1 hosts need OS updates' },
    { id: 'linux_health', label: 'Linux health', score: 100, detail: 'Linux health OK' },
    { id: 'backup_posture', label: 'Storage posture', score: 95, detail: 'Storage OK' },
    { id: 'compliance', label: 'Compliance', score: 82, detail: 'Fleet ops grade B+' },
  ],
}

const jarvisLanding = {
  intents: [
    { id: 'jarvis-mission-control', label: 'Mission Control', review: 'Infrastructure Earth globe', action: 'navigate', navigate: '/platform?mission=1' },
    { id: 'jarvis-maintenance-mission', label: 'Maintenance Mission', review: 'Patch timeline', action: 'navigate', navigate: '/platform/maintenance?tab=mission' },
    { id: 'jarvis-machine-finder', label: 'Machine Finder', review: 'Geography', action: 'navigate', navigate: '/platform/hosts/finder' },
    { id: 'jarvis-enterprise', label: 'Enterprise Keychain', review: 'Vault and MFA inventory', action: 'navigate', navigate: '/platform/enterprise?tab=keychain' },
  ],
  search_hits: [],
}

const enterpriseSecurity = {
  vault_providers: 1,
  vault_connected: 1,
  mfa_policies: 1,
  mfa_required_roles: 1,
  air_gap_bundles: 0,
  mfa_enrolled_users: 2,
  tenant_policies: 1,
  fips_profiles: 2,
  summary: '1 vault · 2 MFA enrolled · 1 tenant policy',
}

const enterpriseVaults = [
  { id: 'vault-1', name: 'corp-vault', provider_type: 'hashicorp', address: 'https://vault.local', namespace: 'machina', status: 'connected', last_sync_at: null },
]

const enterpriseMfa = {
  summary: '1 role requires MFA',
  users: [{ username: 'admin', role: 'admin', required_method: 'totp', compliant: true }],
}

const enterpriseFips = {
  summary: 'OpenSSL profiles',
  openssl_version: '3.0',
  profiles: [{ id: 'default', name: 'Default', tls_min_version: '1.2', fips_mode: 'off', cipher_suites: 'TLS_AES_256', notes: 'Lab profile' }],
}

const enterpriseTenants = {
  summary: '1 workspace',
  projects: [{ project_name: 'default', vm_count: 2, max_vms: 50, network_isolation: 'shared', enforce_quotas: true, quota_status: 'ok' }],
}

const fleetKeychain = {
  summary: '2 credential entries',
  vault_providers: 1,
  vault_connected: 1,
  disconnected_vaults: 0,
  mfa_policies: 1,
  mfa_enrolled_users: 2,
  api_keys: 1,
  air_gap_bundles: 0,
  entries: [
    { kind: 'vault', id: 'v1', name: 'corp-vault', summary: 'HashiCorp · connected', status: 'active' },
    { kind: 'api_key', id: 'k1', name: 'automation', summary: 'Platform API key', status: 'active' },
  ],
}

const fleetUpdates = {
  summary: '1 host with pending updates',
  recommended_agent: '0.1.0-test',
  hosts_scanned: 1,
  hosts_with_updates: 1,
  hosts_reboot_required: 0,
  agent_drift_count: 0,
  total_pending_packages: 3,
  hosts: [
    {
      host_id: 'h1',
      hostname: 'host-1',
      agent_version: '0.1.0-test',
      agent_update_available: false,
      backend: 'apt',
      pending_count: 3,
      summary: '3 packages would be upgraded',
      reboot_required: false,
      status: 'updates',
    },
  ],
}

const fleetGpu = {
  summary: '1 GPU host(s) · 1 GPU VM(s) · 1 CUDA-ready',
  gpu_host_count: 1,
  gpu_vm_count: 1,
  cuda_ready_hosts: 1,
  mig_hosts: 0,
  vgpu_hosts: 0,
  hosts: [
    {
      host_id: 'h1',
      hostname: 'host-1',
      site: 'DC-1',
      rack: 'Rack A',
      state: 'online',
      gpu_capable: true,
      profile: 'cuda',
      model_hint: 'NVIDIA L40',
      vm_count: 1,
      gpu_vm_count: 1,
      vgpu_slices: 0,
      cuda_ready: true,
    },
  ],
  vms: [
    {
      vm_id: 'v1',
      vm_name: 'vm-1',
      host_id: 'h1',
      hostname: 'host-1',
      observed_state: 'running',
      profile: 'cuda',
      tags: ['gpu', 'inference'],
    },
  ],
  profiles: [{ kind: 'cuda', label: 'CUDA ready', host_count: 1, vm_count: 1 }],
}

const opsRunbooks = [
  {
    id: 'rb-1',
    incident: 'host-offline',
    title: 'Host offline recovery',
    category: 'infra',
    severity: 'high',
    auto_trigger: 'host.offline',
  },
]

const opsShowback = {
  summary: 'Project showback rollup',
  total_cost_usd: 850,
  fleet_grade: 'B+',
  lines: [{ project_name: 'default', cost_usd: 850, compliance_grade: 'B+', vm_count: 1 }],
}

const fleetDesktop = {
  hosts_online: 1,
  hosts_total: 1,
  active_tasks: 0,
  slo_breach_count: 0,
  slo_count: 1,
  pressure_hosts: 0,
  zeus_status: 'idle',
  unread_notifications: 0,
  linux_summary: 'OK',
}

const sampleHost = {
  id: 'h1',
  hostname: 'host-1',
  address: '127.0.0.1',
  state: 'online',
  maintenance_mode: false,
  vm_count: 2,
  last_heartbeat_at: new Date().toISOString(),
}

const staleHost = {
  id: 'h-stale',
  hostname: 'stale-host',
  address: '127.0.0.2',
  state: 'offline',
  maintenance_mode: false,
  vm_count: 0,
  last_heartbeat_at: new Date(Date.now() - 5 * 60_000).toISOString(),
}

const sampleTemplate = {
  id: 'tpl-1',
  name: 'ubuntu-24.04',
  version: '1',
  source_disk: '/var/lib/libvirt/images/ubuntu.qcow2',
  cloud_init: true,
  os_family: 'linux',
  category: 'Ubuntu',
  description: 'Ubuntu 24.04 LTS golden image',
  featured: true,
  marketplace: true,
  icon: 'ubuntu',
}

const sampleVm = {
  id: 'v1',
  name: 'vm-1',
  host_id: 'h1',
  observed_state: 'running',
  desired_state: 'running',
  lifecycle_phase: 'ready',
  managed: true,
  vcpus: 2,
  memory_mib: 2048,
  ha_enabled: false,
  project: null,
  tags: [],
}

export async function mockPlatformApi(page: Page, opts?: {
  tier?: 'normal' | 'power' | 'advanced'
  staleHost?: boolean
  emptyStorage?: boolean
  templateNotReady?: boolean
}) {
  const tier = opts?.tier ?? 'normal'
  let storagePools: Array<{ id: string; name: string; path: string; capacity_gib: number; used_gib: number }> =
    opts?.emptyStorage ? [] : [{ id: 'p1', name: 'default', path: '/var/lib/libvirt/images', capacity_gib: 500, used_gib: 12 }]
  await page.addInitScript((t) => {
    localStorage.setItem('zyvor-platform-welcome-done', '1')
    localStorage.setItem('machina-platform-desktop-tier', t)
    localStorage.removeItem('machina_platform_controller')
  }, tier)

  await page.route('**/api/v1/**', async (route) => {
    const url = route.request().url()
    if (url.includes('/auth/session')) {
      return route.fulfill({
        json: { authenticated: true, username: 'admin', role: 'admin', auth_source: 'pam' },
      })
    }
    if (url.includes('/auth/providers')) {
      return route.fulfill({
        json: { pam: { enabled: true }, ldap: { enabled: false }, oidc: { enabled: false } },
      })
    }
    if (url.includes('/system/platform-info')) {
      return route.fulfill({ json: platformInfo })
    }
    if (url.includes('/events/stream') || url.includes('/ws/')) {
      return route.abort()
    }
    if (url.includes('/fleet/finder')) {
      return route.fulfill({ json: fleetFinder })
    }
    if (url.includes('/fleet/maintenance-mission')) {
      return route.fulfill({ json: fleetMaintenanceMission })
    }
    if (url.match(/\/fleet\/mission(\?|$|\/)/)) {
      return route.fulfill({ json: fleetMission })
    }
    if (url.match(/\/fleet\/gpu(\?|$|\/)/)) {
      return route.fulfill({ json: fleetGpu })
    }
    if (url.match(/\/fleet\/dna(\?|$|\/)/)) {
      return route.fulfill({ json: fleetDna })
    }
    if (url.includes('/ai/jarvis/landing')) {
      return route.fulfill({ json: jarvisLanding })
    }
    if (url.includes('/ai/incidents/analyze')) {
      return route.fulfill({
        json: {
          root_cause: 'No critical incidents in the selected window.',
          confidence: 0.72,
          suggested_actions: ['Review host pressure metrics', 'Open Mission Control'],
          events: [],
        },
      })
    }
    if (url.includes('/ai/mission/stack/status')) {
      return route.fulfill({ json: { summary: 'No active mission stack', status: 'idle' } })
    }
    if (url.includes('/enterprise/security/overview')) {
      return route.fulfill({ json: enterpriseSecurity })
    }
    if (url.includes('/enterprise/vault/providers') && route.request().method() === 'POST') {
      return route.fulfill({ status: 500, json: { error: 'vault sync failed' } })
    }
    if (url.includes('/enterprise/vault/sync-all') && route.request().method() === 'POST') {
      return route.fulfill({ status: 500, json: { error: 'vault sync failed' } })
    }
    if (url.includes('/enterprise/vault/providers')) {
      return route.fulfill({ json: enterpriseVaults })
    }
    if (url.includes('/enterprise/mfa/compliance')) {
      return route.fulfill({ json: enterpriseMfa })
    }
    if (url.includes('/enterprise/fips/matrix')) {
      return route.fulfill({ json: enterpriseFips })
    }
    if (url.includes('/enterprise/tenants/overview')) {
      return route.fulfill({ json: enterpriseTenants })
    }
    if (url.match(/\/fleet\/keychain(\?|$|\/)/)) {
      return route.fulfill({ json: fleetKeychain })
    }
    if (url.includes('/fleet/updates')) {
      return route.fulfill({ json: fleetUpdates })
    }
    if (url.includes('/maintenance/schedules') && route.request().method() === 'POST') {
      if (url.includes('fail-schedule')) {
        return route.fulfill({ status: 500, json: { error: 'schedule failed' } })
      }
      return route.fulfill({
        json: {
          id: 'sched-1',
          host_id: 'h1',
          action: 'enter',
          evacuate: true,
          run_at: new Date().toISOString(),
          status: 'pending',
        },
      })
    }
    if (url.includes('/maintenance/schedules')) {
      return route.fulfill({ json: [] })
    }
    if (url.includes('/hosts/') && url.includes('/maintenance') && route.request().method() === 'POST') {
      return route.fulfill({ json: { task_id: 'task-maint-1' } })
    }
    if (url.includes('/ai/fleet/gpu-placement')) {
      return route.fulfill({
        json: {
          summary: '1 GPU-capable host(s) for inference — top: host-1',
          candidates: [{ host_id: 'h1', hostname: 'host-1', gpu_capable: true, numa_hint: 'NUMA 0', score: 92, reason: 'GPU-tagged host · CPU 35% · 1 VMs' }],
        },
      })
    }
    if (url.includes('/operations/showback')) {
      return route.fulfill({ json: opsShowback })
    }
    if (url.includes('/operations/overview')) {
      return route.fulfill({ json: { runbook_count: 1, executions_24h: 0, compliance_grade: 'B+' } })
    }
    if (url.includes('/operations/executions')) {
      return route.fulfill({ json: [] })
    }
    if (url.includes('/operations/runbooks') && route.request().method() === 'POST') {
      return route.fulfill({ json: { summary: 'Runbook steps recorded', steps: ['Verify host heartbeat', 'Restart libvirtd if needed'] } })
    }
    if (url.includes('/operations/runbooks')) {
      return route.fulfill({ json: opsRunbooks })
    }
    if (url.includes('/reports/capacity')) {
      return route.fulfill({
        json: { hosts_online: 1, running_vms: 1, memory_headroom_mib: 8192, avg_cpu_percent: 35 },
      })
    }
    if (url.includes('/reports/finops')) {
      return route.fulfill({
        json: {
          estimated_monthly_usd: 100,
          total_vcpu: 4,
          vcpu_hour_usd: 0.01,
          total_memory_gib: 8,
          gib_hour_usd: 0.005,
          vm_count: 1,
          running_vms: 1,
        },
      })
    }
    if (url.includes('/projects')) {
      return route.fulfill({ json: [{ name: 'default', vm_count: 1 }] })
    }
    if (url.includes('/fleet/desktop')) {
      return route.fulfill({ json: fleetDesktop })
    }
    if (url.includes('/policy/rules')) {
      return route.fulfill({ json: [{ id: '1', name: 'default', enabled: true, rule_json: {} }] })
    }
    if (url.includes('/policy/quotas')) {
      return route.fulfill({
        json: [{ project: 'default', max_vms: 50, max_vcpu: 200, max_memory_mib: 409600, max_storage_gib: 5000 }],
      })
    }
    if (url.includes('/audit')) {
      return route.fulfill({ json: [{ id: 'a1', actor: 'admin', action: 'login', created_at: new Date().toISOString() }] })
    }
    if (url.includes('/observability/overview')) {
      return route.fulfill({
        json: {
          summary: 'SLOs OK',
          slos: [{
            name: 'API latency',
            target: 'p99 < 500ms',
            objective_pct: 99,
            current_pct: 99.2,
            burn_rate: 0.01,
            status: 'ok',
            description: 'Within SLO',
          }],
          trace_count_1h: 12,
          p95_latency_ms: 45,
        },
      })
    }
    if (url.includes('/observability/traces')) {
      return route.fulfill({ json: [] })
    }
    if (url.includes('/placement/recommendations') || url.includes('/placement/refresh')) {
      return route.fulfill({ json: [] })
    }
    if (url.includes('/ha/status')) {
      return route.fulfill({
        json: {
          status: { enabled_vms: 0, offline_hosts: 0, recent_events: 0 },
          events: [],
        },
      })
    }
    if (url.includes('/cluster/settings')) {
      return route.fulfill({
        json: {
          drs_auto_migrate: false,
          drs_cpu_threshold: 80,
          ha_enabled: true,
          placement_policy: 'balanced',
          inventory_sync_interval_secs: 60,
        },
      })
    }
    if (url.includes('/migrations')) {
      return route.fulfill({ json: [] })
    }
    if (url.includes('/fence/events')) {
      return route.fulfill({ json: [] })
    }
    if (url.includes('/storage/pools/discover')) {
      storagePools = [{ id: 'p1', name: 'default', path: '/var/lib/libvirt/images', capacity_gib: 500, used_gib: 12 }]
      return route.fulfill({ json: { imported: 1, pools: storagePools } })
    }
    if (url.includes('/networks/discover')) {
      return route.fulfill({ json: { imported: 1, networks: [{ id: 'n1', name: 'default', bridge: 'virbr0' }] } })
    }
    if (url.includes('/storage/pools') && !url.includes('/discover')) {
      return route.fulfill({ json: storagePools })
    }
    if (url.includes('/storage/tiers')) {
      return route.fulfill({ json: { tiers: [], pools: [] } })
    }
    if (url.includes('/network/segments/overview')) {
      return route.fulfill({ json: { segments: [], summary: 'No segments' } })
    }
    if (url.includes('/storage/backup-sla')) {
      return route.fulfill({ json: { policies: [], summary: 'No SLA configured' } })
    }
    if (url.includes('/fleet/storage')) {
      return route.fulfill({
        json: {
          summary: 'OK',
          pool_count: 0,
          tier_count: 0,
          total_capacity_gib: 0,
          total_used_gib: 0,
          pools_over_85_pct: 0,
          smart_failure_count: 0,
          smart_hosts_affected: 0,
          pools: [],
          smart_disks: [],
        },
      })
    }
    if (url.includes('/zeus-security/')) {
      if (url.includes('/status')) {
        return route.fulfill({
          json: {
            fabric_reachable: true,
            packetwolf: {
              enabled: true,
              reachable: true,
              summary: 'PacketWolf connected',
              base_url: 'http://127.0.0.1:9091',
              storage: {
                clickhouse: { configured: true, reachable: true },
                opensearch: { configured: true, reachable: true, document_count: 128 },
                demo_mode: true,
              },
            },
            zeus_firewall: { ready: true },
          },
        })
      }
      if (url.includes('/fleet/threat')) {
        return route.fulfill({
          json: {
            fleet_threat_score: 78,
            firewall_targets: 1,
            critical_events: [{ summary: 'Possible reverse shell on port 4444', host_id: 'h1', severity: 'critical' }],
            packetwolf: { fleet_threat_score: 78 },
            security_graph_summary: '4 nodes · 3 edges in infrastructure security graph',
          },
        })
      }
      if (url.includes('/fleet/timeline')) {
        return route.fulfill({
          json: {
            events: [
              { summary: 'curl started', host_id: 'h1', severity: 'info', timestamp: new Date().toISOString() },
              { summary: 'Privilege escalation chain', host_id: 'h1', severity: 'high', kind: 'correlation' },
            ],
          },
        })
      }
      if (url.includes('/fabric/health')) {
        return route.fulfill({
          json: {
            status: 'healthy',
            sensors_total: 1,
            sensors_healthy: 1,
            summary: '1 sensor(s) · 128 OpenSearch doc(s)',
            hunt_index: { configured: true, reachable: true, document_count: 128 },
            issues: [],
          },
        })
      }
      if (url.includes('/hunt/queries')) {
        return route.fulfill({
          json: {
            queries: [
              { id: 'reverse-shell', name: 'Reverse shell listeners', query: 'nc OR netcat', severity: 'critical' },
            ],
          },
        })
      }
      if (url.includes('/hunt/run/')) {
        return route.fulfill({
          json: {
            ok: true,
            query_id: 'reverse-shell',
            query_name: 'Reverse shell listeners',
            backend: 'opensearch',
            hit_count: 1,
            results: [{ summary: 'nc listener on 4444', host_id: 'h1', severity: 'critical' }],
          },
        })
      }
      if (url.includes('/correlations')) {
        return route.fulfill({
          json: { correlations: [{ severity: 'high', summary: 'Suspicious DNS cluster', host_id: 'h2' }] },
        })
      }
      if (url.includes('/enforcement/status')) {
        return route.fulfill({
          json: {
            mode: 'enforce',
            policies_total: 4,
            policies_enabled: 4,
            applied_hosts: ['h1'],
            blocked_events: 2,
            summary: '4 active policy(ies) · 2 blocked event(s) in store',
          },
        })
      }
      if (url.includes('/enforcement/policies') && url.includes('/apply')) {
        return route.fulfill({
          json: { ok: true, summary: 'Applied Block reverse-shell listeners to 1 host(s)' },
        })
      }
      if (url.includes('/enforcement/policies') && route.request().method() === 'POST') {
        return route.fulfill({
          json: { policy: { id: 'pol-new', name: 'test', kind: 'deny_process', match: '/bin/sh', enabled: true } },
        })
      }
      if (url.includes('/enforcement/policies')) {
        return route.fulfill({
          json: {
            policies: [
              { id: 'pol-deny-nc', name: 'Block reverse-shell listeners', kind: 'deny_process', match: '/usr/bin/nc', enabled: true },
            ],
          },
        })
      }
      if (url.includes('/enforcement')) {
        return route.fulfill({ json: { mode: 'observe', policies: [] } })
      }
      if (url.includes('/agents/') && url.includes('/bundle')) {
        return route.fulfill({
          json: { host_id: 'h1', policy_count: 2, tracing_policies: [{ kind: 'TracingPolicy' }] },
        })
      }
      if (url.includes('/alerts/sync')) {
        return route.fulfill({ json: { inserted: 1, summary: 'Synced 1 security alert(s) to notification outbox' } })
      }
      if (url.includes('/graph')) {
        return route.fulfill({
          json: {
            nodes: [
              { id: 'user-1', kind: 'user', label: 'admin', risk: 'high' },
              { id: 'host-h1', kind: 'host', label: 'host-1', risk: 'medium' },
            ],
            edges: [{ from: 'user-1', to: 'host-h1', label: 'admin access' }],
          },
        })
      }
      if (url.includes('/sensors')) {
        return route.fulfill({ json: { sensors: [{ host_id: 'h1', status: 'healthy', tetragon_version: '1.0.0' }] } })
      }
      if (url.includes('/process-graph')) {
        return route.fulfill({
          json: {
            nodes: [{ pid: 1000, binary: '/usr/sbin/sshd' }, { pid: 1234, binary: '/bin/bash' }],
            edges: [{ from: 1000, to: 1234, binary: '/bin/bash' }],
          },
        })
      }
      if (url.includes('/timeline') || url.includes('/processes')) {
        return route.fulfill({
          json: {
            events: [{ summary: 'curl started', kind: 'process_exec', severity: 'info', timestamp: new Date().toISOString() }],
            processes: [{ summary: 'kubectl started', kind: 'process_exec', process: { binary: '/usr/bin/kubectl', pid: 1235 } }],
          },
        })
      }
      if (url.includes('/fabric-status')) {
        return route.fulfill({
          json: {
            host_id: 'h1',
            agent_reachable: true,
            fabric: {
              policy_dir: '/var/lib/machina/tetragon/tracing-policies',
              policy_files: ['packetwolf-pol-deny-nc.json'],
              install_script_present: true,
              tetragon_binary_found: true,
              tetragon_service_active: true,
              tetragon_export_timer_active: true,
              export_url: 'http://127.0.0.1:9091/api/v1/ingest',
            },
          },
        })
      }
      if (url.includes('/summary')) {
        return route.fulfill({ json: { host_id: 'h1', threat_score: 75, sensor: { status: 'healthy' } } })
      }
      if (url.includes('/containers')) {
        return route.fulfill({
          json: {
            host_id: 'h1',
            summary: '2 namespace(s) with pod/container metadata from Tetragon',
            namespaces: [
              {
                namespace: 'zeus',
                event_count: 4,
                pods: [
                  {
                    pod: 'api-server-7f8c9',
                    deployment: 'api-server',
                    containers: [{ container: 'api', event_count: 3, max_severity: 'info', processes: ['/app/server'] }],
                  },
                ],
              },
            ],
          },
        })
      }
      if (url.includes('/asset-inventory')) {
        return route.fulfill({
          json: { hosts: [{ host_id: 'h1', processes: ['nginx', 'postgres'], connections: [{ from: 'nginx', to: 'redis:6379' }] }] },
        })
      }
      return route.fulfill({ json: { ports: [], connections: [], dns: [], files: [] } })
    }
    if (url.includes('/fleet/') && !url.match(/\/fleet\/(finder|mission|gpu|desktop|storage|network|console|updates|keychain|users|shortcuts|spaces|general|linux|backups|activity|dna|maintenance-mission)/)) {
      return route.fulfill({ json: { summary: 'Fleet aggregate OK', hosts: [], entries: [] } })
    }
    if (url.includes('/cluster')) {
      return route.fulfill({ json: { name: 'e2e-cluster', hosts: 1, vms: 2, offline_hosts: 0 } })
    }
    if (url.includes('/templates/') && url.includes('/readiness')) {
      if (opts?.templateNotReady) {
        return route.fulfill({
          json: {
            disk_exists: false,
            host_online: 1,
            cloud_init: true,
            ready: false,
            remediation: 'Upload the golden image to Content Library.',
            source_disk: sampleTemplate.source_disk,
          },
        })
      }
      return route.fulfill({
        json: {
          disk_exists: true,
          host_online: 1,
          cloud_init: true,
          ready: true,
          remediation: 'Disk present on 1 online host(s).',
          source_disk: sampleTemplate.source_disk,
        },
      })
    }
    if (url.includes('/templates/seed')) {
      return route.fulfill({ json: { inserted: 1, templates: [sampleTemplate] } })
    }
    if (url.includes('/templates/marketplace')) {
      return route.fulfill({ json: [sampleTemplate] })
    }
    if (url.includes('/templates')) {
      return route.fulfill({ json: [sampleTemplate] })
    }
    if (url.includes('/hosts')) {
      if (opts?.emptyStorage) {
        return route.fulfill({ json: [{ ...sampleHost, state: 'offline' }] })
      }
      const hosts = opts?.staleHost ? [sampleHost, staleHost] : [sampleHost]
      return route.fulfill({ json: hosts })
    }
    if (url.match(/\/vms\/[^/]+\/topology/)) {
      return route.fulfill({
        json: {
          nodes: [{ id: 'n1', name: 'vm-1', kind: 'vm' }, { id: 'n2', name: 'host-1', kind: 'host' }],
          edges: [{ from: 'n1', to: 'n2', label: 'runs_on' }],
        },
      })
    }
    if (url.match(/\/vms\/[^/]+(\?|$)/) || url.match(/\/vms\/[^/]+$/)) {
      return route.fulfill({ json: sampleVm })
    }
    if (url.includes('/vms')) {
      return route.fulfill({ json: [sampleVm] })
    }
    if (url.includes('/zeus-firewall/overview')) {
      return route.fulfill({
        json: {
          summary: '1 target monitored',
          critical_count: 0,
          warning_count: 0,
          targets: [{ id: 'h1', hostname: 'host-1', kind: 'host', risk: 'ok', score: 92 }],
        },
      })
    }
    if (url.includes('/zeus-firewall/multisite/dr-templates')) {
      return route.fulfill({
        json: {
          summary: '2 DR profile pairs',
          profiles: [{ primary_profile: 'ProductionServer', dr_profile: 'DRServer' }],
        },
      })
    }
    if (url.includes('/zeus-firewall/policies')) {
      return route.fulfill({ json: [{ id: 'p1', name: 'production-default', profile: 'ProductionServer', enabled: true }] })
    }
    if (url.includes('/tasks')) {
      return route.fulfill({ json: [] })
    }
    if (url.includes('/notifications')) {
      return route.fulfill({ json: [] })
    }
    if (url.includes('/backup-targets')) {
      return route.fulfill({ json: [{ id: 't1', name: 'nfs-primary', kind: 'nfs', config_json: {} }] })
    }
    if (url.includes('/developer/overview')) {
      return route.fulfill({
        json: {
          summary: 'Developer SDK',
          openapi_url: '/api/v1/openapi.json',
          sdk_typescript: { version: '1.0', path: 'sdk/typescript', install: 'npm install @zyvor/machina-sdk', resources: ['hosts', 'vms'] },
          terraform: { provider_source: 'registry', examples_path: 'examples', resources: [{ name: 'machina_vm' }] },
        },
      })
    }
    if (url.includes('/openapi.json')) {
      const paths: Record<string, Record<string, { summary: string; tags?: string[] }>> = {}
      for (let i = 0; i < 60; i += 1) {
        paths[`/api/v1/hosts/h${i}`] = { get: { summary: `Get host ${i}`, tags: ['hosts'] } }
      }
      paths['/api/v1/hosts'] = { get: { summary: 'List hosts', tags: ['hosts'] } }
      paths['/api/v1/vms'] = { get: { summary: 'List VMs', tags: ['vms'] } }
      paths['/api/v1/health'] = { get: { summary: 'Health check', tags: ['health'] } }
      return route.fulfill({ json: { openapi: '3.0.3', paths } })
    }
    if (url.includes('/users/me')) {
      return route.fulfill({ json: { id: 'u1', username: 'admin', role: 'admin' } })
    }
    if (url.includes('/backups/timeline')) {
      return route.fulfill({ json: [] })
    }
    if (url.includes('/openstack/status')) {
      return route.fulfill({
        json: {
          reachable: true,
          keystone_reachable: true,
          compute_reachable: true,
          glance_reachable: true,
          cloud_name: 'test',
        },
      })
    }
    if (url.includes('/openstack/instances')) {
      return route.fulfill({
        json: {
          total: 2,
          instances: [
            { id: 'os-1', name: 'web-01', status: 'ACTIVE' },
            { id: 'os-2', name: 'db-01', status: 'SHUTOFF' },
          ],
        },
      })
    }
    if (url.includes('/openstack/networks')) {
      return route.fulfill({ json: { networks: [{ id: 'n1', name: 'private' }] } })
    }
    if (url.includes('/openstack/images')) {
      return route.fulfill({ json: { images: [{ id: 'i1', name: 'ubuntu-22.04' }] } })
    }
    if (url.includes('/k8s/overview')) {
      return route.fulfill({
        json: {
          version: 'v1.29.0',
          nodes: 3,
          ready_nodes: 3,
          namespaces: 8,
          pods: 42,
          deployments: 12,
          services: 18,
          distribution: 'k3s',
        },
      })
    }
    if (url.includes('/ai/security/explain-event')) {
      return route.fulfill({ json: { explanation: 'Routine administrative activity.', risk: 'Low', recommendation: 'Monitor timeline.' } })
    }
    if (url.includes('/ai/security/attack-reconstruct')) {
      return route.fulfill({ json: { attack_chain: ['1. curl downloaded file', '2. payload executed'], summary: '2 steps' } })
    }
    if (url.includes('/ai/security/nl-search')) {
      return route.fulfill({
        json: {
          original_query: 'curl',
          search_query: 'curl',
          hit_count: 1,
          search_backend: 'opensearch',
          llm_powered: false,
          results: { results: [{ summary: 'curl started', host_id: 'h1', severity: 'info' }] },
        },
      })
    }
    if (url.includes('/ai/security/hunt-summary')) {
      return route.fulfill({
        json: {
          summary: '2 correlation finding(s), 4 timeline event(s), 1 high/critical.',
          priority_actions: ['Review high/critical correlations in Security Center'],
          llm_powered: false,
        },
      })
    }
    if (url.includes('/ai/security')) {
      return route.fulfill({
        json: { summary: 'OK', findings: [], remediations: [], status: 'idle' },
      })
    }
    if (url.includes('/ai/')) {
      return route.fulfill({
        json: { summary: 'OK', remediations: [], forecasts: [], highlights: [], status: 'idle', tagline: 'OK' },
      })
    }
    return route.fulfill({ json: [] })
  })

  // Registered after the catch-all api handler so Playwright matches this route first.
  await page.route('**/fleet/mission**', async (route) => {
    await route.fulfill({ json: fleetMission })
  })
}
