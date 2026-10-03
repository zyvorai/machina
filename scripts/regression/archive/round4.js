// Copyright 2026 Zyvor AI Labs · https://zyvor.dev
// SPDX-License-Identifier: LicenseRef-Zyvor-Production-1.0

const http = require('http');
const fs = require('fs');
const WebSocket = require('ws');
const BASE = 'https://212.8.248.187:5092';
const OUT = '/tmp/machina-round4.jsonl';
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
    o.kind || 'STEP',
    o.path || o.api || o.action || '',
    o.ok === undefined ? '' : o.ok ? 'OK' : 'BAD',
    String(o.note || '').slice(0, 170),
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

  const api = async (method, path, body) => {
    const expr = `fetch(${JSON.stringify(path)}, {
      method: ${JSON.stringify(method)},
      credentials: 'include',
      headers: ${body ? "{'Content-Type':'application/json'}" : 'undefined'},
      body: ${body ? JSON.stringify(JSON.stringify(body)) : 'undefined'}
    }).then(async r => ({ status: r.status, body: (await r.text()).slice(0, 400) }))`;
    return evalAsync(expr);
  };

  const bodyTxt = async () =>
    evalAsync(`document.body ? document.body.innerText.replace(/\\s+/g, ' ').trim() : ''`);

  const waitText = async (re, ms = 20000) => {
    const t0 = Date.now();
    while (Date.now() - t0 < ms) {
      const t = await bodyTxt();
      if (re.test(t)) return t;
      await new Promise((r) => setTimeout(r, 800));
    }
    return bodyTxt();
  };

  const visit = async (path, re = /.{150,}/) => {
    await send('Page.navigate', { url: BASE + path });
    const t = await waitText(re, 18000);
    const ok =
      t.length >= 150 &&
      !/Route not found|Welcome back|Something went wrong/i.test(t);
    log({ kind: 'PAGE', path, ok, note: `len=${t.length} ` + t.slice(0, 110) });
    return t;
  };

  await send('Page.navigate', { url: BASE + '/' });
  await new Promise((r) => setTimeout(r, 2000));
  await evalAsync(
    `fetch('/api/v1/auth/login',{method:'POST',headers:{'Content-Type':'application/json'},credentials:'include',body:JSON.stringify({username:'sus',password:'max'})}).then(r=>r.json())`,
  );

  let r = await api('POST', '/api/v1/storage/pools/default/volumes', {
    name: 'page-test-vol',
    capacity_gb: 1,
    format: 'qcow2',
  });
  log({ kind: 'API', api: 'POST volume', ok: r.status < 300, note: `${r.status} ${r.body.slice(0, 120)}` });

  r = await api('GET', '/api/v1/storage/pools/default/volumes');
  log({ kind: 'API', api: 'GET volumes', ok: r.status < 300, note: `${r.status} ${r.body.slice(0, 160)}` });

  r = await api('DELETE', '/api/v1/storage/pools/default/volumes/page-test-vol');
  log({ kind: 'API', api: 'DELETE volume', ok: r.status < 300, note: `${r.status} ${r.body.slice(0, 120)}` });

  r = await api('POST', '/api/v1/vms/chrome-e2e-vm/autostart/true');
  log({ kind: 'API', api: 'autostart on', ok: r.status < 300, note: `${r.status} ${r.body}` });

  r = await api('GET', '/api/v1/vms/chrome-e2e-vm');
  log({
    kind: 'API',
    api: 'vm after autostart',
    ok: r.status === 200 && /"autostart":true/.test(r.body),
    note: r.body.slice(0, 160),
  });

  r = await api('POST', '/api/v1/vms/chrome-e2e-vm/autostart/false');
  log({ kind: 'API', api: 'autostart off', ok: r.status < 300, note: `${r.status} ${r.body}` });

  r = await api('POST', '/api/v1/vms/chrome-e2e-vm/clone', {
    name: 'chrome-e2e-clone',
    linked: true,
  });
  log({ kind: 'API', api: 'clone linked', ok: r.status < 300, note: `${r.status} ${r.body.slice(0, 180)}` });
  if (r.status < 300) {
    await new Promise((x) => setTimeout(x, 3000));
    r = await api('DELETE', '/api/v1/vms/chrome-e2e-clone');
    log({ kind: 'API', api: 'delete clone', ok: r.status < 300, note: `${r.status} ${r.body.slice(0, 120)}` });
  }

  r = await api('GET', '/api/v1/networks/default');
  log({ kind: 'API', api: 'network default', ok: r.status < 300, note: `${r.status} ${r.body.slice(0, 120)}` });

  r = await api('GET', '/api/v1/networks/default/xml');
  log({ kind: 'API', api: 'network xml', ok: r.status < 300, note: `${r.status} ${r.body.slice(0, 100)}` });

  r = await api(
    'POST',
    '/api/v1/platform/controller/api/v1/vms/b539747e-c228-4807-bc93-7b77657c6b69/adopt',
  );
  log({ kind: 'API', api: 'adopt ui-e2e', ok: r.status < 300, note: `${r.status} ${r.body.slice(0, 160)}` });

  r = await api(
    'POST',
    '/api/v1/platform/controller/api/v1/hosts/98e60da1-5656-404c-87e9-207ae19ebd86/sync',
  );
  log({ kind: 'API', api: 'host sync', ok: r.status < 300, note: `${r.status} ${r.body.slice(0, 160)}` });

  await visit('/storage/default', /default|Volume|Capacity|pool/i);
  await visit('/disk-images', /Disk|Image|qcow|ISO|Upload/i);
  await visit('/create', /Create new guest|Installation source|Next/i);

  await evalAsync(`(() => {
    const set = (el, v) => {
      const s = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
      s.call(el, v);
      el.dispatchEvent(new Event('input', { bubbles: true }));
    };
    const n = document.getElementById('vm-name');
    const c = document.getElementById('vcpus');
    const m = document.getElementById('mem');
    if (n) set(n, 'ui-wizard-probe');
    if (c) set(c, '1');
    if (m) set(m, '1024');
    const next = [...document.querySelectorAll('button')].find((b) => b.innerText.trim() === 'Next');
    if (next && !next.disabled) next.click();
    return { name: n && n.value, next: !!next };
  })()`);
  await new Promise((r) => setTimeout(r, 1500));
  log({ kind: 'WIZARD', action: 'next', ok: true, note: (await bodyTxt()).slice(0, 160) });

  await visit('/platform/settings', /Settings|Identity|Appearance|General/i);
  const label = await evalAsync(`(() => {
    const b = [...document.querySelectorAll('button,a')].find((e) => /Identity|Appearance|General|Cluster/i.test(e.innerText));
    if (b) b.click();
    return b && b.innerText.trim();
  })()`);
  await new Promise((r) => setTimeout(r, 1500));
  log({ kind: 'SETTINGS_SUB', action: label || 'none', ok: !!label, note: (await bodyTxt()).slice(0, 140) });

  await visit('/platform/tasks', /Tasks|completed|host.inventory|orchestration/i);
  await visit('/platform/events', /Event|audit|log/i);
  await visit('/platform/hosts', /Hosts|localhost|online|Sync/i);

  const sync = await evalAsync(`(() => {
    const b = [...document.querySelectorAll('button')].find((e) => /sync all/i.test(e.innerText));
    if (b) { b.click(); return b.innerText.trim(); }
    return null;
  })()`);
  log({ kind: 'UI', action: 'sync-all', ok: !!sync, note: String(sync) });
  await new Promise((r) => setTimeout(r, 3000));

  await visit('/platform/vms', /chrome-e2e-vm|Machine Finder|machines/i);
  await visit('/platform/zeus', /Zeus|AI|Briefing|Agent/i);
  await visit('/platform/gpu', /GPU|MIG|vGPU|Command/i);
  await visit('/openstack', /OpenStack|Nova|Glance|Horizon|not configured|unavailable|Overview/i);
  await visit('/k8s', /Kubernetes|KubeVirt|cluster|namespace|Pods|Nodes/i);

  r = await api('GET', '/api/v1/vms/chrome-e2e-vm/guest/screenshot?screen=0');
  log({ kind: 'API', api: 'screenshot', ok: r.status < 500, note: `${r.status} ${r.body.slice(0, 80)}` });

  r = await api('GET', '/api/v1/vms/chrome-e2e-vm/xml');
  log({
    kind: 'API',
    api: 'domain xml',
    ok: r.status === 200 && /domain/.test(r.body),
    note: `${r.status} len=${r.body.length}`,
  });

  console.log('ROUND4_DONE');
  ws.close();
})().catch((e) => {
  console.error('FATAL', e);
  process.exit(1);
});
