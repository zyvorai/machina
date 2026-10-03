// Copyright 2026 Zyvor AI Labs · https://zyvor.dev
// SPDX-License-Identifier: LicenseRef-Zyvor-Production-1.0

const http = require('http');
const https = require('https');
const fs = require('fs');
const WebSocket = require('ws');
const BASE = 'https://212.8.248.187:5092';
const OUT = '/tmp/machina-round23.jsonl';
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
  console.log(o.ok === false ? 'FAIL' : 'PASS', o.api || o.path || o.action, String(o.note || '').slice(0, 140));
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
  await api('POST', '/api/v1/auth/login', { username: 'sus', password: 'max' });

  // KubeVirt / platform ops on adopted VMs
  for (const id of [
    'c53c701c-cfa1-4c28-b639-4fa7fef77bed',
    'b539747e-c228-4807-bc93-7b77657c6b69',
  ]) {
    let r = await api('GET', `/api/v1/platform/controller/api/v1/vms/${id}`);
    log({ kind: 'API', api: `get ${id.slice(0, 8)}`, ok: r.status === 200, note: r.body.slice(0, 140) });
    r = await api('GET', `/api/v1/platform/controller/api/v1/vms/${id}/console`);
    log({ kind: 'API', api: `console ${id.slice(0, 8)}`, ok: r.status < 500, note: `${r.status} ${r.body.slice(0, 120)}` });
  }

  // Full clone (not linked) while stopped — then delete
  let r = await api('POST', '/api/v1/vms/chrome-e2e-vm/stop');
  log({ kind: 'API', api: 'stop', ok: r.status < 300, note: r.body });
  await new Promise((x) => setTimeout(x, 3000));
  r = await api('POST', '/api/v1/vms/chrome-e2e-vm/clone', { new_name: 'chrome-e2e-fullclone', linked: false });
  log({ kind: 'API', api: 'full clone', ok: r.status < 300, note: `${r.status} ${r.body.slice(0, 160)}` });
  if (r.status < 300) {
    await new Promise((x) => setTimeout(x, 3000));
    r = await api('DELETE', '/api/v1/vms/chrome-e2e-fullclone');
    log({ kind: 'API', api: 'delete fullclone', ok: r.status < 300, note: `${r.status} ${r.body}` });
  }
  r = await api('POST', '/api/v1/vms/chrome-e2e-vm/start');
  log({ kind: 'API', api: 'start', ok: r.status < 300, note: r.body });
  await new Promise((x) => setTimeout(x, 2000));

  // CDP: create wizard pick Install from media card
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
  await new Promise((r) => setTimeout(r, 800));
  await evalAsync(
    `fetch('/api/v1/auth/login',{method:'POST',headers:{'Content-Type':'application/json'},credentials:'include',body:JSON.stringify({username:'sus',password:'max'})}).then(r=>r.json())`,
  );

  await send('Page.navigate', { url: BASE + '/create' });
  await new Promise((r) => setTimeout(r, 3000));
  const card = await evalAsync(`(() => {
    const el = [...document.querySelectorAll('button,a,[role=button],div')].find(e => /Install from media/i.test(e.innerText||''));
    if (el) { el.click(); return (el.innerText||'').slice(0,80); }
    return null;
  })()`);
  await new Promise((r) => setTimeout(r, 2000));
  log({ kind: 'WIZARD', action: 'install-from-media', ok: !!card, note: `card=${card} ${(await bodyTxt()).slice(0, 120)}` });

  const next = await evalAsync(`(() => {
    const b = [...document.querySelectorAll('button')].find(e => e.innerText.trim() === 'Next');
    if (b && !b.disabled) { b.click(); return true; }
    return false;
  })()`);
  await new Promise((r) => setTimeout(r, 1500));
  log({ kind: 'WIZARD', action: 'next-after-card', ok: true, note: `clicked=${next} ${(await bodyTxt()).slice(0, 120)}` });

  // Open integrations k8s tab
  await send('Page.navigate', { url: BASE + '/platform/integrations?tab=k8s' });
  await new Promise((r) => setTimeout(r, 5000));
  log({ kind: 'PAGE', path: 'integrations-k8s', ok: true, note: (await bodyTxt()).slice(0, 140) });

  // OpenStack settings
  await send('Page.navigate', { url: BASE + '/settings?openstack=1' });
  await new Promise((r) => setTimeout(r, 4000));
  log({ kind: 'PAGE', path: 'settings-openstack', ok: true, note: (await bodyTxt()).slice(0, 140) });

  console.log('ROUND23_DONE');
  ws.close();
})().catch((e) => {
  console.error('FATAL', e);
  process.exit(1);
});
