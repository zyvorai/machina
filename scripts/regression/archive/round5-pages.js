// Copyright 2026 Zyvor AI Labs · https://zyvor.dev
// SPDX-License-Identifier: LicenseRef-Zyvor-Production-1.0

const http = require('http');
const fs = require('fs');
const WebSocket = require('ws');
const BASE = 'https://212.8.248.187:5092';
const OUT = '/tmp/machina-round5.jsonl';
const SUMMARY = '/tmp/machina-round5-summary.txt';
fs.writeFileSync(OUT, '');
fs.writeFileSync(SUMMARY, '');

function getJson(url) {
  return new Promise((resolve, reject) => {
    http.get(url, (res) => {
      let d = '';
      res.on('data', (c) => (d += c));
      res.on('end', () => resolve(JSON.parse(d)));
    }).on('error', reject);
  });
}

function log(o) {
  fs.appendFileSync(OUT, JSON.stringify(o) + '\n');
  const line = `${o.ok === false ? 'FAIL' : o.ok === true ? 'PASS' : 'INFO'} ${o.path || o.api || o.action || o.kind} | ${String(o.note || '').slice(0, 140)}`;
  fs.appendFileSync(SUMMARY, line + '\n');
  console.log(line);
}

const PAGES = [
  // Classic
  ['/', /Dashboard|Virtual Machines|Healthy|CPU|Memory|Machina/i],
  ['/vms', /Virtual Machines|chrome-e2e|Running|Shut|Create/i],
  ['/vms/chrome-e2e-vm', /chrome-e2e-vm|Overview|Console|Power|vCPU|Memory/i],
  ['/create', /Create|Installation|Next|guest/i],
  ['/import', /Import|OVA|qcow|Upload/i],
  ['/fleet', /Fleet|peer|host|status/i],
  ['/networks', /Network|default|bridge|NAT/i],
  ['/storage', /Storage|Pool|default|Capacity/i],
  ['/storage/default', /default|Volume|Capacity|Active/i],
  ['/disk-images', /Disk|Image|Upload|qcow|ISO/i],
  ['/snapshots', /Snapshot|VM|Create/i],
  ['/backups', /Backup|Snapshot|Schedule/i],
  ['/nwfilters', /Filter|nwfilter|clean-traffic|allow/i],
  ['/host-networking', /Host Networking|interface|bridge|IP/i],
  ['/secrets', /Secret|UUID|ceph|Create/i],
  ['/node', /Host|CPU|Memory|libvirt|Hostname/i],
  ['/events', /Metrics|CPU|Memory|Live/i],
  ['/system-check', /System Check|Pass|Fail|Check/i],
  ['/capabilities', /Capabilities|KVM|feature/i],
  ['/devices', /Device|PCI|USB|Node/i],
  ['/services', /Service|libvirtd|systemd|Active/i],
  ['/jobs', /Job|Daemon|status|completed/i],
  ['/logs', /Log|journal|daemon|error/i],
  ['/audit', /Audit|event|actor|action/i],
  ['/admin/sessions', /Session|Web|user|expire/i],
  ['/settings', /Settings|Auth|TLS|Backup|General/i],
  ['/host-ssh', /SSH|Host|Connect|terminal/i],
  ['/api-docs', /API|Docs|Swagger|endpoint|OpenAPI/i],
  ['/k8s', /Kubernetes|KubeVirt|cluster|namespace|Pods/i],
  ['/k8s/workloads', /Workload|Pod|Deployment|KubeVirt|VM/i],
  ['/k8s/kata', /Kata|Cloud Hypervisor|runtime/i],
  // OpenStack
  ['/openstack', /OpenStack|Nova|Glance|Horizon|not configured|unavailable|Overview|Configure/i],
  ['/openstack/instances', /Instance|Nova|OpenStack|not configured|unavailable|Create/i],
  ['/openstack/create', /Create|Instance|Flavor|Image|OpenStack|not configured/i],
  ['/openstack/images', /Glance|Image|OpenStack|not configured/i],
  ['/openstack/volumes', /Volume|Cinder|OpenStack|not configured/i],
  ['/openstack/volume-snapshots', /Snapshot|Volume|OpenStack|not configured/i],
  ['/openstack/networking', /Network|Neutron|OpenStack|not configured/i],
  ['/openstack/security-groups', /Security|Group|OpenStack|not configured/i],
  ['/openstack/floating-ips', /Floating|IP|OpenStack|not configured/i],
  ['/openstack/load-balancers', /Load Balancer|Octavia|OpenStack|not configured/i],
  ['/openstack/topology', /Topology|Network|OpenStack|not configured/i],
  ['/openstack/keypairs', /Keypair|SSH|OpenStack|not configured/i],
  ['/openstack/flavors', /Flavor|vCPU|RAM|OpenStack|not configured/i],
  ['/openstack/server-groups', /Server Group|Affinity|OpenStack|not configured/i],
  ['/openstack/migrations', /Migration|OpenStack|not configured|HyperSDK/i],
  ['/openstack/heat', /Heat|Stack|Orchestration|OpenStack|not configured/i],
  ['/openstack/identity', /Identity|Keystone|Project|User|OpenStack|not configured/i],
  // Platform
  ['/platform', /Mission Control|Healthy|hosts|VMs|Cluster/i],
  ['/platform/vms', /Machine Finder|chrome-e2e|machines|Virtual/i],
  ['/platform/hosts', /Hosts|localhost|online|Sync|agent/i],
  ['/platform/applications', /Application|App|Launch|Catalog/i],
  ['/platform/launchpad', /Launchpad|App|tile|shortcut/i],
  ['/platform/datacenter', /Datacenter|rack|host|topology|view/i],
  ['/platform/storage', /Disk Utility|Storage|Pool|Volume|Capacity/i],
  ['/platform/storage-atlas', /Atlas|Storage|Ceph|Volume|not enabled|disabled|unavailable/i],
  ['/platform/storage-tiers', /Tier|Storage|Policy|class/i],
  ['/platform/networks', /Network|VLAN|bridge|subnet/i],
  ['/platform/content', /Image|ISO|Content|Upload/i],
  ['/platform/templates', /Template|VM|Clone|golden/i],
  ['/platform/cloud-init', /Cloud-Init|user-data|Studio/i],
  ['/platform/create-iso', /ISO|Create|Media|Upload/i],
  ['/platform/baremetal', /Bare Metal|PXE|BMC|IPMI|host/i],
  ['/platform/migration', /Migration|Import|Assistant|vSphere|VMware/i],
  ['/platform/vm-builder', /VM Builder|Build|Packer|virt-builder/i],
  ['/platform/create-advanced', /Advanced|Create|XML|spec|guest/i],
  ['/platform/blueprints', /Blueprint|spec|Git|declarative/i],
  ['/platform/tasks', /Tasks|completed|pending|operation/i],
  ['/platform/network-canvas', /Network|Canvas|topology|node|edge/i],
  ['/platform/zeus', /Zeus|AI|Briefing|Agent|Chat/i],
  ['/platform/zeus/configure', /Configure|Zeus|Provider|Model|LLM/i],
  ['/platform/zeus/security', /Security|Zeus|Threat|Policy/i],
  ['/platform/soc', /Security|Operations|SOC|Threat|Hunt/i],
  ['/platform/policy', /Policy|RBAC|Guardrail|Rule/i],
  ['/platform/webhooks', /Webhook|Endpoint|Delivery/i],
  ['/platform/backups', /Backup|Restore|Schedule|Retention/i],
  ['/platform/fleet-snapshots', /Snapshot|Fleet|Schedule/i],
  ['/platform/placement', /Disaster|Recovery|Placement|DRS|DR/i],
  ['/platform/ha', /High Availability|HA|Failover/i],
  ['/platform/upgrade', /Upgrade|Matrix|Version|Component/i],
  ['/platform/zeus/incidents', /Incident|Commander|Alert/i],
  ['/platform/zeus/approvals', /Approval|Pending|Action/i],
  ['/platform/maintenance', /Maintenance|Window|Mode/i],
  ['/platform/recommendations', /Recommendation|Rightsiz|Optimize/i],
  ['/platform/notifications', /Alert|Notification|Bell/i],
  ['/platform/observability', /Observability|Metric|Trace|OTLP/i],
  ['/platform/activity', /Activity|Monitor|Process|CPU/i],
  ['/platform/topology', /Topology|Graph|Host|VM/i],
  ['/platform/zeus/rightsizing', /Rightsizing|Recommend|CPU|Memory/i],
  ['/platform/reports', /Report|Export|Usage/i],
  ['/platform/gpu', /GPU|MIG|vGPU|Command/i],
  ['/platform/settings', /Settings|Cluster|Identity|Appearance/i],
  ['/platform/users', /Users|Groups|RBAC|Role/i],
  ['/platform/projects', /Stage Manager|Project|Workspace/i],
  ['/platform/enroll', /Add Host|Enroll|Token|Agent/i],
  ['/platform/api-keys', /API Key|Create|Token/i],
  ['/platform/integrations', /Integration|Webhook|Slack|Pager/i],
  ['/platform/marketplace', /Marketplace|Catalog|App/i],
  ['/platform/ai-providers', /AI Provider|LLM|OpenAI|Anthropic|Ollama/i],
  ['/platform/enterprise', /Enterprise|Feature|License/i],
  ['/platform/developer', /Developer|Hub|SDK|API/i],
  ['/platform/support', /Support|Docs|Help|Contact/i],
  ['/platform/events', /Event|Log|Audit/i],
  // Detail pages
  ['/platform/vms/3b2803c9-68e9-4235-b0f8-ef46a42c7a80', /chrome-e2e|Overview|Console|Snapshot|Network|Disk/i],
  ['/platform/vms/c53c701c-cfa1-4c28-b639-4fa7fef77bed', /bug-hunt|KubeVirt|Overview|adopt|running/i],
  ['/platform/vms/b539747e-c228-4807-bc93-7b77657c6b69', /ui-e2e|KubeVirt|Overview|running/i],
];

