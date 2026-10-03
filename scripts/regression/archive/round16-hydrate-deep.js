// Copyright 2026 Zyvor AI Labs · https://zyvor.dev
// SPDX-License-Identifier: LicenseRef-Zyvor-Production-1.0

const http = require('http');
const https = require('https');
const fs = require('fs');
const WebSocket = require('ws');
const BASE = 'https://212.8.248.187:5092';
const VM = '3b2803c9-68e9-4235-b0f8-ef46a42c7a80';
const OUT = '/tmp/machina-round16.jsonl';
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
  console.log(o.ok === false ? 'FAIL' : 'PASS', o.action || o.path || o.api, String(o.note || '').slice(0, 150));
}

let cookie = '';
function api(method, path, body) {
  return new Promise((resolve, reject) => {
    const data = body ? JSON.stringify(body) : null;
    const headers = { Accept: 'application/json' };
    if (cookie) headers.Cookie = cookie;
    if (data) {
      headers['Content-Type'] = 'application/json';
      headers['Content-Length'] = Buffer.byteLength(data);
    }
    const r = https.request(
      { host: '212.8.248.187', port: 5092, path, method, headers, rejectUnauthorized: false },
      (res) => {
        const set = res.headers['set-cookie'];
        if (set) cookie = set.map((c) => c.split(';')[0]).join('; ');
        let d = '';
        res.on('data', (c) => (d += c));
        res.on('end', () => resolve({ status: res.statusCode, body: d.slice(0, 400) }));
      },
    );
    r.on('error', reject);
    if (data) r.write(data);
    r.end();
  });
}

(async () => {
  log({ kind: 'API', api: 'login', ok: true, note: (await api('POST', '/api/v1/auth/login', { username: 'sus', password: 'max' })).body });

  // Poll platform stop/start tasks to completion
  for (const op of ['stop', 'start']) {
    const r = await api('POST', `/api/v1/platform/controller/api/v1/vms/${VM}/${op}`);
    log({ kind: 'API', api: `platform ${op}`, ok: r.status < 300, note: r.body.slice(0, 160) });
    let taskId;
    try {
      taskId = JSON.parse(r.body).task_id;
    } catch {}
    if (taskId) {
      for (let i = 0; i < 20; i++) {
        await new Promise((x) => setTimeout(x, 1000));
        const t = await api('GET', `/api/v1/platform/controller/api/v1/tasks/${taskId}`);
        const body = t.body;
        if (/completed|failed|error/i.test(body)) {
          log({ kind: 'API', api: `task ${op}`, ok: /completed/.test(body), note: body.slice(0, 180) });
          break;
        }
      }
    }
    await new Promise((x) => setTimeout(x, 1500));
  }

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
  await send('Network.enable');
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
  const waitFor = async (pred, ms = 40000) => {
    const t0 = Date.now();
    let last = '';
    while (Date.now() - t0 < ms) {
      last = await bodyTxt();
      if (pred(last)) return last;
      await new Promise((r) => setTimeout(r, 800));
    }
    return last;
  };

  await send('Page.navigate', { url: BASE + '/' });
  await new Promise((r) => setTimeout(r, 1000));
  await evalAsync(
    `fetch('/api/v1/auth/login',{method:'POST',headers:{'Content-Type':'application/json'},credentials:'include',body:JSON.stringify({username:'sus',password:'max'})}).then(r=>r.json())`,
  );

  // Platform VM detail — wait until name appears
  await send('Page.navigate', { url: BASE + `/platform/vms/${VM}` });
  const plat = await waitFor((t) => /chrome-e2e-vm/.test(t) && t.length > 400, 45000);
  log({
    kind: 'PAGE',
    path: 'platform-vm-detail',
    ok: /chrome-e2e-vm/.test(plat),
    note: `len=${plat.length} ${plat.slice(0, 140)}`,
  });

  // Click Overview/Access/Hardware via role=tab
  for (const label of ['Overview', 'Access', 'Hardware', 'Console', 'Disks']) {
    const clicked = await evalAsync(`(() => {
      const el = [...document.querySelectorAll('[role=tab],button')].find(e => e.innerText.trim() === ${JSON.stringify(label)});
      if (el) { el.click(); return true; }
      return false;
    })()`);
    await new Promise((r) => setTimeout(r, 2000));
    const t = await bodyTxt();
    log({
      kind: 'TAB',
      action: label,
      ok: clicked && t.length > 200,
      note: `clicked=${clicked} len=${t.length}`,
    });
  }

  // Machine finder: wait for machine count > 0
  await send('Page.navigate', { url: BASE + '/platform/vms' });
  const finder = await waitFor((t) => /chrome-e2e-vm/.test(t) || /[1-9]\s*machines?/i.test(t), 45000);
  log({
    kind: 'PAGE',
    path: 'machine-finder',
    ok: /chrome-e2e-vm|[1-9]/.test(finder),
    note: `len=${finder.length} ${finder.slice(0, 140)}`,
  });

  // Classic list wait for name
  await send('Page.navigate', { url: BASE + '/vms' });
  const list = await waitFor((t) => /chrome-e2e-vm/.test(t), 45000);
  log({
    kind: 'PAGE',
    path: 'classic-vms',
    ok: /chrome-e2e-vm/.test(list),
    note: `len=${list.length} ${list.slice(0, 140)}`,
  });

  // Classic detail — wait longer for hydrate
  await send('Page.navigate', { url: BASE + '/vms/chrome-e2e-vm' });
  const detail = await waitFor((t) => /chrome-e2e-vm/.test(t) && (t.length > 800 || /vCPU|Memory|Console|Power|Stop|Start/i.test(t)), 45000);
  const detailUi = await evalAsync(`(() => ({
    len: document.body.innerText.length,
    buttons: [...document.querySelectorAll('button')].map(b=>b.innerText.trim()).filter(Boolean).slice(0,40),
  }))()`);
  log({
    kind: 'PAGE',
    path: 'classic-detail',
    ok: /chrome-e2e-vm/.test(detail),
    note: JSON.stringify(detailUi).slice(0, 250),
  });

  // Header hosts string
  const header = await evalAsync(`(() => {
    const t = document.body.innerText;
    const m = t.match(/Healthy[^\\n]{0,40}|\\d+\\/\\d+\\s*hosts/i);
    return { match: m && m[0], snippet: t.slice(0, 200) };
  })()`);
  log({ kind: 'BUGCHECK', action: 'header-hosts', ok: true, note: JSON.stringify(header) });

  console.log('ROUND16_DONE');
  ws.close();
})().catch((e) => {
  console.error('FATAL', e);
  process.exit(1);
});
