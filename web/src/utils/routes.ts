// Copyright (c) 2026 ZyvorAI Labs Private Limited. All rights reserved.
// Proprietary software — see LICENSE in the repository root.
// https://zyvor.dev · info@zyvor.dev

import React from 'react'
import type { LucideIcon } from 'lucide-react'
import {
  Home, Server, Plus, Upload, Network, HardDrive, Camera, Shield, Archive, Globe,
  Cpu, Activity, MonitorCog, Usb, Cog, ScrollText, FileText, Key, Users, Database, Terminal,
  ClipboardList,
  Boxes,
  LayoutGrid,
  Package,
  Cloud,
  Stethoscope,
  Layers,
  Webhook,
  Bell,
  Settings,
  BookOpen,
  ShieldCheck,
  Radar,
  BarChart2,
  Microchip,
  Code2,
  GitBranch,
  CloudCog,
  Zap,
  AlertTriangle,
  CheckCircle2,
  Share2,
  TrendingDown,
  Plug2,
  LifeBuoy,
  Flame,
  Lock,
  BrainCircuit,
  Building2,
} from 'lucide-react'

export interface NavItem {
  to: string
  icon: React.ReactNode
  label: string
  /** If true, only show in nav when signed in as UNIX `root`. */
  requiresRoot?: boolean
  /** If true, only show when OpenStack is enabled and configured on the daemon. */
  requiresOpenStack?: boolean
  /** Show only while OpenStack is not wired — links to Settings for setup. */
  openstackSetupOnly?: boolean
  /** If true, only show when HyperSDK is enabled on the daemon. */
  requiresHypersdk?: boolean
}

/** OpenStack credentials present in daemon config (may still be unreachable). */
export function isOpenStackConfigured(
  openstack: { enabled?: boolean; configured?: boolean } | undefined,
): boolean {
  return Boolean(openstack?.enabled && openstack?.configured)
}

/** @deprecated Use isOpenStackConfigured — nav visibility; operational UI gates on phase === live. */
export const isOpenStackNavEnabled = isOpenStackConfigured

/** Match nav item href against current location (supports /openstack prefix + settings query). */
export function navItemActive(
  item: NavItem,
  pathname: string,
  search: string,
): boolean {
  const [path, query] = item.to.split('?')
  if (query) {
    if (pathname !== path) return false
    const params = new URLSearchParams(query)
    for (const [k, v] of params.entries()) {
      if (new URLSearchParams(search).get(k) !== v) return false
    }
    return true
  }
  if (path === '/openstack') {
    return pathname === '/openstack'
  }
  if (path.startsWith('/openstack/')) {
    return pathname === path || pathname.startsWith(`${path}/`)
  }
  if (path.startsWith('/platform/zeus/')) {
    return pathname === path || pathname.startsWith(`${path}/`)
  }
  return pathname === path
}

export function navGroupHasActive(
  group: NavGroup,
  pathname: string,
  search: string,
  username: string,
  openstackReady: boolean,
  hypersdkEnabled = false,
): boolean {
  return navDropdownSections(group).some((section) =>
    section.items.some(
      (item) =>
        navItemVisible(item, username, openstackReady, hypersdkEnabled) &&
        navItemActive(item, pathname, search),
    ),
  )
}

export function navItemVisible(
  item: NavItem,
  username: string,
  openstackReady: boolean,
  hypersdkEnabled = false,
): boolean {
  if (item.requiresRoot && username !== 'root') return false
  if (item.requiresOpenStack && !openstackReady) return false
  if (item.openstackSetupOnly && openstackReady) return false
  if (item.requiresHypersdk && !hypersdkEnabled) return false
  return true
}

export interface NavSection {
  label: string
  items: NavItem[]
}

export interface NavGroup {
  /** Full name (tooltips, mobile drawer, aria). */
  label: string
  /** Top-bar icon trigger (v9s-style icon cluster). */
  barIcon: LucideIcon
  items: NavItem[]
  /** When set, desktop nav renders a sectioned dropdown instead of a flat list. */
  sections?: NavSection[]
  /** Tall menus scroll inside the panel (long groups). */
  menuScroll?: boolean
}

/** Sections for dropdown / mobile drawer (single section when `items` only). */
export function navDropdownSections(group: NavGroup): NavSection[] {
  if (group.sections?.length) return group.sections
  if (group.items.length) return [{ label: '', items: group.items }]
  return []
}

