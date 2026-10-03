// Copyright 2026 Zyvor AI Labs · https://zyvor.dev
// SPDX-License-Identifier: LicenseRef-Zyvor-Production-1.0

const https = require('https');
const fs = require('fs');
const OUT = '/tmp/machina-api-continuous.jsonl';
fs.writeFileSync(OUT, '');
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
        res.on('end', () => resolve({ status: res.statusCode, body: d.slice(0, 180), ct: res.headers['content-type'] || '' }));
      },
    );
    r.on('error', reject);
    if (data) r.write(data);
    r.end();
  });
}
function log(o) {
  fs.appendFileSync(OUT, JSON.stringify({ ts: new Date().toISOString(), ...o }) + '\n');
  console.log(o.ok === false ? 'FAIL' : 'PASS', `L${o.loop}`, o.api, o.note || '');
}
const ENDPOINTS = [
  ['GET', '/api/v1/health'],
  ['GET', '/api/v1/vms'],
  ['GET', '/api/v1/vms/chrome-e2e-vm'],
  ['GET', '/api/v1/networks'],
  ['GET', '/api/v1/storage/pools'],
  ['GET', '/api/v1/node'],
  ['GET', '/api/v1/capabilities'],
  ['GET', '/api/v1/vms/chrome-e2e-vm/guest-health'],
  ['GET', '/api/v1/vms/chrome-e2e-vm/interfaces'],
  ['GET', '/api/v1/platform/controller/api/v1/health'],
  ['GET', '/api/v1/platform/controller/api/v1/vms'],
  ['GET', '/api/v1/platform/controller/api/v1/hosts'],
  ['GET', '/api/v1/platform/controller/api/v1/tasks?limit=3'],
];
(async () => {
  for (let loop = 1; loop <= 30; loop++) {
    await api('POST', '/api/v1/auth/login', { username: 'sus', password: 'max' });
    let pass = 0,
      fail = 0;
    for (const [m, p] of ENDPOINTS) {
      try {
        const r = await api(m, p);
        const html = /^<!DOCTYPE/i.test(r.body);
        const ok = r.status < 400 && !html;
        if (ok) pass++;
        else {
          fail++;
          log({ loop, api: `${m} ${p}`, ok: false, note: `${r.status} ${r.body.slice(0, 80)}` });
        }
      } catch (e) {
        fail++;
        log({ loop, api: `${m} ${p}`, ok: false, note: e.message });
      }
    }
    // light power pulse every 5 loops
    if (loop % 5 === 0) {
      try {
        await api('POST', '/api/v1/vms/chrome-e2e-vm/pause');
        await new Promise((r) => setTimeout(r, 800));
        await api('POST', '/api/v1/vms/chrome-e2e-vm/resume');
        log({ loop, api: 'pause/resume', ok: true, note: 'ok' });
      } catch (e) {
        log({ loop, api: 'pause/resume', ok: false, note: e.message });
      }
    }
    log({ loop, api: 'SUMMARY', ok: fail === 0, note: `pass=${pass} fail=${fail}` });
    console.log(`API LOOP ${loop} pass=${pass} fail=${fail}`);
    await new Promise((r) => setTimeout(r, 2000));
  }
  console.log('API_CONTINUOUS_DONE');
})().catch((e) => {
  console.error('FATAL', e);
  process.exit(1);
});
