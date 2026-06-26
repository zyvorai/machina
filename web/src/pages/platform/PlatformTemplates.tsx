// Copyright (c) 2026 ZyvorAI Labs Private Limited. All rights reserved.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router'
import { AlertTriangle, CheckCircle2, Download, GitBranch, Layers, Loader2, Package, Plus, RefreshCw, Sparkles, Star, Puzzle, Upload } from 'lucide-react'
import { readSshPubkeyFile } from '../../utils/sshPubkeyImport'
import DetailTabs from '../../components/platform/DetailTabs'
import PlatformPageChrome, { PlatformBackLink, PlatformRefreshButton } from '../../components/platform/PlatformPageChrome'
import { usePlatformTabState } from '../../hooks/usePlatformTabState'
import PlatformEmptyState from '../../components/platform/PlatformEmptyState'
import VmWizardReadinessBanner from '../../components/platform/VmWizardReadinessBanner'
import type { TemplateReadiness } from '../../api/platform'
import { MacGlassPanel, MacSheet } from '../../components/platform/mac/PlatformMacUi'
import {
  createFromTemplate,
  createTemplate,
  deleteTemplate,
  getTemplateReadiness,
  getMarketplacePlugins,
  installMarketplacePlugin,
  publishMarketplacePlugin,
  listMarketplaceTemplates,
  listPlatformTemplates,
  listMissingTemplateImages,
  seedDefaultTemplates,
  uninstallMarketplacePlugin,
  type MarketplacePlugin,
  type PlatformTemplate,
} from '../../api/platform'
import { approvePlatformTemplate, syncGitTemplates, syncGitTemplatesWebhook } from '../../api/platformTemplatesExtra'
import TemplateMissingImagesPanel from '../../components/platform/TemplateMissingImagesPanel'
import { cloudInitUserForOs } from '../../components/platform/vmWizardCatalog'
import { useToastContext } from '../../contexts/ToastContext'
import { usePlatformDesktopTier } from '../../hooks/usePlatformDesktopTier'
import { formatUserError } from '../../utils/apiError'
import { toastQueuedOperation } from '../../utils/platformTaskToast'
import {hostStateTone, httpStatusTone, migrationReadinessTone, riskTone, statusBadgeClasses, statusPillClasses, statusSurfaceClasses, statusToneClass, taskStatusTone, webhookDeliveryTone, hubLinkClasses} from '../../utils/semanticColors'

const CATEGORIES = ['All', 'Linux', 'Windows', 'Database', 'Appliance'] as const
const PLUGIN_CATEGORIES = ['All', 'automation', 'observability', 'migration', 'security', 'kubernetes', 'networking'] as const

type TabId = 'templates' | 'plugins'

const MARKETPLACE_TABS = [
  { id: 'templates' as const, label: 'Templates' },
  { id: 'plugins' as const, label: 'Plugins' },
]

function templateIcon(t: PlatformTemplate) {
  if (t.icon) return t.icon
  const fam = (t.os_family ?? t.category ?? '').toLowerCase()
  if (fam.includes('windows')) return '🪟'
  if (fam.includes('database') || t.name.includes('postgres')) return '🗄️'
  if (t.category === 'Appliance') return '📦'
  return '🐧'
}

