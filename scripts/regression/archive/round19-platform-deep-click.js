// Copyright 2026 Zyvor AI Labs · https://zyvor.dev
// SPDX-License-Identifier: LicenseRef-Zyvor-Production-1.0

const http = require('http');
const fs = require('fs');
const WebSocket = require('ws');
const BASE = 'https://212.8.248.187:5092';
const OUT = '/tmp/machina-round19.jsonl';
fs.writeFileSync(OUT, '');

// Settings hub + integrations subsections + firewall pages interactive
const PAGES = [
  ['/platform/settings', /Settings|Cluster|Identity|Appearance|General/i],
  ['/platform/integrations', /Integration|Apps|Slack|Webhook|Kubernetes|OpenStack/i],
  ['/platform/enterprise', /Enterprise|Feature|License|Security/i],
  ['/platform/developer', /Developer|SDK|API|Hub/i],
  ['/platform/support', /Support|Help|Docs|Assistant/i],
  ['/platform/marketplace', /Marketplace|Catalog|App/i],
  ['/platform/ai-providers', /AI|Provider|LLM|OpenAI|Ollama|Anthropic/i],
  ['/platform/zeus/security/firewall', /Firewall|Target|Rule|Overview/i],
  ['/platform/zeus/security/hunt', /Threat|Hunt|Query|IOC/i],
  ['/platform/zeus/security/compliance', /Compliance|CIS|Score|Benchmark/i],
  ['/platform/network-canvas', /Network|Canvas|topology|node/i],
  ['/platform/topology', /Topology|Graph|Host|VM/i],
  ['/platform/activity', /Activity|Monitor|CPU|Process/i],
  ['/platform/observability', /Observability|Metric|Trace|OTLP/i],
  ['/platform/gpu', /GPU|MIG|vGPU|Command/i],
  ['/platform/ha', /High Availability|HA|Failover/i],
  ['/platform/placement', /Disaster|Recovery|Placement|DRS/i],
  ['/platform/migration', /Migration|Import|Assistant|vSphere/i],
  ['/platform/blueprints', /Blueprint|spec|Git/i],
  ['/platform/content', /Image|ISO|Content|Upload/i],
];

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
  const waitFor = async (pred, ms = 22000) => {
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

  let pass = 0,
    fail = 0;
  for (const [path, re] of PAGES) {
    await send('Page.navigate', { url: BASE + path });
    const t = await waitFor((x) => re.test(x) && x.length >= 150, 22000);
    const ok = re.test(t) && t.length >= 150 && !/Something went wrong|Route not found/i.test(t);
    if (ok) pass++;
    else fail++;
    log({ kind: 'PAGE', path, ok, note: `len=${t.length} ${t.slice(0, 90)}` });

    // click first interesting button on page
    const btn = await evalAsync(`(() => {
      const b = [...document.querySelectorAll('button')].find(e => {
        const t = e.innerText.trim();
        return t && t.length < 40 && !/Machina|Go|View|Window|Help|Healthy|Control|Log out/i.test(t);
      });
      if (b) { b.click(); return b.innerText.trim(); }
      return null;
    })()`);
    if (btn) {
      await new Promise((r) => setTimeout(r, 1200));
      log({ kind: 'UI', action: `${path}::${btn}`, ok: true, note: (await bodyTxt()).slice(0, 80) });
    }
  }

  console.log(`ROUND19_DONE pass=${pass} fail=${fail}`);
  ws.close();
})().catch((e) => {
  console.error('FATAL', e);
  process.exit(1);
});
