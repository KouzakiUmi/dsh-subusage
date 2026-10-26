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
      const tabs = document.querySelector('.subusage-provider-tabs');
      return {
        overflow: document.documentElement.scrollWidth > innerWidth,
        overflowNodes: [...document.querySelectorAll('main, article, details, fieldset, div, button')].filter(el => el.getBoundingClientRect().right > innerWidth + 1).slice(0, 12).map(el => ({ tag: el.tagName, id: el.id, width: el.getBoundingClientRect().width, right: el.getBoundingClientRect().right, text: el.textContent.slice(0, 50) })),
        providerCount: tabs.children.length,
        tabsVisible: getComputedStyle(tabs).display !== 'none',
        selectedProvider: tabs.querySelector('[aria-selected="true"]')?.id,
        tabWidths: [...tabs.children].map(el => el.getBoundingClientRect().width),
        selectCount: document.querySelectorAll('select, option').length,
        switches: [...document.querySelectorAll('[role="switch"]')].map(el => ({ state: el.getAttribute('aria-checked'), label: el.getAttribute('aria-label') }))
      };
    });
    assert.equal(info.overflow, false, `${theme}/${width} 不得横向溢出：${JSON.stringify(info.overflowNodes)}`);
    // 预览桩下可见 11 条 = 桩里显式开启的 8 条（zai/kimi/mimo/opencode/commandcode/minimax/minimax-cn/xai-oauth）
    // + 默认开启的 deepseek 与 deepseek-account + Ark 的代表标签 1 条（DeepSeek 两入口与 Ark 均不在桩的
    // visibility.providers 里，按默认开关放行；余额型不按路由收起，Ark 在订阅状态未知时只显示组代表，
    // configured=false 也不影响）。openai-codex 与其余默认关闭各家（共 16 家）不可见。
    assert.equal(info.providerCount, 11, '预览桩下的可见 provider 数');
    assert.equal(info.selectedProvider, 'subusage-tab-xiaomi-token-plan-cn', '标签选中态必须匹配当前详情');
    assert.equal(info.tabsVisible, true, '窄屏仍使用按钮导航');
    assert(info.tabWidths.every(width => width > 0), '所有标签均有可点击区域');
    assert.equal(info.selectCount, 0, '整个设置页不使用下拉列表');
    // 原有 29 个开关 + 默认关闭的手动匹配开关。
    assert.equal(info.switches.length, 30, '提供商、Ark Team、默认隐藏与手动匹配开关');
    assert(info.switches.every(item => item.label), '开关有无障碍名称');
    // 默认关闭 19 条 − 桩里显式打开的 MiniMax 国际版 1 条 = 18 条路由；
    // 两条 Team 路由共用一个开关，加上默认关闭的手动匹配，界面有 18 个关闭开关。
    assert.equal(info.switches.filter(item => item.state === 'false').length, 18, '预览桩下关闭的 18 个开关');
    await page.screenshot({ path: file.replace(/\.html$/, '.png'), fullPage: true });
    await context.close();
    console.log(`PASS ${theme}/${width} 提供商开关、可换行按钮、无下拉、无溢出`);
  }
} finally { await browser.close(); }