export default function PlatformTemplates() {
  const toast = useToastContext()
  const [tier] = usePlatformDesktopTier()
  const [tab, setTab] = usePlatformTabState<TabId>(MARKETPLACE_TABS.map((t) => t.id), { defaultTab: 'templates' })
  const [rows, setRows] = useState<PlatformTemplate[]>([])
  const [fleetCatalog, setFleetCatalog] = useState<PlatformTemplate[]>([])
  const [plugins, setPlugins] = useState<MarketplacePlugin[]>([])
  const [pluginCategory, setPluginCategory] = useState<string>('All')
  const [pluginLoading, setPluginLoading] = useState(false)
  const [pluginPublishOpen, setPluginPublishOpen] = useState(false)
  const [pluginSlug, setPluginSlug] = useState('my-plugin')
  const [pluginName, setPluginName] = useState('My Plugin')
  const [pluginDesc, setPluginDesc] = useState('Integration module')
  const [pluginVersion, setPluginVersion] = useState('1.0.0')
  const [pluginAuthor, setPluginAuthor] = useState('Zyvor')
  const [pluginAction, setPluginAction] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [category, setCategory] = useState<string>('All')
  const [deploySheet, setDeploySheet] = useState<PlatformTemplate | null>(null)
  const [publishOpen, setPublishOpen] = useState(false)
  const [name, setName] = useState('ubuntu-24.04')
  const [version, setVersion] = useState('1.0.0')
  const [disk, setDisk] = useState('/var/lib/libvirt/images/ubuntu-24.04.qcow2')
  const [description, setDescription] = useState('Ubuntu 24.04 LTS with cloud-init')
  const [tplCategory, setTplCategory] = useState('Linux')
  const [featured, setFeatured] = useState(false)
  const [deployName, setDeployName] = useState('app-01')
  const [deployHostname, setDeployHostname] = useState('app-01')
  const [cloudUser, setCloudUser] = useState('ubuntu')
  const [cloudPass, setCloudPass] = useState('')
  const [cloudKey, setCloudKey] = useState('')
  const cloudKeyFileRef = useRef<HTMLInputElement>(null)
  const [deploying, setDeploying] = useState(false)
  const [readiness, setReadiness] = useState<TemplateReadiness | null>(null)
  const [readinessLoading, setReadinessLoading] = useState(false)
  const [missingImages, setMissingImages] = useState<Awaited<ReturnType<typeof listMissingTemplateImages>> | null>(null)

  const loadReadiness = useCallback(async (t: PlatformTemplate) => {
    setReadinessLoading(true)
    setReadiness(null)
    try {
      setReadiness(await getTemplateReadiness(t.name, t.version))
    } catch {
      setReadiness({
        ready: false,
        disk_exists: false,
        host_online: 0,
        auto_fetch: false,
        remediation: 'Could not check readiness',
        source_disk: t.source_disk,
        cloud_init: t.cloud_init,
      })
    } finally {
      setReadinessLoading(false)
    }
  }, [])

  useEffect(() => {
    if (deploySheet) void loadReadiness(deploySheet)
    else setReadiness(null)
  }, [deploySheet, loadReadiness])

  useEffect(() => {
    if (!deploySheet) return
    setCloudUser(cloudInitUserForOs(deploySheet.name))
    setDeployName(`${deploySheet.name.split('-')[0] ?? 'app'}-01`)
    setDeployHostname(`${deploySheet.name.split('-')[0] ?? 'app'}-01`)
  }, [deploySheet])

  const load = useCallback(async (trySeed = false) => {
    setError(null)
    setLoading(true)
    try {
      const [marketplace, fleet] = await Promise.all([
        listMarketplaceTemplates(),
        listPlatformTemplates().catch(() => [] as PlatformTemplate[]),
      ])
      let list = marketplace
      if (list.length === 0 && trySeed) {
        const r = await seedDefaultTemplates()
        list = r.templates
        if (r.inserted > 0) toast.success(`Loaded ${r.templates.length} default templates`)
      }
      setRows(list)
      setFleetCatalog(fleet)
      const missing = await listMissingTemplateImages().catch(() => null)
      setMissingImages(missing)
    } catch (e: unknown) {
      setError(formatUserError(e))
    } finally {
      setLoading(false)
    }
  }, [toast])

  useEffect(() => { void load(true) }, [load])

  const loadPlugins = useCallback(async () => {
    setPluginLoading(true)
    try {
      const r = await getMarketplacePlugins()
      setPlugins(r.plugins)
    } catch (e: unknown) {
      setError(formatUserError(e))
    } finally {
      setPluginLoading(false)
    }
  }, [])

  useEffect(() => {
    if (tab === 'plugins') void loadPlugins()
  }, [tab, loadPlugins])

  const filteredPlugins = useMemo(() => {
    if (pluginCategory === 'All') return plugins
    return plugins.filter((p) => p.category === pluginCategory)
  }, [plugins, pluginCategory])

  const togglePlugin = async (p: MarketplacePlugin) => {
    setPluginAction(p.slug)
    try {
      const r = p.installed
        ? await uninstallMarketplacePlugin(p.slug)
        : await installMarketplacePlugin(p.slug)
      toast.success(r.summary)
      await loadPlugins()
    } catch (e: unknown) {
      toast.error(formatUserError(e))
    } finally {
      setPluginAction(null)
    }
  }

  const featuredRows = useMemo(() => rows.filter((t) => t.featured), [rows])
  const filtered = useMemo(() => {
    if (category === 'All') return rows
    return rows.filter((t) => (t.category ?? 'Linux') === category)
  }, [rows, category])

  const deploy = async (t: PlatformTemplate, vmName: string) => {
    setDeploying(true)
    try {
      const r = await createFromTemplate({
        template_ref: `${t.name}@${t.version}`,
        name: vmName,
        template_vars: {
          hostname: deployHostname || vmName,
          name: vmName,
        },
        cloud_init_user: cloudUser || undefined,
        cloud_init_password: cloudPass || undefined,
        cloud_init_ssh_pubkey: cloudKey || undefined,
      })
      toastQueuedOperation(toast, `Deploying ${vmName} from ${t.name}`, r.task_id, tier)
      setDeploySheet(null)
    } catch (e: unknown) {
      toast.error(formatUserError(e))
    } finally {
      setDeploying(false)
    }
  }

  const add = async () => {
    try {
      await createTemplate({
        name,
        version,
        source_disk: disk,
        cloud_init: true,
        os_family: tplCategory === 'Windows' ? 'windows' : 'linux',
        category: tplCategory,
        description,
        featured,
        marketplace: true,
      })
      toast.success('Template published')
      setPublishOpen(false)
      await load(false)
    } catch (e: unknown) {
      toast.error(formatUserError(e))
    }
  }

  const publishPlugin = async () => {
    try {
      await publishMarketplacePlugin({
        slug: pluginSlug,
        name: pluginName,
        category: pluginCategory === 'All' ? 'automation' : pluginCategory,
        description: pluginDesc,
        version: pluginVersion,
        author: pluginAuthor,
      })
      toast.success('Plugin published')
      setPluginPublishOpen(false)
      await loadPlugins()
    } catch (e: unknown) {
      toast.error(formatUserError(e))
    }
  }

  return (
    <PlatformPageChrome
      error={error}
      onErrorRetry={() => void load(false)}
      loading={loading && rows.length === 0}
      prepend={<PlatformBackLink to="/platform/infrastructure" label="Infrastructure" />}
      title="Marketplace"
      subtitle="Golden image templates and platform integration plugins."
      icon={<Package className="w-6 h-6 text-slate-400" />}
      actions={
        <>
          {tab === 'templates' && (
            <>
              <button type="button" className="btn-secondary text-sm" onClick={() => void load(false)} disabled={loading}>
                <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
              </button>
              <button type="button" className="btn-secondary text-sm" onClick={() => void seedDefaultTemplates().then((r) => { setRows(r.templates); toast.success(`Catalog: ${r.templates.length} templates`) }).catch((e) => toast.error(formatUserError(e)))}>
                Restore defaults
              </button>
              <button
                type="button"
                className="btn-secondary text-sm flex items-center gap-1.5"
                title="POST /api/v1/templates/sync-git — pull from configured git remote"
                onClick={() =>
                  void syncGitTemplates()
                    .then((r) => toast.success(`Synced ${r.synced} template(s) from git`))
                    .catch((e) => toast.error(formatUserError(e)))
                }
              >
                <GitBranch className="w-4 h-4" /> Sync git
              </button>
              <button
                type="button"
                className="btn-secondary text-sm flex items-center gap-1.5"
                title="CI webhook: POST /api/v1/templates/sync-git/webhook with X-Machina-Template-Sync-Token"
                onClick={() =>
                  void syncGitTemplatesWebhook()
                    .then((r) => toast.success(`Webhook sync: ${r.synced} template(s)${r.source ? ` (${r.source})` : ''}`))
                    .catch((e) => toast.error(formatUserError(e)))
                }
              >
                <Upload className="w-4 h-4" /> Webhook sync
              </button>
              <Link to="/platform/cloud-init" className="btn-secondary text-sm">
                Cloud-Init Studio
              </Link>
              <button type="button" className="btn-primary text-sm flex items-center gap-1.5" onClick={() => setPublishOpen(true)}>
                <Plus className="w-4 h-4" /> Publish
              </button>
            </>
          )}
          {tab === 'plugins' && (
            <button type="button" className="btn-secondary text-sm flex items-center gap-1.5" disabled={pluginLoading} onClick={() => void loadPlugins()}>
              <RefreshCw className={`w-4 h-4 ${pluginLoading ? 'animate-spin' : ''}`} /> Refresh
            </button>
          )}
          <PlatformRefreshButton onClick={() => void (tab === 'plugins' ? loadPlugins() : load(false))} />
        </>
      }
      contentClassName="space-y-4"
    >
      <DetailTabs primary={MARKETPLACE_TABS} active={tab} onChange={setTab} />

      {tab === 'templates' && (
        <>
      {missingImages && missingImages.count > 0 && (
        <TemplateMissingImagesPanel
          summary={missingImages.summary}
          missing={missingImages.missing}
          autoFetchCount={missingImages.auto_fetch_count}
          onPrefetchQueued={() => void load(false)}
        />
      )}
      {fleetCatalog.length > 0 && (
        <MacGlassPanel title="Fleet template catalog" subtitle="Controller-registered golden images (GET /api/v1/templates) — includes marketplace and private fleet images.">
          <p className="text-sm text-slate-400 mb-2">{fleetCatalog.length} template(s) in fleet catalog</p>
          <ul className="flex flex-wrap gap-2 text-xs">
            {fleetCatalog.map((t) => (
              <li key={`${t.name}-${t.version}`} className="px-2 py-1 rounded-lg bg-slate-800/80 text-slate-300 font-mono">
                {t.name}:{t.version}
              </li>
            ))}
          </ul>
        </MacGlassPanel>
      )}

      {!loading && rows.length === 0 && (
        <PlatformEmptyState
          icon={Package}
          title="Marketplace is empty"
          subtitle="Load the bundled Zyvor template catalog — Ubuntu, Debian, Windows, PostgreSQL, and more."
          action={<button type="button" className="btn-primary" onClick={() => void load(true)}>Load default templates</button>}
        />
      )}

      {featuredRows.length > 0 && (
        <section>
          <h2 className="text-sm font-semibold text-slate-300 mb-3 flex items-center gap-2">
            <Sparkles className={`w-4 h-4 ${statusToneClass('warn')}`} /> Featured
          </h2>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {featuredRows.map((t) => (
              <MarketplaceCard
                key={t.id}
                template={t}
                onDeploy={() => { setDeployName(`${t.name.split('-')[0]}-01`); setDeploySheet(t) }}
                onApprove={(status) => void approvePlatformTemplate(t.name, t.version, status).then(() => load(false)).catch((e) => toast.error(formatUserError(e)))}
              />
            ))}
          </div>
        </section>
      )}

      {rows.length > 0 && (
        <>
          <div className="flex flex-wrap gap-2">
            {CATEGORIES.map((c) => (
              <button
                key={c}
                type="button"
                onClick={() => setCategory(c)}
                className={`px-3 py-1.5 rounded-full text-xs font-medium transition ${
                  category === c
                    ? 'bg-blue-500/20 text-blue-200 border border-blue-500/30'
                    : 'bg-slate-900/60 text-slate-400 border border-white/[0.06] hover:border-white/10'
                }`}
              >
                {c}
                {c !== 'All' && (
                  <span className="ml-1 opacity-60">
                    {rows.filter((t) => (t.category ?? 'Linux') === c).length}
                  </span>
                )}
              </button>
            ))}
          </div>

          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {filtered.map((t) => (
              <MarketplaceCard
                key={t.id}
                template={t}
                onDeploy={() => { setDeployName(`${t.name.split('-')[0]}-01`); setDeploySheet(t) }}
                onApprove={(status) => void approvePlatformTemplate(t.name, t.version, status).then(() => load(false)).catch((e) => toast.error(formatUserError(e)))}
              />
            ))}
          </div>
          {filtered.length === 0 && (
            <p className="text-center text-slate-500 py-8">No templates in {category} — try another category.</p>
          )}
        </>
      )}

      <MacSheet
        open={!!deploySheet}
        onClose={() => setDeploySheet(null)}
        title={deploySheet ? `Deploy ${deploySheet.name}` : 'Deploy'}
        subtitle={deploySheet?.description}
      >
        {deploySheet && (
          <div className="space-y-4">
            <div className="flex items-center gap-3">
              <span className="text-4xl">{templateIcon(deploySheet)}</span>
              <div>
                <p className="font-medium text-slate-100">{deploySheet.name}@{deploySheet.version}</p>
                <p className="text-xs text-slate-500">{deploySheet.category}</p>
              </div>
            </div>
            <VmWizardReadinessBanner
              loading={readinessLoading}
              readiness={readiness}
              templateName={deploySheet.name}
              templateVersion={deploySheet.version}
              onReadinessChange={setReadiness}
            />
            <label className="block text-sm">
              <span className="text-slate-400">VM name</span>
              <input className="input w-full mt-1" value={deployName} onChange={(e) => setDeployName(e.target.value)} />
            </label>
            <label className="block text-sm">
              <span className="text-slate-400">Hostname (substitutes <code className="text-xs">{'{{ hostname }}'}</code> in cloud-init)</span>
              <input className="input w-full mt-1" value={deployHostname} onChange={(e) => setDeployHostname(e.target.value)} placeholder={deployName} />
            </label>
            {deploySheet.cloud_init && (
              <>
                <p className="text-xs text-slate-500">
                  <Link to="/platform/cloud-init" className={hubLinkClasses()}>Cloud-Init Studio</Link> — validate #cloud-config before deploy.
                </p>
                <label className="block text-sm">
                  <span className="text-slate-400">Cloud-init user</span>
                  <input className="input w-full mt-1" value={cloudUser} onChange={(e) => setCloudUser(e.target.value)} />
                </label>
                <label className="block text-sm">
                  <span className="text-slate-400">Password (optional)</span>
                  <input type="password" autoComplete="new-password" className="input w-full mt-1" value={cloudPass} onChange={(e) => setCloudPass(e.target.value)} />
                </label>
                <label className="block text-sm">
                  <span className="text-slate-400">SSH public key (optional)</span>
                  <textarea
                    className="input w-full mt-1 font-mono text-xs min-h-[4rem]"
                    placeholder="ssh-ed25519 AAAA… user@host"
                    value={cloudKey}
                    onChange={(e) => setCloudKey(e.target.value)}
                  />
                </label>
                <div className="flex flex-wrap items-center gap-2">
                  <input
                    ref={cloudKeyFileRef}
                    type="file"
                    accept=".pub,text/plain"
                    className="hidden"
                    onChange={(e) => readSshPubkeyFile(e.target.files?.[0], setCloudKey)}
                  />
                  <button
                    type="button"
                    className="btn-secondary text-xs inline-flex items-center gap-1"
                    onClick={() => cloudKeyFileRef.current?.click()}
                  >
                    <Upload className="w-3 h-3" /> Import public key (.pub)
                  </button>
                </div>
              </>
            )}
            <button type="button" className="btn-primary w-full flex items-center justify-center gap-2" disabled={deploying || readinessLoading || (readiness != null && !readiness.ready)} onClick={() => void deploy(deploySheet, deployName)}>
              {deploying ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
              Deploy VM
            </button>
          </div>
        )}
      </MacSheet>

      <MacSheet open={publishOpen} onClose={() => setPublishOpen(false)} title="Publish template" subtitle="Add a golden image to the marketplace." wide>
        <div className="grid gap-3 md:grid-cols-2">
          <input aria-label="Template name" className="input" placeholder="name" value={name} onChange={(e) => setName(e.target.value)} />
          <input aria-label="Template version" className="input" placeholder="version" value={version} onChange={(e) => setVersion(e.target.value)} />
          <input aria-label="Source disk path" className="input md:col-span-2" placeholder="source disk path" value={disk} onChange={(e) => setDisk(e.target.value)} />
          <input aria-label="Description" className="input md:col-span-2" placeholder="description" value={description} onChange={(e) => setDescription(e.target.value)} />
          <select className="input" value={tplCategory} onChange={(e) => setTplCategory(e.target.value)}>
            {CATEGORIES.filter((c) => c !== 'All').map((c) => (
              <option key={c} value={c}>{c}</option>
            ))}
          </select>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={featured} onChange={(e) => setFeatured(e.target.checked)} />
            Featured
          </label>
          <button type="button" className="btn-primary md:col-span-2" onClick={() => void add()}>Publish to marketplace</button>
        </div>
      </MacSheet>
        </>
      )}

      {tab === 'plugins' && (
        <MacGlassPanel title="Platform plugins" subtitle="Integration modules — install or publish to the marketplace.">
          <div className="flex justify-end mb-3">
            <button type="button" className="tahoe-btn-ghost text-xs" onClick={() => setPluginPublishOpen(true)}>Publish plugin</button>
          </div>
          {pluginLoading && plugins.length === 0 ? (
            <p className="text-sm text-slate-400 flex items-center gap-2"><Loader2 className="w-4 h-4 animate-spin" /> Loading plugins…</p>
          ) : (
            <>
              <div className="flex flex-wrap gap-2 mb-4">
                {PLUGIN_CATEGORIES.map((c) => (
                  <button
                    key={c}
                    type="button"
                    onClick={() => setPluginCategory(c)}
                    className={`px-3 py-1.5 rounded-full text-xs font-medium capitalize transition ${
                      pluginCategory === c
                        ? 'bg-violet-500/20 text-violet-200 border border-violet-500/30'
                        : 'bg-slate-900/60 text-slate-400 border border-white/[0.06]'
                    }`}
                  >
                    {c}
                  </button>
                ))}
              </div>
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                {filteredPlugins.map((p) => (
                  <article key={p.id} className="rounded-2xl border border-white/[0.06] bg-slate-900/40 p-4 flex flex-col gap-3">
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <p className="font-semibold text-slate-100 flex items-center gap-2">
                          <Package className="w-4 h-4 text-violet-400" /> {p.name}
                        </p>
                        <p className="text-xs text-slate-500 mt-0.5">{p.author} · v{p.version} · {p.category}</p>
                      </div>
                      {p.featured && <Star className={`w-4 h-4 shrink-0 ${statusToneClass('warn')}`} />}
                    </div>
                    <p className="text-sm text-slate-400 flex-1">{p.description}</p>
                    <button
                      type="button"
                      className={p.installed ? 'btn-secondary text-xs' : 'btn-primary text-xs'}
                      disabled={pluginAction === p.slug}
                      onClick={() => void togglePlugin(p)}
                    >
                      {pluginAction === p.slug ? <Loader2 className="w-3 h-3 animate-spin inline" /> : p.installed ? 'Uninstall' : 'Install'}
                    </button>
                  </article>
                ))}
              </div>
            </>
          )}
        </MacGlassPanel>
      )}
      <MacSheet open={pluginPublishOpen} onClose={() => setPluginPublishOpen(false)} title="Publish plugin" subtitle="Register a marketplace integration module.">
        <div className="grid gap-3 md:grid-cols-2">
          <input aria-label="Plugin slug" className="input text-sm" placeholder="slug" value={pluginSlug} onChange={(e) => setPluginSlug(e.target.value)} />
          <input aria-label="Plugin name" className="input text-sm" placeholder="Name" value={pluginName} onChange={(e) => setPluginName(e.target.value)} />
          <input aria-label="Plugin description" className="input text-sm md:col-span-2" placeholder="Description" value={pluginDesc} onChange={(e) => setPluginDesc(e.target.value)} />
          <input aria-label="Plugin version" className="input text-sm" placeholder="Version" value={pluginVersion} onChange={(e) => setPluginVersion(e.target.value)} />
          <input aria-label="Plugin author" className="input text-sm" placeholder="Author" value={pluginAuthor} onChange={(e) => setPluginAuthor(e.target.value)} />
          <button type="button" className="btn-primary md:col-span-2" onClick={() => void publishPlugin()}>Publish</button>
        </div>
      </MacSheet>
    </PlatformPageChrome>
  )
}

function MarketplaceCard({
  template: t,
  onDeploy,
  onApprove,
}: {
  template: PlatformTemplate
  onDeploy: () => void
  onApprove: (status: string) => void
}) {
  const needsImage = t.source_disk?.includes('.qcow2')
  const approval = t.approval_status ?? 'approved'
  return (
    <article className="platform-mac-stat rounded-2xl border border-white/[0.06] bg-slate-900/50 backdrop-blur-md p-5 flex flex-col hover:border-white/10 transition group">
      <div className="flex items-start gap-3">
        <span className="text-3xl group-hover:scale-110 transition-transform" aria-hidden>{templateIcon(t)}</span>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5 flex-wrap">
            <h3 className="font-semibold text-slate-100 truncate">{t.name}</h3>
            {t.featured && <Star className={`w-3 h-3 shrink-0 ${statusToneClass('warn')} fill-[var(--machina-status-warn)]`} />}
            {approval !== 'approved' && (
              <span className={`text-[10px] uppercase px-1.5 py-0.5 rounded ${statusBadgeClasses(approval === 'rejected' ? 'error' : 'warn')}`}>
                {approval}
              </span>
            )}
            {needsImage && (
              <span className="text-[10px] uppercase tracking-wide px-1.5 py-0.5 rounded bg-slate-800 text-slate-400 border border-white/[0.06]">Catalog</span>
            )}
            {t.auto_fetch && (
              <span className="text-[10px] uppercase tracking-wide px-1.5 py-0.5 rounded bg-emerald-500/15 text-emerald-300 border border-emerald-500/25 inline-flex items-center gap-0.5">
                <Download className="w-2.5 h-2.5" /> Auto-fetch
              </span>
            )}
            {needsImage && t.auto_fetch === false && (
              <span className="text-[10px] uppercase tracking-wide px-1.5 py-0.5 rounded bg-amber-500/10 text-amber-200/90 border border-amber-500/20">Manual upload</span>
            )}
          </div>
          <p className="text-xs text-slate-500">{t.category ?? 'Linux'} · v{t.version}{t.workload ? ` · ${t.workload}` : ''}</p>
        </div>
      </div>
      <p className="text-xs text-slate-400 mt-3 flex-1 leading-relaxed line-clamp-3">
        {t.description || (t.auto_fetch ? 'Downloads on first deploy when missing on the host.' : 'Upload the golden image to the host path before deploy.')}
      </p>
      {t.firewall_profile && (
        <p className="text-[10px] text-blue-300/90 mt-2">Zeus Firewall: {t.firewall_profile}</p>
      )}
      {approval === 'pending' && (
        <div className="flex gap-1 mt-2">
          <button type="button" className="btn-secondary text-[10px] flex-1" onClick={() => onApprove('approved')}>Approve</button>
          <button type="button" className="btn-secondary text-[10px] flex-1" onClick={() => onApprove('rejected')}>Reject</button>
        </div>
      )}
      <button type="button" className="btn-primary text-xs mt-4 w-full" onClick={onDeploy}>
        Get · Deploy VM
      </button>
    </article>
  )
}
