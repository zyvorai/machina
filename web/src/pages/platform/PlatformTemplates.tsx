// Copyright (c) 2026 ZyvorAI Labs Private Limited. All rights reserved.

import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router'
import { AlertTriangle, CheckCircle2, Layers, Loader2, Package, Plus, RefreshCw, Sparkles, Star, Puzzle } from 'lucide-react'
import DetailTabs from '../../components/platform/DetailTabs'
import PlatformPageChrome, { PlatformBackLink, PlatformRefreshButton } from '../../components/platform/PlatformPageChrome'
import { usePlatformTabState } from '../../hooks/usePlatformTabState'
import PageSkeleton from '../../components/PageSkeleton'
import PlatformEmptyState from '../../components/platform/PlatformEmptyState'
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
  seedDefaultTemplates,
  uninstallMarketplacePlugin,
  type MarketplacePlugin,
  type PlatformTemplate,
} from '../../api/platform'
import { useToastContext } from '../../contexts/ToastContext'
import { formatUserError } from '../../utils/apiError'
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
  const [tab, setTab] = usePlatformTabState<TabId>(MARKETPLACE_TABS.map((t) => t.id), { defaultTab: 'templates' })
  const [rows, setRows] = useState<PlatformTemplate[]>([])
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
  const [cloudUser, setCloudUser] = useState('ubuntu')
  const [cloudPass, setCloudPass] = useState('')
  const [cloudKey, setCloudKey] = useState('')
  const [deploying, setDeploying] = useState(false)
  const [readiness, setReadiness] = useState<{
    ready: boolean
    disk_exists: boolean
    host_online: number
    remediation: string
    source_disk: string
  } | null>(null)
  const [readinessLoading, setReadinessLoading] = useState(false)

  const loadReadiness = useCallback(async (t: PlatformTemplate) => {
    setReadinessLoading(true)
    setReadiness(null)
    try {
      setReadiness(await getTemplateReadiness(t.name, t.version))
    } catch {
      setReadiness({ ready: false, disk_exists: false, host_online: 0, remediation: 'Could not check readiness', source_disk: t.source_disk })
    } finally {
      setReadinessLoading(false)
    }
  }, [])

  useEffect(() => {
    if (deploySheet) void loadReadiness(deploySheet)
    else setReadiness(null)
  }, [deploySheet, loadReadiness])

  const load = useCallback(async (trySeed = false) => {
    setError(null)
    setLoading(true)
    try {
      let list = await listMarketplaceTemplates()
      if (list.length === 0 && trySeed) {
        const r = await seedDefaultTemplates()
        list = r.templates
        if (r.inserted > 0) toast.success(`Loaded ${r.templates.length} default templates`)
      }
      setRows(list)
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
      await createFromTemplate({
        template_ref: `${t.name}@${t.version}`,
        name: vmName,
        cloud_init_user: cloudUser || undefined,
        cloud_init_password: cloudPass || undefined,
        cloud_init_ssh_pubkey: cloudKey || undefined,
      })
      toast.success(`Deploying ${vmName} from ${t.name}`)
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
      prepend={<PlatformBackLink to="/platform/resources" label="Resources" />}
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
      {loading && rows.length === 0 && <PageSkeleton />}

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
              <MarketplaceCard key={t.id} template={t} onDeploy={() => { setDeployName(`${t.name.split('-')[0]}-01`); setDeploySheet(t) }} />
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
              <MarketplaceCard key={t.id} template={t} onDeploy={() => { setDeployName(`${t.name.split('-')[0]}-01`); setDeploySheet(t) }} />
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
            {readinessLoading ? (
              <p className="text-sm text-slate-500 flex items-center gap-2"><Loader2 className="w-4 h-4 animate-spin" /> Checking readiness…</p>
            ) : readiness && (
              <div className={`rounded-xl border p-3 text-sm ${statusSurfaceClasses(readiness.ready ? 'ok' : 'warn')}`}>
                <p className="font-medium flex items-center gap-2">
                  {readiness.ready ? <CheckCircle2 className="w-4 h-4" /> : <AlertTriangle className="w-4 h-4" />}
                  {readiness.ready ? 'Ready to deploy' : readiness.host_online === 0 ? 'No online hosts' : 'Missing disk image'}
                </p>
                <p className="text-xs mt-1 opacity-90">{readiness.remediation}</p>
                {!readiness.disk_exists && (
                  <p className="text-xs mt-2 font-mono text-slate-400">{readiness.source_disk}</p>
                )}
                {!readiness.ready && (
                  <Link to="/platform/content" className={`text-xs hover:underline mt-2 inline-block ${hubLinkClasses()}`}>Upload image in Content Library →</Link>
                )}
              </div>
            )}
            <label className="block text-sm">
              <span className="text-slate-400">VM name</span>
              <input className="input w-full mt-1" value={deployName} onChange={(e) => setDeployName(e.target.value)} />
            </label>
            {deploySheet.cloud_init && (
              <>
                <label className="block text-sm">
                  <span className="text-slate-400">Cloud-init user</span>
                  <input className="input w-full mt-1" value={cloudUser} onChange={(e) => setCloudUser(e.target.value)} />
                </label>
                <label className="block text-sm">
                  <span className="text-slate-400">Password (optional)</span>
                  <input type="password" className="input w-full mt-1" value={cloudPass} onChange={(e) => setCloudPass(e.target.value)} />
                </label>
                <label className="block text-sm">
                  <span className="text-slate-400">SSH public key (optional)</span>
                  <input className="input w-full mt-1" value={cloudKey} onChange={(e) => setCloudKey(e.target.value)} />
                </label>
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
          <input className="input" placeholder="name" value={name} onChange={(e) => setName(e.target.value)} />
          <input className="input" placeholder="version" value={version} onChange={(e) => setVersion(e.target.value)} />
          <input className="input md:col-span-2" placeholder="source disk path" value={disk} onChange={(e) => setDisk(e.target.value)} />
          <input className="input md:col-span-2" placeholder="description" value={description} onChange={(e) => setDescription(e.target.value)} />
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
          <input className="input text-sm" placeholder="slug" value={pluginSlug} onChange={(e) => setPluginSlug(e.target.value)} />
          <input className="input text-sm" placeholder="Name" value={pluginName} onChange={(e) => setPluginName(e.target.value)} />
          <input className="input text-sm md:col-span-2" placeholder="Description" value={pluginDesc} onChange={(e) => setPluginDesc(e.target.value)} />
          <input className="input text-sm" placeholder="Version" value={pluginVersion} onChange={(e) => setPluginVersion(e.target.value)} />
          <input className="input text-sm" placeholder="Author" value={pluginAuthor} onChange={(e) => setPluginAuthor(e.target.value)} />
          <button type="button" className="btn-primary md:col-span-2" onClick={() => void publishPlugin()}>Publish</button>
        </div>
      </MacSheet>
    </PlatformPageChrome>
  )
}

function MarketplaceCard({ template: t, onDeploy }: { template: PlatformTemplate; onDeploy: () => void }) {
  const needsImage = t.source_disk?.includes('.qcow2')
  return (
    <article className="platform-mac-stat rounded-2xl border border-white/[0.06] bg-slate-900/50 backdrop-blur-md p-5 flex flex-col hover:border-white/10 transition group">
      <div className="flex items-start gap-3">
        <span className="text-3xl group-hover:scale-110 transition-transform" aria-hidden>{templateIcon(t)}</span>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5 flex-wrap">
            <h3 className="font-semibold text-slate-100 truncate">{t.name}</h3>
            {t.featured && <Star className={`w-3 h-3 shrink-0 ${statusToneClass('warn')} fill-[var(--machina-status-warn)]`} />}
            {needsImage && (
              <span className="text-[10px] uppercase tracking-wide px-1.5 py-0.5 rounded bg-slate-800 text-slate-400 border border-white/[0.06]">Catalog</span>
            )}
          </div>
          <p className="text-xs text-slate-500">{t.category ?? 'Linux'} · v{t.version}</p>
        </div>
      </div>
      <p className="text-xs text-slate-400 mt-3 flex-1 leading-relaxed line-clamp-3">{t.description || 'Ready-to-deploy golden image.'}</p>
      {t.firewall_profile && (
        <p className="text-[10px] text-blue-300/90 mt-2">Zeus Firewall: {t.firewall_profile}</p>
      )}
      <button type="button" className="btn-primary text-xs mt-4 w-full" onClick={onDeploy}>
        Get · Deploy VM
      </button>
    </article>
  )
}
