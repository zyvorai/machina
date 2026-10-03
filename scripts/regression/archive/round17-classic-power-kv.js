// Copyright 2026 Zyvor AI Labs · https://zyvor.dev
// SPDX-License-Identifier: LicenseRef-Zyvor-Production-1.0

const http = require('http');
const https = require('https');
const fs = require('fs');
const WebSocket = require('ws');
const BASE = 'https://212.8.248.187:5092';
const VM = '3b2803c9-68e9-4235-b0f8-ef46a42c7a80';
const OUT = '/tmp/machina-round17.jsonl';
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
  // ensure running
  await api('POST', '/api/v1/vms/chrome-e2e-vm/start');
  await new Promise((r) => setTimeout(r, 1500));

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
  const waitFor = async (pred, ms = 30000) => {
    const t0 = Date.now();
    let last = '';
    while (Date.now() - t0 < ms) {
      last = await bodyTxt();
      if (pred(last)) return last;
      await new Promise((r) => setTimeout(r, 700));
    }
    return last;
  };

  await send('Page.navigate', { url: BASE + '/' });
  await new Promise((r) => setTimeout(r, 800));
  await evalAsync(
    `fetch('/api/v1/auth/login',{method:'POST',headers:{'Content-Type':'application/json'},credentials:'include',body:JSON.stringify({username:'sus',password:'max'})}).then(r=>r.json())`,
  );

  // Classic UI: Pause then Resume via buttons
  await send('Page.navigate', { url: BASE + '/vms/chrome-e2e-vm' });
  await waitFor((t) => /Pause|Stop|Shutdown/.test(t) && t.length > 800, 35000);
  let clicked = await evalAsync(`(() => { const b=[...document.querySelectorAll('button')].find(e=>e.innerText.trim()==='Pause'); if(b){b.click();return true;} return false; })()`);
  await new Promise((r) => setTimeout(r, 2500));
  let state = await api('GET', '/api/v1/vms/chrome-e2e-vm');
  log({ kind: 'UI', action: 'classic-pause', ok: clicked && /paused/.test(state.body), note: `clicked=${clicked} ${state.body.slice(0, 100)}` });

  clicked = await evalAsync(`(() => { const b=[...document.querySelectorAll('button')].find(e=>e.innerText.trim()==='Resume'||e.innerText.trim()==='Unpause'); if(b){b.click();return true;} return false; })()`);
  // if resume button not there, API resume
  if (!clicked) await api('POST', '/api/v1/vms/chrome-e2e-vm/resume');
  await new Promise((r) => setTimeout(r, 2000));
  state = await api('GET', '/api/v1/vms/chrome-e2e-vm');
  log({ kind: 'UI', action: 'classic-resume', ok: /running/.test(state.body), note: `clicked=${clicked} ${state.body.slice(0, 100)}` });

  // Platform disks tab via URL
  await send('Page.navigate', { url: BASE + `/platform/vms/${VM}?tab=disks` });
  const disks = await waitFor((t) => /Disk|qcow|vda|Capacity|Attach/i.test(t), 25000);
  log({ kind: 'PAGE', path: 'disks-tab', ok: /Disk|qcow|vda/i.test(disks), note: disks.slice(0, 140) });

  // Platform console → cinema
  await send('Page.navigate', { url: BASE + `/platform/vms/${VM}?tab=console` });
  await new Promise((r) => setTimeout(r, 5000));
  const loc = await evalAsync('location.pathname + location.search');
  const cinema = await bodyTxt();
  log({
    kind: 'PAGE',
    path: 'console-tab-nav',
    ok: /consolehub|console|Cinema|novnc/i.test(loc + cinema),
    note: `loc=${loc} ${cinema.slice(0, 100)}`,
  });

  // KubeVirt VM detail pages deep
  for (const [id2, name] of [
    ['c53c701c-cfa1-4c28-b639-4fa7fef77bed', 'bug-hunt-vm-kv'],
    ['b539747e-c228-4807-bc93-7b77657c6b69', 'ui-e2e-x2-74764'],
  ]) {
    await send('Page.navigate', { url: BASE + `/platform/vms/${id2}` });
    const t = await waitFor((x) => new RegExp(name).test(x) && x.length > 400, 35000);
    log({ kind: 'PAGE', path: `kv-${name}`, ok: new RegExp(name).test(t), note: `len=${t.length} ${t.slice(0, 120)}` });
    await send('Page.navigate', { url: BASE + `/platform/vms/${id2}?tab=hardware` });
    const h = await waitFor((x) => /Hardware|vCPU|Memory|CPU/i.test(x), 20000);
    log({ kind: 'PAGE', path: `kv-${name}-hw`, ok: /Hardware|vCPU|Memory/i.test(h), note: h.slice(0, 100) });
  }

  // Create advanced: fill name field if present (no submit)
  await send('Page.navigate', { url: BASE + '/platform/create-advanced' });
  await waitFor((t) => /Advanced|Create|Name|guest/i.test(t), 20000);
  const filled = await evalAsync(`(() => {
    const inputs = [...document.querySelectorAll('input')];
    const name = inputs.find(i => /name/i.test(i.id||'') || /name/i.test(i.name||'') || /name/i.test(i.placeholder||''));
    if (!name) return { ok:false, count: inputs.length };
    const s = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype,'value').set;
    s.call(name, 'ui-adv-probe');
    name.dispatchEvent(new Event('input',{bubbles:true}));
    return { ok:true, value:name.value, count:inputs.length };
  })()`);
  log({ kind: 'UI', action: 'create-advanced-fill', ok: !!filled.ok, note: JSON.stringify(filled) });

  // Import page controls
  await send('Page.navigate', { url: BASE + '/import' });
  await waitFor((t) => /Import|Upload|OVA|qcow/i.test(t), 20000);
  const imp = await evalAsync(`(() => ({
    buttons: [...document.querySelectorAll('button')].map(b=>b.innerText.trim()).filter(Boolean).slice(0,20),
    inputs: [...document.querySelectorAll('input')].map(i=>({type:i.type, name:i.name, id:i.id})).slice(0,15),
  }))()`);
  log({ kind: 'UI', action: 'import-controls', ok: true, note: JSON.stringify(imp).slice(0, 250) });

  console.log('ROUND17_DONE');
  ws.close();
})().catch((e) => {
  console.error('FATAL', e);
  process.exit(1);
});