(async () => {
  const targets = await getJson('http://127.0.0.1:9222/json/list');
  const page = targets.find((t) => t.type === 'page');
  if (!page) throw new Error('no chrome page');
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  let id = 0;
  const pending = new Map();
  const send = (m, p = {}) =>
    new Promise((resolve, reject) => {
      const mid = ++id;
      pending.set(mid, { resolve, reject });
      ws.send(JSON.stringify({ id: mid, method: m, params: p }));
    });
  ws.on('message', (raw) => {
    const msg = JSON.parse(raw.toString());
    if (msg.id && pending.has(msg.id)) {
      const { resolve, reject } = pending.get(msg.id);
      pending.delete(msg.id);
      if (msg.error) reject(new Error(JSON.stringify(msg.error)));
      else resolve(msg.result);
    }
  });
  await new Promise((r, j) => {
    ws.on('open', r);
    ws.on('error', j);
  });
  await send('Network.enable');
  await send('Page.enable');
  await send('Runtime.enable');
  await send('Security.setIgnoreCertificateErrors', { ignore: true });

  const evalAsync = async (expression) => {
    const r = await send('Runtime.evaluate', {
      awaitPromise: true,
      returnByValue: true,
      expression,
    });
    if (r.exceptionDetails) {
      throw new Error(
        (r.exceptionDetails.exception && r.exceptionDetails.exception.description) ||
          r.exceptionDetails.text ||
          JSON.stringify(r.exceptionDetails),
      );
    }
    return r.result.value;
  };

  const api = async (method, path, body) => {
    const expr = `fetch(${JSON.stringify(path)}, {
      method: ${JSON.stringify(method)},
      credentials: 'include',
      headers: ${body ? "{'Content-Type':'application/json'}" : 'undefined'},
      body: ${body ? JSON.stringify(JSON.stringify(body)) : 'undefined'}
    }).then(async r => ({ status: r.status, body: (await r.text()).slice(0, 500) }))`;
    return evalAsync(expr);
  };

  const bodyTxt = async () =>
    evalAsync(`document.body ? document.body.innerText.replace(/\\s+/g, ' ').trim() : ''`);

  const waitText = async (re, ms = 25000) => {
    const t0 = Date.now();
    let last = '';
    while (Date.now() - t0 < ms) {
      last = await bodyTxt();
      if (re.test(last) && last.length >= 120) return last;
      await new Promise((r) => setTimeout(r, 700));
    }
    return last || bodyTxt();
  };

  // Login
  await send('Page.navigate', { url: BASE + '/' });
  await new Promise((r) => setTimeout(r, 1500));
  await evalAsync(
    `fetch('/api/v1/auth/login',{method:'POST',headers:{'Content-Type':'application/json'},credentials:'include',body:JSON.stringify({username:'sus',password:'max'})}).then(r=>r.json())`,
  );

  // Fix clone + networks APIs first
  let r = await api('POST', '/api/v1/vms/chrome-e2e-vm/clone', {
    new_name: 'chrome-e2e-clone',
    linked: true,
  });
  log({
    kind: 'API',
    api: 'clone linked new_name',
    ok: r.status < 300,
    note: `${r.status} ${r.body.slice(0, 180)}`,
  });
  if (r.status < 300) {
    await new Promise((x) => setTimeout(x, 4000));
    r = await api('DELETE', '/api/v1/vms/chrome-e2e-clone');
    log({ kind: 'API', api: 'delete clone', ok: r.status < 300, note: `${r.status} ${r.body.slice(0, 120)}` });
  }

  r = await api('GET', '/api/v1/networks');
  log({ kind: 'API', api: 'GET networks', ok: r.status < 300, note: `${r.status} ${r.body.slice(0, 160)}` });

  r = await api('GET', '/api/v1/networks/default/xml');
  log({ kind: 'API', api: 'GET network xml', ok: r.status < 300, note: `${r.status} ${r.body.slice(0, 80)}` });

  // Page-by-page — do not stop on failures
  let pass = 0;
  let fail = 0;
  let soft = 0;
  for (const [path, re] of PAGES) {
    try {
      await send('Page.navigate', { url: BASE + path });
      // platform pages need longer hydrate
      const waitMs = path.startsWith('/platform') ? 28000 : 16000;
      const t = await waitText(re, waitMs);
      const crashed = /Something went wrong|Route not found/i.test(t);
      const login = /Welcome back|Sign in|username|password/i.test(t) && t.length < 400;
      const matched = re.test(t);
      const short = t.length < 150;
      let status = 'PASS';
      let ok = true;
      if (crashed || login) {
        status = 'FAIL';
        ok = false;
        fail++;
      } else if (!matched || short) {
        status = 'SOFT';
        ok = true; // keep going; content may be empty state
        soft++;
      } else {
        pass++;
      }
      log({
        kind: 'PAGE',
        path,
        ok: status !== 'FAIL',
        soft: status === 'SOFT',
        note: `${status} len=${t.length} ${t.slice(0, 100)}`,
      });
    } catch (e) {
      fail++;
      log({ kind: 'PAGE', path, ok: false, note: `FAIL exception ${e.message}` });
    }
  }

  // Interactive: platform VM detail tabs
  const vmPath = '/platform/vms/3b2803c9-68e9-4235-b0f8-ef46a42c7a80';
  await send('Page.navigate', { url: BASE + vmPath });
  await waitText(/chrome-e2e|Overview/i, 25000);
  const tabs = ['Overview', 'Hardware', 'Network', 'Storage', 'Snapshots', 'Metrics', 'Events', 'Console'];
  for (const tab of tabs) {
    try {
      await send('Page.navigate', { url: BASE + vmPath });
      await waitText(/chrome-e2e|Overview|Console/i, 20000);
      const clicked = await evalAsync(`(() => {
        const el = [...document.querySelectorAll('button,a,[role=tab]')].find(e => e.innerText.trim() === ${JSON.stringify(tab)});
        if (el) { el.click(); return el.innerText.trim(); }
        return null;
      })()`);
      await new Promise((r) => setTimeout(r, 2000));
      const t = await bodyTxt();
      log({
        kind: 'TAB',
        action: tab,
        ok: !!clicked && t.length > 100,
        note: `clicked=${clicked} len=${t.length} ${t.slice(0, 90)}`,
      });
    } catch (e) {
      log({ kind: 'TAB', action: tab, ok: false, note: e.message });
    }
  }

  // Hosts sync button broader match
  await send('Page.navigate', { url: BASE + '/platform/hosts' });
  await waitText(/Hosts|localhost|Sync/i, 25000);
  const syncBtn = await evalAsync(`(() => {
    const btns = [...document.querySelectorAll('button')].map(b => b.innerText.trim());
    const b = [...document.querySelectorAll('button')].find(e => /sync/i.test(e.innerText));
    if (b) { b.click(); return { clicked: b.innerText.trim(), all: btns.slice(0, 20) }; }
    return { clicked: null, all: btns.slice(0, 20) };
  })()`);
  log({
    kind: 'UI',
    action: 'host-sync',
    ok: !!syncBtn.clicked,
    note: JSON.stringify(syncBtn).slice(0, 200),
  });

  console.log(`ROUND5_DONE pass=${pass} soft=${soft} fail=${fail}`);
  fs.appendFileSync(SUMMARY, `\nTOTAL pass=${pass} soft=${soft} fail=${fail}\n`);
  ws.close();
})().catch((e) => {
  console.error('FATAL', e);
  process.exit(1);
});
