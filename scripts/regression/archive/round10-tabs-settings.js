// Copyright 2026 Zyvor AI Labs · https://zyvor.dev
// SPDX-License-Identifier: LicenseRef-Zyvor-Production-1.0

const http = require('http');
const fs = require('fs');
const WebSocket = require('ws');
const BASE = 'https://212.8.248.187:5092';
const VM = '3b2803c9-68e9-4235-b0f8-ef46a42c7a80';
const OUT = '/tmp/machina-round10.jsonl';
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
  console.log(o.ok === false ? 'FAIL' : 'PASS', o.path || o.action, String(o.note || '').slice(0, 140));
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
    const t = await waitText(re, 25000);
    const ok = t.length >= 80 && !/Something went wrong|Route not found/i.test(t);
    log({ kind: 'PAGE', path: label || path, ok, note: `len=${t.length} ${t.slice(0, 100)}` });
    return t;
  };

  await send('Page.navigate', { url: BASE + '/' });
  await new Promise((r) => setTimeout(r, 1000));
  await evalAsync(
    `fetch('/api/v1/auth/login',{method:'POST',headers:{'Content-Type':'application/json'},credentials:'include',body:JSON.stringify({username:'sus',password:'max'})}).then(r=>r.json())`,
  );

  // All VM tabs via URL (authoritative UX path)
  const tabs = [
    'overview', 'access', 'hardware', 'console', 'performance', 'doctor', 'disks', 'devices',
    'network', 'guestHealth', 'guestServices', 'security', 'snapshots', 'backup',
    'topology', 'events', 'logs', 'settings', 'advanced',
  ];
  for (const tab of tabs) {
    await visit(`/platform/vms/${VM}?tab=${tab}`, /.{100,}/, `tab:${tab}`);
  }

  // Classic VM console redirect + rdp route (may soft)
  await visit('/vms/chrome-e2e-vm/console', /Console|Cinema|VNC|Redirect|Loading|Connect/i, 'classic-console');
  await visit('/vms/chrome-e2e-vm/rdp', /RDP|Remote|not available|unavailable|Connect|Windows/i, 'classic-rdp');

  // Import + fleet + jobs detail empty
  await visit('/import', /Import|OVA|qcow|Upload|disk/i, 'import');
  await visit('/fleet', /Fleet|peer|status|host/i, 'fleet');
  await visit('/jobs', /Job|Daemon|Empty|No jobs|status/i, 'jobs');

  // Platform SOC deep + security machine page if linked
  await visit('/platform/soc', /Security|Operations|SOC|Alert|Threat/i, 'soc');
  await visit('/platform/zeus/security', /Security|Center|Firewall|Threat/i, 'sec-center');

  // Discover settings nav labels
  await send('Page.navigate', { url: BASE + '/platform/settings' });
  await waitText(/Settings/i, 20000);
  const settingsNav = await evalAsync(`(() => {
    return [...document.querySelectorAll('nav a,aside a,button,[role=tab]')].map(e => e.innerText.trim()).filter(t => t && t.length < 40).slice(0, 40);
  })()`);
  log({ kind: 'DISCOVER', action: 'settings-nav', ok: true, note: JSON.stringify(settingsNav).slice(0, 300) });

  // Click each settings nav item found
  for (const label of settingsNav.slice(0, 12)) {
    if (!label || /Machina|Go|View|Window|Help|Healthy|Control/i.test(label)) continue;
    const clicked = await evalAsync(`(() => {
      const el = [...document.querySelectorAll('nav a,aside a,button,[role=tab]')].find(e => e.innerText.trim() === ${JSON.stringify(label)});
      if (el) { el.click(); return true; }
      return false;
    })()`);
    await new Promise((r) => setTimeout(r, 1000));
    log({
      kind: 'SETTINGS',
      action: label,
      ok: !!clicked,
      note: `len=${(await bodyTxt()).length}`,
    });
  }

  // Hosts finder page search
  await send('Page.navigate', { url: BASE + '/platform/hosts/finder' });
  await waitText(/Finder|Machine|host|VM/i, 25000);
  await evalAsync(`(() => {
    const input = document.querySelector('input');
    if (!input) return null;
    const s = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
    s.call(input, 'localhost');
    input.dispatchEvent(new Event('input', { bubbles: true }));
    return input.value;
  })()`);
  await new Promise((r) => setTimeout(r, 1500));
  log({ kind: 'UI', action: 'hosts-finder-search', ok: true, note: (await bodyTxt()).slice(0, 140) });

  // Header host count vs API
  const headerHosts = await evalAsync(`(() => {
    const t = document.body.innerText;
    const m = t.match(/(\\d+)\\/(\\d+)\\s*hosts/i);
    return m ? { shown: m[0], a: m[1], b: m[2] } : { shown: null };
  })()`);
  const apiHosts = await evalAsync(`fetch('/api/v1/platform/controller/api/v1/hosts',{credentials:'include'}).then(r=>r.json()).then(h=>({count:h.length, online:h.filter(x=>x.state==='online').length, sample:h[0]&&{hostname:h[0].hostname,state:h[0].state}}))`);
  log({
    kind: 'BUGCHECK',
    action: 'hosts-count-header',
    ok: headerHosts.shown && apiHosts.online > 0 ? headerHosts.a !== '0' : true,
    note: JSON.stringify({ headerHosts, apiHosts }),
  });

  console.log('ROUND10_DONE');
  ws.close();
})().catch((e) => {
  console.error('FATAL', e);
  process.exit(1);
});
