// Copyright 2026 Zyvor AI Labs · https://zyvor.dev
// SPDX-License-Identifier: LicenseRef-Zyvor-Production-1.0

const http = require('http');
const fs = require('fs');
const WebSocket = require('ws');
const BASE = 'https://212.8.248.187:5092';
const OUT = '/tmp/machina-round15.jsonl';
fs.writeFileSync(OUT, '');

// Exhaustive re-sweep of every route from App.tsx (relative platform paths expanded)
const PAGES = [
  '/', '/vms', '/create', '/import', '/fleet', '/networks', '/storage', '/disk-images', '/snapshots', '/backups',
  '/nwfilters', '/host-networking', '/secrets', '/node', '/events', '/system-check', '/capabilities', '/devices',
  '/services', '/jobs', '/logs', '/audit', '/admin/sessions', '/settings', '/host-ssh', '/api-docs', '/ssh',
  '/mission-control', '/k8s', '/k8s/workloads', '/k8s/kata',
  '/openstack', '/openstack/instances', '/openstack/create', '/openstack/images', '/openstack/volumes',
  '/openstack/volume-snapshots', '/openstack/networking', '/openstack/security-groups', '/openstack/floating-ips',
  '/openstack/load-balancers', '/openstack/topology', '/openstack/keypairs', '/openstack/flavors',
  '/openstack/server-groups', '/openstack/migrations', '/openstack/heat', '/openstack/identity',
  '/platform', '/platform/vms', '/platform/hosts', '/platform/hosts/finder',
  '/platform/applications', '/platform/launchpad', '/platform/datacenter',
  '/platform/storage', '/platform/storage-atlas', '/platform/storage-tiers', '/platform/networks',
  '/platform/content', '/platform/templates', '/platform/cloud-init', '/platform/create-iso', '/platform/baremetal',
  '/platform/migration', '/platform/vm-builder', '/platform/create-advanced', '/platform/blueprints',
  '/platform/tasks', '/platform/network-canvas', '/platform/alert-rules', '/platform/scheduled-jobs',
  '/platform/zeus', '/platform/zeus/configure', '/platform/zeus/security', '/platform/zeus/security/hunt',
  '/platform/zeus/security/enforcement', '/platform/zeus/security/firewall', '/platform/zeus/security/ports',
  '/platform/zeus/security/services', '/platform/zeus/security/activity', '/platform/zeus/security/compliance',
  '/platform/zeus/security/k8s', '/platform/zeus/security/cloud', '/platform/zeus/security/connectivity',
  '/platform/zeus/security/policies', '/platform/soc', '/platform/policy', '/platform/webhooks',
  '/platform/backups', '/platform/fleet-snapshots', '/platform/placement', '/platform/ha', '/platform/upgrade',
  '/platform/zeus/incidents', '/platform/zeus/approvals', '/platform/maintenance', '/platform/recommendations',
  '/platform/notifications', '/platform/observability', '/platform/activity', '/platform/topology',
  '/platform/zeus/rightsizing', '/platform/reports', '/platform/gpu',
  '/platform/settings', '/platform/users', '/platform/projects', '/platform/enroll', '/platform/api-keys',
  '/platform/integrations', '/platform/marketplace', '/platform/ai-providers', '/platform/enterprise',
  '/platform/developer', '/platform/support', '/platform/events',
  '/platform/infrastructure', '/platform/workloads', '/platform/administration', '/platform/resources', '/platform/operations',
  '/platform/mission-control/live',
  '/vms/chrome-e2e-vm', '/vms/chrome-e2e-vm/consolehub',
  '/platform/vms/3b2803c9-68e9-4235-b0f8-ef46a42c7a80',
  '/platform/vms/c53c701c-cfa1-4c28-b639-4fa7fef77bed',
  '/platform/vms/b539747e-c228-4807-bc93-7b77657c6b69',
  '/platform/hosts/98e60da1-5656-404c-87e9-207ae19ebd86',
];

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
  console.log(o.ok === false ? 'FAIL' : o.soft ? 'SOFT' : 'PASS', o.path, String(o.note || '').slice(0, 100));
}

(async () => {
  const targets = await getJson('http://127.0.0.1:9222/json/list');
  const page = targets.find((t) => t.type === 'page');
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
  await send('Page.enable');
  await send('Runtime.enable');
  await send('Security.setIgnoreCertificateErrors', { ignore: true });
  const evalAsync = async (expression) => {
    const r = await send('Runtime.evaluate', {
      awaitPromise: true,
      returnByValue: true,
      expression,
    });
    if (r.exceptionDetails) throw new Error(JSON.stringify(r.exceptionDetails));
    return r.result.value;
  };
  const bodyTxt = async () =>
    evalAsync(`document.body ? document.body.innerText.replace(/\\s+/g, ' ').trim() : ''`);

  await send('Page.navigate', { url: BASE + '/' });
  await new Promise((r) => setTimeout(r, 1000));
  await evalAsync(
    `fetch('/api/v1/auth/login',{method:'POST',headers:{'Content-Type':'application/json'},credentials:'include',body:JSON.stringify({username:'sus',password:'max'})}).then(r=>r.json())`,
  );

  let pass = 0,
    soft = 0,
    fail = 0;
  for (const path of PAGES) {
    try {
      await send('Page.navigate', { url: BASE + path });
      const waitMs = path.startsWith('/platform') ? 12000 : 8000;
      const t0 = Date.now();
      let t = '';
      while (Date.now() - t0 < waitMs) {
        t = await bodyTxt();
        if (t.length >= 150 && !/Loading…|Loading\.\.\./i.test(t.slice(0, 40))) break;
        await new Promise((r) => setTimeout(r, 500));
      }
      const crashed = /Something went wrong|Route not found|page not found/i.test(t);
      const loginWall = /Welcome back/i.test(t) && t.length < 500;
      let status = 'PASS';
      let ok = true;
      let isSoft = false;
      if (crashed || loginWall) {
        status = 'FAIL';
        ok = false;
        fail++;
      } else if (t.length < 120) {
        status = 'SOFT';
        isSoft = true;
        soft++;
      } else {
        pass++;
      }
      log({ kind: 'PAGE', path, ok, soft: isSoft, note: `${status} len=${t.length}` });
    } catch (e) {
      fail++;
      log({ kind: 'PAGE', path, ok: false, note: `FAIL ${e.message}` });
    }
  }
  console.log(`ROUND15_DONE pass=${pass} soft=${soft} fail=${fail} total=${PAGES.length}`);
  fs.writeFileSync(
    '/tmp/machina-round15-summary.txt',
    `pass=${pass} soft=${soft} fail=${fail} total=${PAGES.length}\n`,
  );
  ws.close();
})().catch((e) => {
  console.error('FATAL', e);
  process.exit(1);
});
