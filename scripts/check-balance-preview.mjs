// 真实组件离线余额画廊验收：虚构金额、新浏览器上下文、禁止 HTTP，不连接 DSH。
import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { chromium } from 'playwright-core';
const browser = await chromium.launch({ channel: 'chrome', headless: true });
try {
  for (const theme of ['dark', 'light']) {
    const context = await browser.newContext({ viewport: { width: 586, height: 940 }, colorScheme: theme });
    await context.route(/^https?:/, route => route.abort());
    const page = await context.newPage();
    await page.goto(pathToFileURL(resolve(`debug/ui-preview/settings-530-deepseek-${theme}-pill-balance-gallery.html`)).href);
    assert.equal(await page.evaluate(() => CSS.supports('color', 'color-mix(in srgb, red 65%, currentColor)')), true);
    for (const [id, text, warning] of [
      ['account', '¥50', ''], ['api-low', '¥0.50', '#ef4444'], ['cny-warn', '¥3.00', '#eab308'],
      ['usd-low', '$0.10', '#ef4444'], ['usd-warn', '$0.50', '#eab308'], ['credits', '0.1 credits', ''],
      ['credits-zero', '0 credits', '#ef4444'], ['mimo-balance', '¥0.50', '#ef4444']
    ]) {
      const button = page.locator(`[data-balance-case="${id}"] button`);
      assert.equal((await button.textContent()).trim().replace(/^[✓!ℹ]\s*/, ''), text, `${theme}/${id}: bounded amount and unit`);
      const glyph = button.locator('[aria-hidden="true"]');
      assert.ok((await glyph.textContent()).trim(), `${theme}/${id}: visible status icon`);
      if (id === 'account') assert.ok((await glyph.getAttribute('style')).includes('#22c55e'), `${theme}: healthy money uses green glyph`);
      const style = await button.evaluate(el => ({ color: el.style.color, label: el.getAttribute('aria-label') }));
      if (warning) {
        // 浏览器会把十六进制规范化成 rgb()；检查预警色通道而非序列化形式。
        const expected = warning === '#ef4444' ? '239, 68, 68' : '234, 179, 8';
        assert.ok(style.color.includes(expected), `${theme}/${id}: warning text follows balance tier`);
        assert.ok(style.label.includes('余额偏低'), `${theme}/${id}: warning is accessible without color`);
      } else assert.equal(style.color, 'inherit', `${theme}/${id}: neutral amount uses readable theme text`);
    }
    assert.ok(!(await page.locator('[data-balance-case="mimo-plan"] button').textContent()).includes('-1.19'), 'active plan pill does not turn into negative wallet');
    assert.ok((await page.locator('[data-balance-case="mimo-full"] button').textContent()).includes('已用尽'), 'exhausted plan remains explicit');
    assert.ok((await page.locator('[data-balance-case="mimo-unknown"] button').textContent()).includes('数据不完整'), 'query failure is not no subscription');
    const viewport = await page.evaluate(() => ({ width: document.documentElement.scrollWidth, view: innerWidth }));
    assert.ok(viewport.width <= viewport.view, `${theme}: no horizontal overflow`);
    await page.screenshot({ path: resolve(`debug/ui-preview/balance-pills-${theme}.png`), fullPage: true });
    await page.goto(pathToFileURL(resolve(`debug/ui-preview/settings-530-deepseek-account-${theme}-balance-precision.html`)).href);
    const panel = page.locator('#subusage-provider-panel');
    assert.ok((await panel.textContent()).includes('余额 50 CNY'), `${theme}: settings banner limits decimal precision`);
    assert.ok(!(await panel.textContent()).includes('49.99890398'), `${theme}: details also limit precision`);
    assert.ok((await panel.locator('[role="status"] [aria-hidden="true"]').getAttribute('style')).includes('#22c55e'), `${theme}: settings banner has visible green glyph`);
    await page.screenshot({ path: resolve(`debug/ui-preview/balance-settings-${theme}.png`), fullPage: true });
    await context.close();
    console.log(`PASS ${theme}: 11 real-component cases, exact amounts, tier colors, plan priority and no overflow`);
  }
} finally { await browser.close(); }