/** Flatten group items (sections or top-level items). */
export function navGroupItems(group: NavGroup): NavItem[] {
  return navDropdownSections(group).flatMap((s) => s.items)
}

/** Always-visible toolbar shortcuts beside the main nav icons. */
export const TOP_BAR_QUICK_LINKS: NavItem[] = [
  { to: '/settings', icon: React.createElement(Settings, { className: 'w-4 h-4' }), label: 'Settings' },
  { to: '/host-ssh', icon: React.createElement(Terminal, { className: 'w-4 h-4' }), label: 'Host SSH' },
  { to: '/api-docs', icon: React.createElement(BookOpen, { className: 'w-4 h-4' }), label: 'API Docs' },
]

export const navGroups: NavGroup[] = [
  {
    label: 'Core',
    barIcon: Home,
    items: [
      { to: '/', icon: React.createElement(Home, { className: 'w-4 h-4' }), label: 'Dashboard' },
      { to: '/vms', icon: React.createElement(Server, { className: 'w-4 h-4' }), label: 'Virtual Machines' },
      { to: '/create', icon: React.createElement(Plus, { className: 'w-4 h-4' }), label: 'Create VM' },
      { to: '/import', icon: React.createElement(Upload, { className: 'w-4 h-4' }), label: 'Import VM' },
      { to: '/fleet', icon: React.createElement(Globe, { className: 'w-4 h-4' }), label: 'Fleet' },
    ],
  },
  {
    label: 'Platform',
    barIcon: Cloud,
    items: [],
    menuScroll: true,
    sections: [
      {
        label: 'Overview',
        items: [
          { to: '/platform', icon: React.createElement(Cloud, { className: 'w-4 h-4' }), label: 'Mission Control' },
          { to: '/platform/vms', icon: React.createElement(MonitorCog, { className: 'w-4 h-4' }), label: 'Virtual Machines' },
          { to: '/platform/hosts', icon: React.createElement(Server, { className: 'w-4 h-4' }), label: 'Hosts' },
          { to: '/platform/applications', icon: React.createElement(Boxes, { className: 'w-4 h-4' }), label: 'Applications' },
          { to: '/platform/launchpad', icon: React.createElement(LayoutGrid, { className: 'w-4 h-4' }), label: 'Launchpad' },
          { to: '/platform/datacenter', icon: React.createElement(Building2, { className: 'w-4 h-4' }), label: 'Datacenter View' },
        ],
      },
      {
        label: 'Resources',
        items: [
          { to: '/platform/storage', icon: React.createElement(HardDrive, { className: 'w-4 h-4' }), label: 'Disk Utility' },
          { to: '/platform/storage-tiers', icon: React.createElement(Layers, { className: 'w-4 h-4' }), label: 'Storage Tiers' },
          { to: '/platform/networks', icon: React.createElement(Network, { className: 'w-4 h-4' }), label: 'Networks' },
          { to: '/platform/content', icon: React.createElement(Package, { className: 'w-4 h-4' }), label: 'Images & ISOs' },
          { to: '/platform/templates', icon: React.createElement(Layers, { className: 'w-4 h-4' }), label: 'Templates' },
          { to: '/platform/cloud-init', icon: React.createElement(CloudCog, { className: 'w-4 h-4' }), label: 'Cloud-Init Studio' },
          { to: '/platform/create-iso', icon: React.createElement(Package, { className: 'w-4 h-4' }), label: 'Create ISO' },
          { to: '/platform/baremetal', icon: React.createElement(Server, { className: 'w-4 h-4' }), label: 'Bare Metal' },
        ],
      },
      {
        label: 'Workloads',
        items: [
          { to: '/platform/migration', icon: React.createElement(Upload, { className: 'w-4 h-4' }), label: 'Migration Assistant' },
          { to: '/platform/vm-builder', icon: React.createElement(Cog, { className: 'w-4 h-4' }), label: 'VM Builder' },
          { to: '/platform/create-advanced', icon: React.createElement(Terminal, { className: 'w-4 h-4' }), label: 'Advanced Create' },
          { to: '/platform/blueprints', icon: React.createElement(GitBranch, { className: 'w-4 h-4' }), label: 'Blueprints' },
          { to: '/platform/tasks', icon: React.createElement(ClipboardList, { className: 'w-4 h-4' }), label: 'Tasks' },
          { to: '/platform/network-canvas', icon: React.createElement(Network, { className: 'w-4 h-4' }), label: 'Network Canvas' },
        ],
      },
      {
        label: 'Security',
        items: [
          { to: '/platform/zeus', icon: React.createElement(Zap, { className: 'w-4 h-4' }), label: 'Zeus AI' },
          { to: '/platform/zeus/configure', icon: React.createElement(Cog, { className: 'w-4 h-4' }), label: 'Configure Zeus' },
          { to: '/platform/zeus/security', icon: React.createElement(ShieldCheck, { className: 'w-4 h-4' }), label: 'Zeus Security' },
          { to: '/platform/soc', icon: React.createElement(Radar, { className: 'w-4 h-4' }), label: 'Security Operations' },
          { to: '/platform/policy', icon: React.createElement(Lock, { className: 'w-4 h-4' }), label: 'Policy' },
          { to: '/platform/webhooks', icon: React.createElement(Webhook, { className: 'w-4 h-4' }), label: 'Webhooks' },
        ],
      },
      {
        label: 'Operations',
        items: [
          { to: '/platform/backups', icon: React.createElement(Archive, { className: 'w-4 h-4' }), label: 'Backup & Restore' },
          { to: '/platform/fleet-snapshots', icon: React.createElement(Camera, { className: 'w-4 h-4' }), label: 'Fleet Snapshots' },
          { to: '/platform/placement', icon: React.createElement(Globe, { className: 'w-4 h-4' }), label: 'Disaster Recovery' },
          { to: '/platform/ha', icon: React.createElement(ShieldCheck, { className: 'w-4 h-4' }), label: 'High Availability' },
          { to: '/platform/upgrade', icon: React.createElement(Cog, { className: 'w-4 h-4' }), label: 'Upgrade Matrix' },
          { to: '/platform/zeus/incidents', icon: React.createElement(AlertTriangle, { className: 'w-4 h-4' }), label: 'Incident Commander' },
          { to: '/platform/zeus/approvals', icon: React.createElement(CheckCircle2, { className: 'w-4 h-4' }), label: 'Approvals' },
          { to: '/platform/maintenance', icon: React.createElement(Cog, { className: 'w-4 h-4' }), label: 'Maintenance' },
          { to: '/platform/recommendations', icon: React.createElement(BookOpen, { className: 'w-4 h-4' }), label: 'Recommendations' },
          { to: '/platform/notifications', icon: React.createElement(Bell, { className: 'w-4 h-4' }), label: 'Alerts' },
        ],
      },
      {
        label: 'Analytics',
        items: [
          { to: '/platform/observability', icon: React.createElement(BarChart2, { className: 'w-4 h-4' }), label: 'Observability' },
          { to: '/platform/activity', icon: React.createElement(Activity, { className: 'w-4 h-4' }), label: 'Activity Monitor' },
          { to: '/platform/topology', icon: React.createElement(Share2, { className: 'w-4 h-4' }), label: 'Topology' },
          { to: '/platform/zeus/rightsizing', icon: React.createElement(TrendingDown, { className: 'w-4 h-4' }), label: 'Rightsizing' },
          { to: '/platform/reports', icon: React.createElement(FileText, { className: 'w-4 h-4' }), label: 'Reports' },
          { to: '/platform/gpu', icon: React.createElement(Microchip, { className: 'w-4 h-4' }), label: 'GPU Command Center' },
        ],
      },
      {
        label: 'Administration',
        items: [
          { to: '/platform/settings', icon: React.createElement(Settings, { className: 'w-4 h-4' }), label: 'Settings' },
          { to: '/platform/users', icon: React.createElement(Users, { className: 'w-4 h-4' }), label: 'Users & Groups' },
          { to: '/platform/projects', icon: React.createElement(Layers, { className: 'w-4 h-4' }), label: 'Stage Manager' },
          { to: '/platform/enroll', icon: React.createElement(Key, { className: 'w-4 h-4' }), label: 'Add Host' },
          { to: '/platform/api-keys', icon: React.createElement(Key, { className: 'w-4 h-4' }), label: 'API Keys' },
          { to: '/platform/integrations', icon: React.createElement(Plug2, { className: 'w-4 h-4' }), label: 'Integrations' },
          { to: '/platform/marketplace', icon: React.createElement(Package, { className: 'w-4 h-4' }), label: 'Marketplace' },
          { to: '/platform/ai-providers', icon: React.createElement(BrainCircuit, { className: 'w-4 h-4' }), label: 'AI Providers' },
          { to: '/platform/enterprise', icon: React.createElement(Shield, { className: 'w-4 h-4' }), label: 'Enterprise Features' },
          { to: '/platform/developer', icon: React.createElement(Code2, { className: 'w-4 h-4' }), label: 'Developer Hub' },
          { to: '/platform/support', icon: React.createElement(LifeBuoy, { className: 'w-4 h-4' }), label: 'Support' },
          { to: '/platform/events', icon: React.createElement(ScrollText, { className: 'w-4 h-4' }), label: 'Event Log' },
        ],
      },
    ],
  },
  {
    label: 'Infrastructure',
    barIcon: Layers,
    items: [],
    menuScroll: true,
    sections: [
      {
        label: 'Storage',
        items: [
          { to: '/storage', icon: React.createElement(HardDrive, { className: 'w-4 h-4' }), label: 'Storage Pools' },
          { to: '/disk-images', icon: React.createElement(Database, { className: 'w-4 h-4' }), label: 'Disk Images' },
          { to: '/snapshots', icon: React.createElement(Camera, { className: 'w-4 h-4' }), label: 'Snapshots' },
          { to: '/backups', icon: React.createElement(Archive, { className: 'w-4 h-4' }), label: 'Snapshot Backups' },
        ],
      },
      {
        label: 'Network',
        items: [
          { to: '/networks', icon: React.createElement(Network, { className: 'w-4 h-4' }), label: 'Networks' },
          { to: '/nwfilters', icon: React.createElement(Shield, { className: 'w-4 h-4' }), label: 'Network Filters' },
          { to: '/host-networking', icon: React.createElement(Globe, { className: 'w-4 h-4' }), label: 'Host Networking' },
          { to: '/secrets', icon: React.createElement(Key, { className: 'w-4 h-4' }), label: 'Secrets' },
        ],
      },
      {
        label: 'Kubernetes',
        items: [
          { to: '/k8s', icon: React.createElement(Boxes, { className: 'w-4 h-4' }), label: 'Kubernetes' },
          { to: '/k8s/workloads', icon: React.createElement(Boxes, { className: 'w-4 h-4' }), label: 'K8s Workloads' },
          { to: '/k8s/kata', icon: React.createElement(Package, { className: 'w-4 h-4' }), label: 'Kata + Cloud Hypervisor' },
          { to: '/host-ssh', icon: React.createElement(Terminal, { className: 'w-4 h-4' }), label: 'Host SSH' },
        ],
      },
    ],
  },
  {
    label: 'OpenStack',
    barIcon: Boxes,
    items: [],
    menuScroll: true,
    sections: [
      {
        label: '',
        items: [
          {
            to: '/settings?openstack=1',
            icon: React.createElement(Cloud, { className: 'w-4 h-4' }),
            label: 'Wire OpenStack',
            openstackSetupOnly: true,
          },
        ],
      },
      {
        label: 'Compute',
        items: [
          { to: '/openstack', icon: React.createElement(Cloud, { className: 'w-4 h-4' }), label: 'Overview' },
          { to: '/openstack/instances', icon: React.createElement(Server, { className: 'w-4 h-4' }), label: 'Instances' },
          { to: '/openstack/create', icon: React.createElement(Plus, { className: 'w-4 h-4' }), label: 'Create Instance' },
          { to: '/openstack/server-groups', icon: React.createElement(Boxes, { className: 'w-4 h-4' }), label: 'Server Groups' },
          { to: '/openstack/keypairs', icon: React.createElement(Key, { className: 'w-4 h-4' }), label: 'Keypairs' },
          { to: '/openstack/flavors', icon: React.createElement(Cpu, { className: 'w-4 h-4' }), label: 'Flavors' },
          { to: '/openstack/migrations', icon: React.createElement(Upload, { className: 'w-4 h-4' }), label: 'Migrations', requiresHypersdk: true },
        ],
      },
      {
        label: 'Storage',
        items: [
          { to: '/openstack/volumes', icon: React.createElement(HardDrive, { className: 'w-4 h-4' }), label: 'Volumes' },
          { to: '/openstack/volume-snapshots', icon: React.createElement(Camera, { className: 'w-4 h-4' }), label: 'Volume Snapshots' },
          { to: '/openstack/images', icon: React.createElement(Package, { className: 'w-4 h-4' }), label: 'Glance Images' },
        ],
      },
      {
        label: 'Networking',
        items: [
          { to: '/openstack/networking', icon: React.createElement(Network, { className: 'w-4 h-4' }), label: 'Networking' },
          { to: '/openstack/security-groups', icon: React.createElement(Shield, { className: 'w-4 h-4' }), label: 'Security Groups' },
          { to: '/openstack/floating-ips', icon: React.createElement(Globe, { className: 'w-4 h-4' }), label: 'Floating IPs' },
          { to: '/openstack/load-balancers', icon: React.createElement(Share2, { className: 'w-4 h-4' }), label: 'Load Balancers' },
          { to: '/openstack/topology', icon: React.createElement(Share2, { className: 'w-4 h-4' }), label: 'Network Topology' },
        ],
      },
      {
        label: 'Platform',
        items: [
          { to: '/openstack/heat', icon: React.createElement(Flame, { className: 'w-4 h-4' }), label: 'Heat Orchestration' },
          { to: '/openstack/identity', icon: React.createElement(Users, { className: 'w-4 h-4' }), label: 'Identity' },
        ],
      },
    ],
  },
  {
    label: 'Monitoring',
    barIcon: Activity,
    items: [],
    menuScroll: true,
    sections: [
      {
        label: 'Host',
        items: [
          { to: '/node', icon: React.createElement(Cpu, { className: 'w-4 h-4' }), label: 'Host Overview' },
          { to: '/events', icon: React.createElement(Activity, { className: 'w-4 h-4' }), label: 'Live Metrics' },
          { to: '/system-check', icon: React.createElement(Stethoscope, { className: 'w-4 h-4' }), label: 'System Check' },
          { to: '/capabilities', icon: React.createElement(MonitorCog, { className: 'w-4 h-4' }), label: 'Capabilities' },
          { to: '/devices', icon: React.createElement(Usb, { className: 'w-4 h-4' }), label: 'Node Devices' },
          { to: '/services', icon: React.createElement(Cog, { className: 'w-4 h-4' }), label: 'Services' },
        ],
      },
      {
        label: 'Operations',
        items: [
          { to: '/jobs', icon: React.createElement(ClipboardList, { className: 'w-4 h-4' }), label: 'Daemon Jobs' },
          { to: '/logs', icon: React.createElement(ScrollText, { className: 'w-4 h-4' }), label: 'System Logs' },
          { to: '/audit', icon: React.createElement(FileText, { className: 'w-4 h-4' }), label: 'Audit Log' },
          { to: '/admin/sessions', icon: React.createElement(Users, { className: 'w-4 h-4' }), label: 'Web Sessions', requiresRoot: true },
        ],
      },
    ],
  },
]

