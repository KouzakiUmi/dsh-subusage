import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { OFM_IDS } from '../lib/ofm.js';
let spec, current;
const h = (type, props, ...children) => ({ type, props: props || {}, children: children.flat(Infinity).filter(v => v !== null && v !== false && v !== undefined) });
const react = { createElement: h, Fragment: 'fragment', useState: initial => current.state(initial), useRef: value => current.ref(value), useEffect: (fn, deps) => current.effect(fn, deps), useMemo: (fn, deps) => current.memo(fn, deps), useSyncExternalStore: (_subscribe, read) => read() };
const source = readFileSync(new URL('../lib/client.js', import.meta.url), 'utf8');
vm.runInNewContext(source.replace('exports.apply = apply;', 'exports.__test = { UsagePill, SubusagePillEntry, createUsageStore, computeStatus, parseLinkedQuery, mountPillStyles, PILL_ISLAND_CSS, PILL_LINKED_META, zh, en }; exports.apply = apply;'), {
 window: { __ModuleLoader__: { load: value => { spec = value; } } },
 document: { visibilityState: 'visible', addEventListener() {}, removeEventListener() {} },
 console, setInterval: () => 0, clearInterval() {}, setTimeout, clearTimeout
});
export const api = spec.factory(() => react).__test;
class Hooks {
 slots = []; index = 0; queue = [];
 state(initial) { const i = this.index++; this.slots[i] ??= { value: typeof initial === 'function' ? initial() : initial }; return [this.slots[i].value, v => { this.slots[i].value = typeof v === 'function' ? v(this.slots[i].value) : v; }]; }
 ref(value) { return this.slots[this.index++] ??= { current: value }; }
 changed(a, b) { return !a || a.length !== b.length || a.some((v, i) => !Object.is(v, b[i])); }
 memo(fn, deps) { const i = this.index++; if (!this.slots[i] || this.changed(this.slots[i].deps, deps)) this.slots[i] = { value: fn(), deps }; return this.slots[i].value; }
 effect(fn, deps) { const i = this.index++; const old = this.slots[i]; if (!old || this.changed(old.deps, deps)) { this.slots[i] = { deps, cleanup: old?.cleanup }; this.queue.push(() => { this.slots[i].cleanup?.(); this.slots[i].cleanup = fn(); }); } }
 render(fn, props) { current = this; this.index = 0; const tree = fn(props); for (const effect of this.queue.splice(0)) effect(); return tree; }
 dispose() { for (const slot of this.slots) slot?.cleanup?.(); }
}
const t = key => api.zh[key] ?? key;
const account = (name, value) => ({ account: name, state: 'ok', windows: [], extras: [{ kind: 'balance', value: `${value} 积分` }], coverage: 'complete', freshness: 'fresh' });
export const ofmEntry = { providerId: 'ofm-raccoon', label: '小浣熊 · OFM', state: 'ok', windows: [], extras: [], coverage: 'complete', freshness: 'fresh', lastSuccessAt: new Date().toISOString(), ofmAccounts: [account('账号甲', 6600), account('账号乙', 6300)] };
const flush = async () => { for (let i = 0; i < 20; i++) await Promise.resolve(); };
function nodes(tree) { if (!tree || typeof tree !== 'object') return []; return [tree, ...tree.children.flatMap(nodes)]; }
export async function renderPill(entry = ofmEntry) {
 const hooks = new Hooks();
 const reader = async () => entry; reader.subscribe = () => () => {}; reader.activate = () => () => {};
 const props = { providerId: entry.providerId, label: entry.label || entry.providerId, readEntry: reader, t, getLocale: () => 'zh', cc: null };
 let tree = hooks.render(api.UsagePill, props); await flush(); tree = hooks.render(api.UsagePill, props);
 nodes(tree).find(n => n.type === 'button' && n.props['aria-haspopup'] === 'dialog').props.onClick();
 tree = hooks.render(api.UsagePill, props); hooks.dispose(); return tree;
}
export function html(tree) {
 if (tree === null || tree === undefined || tree === false) return '';
 const escape = v => String(v).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');
 if (typeof tree !== 'object') return escape(tree);
 if (typeof tree.type === 'function') return html(tree.type({ ...tree.props, children: tree.children }));
 if (tree.type === 'fragment') return tree.children.map(html).join('');
 const attrs = Object.entries(tree.props).filter(([key, value]) => !['children', 'key', 'ref'].includes(key) && !key.startsWith('on') && value !== undefined && value !== null && value !== false).map(([key, value]) => {
  if (key === 'style') value = Object.entries(value).map(([k, v]) => `${k.replace(/[A-Z]/g, c => '-' + c.toLowerCase())}:${typeof v === 'number' && v !== 0 && !['opacity', 'fontWeight', 'zIndex', 'flex', 'flexGrow', 'flexShrink', 'lineHeight'].includes(k) ? v + 'px' : v}`).join(';');
  return `${key === 'className' ? 'class' : key}="${escape(value)}"`;
 }).join(' ');
 return `<${tree.type}${attrs ? ' ' + attrs : ''}>${tree.children.map(html).join('')}</${tree.type}>`;
}
{
 for (const id of OFM_IDS) assert.doesNotThrow(() => api.parseLinkedQuery({ providerIds: [id], force: false }));
 const calls = [];
 const usageStore = api.createUsageStore(async (method, request) => { calls.push([method, request]); return method === 'read' ? { settings: { revision: '1', visibility: { antigravity: false }, hasKeys: {}, keyModes: {} }, entries: [], configured: {} } : { entries: [ofmEntry] }; });
 const entry = await usageStore.reader('ofm-raccoon', true)();
 assert.equal(entry.visible, true, '关闭 Antigravity 不得关闭 OFM');
 assert.equal(calls[1][0], 'readLinked');
 assert.equal(calls.filter(c => c[0] === 'refresh').length, 0);
 for (const [route, id] of [['raccoon', 'ofm-raccoon'], ['loomy', 'ofm-loomy'], ['qoder', 'ofm-qoder'], ['qodercn', 'ofm-qodercn'], ['gemini', 'ofm-gemini']]) {
  const hooks = new Hooks(); const props = { store: { subscribe: () => () => {}, getSnapshot: () => ({ status: 'ready', current: { provider: route } }) }, usageStore, readEntry: id => usageStore.reader(id, true), t, getLocale: () => 'zh' };
  const tree = hooks.render(api.SubusagePillEntry, props); assert.equal(tree.props.providerId, id); hooks.dispose();
 }
 const status = api.computeStatus(ofmEntry, { providerId: 'ofm-raccoon', t, getLocale: () => 'zh' });
 assert.equal(status.key, 'accounts'); assert.equal(status.short, '2 个账号');
 const tree = await renderPill(); const markup = html(tree);
 assert(markup.includes('账号甲') && markup.includes('6600 积分') && markup.includes('账号乙') && markup.includes('6300 积分'));
 assert(!markup.includes('12900'), '客户端不累加两个账号余额');
 let mountedStyle, removed = false;
 const unmountStyles = api.mountPillStyles({ head: { appendChild: style => { mountedStyle = style; } }, createElement: name => { assert.equal(name, 'style'); return { remove: () => { removed = true; } }; } });
 assert.equal(mountedStyle.textContent, api.PILL_ISLAND_CSS);
 unmountStyles(); assert.equal(removed, true, '客户端卸载清理样式');
 assert.equal(tree.props['data-expanded'], 'true');
 assert(nodes(tree).some(n => n.props.className === 'dsh-subusage-dialog' && n.props.style.position === 'absolute'), '桌面弹层保持原来的定位');
 usageStore.dispose();
}
console.log('PASS OFM 客户端：路由、独立开关、联动取数、逐账号明细与 DSH Go 自适应样式');
