// Copyright 2026 Zyvor AI Labs · https://zyvor.dev
// SPDX-License-Identifier: LicenseRef-Zyvor-Production-1.0

const https = require('https');
const http = require('http');
const fs = require('fs');
const WebSocket = require('ws');
const BASE = 'https://212.8.248.187:5092';
const VM = '3b2803c9-68e9-4235-b0f8-ef46a42c7a80';
const OUT = '/tmp/machina-round11.jsonl';
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
  console.log(o.ok === false ? 'FAIL' : 'PASS', o.action || o.api || o.path, String(o.note || '').slice(0, 150));
}

let cookie = '';
function apiReq(method, path, body) {
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
  // Platform controller power-ish ops on managed VM
  log('login', { ok: true, note: (await apiReq('POST', '/api/v1/auth/login', { username: 'sus', password: 'max' })).body });

  const ops = [
    ['POST', `/api/v1/platform/controller/api/v1/vms/${VM}/stop`],
    ['POST', `/api/v1/platform/controller/api/v1/vms/${VM}/start`],
    ['POST', `/api/v1/platform/controller/api/v1/vms/${VM}/reboot`],
    ['POST', `/api/v1/platform/controller/api/v1/vms/${VM}/shutdown`],
    ['POST', `/api/v1/platform/controller/api/v1/vms/${VM}/start`],
    ['GET', `/api/v1/platform/controller/api/v1/vms/${VM}`],
    ['GET', `/api/v1/platform/controller/api/v1/vms/${VM}/snapshots`],
    ['GET', `/api/v1/platform/controller/api/v1/vms/${VM}/console`],
    ['GET', `/api/v1/platform/controller/api/v1/vms/${VM}/tasks`],
  ];
  for (const [m, p] of ops) {
    if (/\/start$/.test(p) || /\/reboot$/.test(p)) await new Promise((r) => setTimeout(r, 2500));
    const r = await apiReq(m, p);
    const html = /^<!DOCTYPE/i.test(r.body);
    log({
      kind: 'API',
      api: `${m} ${p.replace(/.*\/api\/v1\//, '')}`,
      ok: r.status < 500 && !html,
      note: `${r.status} ${r.body.slice(0, 140)}`,
    });
    if (/\/stop$|\/shutdown$/.test(p)) await new Promise((r) => setTimeout(r, 3000));
  }

  // Ensure libvirt VM running for UI
  await apiReq('POST', '/api/v1/vms/chrome-e2e-vm/start');
  await new Promise((r) => setTimeout(r, 2000));

  // CDP: cinema canvas screenshot check
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

  await send('Page.navigate', { url: BASE + '/' });
  await new Promise((r) => setTimeout(r, 1000));
  await evalAsync(
    `fetch('/api/v1/auth/login',{method:'POST',headers:{'Content-Type':'application/json'},credentials:'include',body:JSON.stringify({username:'sus',password:'max'})}).then(r=>r.json())`,
  );

  await send('Page.navigate', { url: BASE + `/platform/vms/${VM}/consolehub` });
  await new Promise((r) => setTimeout(r, 4000));
  await evalAsync(`(() => { const b=[...document.querySelectorAll('button')].find(e=>/novnc/i.test(e.innerText)); if(b) b.click(); })()`);
  await new Promise((r) => setTimeout(r, 5000));
  const cinema = await evalAsync(`(() => {
    const c = document.querySelector('canvas');
    return { canvas: !!c, w: c && c.width, h: c && c.height, text: document.body.innerText.replace(/\\s+/g,' ').slice(0,160) };
  })()`);
  log({ kind: 'UI', action: 'cinema-novnc-canvas', ok: !!cinema.canvas, note: JSON.stringify(cinema) });

  // Capture screenshot of cinema
  const shot = await send('Page.captureScreenshot', { format: 'png' });
  fs.writeFileSync('/tmp/machina-cinema-screenshot.png', Buffer.from(shot.data, 'base64'));
  log({ kind: 'UI', action: 'cinema-screenshot', ok: true, note: `saved /tmp/machina-cinema-screenshot.png bytes=${Buffer.from(shot.data,'base64').length}` });

  console.log('ROUND11_DONE');
  ws.close();
})().catch((e) => {
  console.error('FATAL', e);
  process.exit(1);
});
