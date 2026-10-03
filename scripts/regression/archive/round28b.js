// Copyright 2026 Zyvor AI Labs · https://zyvor.dev
// SPDX-License-Identifier: LicenseRef-Zyvor-Production-1.0

const http = require('http');
const fs = require('fs');
const WebSocket = require('ws');
const BASE = 'https://212.8.248.187:5092';
const OUT = '/tmp/machina-round28b.jsonl';
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
  console.log(o.ok === false ? 'FAIL' : 'PASS', o.path || o.action, String(o.note || '').slice(0, 120));
}

const PAGES = [
  '/platform/hosts/finder',
  '/platform/applications',
  '/platform/launchpad',
  '/platform/datacenter',
  '/platform/mission-control/live',
  '/platform/alert-rules',
  '/platform/scheduled-jobs',
  '/platform/zeus/security/hunt',
  '/platform/zeus/security/enforcement',
  '/platform/zeus/security/ports',
  '/platform/zeus/security/services',
  '/platform/zeus/security/activity',
  '/platform/zeus/security/compliance',
  '/platform/zeus/security/k8s',
  '/platform/zeus/security/cloud',
  '/platform/zeus/security/connectivity',
  '/platform/zeus/security/policies',
  '/platform/vms/3b2803c9-68e9-4235-b0f8-ef46a42c7a80',
  '/platform/vms/c53c701c-cfa1-4c28-b639-4fa7fef77bed',
  '/platform/vms/b539747e-c228-4807-bc93-7b77657c6b69',
];

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
  await new Promise((r) => setTimeout(r, 1000));
  await evalAsync(
    `fetch('/api/v1/auth/login',{method:'POST',headers:{'Content-Type':'application/json'},credentials:'include',body:JSON.stringify({username:'sus',password:'max'})}).then(r=>r.json())`,
  );

  let pass = 0,
    fail = 0;
  for (const path of PAGES) {
    try {
      await send('Page.navigate', { url: BASE + path });
      const t0 = Date.now();
      let t = '';
      while (Date.now() - t0 < 18000) {
        t = await bodyTxt();
        if (t.length >= 150) break;
        await new Promise((r) => setTimeout(r, 500));
      }
      const ok = t.length >= 120 && !/Something went wrong|Route not found/i.test(t);
      if (ok) pass++;
      else fail++;
      log({ kind: 'PAGE', path, ok, note: `len=${t.length}` });
    } catch (e) {
      fail++;
      log({ kind: 'PAGE', path, ok: false, note: e.message });
    }
  }

  for (const name of ['chrome-e2e-vm', 'bug-hunt-vm-kv', 'ui-e2e-x2-74764']) {
    try {
      await send('Page.navigate', { url: BASE + '/platform/vms' });
      await new Promise((r) => setTimeout(r, 6000));
      const clicked = await evalAsync(`(() => {
        const el = [...document.querySelectorAll('a,button,tr,div')].find(e => (e.innerText||'').includes(${JSON.stringify(name)}));
        if (el) { el.click(); return true; }
        return false;
      })()`);
      await new Promise((r) => setTimeout(r, 4000));
      const t = await bodyTxt();
      log({
        kind: 'UI',
        action: `open-${name}`,
        ok: clicked && t.includes(name),
        note: `clicked=${clicked} len=${t.length}`,
      });
    } catch (e) {
      log({ kind: 'UI', action: `open-${name}`, ok: false, note: e.message });
    }
  }

  console.log(`ROUND28B_DONE pass=${pass} fail=${fail}`);
  ws.close();
})().catch((e) => {
  console.error('FATAL', e);
  process.exit(1);
});
