// Copyright (c) 2026 ZyvorAI Labs Private Limited. All rights reserved.
// Proprietary software — see LICENSE in the repository root.
// https://zyvor.dev · info@zyvor.dev

import { useState, useEffect, useRef, useCallback } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { useLocation, useNavigate } from 'react-router'
import { Search, Plus, Camera, Server, Play, Square, Power, Terminal, ArrowRight, Network, HardDrive, Clock, Star, Boxes, Upload, Pin, Keyboard, Info, Bell, ClipboardList, Activity, Settings } from 'lucide-react'
import { listVMs, startVM, stopVM, shutdownVM, VmInfo } from '../api/vm'
import { listPlatformHosts, listPlatformVms } from '../api/platform'
import { listNetworks, NetworkInfo } from '../api/network'
import { listPools, StoragePoolInfo } from '../api/storage'
import { listAllSnapshots, SnapshotInfo } from '../api/snapshot'
import { useToastContext } from '../contexts/ToastContext'
import { useKeyboardShortcut } from '../hooks/useKeyboardShortcut'
import { navGroups, isOpenStackConfigured, navItemVisible, navGroupItems, TOP_BAR_QUICK_LINKS } from '../utils/routes'
import { usePlatformInfo } from '../contexts/PlatformInfoContext'
import { useOpenStackConnection } from '../hooks/useOpenStackConnection'
import { useAuth } from '../contexts/AuthContext'
import { getStateBadgeClasses } from '../utils/vm'
import { poolStateBadgeClasses, statusBadgeClasses, statusToneClass } from '../utils/semanticColors'
import { getRecentVMs } from '../utils/recentVMs'
import { getPinnedVMs } from '../utils/pinnedVMs'
import { getRecentPages, recordRecentPage } from '../utils/recentPages'
import { getPinnedPages, isPagePinned, togglePinnedPage } from '../utils/pinnedPages'
import { getPageLabel } from '../utils/pageLabels'
import type { HelpTab } from './HelpDialog'
import { formatUserError } from '../utils/apiError'
import {
  executePlatformCommand,
  parsePlatformCommand,
  platformCommandSuggestions,
  type PlatformCommand,
} from '../utils/platformCommands'
import { aiSpotlight, type SpotlightIntent, type SpotlightResult } from '../api/ai'
import { isInputFocused } from '../hooks/useKeyboardShortcut'
import { loadPlatformDesktopTier } from '../utils/platformDesktopTier'
import { operationsHubHref, tasksHubHref, activityHubHref } from '../utils/platformHubLinks'
import { groupSpotlightByZone, spotlightNavForTier, spotlightPathSetForTier, spotlightZoneOrder } from '../utils/platformSpotlightNav'

interface CommandPaletteProps {
  onOpenHelp?: (tab?: HelpTab) => void
  /** When true, show Zeus Spotlight branding (⌘Space primary). */
  spotlight?: boolean
}

interface PaletteItem {
  id: string
  icon: React.ReactNode
  label: string
  sublabel?: string
  badge?: React.ReactNode
  action: () => void
  category: string
}

