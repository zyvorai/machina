// Copyright 2026 Zyvor AI Labs · https://zyvor.dev
// SPDX-License-Identifier: LicenseRef-Zyvor-Production-1.0

const http = require('http');
const fs = require('fs');
const WebSocket = require('ws');
const BASE = 'https://212.8.248.187:5092';
const HOST = '98e60da1-5656-404c-87e9-207ae19ebd86';
const VM = '3b2803c9-68e9-4235-b0f8-ef46a42c7a80';
const OUT = '/tmp/machina-round7.jsonl';
const SUMMARY = '/tmp/machina-round7-summary.txt';
fs.writeFileSync(OUT, '');
fs.writeFileSync(SUMMARY, '');

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
  const status = o.ok === false ? 'FAIL' : o.soft ? 'SOFT' : 'PASS';
  const line = `${status} ${o.path || o.action} | ${String(o.note || '').slice(0, 130)}`;
  fs.appendFileSync(SUMMARY, line + '\n');
  console.log(line);
}

const PAGES = [
  ['/platform/hosts/finder', /Machine Finder|finder|host|VM|chrome/i],
  [`/platform/hosts/${HOST}`, /Host|localhost|online|Sync|agent|CPU|Memory/i],
  [`/platform/vms/${VM}/consolehub`, /Console|Cinema|VNC|Hub|Connect|Loading|noVNC/i],
  [`/platform/vms/${VM}/console`, /Console|Redirect|Cinema|VNC|Loading|Connect/i],
  ['/platform/mission-control/live', /Live|Wall|Mission|stream|event/i],
  ['/platform/alert-rules', /Alert|Rule|Notification|threshold/i],
  ['/platform/scheduled-jobs', /Schedule|Job|Cron|Task/i],
  ['/platform/infrastructure', /Infrastructure|Hub|Storage|Network|Host/i],
  ['/platform/workloads', /Workload|VM|Application|Hub/i],
  ['/platform/administration', /Administration|Users|Settings|Hub/i],
  ['/platform/resources', /Resource|Infrastructure|Storage|Network/i],
  ['/platform/operations', /Operations|Task|Migration|Hub/i],
  ['/platform/zeus/security', /Security|Center|Threat|Firewall|Zeus/i],
  ['/platform/zeus/security/hunt', /Threat|Hunt|Query|IOC|Security/i],
  ['/platform/zeus/security/enforcement', /Enforcement|Runtime|Policy|Guard/i],
  ['/platform/zeus/security/firewall', /Firewall|Overview|Target|Rule/i],
  ['/platform/zeus/security/ports', /Port|Control|Listen|Expose/i],
  ['/platform/zeus/security/services', /Service|Guard|systemd|Allow/i],
  ['/platform/zeus/security/activity', /Activity|Security|Event|Log/i],
  ['/platform/zeus/security/compliance', /Compliance|CIS|Benchmark|Score/i],
  ['/platform/zeus/security/k8s', /Kubernetes|Security|NetworkPolicy|Pod/i],
  ['/platform/zeus/security/cloud', /Cloud|Security|OpenStack|IAM/i],
  ['/platform/zeus/security/connectivity', /Connectivity|Path|Probe|Reach/i],
  ['/platform/zeus/security/policies', /Policy|Rule|Allow|Deny/i],
  ['/vms/chrome-e2e-vm/console', /Console|Redirect|Cinema|VNC|Loading|Connect/i],
  ['/vms/chrome-e2e-vm/consolehub', /Console|Cinema|Hub|VNC|Connect|Loading/i],
  ['/mission-control', /Mission|Control|Dashboard|fleet/i],
  ['/ssh', /SSH|Host|Connect|terminal|session/i],
  // Settings sections via query if supported
  ['/platform/settings?section=identity', /Settings|Identity|User|Auth|OIDC|LDAP/i],
  ['/platform/settings?section=appearance', /Settings|Appearance|Theme|Density|Glass/i],
  ['/platform/settings?section=cluster', /Settings|Cluster|Controller|HA/i],
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
  await send('Network.enable');
  await send('Page.enable');
  await send('Runtime.enable');
  await send('Security.setIgnoreCertificateErrors', { ignore: true });

  const evalAsync = async (expression) => {
    const r = await send('Runtime.evaluate', {
      awaitPromise: true,
      returnByValue: true,
      expression,
    });
    if (r.exceptionDetails) {
      throw new Error(
        (r.exceptionDetails.exception && r.exceptionDetails.exception.description) ||
          r.exceptionDetails.text ||
          JSON.stringify(r.exceptionDetails),
      );
    }
    return r.result.value;
  };

  const bodyTxt = async () =>
    evalAsync(`document.body ? document.body.innerText.replace(/\\s+/g, ' ').trim() : ''`);

  const waitText = async (re, ms = 28000) => {
    const t0 = Date.now();
    let last = '';
    while (Date.now() - t0 < ms) {
      last = await bodyTxt();
      if (re.test(last) && last.length >= 100) return last;
      await new Promise((r) => setTimeout(r, 700));
    }
    return last || bodyTxt();
  };

  await send('Page.navigate', { url: BASE + '/' });
  await new Promise((r) => setTimeout(r, 1200));
  await evalAsync(
    `fetch('/api/v1/auth/login',{method:'POST',headers:{'Content-Type':'application/json'},credentials:'include',body:JSON.stringify({username:'sus',password:'max'})}).then(r=>r.json())`,
  );

  let pass = 0,
    soft = 0,
    fail = 0;
  for (const [path, re] of PAGES) {
    try {
      await send('Page.navigate', { url: BASE + path });
      const t = await waitText(re, path.includes('console') ? 20000 : 28000);
      const crashed = /Something went wrong|Route not found|page not found/i.test(t);
      const matched = re.test(t);
      const short = t.length < 100;
      let status = 'PASS';
      let ok = true;
      let isSoft = false;
      if (crashed) {
        status = 'FAIL';
        ok = false;
        fail++;
      } else if (!matched || short) {
        status = 'SOFT';
        isSoft = true;
        soft++;
      } else {
        pass++;
      }
      log({
        kind: 'PAGE',
        path,
        ok,
        soft: isSoft,
        note: `${status} len=${t.length} ${t.slice(0, 100)}`,
      });
    } catch (e) {
      fail++;
      log({ kind: 'PAGE', path, ok: false, note: `FAIL ${e.message}` });
    }
  }

  // Host detail actions
  await send('Page.navigate', { url: BASE + `/platform/hosts/${HOST}` });
  await waitText(/Host|localhost|online/i, 25000);
  const hostActions = await evalAsync(`(() => {
    const texts = [...document.querySelectorAll('button')].map(b => b.innerText.trim()).filter(Boolean);
    const sync = [...document.querySelectorAll('button')].find(b => /sync|refresh|inventory/i.test(b.innerText));
    if (sync) sync.click();
    return { sync: sync && sync.innerText.trim(), buttons: texts.slice(0, 25) };
  })()`);
  log({ kind: 'UI', action: 'host-detail-actions', ok: true, note: JSON.stringify(hostActions).slice(0, 280) });
  await new Promise((r) => setTimeout(r, 2500));

  // Zeus ask via command palette placeholder
  await send('Page.navigate', { url: BASE + '/platform/zeus' });
  await waitText(/Zeus|AI|Dashboard/i, 25000);
  const zeusAsk = await evalAsync(`(() => {
    const input = document.querySelector('[placeholder*="Ask Zeus"],[placeholder*="search fleet"],input,textarea');
    if (!input) return { ok: false };
    const proto = input.tagName === 'TEXTAREA' ? window.HTMLTextAreaElement.prototype : window.HTMLInputElement.prototype;
    const setter = Object.getOwnPropertyDescriptor(proto, 'value').set;
    setter.call(input, 'how many VMs are running?');
    input.dispatchEvent(new Event('input', { bubbles: true }));
    return { ok: true, tag: input.tagName, value: input.value };
  })()`);
  log({ kind: 'UI', action: 'zeus-type', ok: !!zeusAsk.ok, note: JSON.stringify(zeusAsk) });

  console.log(`ROUND7_DONE pass=${pass} soft=${soft} fail=${fail}`);
  fs.appendFileSync(SUMMARY, `\nTOTAL pass=${pass} soft=${soft} fail=${fail}\n`);
  ws.close();
})().catch((e) => {
  console.error('FATAL', e);
  process.exit(1);
});
