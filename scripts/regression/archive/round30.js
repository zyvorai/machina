// Copyright 2026 Zyvor AI Labs · https://zyvor.dev
// SPDX-License-Identifier: LicenseRef-Zyvor-Production-1.0

const http = require('http');
const fs = require('fs');
const WebSocket = require('ws');
const BASE = 'https://212.8.248.187:5092';
const OUT = '/tmp/machina-round30.jsonl';
const SUMMARY = '/tmp/machina-round30-summary.txt';
const PAGES = JSON.parse(fs.readFileSync('/tmp/machina-round30-pages.json', 'utf8'));
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
  await new Promise((r) => setTimeout(r, 800));
  await evalAsync(
    `fetch('/api/v1/auth/login',{method:'POST',headers:{'Content-Type':'application/json'},credentials:'include',body:JSON.stringify({username:'sus',password:'max'})}).then(r=>r.json())`,
  );
  let pass = 0,
    soft = 0,
    fail = 0;
  for (let i = 0; i < PAGES.length; i++) {
    const path = PAGES[i];
    await send('Page.navigate', { url: BASE + path });
    const wait = path.startsWith('/platform') ? 10000 : 6000;
    const t0 = Date.now();
    let t = '';
    while (Date.now() - t0 < wait) {
      t = await bodyTxt();
      if (t.length >= 150) break;
      await new Promise((r) => setTimeout(r, 400));
    }
    const crashed = /Something went wrong|Route not found/i.test(t);
    const short = t.length < 100;
    let ok = true,
      isSoft = false;
    if (crashed) {
      ok = false;
      fail++;
    } else if (short) {
      isSoft = true;
      soft++;
    } else pass++;
    fs.appendFileSync(OUT, JSON.stringify({ kind: 'PAGE', path, ok, soft: isSoft, note: `len=${t.length}` }) + '\n');
    if (!ok || isSoft || i % 25 === 0) console.log(ok ? (isSoft ? 'SOFT' : 'PASS') : 'FAIL', `${i + 1}/${PAGES.length}`, path, `len=${t.length}`);
  }
  const line = `pass=${pass} soft=${soft} fail=${fail} total=${PAGES.length}`;
  fs.writeFileSync(SUMMARY, line + '\n');
  console.log('ROUND30_DONE', line);
  ws.close();
})().catch((e) => {
  console.error('FATAL', e);
  process.exit(1);
});
