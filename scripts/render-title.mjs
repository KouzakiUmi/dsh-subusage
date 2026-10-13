// 保留原标题构图：用当前真实组件渲染双主题弹层和药丸，轻量优化文案。
// 产出 assets/title.png（2x）。debug/ 不入库。
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import vm from 'node:vm';
import { chromium } from 'playwright-core';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';

const clock = Date.parse('2026-10-11T18:21:32+08:00');
class PreviewDate extends Date { static now() { return clock; } }
let moduleSpec;
let previewStates, previewStateIndex = 0;
const react = {
	Fragment: Symbol('fragment'),
	createElement: (type, props, ...children) => ({ type, props: props || {}, children }),
	useSyncExternalStore: (_subscribe, getSnapshot) => getSnapshot(),
	useState: initial => [previewStates ? previewStates[previewStateIndex++] : (typeof initial === 'function' ? initial() : initial), () => {}],
	useRef: initial => ({ current: initial }),
	useEffect() {},
	useCallback: value => value,
	useMemo: fn => fn()
};
const context = {
	window: { localStorage: { getItem: () => 'opencode-go', setItem() {}, removeItem() {} }, __ModuleLoader__: { load: spec => { moduleSpec = spec; } } },
	document: {}, console, Date: PreviewDate
};
let code = readFileSync('lib/client.js', 'utf8').replace('exports.apply = apply;', 'exports.__preview = { UsagePill, zh }; exports.apply = apply;');
vm.runInNewContext(code, context);
const { UsagePill, zh } = moduleSpec.factory(name => { if (name !== 'react') throw new Error('unexpected module: ' + name); return react; }).__preview;

const iso = ms => new PreviewDate(clock + ms).toISOString();
const base = { state: 'ok', apiDetected: true, freshness: 'fresh', coverage: 'complete', lastSuccessAt: iso(0), lastAttemptAt: iso(0) };
// 两种情形、两家路由：Codex（额度充足，5 小时 / 每周两条限制）与 OpenCode Go（已用尽并连坐，滚动受每周连坐）。
const cases = [
	{ name: 'ok', theme: 'light', providerId: 'openai-codex', label: 'Codex', entry: { ...base, providerId: 'openai-codex', keySource: 'auth-file', windows: [
		{ kind: '5h', percent: 25, status: 'ok', resetsAt: iso(5 * 3600000) },
		{ kind: 'week', percent: 40, status: 'ok', resetsAt: iso(3 * 86400000) }
	], extras: [{ kind: 'plan', value: 'plus' }] } },
	{ name: 'exhausted', theme: 'dark', providerId: 'opencode-go', label: 'OpenCode Go', entry: { ...base, providerId: 'opencode-go', keySource: 'env', windows: [
		{ kind: 'rolling', percent: 0, status: 'rate-limited', resetsAt: iso(3 * 3600000), cascade: true, detail: { blockedBy: ['week'] } },
		{ kind: 'week', percent: 100, status: 'rate-limited', resetsAt: iso(3 * 86400000) },
		{ kind: 'month', percent: 69, status: 'ok', resetsAt: iso(20 * 86400000) }
	] } }
];

const escape = value => String(value).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const unitless = new Set(['opacity', 'zIndex', 'fontWeight', 'lineHeight', 'flex', 'flexGrow', 'flexShrink', 'order', 'gridColumn']);
function render(node) {
	if (node == null || node === false || node === true) return '';
	if (Array.isArray(node)) return node.map(render).join('');
	if (typeof node !== 'object') return escape(node);
	if (node.type === react.Fragment) return node.children.map(render).join('');
	if (typeof node.type === 'function') return render(node.type({ ...node.props, children: node.children }));
	const attrs = Object.entries(node.props).filter(([key, value]) => !['key', 'ref', 'children'].includes(key) && !key.startsWith('on') && value !== undefined && (value !== false || key.startsWith('aria-'))).map(([key, value]) => {
		if (key === 'style') value = Object.entries(value || {}).filter(([, val]) => val !== undefined && val !== null).map(([name, val]) => `${name.replace(/[A-Z]/g, c => '-' + c.toLowerCase())}:${typeof val === 'number' && val !== 0 && !unitless.has(name) ? val + 'px' : val}`).join(';');
		const name = key === 'className' ? 'class' : key === 'tabIndex' ? 'tabindex' : key.toLowerCase();
		return value === true && !key.startsWith('aria-') ? name : `${name}="${escape(value)}"`;
	}).join(' ');
	const start = `<${node.type}${attrs ? ' ' + attrs : ''}>`;
	return ['input', 'br', 'hr', 'img', 'meta', 'link'].includes(node.type) ? start : start + node.children.map(render).join('') + `</${node.type}>`;
}

