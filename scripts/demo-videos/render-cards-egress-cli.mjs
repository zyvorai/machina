#!/usr/bin/env node
// Copyright 2026 Zyvor AI Labs · https://zyvor.dev
// SPDX-License-Identifier: LicenseRef-Zyvor-Production-1.0

/** Title/outro cards for the machinactl + SSH + network egress demo reel. */
import { chromium } from 'playwright';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { mkdirSync } from 'node:fs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const outDir = join(__dirname, 'png-egress-cli');
mkdirSync(outDir, { recursive: true });

function titleHtml(kicker, line1, line2) {
  return `<!doctype html><html><head><meta charset="utf-8"><style>
  html,body{margin:0;padding:0;width:1920px;height:1080px;background:#070b14;
    background-image:radial-gradient(ellipse 60% 50% at 20% 0%, rgba(37,99,235,0.22), transparent 55%),
                      radial-gradient(ellipse 50% 45% at 85% 100%, rgba(56,189,248,0.14), transparent 55%);
    font-family:-apple-system,'SF Pro Text',Segoe UI,sans-serif;display:flex;align-items:center;justify-content:center;}
  .wrap{text-align:center;padding:0 200px;}
  .kicker{font-family:ui-monospace,'SF Mono',monospace;color:#38bdf8;letter-spacing:0.3em;font-size:24px;font-weight:700;margin-bottom:33px;text-transform:uppercase;}
  h1{color:#f4f7fc;font-size:60px;font-weight:800;letter-spacing:-0.02em;margin:0 0 27px;line-height:1.15;}
  p{color:#93a4bd;font-size:30px;font-weight:400;margin:0;line-height:1.5;max-width:1280px;}
  .rule{width:96px;height:5px;background:linear-gradient(90deg,#2563eb,#38bdf8);margin:39px auto 0;border-radius:5px;}
  </style></head><body>
  <div class="wrap">
    ${kicker ? `<div class="kicker">${kicker}</div>` : ''}
    <h1>${line1}</h1>
    ${line2 ? `<p>${line2}</p>` : ''}
    <div class="rule"></div>
  </div>
  </body></html>`;
}

const cards = [
  {
    file: 'ec00-title',
    kicker: 'MACHINA · SPRITES · CLI',
    line1: 'A Disposable VM, From the Terminal',
    line2: 'machinactl sprite create → real SSH → real internet, in one command',
  },
  {
    file: 'ec01-outro',
    kicker: '',
    line1: 'Create it. SSH into it. It reaches the internet. Delete it.',
    line2: 'zyvor.dev/machina',
  },
];

const browser = await chromium.launch({ channel: 'chrome' });
for (const t of cards) {
  const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
  await page.setContent(titleHtml(t.kicker, t.line1, t.line2));
  await page.screenshot({ path: `${outDir}/${t.file}.png` });
  await page.close();
  console.log('title:', t.file);
}
await browser.close();
