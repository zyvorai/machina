// Copyright (c) 2026 ZyvorAI Labs Private Limited. All rights reserved.
// Proprietary software — see LICENSE in the repository root.
// https://zyvor.dev · info@zyvor.dev

import { BrowserRouter, Routes, Route, useNavigate, useLocation, Navigate } from 'react-router'
import { ZyvorFooter } from './components/ZyvorBrand';
import { Suspense, lazy, useState, useCallback, useMemo, useEffect } from 'react'
import { ToastProvider, ToastRenderer } from './contexts/ToastContext'
import { WebSocketProvider } from './contexts/WebSocketContext'
import { AuthProvider, useAuth } from './contexts/AuthContext'
import { ThemeProvider, useTheme } from './contexts/ThemeContext'
import { PlatformInfoProvider } from './contexts/PlatformInfoContext'
import Navbar from './components/Navbar'
import ShellBridgeBar from './components/ShellBridgeBar'
import NotFound from './pages/NotFound'
import LoginPage from './pages/Login'
import CommandPalette from './components/CommandPalette'
import ZeusSpotlight from './components/ai/ZeusSpotlight'
import ZeusAssistant from './components/ai/ZeusAssistant'
import ZeusAmbientBar from './components/ai/ZeusAmbientBar'
import Breadcrumb from './components/Breadcrumb'
import HelpDialog, { type HelpTab } from './components/HelpDialog'
import { OPEN_HELP_EVENT } from './utils/openHelp'
import PageSkeleton from './components/PageSkeleton'
import { AiProvider } from './contexts/AiContext'
import { useSequenceShortcuts } from './hooks/useSequenceShortcut'
import { useKeyboardShortcut, isInputFocused } from './hooks/useKeyboardShortcut'
import { useRecordRecentPage } from './hooks/useRecordRecentPage'
import { usePlatformInfo } from './contexts/PlatformInfoContext'

