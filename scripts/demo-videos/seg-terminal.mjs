#!/usr/bin/env node
// Copyright 2026 Zyvor AI Labs · https://zyvor.dev
// SPDX-License-Identifier: LicenseRef-Zyvor-Production-1.0

/** Record any terminal-engine.js-based fake-terminal HTML page as video.
 * Usage: node seg-terminal.mjs <html-file> <raw-out-dir>
 */
import { chromium } from 'playwright';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const [, , htmlFile, outDir] = process.argv;
if (!htmlFile || !outDir) {
  console.error('Usage: node seg-terminal.mjs <html-file> <raw-out-dir>');
  process.exit(1);
}
const htmlPath = join(__dirname, htmlFile);

const browser = await chromium.launch({ channel: 'chrome' });
const context = await browser.newContext({
  viewport: { width: 1920, height: 1080 },
  recordVideo: { dir: outDir, size: { width: 1920, height: 1080 } },
});
const page = await context.newPage();
await page.goto(`file://${htmlPath}`, { waitUntil: 'load' });
await page.waitForFunction(() => window.__demoDone === true, { timeout: 90000 });
await page.close();
await context.close();
await browser.close();
console.log(`OK ${outDir}`);
