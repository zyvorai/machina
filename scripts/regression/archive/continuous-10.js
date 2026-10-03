// Copyright 2026 Zyvor AI Labs · https://zyvor.dev
// SPDX-License-Identifier: LicenseRef-Zyvor-Production-1.0

const http = require('http');
const https = require('https');
const fs = require('fs');
const WebSocket = require('ws');
const BASE = 'https://212.8.248.187:5092';
const OUT = '/tmp/machina-continuous.jsonl';
const PAGES = JSON.parse(fs.readFileSync('/tmp/machina-round30-pages.json', 'utf8'));
const MAX_LOOPS = 10;
/* append */

function getJson(url) {
  return new Promise((resolve, reject) => {
    http.get(url, (res) => {
      let d = '';
      res.on('data', (c) => (d += c));
      res.on('end', () => {
        try { resolve(JSON.parse(d)); } catch (e) { reject(e); }
      });
    }).on('error', reject);
  });
}

function append(o) {
  fs.appendFileSync(OUT, JSON.stringify({ ts: new Date().toISOString(), ...o }) + '\n');
  console.log(o.ok === false ? 'FAIL' : o.soft ? 'SOFT' : 'PASS', o.loop != null ? `L${o.loop}` : '', o.path || o.api || o.msg || '', String(o.note || '').slice(0, 100));
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
        res.on('end', () => resolve({ status: res.statusCode, body: d.slice(0, 200) }));
      },
    );
    r.on('error', reject);
    if (data) r.write(data);
    r.end();
  });
}

async function connectCdp() {
  const targets = await getJson('http://127.0.0.1:9222/json/list');
  const page = targets.find((t) => t.type === 'page');
  if (!page) throw new Error('no page');
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  let id = 0;
  const pending = new Map();
  const send = (m, p = {}) =>
    new Promise((resolve, reject) => {
      const mid = ++id;
      pending.set(mid, { resolve, reject });
      try {
        ws.send(JSON.stringify({ id: mid, method: m, params: p }));
      } catch (e) {
        pending.delete(mid);
        reject(e);
      }
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
  return { ws, send, evalAsync };
}

(async () => {
  await api('POST', '/api/v1/auth/login', { username: 'sus', password: 'max' });
  let cdp = await connectCdp();
  await cdp.send('Page.navigate', { url: BASE + '/' });
  await new Promise((r) => setTimeout(r, 1000));
  await cdp.evalAsync(
    `fetch('/api/v1/auth/login',{method:'POST',headers:{'Content-Type':'application/json'},credentials:'include',body:JSON.stringify({username:'sus',password:'max'})}).then(r=>r.json())`,
  );

  for (let loop = 1; loop <= MAX_LOOPS; loop++) {
    console.log('LOOP', loop, 'START');
    let pass = 0,
      soft = 0,
      fail = 0;
    // API heartbeat each loop
    try {
      const h = await api('GET', '/api/v1/health');
      append({ loop, kind: 'API', api: 'health', ok: h.status === 200, note: h.body });
      const v = await api('GET', '/api/v1/vms/chrome-e2e-vm');
      if (!/running/.test(v.body)) await api('POST', '/api/v1/vms/chrome-e2e-vm/start');
      append({ loop, kind: 'API', api: 'vm', ok: true, note: v.body.slice(0, 80) });
    } catch (e) {
      append({ loop, kind: 'API', api: 'heartbeat', ok: false, note: e.message });
    }

    for (const path of PAGES) {
      try {
        await cdp.send('Page.navigate', { url: BASE + path });
        const wait = path.startsWith('/platform') ? 9000 : 5000;
        const t0 = Date.now();
        let t = '';
        while (Date.now() - t0 < wait) {
          t = await cdp.evalAsync(
            `document.body ? document.body.innerText.replace(/\\s+/g, ' ').trim() : ''`,
          );
          if (t.length >= 150) break;
          await new Promise((r) => setTimeout(r, 350));
        }
        const crashed = /Something went wrong|Route not found/i.test(t);
        const short = t.length < 100;
        if (crashed) {
          fail++;
          append({ loop, kind: 'PAGE', path, ok: false, note: `FAIL len=${t.length}` });
        } else if (short) {
          soft++;
          append({ loop, kind: 'PAGE', path, ok: true, soft: true, note: `SOFT len=${t.length}` });
        } else {
          pass++;
        }
      } catch (e) {
        fail++;
        append({ loop, kind: 'PAGE', path, ok: false, note: `EXC ${e.message}` });
        try {
          cdp.ws.close();
        } catch {}
        await new Promise((r) => setTimeout(r, 1500));
        try {
          cdp = await connectCdp();
          await cdp.evalAsync(
            `fetch('/api/v1/auth/login',{method:'POST',headers:{'Content-Type':'application/json'},credentials:'include',body:JSON.stringify({username:'sus',password:'max'})}).then(r=>r.json())`,
          );
          append({ loop, kind: 'CDP', msg: 'reconnected', ok: true });
        } catch (e2) {
          append({ loop, kind: 'CDP', msg: 'reconnect-failed', ok: false, note: e2.message });
        }
      }
    }
    console.log(`LOOP ${loop} DONE pass=${pass} soft=${soft} fail=${fail}`);
    append({ loop, kind: 'SUMMARY', ok: fail === 0, note: `pass=${pass} soft=${soft} fail=${fail}` });
  }
  console.log('CONTINUOUS_DONE');
  try {
    cdp.ws.close();
  } catch {}
})().catch((e) => {
  console.error('FATAL', e);
  process.exit(1);
});
