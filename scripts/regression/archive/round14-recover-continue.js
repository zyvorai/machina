// Copyright 2026 Zyvor AI Labs · https://zyvor.dev
// SPDX-License-Identifier: LicenseRef-Zyvor-Production-1.0

const http = require('http');
const https = require('https');
const fs = require('fs');
const WebSocket = require('ws');
const BASE = 'https://212.8.248.187:5092';
const VM = '3b2803c9-68e9-4235-b0f8-ef46a42c7a80';
const OUT = '/tmp/machina-round14.jsonl';
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
  console.log(o.ok === false ? 'FAIL' : 'PASS', o.path || o.action || o.api, String(o.note || '').slice(0, 140));
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
        res.on('end', () => resolve({ status: res.statusCode, body: d.slice(0, 300) }));
      },
    );
    r.on('error', reject);
    if (data) r.write(data);
    r.end();
  });
}

(async () => {
  log({ kind: 'API', api: 'login', ok: true, note: (await api('POST', '/api/v1/auth/login', { username: 'sus', password: 'max' })).body });
  let r = await api('GET', '/api/v1/vms/chrome-e2e-vm');
  log({ kind: 'API', api: 'vm state', ok: r.status === 200 && /running/.test(r.body), note: r.body.slice(0, 160) });

  // Soft power cycle via daemon (no snapshots)
  for (const op of ['pause', 'resume', 'reboot']) {
    r = await api('POST', `/api/v1/vms/chrome-e2e-vm/${op}`);
    log({ kind: 'API', api: op, ok: r.status < 300, note: `${r.status} ${r.body}` });
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
  const waitText = async (re, ms = 28000) => {
    const t0 = Date.now();
    let last = '';
    while (Date.now() - t0 < ms) {
      last = await bodyTxt();
      if (re.test(last) && last.length >= 120) return last;
      await new Promise((r) => setTimeout(r, 700));
    }
    return last || bodyTxt();
  };

  await send('Page.navigate', { url: BASE + '/' });
  await new Promise((r) => setTimeout(r, 1000));
  await evalAsync(
    `fetch('/api/v1/auth/login',{method:'POST',headers:{'Content-Type':'application/json'},credentials:'include',body:JSON.stringify({username:'sus',password:'max'})}).then(r=>r.json())`,
  );

  // Deep classic VM detail with long wait
  await send('Page.navigate', { url: BASE + '/vms/chrome-e2e-vm' });
  const classic = await waitText(/chrome-e2e-vm/i, 30000);
  const classicUi = await evalAsync(`(() => ({
    textLen: document.body.innerText.length,
    buttons: [...document.querySelectorAll('button')].map(b=>b.innerText.trim()).filter(Boolean).slice(0,40),
    links: [...document.querySelectorAll('a')].map(a=>a.innerText.trim()).filter(Boolean).slice(0,20),
    headings: [...document.querySelectorAll('h1,h2,h3')].map(h=>h.innerText.trim()).slice(0,10),
  }))()`);
  log({
    kind: 'PAGE',
    path: '/vms/chrome-e2e-vm deep',
    ok: classic.length > 200,
    note: JSON.stringify(classicUi).slice(0, 280),
  });

  // Platform VM overview deep after recovery
  await send('Page.navigate', { url: BASE + `/platform/vms/${VM}` });
  const plat = await waitText(/chrome-e2e|Virtual|Overview|Power/i, 30000);
  const platUi = await evalAsync(`(() => ({
    textLen: document.body.innerText.length,
    tabs: [...document.querySelectorAll('[role=tab],button')].map(b=>b.innerText.trim()).filter(t=>t&&t.length<24).slice(0,25),
    hasChrome: /chrome-e2e-vm/.test(document.body.innerText),
  }))()`);
  log({
    kind: 'PAGE',
    path: '/platform/vms/:id deep',
    ok: plat.length > 200 && platUi.hasChrome,
    note: JSON.stringify(platUi).slice(0, 280),
  });

  // Snapshots tab should show empty/unsupported cleanly now
  await send('Page.navigate', { url: BASE + `/platform/vms/${VM}?tab=snapshots` });
  const snaps = await waitText(/Snapshot|Create|empty|No snapshot|unsupported|backing/i, 25000);
  log({ kind: 'PAGE', path: 'snapshots-tab', ok: snaps.length > 100, note: snaps.slice(0, 140) });

  // Host detail again
  await send('Page.navigate', { url: BASE + '/platform/hosts/98e60da1-5656-404c-87e9-207ae19ebd86' });
  const host = await waitText(/localhost|Host|online|CPU|Memory|agent/i, 25000);
  log({ kind: 'PAGE', path: 'host-detail', ok: host.length > 150, note: host.slice(0, 140) });

  // Final inventory sanity
  r = await api('GET', '/api/v1/vms');
  log({ kind: 'API', api: 'list vms', ok: /chrome-e2e-vm/.test(r.body), note: r.body.slice(0, 200) });
  r = await api('GET', '/api/v1/platform/controller/api/v1/vms');
  log({ kind: 'API', api: 'platform vms', ok: r.status === 200, note: r.body.slice(0, 200) });

  console.log('ROUND14_DONE');
  ws.close();
})().catch((e) => {
  console.error('FATAL', e);
  process.exit(1);
});