const Dashboard = lazy(() => import('./pages/Dashboard'))
const VMList = lazy(() => import('./pages/VMList'))
const VMDetails = lazy(() => import('./pages/VMDetails'))
const CreateVM = lazy(() => import('./pages/CreateVM'))
const Networks = lazy(() => import('./pages/Networks'))
const Storage = lazy(() => import('./pages/Storage'))
const Snapshots = lazy(() => import('./pages/Snapshots'))
const NodeInfo = lazy(() => import('./pages/NodeInfo'))
const Events = lazy(() => import('./pages/Events'))
const ClassicConsoleHub = lazy(() => import('./pages/ClassicConsoleHub'))
const ClassicConsoleRedirect = lazy(() => import('./pages/ClassicConsoleRedirect'))
const Capabilities = lazy(() => import('./pages/Capabilities'))
const Devices = lazy(() => import('./pages/Devices'))
const NWFilters = lazy(() => import('./pages/NWFilters'))
const Secrets = lazy(() => import('./pages/Secrets'))
const Backups = lazy(() => import('./pages/Backups'))
const HostNetworking = lazy(() => import('./pages/HostNetworking'))
const AuditLog = lazy(() => import('./pages/AuditLog'))
const SettingsPage = lazy(() => import('./pages/Settings'))
const ImportVM = lazy(() => import('./pages/ImportVM'))
const SSHPage = lazy(() => import('./pages/SSHPage'))
const HostSSHPage = lazy(() => import('./pages/HostSSHPage'))
const ApiDocs = lazy(() => import('./pages/ApiDocs'))
const Services = lazy(() => import('./pages/Services'))
const Logs = lazy(() => import('./pages/Logs'))
const StoragePoolDetail = lazy(() => import('./pages/StoragePoolDetail'))
const AdminSessions = lazy(() => import('./pages/AdminSessions'))
const DiskImages = lazy(() => import('./pages/DiskImages'))
const Jobs = lazy(() => import('./pages/Jobs'))
const K8sOverview = lazy(() => import('./pages/K8sOverview'))
const K8sWorkloads = lazy(() => import('./pages/K8sWorkloads'))
const KataContainers = lazy(() => import('./pages/KataContainers'))
const OpenStackOverview = lazy(() => import('./pages/OpenStackOverview'))
const OpenStackInstances = lazy(() => import('./pages/OpenStackInstances'))
const OpenStackInstanceDetail = lazy(() => import('./pages/OpenStackInstanceDetail'))
const OpenStackCreateInstance = lazy(() => import('./pages/OpenStackCreateInstance'))
const OpenStackImages = lazy(() => import('./pages/OpenStackImages'))
const OpenStackMigrations = lazy(() => import('./pages/OpenStackMigrations'))
const OpenStackSecurityGroups = lazy(() => import('./pages/OpenStackSecurityGroups'))
const OpenStackConsole = lazy(() => import('./pages/OpenStackConsole'))
const OpenStackVolumes = lazy(() => import('./pages/OpenStackVolumes'))
const OpenStackNetworking = lazy(() => import('./pages/OpenStackNetworking'))
const OpenStackKeypairs = lazy(() => import('./pages/OpenStackKeypairs'))
const OpenStackFlavors = lazy(() => import('./pages/OpenStackFlavors'))
const OpenStackServerGroups = lazy(() => import('./pages/OpenStackServerGroups'))
const OpenStackImageDetail = lazy(() => import('./pages/OpenStackImageDetail'))
const OpenStackVolumeDetail = lazy(() => import('./pages/OpenStackVolumeDetail'))
const OpenStackFloatingIps = lazy(() => import('./pages/OpenStackFloatingIps'))
const OpenStackVolumeSnapshots = lazy(() => import('./pages/OpenStackVolumeSnapshots'))
const OpenStackNetworkDetail = lazy(() => import('./pages/OpenStackNetworkDetail'))
const OpenStackSubnetDetail = lazy(() => import('./pages/OpenStackSubnetDetail'))
const OpenStackRouterDetail = lazy(() => import('./pages/OpenStackRouterDetail'))
const OpenStackPortDetail = lazy(() => import('./pages/OpenStackPortDetail'))
const OpenStackFlavorDetail = lazy(() => import('./pages/OpenStackFlavorDetail'))
const OpenStackHypervisorDetail = lazy(() => import('./pages/OpenStackHypervisorDetail'))
const OpenStackServerGroupDetail = lazy(() => import('./pages/OpenStackServerGroupDetail'))
const OpenStackVolumeTransferDetail = lazy(() => import('./pages/OpenStackVolumeTransferDetail'))
const OpenStackInstanceInterfaces = lazy(() => import('./pages/OpenStackInstanceInterfaces'))
const OpenStackSecurityGroupDetail = lazy(() => import('./pages/OpenStackSecurityGroupDetail'))
const OpenStackFloatingIpDetail = lazy(() => import('./pages/OpenStackFloatingIpDetail'))
const OpenStackVolumeSnapshotDetail = lazy(() => import('./pages/OpenStackVolumeSnapshotDetail'))
const OpenStackHeat = lazy(() => import('./pages/OpenStackHeat'))
const OpenStackHeatDetail = lazy(() => import('./pages/OpenStackHeatDetail'))
const OpenStackLoadBalancers = lazy(() => import('./pages/OpenStackLoadBalancers'))
const OpenStackLoadBalancerDetail = lazy(() => import('./pages/OpenStackLoadBalancerDetail'))
const OpenStackIdentity = lazy(() => import('./pages/OpenStackIdentity'))
const OpenStackIdentityProjectDetail = lazy(() => import('./pages/OpenStackIdentityProjectDetail'))
const OpenStackIdentityUserDetail = lazy(() => import('./pages/OpenStackIdentityUserDetail'))
const OpenStackTopology = lazy(() => import('./pages/OpenStackTopology'))
const Fleet = lazy(() => import('./pages/Fleet'))
const PlatformLayout = lazy(() => import('./layouts/PlatformLayout'))
const PlatformDashboard = lazy(() => import('./pages/platform/PlatformDashboard'))
const PlatformHosts = lazy(() => import('./pages/platform/PlatformHosts'))
const PlatformMachineFinder = lazy(() => import('./pages/platform/PlatformMachineFinder'))
const PlatformGpuCommandCenter = lazy(() => import('./pages/platform/PlatformGpuCommandCenter'))
const PlatformVms = lazy(() => import('./pages/platform/PlatformVms'))
const PlatformVmDetail = lazy(() => import('./pages/platform/PlatformVmDetail'))
const PlatformConsoleHub = lazy(() => import('./pages/platform/PlatformConsoleHub'))
const MissionControlLiveWall = lazy(() => import('./pages/platform/MissionControlLiveWall'))
const PlatformConsoleRedirect = lazy(() => import('./pages/platform/PlatformConsoleRedirect'))
const PlatformContent = lazy(() => import('./pages/platform/PlatformContent'))
const PlatformIsoCreate = lazy(() => import('./pages/platform/PlatformIsoCreate'))
const PlatformVirtInstallCreate = lazy(() => import('./pages/platform/PlatformVirtInstallCreate'))
const PlatformVmBuilder = lazy(() => import('./pages/platform/PlatformVmBuilder'))
const PlatformTemplates = lazy(() => import('./pages/platform/PlatformTemplates'))
const CloudInitStudio = lazy(() => import('./pages/platform/CloudInitStudio'))
const PlatformNetworkCanvas = lazy(() => import('./pages/platform/PlatformNetworkCanvas'))
const PlatformDatacenter = lazy(() => import('./pages/platform/PlatformDatacenter'))
const PlatformFleetSnapshots = lazy(() => import('./pages/platform/PlatformFleetSnapshots'))
const PlatformEnroll = lazy(() => import('./pages/platform/PlatformEnroll'))
const PlatformPlacement = lazy(() => import('./pages/platform/PlatformPlacement'))
const PlatformTasks = lazy(() => import('./pages/platform/PlatformTasks'))
const PlatformEvents = lazy(() => import('./pages/platform/PlatformEvents'))
const PlatformStorage = lazy(() => import('./pages/platform/PlatformStorage'))
const PlatformNetworks = lazy(() => import('./pages/platform/PlatformNetworks'))
const PlatformHostDetail = lazy(() => import('./pages/platform/PlatformHostDetail'))
const PlatformUsers = lazy(() => import('./pages/platform/PlatformUsers'))
const PlatformWebhooks = lazy(() => import('./pages/platform/PlatformWebhooks'))
const PlatformReports = lazy(() => import('./pages/platform/PlatformReports'))
const PlatformApiKeys = lazy(() => import('./pages/platform/PlatformApiKeys'))
const PlatformMaintenance = lazy(() => import('./pages/platform/PlatformMaintenance'))
const PlatformProjects = lazy(() => import('./pages/platform/PlatformProjects'))
const PlatformNotifications = lazy(() => import('./pages/platform/PlatformNotifications'))
const PlatformResourcesHub = lazy(() => import('./pages/platform/PlatformResourcesHub'))
const PlatformInfrastructureHub = lazy(() => import('./pages/platform/PlatformInfrastructureHub'))
const PlatformWorkloadsHub = lazy(() => import('./pages/platform/PlatformWorkloadsHub'))
const PlatformAdministrationHub = lazy(() => import('./pages/platform/PlatformAdministrationHub'))
const PlatformOperationsHub = lazy(() => import('./pages/platform/PlatformOperationsHub'))
const PlatformSettingsHub = lazy(() => import('./pages/platform/PlatformSettingsHub'))
const PlatformNotFound = lazy(() => import('./pages/platform/PlatformNotFound'))
const PlatformMigration = lazy(() => import('./pages/platform/PlatformMigration'))
const PlatformActivityMonitor = lazy(() => import('./pages/platform/PlatformActivityMonitor'))
const PlatformRecommendations = lazy(() => import('./pages/platform/PlatformRecommendations'))
const PlatformApplications = lazy(() => import('./pages/platform/PlatformApplications'))
const PlatformLaunchpad = lazy(() => import('./pages/platform/PlatformLaunchpad'))
const PlatformLaunchpadAppDetail = lazy(() => import('./pages/platform/PlatformLaunchpadAppDetail'))
const PlatformLaunchpadSpace = lazy(() => import('./pages/platform/PlatformLaunchpadSpace'))
const PlatformBackups = lazy(() => import('./pages/platform/PlatformBackups'))
const PlatformTopology = lazy(() => import('./pages/platform/PlatformTopology'))
const PlatformZeusOs = lazy(() => import('./pages/platform/PlatformZeusOs'))
const PlatformZeusSettings = lazy(() => import('./pages/platform/PlatformZeusSettings'))
const PlatformAiProviders = lazy(() => import('./pages/platform/PlatformAiProviders'))
const PlatformHa = lazy(() => import('./pages/platform/PlatformHa'))
const PlatformBareMetal = lazy(() => import('./pages/platform/PlatformBareMetal'))
const PlatformStorageTiers = lazy(() => import('./pages/platform/PlatformStorageTiers'))
const PlatformMarketplace = lazy(() => import('./pages/platform/PlatformMarketplace'))
const PlatformUpgrade = lazy(() => import('./pages/platform/PlatformUpgrade'))
const PlatformRightsizing = lazy(() => import('./pages/platform/PlatformRightsizing'))
const PlatformIncidentCommander = lazy(() => import('./pages/platform/PlatformIncidentCommander'))
const PlatformZeusApprovals = lazy(() => import('./pages/platform/PlatformZeusApprovals'))
const PlatformSecurityCenter = lazy(() => import('./pages/platform/PlatformSecurityCenter'))
const PlatformSoc = lazy(() => import('./pages/platform/PlatformSoc'))
const PlatformMachineSecurity = lazy(() => import('./pages/platform/PlatformMachineSecurity'))
const PlatformThreatHunting = lazy(() => import('./pages/platform/PlatformThreatHunting'))
const PlatformRuntimeEnforcement = lazy(() => import('./pages/platform/PlatformRuntimeEnforcement'))
const PlatformFirewallOverview = lazy(() => import('./pages/platform/security/PlatformFirewallOverview'))
const PlatformFirewallTargetDetail = lazy(() => import('./pages/platform/security/PlatformFirewallTargetDetail'))
const PlatformFirewallPorts = lazy(() => import('./pages/platform/security/PlatformFirewallPorts'))
const PlatformFirewallServices = lazy(() => import('./pages/platform/security/PlatformFirewallServices'))
const PlatformFirewallActivity = lazy(() => import('./pages/platform/security/PlatformFirewallActivity'))
const PlatformFirewallCompliance = lazy(() => import('./pages/platform/security/PlatformFirewallCompliance'))
const PlatformFirewallK8s = lazy(() => import('./pages/platform/security/PlatformFirewallK8s'))
const PlatformFirewallCloud = lazy(() => import('./pages/platform/security/PlatformFirewallCloud'))
const PlatformFirewallConnectivity = lazy(() => import('./pages/platform/security/PlatformFirewallConnectivity'))
const PlatformFirewallPolicies = lazy(() => import('./pages/platform/security/PlatformFirewallPolicies'))
const PlatformPolicy = lazy(() => import('./pages/platform/PlatformPolicy'))
const PlatformIntegrations = lazy(() => import('./pages/platform/PlatformIntegrations'))
const PlatformBlueprints = lazy(() => import('./pages/platform/PlatformBlueprints'))
const PlatformSupport = lazy(() => import('./pages/platform/PlatformSupport'))
const PlatformDeveloper = lazy(() => import('./pages/platform/PlatformDeveloper'))
const PlatformObservability = lazy(() => import('./pages/platform/PlatformObservability'))
const PlatformEnterprise = lazy(() => import('./pages/platform/PlatformEnterprise'))
const RdpConsole = lazy(() => import('./pages/RdpConsole'))
const MissionControl = lazy(() => import('./pages/MissionControl'))
const SystemCheck = lazy(() => import('./pages/SystemCheck'))

