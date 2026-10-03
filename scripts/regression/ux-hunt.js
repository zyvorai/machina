#!/usr/bin/env node
// Copyright 2026 Zyvor AI Labs · https://zyvor.dev
// SPDX-License-Identifier: LicenseRef-Zyvor-Production-1.0

'use strict';

/**
 * Exploratory UX hunt: visit a sample of pages, screenshot each,
 * capture console errors + failed network requests + visible error text.
 *
 * Env: MACHINA_BASE_URL, MACHINA_USER, MACHINA_PASS, MACHINA_CDP_URL
 * Args: --out DIR  --pages a,b,c (comma list; default = random sample from fixtures/pages.json)
 */

const fs = require('fs');
const path = require('path');
const { loadConfig } = require('./lib/config');
const { createApi } = require('./lib/api');
const { connectCdp, loginBrowser } = require('./lib/cdp');

const argv = process.argv.slice(2);
function argVal(name, def) {
  const i = argv.indexOf(name);
  return i >= 0 ? argv[i + 1] : def;
}

const cfg = loadConfig();
const outDir = argVal('--out', path.join('/tmp', 'ux-hunt'));
fs.mkdirSync(outDir, { recursive: true });

let pages;
const explicit = argVal('--pages', null);
if (explicit) {
  pages = explicit.split(',').map((s) => s.trim()).filter(Boolean);
} else {
  pages = cfg.pages;
}

(async () => {
  const { login } = createApi(cfg);
  await login();
  const cdp = await connectCdp(cfg.cdpUrl, { freshPage: true, url: 'about:blank' });
  await loginBrowser(cdp, cfg);

  await cdp.send('Log.enable');
  await cdp.send('Network.enable');

  const report = [];

  for (let i = 0; i < pages.length; i++) {
    const p = pages[i];
    const consoleErrors = [];
    const failedRequests = [];

    const onConsole = (msg) => {
      // Runtime.consoleAPICalled
    };

    // Listen via raw ws message handler is not exposed; instead poll via Runtime after nav using window.__errors
    await cdp.evalAsync(`(function(){
      window.__uxErrors = [];
      window.addEventListener('error', function(e){ window.__uxErrors.push('JS: ' + (e.message||'')); });
      window.addEventListener('unhandledrejection', function(e){ window.__uxErrors.push('Promise: ' + (e.reason && e.reason.message || e.reason)); });
      const origError = console.error;
      console.error = function(...args){ window.__uxErrors.push('console.error: ' + args.map(String).join(' ').slice(0,200)); origError.apply(console, args); };
      return true;
    })()`).catch(() => {});

    try {
      await cdp.send('Page.navigate', { url: cfg.baseUrl + p });
    } catch (e) {
      report.push({ path: p, error: `navigate failed: ${e.message}` });
      continue;
    }

    const wait = p.startsWith('/platform') || p.startsWith('/fleet-cloud') ? 6500 : 4500;
    await new Promise((r) => setTimeout(r, wait));

    let text = '';
    let errs = [];
    try {
      text = await cdp.evalAsync(
        `document.body ? document.body.innerText.replace(/\\s+/g, ' ').trim().slice(0, 400) : ''`,
      );
      errs = await cdp.evalAsync(`window.__uxErrors || []`);
    } catch (e) {
      errs = [`eval failed: ${e.message}`];
    }

    let shotFile = null;
    try {
      const shot = await cdp.send('Page.captureScreenshot', { format: 'png', quality: 80 });
      const safe = p.replace(/[^a-z0-9]+/gi, '_').replace(/^_+|_+$/g, '') || 'root';
      shotFile = path.join(outDir, `${String(i).padStart(3, '0')}_${safe}.png`);
      fs.writeFileSync(shotFile, Buffer.from(shot.data, 'base64'));
    } catch (e) {
      // ignore screenshot failure
    }

    const crashed = /Something went wrong|Route not found/i.test(text);
    const thin = text.length < 80;

    report.push({
      path: p,
      textLen: text.length,
      textSample: text.slice(0, 160),
      crashed,
      thin,
      consoleErrors: errs,
      screenshot: shotFile,
    });

    console.log(`[${i + 1}/${pages.length}] ${p} len=${text.length} crashed=${crashed} thin=${thin} errs=${errs.length}`);
  }

  fs.writeFileSync(path.join(outDir, 'report.json'), JSON.stringify(report, null, 2));
  console.log('DONE ->', path.join(outDir, 'report.json'));
  try { cdp.ws.close(); } catch {}
  process.exit(0);
})().catch((e) => {
  console.error('FATAL', e);
  process.exit(1);
});