mkdirSync('debug/title-preview', { recursive: true });
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const shots = [];
for (const item of cases) {
	previewStates = [{ entry: item.entry, updatedAt: clock }, null, undefined, false, true];
	previewStateIndex = 0;
	const tree = UsagePill({ providerId: item.providerId, label: item.label, readEntry: () => {}, t: key => zh[key] || key, getLocale: () => 'zh-CN' });
	const surface = item.theme === 'dark' ? '#16233a' : '#ffffff';
	const text = item.theme === 'dark' ? '#e2e8f0' : '#0f172a';
	const html = `<!doctype html><html><body style="margin:0;background:${item.theme === 'dark' ? '#0d1526' : '#f3f4f6'};color-scheme:${item.theme};--dsh-surface:${surface};--dsh-text:${text}"><div style="position:relative;width:820px;height:600px;display:flex;justify-content:flex-end;align-items:flex-end;padding:40px">${render(tree)}</div></body></html>`;
	const page = await (await browser.newContext({ viewport: { width: 820, height: 600 }, colorScheme: item.theme, deviceScaleFactor: 2 })).newPage();
	await page.route(/^https?:/, route => route.abort());
	await page.setContent(html);
	await page.locator('[role="dialog"]').screenshot({ path: `debug/title-preview/case-${item.name}.png` });
	shots.push({ name: item.name, file: `debug/title-preview/case-${item.name}.png` });
	await page.context().close();
}

// 拼 banner：左侧文字 + 真实弹层截图两张（倾斜、重叠并排）。
const miniPill = entry => {
  previewStates = [{ entry, updatedAt: clock }, null, undefined, false, false];
  previewStateIndex = 0;
  return render(UsagePill({ providerId: entry.providerId, label: entry.providerId, readEntry: () => {}, t: key => zh[key] || key, getLocale: () => 'zh-CN' }));
};
const banner = `<!doctype html><html><head><style>
@font-face { font-family: 'Noto Sans SC VF'; src: local('Noto Sans SC'), local('NotoSansSC-VF'); }
</style></head><body style="margin:0"><div style="position:relative;width:1280px;height:580px;overflow:hidden;background:linear-gradient(135deg,#0a1120,#101c31 55%,#0b2233);font-family:'Noto Sans SC','Noto Sans SC VF','Source Han Sans SC','Sarasa Term SC',sans-serif">
<div style="position:absolute;right:-140px;top:-180px;width:420px;height:420px;border-radius:50%;background:#22d3ee;opacity:.07"></div>
<div style="position:absolute;right:120px;bottom:-190px;width:340px;height:340px;border-radius:50%;background:#6366f1;opacity:.08"></div>
<div style="position:absolute;left:0;top:0;width:10px;height:100%;background:linear-gradient(#22d3ee,#6366f1)"></div>
<div style="position:absolute;left:64px;top:132px;color:#e2e8f0">
<div style="font-size:18px;letter-spacing:3px;color:#38bdf8">DSH PLUGIN · SUBSCRIPTION USAGE</div>
<div style="font-size:64px;font-weight:700;color:#f8fafc;line-height:1.15;margin-top:12px">dsh-subusage</div>
<div style="font-size:27px;color:#cbd5e1;margin-top:12px">额度与余额，不必离开对话。</div>
<div style="font-size:17px;color:#8aa0b8;margin-top:14px">模型旁看余量 · 点开看重置时间 · 集中管理凭据</div>
<div style="display:flex;gap:12px;margin-top:26px">
${miniPill(cases[0].entry)}
${miniPill({ ...cases[0].entry, windows: [{ ...cases[0].entry.windows[0] }, { ...cases[0].entry.windows[1], percent: 88 }] })}
${miniPill({ ...cases[1].entry, windows: [{ kind: 'week', percent: 100, status: 'rate-limited' }] })}
</div>
<div style="font-size:13px;color:#94a3b8;margin-top:24px">DeepSeek Harness 订阅用量显示</div>
<div style="font-size:11px;color:#8aa0b8;margin-top:12px">真实组件 · 虚构用量 · 工作区离线预览</div>
</div>
<img src="case-ok.png" style="position:absolute;left:600px;top:170px;width:280px;transform:rotate(-5deg);border-radius:14px;border:1px solid #d8e0ea;box-shadow:0 16px 36px rgba(0,0,0,.5)">
<img src="case-exhausted.png" style="position:absolute;left:920px;top:150px;width:280px;transform:rotate(-5deg);border-radius:14px;border:1px solid #33456b;box-shadow:0 16px 36px rgba(0,0,0,.6)">
</div></body></html>`;
writeFileSync('debug/title-preview/banner.html', banner, 'utf8');
const page = await (await browser.newContext({ viewport: { width: 1280, height: 580 }, deviceScaleFactor: 2 })).newPage();
await page.route(/^https?:/, route => route.abort());
await page.goto(pathToFileURL(resolve('debug/title-preview/banner.html')).href);
await page.evaluate(() => document.fonts.ready);
await page.screenshot({ path: 'assets/title.png' });
await browser.close();
console.log('done: assets/title.png (2560x1160), original composition, real components, offline only');