export default function CommandPalette({ onOpenHelp, spotlight = false }: CommandPaletteProps) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [selectedIndex, setSelectedIndex] = useState(0)
  const [vms, setVMs] = useState<VmInfo[]>([])
  const [networks, setNetworks] = useState<NetworkInfo[]>([])
  const [pools, setPools] = useState<StoragePoolInfo[]>([])
  const [snapshots, setSnapshots] = useState<SnapshotInfo[]>([])
  const [platformVms, setPlatformVms] = useState<{ id: string; name: string }[]>([])
  const [platformHosts, setPlatformHosts] = useState<{ id: string; hostname: string; state: string }[]>([])
  const [loading, setLoading] = useState(false)
  const [reviewCommand, setReviewCommand] = useState<PlatformCommand | null>(null)
  const [spotlightIntents, setSpotlightIntents] = useState<SpotlightIntent[]>([])
  const [executing, setExecuting] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLDivElement>(null)
  const navigate = useNavigate()
  const location = useLocation()
  const toast = useToastContext()
  const [pinnedPages, setPinnedPages] = useState<string[]>(() => getPinnedPages())
  const { info } = usePlatformInfo()
  const { username } = useAuth()
  const openstackConfigured = isOpenStackConfigured(info?.openstack)
  const { phase: osPhase } = useOpenStackConnection()
  const osLive = osPhase === 'live'
  const hypersdkEnabled = Boolean(info?.hypersdk?.enabled)

  const toggle = useCallback(() => {
    if (!open && isInputFocused()) return
    setOpen((o) => !o)
  }, [open])

  useKeyboardShortcut({ key: 'k', ctrl: true, handler: toggle })
  useKeyboardShortcut({
    key: ' ',
    meta: true,
    handler: (e) => {
      if (isInputFocused()) return
      e.preventDefault()
      setOpen(true)
    },
    enabled: spotlight,
  })

  useEffect(() => {
    const onOpen = (e: Event) => {
      const detail = (e as CustomEvent<{ prefill?: string }>).detail
      setOpen(true)
      if (detail?.prefill) setQuery(detail.prefill)
    }
    window.addEventListener('machina-open-spotlight', onOpen)
    return () => window.removeEventListener('machina-open-spotlight', onOpen)
  }, [])

  // Fetch VMs when palette opens
  useEffect(() => {
    if (!open) return
    setQuery('')
    setSelectedIndex(0)
    setPinnedPages(getPinnedPages())
    setLoading(true)
    Promise.allSettled([
      listVMs(),
      listNetworks(),
      listPools(),
      listAllSnapshots(),
      info?.control_plane?.proxy_url ? listPlatformVms() : Promise.resolve([]),
      info?.control_plane?.proxy_url ? listPlatformHosts() : Promise.resolve([]),
    ])
      .then(([vmR, netR, poolR, snapR, pVmR, pHostR]) => {
        setVMs(vmR.status === 'fulfilled' ? vmR.value : [])
        setNetworks(netR.status === 'fulfilled' ? netR.value : [])
        setPools(poolR.status === 'fulfilled' ? poolR.value : [])
        setSnapshots(snapR.status === 'fulfilled' ? snapR.value : [])
        setPlatformVms(pVmR.status === 'fulfilled' ? pVmR.value.map((v) => ({ id: v.id, name: v.name })) : [])
        setPlatformHosts(pHostR.status === 'fulfilled' ? pHostR.value.map((h) => ({ id: h.id, hostname: h.hostname, state: h.state })) : [])
      })
      .finally(() => setLoading(false))
  }, [open, info?.control_plane?.proxy_url])

  // Focus input when opened
  useEffect(() => {
    if (open) setTimeout(() => inputRef.current?.focus(), 50)
  }, [open])

  const close = useCallback(() => { setOpen(false); setQuery(''); setReviewCommand(null); setSpotlightIntents([]) }, [])

  const platformConnected = Boolean(info?.control_plane?.proxy_url)
  const onPlatformDesktop = location.pathname.startsWith('/platform')
  const platformTier = loadPlatformDesktopTier()
  const platformSpotlightPaths = onPlatformDesktop
    ? spotlightPathSetForTier(platformTier, info)
    : new Set<string>()

  useEffect(() => {
    if (!open || !platformConnected || !query.trim() || query.length < 3) {
      setSpotlightIntents([])
      return
    }
    const t = window.setTimeout(() => {
      void aiSpotlight(query.trim())
        .then((r: SpotlightResult) => setSpotlightIntents(r.intents ?? []))
        .catch(() => setSpotlightIntents([]))
    }, 200)
    return () => window.clearTimeout(t)
  }, [open, platformConnected, query])

  const go = useCallback((path: string) => {
    recordRecentPage(path)
    close()
    navigate(path)
  }, [close, navigate])

  const onlineHostCount = platformHosts.filter((h) => h.state === 'online').length

  const confirmPlatformCommand = useCallback(async (cmd: PlatformCommand) => {
    setExecuting(true)
    try {
      const result = await executePlatformCommand(cmd)
      toast.success(result.message)
      if (result.navigate) {
        go(result.navigate)
      } else {
        close()
      }
    } catch (e: unknown) {
      toast.error(formatUserError(e))
    } finally {
      setExecuting(false)
      setReviewCommand(null)
    }
  }, [close, go, toast])

  const vmAction = useCallback(async (name: string, fn: (n: string) => Promise<void>, label: string) => {
    close()
    try {
      await fn(name)
      toast.success(`${label} '${name}' OK`)
    } catch (e: unknown) {
      toast.error(`${label} '${name}' failed: ${formatUserError(e)}`)
    }
  }, [close, toast])

  // Build items list
  const items: PaletteItem[] = []

  const currentPath = location.pathname

  // Pinned app pages
  for (const path of pinnedPages) {
    items.push({
      id: `pin-page-${path}`,
      icon: <Star className={`w-4 h-4 ${statusToneClass('warn')}`} />,
      label: getPageLabel(path),
      action: () => go(path),
      category: 'Pinned pages',
    })
  }

  // Recent app pages (non-VM routes)
  const recentPagePaths = getRecentPages()
  for (const path of recentPagePaths) {
    if (pinnedPages.includes(path)) continue
    items.push({
      id: `recent-page-${path}`,
      icon: <Clock className="w-4 h-4" />,
      label: getPageLabel(path),
      action: () => go(path),
      category: 'Recent pages',
    })
  }

  items.push({
    id: 'pin-current-page',
    icon: <Pin className={`w-4 h-4 ${isPagePinned(currentPath) ? statusToneClass('warn') : ''}`} />,
    label: isPagePinned(currentPath) ? 'Unpin current page from navbar' : 'Pin current page to navbar',
    sublabel: getPageLabel(currentPath),
    action: () => {
      setPinnedPages(togglePinnedPage(currentPath))
      close()
    },
    category: 'Quick Actions',
  })

  if (onPlatformDesktop) {
    for (const { zone, items: zoneItems } of groupSpotlightByZone(spotlightNavForTier(platformTier, info))) {
      for (const entry of zoneItems) {
        items.push({
          id: entry.id,
          icon: entry.kind === 'hub' ? <Boxes className="w-4 h-4 text-sky-400" /> : <ArrowRight className="w-4 h-4" />,
          label: entry.label,
          sublabel: entry.kind === 'hub'
            ? `Hub · ${entry.description ?? entry.zone}`
            : entry.description ?? entry.zone,
          action: () => go(entry.path),
          category: zone,
        })
      }
    }
  }

  // Platform quick actions (deduped when already in hub zone nav)
  const desktopTier = loadPlatformDesktopTier()
  const platformActions: PaletteItem[] = [
    { id: 'plat-create-vm', icon: <Plus className="w-4 h-4" />, label: 'Create VM', sublabel: 'Platform wizard', action: () => go('/platform/vms'), category: 'Platform Actions' },
    { id: 'plat-migrate', icon: <Upload className="w-4 h-4" />, label: 'Import VMware VM', sublabel: 'Migration Assistant', action: () => go('/platform/migration'), category: 'Platform Actions' },
    { id: 'plat-iso', icon: <HardDrive className="w-4 h-4" />, label: 'Upload ISO', action: () => go('/platform/content'), category: 'Platform Actions' },
    { id: 'plat-tasks', icon: <ClipboardList className="w-4 h-4" />, label: 'Show running tasks', action: () => go(tasksHubHref(desktopTier)), category: 'Platform Actions' },
    { id: 'plat-alerts', icon: <Bell className="w-4 h-4" />, label: 'Show alerts', action: () => go(operationsHubHref(desktopTier)), category: 'Platform Actions' },
    { id: 'plat-activity', icon: <Activity className="w-4 h-4" />, label: 'Activity Monitor', action: () => go(activityHubHref(desktopTier)), category: 'Platform Actions' },
    { id: 'plat-settings', icon: <Settings className="w-4 h-4" />, label: 'Platform settings', action: () => go('/platform/settings'), category: 'Platform Actions' },
  ]
  for (const action of platformActions) {
    if (onPlatformDesktop) {
      const pathById: Record<string, string> = {
        'plat-create-vm': '/platform/vms',
        'plat-migrate': '/platform/migration',
        'plat-iso': '/platform/content',
        'plat-tasks': tasksHubHref(desktopTier),
        'plat-alerts': operationsHubHref(desktopTier),
        'plat-activity': activityHubHref(desktopTier),
        'plat-settings': '/platform/settings',
      }
      if (platformSpotlightPaths.has(pathById[action.id] ?? '')) continue
    }
    items.push(action)
  }

  if (onPlatformDesktop) {
    for (const pv of platformVms) {
      if (platformSpotlightPaths.has(`/platform/vms/${pv.id}`)) continue
      items.push({
        id: `platform-vm-${pv.id}`,
        icon: <Boxes className="w-4 h-4" />,
        label: pv.name,
        sublabel: 'Platform VM',
        action: () => go(`/platform/vms/${pv.id}`),
        category: 'Fleet',
      })
    }
    for (const ph of platformHosts) {
      if (platformSpotlightPaths.has(`/platform/hosts/${ph.id}`)) continue
      items.push({
        id: `platform-host-${ph.id}`,
        icon: <Server className="w-4 h-4" />,
        label: ph.hostname,
        sublabel: 'Platform host',
        action: () => go(`/platform/hosts/${ph.id}`),
        category: 'Fleet',
      })
    }
  }

  // Recent VMs
  const recentNames = getRecentVMs()
  for (const rName of recentNames) {
    items.push({
      id: `recent-${rName}`,
      icon: <Clock className="w-4 h-4" />,
      label: rName,
      action: () => go(`/vms/${rName}`),
      category: 'Recent',
    })
  }

  // Pinned VMs
  const pinnedNames = getPinnedVMs()
  for (const pName of pinnedNames) {
    if (recentNames.includes(pName)) continue // avoid duplicates with Recent
    items.push({
      id: `pinned-${pName}`,
      icon: <Star className="w-4 h-4" />,
      label: pName,
      action: () => go(`/vms/${pName}`),
      category: 'Pinned',
    })
  }

  // Quick actions
  items.push(
    { id: 'qa-create', icon: <Plus className="w-4 h-4" />, label: 'Create VM', action: () => go('/create'), category: 'Quick Actions' },
    { id: 'qa-host-ssh', icon: <Terminal className="w-4 h-4" />, label: 'Host SSH (hypervisor)', action: () => go('/host-ssh'), category: 'Quick Actions' },
    { id: 'qa-snap', icon: <Camera className="w-4 h-4" />, label: 'Snapshots', action: () => go('/snapshots'), category: 'Quick Actions' },
    { id: 'qa-disk-images', icon: <HardDrive className="w-4 h-4" />, label: 'Disk Images', sublabel: 'g i', action: () => go('/disk-images'), category: 'Quick Actions' },
    {
      id: 'qa-kubevirt-upload',
      icon: <Upload className="w-4 h-4" />,
      label: 'Upload qcow2 to KubeVirt',
      sublabel: 'last picked qcow2',
      action: () => go('/disk-images?kv=open'),
      category: 'Quick Actions',
    },
    { id: 'qa-kubevirt-workloads', icon: <Boxes className="w-4 h-4" />, label: 'KubeVirt Workloads', sublabel: 'g k', action: () => go('/k8s/workloads'), category: 'Quick Actions' },
  )
  const osHint = osLive ? 'g o' : osPhase === 'unreachable' ? 'unreachable' : 'wire cloud first'
  items.push(
    { id: 'qa-openstack', icon: <Server className="w-4 h-4" />, label: 'OpenStack overview', sublabel: osHint, action: () => go('/openstack'), category: 'Quick Actions' },
    { id: 'qa-openstack-instances', icon: <Server className="w-4 h-4" />, label: 'OpenStack instances', sublabel: osHint, action: () => go('/openstack/instances'), category: 'Quick Actions' },
    { id: 'qa-openstack-create', icon: <Plus className="w-4 h-4" />, label: 'Create OpenStack instance', sublabel: osHint, action: () => go('/openstack/create'), category: 'Quick Actions' },
    { id: 'qa-openstack-images', icon: <HardDrive className="w-4 h-4" />, label: 'OpenStack Glance images', sublabel: osHint, action: () => go('/openstack/images'), category: 'Quick Actions' },
  )
  if (hypersdkEnabled) {
    items.push(
      { id: 'qa-openstack-migrations', icon: <Server className="w-4 h-4" />, label: 'OpenStack migrations', sublabel: osHint, action: () => go('/openstack/migrations'), category: 'Quick Actions' },
    )
  }
  if (!openstackConfigured) {
    items.push({
      id: 'qa-openstack-setup',
      icon: <Server className="w-4 h-4" />,
      label: 'Wire OpenStack on this host',
      sublabel: 'Settings',
      action: () => go('/settings?openstack=1'),
      category: 'Setup',
    })
  }

  if (onOpenHelp) {
    items.push(
      {
        id: 'help-shortcuts',
        icon: <Keyboard className="w-4 h-4" />,
        label: 'Help: keyboard shortcuts',
        sublabel: '?',
        action: () => {
          close()
          onOpenHelp('shortcuts')
        },
        category: 'Help',
      },
      {
        id: 'help-about',
        icon: <Info className="w-4 h-4" />,
        label: 'Help: about Machina',
        sublabel: 'zyvor.dev',
        action: () => {
          close()
          onOpenHelp('about')
        },
        category: 'Help',
      },
    )
  }

  // Classic Machina nav — hidden on Platform desktop (Spotlight registry covers platform routes).
  if (!onPlatformDesktop) {
    for (const group of navGroups) {
      for (const item of navGroupItems(group)) {
        if (!navItemVisible(item, username, openstackConfigured, hypersdkEnabled)) continue
        items.push({
          id: `nav-${item.to}`,
          icon: item.icon,
          label: item.label,
          sublabel: group.label,
          action: () => go(item.to),
          category: 'Pages',
        })
      }
    }
    for (const item of TOP_BAR_QUICK_LINKS) {
      items.push({
        id: `quick-${item.to}`,
        icon: item.icon,
        label: item.label,
        sublabel: 'Shortcuts',
        action: () => go(item.to),
        category: 'Pages',
      })
    }
  }

  // VMs
  for (const vm of vms) {
    items.push({
      id: `vm-${vm.name}`,
      icon: <Server className="w-4 h-4" />,
      label: vm.name,
      badge: <span className={`px-1.5 py-0.5 rounded text-[10px] font-medium ${getStateBadgeClasses(vm.state)}`}>{vm.state}</span>,
      action: () => go(`/vms/${vm.name}`),
      category: 'Virtual Machines',
    })
    if (vm.state === 'running') {
      items.push(
        { id: `vm-console-${vm.name}`, icon: <Terminal className="w-4 h-4" />, label: `${vm.name} — Console`, action: () => go(`/vms/${vm.name}/console`), category: 'Virtual Machines' },
        { id: `vm-shutdown-${vm.name}`, icon: <Power className="w-4 h-4" />, label: `${vm.name} — Shutdown`, action: () => vmAction(vm.name, shutdownVM, 'Shutdown'), category: 'Virtual Machines' },
        { id: `vm-stop-${vm.name}`, icon: <Square className="w-4 h-4" />, label: `${vm.name} — Force Stop`, action: () => vmAction(vm.name, stopVM, 'Stop'), category: 'Virtual Machines' },
      )
    }
    if (vm.state === 'shutoff') {
      items.push(
        { id: `vm-start-${vm.name}`, icon: <Play className="w-4 h-4" />, label: `${vm.name} — Start`, action: () => vmAction(vm.name, startVM, 'Start'), category: 'Virtual Machines' },
      )
    }
  }

  // Networks
  for (const net of networks) {
    items.push({
      id: `net-${net.name}`, icon: <Network className="w-4 h-4" />, label: net.name,
      badge: <span className={`px-1.5 py-0.5 rounded text-[10px] font-medium ${statusBadgeClasses(net.active ? 'ok' : 'error')}`}>{net.active ? 'active' : 'inactive'}</span>,
      action: () => go('/networks'), category: 'Networks',
    })
  }

  // Storage Pools
  for (const pool of pools) {
    items.push({
      id: `pool-${pool.name}`, icon: <HardDrive className="w-4 h-4" />, label: pool.name,
      badge: <span className={`px-1.5 py-0.5 rounded text-[10px] font-medium ${poolStateBadgeClasses(pool.state)}`}>{pool.state}</span>,
      action: () => go('/storage'), category: 'Storage Pools',
    })
  }

  // Snapshots
  for (const snap of snapshots) {
    items.push({
      id: `snap-${snap.vm_name}-${snap.name}`, icon: <Camera className="w-4 h-4" />,
      label: `${snap.vm_name} / ${snap.name}`,
      action: () => go(`/vms/${snap.vm_name}`), category: 'Snapshots',
    })
  }

  // Filter
  const q = query.toLowerCase()
  const parsedCommand = parsePlatformCommand(query, onlineHostCount)

  for (const intent of spotlightIntents) {
    const cmdId = intent.id as PlatformCommand['id']
    const knownCmd = ['import-networks', 'import-storage', 'sync-hosts', 'create-vm', 'show-offline-hosts', 'backup-vm', 'migrate-vm', 'enable-ha-vm'].includes(cmdId)
    items.unshift({
      id: `ai-intent-${intent.id}`,
      icon: <Terminal className="w-4 h-4 text-orange-400" />,
      label: intent.label,
      sublabel: intent.review || 'Zeus Spotlight',
      action: () => {
        if (intent.navigate) {
          go(intent.navigate)
        } else if (knownCmd) {
          const prefill = intent.prefill as { name?: string; os?: string; size?: string; network?: string; target_host?: string } | undefined
          setReviewCommand({
            id: cmdId,
            label: intent.label,
            review: intent.review,
            vmName: intent.vm_name ?? prefill?.name,
            prefill: prefill
              ? {
                  name: prefill.name ?? intent.vm_name,
                  os: typeof prefill.os === 'string' ? prefill.os : undefined,
                  size: typeof prefill.size === 'string' ? prefill.size : undefined,
                  network: typeof prefill.network === 'string' ? prefill.network : undefined,
                  target_host: typeof prefill.target_host === 'string' ? prefill.target_host : undefined,
                }
              : intent.vm_name
                ? { name: intent.vm_name }
                : undefined,
          })
        }
      },
      category: 'Zeus Spotlight',
    })
  }

  if (parsedCommand && q) {
    items.unshift({
      id: `plat-cmd-${parsedCommand.id}`,
      icon: <Terminal className="w-4 h-4 text-orange-400" />,
      label: parsedCommand.label,
      sublabel: 'Platform command — review',
      action: () => setReviewCommand(parsedCommand),
      category: 'Platform Commands',
    })
  } else if (query.startsWith('>') || /^import |^sync |^create |^show /i.test(query)) {
    for (const sug of platformCommandSuggestions(onlineHostCount)) {
      if (sug.label.toLowerCase().includes(q.replace(/^>/, '').trim()) || q === '>') {
        items.unshift({
          id: `plat-sug-${sug.id}`,
          icon: <Terminal className="w-4 h-4 text-orange-400" />,
          label: sug.label,
          sublabel: sug.review,
          action: () => setReviewCommand(sug),
          category: 'Platform Commands',
        })
      }
    }
  }

  const filtered = q ? items.filter(i => i.label.toLowerCase().includes(q) || (i.sublabel || '').toLowerCase().includes(q) || i.category === 'Platform Commands') : items

  // Group by category
  const categories = [
    'Pinned pages',
    'Recent pages',
    'Recent',
    'Pinned',
    'Zeus Spotlight',
    'Platform Commands',
    ...spotlightZoneOrder(),
    'Platform Actions',
    'Quick Actions',
    'Help',
    'Setup',
    'Pages',
    'Virtual Machines',
    'Networks',
    'Storage Pools',
    'Snapshots',
  ]
  const grouped = categories
    .map(cat => ({ cat, items: filtered.filter(i => i.category === cat) }))
    .filter(g => g.items.length > 0)

  const flatFiltered = grouped.flatMap(g => g.items)
  const clampedIndex = Math.min(selectedIndex, Math.max(0, flatFiltered.length - 1))

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      if (reviewCommand) { setReviewCommand(null); return }
      close()
      return
    }
    if (reviewCommand && e.key === 'Enter') {
      e.preventDefault()
      void confirmPlatformCommand(reviewCommand)
      return
    }
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setSelectedIndex(i => Math.min(i + 1, flatFiltered.length - 1))
      return
    }
    if (e.key === 'ArrowUp') {
      e.preventDefault()
      setSelectedIndex(i => Math.max(i - 1, 0))
      return
    }
    if (e.key === 'Enter' && flatFiltered.length > 0) {
      e.preventDefault()
      flatFiltered[clampedIndex]?.action()
    }
  }

  // Scroll selected item into view
  useEffect(() => {
    const el = listRef.current?.querySelector(`[data-index="${clampedIndex}"]`)
    el?.scrollIntoView({ block: 'nearest' })
  }, [clampedIndex])

  // Reset index on query change
  useEffect(() => setSelectedIndex(0), [query])

  let runningIdx = 0

  return (
    <AnimatePresence>
      {open && (
    <div className="fixed inset-0 z-[60] liquid-glass-modal-backdrop" onClick={close}>
      <div className="fixed inset-x-0 top-[15%] mx-auto max-w-lg px-4" onClick={e => e.stopPropagation()}>
        <motion.div
          initial={{ opacity: 0, scale: 0.96, y: -8 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.96, y: -8 }}
          transition={{ type: 'spring', stiffness: 340, damping: 28 }}
          className="liquid-glass-modal-panel overflow-hidden"
          onKeyDown={handleKeyDown}
        >
          {/* Search input */}
          <div className="flex items-center gap-3 px-4 border-b border-white/[0.06]">
            <Search className="w-4 h-4 text-[var(--text-secondary)] shrink-0" strokeWidth={1.75} />
            <input
              ref={inputRef}
              type="text"
              value={query}
              onChange={e => setQuery(e.target.value)}
              placeholder={spotlight ? 'Zeus — search or ask…' : 'Search or type > import networks…'}
              className="flex-1 py-3.5 bg-transparent text-sm text-white placeholder-slate-500 focus:outline-none"
            />
            {spotlight ? (
              <kbd className="px-1.5 py-0.5 bg-slate-700 border border-slate-600 rounded text-[10px] font-mono text-slate-400 hidden sm:inline">⌘Space</kbd>
            ) : (
              <kbd className="px-1.5 py-0.5 bg-slate-700 border border-slate-600 rounded text-[10px] font-mono text-slate-400">⌘K</kbd>
            )}
            <kbd className="px-1.5 py-0.5 bg-slate-700 border border-slate-600 rounded text-[10px] font-mono text-slate-400">Esc</kbd>
          </div>

          {/* Results */}
          <div ref={listRef} className="overflow-y-auto max-h-[60vh] py-1">
            {reviewCommand ? (
              <div className="p-4 space-y-4">
                <p className="text-xs font-semibold uppercase tracking-wider text-orange-400/80">Review command</p>
                <p className="text-sm text-slate-200 font-medium">{reviewCommand.label}</p>
                <p className="text-sm text-slate-400">{reviewCommand.review}</p>
                <button
                  type="button"
                  className="btn-primary w-full"
                  disabled={executing}
                  onClick={() => void confirmPlatformCommand(reviewCommand)}
                >
                  {executing ? 'Running…' : 'Confirm — press Enter'}
                </button>
              </div>
            ) : loading ? (
              <div className="px-4 py-8 text-center text-sm text-slate-500">Loading...</div>
            ) : flatFiltered.length === 0 ? (
              <div className="px-4 py-8 text-center text-sm text-slate-500">No results for "{query}"</div>
            ) : (
              grouped.map(({ cat, items: groupItems }) => (
                <div key={cat}>
                  <div className="px-4 py-1.5 text-[10px] font-bold text-slate-500 uppercase tracking-wider">{cat}</div>
                  {groupItems.map(item => {
                    const idx = runningIdx++
                    const selected = idx === clampedIndex
                    return (
                      <button
                        key={item.id}
                        data-index={idx}
                        onClick={() => item.action()}
                        className={`w-full flex items-center gap-3 px-4 py-2.5 text-sm transition-colors ${
                          selected ? 'bg-slate-700/60 text-white' : 'text-slate-300 hover:bg-slate-700/40'
                        }`}
                      >
                        <span className="text-slate-400">{item.icon}</span>
                        <span className="flex-1 text-left truncate">{item.label}</span>
                        {item.badge}
                        {item.sublabel && <span className="text-[10px] text-slate-500">{item.sublabel}</span>}
                        {selected && <ArrowRight className="w-3 h-3 text-slate-500" />}
                      </button>
                    )
                  })}
                </div>
              ))
            )}
          </div>

          {/* Footer */}
          <div className="px-4 py-2 border-t border-white/[0.06] flex items-center gap-4 text-[10px] text-[var(--text-muted)]">
            <span><kbd className="px-1 py-0.5 bg-white/5 border border-white/10 rounded font-mono">↑↓</kbd> navigate</span>
            <span><kbd className="px-1 py-0.5 bg-white/5 border border-white/10 rounded font-mono">↵</kbd> select</span>
            <span><kbd className="px-1 py-0.5 bg-white/5 border border-white/10 rounded font-mono">esc</kbd> close</span>
          </div>
        </motion.div>
      </div>
    </div>
      )}
    </AnimatePresence>
  )
}