function AppZyvorFooter() {
  const { info } = usePlatformInfo()
  const hostOs = info?.host?.os_pretty_name?.trim()
  return <ZyvorFooter hostOs={hostOs || undefined} />
}

function GlobalShortcuts({
  helpOpen,
  helpTab,
  onOpenHelp,
  onCloseHelp,
  onHelpTabChange,
}: {
  helpOpen: boolean
  helpTab: HelpTab
  onOpenHelp: (tab?: HelpTab) => void
  onCloseHelp: () => void
  onHelpTabChange: (tab: HelpTab) => void
}) {
  const navigate = useNavigate()
  const location = useLocation()
  const shortcuts = useMemo(() => {
    const base: { sequence: [string, string]; handler: () => void }[] = [
      { sequence: ['g', 'd'], handler: () => navigate('/') },
      { sequence: ['g', 'v'], handler: () => navigate('/vms') },
      { sequence: ['g', 'n'], handler: () => navigate('/networks') },
      { sequence: ['g', 's'], handler: () => navigate('/storage') },
      { sequence: ['g', 'c'], handler: () => navigate('/create') },
      { sequence: ['g', 'e'], handler: () => navigate('/events') },
      { sequence: ['g', 'j'], handler: () => navigate('/jobs') },
      { sequence: ['g', 'b'], handler: () => navigate('/backups') },
      { sequence: ['g', 'i'], handler: () => navigate('/disk-images') },
      { sequence: ['g', 'k'], handler: () => navigate('/k8s/workloads') },
      { sequence: ['g', 'o'], handler: () => navigate('/openstack') },
    ]
    return base
  }, [navigate])

  useSequenceShortcuts(shortcuts)

  const toggleHelp = useCallback(
    (e: KeyboardEvent) => {
      if (isInputFocused()) return
      e.preventDefault()
      if (helpOpen) onCloseHelp()
      else onOpenHelp('shortcuts')
    },
    [helpOpen, onCloseHelp, onOpenHelp],
  )

  useKeyboardShortcut({ key: '?', handler: toggleHelp })
  useEffect(() => {
    const onOpen = (e: Event) => {
      const tab = (e as CustomEvent<{ tab?: HelpTab }>).detail?.tab ?? 'shortcuts'
      onOpenHelp(tab)
    }
    window.addEventListener(OPEN_HELP_EVENT, onOpen)
    return () => window.removeEventListener(OPEN_HELP_EVENT, onOpen)
  }, [onOpenHelp])
  useKeyboardShortcut({
    key: 'F3',
    handler: (e) => {
      if (isInputFocused()) return
      e.preventDefault()
      if (location.pathname.startsWith('/platform')) {
        window.dispatchEvent(new CustomEvent('machina-open-mission-control'))
      } else {
        navigate('/platform?mission=1')
      }
    },
  })

  return (
    <HelpDialog open={helpOpen} tab={helpTab} onClose={onCloseHelp} onTabChange={onHelpTabChange} />
  )
}

