// Copyright 2026 Zyvor AI Labs · https://zyvor.dev
// SPDX-License-Identifier: LicenseRef-Zyvor-Production-1.0

const http = require('http');
const fs = require('fs');
const WebSocket = require('ws');
const BASE = 'https://212.8.248.187:5092';
const VM = '3b2803c9-68e9-4235-b0f8-ef46a42c7a80';
const OUT = '/tmp/machina-round6.jsonl';
fs.writeFileSync(OUT, '');

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
  console.log(
    o.ok === false ? 'FAIL' : 'PASS',
    o.path || o.action || o.api || '',
    String(o.note || '').slice(0, 160),
  );
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

  const bodyTxt = async () =>
    evalAsync(`document.body ? document.body.innerText.replace(/\\s+/g, ' ').trim() : ''`);

  const waitText = async (re, ms = 25000) => {
    const t0 = Date.now();
    let last = '';
    while (Date.now() - t0 < ms) {
      last = await bodyTxt();
      if (re.test(last) && last.length >= 80) return last;
      await new Promise((r) => setTimeout(r, 600));
    }
    return last || bodyTxt();
  };

  const visit = async (path, re, label) => {
    await send('Page.navigate', { url: BASE + path });
    const t = await waitText(re, 28000);
    const ok =
      t.length >= 80 &&
      !/Route not found|Something went wrong/i.test(t) &&
      !( /Welcome back/i.test(t) && t.length < 500);
    log({ kind: 'PAGE', path: label || path, ok, note: `len=${t.length} ${t.slice(0, 110)}` });
    return t;
  };

  await send('Page.navigate', { url: BASE + '/' });
  await new Promise((r) => setTimeout(r, 1500));
  await evalAsync(
    `fetch('/api/v1/auth/login',{method:'POST',headers:{'Content-Type':'application/json'},credentials:'include',body:JSON.stringify({username:'sus',password:'max'})}).then(r=>r.json())`,
  );

  // Retry soft home
  await visit('/', /Dashboard|Virtual|CPU|Memory|Machina|Running/i, '/ (retry)');

  // Platform VM tabs via query param (authoritative)
  const tabs = [
    ['overview', /chrome-e2e|Overview|Power|vCPU|Memory|Connect/i],
    ['access', /Access|SSH|Console|VNC|SPICE|Cinema|Connect/i],
    ['hardware', /Hardware|vCPU|Memory|CPU|Disk|NIC|Edit/i],
    ['console', /Console|Cinema|VNC|noVNC|SPICE|Connect|Loading/i],
    ['performance', /Performance|CPU|Memory|Metric|Chart|IOPS/i],
    ['doctor', /Doctor|Health|Diagnos|Check|Troubleshoot/i],
    ['disks', /Disk|Volume|qcow|Capacity|Attach/i],
    ['devices', /Device|USB|PCI|CD|ISO/i],
    ['network', /Network|NIC|MAC|IP|bridge|default/i],
    ['guestHealth', /Guest|Health|agent|qemu/i],
    ['guestServices', /Guest|Service|systemd|agent/i],
    ['security', /Security|Port|Firewall|guest/i],
    ['snapshots', /Snapshot|Create|Revert|disk|unsupported|backing/i],
    ['backup', /Backup|Restore|Schedule|Snapshot/i],
    ['topology', /Topology|Graph|Host|NUMA/i],
    ['events', /Event|Audit|log|activity/i],
    ['logs', /Log|journal|qemu|domain/i],
    ['settings', /Settings|Autostart|Schedule|XML/i],
    ['advanced', /Advanced|XML|Domain|Metadata/i],
  ];
  for (const [tab, re] of tabs) {
    const path = `/platform/vms/${VM}?tab=${tab}`;
    await visit(path, re, `vm-tab:${tab}`);
  }

  // Discover actual tab button labels
  await send('Page.navigate', { url: BASE + `/platform/vms/${VM}` });
  await waitText(/chrome-e2e|Virtual/i, 25000);
  const tabLabels = await evalAsync(`(() => {
    const els = [...document.querySelectorAll('button,[role=tab],a')];
    return els.map(e => e.innerText.trim()).filter(t => t && t.length < 40).slice(0, 60);
  })()`);
  log({ kind: 'DISCOVER', action: 'vm-tab-labels', ok: true, note: JSON.stringify(tabLabels).slice(0, 300) });

  // Cinema / console hub
  await visit(`/platform/vms/${VM}?tab=access`, /Access|Console|Cinema|VNC|Connect/i, 'vm-access');
  const cinema = await evalAsync(`(() => {
    const b = [...document.querySelectorAll('button,a')].find(e => /cinema|console|vnc|connect|open/i.test(e.innerText));
    if (b) { b.click(); return b.innerText.trim(); }
    return null;
  })()`);
  await new Promise((r) => setTimeout(r, 4000));
  log({
    kind: 'UI',
    action: 'cinema-connect',
    ok: !!cinema,
    note: `clicked=${cinema} url=${await evalAsync('location.pathname+location.search')} text=${(await bodyTxt()).slice(0, 100)}`,
  });

  // Classic VM detail + power buttons presence
  await visit('/vms/chrome-e2e-vm', /chrome-e2e|Power|Start|Stop|Console|vCPU/i, 'classic-vm-detail');
  const powerBtns = await evalAsync(`(() => {
    return [...document.querySelectorAll('button')].map(b => b.innerText.trim()).filter(Boolean).slice(0, 40);
  })()`);
  log({ kind: 'DISCOVER', action: 'classic-power-btns', ok: true, note: JSON.stringify(powerBtns).slice(0, 250) });

  // Classic consolehub
  await visit('/vms/chrome-e2e-vm/consolehub', /Console|Cinema|VNC|noVNC|SPICE|Connect|Loading/i, 'classic-consolehub');

  // Classic networks / storage interactions
  await visit('/networks', /default|Network|bridge|virbr/i, 'classic-networks');
  await visit('/storage', /default|Pool|Capacity|Active/i, 'classic-storage');
  await visit('/nwfilters', /filter|clean|allow|no-arp/i, 'classic-nwfilters');

  // Platform hosts — find sync controls
  await visit('/platform/hosts', /Hosts|localhost|online|agent/i, 'platform-hosts');
  const hostUi = await evalAsync(`(() => {
    const texts = [...document.querySelectorAll('button,a,[role=button]')].map(e => e.innerText.trim()).filter(Boolean);
    const sync = [...document.querySelectorAll('button,a')].find(e => /sync|refresh|inventory/i.test(e.innerText));
    if (sync) sync.click();
    return { sync: sync && sync.innerText.trim(), texts: texts.slice(0, 30) };
  })()`);
  log({ kind: 'UI', action: 'hosts-sync-or-refresh', ok: true, note: JSON.stringify(hostUi).slice(0, 280) });
  await new Promise((r) => setTimeout(r, 3000));

  // Platform settings subsections via hash/query if any
  await visit('/platform/settings', /Settings|Cluster|Identity|Appearance/i, 'settings');
  for (const label of ['Identity', 'Appearance', 'General', 'Cluster', 'Security', 'Integrations']) {
    const clicked = await evalAsync(`(() => {
      const b = [...document.querySelectorAll('button,a,[role=tab]')].find(e => e.innerText.trim() === ${JSON.stringify(label)});
      if (b) { b.click(); return true; }
      return false;
    })()`);
    await new Promise((r) => setTimeout(r, 1200));
    const t = await bodyTxt();
    log({
      kind: 'SETTINGS',
      action: label,
      ok: clicked && t.length > 200,
      note: `clicked=${clicked} len=${t.length} ${t.slice(0, 90)}`,
    });
  }

  // Zeus chat input presence
  await visit('/platform/zeus', /Zeus|AI|Briefing|Agent|Chat|Prompt/i, 'zeus');
  const zeusUi = await evalAsync(`(() => {
    const ta = document.querySelector('textarea,input[type=text]');
    const send = [...document.querySelectorAll('button')].find(b => /send|ask|run|submit/i.test(b.innerText));
    return { hasInput: !!ta, send: send && send.innerText.trim(), placeholders: [...document.querySelectorAll('[placeholder]')].map(e=>e.getAttribute('placeholder')).slice(0,5) };
  })()`);
  log({ kind: 'UI', action: 'zeus-input', ok: !!zeusUi.hasInput, note: JSON.stringify(zeusUi) });

  // KubeVirt adopted VM detail tabs
  for (const [id2, name] of [
    ['c53c701c-cfa1-4c28-b639-4fa7fef77bed', 'bug-hunt'],
    ['b539747e-c228-4807-bc93-7b77657c6b69', 'ui-e2e'],
  ]) {
    await visit(`/platform/vms/${id2}`, new RegExp(name + '|KubeVirt|Virtual|running|stopped', 'i'), `kv:${name}`);
    await visit(`/platform/vms/${id2}?tab=hardware`, /Hardware|CPU|Memory|vCPU/i, `kv:${name}:hardware`);
    await visit(`/platform/vms/${id2}?tab=network`, /Network|NIC|MAC|IP/i, `kv:${name}:network`);
  }

  // Create advanced / wizard pages
  await visit('/platform/create-advanced', /Advanced|Create|XML|spec|guest|Name/i, 'create-advanced');
  await visit('/platform/vm-builder', /Builder|Build|Packer|virt-builder|Image/i, 'vm-builder');
  await visit('/platform/cloud-init', /Cloud-Init|user-data|hostname|ssh/i, 'cloud-init');

  // OpenStack configure hint pages (empty state is OK)
  await visit('/openstack', /OpenStack|Configure|not configured|unavailable|Nova|Horizon/i, 'os-overview-deep');
  await visit('/settings?openstack=1', /OpenStack|Settings|Cloud|Credential/i, 'os-settings');

  console.log('ROUND6_DONE');
  ws.close();
})().catch((e) => {
  console.error('FATAL', e);
  process.exit(1);
});
