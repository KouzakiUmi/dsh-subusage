// 离线浏览器布局验收；读取兄弟 dsh-Go 的网页岛 CSS，不连接 DSH 或任何账号。
import assert from 'node:assert/strict';
import { readFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';
import { api, html, renderPill } from '../tests/test-client-ofm.mjs';

const islandCss = readFileSync(new URL('../../dsh-Go/app/assets/islands/island.css', import.meta.url), 'utf8');
const markup = html(await renderPill());
mkdirSync(new URL('../debug/ofm-mobile/', import.meta.url), { recursive: true });
const browser = await chromium.launch({ channel: 'chrome', headless: true });
try {
 for (const width of [320, 360, 430]) for (const theme of ['dark', 'light']) {
  const context = await browser.newContext({ viewport: { width, height: 260 }, colorScheme: theme });
  await context.route(/^https?:/, route => route.abort());
  const page = await context.newPage();
  await page.setContent(`<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><style>html{color-scheme:${theme}}body{margin:0;font:14px sans-serif}main{padding:12px}${islandCss}\n${api.PILL_ISLAND_CSS}</style></head><body><main data-dsh-go-island="frame">${markup}</main></body></html>`);
  // 岛标记晚于 React 挂载也应自动生效，无需重新挂载药丸。
  assert((await page.locator('[role="dialog"]').boundingBox()).y < 0, '未启用网页岛时复现原本向上越界的定位');
  await page.evaluate(() => { document.documentElement.setAttribute('data-dsh-go-island', ''); document.documentElement.setAttribute('data-dsh-go-island-form', 'panel'); });
  const geometry = await page.evaluate(() => {
   const frame = document.querySelector('main'), dialog = document.querySelector('[role="dialog"]'), button = document.querySelector('[aria-haspopup="dialog"]');
   const r = dialog.getBoundingClientRect(), b = button.getBoundingClientRect();
   return { position: getComputedStyle(dialog).position, top: r.top, left: r.left, right: r.right, buttonBottom: b.bottom, overflow: frame.scrollWidth > frame.clientWidth, scrollHeight: frame.scrollHeight, viewportHeight: innerHeight };
  });
  assert.equal(geometry.position, 'static');
  assert(geometry.top >= geometry.buttonBottom + 5 && geometry.left >= 0 && geometry.right <= width + 1, JSON.stringify(geometry));
  assert.equal(geometry.overflow, false, '窄屏不得横向溢出');
  assert(geometry.scrollHeight > geometry.viewportHeight, '展开内容进入网页岛可测量的滚动高度');
  const refresh = page.getByRole('button', { name: '立即刷新', exact: true });
  await refresh.scrollIntoViewIfNeeded();
  const r = await refresh.boundingBox(); assert(r.y >= 0 && r.y + r.height <= 260, '底部刷新可滚动到可见区域');
  await page.setViewportSize({ width, height: 160 });
  await refresh.scrollIntoViewIfNeeded();
  const keyboard = await refresh.boundingBox(); assert(keyboard.y >= 0 && keyboard.y + keyboard.height <= 160, '键盘缩小视口后底部按钮仍可到达');
  await page.setViewportSize({ width, height: 500 });
  await page.locator('main').evaluate(element => { element.scrollTop = 0; });
  await page.screenshot({ path: fileURLToPath(new URL(`../debug/ofm-mobile/${width}-${theme}.png`, import.meta.url)) });
  await context.close();
  console.log(`PASS DSH Go 网页岛 ${width}px/${theme}：晚注入、向下展开、无横溢出、滚动及键盘视口`);
 }
 const page = await browser.newPage({ viewport: { width: 1024, height: 700 } });
 await page.setContent(`<style>${api.PILL_ISLAND_CSS}</style><div style="position:fixed;bottom:20px;right:20px">${markup}</div>`);
 assert.equal(await page.locator('[role="dialog"]').evaluate(el => getComputedStyle(el).position), 'absolute', '桌面保持原来的弹层定位');
 await page.close();
} finally { await browser.close(); }
