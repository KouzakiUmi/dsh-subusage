// 独立 Chrome 无头验收：仅本地虚构页面/Cookie，不连接 DSH 或真实 MiMo。
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { chromium } from 'playwright-core';
import { extractMimoCookie, MIMO_API_URLS } from '../lib/mimo-login.js';

const browser = await chromium.launch({ channel: 'chrome', headless: true });
try {
  const isolated = await browser.newContext();
  await isolated.addCookies([
    { name: 'api-platform_serviceToken', value: 'dummy-login-token', domain: 'platform.xiaomimimo.com', path: '/api/v1', httpOnly: true, secure: true },
    { name: 'userId', value: '42', domain: 'platform.xiaomimimo.com', path: '/api/v1', httpOnly: true, secure: true },
    { name: 'userId', value: 'wrong-path', domain: 'platform.xiaomimimo.com', path: '/unrelated', secure: true },
    { name: 'api-platform_serviceToken', value: 'foreign', domain: 'example.com', path: '/', secure: true }
  ]);
  const cookies = await isolated.cookies(MIMO_API_URLS);
  assert.equal(cookies.length, 2);
  assert.ok(cookies.every(cookie => cookie.httpOnly));
  assert.equal(extractMimoCookie(cookies), 'api-platform_serviceToken=dummy-login-token; userId=42');
  await isolated.close();
  console.log(`PASS 独立 Chrome ${browser.version()} 启动与 HttpOnly/域/路径 Cookie 获取（全虚构）`);

  for (const theme of ['dark', 'light']) for (const width of [530, 500, 499, 360]) {
    const file = resolve(`debug/ui-preview/settings-${width}-xiaomi-token-plan-cn-${theme}-credentials.html`);
    assert.ok(existsSync(file), `先生成预览：node scripts/render-ui-preview.mjs ${width} xiaomi-token-plan-cn ${theme} credentials`);
    const context = await browser.newContext({ viewport: { width: width + (width >= 400 ? 248 : 56), height: 1000 }, colorScheme: theme });
    await context.route(/^https?:/, route => route.abort());
    const page = await context.newPage();
    await page.goto(pathToFileURL(file).href);
    const info = await page.evaluate(() => {
      const select = document.querySelector('.subusage-provider-select');
      const tabs = document.querySelector('.subusage-provider-tabs');
      const tabRects = [...tabs.children].map(el => el.getBoundingClientRect());
      return {
        overflow: document.documentElement.scrollWidth > innerWidth,
        nativeVisible: getComputedStyle(select).display !== 'none', selectedProvider: select.value, providerCount: select.options.length,
        tabsVisible: getComputedStyle(tabs).display !== 'none',
        tabY: tabRects.map(rect => rect.y), tabWidth: tabRects.map(rect => rect.width),
        options: [...document.querySelectorAll('option')].map(el => ({ color: getComputedStyle(el).color, background: getComputedStyle(el).backgroundColor })),
        credentialSelects: document.querySelector('fieldset').querySelectorAll('select').length
      };
    });
    assert.equal(info.overflow, false, `${theme}/${width} 不得横向溢出`);
    assert.equal(info.providerCount, 5, '五家 provider 均可选择');
    assert.equal(info.nativeVisible, width <= 499);
    assert.equal(info.selectedProvider, 'xiaomi-token-plan-cn', '离线选择框必须匹配当前详情');
    assert.equal(info.tabsVisible, width > 499);
    if (width > 499) {
      assert.equal(info.tabWidth.length, 5, '五个 provider 必须全部展示');
      assert.equal(new Set(info.tabY).size, 1, '五个 provider 必须单行');
      assert.ok(Math.max(...info.tabWidth) - Math.min(...info.tabWidth) < 1, '五个 provider 必须等宽');
    }
    assert.equal(info.credentialSelects, 0, 'MiMo 凭据不使用下拉动作');
    for (const option of info.options) {
      const channel = value => value.match(/[\d.]+/g).slice(0, 3).map(Number).map(n => { const v = n / 255; return v <= .04045 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4; });
      const luminance = value => channel(value).reduce((sum, n, i) => sum + n * [.2126, .7152, .0722][i], 0);
      const a = luminance(option.color), b = luminance(option.background);
      assert.ok((Math.max(a, b) + .05) / (Math.min(a, b) + .05) >= 4.5, 'native option 文本对比度必须足够');
    }
    await page.screenshot({ path: file.replace(/\.html$/, '.png'), fullPage: true });
    await context.close();
    console.log(`PASS ${theme}/${width} 五列或窄选择框、凭据按钮、option 对比度、无溢出`);
  }
} finally { await browser.close(); }
