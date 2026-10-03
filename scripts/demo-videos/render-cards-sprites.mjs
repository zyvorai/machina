#!/usr/bin/env node
// Copyright 2026 Zyvor AI Labs · https://zyvor.dev
// SPDX-License-Identifier: LicenseRef-Zyvor-Production-1.0

/**
 * Title/caption cards for the Machina Sprites reel.
 */
import { chromium } from 'playwright';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { mkdirSync } from 'node:fs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const outDir = join(__dirname, 'png-sprites');
mkdirSync(outDir, { recursive: true });

function titleHtml(kicker, line1, line2) {
  return `<!doctype html><html><head><meta charset="utf-8"><style>
  html,body{margin:0;padding:0;width:1920px;height:1080px;background:#070b14;
    background-image:radial-gradient(ellipse 60% 50% at 20% 0%, rgba(37,99,235,0.22), transparent 55%),
                      radial-gradient(ellipse 50% 45% at 85% 100%, rgba(56,189,248,0.14), transparent 55%);
    font-family:-apple-system,'SF Pro Text',Segoe UI,sans-serif;display:flex;align-items:center;justify-content:center;}
  .wrap{text-align:center;padding:0 200px;}
  .kicker{font-family:ui-monospace,'SF Mono',monospace;color:#38bdf8;letter-spacing:0.3em;font-size:24px;font-weight:700;margin-bottom:33px;text-transform:uppercase;}
  h1{color:#f4f7fc;font-size:58px;font-weight:800;letter-spacing:-0.02em;margin:0 0 27px;line-height:1.15;}
  p{color:#93a4bd;font-size:28px;font-weight:400;margin:0;line-height:1.5;max-width:1280px;}
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

function captionHtml(text) {
  return `<!doctype html><html><head><meta charset="utf-8"><style>
  html,body{margin:0;padding:0;width:1920px;height:220px;background:transparent;
    font-family:-apple-system,'SF Pro Text',Segoe UI,sans-serif;display:flex;align-items:center;justify-content:center;}
  .bar{width:1770px;background:rgba(7,11,20,0.90);border:1px solid rgba(56,189,248,0.28);border-radius:21px;
    padding:27px 45px;display:flex;align-items:center;gap:21px;box-shadow:0 18px 45px rgba(0,0,0,0.45);}
  .dot{width:14px;height:14px;border-radius:50%;background:#38bdf8;flex:none;box-shadow:0 0 15px #38bdf8;}
  .text{color:#f1f5f9;font-size:28px;font-weight:500;line-height:1.4;}
  </style></head><body>
  <div class="bar"><div class="dot"></div><div class="text">${text}</div></div>
  </body></html>`;
}

const cards = [
  {
    file: 'sp00-title',
    kicker: 'MACHINA · SPRITES',
    line1: 'Instant, Disposable Sandbox VMs',
    line2: 'libvirt/QEMU or Cloud Hypervisor · TTL-reaped · no persistent state',
  },
  { file: 'sp01-empty', kicker: '', line1: 'Sprites: Nothing Running Yet' },
  { file: 'sp02-libvirt', kicker: '', line1: 'Boot a Sprite on Libvirt' },
  { file: 'sp03-chv', kicker: '', line1: 'Boot a Sprite on Cloud Hypervisor' },
  { file: 'sp04-list', kicker: '', line1: 'Both Backends, One List' },
  { file: 'sp05-delete', kicker: '', line1: 'Tear Down On Demand' },
  {
    file: 'sp06-outro',
    kicker: '',
    line1: 'Throwaway sandboxes for AI agents and CI — gone when the TTL hits.',
    line2: 'zyvor.dev/machina',
  },
];

const captions = [
  { file: 'cap-sp-empty', text: 'Sprites are instant, headless sandbox VMs — cloned from a golden image, not a full VM build.' },
  { file: 'cap-sp-libvirt', text: 'Pick a golden image, size it, set a TTL, and boot on the original libvirt/QEMU backend.' },
  { file: 'cap-sp-chv', text: 'Same request, new backend: Cloud Hypervisor boots as a direct child process — no libvirtd in the path. It materializes a full disk copy, so first boot takes longer than libvirt’s instant clone.' },
  { file: 'cap-sp-list', text: 'Backend, state, vsock CID, and a live expiry countdown — both hypervisors in one view.' },
  { file: 'cap-sp-delete', text: 'Delete tears it down immediately; a background reaper does the same automatically once the TTL passes.' },
];

const browser = await chromium.launch({ channel: 'chrome' });
for (const t of cards) {
  const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
  await page.setContent(titleHtml(t.kicker, t.line1, t.line2));
  await page.screenshot({ path: `${outDir}/${t.file}.png` });
  await page.close();
  console.log('title:', t.file);
}
for (const c of captions) {
  const page = await browser.newPage({ viewport: { width: 1920, height: 220 } });
  await page.setContent(captionHtml(c.text));
  await page.screenshot({ path: `${outDir}/${c.file}.png`, omitBackground: true });
  await page.close();
  console.log('caption:', c.file);
}
await browser.close();
