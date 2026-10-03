// Copyright 2026 Zyvor AI Labs · https://zyvor.dev
// SPDX-License-Identifier: LicenseRef-Zyvor-Production-1.0

const https = require('https');
const http = require('http');
const fs = require('fs');
const WebSocket = require('ws');
const BASE = 'https://212.8.248.187:5092';
const OUT = '/tmp/machina-round12.jsonl';
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
  console.log(o.ok === false ? 'FAIL' : 'PASS', o.api || o.path || o.action, String(o.note || '').slice(0, 150));
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
        res.on('end', () => resolve({ status: res.statusCode, body: d.slice(0, 350), ct: res.headers['content-type'] || '' }));
      },
    );
    r.on('error', reject);
    if (data) r.write(data);
    r.end();
  });
}

(async () => {
  log({ kind: 'API', api: 'login', ok: true, note: (await api('POST', '/api/v1/auth/login', { username: 'sus', password: 'max' })).body });

  // Ensure running
  await api('POST', '/api/v1/vms/chrome-e2e-vm/start');
  await new Promise((r) => setTimeout(r, 1500));

  // Create vol, try attach, detach, delete
  let r = await api('POST', '/api/v1/storage/pools/default/volumes', {
    name: 'page-attach-vol',
    capacity_gb: 1,
    format: 'qcow2',
  });
  log({ kind: 'API', api: 'create attach-vol', ok: r.status < 300, note: `${r.status} ${r.body}` });

  // Probe attach endpoints
  for (const [m, p, b] of [
    ['POST', '/api/v1/vms/chrome-e2e-vm/attach-disk', { pool: 'default', volume: 'page-attach-vol', target: 'vdb' }],
    ['POST', '/api/v1/vms/chrome-e2e-vm/disks', { pool: 'default', volume: 'page-attach-vol', target: 'vdb' }],
    ['POST', '/api/v1/vms/chrome-e2e-vm/disk/attach', { pool: 'default', volume: 'page-attach-vol', target: 'vdb' }],
    ['POST', '/api/v1/vms/chrome-e2e-vm/attach', { type: 'disk', pool: 'default', volume: 'page-attach-vol' }],
  ]) {
    r = await api(m, p, b);
    const html = /html/i.test(r.ct) || /^<!DOCTYPE/i.test(r.body);
    log({ kind: 'API', api: `${m} ${p}`, ok: r.status < 400 && !html, note: `${r.status} ${r.body.slice(0, 140)}` });
    if (r.status < 400 && !html) break;
  }

  // NIC attach probe
  for (const [m, p, b] of [
    ['POST', '/api/v1/vms/chrome-e2e-vm/attach-nic', { network: 'default', model: 'virtio' }],
    ['POST', '/api/v1/vms/chrome-e2e-vm/nics', { network: 'default', model: 'virtio' }],
    ['POST', '/api/v1/vms/chrome-e2e-vm/interfaces', { network: 'default', model: 'virtio' }],
  ]) {
    r = await api(m, p, b);
    const html = /html/i.test(r.ct) || /^<!DOCTYPE/i.test(r.body);
    log({ kind: 'API', api: `${m} ${p}`, ok: r.status < 400 && !html, note: `${r.status} ${r.body.slice(0, 140)}` });
    if (r.status < 400 && !html) break;
  }

  // Cleanup volume (may fail if attached)
  r = await api('DELETE', '/api/v1/storage/pools/default/volumes/page-attach-vol');
  log({ kind: 'API', api: 'delete attach-vol', ok: r.status < 400, note: `${r.status} ${r.body.slice(0, 120)}` });

  // Rename probe (then rename back) — stop first if needed
  r = await api('POST', '/api/v1/vms/chrome-e2e-vm/stop');
  log({ kind: 'API', api: 'stop for rename', ok: r.status < 300, note: `${r.status} ${r.body}` });
  await new Promise((x) => setTimeout(x, 2500));
  r = await api('POST', '/api/v1/vms/chrome-e2e-vm/rename', { new_name: 'chrome-e2e-renamed' });
  log({ kind: 'API', api: 'rename', ok: r.status < 300, note: `${r.status} ${r.body}` });
  if (r.status < 300) {
    await new Promise((x) => setTimeout(x, 1000));
    r = await api('POST', '/api/v1/vms/chrome-e2e-renamed/rename', { new_name: 'chrome-e2e-vm' });
    log({ kind: 'API', api: 'rename back', ok: r.status < 300, note: `${r.status} ${r.body}` });
  }
  r = await api('POST', '/api/v1/vms/chrome-e2e-vm/start');
  log({ kind: 'API', api: 'start after rename', ok: r.status < 300, note: `${r.status} ${r.body}` });
  await new Promise((x) => setTimeout(x, 2000));

  // Snapshot create (expect unsupported for backing chain)
  r = await api('POST', '/api/v1/vms/chrome-e2e-vm/snapshots', { name: 'snap-probe' });
  log({
    kind: 'API',
    api: 'snapshot create',
    ok: r.status < 500,
    note: `${r.status} ${r.body.slice(0, 180)}`,
  });

  // Network autostart
  r = await api('POST', '/api/v1/networks/default/autostart/true');
  log({ kind: 'API', api: 'net autostart', ok: r.status < 400, note: `${r.status} ${r.body.slice(0, 120)}` });

  // CDP more classic pages with longer wait
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
  const waitText = async (re, ms = 20000) => {
    const t0 = Date.now();
    let last = '';
    while (Date.now() - t0 < ms) {
      last = await bodyTxt();
      if (re.test(last) && last.length >= 100) return last;
      await new Promise((r) => setTimeout(r, 600));
    }
    return last || bodyTxt();
  };

  await send('Page.navigate', { url: BASE + '/' });
  await new Promise((r) => setTimeout(r, 800));
  await evalAsync(
    `fetch('/api/v1/auth/login',{method:'POST',headers:{'Content-Type':'application/json'},credentials:'include',body:JSON.stringify({username:'sus',password:'max'})}).then(r=>r.json())`,
  );

  for (const [path, re] of [
    ['/vms', /chrome-e2e-vm|Virtual Machines|Running/i],
    ['/vms/chrome-e2e-vm', /chrome-e2e-vm|vCPU|Memory|Console|Power|Start|Stop/i],
    ['/platform/vms', /chrome-e2e|Machine Finder|machines/i],
    ['/platform/mission-control/live', /Live|Wall|Mission|event|stream/i],
    ['/platform/alert-rules', /Alert|Rule/i],
    ['/platform/scheduled-jobs', /Schedule|Job/i],
  ]) {
    await send('Page.navigate', { url: BASE + path });
    const t = await waitText(re, 22000);
    log({
      kind: 'PAGE',
      path,
      ok: re.test(t) && t.length >= 100,
      note: `len=${t.length} ${t.slice(0, 110)}`,
    });
  }

  // Classic VM detail: list buttons with data-testid
  await send('Page.navigate', { url: BASE + '/vms/chrome-e2e-vm' });
  await waitText(/chrome-e2e/i, 20000);
  const tests = await evalAsync(`(() => {
    return {
      testids: [...document.querySelectorAll('[data-testid]')].map(e => e.getAttribute('data-testid')).slice(0, 40),
      buttons: [...document.querySelectorAll('button')].map(b => b.innerText.trim()).filter(Boolean).slice(0, 30),
    };
  })()`);
  log({ kind: 'DISCOVER', action: 'classic-vm-controls', ok: true, note: JSON.stringify(tests).slice(0, 300) });

  console.log('ROUND12_DONE');
  ws.close();
})().catch((e) => {
  console.error('FATAL', e);
  process.exit(1);
});
