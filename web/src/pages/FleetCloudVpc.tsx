// Copyright 2026 Zyvor AI Labs · https://zyvor.dev
// SPDX-License-Identifier: LicenseRef-Zyvor-Production-1.0

import { useCallback, useEffect, useRef, useState } from 'react'
import * as cloud from '../api/cloud'
import { listProjectRegistry, type NativeProject } from '../api/nativeProjects'
import { platformFetch } from '../api/platform'
import PageLayout from '../components/PageLayout'
import FleetCloudSubNav from '../components/FleetCloudSubNav'
import FleetCloudFooter from '../components/FleetCloudFooter'
import { useToastContext } from '../contexts/ToastContext'
import { formatUserError } from '../utils/apiError'

type Host = { id: string; hostname: string; state: string }
const field = 'form-selector p-2 text-[var(--text-primary)]'
export default function FleetCloudVpc() {
  const toast = useToastContext()
  const [projects, setProjects] = useState<NativeProject[]>([])
  const [hosts, setHosts] = useState<Host[]>([])
  const [project, setProject] = useState('')
  const [vpcs, setVpcs] = useState<cloud.Vpc[]>([])
  const [selected, setSelected] = useState('')
  const [subnets, setSubnets] = useState<cloud.Subnet[]>([])
  const [groups, setGroups] = useState<cloud.InstanceGroup[]>([])
  const [templates, setTemplates] = useState<cloud.LaunchTemplate[]>([])
  const [plan, setPlan] = useState<cloud.CloudPlan | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [name, setName] = useState('')
  const [cidr, setCidr] = useState('10.20.0.0/16')
  const [host, setHost] = useState('')
  const [subnetName, setSubnetName] = useState('')
  const [subnetCidr, setSubnetCidr] = useState('10.20.1.0/24')
  const [templateName, setTemplateName] = useState('')
  const [vmJson, setVmJson] = useState('')
  const [groupName, setGroupName] = useState('')
  const [templateId, setTemplateId] = useState('')
  const [subnetId, setSubnetId] = useState('')
  const [desired, setDesired] = useState(1)
  const selection = useRef({ project, selected })
  selection.current = { project, selected }

  useEffect(() => {
    let alive = true
    Promise.all([listProjectRegistry(), platformFetch<Host[]>('/api/v1/hosts')]).then(([p, h]) => {
      if (!alive) return
      setProjects(p.filter(p => p.enabled)); setHosts(h.filter(h => h.state === 'online'))
      setProject(p.find(p => p.enabled)?.id ?? ''); setHost(h.find(h => h.state === 'online')?.id ?? '')
    }).catch(e => { if (alive) setError(formatUserError(e)) })
    return () => { alive = false }
  }, [])
  useEffect(() => {
    setVpcs([]); setGroups([]); setTemplates([]); setSelected(''); setPlan(null); setSubnets([]); setSubnetId(''); setTemplateId('')
    if (!project) return
    let alive = true
    Promise.all([cloud.listVpcs(project), cloud.listInstanceGroups(project), cloud.listLaunchTemplates(project)]).then(([v, g, t]) => {
      if (!alive) return
      setVpcs(v); setGroups(g); setTemplates(t); setSelected(v[0]?.id ?? ''); setError(null)
    }).catch(e => { if (alive) setError(formatUserError(e)) })
    return () => { alive = false }
  }, [project])
  const refresh = useCallback(async () => {
    if (!project) return
    const [v, g, t] = await Promise.all([cloud.listVpcs(project), cloud.listInstanceGroups(project), cloud.listLaunchTemplates(project)])
    if (selection.current.project !== project) return
    setVpcs(v); setGroups(g); setTemplates(t)
    if (selected) { const s = await cloud.listSubnets(selected); if (selection.current.project === project && selection.current.selected === selected) setSubnets(s) }
  }, [project, selected])
  useEffect(() => {
    setPlan(null); setSubnets([]); setSubnetId('')
    if (!selected) return
    let alive = true
    const load = () => cloud.listSubnets(selected).then(s => { if (alive) setSubnets(s) }).catch(e => { if (alive) setError(formatUserError(e)) })
    void load(); const timer = setInterval(load, 10000)
    return () => { alive = false; clearInterval(timer) }
  }, [selected])
  async function action(work: () => Promise<unknown>) {
    setBusy(true)
    try { await work(); await refresh(); setError(null) } catch (e) { setError(formatUserError(e)); toast.error(formatUserError(e)) } finally { setBusy(false) }
  }
  return <PageLayout title="Virtual private clouds" subtitle="Isolated networks and elastic instances on your hosts." prepend={<FleetCloudSubNav />} error={error}>
    <div className="space-y-6">
      <div className="flex flex-wrap gap-3 items-center">
        <label>Project <select aria-label="Project" disabled={busy} className={field} value={project} onChange={e => setProject(e.target.value)}>{projects.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</select></label>
        <button className="btn btn-secondary" disabled={!project || busy} onClick={() => void action(async () => undefined)}>Refresh</button>
      </div>
      <p className="text-[var(--text-secondary)]">Subnets currently operate on one host. Routing and peering are available as plans; they do not forward traffic yet.</p>
      <section className="tahoe-glass-card p-5 space-y-3" aria-label="Create VPC">
        <h2 className="text-lg font-semibold">Create a VPC</h2>
        <form className="flex flex-wrap gap-3" onSubmit={e => { e.preventDefault(); void action(async () => { const v = await cloud.createVpc(project, { name, cidr, host_id: host }); setSelected(v.id); setName('') }) }}>
          <input aria-label="VPC name" placeholder="VPC name" className={field} required value={name} onChange={e => setName(e.target.value)} />
          <input aria-label="VPC CIDR" className={field} required value={cidr} onChange={e => setCidr(e.target.value)} />
          <select aria-label="Host" className={field} value={host} onChange={e => setHost(e.target.value)}>{hosts.map(h => <option key={h.id} value={h.id}>{h.hostname}</option>)}</select>
          <button className="btn btn-primary" disabled={busy || !project || !host}>Create VPC</button>
        </form>
      </section>
      <section className="tahoe-glass-card p-5 space-y-3" aria-label="Subnets">
        <h2 className="text-lg font-semibold">Subnets</h2>
        <select aria-label="VPC" className={field} value={selected} onChange={e => setSelected(e.target.value)}><option value="">Choose a VPC</option>{vpcs.map(v => <option key={v.id} value={v.id}>{v.name} · {v.cidr}</option>)}</select>
        <form className="flex flex-wrap gap-3" onSubmit={e => { e.preventDefault(); void action(() => cloud.createSubnet(selected, { name: subnetName, cidr: subnetCidr })) }}>
          <input aria-label="Subnet name" placeholder="Subnet name" className={field} required value={subnetName} onChange={e => setSubnetName(e.target.value)} />
          <input aria-label="Subnet CIDR" className={field} required value={subnetCidr} onChange={e => setSubnetCidr(e.target.value)} />
          <button className="btn btn-primary" disabled={busy || !selected}>Create subnet</button>
          <button type="button" className="btn btn-secondary" disabled={busy || !selected} onClick={() => void action(async () => setPlan(await cloud.getCloudPlan(selected)))}>Inspect plan</button>
        </form>
        {subnets.length === 0 && <p>No subnets yet.</p>}
        <ul className="divide-y divide-[var(--apple-hairline)]">{subnets.map(s => <li key={s.id} className="py-3 flex flex-wrap gap-3 items-center"><span>{s.name} · {s.cidr}</span><span>{s.status}</span>{s.last_error && <span role="alert">{s.last_error}</span>}{s.status === 'error' && <button className="btn btn-secondary" disabled={busy} onClick={() => void action(() => cloud.retrySubnet(s.id))}>Retry {s.name}</button>}</li>)}</ul>
        {plan && <div className="space-y-2"><h3 className="font-semibold">Network plan</h3><p>Forwarding active: {plan.forwarding_active ? 'yes' : 'no'}</p><ul>{plan.warnings.map(w => <li key={w}>{w}</li>)}</ul><pre className="overflow-auto text-xs">{JSON.stringify({ routes: plan.routes, peerings: plan.peerings }, null, 2)}</pre></div>}
      </section>
      <section className="tahoe-glass-card p-5 space-y-3" aria-label="Launch templates">
        <h2 className="text-lg font-semibold">Launch templates</h2><p className="text-[var(--text-secondary)]">Save a VM spec as an immutable template. Passwords and public console listeners are rejected.</p>
        <form className="space-y-3" onSubmit={e => { e.preventDefault(); void action(() => cloud.createLaunchTemplate(project, templateName, JSON.parse(vmJson))) }}>
          <input aria-label="Template name" placeholder="Template name" required className={field} value={templateName} onChange={e => setTemplateName(e.target.value)} />
          <textarea aria-label="VM spec JSON" placeholder="Paste a VirtualMachine JSON spec" required className={`${field} block w-full min-h-32 font-mono`} value={vmJson} onChange={e => setVmJson(e.target.value)} />
          <button className="btn btn-primary" disabled={busy || !project}>Save template</button>
        </form>
      </section>
      <section className="tahoe-glass-card p-5 space-y-3" aria-label="Instance groups">
        <h2 className="text-lg font-semibold">Elastic instance groups</h2><p className="text-[var(--text-secondary)]">Scale-in stops instances and retains their disks. Pausing leaves current instances unchanged.</p>
        <form className="flex flex-wrap gap-3" onSubmit={e => { e.preventDefault(); void action(() => cloud.createInstanceGroup(project, { name: groupName, template_id: templateId, subnet_id: subnetId, policy: { min: 0, max: 10, desired, target_cpu: null, cooldown_secs: 300 } })) }}>
          <input aria-label="Group name" placeholder="Group name" required className={field} value={groupName} onChange={e => setGroupName(e.target.value)} />
          <select aria-label="Launch template" required className={field} value={templateId} onChange={e => setTemplateId(e.target.value)}><option value="">Choose a template</option>{templates.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}</select>
          <select aria-label="Group subnet" required className={field} value={subnetId} onChange={e => setSubnetId(e.target.value)}><option value="">Choose a ready subnet</option>{subnets.filter(s => s.status === 'ready').map(s => <option key={s.id} value={s.id}>{s.name}</option>)}</select>
          <label>Instances <input aria-label="Desired instances" type="number" min={0} max={10} className={field} value={desired} onChange={e => setDesired(Number(e.target.value))} /></label>
          <button className="btn btn-primary" disabled={busy || !templateId || !subnetId}>Create group</button>
        </form>
        <ul>{groups.map(g => { const policy: cloud.ScalingPolicy = JSON.parse(g.policy_json); return <li className="py-3 flex flex-wrap gap-3" key={g.id}><span>{g.name} · {policy.desired} desired · {g.paused ? 'paused' : 'active'}</span>{g.last_error && <span role="alert">{g.last_error}</span>}<button className="btn btn-secondary" disabled={busy} onClick={() => void action(() => cloud.updateInstanceGroup(g.id, policy, !g.paused))}>{g.paused ? 'Resume' : 'Pause'} {g.name}</button><button className="btn btn-secondary" disabled={busy || policy.desired >= policy.max} onClick={() => void action(() => cloud.updateInstanceGroup(g.id, { ...policy, desired: policy.desired + 1 }, g.paused))}>Add instance</button><button className="btn btn-secondary" disabled={busy || policy.desired <= policy.min} onClick={() => void action(() => cloud.updateInstanceGroup(g.id, { ...policy, desired: policy.desired - 1 }, g.paused))}>Stop one instance</button></li> })}</ul>
      </section>
    </div><FleetCloudFooter />
  </PageLayout>
}
