// Copyright 2026 Zyvor AI Labs · https://zyvor.dev
// SPDX-License-Identifier: LicenseRef-Zyvor-Production-1.0

const https = require('https');
const fs = require('fs');
const OUT = '/tmp/machina-round8-api.jsonl';
fs.writeFileSync(OUT, '');
const HOST = '212.8.248.187';
let cookie = '';

function req(method, path, body) {
  return new Promise((resolve, reject) => {
    const data = body ? JSON.stringify(body) : null;
    const headers = { Accept: 'application/json' };
    if (cookie) headers.Cookie = cookie;
    if (data) {
      headers['Content-Type'] = 'application/json';
      headers['Content-Length'] = Buffer.byteLength(data);
    }
    const r = https.request(
      { host: HOST, port: 5092, path, method, headers, rejectUnauthorized: false },
      (res) => {
        const set = res.headers['set-cookie'];
        if (set) cookie = set.map((c) => c.split(';')[0]).join('; ');
        let d = '';
        res.on('data', (c) => (d += c));
        res.on('end', () =>
          resolve({
            status: res.statusCode,
            ct: res.headers['content-type'] || '',
            body: d.slice(0, 350),
          }),
        );
      },
    );
    r.on('error', reject);
    if (data) r.write(data);
    r.end();
  });
}

function log(api, r) {
  const html = /text\/html/.test(r.ct) || /^<!DOCTYPE/i.test(r.body);
  const ok = r.status < 400 && !html;
  const soft = r.status < 400 && html;
  fs.appendFileSync(OUT, JSON.stringify({ api, ok: ok || soft, soft, status: r.status, body: r.body.slice(0, 160) }) + '\n');
  console.log(ok ? 'PASS' : soft ? 'SOFT' : 'FAIL', api, r.status, r.body.slice(0, 120).replace(/\n/g, ' '));
}

(async () => {
  log('login', await req('POST', '/api/v1/auth/login', { username: 'sus', password: 'max' }));

  const paths = [
    ['GET', '/api/v1/node'],
    ['GET', '/api/v1/host/info'],
    ['GET', '/api/v1/system'],
    ['GET', '/api/v1/vms/chrome-e2e-vm'],
    ['GET', '/api/v1/vms/chrome-e2e-vm/stats'],
    ['GET', '/api/v1/vms/chrome-e2e-vm/metrics'],
    ['GET', '/api/v1/vms/chrome-e2e-vm/guest-health'],
    ['GET', '/api/v1/vms/chrome-e2e-vm/guest/info'],
    ['GET', '/api/v1/vms/chrome-e2e-vm/guest/screenshot?screen=0'],
    ['GET', '/api/v1/vms/chrome-e2e-vm/disks'],
    ['GET', '/api/v1/vms/chrome-e2e-vm/disk'],
    ['GET', '/api/v1/vms/chrome-e2e-vm/block'],
    ['GET', '/api/v1/vms/chrome-e2e-vm/interfaces'],
    ['GET', '/api/v1/vms/chrome-e2e-vm/snapshots'],
    ['GET', '/api/v1/vms/chrome-e2e-vm/xml'],
    ['GET', '/api/v1/storage/pools/default'],
    ['GET', '/api/v1/storage/pools/default/volumes'],
    ['GET', '/api/v1/jobs'],
    ['GET', '/api/v1/audit'],
    ['GET', '/api/v1/events'],
    ['GET', '/api/v1/capabilities'],
    ['GET', '/api/v1/devices'],
    ['GET', '/api/v1/services'],
    ['GET', '/api/v1/secrets'],
    ['GET', '/api/v1/system-check'],
    ['GET', '/api/v1/platform/controller/api/v1/events?limit=5'],
    ['GET', '/api/v1/platform/controller/api/v1/notifications'],
    ['GET', '/api/v1/platform/controller/api/v1/webhooks'],
    ['GET', '/api/v1/platform/controller/api/v1/ha'],
    ['GET', '/api/v1/platform/controller/api/v1/placement'],
    ['GET', '/api/v1/platform/controller/api/v1/ai/status'],
    ['GET', '/api/v1/platform/controller/api/v1/ai/providers'],
    ['POST', '/api/v1/vms/chrome-e2e-vm/shutdown'],
    ['POST', '/api/v1/vms/chrome-e2e-vm/start'],
  ];

  for (const [m, p, b] of paths) {
    if (p.endsWith('/start')) await new Promise((r) => setTimeout(r, 2000));
    log(`${m} ${p}`, await req(m, p, b));
    if (p.endsWith('/shutdown')) await new Promise((r) => setTimeout(r, 3000));
  }
  console.log('ROUND8_API_DONE');
})().catch((e) => {
  console.error('FATAL', e);
  process.exit(1);
});
