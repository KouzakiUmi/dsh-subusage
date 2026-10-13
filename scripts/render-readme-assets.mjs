// README 视觉编排：复用真实 Client 离线组件；不联网、不读凭据、不生成虚构 UI。
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';
import { chromium } from 'playwright-core';
// Windows URL 解码由标准 fileURLToPath 处理，cwd 不作为隐式资源来源。
import { fileURLToPath } from 'node:url';
const workspace = fileURLToPath(new URL('..', import.meta.url));
const output = resolve(workspace, 'assets/readme');
mkdirSync(output, { recursive: true });
const debug = resolve(workspace, 'debug/readme');
mkdirSync(debug, { recursive: true });
const render = (...args) => {
  const result = spawnSync(process.execPath, [resolve(workspace, 'scripts/render-ui-preview.mjs'), ...args], { cwd: workspace, encoding: 'utf8' });
  if (result.status !== 0) throw new Error(result.stderr || 'offline component render failed');
  return result.stdout.trim();
};
const browser = await chromium.launch({ channel: 'chrome', headless: true });
try {
  for (const theme of ['dark', 'light']) {
    const context = await browser.newContext({ viewport: { width: 1200, height: 660 }, colorScheme: theme, deviceScaleFactor: 2 });
    await context.route(/^https?:/, route => route.abort());
    const page = await context.newPage();
    const capture = async (path, selector) => {
      await page.goto(pathToFileURL(path).href);
      return page.locator(selector).evaluate(el => el.outerHTML);
    };
    const balance = await capture(render('530', 'deepseek-account', theme, 'settings', 'balance-precision'), '#subusage-provider-panel');
    const plan = await capture(render('530', 'openai-codex', theme, 'pill', 'pro'), '[role="dialog"]');
    const pool = await capture(render('530', 'commandcode', theme, 'pill', 'pool-many'), '[role="dialog"]');
    const dark = theme === 'dark';
    const css = `*{box-sizing:border-box}body{margin:0;color:${dark ? '#edf2f8' : '#18212d'};background:${dark ? '#10151c' : '#f6f8fa'};color-scheme:${theme};font-family:"Sarasa UI SC","Noto Sans SC",system-ui,sans-serif}main{width:1200px;padding:44px 48px;position:relative;overflow:hidden}button{font-family:inherit}a{color:inherit}p{margin:0;color:${dark ? '#99a9bb' : '#56677b'};line-height:1.85}h1,h2,h3{margin:0}small{color:${dark ? '#8b9bad' : '#607186'}}.eyebrow{font-size:13px;letter-spacing:2px;color:${dark ? '#7ea8d9' : '#356599'};font-weight:600}.hero{height:660px;display:grid;grid-template-columns:1fr 440px;gap:44px;align-items:center}.intro h1{font-size:54px;line-height:1.28;letter-spacing:-2px;margin:24px 0}.intro>p{font-size:18px;max-width:520px}.tags{display:flex;gap:10px;margin-top:28px}.tags span{font-size:12px;border:1px solid ${dark ? '#33404f' : '#cad5df'};border-radius:999px;padding:6px 12px}.preview{border:1px solid ${dark ? '#34404e' : '#d1dbe4'};border-radius:20px;background:${dark ? '#1b232d' : '#ffffff'};box-shadow:0 22px 60px ${dark ? '#0005' : '#23354a12'};padding:20px}.preview-label{font-size:11px;letter-spacing:1px;color:${dark ? '#9badbf' : '#607186'};margin-bottom:14px}.component>[role="dialog"]{position:static!important;width:100%!important;box-shadow:none!important}.component>[role="tabpanel"]{margin-top:0!important}.component{--dsh-surface:${dark ? '#161c24' : '#ffffff'};--dsh-text:${dark ? '#edf2f8' : '#18212d'}}.pills{display:flex;align-items:center;justify-content:flex-end;gap:12px;padding:18px 0 0}.note{position:absolute;bottom:22px;left:48px;right:48px;display:flex;justify-content:space-between;font-size:11px}.features{height:820px}.features h2{font-size:32px;margin-top:10px}.columns{display:grid;grid-template-columns:repeat(3,1fr);gap:22px;margin-top:32px}.feature{min-width:0;border:1px solid ${dark ? '#34404e' : '#d1dbe4'};border-radius:16px;padding:20px;background:${dark ? '#1b232d' : '#fff'}}.feature h3{font-size:18px;margin:10px 0}.feature>p{font-size:13px;min-height:74px}.feature .component{margin-top:16px}.feature .component>[role="dialog"]{font-size:11px!important;padding:12px!important}.feature .component>[role="tabpanel"]{padding:12px!important}.index{font-size:12px;color:${dark ? '#7ea8d9' : '#356599'};letter-spacing:1px}`;
    const footer = `<div class="note"><small>真实 Client 组件 · 虚构用量数据 · 工作区离线预览</small><small>dsh-subusage / DSH plugin</small></div>`;
    const features = `<main class="features"><div class="eyebrow">ONE VIEW, THREE JOBS</div><h2>看得见余量，也分得清状态。</h2><div class="columns"><section class="feature"><div class="index">01 / SUBSCRIPTION</div><h3>哪一窗最紧张，一眼知道</h3><p>短窗、周窗与月窗分开看。<br>重置时间和读取异常，不藏在数字后面。</p><div class="component">${plan}</div></section><section class="feature"><div class="index">02 / BALANCE</div><h3>有余额，就直接看金额</h3><p>DeepSeek API 与本机账号各自独立。<br>余额预警按单位，不把钱包当套餐额度。</p><div class="component">${balance}</div></section><section class="feature"><div class="index">03 / ACCOUNT POOL</div><h3>多账户，不只看一个数字</h3><p>Command Code 展示轮换池健康度。<br>详情默认折叠，需要时再展开查看。</p><div class="component">${pool}</div></section></div>${footer}</main>`;
    for (const [name, markup, height] of [['features', features, 820]]) {
      const html = `<!doctype html><meta charset="utf-8"><title>README ${name} ${theme} / offline fixture</title><style>${css}</style>${markup}`;
      const path = resolve(debug, `${name}-${theme}.html`);
      writeFileSync(path, html, 'utf8');
      await page.setViewportSize({ width: 1200, height });
      await page.goto(pathToFileURL(path).href);
      await page.evaluate(() => document.fonts.ready);
      const dimensions = await page.evaluate(() => ({ width: document.documentElement.scrollWidth, height: document.documentElement.scrollHeight, viewHeight: innerHeight }));
      assert.equal(dimensions.width, 1200, 'no horizontal overflow');
      assert.equal(dimensions.height, height, 'no cropped content');
      for (const element of await page.locator('[role="dialog"], [role="tabpanel"]').all()) {
        const box = await element.boundingBox();
        assert.ok(box.y + box.height < height - 36, 'component stays above preview disclaimer');
      }
      await page.screenshot({ path: resolve(output, `${name}-${theme}.png`), fullPage: true });
      console.log(`PASS ${name}/${theme}: ${1200}×${height}, real-component composition, offline-only`);
    }
    await context.close();
  }
} finally { await browser.close(); }
