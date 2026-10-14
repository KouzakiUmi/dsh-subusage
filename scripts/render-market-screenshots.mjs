// 市场截图（awesome-dsh-plugin 的 screenshots.json / dsh-market 详情页）：
// 复用真实 Client 离线组件，只决定「取哪一段、裁到哪、用几倍像素密度」；
// 不联网、不读凭据、不生成虚构 UI。弹层一律默认展开，让截图能看出真实细节。
import assert from 'node:assert/strict';
import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';
import { chromium } from 'playwright-core';

const workspace = fileURLToPath(new URL('..', import.meta.url));
const output = resolve(workspace, 'assets/screenshots');
mkdirSync(output, { recursive: true });

const preview = (...args) => {
  const result = spawnSync(process.execPath, [resolve(workspace, 'scripts/render-ui-preview.mjs'), ...args], { cwd: workspace, encoding: 'utf8' });
  if (result.status !== 0) throw new Error(result.stderr || 'offline component render failed');
  return resolve(workspace, result.stdout.trim());
};

// 预览页给药丸弹层留了 920px 的浮出定位上下文（check-pool-details.mjs 的点击断言依赖它），整页截图
// 会因此带上一大片空白。截图前把定位解除：article 高度交给内容、弹层进入文档流、外层药丸容器撑到
// 弹层的设计宽度，让「药丸 + 展开面板」左对齐成一张完整图。footer 的离线声明原样保留。
const flowCss = 'article{height:auto!important;justify-content:flex-start!important;align-items:flex-start!important}article>span{display:block!important;width:340px!important}[role="dialog"]{position:static!important;width:100%!important;max-height:none!important;overflow:visible!important}footer{padding:0 0 10px!important}';

const shots = [
  // 设置页：侧栏 + 订阅用量面板 + 提供商状态标签栏 + 提供商管理展开区。
  // 整页有 5000px 以上，市场详情页里读不出内容，因此裁到凭据管理区往下约两行卡片。
  { name: 'settings-dark', args: ['530', 'xiaomi-token-plan-cn', 'dark', 'credentials'], width: 778, theme: 'dark', scale: 3, viewportHeight: 1400, managementPx: 560 },
  // 药丸弹层（浅色）：结论横幅 + 每个窗口的剩余百分比、已用/总计与重置时间。
  { name: 'usage-popover-light', args: ['530', 'nanogpt', 'light', 'pill'], width: 380, theme: 'light', scale: 3, flow: true },
  // 轮换池展开后：默认账户额度与池内 40 个账户的实际可用性分开说明。
  { name: 'account-pool-expanded-dark', args: ['530', 'commandcode', 'dark', 'pill', 'pool-many'], width: 380, theme: 'dark', scale: 3, flow: true, expand: true },
  // 能力作用域：同一家商的文本/向量额度与视觉/语音日限额分组展示，日限额用尽不等于全部套餐不可用。
  { name: 'scoped-quota-dark', args: ['530', 'arkcli-agent-plan', 'dark', 'pill', 'scope'], width: 380, theme: 'dark', scale: 3, flow: true },
  // 余额与套餐药丸：余额档位、币种不折算、套餐优先于钱包、读取失败不谎报未订阅。
  { name: 'balance-pills-dark', args: ['530', 'deepseek', 'dark', 'pill', 'balance-gallery'], width: 560, theme: 'dark', scale: 3 }
];

const browser = await chromium.launch({ channel: 'chrome', headless: true });
try {
  for (const shot of shots) {
    const context = await browser.newContext({ viewport: { width: shot.width, height: shot.viewportHeight || 1000 }, colorScheme: shot.theme, deviceScaleFactor: shot.scale });
    await context.route(/^https?:/, route => route.abort());
    const page = await context.newPage();
    await page.goto(pathToFileURL(preview(...shot.args)).href);
    if (shot.flow) await page.addStyleTag({ content: flowCss });
    if (shot.expand) await page.locator('summary', { hasText: '点击查看详情' }).click();
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1);
    assert.equal(overflow, false, `${shot.name}: 不得横向溢出`);
    let box;
    if (shot.managementPx) {
      const management = await page.locator('#subusage-provider-management').boundingBox();
      // 裁剪区末尾再留一条声明的高度：裁剪会切掉页面底部的 footer，离线声明必须跟着进图。
      const contentHeight = Math.ceil(management.y + shot.managementPx);
      box = { x: 0, y: 0, width: shot.width, height: contentHeight + 22 };
      // clip 超出视口会被 Chrome 静默截断，视口必须一次装下整段裁剪区。
      assert.ok(box.height <= (shot.viewportHeight || 1000), `${shot.name}: 裁剪区 ${box.height}px 超出视口 ${shot.viewportHeight || 1000}px`);
      await page.evaluate(({ top }) => {
        const note = document.createElement('div');
        note.textContent = document.querySelector('footer').textContent;
        note.style.cssText = `position:absolute;left:0;top:${top}px;width:100%;padding:0 28px;font-size:11px;opacity:.55;color:inherit;z-index:999`;
        document.body.appendChild(note);
      }, { top: contentHeight });
      await page.screenshot({ path: resolve(output, `${shot.name}.png`), clip: box });
    } else {
      const body = page.locator('body');
      box = await body.boundingBox();
      await body.screenshot({ path: resolve(output, `${shot.name}.png`) });
    }
    console.log(`PASS ${shot.name}: ${Math.round(box.width * shot.scale)}×${Math.round(box.height * shot.scale)}, 真实组件 · 虚构数据 · 离线`);
    await context.close();
  }
} finally { await browser.close(); }
