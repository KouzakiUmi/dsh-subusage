// 离线真实组件浏览器回归：虚构40账户，不访问DSH/账号，拒绝所有HTTP。
// 先运行 node scripts/render-ui-preview.mjs 360 commandcode dark pill pool-many
import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { chromium } from 'playwright-core';
const browser = await chromium.launch({ channel: 'chrome', headless: true });
try {
  const context = await browser.newContext({ viewport: { width: 416, height: 1000 }, colorScheme: 'dark' });
  await context.route(/^https?:/, route => route.abort());
  const page = await context.newPage();
  await page.goto(pathToFileURL(resolve('debug/ui-preview/settings-360-commandcode-dark-pill-pool-many.html')).href);
  const toggle = page.locator('summary', { hasText: '点击查看详情' });
  const info = () => page.evaluate(() => {
    const summary = [...document.querySelectorAll('summary')].find(e => e.textContent.includes('点击查看详情'));
    const details = summary.parentElement, list = details.querySelector('div');
    return { open: details.open, height: list.clientHeight, scrollHeight: list.scrollHeight,
      overflow: document.documentElement.scrollWidth > innerWidth, text: document.body.innerText,
      count: list.querySelectorAll('button').length };
  });
  assert.equal((await info()).open, false);
  assert.ok(!(await info()).text.includes('示例账户 1'), '默认收起逐账户列表');
  await page.screenshot({ path: 'debug/ui-preview/pool-details-collapsed.png', fullPage: true });
  await toggle.click();
  const opened = await info();
  assert.equal(opened.open, true);
  assert.equal(opened.count, 40);
  assert.ok(opened.height <= 240 && opened.scrollHeight > opened.height, '展开后内部限高滚动');
  assert.equal(opened.overflow, false);
  assert.ok(opened.text.includes('每周额度已用尽') && opened.text.includes('每月额度已用尽'));
  await page.screenshot({ path: 'debug/ui-preview/pool-details-expanded.png', fullPage: true });
  await toggle.press('Enter');
  assert.equal((await info()).open, false, '键盘可再次收起');
  console.log('PASS 原生details默认折叠/点击展开/40账户限高滚动/窗口层级/无横向溢出/键盘收起');
  await context.close();
} finally { await browser.close(); }
