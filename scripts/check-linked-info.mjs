// 离线浏览器验收：本次实读余额的脱敏回放，使用真实 Client 组件；不访问 DSH/提供方接口。
import assert from 'node:assert/strict';
import { mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';
import { api, html, renderPill } from '../tests/test-client-ofm.mjs';
import { READBACK_ENTRIES } from '../tests/test-linked-info.mjs';

const cards = await Promise.all(READBACK_ENTRIES.map(async entry => `<section><h2>${entry.label}</h2>${html(await renderPill(entry))}</section>`));
const out = new URL('../debug/linked-info/', import.meta.url);
mkdirSync(out, { recursive: true });
const browser = await chromium.launch({ channel: 'chrome', headless: true });
try {
 for (const width of [320, 1200]) for (const theme of ['dark', 'light']) {
  const page = await browser.newPage({ viewport: { width, height: 760 }, colorScheme: theme });
  await page.route(/^https?:/, route => route.abort());
  await page.setContent(`<!doctype html><html data-dsh-go-island data-dsh-go-island-form="panel"><head><meta charset="utf-8"><style>
   html{color-scheme:${theme}}body{margin:0;background:${theme === 'dark' ? '#202124' : '#f6f7f9'};font:14px/1.5 sans-serif;color:${theme === 'dark' ? '#ededed' : '#202124'}}
   header{padding:18px 16px 8px}h1{font-size:18px;margin:0}p{margin:4px 0;font-size:12px;opacity:.7}main{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,340px),1fr));gap:18px;padding:12px 16px 24px}section{min-width:0}h2{font-size:14px;margin:0 0 8px}
   ${api.PILL_ISLAND_CSS}
  </style></head><body><header><h1>联动额度 · 实读数值回放</h1><p>账号名已脱敏；2026-11-04 工具读数；使用真实 Client 组件离线渲染</p></header><main>${cards.join('')}</main></body></html>`);
  const geometry = await page.evaluate(() => ({ viewport: innerWidth, documentWidth: document.documentElement.scrollWidth, dialogs: [...document.querySelectorAll('[role="dialog"]')].map(el => { const r = el.getBoundingClientRect(); return { left: r.left, right: r.right, width: el.scrollWidth, client: el.clientWidth }; }) }));
  assert(geometry.documentWidth <= width + 1, `${width}/${theme} 页面横向溢出`);
  for (const rect of geometry.dialogs) assert(rect.left >= 0 && rect.right <= width + 1 && rect.width <= rect.client + 1, JSON.stringify({ width, theme, rect }));
  assert.equal(await page.locator('[role="dialog"]').count(), 5);
  for (const value of ['总 44473 积分', '总 1892.94 credits', '总 13254 积分', '100 credits', '2644 credits', '24473 积分', '20000 积分', '572.84 credits', '1320.1 credits', '6354 积分', '6900 积分']) assert((await page.locator('body').innerText()).includes(value), `缺少合计或账号余额 ${value}`);
  await page.screenshot({ path: fileURLToPath(new URL(`${width}-${theme}.png`, out)), fullPage: true });
  await page.close();
  console.log(`PASS 实读数值回放 ${width}px/${theme}：5 个渠道金额可见、账号独立、无横向溢出`);
 }
} finally { await browser.close(); }
