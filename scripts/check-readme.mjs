// README 隔离验收：本机 GFM 解析、链接/图像存在性、主题切换与桌面/移动布局。
// 只读源码；输出 debug/readme，不连接 GitHub/DSH。可传本机含 micromark 的 node_modules 路径。
import assert from 'node:assert/strict';
import { readFileSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { resolve, dirname, extname } from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';
const root = fileURLToPath(new URL('..', import.meta.url));
const load = name => process.argv[2] ? import(pathToFileURL(resolve(process.argv[2], name, 'index.js')).href) : import(name);
const { micromark } = await load('micromark');
const { gfm, gfmHtml } = await load('micromark-extension-gfm');
const parse = text => micromark(text, { allowDangerousHtml: true, extensions: [gfm()], htmlExtensions: [gfmHtml()] });
const slug = text => text.toLowerCase().replace(/[^\p{L}\p{N}_\-\s]/gu, '').replace(/ /g, '-');
const raw = readFileSync(resolve(root, 'README.md'), 'utf8');
const rendered = parse(raw);
const output = resolve(root, 'debug/readme');
mkdirSync(output, { recursive: true });
const rawPrefix = 'https://raw.githubusercontent.com/KouzakiUmi/dsh-subusage/main/';
const css = `*{box-sizing:border-box}body{color-scheme:light dark;margin:0;background:Canvas;color:CanvasText;font-family:system-ui,sans-serif;line-height:1.65}article{max-width:980px;margin:auto;padding:40px;overflow-wrap:anywhere}h1,h2{border-bottom:1px solid #8884;padding-bottom:8px}h2{margin-top:34px}a{color:#438bd2}img{max-width:100%;height:auto}pre{padding:16px;background:#8881;overflow:auto;border-radius:8px}code{font-family:ui-monospace,monospace;font-size:13px}table{border-collapse:collapse;display:block;max-width:100%;overflow:auto}td,th{border:1px solid #8884;padding:7px 12px}blockquote{margin-left:0;padding:6px 16px;border-left:3px solid #8886;background:#8881}summary{cursor:pointer}sub{font-size:11px}@media(max-width:600px){article{padding:18px}h1{font-size:25px}}`;
const preview = resolve(output, 'homepage.html');
writeFileSync(preview, `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>README 本机近似预览（非 GitHub 实际渲染）</title><base href="${pathToFileURL(root).href}"><style>${css}</style><article>${rendered.replaceAll(rawPrefix, '')}</article>`, 'utf8');
const browser = await chromium.launch({ channel: 'chrome', headless: true });
let checked = 0;
try {
  for (const theme of ['dark', 'light']) for (const width of [1080, 390]) {
    const context = await browser.newContext({ colorScheme: theme, viewport: { width, height: 960 } });
    await context.route(/^https?:/, async route => {
      const url = route.request().url();
      if (url.startsWith(rawPrefix)) {
        const relative = decodeURIComponent(url.slice(rawPrefix.length).split('?')[0]);
        const file = resolve(root, relative);
        assert.ok(file.startsWith(resolve(root, 'assets') + '/'.replace('/', process.platform === 'win32' ? '\\' : '/')), 'image must be a repository asset');
        assert.ok(existsSync(file), `missing repository image: ${relative}`);
        await route.fulfill({ path: file, contentType: extname(file) === '.png' ? 'image/png' : 'image/svg+xml' });
      } else if (url.startsWith('https://img.shields.io/')) {
        await route.fulfill({ contentType: 'image/svg+xml', body: '<svg xmlns="http://www.w3.org/2000/svg" width="84" height="20"><rect width="84" height="20" rx="3" fill="#56687b"/><text x="42" y="14" text-anchor="middle" fill="white" font-size="11">badge preview</text></svg>' });
      } else await route.abort();
    });
    const page = await context.newPage();
    await page.goto(pathToFileURL(preview).href);
    const headings = await page.locator('h1,h2,h3').evaluateAll(nodes => nodes.map(node => node.textContent));
    const ids = new Set(headings.map(slug));
    const links = await page.locator('a').evaluateAll(nodes => nodes.map(node => node.getAttribute('href')));
    for (const href of links) {
      if (href?.startsWith('#')) assert.ok(ids.has(decodeURIComponent(href.slice(1))), `missing heading anchor: ${href}`);
      else if (href && !/^[a-z]+:/i.test(href)) {
        const [path, fragment] = href.split('#');
        const file = resolve(root, decodeURIComponent(path));
        assert.ok(existsSync(file), `missing linked file: ${href}`);
        if (fragment && extname(file) === '.md') {
          const text = readFileSync(file, 'utf8').replace(/```[\s\S]*?```/g, '');
          const targetIds = new Set([...text.matchAll(/^#{1,6}\s+(.+)$/gm)].map(match => slug(match[1])));
          assert.ok(targetIds.has(decodeURIComponent(fragment)), `missing file heading: ${href}`);
        }
      }
      checked++;
    }
    const images = await page.locator('img').evaluateAll(nodes => nodes.map(node => ({ ok: node.complete && node.naturalWidth > 0, source: node.currentSrc })));
    assert.ok(images.every(image => image.ok), 'all README images must load locally');
    assert.ok(images.some(image => image.source.endsWith(`features-${theme}.png`)), 'picture follows selected color scheme');
    assert.ok(images.some(image => image.source.endsWith('/assets/title.png')), 'original title asset remains in homepage');
    const size = await page.evaluate(() => ({ content: document.documentElement.scrollWidth, viewport: innerWidth }));
    assert.ok(size.content <= size.viewport, 'desktop/mobile has no page-wide overflow');
    assert.equal(await page.locator('h1').first().textContent(), '订阅用量显示', 'hero heading is parsed Markdown, not literal text');
    await page.screenshot({ path: resolve(output, `homepage-${theme}-${width}.png`), fullPage: true });
    await page.screenshot({ path: resolve(output, `homepage-${theme}-${width}-top.png`) });
    await context.close();
    console.log(`PASS README ${theme}/${width}: images, internal anchors, local links, GFM tables, no overflow`);
  }
} finally { await browser.close(); }
console.log(`PASS ${checked} link checks; offline badges are placeholders, external URLs were not network-tested`);
