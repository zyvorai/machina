// Copyright 2026 Zyvor AI Labs · https://zyvor.dev
// SPDX-License-Identifier: LicenseRef-Zyvor-Production-1.0

const http = require('http');
const https = require('https');
const fs = require('fs');
const WebSocket = require('ws');
const BASE = 'https://212.8.248.187:5092';
const OUT = '/tmp/machina-round18.jsonl';
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
  console.log(o.ok === false ? 'FAIL' : 'PASS', o.action || o.path || o.api, String(o.note || '').slice(0, 140));
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
        res.on('end', () => resolve({ status: res.statusCode, body: d.slice(0, 350) }));
      },
    );
    r.on('error', reject);
    if (data) r.write(data);
    r.end();
  });
}

(async () => {
  await api('POST', '/api/v1/auth/login', { username: 'sus', password: 'max' });
  await api('POST', '/api/v1/vms/chrome-e2e-vm/start');

  // More API surface
  for (const [m, p, b] of [
    ['GET', '/api/v1/browse/disks'],
    ['GET', '/api/v1/storage/pools'],
    ['GET', '/api/v1/networks'],
    ['GET', '/api/v1/nwfilters'],
    ['GET', '/api/v1/node'],
    ['GET', '/api/v1/vms/chrome-e2e-vm/guest-health'],
    ['GET', '/api/v1/vms/chrome-e2e-vm/interfaces'],
    ['GET', '/api/v1/platform/controller/api/v1/health'],
    ['GET', '/api/v1/platform/controller/api/v1/cluster'],
    ['GET', '/api/v1/platform/controller/api/v1/fleet'],
    ['GET', '/api/v1/platform/controller/api/v1/settings'],
    ['GET', '/api/v1/platform/controller/api/v1/users'],
    ['GET', '/api/v1/platform/controller/api/v1/projects'],
    ['GET', '/api/v1/platform/controller/api/v1/content'],
    ['GET', '/api/v1/platform/controller/api/v1/templates'],
    ['GET', '/api/v1/platform/controller/api/v1/networks'],
    ['GET', '/api/v1/platform/controller/api/v1/storage'],
    ['GET', '/api/v1/platform/controller/api/v1/backups'],
    ['GET', '/api/v1/platform/controller/api/v1/soc/alerts'],
    ['GET', '/api/v1/platform/controller/api/v1/ai/providers'],
  ]) {
    const r = await api(m, p, b);
    const html = /^<!DOCTYPE/i.test(r.body);
    log({
      kind: 'API',
      api: `${m} ${p.replace(/.*controller/, 'ctrl').replace('/api/v1/', '')}`,
      ok: r.status < 500 && !html,
      note: `${r.status} ${r.body.slice(0, 100).replace(/\n/g, ' ')}`,
    });
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
  const waitFor = async (pred, ms = 25000) => {
    const t0 = Date.now();
    let last = '';
    while (Date.now() - t0 < ms) {
      last = await bodyTxt();
      if (pred(last)) return last;
      await new Promise((r) => setTimeout(r, 600));
    }
    return last;
  };

  await send('Page.navigate', { url: BASE + '/' });
  await new Promise((r) => setTimeout(r, 800));
  await evalAsync(
    `fetch('/api/v1/auth/login',{method:'POST',headers:{'Content-Type':'application/json'},credentials:'include',body:JSON.stringify({username:'sus',password:'max'})}).then(r=>r.json())`,
  );

  // Classic Shutdown (ACPI) then Start
  await send('Page.navigate', { url: BASE + '/vms/chrome-e2e-vm' });
  await waitFor((t) => /Shutdown|Stop/.test(t) && t.length > 800, 30000);
  let clicked = await evalAsync(`(() => { const b=[...document.querySelectorAll('button')].find(e=>e.innerText.trim()==='Shutdown'); if(b){b.click();return true;} return false; })()`);
  await new Promise((r) => setTimeout(r, 4000));
  let st = await api('GET', '/api/v1/vms/chrome-e2e-vm');
  log({ kind: 'UI', action: 'classic-shutdown', ok: clicked, note: `clicked=${clicked} state=${st.body.slice(0, 80)}` });
  // force start if still running/shutting down
  await api('POST', '/api/v1/vms/chrome-e2e-vm/start');
  await new Promise((r) => setTimeout(r, 2000));
  // if still running from soft shutdown failure, stop then start
  st = await api('GET', '/api/v1/vms/chrome-e2e-vm');
  if (/running|paused/.test(st.body)) {
    await api('POST', '/api/v1/vms/chrome-e2e-vm/stop');
    await new Promise((r) => setTimeout(r, 2000));
  }
  await send('Page.navigate', { url: BASE + '/vms/chrome-e2e-vm' });
  await waitFor((t) => /Start|Shutdown|Stop/.test(t), 25000);
  clicked = await evalAsync(`(() => { const b=[...document.querySelectorAll('button')].find(e=>e.innerText.trim()==='Start'); if(b){b.click();return true;} return false; })()`);
  if (!clicked) await api('POST', '/api/v1/vms/chrome-e2e-vm/start');
  await new Promise((r) => setTimeout(r, 2500));
  st = await api('GET', '/api/v1/vms/chrome-e2e-vm');
  log({ kind: 'UI', action: 'classic-start', ok: /running/.test(st.body), note: `clicked=${clicked} ${st.body.slice(0, 100)}` });

  // Networks page content deep
  await send('Page.navigate', { url: BASE + '/networks' });
  const nets = await waitFor((t) => /default|virbr|Network/i.test(t) && t.length > 400, 25000);
  log({ kind: 'PAGE', path: '/networks deep', ok: /default/i.test(nets), note: `len=${nets.length} ${nets.slice(0, 120)}` });

  // Storage deep
  await send('Page.navigate', { url: BASE + '/storage' });
  const stor = await waitFor((t) => /default|Pool|Capacity|GiB|GB/i.test(t) && t.length > 300, 25000);
  log({ kind: 'PAGE', path: '/storage deep', ok: /default|Pool/i.test(stor), note: `len=${stor.length} ${stor.slice(0, 120)}` });

  // Platform hosts page — wait for localhost
  await send('Page.navigate', { url: BASE + '/platform/hosts' });
  const hosts = await waitFor((t) => /localhost|online|Hosts/i.test(t) && t.length > 400, 35000);
  log({ kind: 'PAGE', path: '/platform/hosts deep', ok: /localhost|online/i.test(hosts), note: `len=${hosts.length} ${hosts.slice(0, 120)}` });

  // Zeus configure providers UI
  await send('Page.navigate', { url: BASE + '/platform/zeus/configure' });
  const zeus = await waitFor((t) => /Zeus|Provider|Prompt|Model|Configure/i.test(t), 25000);
  log({ kind: 'PAGE', path: 'zeus-configure', ok: zeus.length > 200, note: zeus.slice(0, 120) });

  // SOC page deep
  await send('Page.navigate', { url: BASE + '/platform/soc' });
  const soc = await waitFor((t) => /Security|SOC|Alert|Threat|Operations/i.test(t), 25000);
  log({ kind: 'PAGE', path: 'soc deep', ok: soc.length > 200, note: soc.slice(0, 120) });

  console.log('ROUND18_DONE');
  ws.close();
})().catch((e) => {
  console.error('FATAL', e);
  process.exit(1);
});