function AuthenticatedApp() {
  const { isAuthenticated, loading } = useAuth()

  if (loading) {
    return (
      <div className="min-h-screen dashboard-liquid-glass liquid-glass-app flex items-center justify-center">
        <div className="glass glass-elevated p-8 flex items-center justify-center">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-500" />
        </div>
      </div>
    )
  }

  if (!isAuthenticated) {
    return <LoginPage />
  }

  return <AuthenticatedShell />
}

function RouteRecorder() {
  useRecordRecentPage()
  return null
}

/** When the platform control plane is active, land on the macOS desktop (dock + menubar). */
function HomeRoute() {
  const { info, loading } = usePlatformInfo()
  if (!loading && info?.control_plane?.proxy_url) {
    return <Navigate to="/platform" replace />
  }
  return <Dashboard />
}

function AuthenticatedShell() {
  return (
    <WebSocketProvider>
      <PlatformInfoProvider>
        <BrowserRouter>
          <AiProvider>
            <AuthenticatedShellRoutes />
          </AiProvider>
        </BrowserRouter>
      </PlatformInfoProvider>
    </WebSocketProvider>
  )
}

function AuthenticatedShellRoutes() {
  const { theme } = useTheme()
  const location = useLocation()
  const isPlatformRoute = location.pathname.startsWith('/platform')
  const [helpOpen, setHelpOpen] = useState(false)
  const [helpTab, setHelpTab] = useState<HelpTab>('shortcuts')

  const openHelp = useCallback((tab: HelpTab = 'shortcuts') => {
    setHelpTab(tab)
    setHelpOpen(true)
  }, [])

  const closeHelp = useCallback(() => setHelpOpen(false), [])

  useEffect(() => {
    setHelpOpen(false)
  }, [location.pathname, location.search])

  const shellClass =
    theme === 'steel'
      ? 'dashboard-steel min-h-screen flex flex-col text-[#d7dde5]'
      : theme === 'aurora'
        ? 'dashboard-aurora min-h-screen flex flex-col text-[#e8e4f8]'
        : 'dashboard-liquid-glass liquid-glass-app min-h-screen flex flex-col text-[var(--text-primary)]'

  return (
    <>
          <RouteRecorder />
          <ToastRenderer />
          <div className={`${shellClass} flex flex-col min-h-dvh`}>
            <a
              href="#main-content"
              className="sr-only focus:not-sr-only focus:absolute focus:top-4 focus:left-4 focus:z-[9999] focus:px-4 focus:py-2 focus:bg-slate-900 focus:text-white focus:rounded-lg focus:shadow-lg focus:outline-none"
            >
              Skip to main content
            </a>
            {!isPlatformRoute && <Navbar onOpenHelp={openHelp} />}
            {!isPlatformRoute && <ShellBridgeBar />}
            <ZeusSpotlight onOpenHelp={openHelp} />
            <ZeusAssistant />
            <ZeusAmbientBar />
            <GlobalShortcuts
              helpOpen={helpOpen}
              helpTab={helpTab}
              onOpenHelp={openHelp}
              onCloseHelp={closeHelp}
              onHelpTabChange={setHelpTab}
            />
            <main
              id="main-content"
              className={
                isPlatformRoute
                  ? 'platform-route-main flex-1 min-w-0 flex flex-col w-full'
                  : `app-shell tahoe-page-root platform-readable flex-1 min-w-0 py-6 lg:py-8${theme === 'steel' ? ' steel-content' : ''}${theme === 'aurora' ? ' aurora-content' : ''}`
              }
              role="main"
            >
              {!isPlatformRoute && <Breadcrumb />}
              <Suspense fallback={<PageSkeleton />}>
                <Routes>
                <Route path="/login" element={<Navigate to="/" replace />} />
                <Route path="/" element={<HomeRoute />} />
                <Route path="/vms" element={<VMList />} />
                <Route path="/vms/:name" element={<VMDetails />} />
                <Route path="/vms/:name/console" element={<ClassicConsoleRedirect />} />
                <Route path="/vms/:name/consolehub" element={<ClassicConsoleHub />} />
                <Route path="/vms/:name/rdp" element={<RdpConsole />} />
                <Route path="/fleet" element={<Fleet />} />
                <Route path="/platform" element={<PlatformLayout />}>
                  <Route index element={<PlatformDashboard />} />
                  <Route path="hosts" element={<PlatformHosts />} />
                  <Route path="hosts/finder" element={<PlatformMachineFinder />} />
                  <Route path="hosts/:id" element={<PlatformHostDetail />} />
                  <Route path="vms" element={<PlatformVms />} />
                  <Route path="vms/:id" element={<PlatformVmDetail />} />
                  <Route path="vms/:id/consolehub" element={<PlatformConsoleHub />} />
                  <Route path="mission-control/live" element={<MissionControlLiveWall />} />
                  <Route path="vms/:id/console" element={<PlatformConsoleRedirect />} />
                  <Route path="applications" element={<PlatformApplications />} />
                  <Route path="launchpad/apps/:id" element={<PlatformLaunchpadAppDetail />} />
                  <Route path="launchpad/spaces/:spaceId" element={<PlatformLaunchpadSpace />} />
                  <Route path="launchpad" element={<PlatformLaunchpad />} />
                  <Route path="content" element={<PlatformContent />} />
                  <Route path="create-iso" element={<PlatformIsoCreate />} />
                  <Route path="create-advanced" element={<PlatformVirtInstallCreate />} />
                  <Route path="vm-builder" element={<PlatformVmBuilder />} />
                  <Route path="templates" element={<PlatformTemplates />} />
                  <Route path="cloud-init" element={<CloudInitStudio />} />
                  <Route path="network-canvas" element={<PlatformNetworkCanvas />} />
                  <Route path="datacenter" element={<PlatformDatacenter />} />
                  <Route path="migration" element={<PlatformMigration />} />
                  <Route path="backups" element={<PlatformBackups />} />
                  <Route path="fleet-snapshots" element={<PlatformFleetSnapshots />} />
                  <Route path="enroll" element={<PlatformEnroll />} />
                  <Route path="placement" element={<PlatformPlacement />} />
                  <Route path="tasks" element={<PlatformTasks />} />
                  <Route path="events" element={<PlatformEvents />} />
                  <Route path="activity" element={<PlatformActivityMonitor />} />
                  <Route path="recommendations" element={<PlatformRecommendations />} />
                  <Route path="topology" element={<PlatformTopology />} />
                  <Route path="developer" element={<PlatformDeveloper />} />
                  <Route path="observability" element={<PlatformObservability />} />
                  <Route path="enterprise" element={<PlatformEnterprise />} />
                  <Route path="zeus" element={<PlatformZeusOs />} />
                  <Route path="zeus/configure" element={<PlatformZeusSettings />} />
                  <Route path="ai-providers" element={<PlatformAiProviders />} />
                  <Route path="ha" element={<PlatformHa />} />
                  <Route path="baremetal" element={<PlatformBareMetal />} />
                  <Route path="storage-tiers" element={<PlatformStorageTiers />} />
                  <Route path="marketplace" element={<PlatformMarketplace />} />
                  <Route path="upgrade" element={<PlatformUpgrade />} />
                  <Route path="zeus/rightsizing" element={<PlatformRightsizing />} />
                  <Route path="zeus/incidents" element={<PlatformIncidentCommander />} />
                  <Route path="zeus/approvals" element={<PlatformZeusApprovals />} />
                  <Route path="zeus/security/hunt" element={<PlatformThreatHunting />} />
                  <Route path="zeus/security/enforcement" element={<PlatformRuntimeEnforcement />} />
                  <Route path="soc" element={<PlatformSoc />} />
                  <Route path="zeus/security" element={<PlatformSecurityCenter />} />
                  <Route path="zeus/machines/:hostId" element={<PlatformMachineSecurity />} />
                  <Route path="zeus/security/firewall" element={<PlatformFirewallOverview />} />
                  <Route path="zeus/security/firewall/:id" element={<PlatformFirewallTargetDetail />} />
                  <Route path="zeus/security/ports" element={<PlatformFirewallPorts />} />
                  <Route path="zeus/security/services" element={<PlatformFirewallServices />} />
                  <Route path="zeus/security/activity" element={<PlatformFirewallActivity />} />
                  <Route path="zeus/security/compliance" element={<PlatformFirewallCompliance />} />
                  <Route path="zeus/security/k8s" element={<PlatformFirewallK8s />} />
                  <Route path="zeus/security/cloud" element={<PlatformFirewallCloud />} />
                  <Route path="zeus/security/connectivity" element={<PlatformFirewallConnectivity />} />
                  <Route path="zeus/security/policies" element={<PlatformFirewallPolicies />} />
                  <Route path="policy" element={<PlatformPolicy />} />
                  <Route path="integrations" element={<PlatformIntegrations />} />
                  <Route path="infrastructure" element={<PlatformInfrastructureHub />} />
                  <Route path="workloads" element={<PlatformWorkloadsHub />} />
                  <Route path="administration" element={<PlatformAdministrationHub />} />
                  <Route path="resources" element={<PlatformResourcesHub />} />
                  <Route path="operations" element={<PlatformOperationsHub />} />
                  <Route path="blueprints" element={<PlatformBlueprints />} />
                  <Route path="support" element={<PlatformSupport />} />
                  <Route path="storage" element={<PlatformStorage />} />
                  <Route path="gpu" element={<PlatformGpuCommandCenter />} />
                  <Route path="networks" element={<PlatformNetworks />} />
                  <Route path="users" element={<PlatformUsers />} />
                  <Route path="webhooks" element={<PlatformWebhooks />} />
                  <Route path="reports" element={<PlatformReports />} />
                  <Route path="api-keys" element={<PlatformApiKeys />} />
                  <Route path="maintenance" element={<PlatformMaintenance />} />
                  <Route path="projects" element={<PlatformProjects />} />
                  <Route path="notifications" element={<PlatformNotifications />} />
                  <Route path="settings" element={<PlatformSettingsHub />} />
                  <Route path="*" element={<PlatformNotFound />} />
                </Route>
                <Route path="/create" element={<CreateVM />} />
                <Route path="/jobs/:jobId" element={<Jobs />} />
                <Route path="/jobs" element={<Jobs />} />
                <Route path="/k8s" element={<K8sOverview />} />
                <Route path="/k8s/workloads" element={<K8sWorkloads />} />
                <Route path="/k8s/kata" element={<KataContainers />} />
                <Route path="/openstack" element={<OpenStackOverview />} />
                <Route path="/openstack/instances" element={<OpenStackInstances />} />
                <Route path="/openstack/instances/:id" element={<OpenStackInstanceDetail />} />
                <Route path="/openstack/instances/:id/interfaces" element={<OpenStackInstanceInterfaces />} />
                <Route path="/openstack/create" element={<OpenStackCreateInstance />} />
                <Route path="/openstack/images" element={<OpenStackImages />} />
                <Route path="/openstack/images/:id" element={<OpenStackImageDetail />} />
                <Route path="/openstack/migrations" element={<OpenStackMigrations />} />
                <Route path="/openstack/security-groups" element={<OpenStackSecurityGroups />} />
                <Route path="/openstack/security-groups/:id" element={<OpenStackSecurityGroupDetail />} />
                <Route path="/openstack/volumes" element={<OpenStackVolumes />} />
                <Route path="/openstack/volumes/:id" element={<OpenStackVolumeDetail />} />
                <Route path="/openstack/floating-ips" element={<OpenStackFloatingIps />} />
                <Route path="/openstack/floating-ips/:id" element={<OpenStackFloatingIpDetail />} />
                <Route path="/openstack/networking" element={<OpenStackNetworking />} />
                <Route path="/openstack/keypairs" element={<OpenStackKeypairs />} />
                <Route path="/openstack/flavors" element={<OpenStackFlavors />} />
                <Route path="/openstack/flavors/:id" element={<OpenStackFlavorDetail />} />
                <Route path="/openstack/hypervisors/:id" element={<OpenStackHypervisorDetail />} />
                <Route path="/openstack/server-groups" element={<OpenStackServerGroups />} />
                <Route path="/openstack/server-groups/:id" element={<OpenStackServerGroupDetail />} />
                <Route path="/openstack/networks/:id" element={<OpenStackNetworkDetail />} />
                <Route path="/openstack/subnets/:id" element={<OpenStackSubnetDetail />} />
                <Route path="/openstack/routers/:id" element={<OpenStackRouterDetail />} />
                <Route path="/openstack/ports/:id" element={<OpenStackPortDetail />} />
                <Route path="/openstack/volume-transfers/:id" element={<OpenStackVolumeTransferDetail />} />
                <Route path="/openstack/volume-snapshots" element={<OpenStackVolumeSnapshots />} />
                <Route path="/openstack/volume-snapshots/:id" element={<OpenStackVolumeSnapshotDetail />} />
                <Route path="/openstack/heat" element={<OpenStackHeat />} />
                <Route path="/openstack/heat/:name/:id" element={<OpenStackHeatDetail />} />
                <Route path="/openstack/load-balancers" element={<OpenStackLoadBalancers />} />
                <Route path="/openstack/load-balancers/:id" element={<OpenStackLoadBalancerDetail />} />
                <Route path="/openstack/identity" element={<OpenStackIdentity />} />
                <Route path="/openstack/identity/projects/:id" element={<OpenStackIdentityProjectDetail />} />
                <Route path="/openstack/identity/users/:id" element={<OpenStackIdentityUserDetail />} />
                <Route path="/openstack/topology" element={<OpenStackTopology />} />
                <Route path="/openstack/instances/:id/console" element={<OpenStackConsole />} />
                <Route path="/networks" element={<Networks />} />
                <Route path="/storage" element={<Storage />} />
                <Route path="/storage/:pool" element={<StoragePoolDetail />} />
                <Route path="/disk-images" element={<DiskImages />} />
                <Route path="/snapshots" element={<Snapshots />} />
                <Route path="/node" element={<NodeInfo />} />
                <Route path="/events" element={<Events />} />
                <Route path="/capabilities" element={<Capabilities />} />
                <Route path="/devices" element={<Devices />} />
                <Route path="/nwfilters" element={<NWFilters />} />
                <Route path="/secrets" element={<Secrets />} />
                <Route path="/backups" element={<Backups />} />
                <Route path="/host-networking" element={<HostNetworking />} />
                <Route path="/host-ssh" element={<HostSSHPage />} />
                <Route path="/audit" element={<AuditLog />} />
                <Route path="/import" element={<ImportVM />} />
                <Route path="/ssh/:host" element={<SSHPage />} />
                <Route path="/ssh" element={<SSHPage />} />
                <Route path="/api-docs" element={<ApiDocs />} />
                <Route path="/services" element={<Services />} />
                <Route path="/mission-control" element={<MissionControl />} />
                <Route path="/system-check" element={<SystemCheck />} />
                <Route path="/logs" element={<Logs />} />
                <Route path="/settings" element={<SettingsPage />} />
                <Route path="/admin/sessions" element={<AdminSessions />} />
                <Route path="*" element={<NotFound />} />
              </Routes>
            </Suspense>
          </main>
          {!isPlatformRoute && <AppZyvorFooter />}
        </div>
    </>
  )
}

function App() {
  return (
    <ThemeProvider>
      <ToastProvider>
        <AuthProvider>
          <AuthenticatedApp />
        </AuthProvider>
      </ToastProvider>
    </ThemeProvider>
  )
}

export default App
