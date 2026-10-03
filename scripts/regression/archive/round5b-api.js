// Copyright 2026 Zyvor AI Labs · https://zyvor.dev
// SPDX-License-Identifier: LicenseRef-Zyvor-Production-1.0

const https = require('https');
const fs = require('fs');
const OUT = '/tmp/machina-round5b-api.jsonl';
fs.writeFileSync(OUT, '');
const HOST = '212.8.248.187';
const PORT = 5092;
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
      { host: HOST, port: PORT, path, method, headers, rejectUnauthorized: false },
      (res) => {
        const set = res.headers['set-cookie'];
        if (set) {
          cookie = set.map((c) => c.split(';')[0]).join('; ');
        }
        let d = '';
        res.on('data', (c) => (d += c));
        res.on('end', () => resolve({ status: res.statusCode, body: d.slice(0, 400) }));
      },
    );
    r.on('error', reject);
    if (data) r.write(data);
    r.end();
  });
}

function log(api, r) {
  const ok = r.status < 400;
  const line = { api, ok, status: r.status, body: r.body.slice(0, 200) };
  fs.appendFileSync(OUT, JSON.stringify(line) + '\n');
  console.log(ok ? 'PASS' : 'FAIL', api, r.status, r.body.slice(0, 140).replace(/\n/g, ' '));
  return r;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  log('login', await req('POST', '/api/v1/auth/login', { username: 'sus', password: 'max' }));

  // Ensure stopped for linked clone
  log('stop vm', await req('POST', '/api/v1/vms/chrome-e2e-vm/stop'));
  await sleep(2500);
  let r = log(
    'clone linked',
    await req('POST', '/api/v1/vms/chrome-e2e-vm/clone', { new_name: 'chrome-e2e-clone', linked: true }),
  );
  if (r.status < 400) {
    await sleep(2000);
    log('get clone', await req('GET', '/api/v1/vms/chrome-e2e-clone'));
    log('start clone', await req('POST', '/api/v1/vms/chrome-e2e-clone/start'));
    await sleep(2000);
    log('stop clone', await req('POST', '/api/v1/vms/chrome-e2e-clone/stop'));
    await sleep(1000);
    log('delete clone', await req('DELETE', '/api/v1/vms/chrome-e2e-clone'));
  }
  log('start source', await req('POST', '/api/v1/vms/chrome-e2e-vm/start'));
  await sleep(2500);
  log('get source', await req('GET', '/api/v1/vms/chrome-e2e-vm'));

  for (const [m, p, b] of [
    ['GET', '/api/v1/health'],
    ['GET', '/api/v1/host'],
    ['GET', '/api/v1/vms'],
    ['GET', '/api/v1/storage/pools'],
    ['GET', '/api/v1/nwfilters'],
    ['GET', '/api/v1/networks'],
    ['GET', '/api/v1/platform/controller/api/v1/health'],
    ['GET', '/api/v1/platform/controller/api/v1/vms'],
    ['GET', '/api/v1/platform/controller/api/v1/hosts'],
    ['GET', '/api/v1/platform/controller/api/v1/tasks?limit=5'],
    ['POST', '/api/v1/vms/chrome-e2e-vm/pause'],
    ['POST', '/api/v1/vms/chrome-e2e-vm/resume'],
    ['GET', '/api/v1/vms/chrome-e2e-vm/guest/info'],
    ['GET', '/api/v1/vms/chrome-e2e-vm/interfaces'],
    ['GET', '/api/v1/vms/chrome-e2e-vm/disks'],
    ['GET', '/api/v1/vms/chrome-e2e-vm/xml'],
    ['GET', '/api/v1/vms/chrome-e2e-vm/metrics'],
    ['POST', '/api/v1/vms/chrome-e2e-vm/reboot'],
  ]) {
    if (m === 'POST' && p.endsWith('/pause')) {
      await sleep(500);
    }
    if (m === 'POST' && p.endsWith('/resume')) {
      await sleep(800);
    }
    log(`${m} ${p}`, await req(m, p, b));
  }

  console.log('API_ROUND_DONE');
})().catch((e) => {
  console.error('FATAL', e);
  process.exit(1);
});