export const routeLabels: Record<string, string> = {
  '/': 'Dashboard',
  '/vms': 'Virtual Machines',
  '/create': 'Create VM',
  '/networks': 'Networks',
  '/storage': 'Storage',
  '/snapshots': 'Snapshots',
  '/node': 'Host Overview',
  '/events': 'Live Metrics',
  '/system-check': 'System Check',
  '/jobs': 'Daemon Jobs',
  '/capabilities': 'Capabilities',
  '/devices': 'Node Devices',
  '/nwfilters': 'Network Filters',
  '/secrets': 'Secrets',
  '/backups': 'Snapshot Backups',
  '/host-networking': 'Host Networking',
  '/host-ssh': 'Host SSH',
  '/k8s': 'Kubernetes',
  '/k8s/workloads': 'K8s Workloads',
  '/k8s/kata': 'Kata Containers',
  '/openstack': 'OpenStack',
  '/openstack/instances': 'Instances',
  '/openstack/instances/:id': 'Instance',
  '/openstack/create': 'Create Instance',
  '/openstack/images': 'Glance Images',
  '/openstack/migrations': 'Migrations',
  '/openstack/volumes': 'Volumes',
  '/openstack/volume-snapshots': 'Volume Snapshots',
  '/openstack/security-groups': 'Security Groups',
  '/openstack/floating-ips': 'Floating IPs',
  '/openstack/networking': 'Networking',
  '/openstack/load-balancers': 'Load Balancers',
  '/openstack/topology': 'Network Topology',
  '/openstack/heat': 'Heat Orchestration',
  '/openstack/identity': 'Identity',
  '/openstack/keypairs': 'Keypairs',
  '/openstack/flavors': 'Flavors',
  '/openstack/server-groups': 'Server Groups',
  '/audit': 'Audit Log',
  '/import': 'Import VM',
  '/api-docs': 'API Docs',
  '/services': 'Services',
  '/logs': 'System Logs',
  '/settings': 'Settings',
  '/admin/sessions': 'Web Sessions',
  '/console': 'Console',
  '/platform': 'Mission Control',
  '/platform/vms': 'Virtual Machines',
  '/platform/applications': 'Applications',
  '/platform/launchpad': 'Launchpad',
  '/platform/hosts': 'Hosts',
  '/platform/content': 'Images & ISOs',
  '/platform/templates': 'Templates',
  '/platform/cloud-init': 'Cloud-Init Studio',
  '/platform/create-iso': 'Create ISO',
  '/platform/create-advanced': 'Advanced Create',
  '/platform/vm-builder': 'VM Builder',
  '/platform/migration': 'Migration Assistant',
  '/platform/blueprints': 'Blueprints',
  '/platform/backups': 'Backup & Restore',
  '/platform/activity': 'Activity Monitor',
  '/platform/recommendations': 'Recommendations',
  '/platform/enroll': 'Add Host',
  '/platform/placement': 'Disaster Recovery',
  '/platform/storage': 'Disk Utility',
  '/platform/networks': 'Networks',
  '/platform/tasks': 'Tasks',
  '/platform/events': 'Event Log',
  '/platform/reports': 'Reports',
  '/platform/projects': 'Stage Manager',
  '/platform/notifications': 'Alerts',
  '/platform/settings': 'Settings',
  '/platform/users': 'Users & Groups',
  '/platform/api-keys': 'API Keys',
  '/platform/webhooks': 'Webhooks',
  '/platform/maintenance': 'Maintenance',
  '/platform/soc': 'Security Operations',
  '/platform/policy': 'Policy',
  '/platform/fleet-snapshots': 'Fleet Snapshots',
  '/platform/topology': 'Topology',
  '/platform/observability': 'Observability',
  '/platform/gpu': 'GPU Command Center',
  '/platform/network-canvas': 'Network Canvas',
  '/platform/developer': 'Developer Hub',
  '/platform/integrations': 'Integrations',
  '/platform/support': 'Support',
  '/platform/enterprise': 'Enterprise Features',
  '/platform/datacenter': 'Datacenter View',
  '/platform/ai-providers': 'AI Providers',
  '/platform/zeus/configure': 'Configure Zeus',
  '/platform/ha': 'High Availability',
  '/platform/baremetal': 'Bare Metal',
  '/platform/storage-tiers': 'Storage Tiers',
  '/platform/marketplace': 'Marketplace',
  '/platform/upgrade': 'Upgrade Matrix',
  '/fleet': 'Fleet',
  '/platform/zeus': 'Zeus OS',
  '/platform/zeus/security': 'Zeus Security',
  '/platform/zeus/rightsizing': 'Rightsizing',
  '/platform/zeus/incidents': 'Incident Commander',
  '/platform/zeus/approvals': 'Approvals',
  '/platform/zeus/security/firewall': 'Firewall',
  '/platform/zeus/security/hunt': 'Threat Hunting',
  '/platform/zeus/security/enforcement': 'Runtime Enforcement',
  '/platform/zeus/security/k8s': 'Kubernetes Security',
  '/platform/zeus/security/cloud': 'Cloud Security',
  '/platform/zeus/security/connectivity': 'Connectivity',
  '/platform/zeus/security/policies': 'Policies',
  '/platform/zeus/security/compliance': 'Compliance',
  '/platform/zeus/security/activity': 'Security Activity',
  '/platform/zeus/security/ports': 'Port Control',
  '/platform/zeus/security/services': 'Service Guard',
  '/platform/mission-control/live': 'Live Wall',
  '/platform/infrastructure': 'Infrastructure',
  '/platform/workloads': 'Workloads',
  '/platform/operations': 'Operations',
  '/platform/administration': 'Administration',
  '/platform/resources': 'Infrastructure',
  '/platform/hosts/:id': 'Host',
  '/platform/hosts/finder': 'Machine Finder',
  '/platform/vms/:id': 'Virtual Machine',
  '/platform/vms/:id/consolehub': 'Console Hub',
  '/platform/vms/:id/console': 'Console',
  '/platform/launchpad/apps/:id': 'App',
  '/platform/launchpad/spaces/:spaceId': 'Space',
  '/platform/zeus/machines/:hostId': 'Host',
  '/platform/zeus/security/firewall/:id': 'Firewall',
}

