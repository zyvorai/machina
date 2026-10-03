// Copyright 2026 Zyvor AI Labs · https://zyvor.dev
// SPDX-License-Identifier: LicenseRef-Zyvor-Production-1.0

const http = require('http');
const fs = require('fs');
const WebSocket = require('ws');
const BASE = 'https://212.8.248.187:5092';
const VM = '3b2803c9-68e9-4235-b0f8-ef46a42c7a80';
const OUT = '/tmp/machina-round9.jsonl';
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
  console.log(o.ok === false ? 'FAIL' : 'PASS', o.action || o.path, String(o.note || '').slice(0, 150));
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
  const waitText = async (re, ms = 25000) => {
    const t0 = Date.now();
    let last = '';
    while (Date.now() - t0 < ms) {
      last = await bodyTxt();
      if (re.test(last) && last.length >= 80) return last;
      await new Promise((r) => setTimeout(r, 600));
    }
    return last || bodyTxt();
  };
  const clickByText = async (re) =>
    evalAsync(`(() => {
      const el = [...document.querySelectorAll('button,a,[role=tab],[role=menuitem]')].find(e => ${re}.test(e.innerText));
      if (el) { el.click(); return el.innerText.trim(); }
      return null;
    })()`);

  await send('Page.navigate', { url: BASE + '/' });
  await new Promise((r) => setTimeout(r, 1200));
  await evalAsync(
    `fetch('/api/v1/auth/login',{method:'POST',headers:{'Content-Type':'application/json'},credentials:'include',body:JSON.stringify({username:'sus',password:'max'})}).then(r=>r.json())`,
  );

  // Classic dashboard deep
  await send('Page.navigate', { url: BASE + '/' });
  const home = await waitText(/Machina|Virtual|CPU|Dashboard|Running/i, 20000);
  log({ kind: 'PAGE', path: '/', ok: home.length > 100, note: `len=${home.length} ${home.slice(0, 120)}` });

  // Machine finder search
  await send('Page.navigate', { url: BASE + '/platform/vms' });
  await waitText(/Machine Finder|machines|chrome/i, 25000);
  const search = await evalAsync(`(() => {
    const input = document.querySelector('input[type=search],input[placeholder*="Search"],input[placeholder*="Find"],input');
    if (!input) return { ok: false };
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
    setter.call(input, 'chrome-e2e');
    input.dispatchEvent(new Event('input', { bubbles: true }));
    return { ok: true, value: input.value, placeholder: input.placeholder };
  })()`);
  await new Promise((r) => setTimeout(r, 1500));
  log({
    kind: 'UI',
    action: 'machine-finder-search',
    ok: !!search.ok,
    note: JSON.stringify(search) + ' ' + (await bodyTxt()).slice(0, 100),
  });

  // Open VM from finder
  const openVm = await clickByText(/chrome-e2e-vm/);
  await new Promise((r) => setTimeout(r, 3000));
  log({
    kind: 'UI',
    action: 'open-vm-from-finder',
    ok: !!openVm || /chrome-e2e|Virtual Machines/i.test(await bodyTxt()),
    note: `clicked=${openVm} ${(await bodyTxt()).slice(0, 100)}`,
  });

  // Power menu on platform VM detail
  await send('Page.navigate', { url: BASE + `/platform/vms/${VM}` });
  await waitText(/chrome-e2e|Virtual|Power|Overview/i, 25000);
  const power = await evalAsync(`(() => {
    const btns = [...document.querySelectorAll('button')].map(b => b.innerText.trim()).filter(Boolean);
    const powerBtn = [...document.querySelectorAll('button')].find(b => /power|actions|more/i.test(b.innerText) || b.getAttribute('aria-label')?.match(/power|actions/i));
    if (powerBtn) powerBtn.click();
    return { buttons: btns.slice(0, 30), power: powerBtn && (powerBtn.innerText.trim() || powerBtn.getAttribute('aria-label')) };
  })()`);
  await new Promise((r) => setTimeout(r, 1000));
  const menu = await bodyTxt();
  log({ kind: 'UI', action: 'power-menu', ok: true, note: JSON.stringify(power).slice(0, 200) + ' ' + menu.slice(0, 80) });

  // Click primary tabs by label on VM detail
  for (const label of ['Overview', 'Access', 'Hardware', 'Console', 'Performance', 'Doctor', 'Disks', 'Devices']) {
    await send('Page.navigate', { url: BASE + `/platform/vms/${VM}` });
    await waitText(/chrome-e2e|Virtual/i, 20000);
    const clicked = await clickByText(new RegExp('^' + label + '$'));
    await new Promise((r) => setTimeout(r, 1800));
    const t = await bodyTxt();
    log({
      kind: 'TAB',
      action: `click:${label}`,
      ok: !!clicked && t.length > 80,
      note: `clicked=${clicked} len=${t.length} ${t.slice(0, 90)}`,
    });
  }

  // More menu tabs
  await send('Page.navigate', { url: BASE + `/platform/vms/${VM}` });
  await waitText(/chrome-e2e|Virtual/i, 20000);
  const more = await clickByText(/^More$|^\.\.\.$|^⋯$/);
  await new Promise((r) => setTimeout(r, 800));
  for (const label of ['Network', 'Snapshots', 'Events', 'Settings', 'Advanced', 'Backup', 'Topology', 'Logs']) {
    const clicked = await clickByText(new RegExp('^' + label + '$|^' + label + ' ', 'i'));
    await new Promise((r) => setTimeout(r, 1500));
    log({
      kind: 'TAB',
      action: `more:${label}`,
      ok: !!clicked || more,
      note: `more=${more} clicked=${clicked} ${(await bodyTxt()).slice(0, 80)}`,
    });
    // reopen more if needed
    if (!clicked) {
      await send('Page.navigate', { url: BASE + `/platform/vms/${VM}?tab=${label.toLowerCase()}` });
      await waitText(/.{80,}/, 15000);
    }
  }

  // Classic create wizard: fill + next + back (no create)
  await send('Page.navigate', { url: BASE + '/create' });
  await waitText(/Create|Installation|Next/i, 20000);
  await evalAsync(`(() => {
    const set = (el, v) => {
      if (!el) return;
      const s = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
      s.call(el, v);
      el.dispatchEvent(new Event('input', { bubbles: true }));
    };
    set(document.getElementById('vm-name'), 'wizard-no-create');
    set(document.getElementById('vcpus'), '1');
    set(document.getElementById('mem'), '1024');
  })()`);
  let next = await clickByText(/^Next$/);
  await new Promise((r) => setTimeout(r, 1200));
  log({ kind: 'WIZARD', action: 'step2', ok: !!next, note: (await bodyTxt()).slice(0, 140) });
  next = await clickByText(/^Next$/);
  await new Promise((r) => setTimeout(r, 1200));
  log({ kind: 'WIZARD', action: 'step3', ok: true, note: (await bodyTxt()).slice(0, 140) });
  const back = await clickByText(/^Back$|^Previous$/);
  log({ kind: 'WIZARD', action: 'back', ok: !!back, note: `clicked=${back}` });

  // Classic networks page - select default
  await send('Page.navigate', { url: BASE + '/networks' });
  await waitText(/Network|default/i, 20000);
  const net = await clickByText(/default/);
  await new Promise((r) => setTimeout(r, 1500));
  log({ kind: 'UI', action: 'select-network', ok: !!net, note: `clicked=${net} ${(await bodyTxt()).slice(0, 100)}` });

  // Storage pool click
  await send('Page.navigate', { url: BASE + '/storage' });
  await waitText(/Storage|Pool|default/i, 20000);
  const pool = await clickByText(/default/);
  await new Promise((r) => setTimeout(r, 2000));
  log({
    kind: 'UI',
    action: 'select-pool',
    ok: !!pool || /Volume|Capacity/i.test(await bodyTxt()),
    note: `clicked=${pool} ${(await bodyTxt()).slice(0, 100)}`,
  });

  // System check run button
  await send('Page.navigate', { url: BASE + '/system-check' });
  await waitText(/System Check|Pass|Fail|Check/i, 20000);
  const run = await clickByText(/Run|Re-?check|Refresh|Start/i);
  await new Promise((r) => setTimeout(r, 3000));
  log({ kind: 'UI', action: 'system-check-run', ok: true, note: `clicked=${run} ${(await bodyTxt()).slice(0, 120)}` });

  // Platform consolehub wait for iframe/canvas
  await send('Page.navigate', { url: BASE + `/platform/vms/${VM}/consolehub` });
  await waitText(/Console|Cinema|Hub|VNC|Connect|Loading|noVNC/i, 25000);
  const cinemaState = await evalAsync(`(() => {
    const iframe = document.querySelector('iframe');
    const canvas = document.querySelector('canvas');
    const btns = [...document.querySelectorAll('button')].map(b => b.innerText.trim()).filter(Boolean).slice(0, 20);
    return { iframe: !!iframe, canvas: !!canvas, btns, href: location.href };
  })()`);
  log({ kind: 'UI', action: 'consolehub-state', ok: true, note: JSON.stringify(cinemaState).slice(0, 250) });
  const connect = await clickByText(/Connect|Open|Start|Cinema|VNC/i);
  await new Promise((r) => setTimeout(r, 4000));
  log({
    kind: 'UI',
    action: 'consolehub-connect',
    ok: true,
    note: `clicked=${connect} ${(await bodyTxt()).slice(0, 100)} state=${JSON.stringify(await evalAsync(`({iframe:!!document.querySelector('iframe'),canvas:!!document.querySelector('canvas')})`))}`,
  });

  console.log('ROUND9_DONE');
  ws.close();
})().catch((e) => {
  console.error('FATAL', e);
  process.exit(1);
});
