#!/usr/bin/env node
// Copyright 2026 Zyvor AI Labs · https://zyvor.dev
// SPDX-License-Identifier: LicenseRef-Zyvor-Production-1.0

/** Title/outro cards for all 5 Firecracker-launch demo videos. */
import { chromium } from 'playwright';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { mkdirSync } from 'node:fs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const outDir = join(__dirname, 'png-firecracker');
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
  // Video 1: Firecracker CLI demo
  {
    file: 'fc-cli-title',
    kicker: 'MACHINA · SPRITES · FIRECRACKER',
    line1: 'A Third Way to Boot a Sandbox',
    line2: 'machinactl sprite create --backend firecracker → real SSH → real internet',
  },
  {
    file: 'fc-cli-outro',
    kicker: '',
    line1: 'Same API. Same TTL reaper. A new VMM underneath.',
    line2: 'zyvor.dev/machina',
  },
  // Video 2: three backends concurrent
  {
    file: 'three-title',
    kicker: 'MACHINA · SPRITES',
    line1: 'Three VMMs, One API',
    line2: 'libvirt, Cloud Hypervisor, and Firecracker sprites — running concurrently, zero CID collisions',
  },
  {
    file: 'three-outro',
    kicker: '',
    line1: 'One shared allocator. Three completely different hypervisors.',
    line2: 'zyvor.dev/machina',
  },
  // Video 3: the boot bug
  {
    file: 'bug-title',
    kicker: 'MACHINA · ENGINEERING',
    line1: 'A Kernel Panic, Live',
    line2: 'Firecracker silently overrides root= — found by actually booting one, not by assuming',
  },
  {
    file: 'bug-outro',
    kicker: '',
    line1: 'Verify live. Especially the part you’re sure about.',
    line2: 'zyvor.dev/machina',
  },
  // Video 4: guestkit install-packages
  {
    file: 'gk-title',
    kicker: 'GUESTKIT · OFFLINE PACKAGE INSTALL',
    line1: 'Bake It Into the Image',
    line2: 'guestkit rescue -o install-packages — chroot, no libguestfs appliance, no live post-boot fixups',
  },
  {
    file: 'gk-outro',
    kicker: '',
    line1: 'Every sprite booted from this image has it. Not just the one you patched.',
    line2: 'zyvor.dev/guestkit',
  },
  // Video 5: web dashboard tour
  {
    file: 'ui-title',
    kicker: 'MACHINA · SPRITES · WEB UI',
    line1: 'Pick a Backend, Click Create',
    line2: 'The same three-way choice, live in the dashboard',
  },
  {
    file: 'ui-outro',
    kicker: '',
    line1: 'CLI, API, or UI — every sprite backend, everywhere.',
    line2: 'zyvor.dev/machina',
  },
];

const browser = await chromium.launch({ channel: 'chrome' });
for (const t of cards) {
  const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
  await page.setContent(titleHtml(t.kicker, t.line1, t.line2));
  await page.screenshot({ path: `${outDir}/${t.file}.png` });
  await page.close();
  console.log('card:', t.file);
}
await browser.close();
