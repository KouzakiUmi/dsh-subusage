// OpenDesign 药丸按当前模型路由标注计费来源；只测试本地展示，不调用上游。
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

let spec, states = [], stateIndex = 0;
const react = {
 createElement: (type, props, ...children) => ({ type, props: props || {}, children }),
 Fragment: 'fragment',
 useSyncExternalStore: (_subscribe, getSnapshot) => getSnapshot(),
 useEffect() {}, useMemo: factory => factory(), useRef: value => ({ current: value }),
 useState: initial => [stateIndex < states.length ? states[stateIndex++] : (stateIndex++, typeof initial === 'function' ? initial() : initial), () => {}]
};
const source = readFileSync(new URL('../lib/client.js', import.meta.url), 'utf8');
vm.runInNewContext(source.replace('exports.apply = apply;', 'exports.__test = { openDesignFunding, SubusagePillEntry, UsagePill, zh, en }; exports.apply = apply;'), {
 window: { __ModuleLoader__: { load(value) { spec = value; } } }, console
});
const { __test: api } = spec.factory(() => react);
const t = key => api.zh[key] || key;
const future = new Date(Date.now() + 3600000).toISOString();
const normal = { providerId: 'opendesign', state: 'ok', freshness: 'fresh', coverage: 'complete', windows: [
 { kind: '5h', percent: 20, status: 'ok', resetsAt: future },
 { kind: 'week', percent: 30, status: 'ok', resetsAt: future }
], extras: [{ kind: 'balance', value: '20 USD' }] };
assert.equal(api.openDesignFunding('plan', normal, t).label, '使用套餐额度');
assert.equal(api.openDesignFunding('paid', normal, t).label, '使用余额');
for (const index of [0, 1]) {
 const windows = normal.windows.map((w, i) => i === index ? { ...w, percent: 100, status: 'rate-limited' } : w);
 const funding = api.openDesignFunding('plan', { ...normal, windows }, t);
 assert.equal(funding.label, '使用余额', '任一套餐窗口用尽后标注余额续用');
 assert.ok(funding.note.includes('套餐额度已用尽'));
}
for (const value of [null, { ...normal, state: 'error' }, { ...normal, freshness: 'stale' }, { ...normal, coverage: 'partial' }, { ...normal, windows: [] }, { ...normal, windows: [{ ...normal.windows[0], percent: 100, resetsAt: '2000-01-01T00:00:00Z' }] }]) {
 assert.equal(api.openDesignFunding('plan', value, t).label, '计费来源待确认');
}
assert.equal(api.openDesignFunding('plan', normal, t, true).label, '计费来源待确认');
const unsubscribed = api.openDesignFunding('plan', { ...normal, windows: [], subscribed: false }, t);
assert.equal(unsubscribed.label, '使用余额');
assert.ok(unsubscribed.note.includes('未检测到'));
assert.equal(api.openDesignFunding(null, normal, t), null, '不猜测未知路由的计费来源');
assert.equal(api.openDesignFunding('plan', normal, key => api.en[key]).label, 'Uses plan quota');

const stableReader = async () => normal;
const readEntry = () => stableReader;
let provider = 'opendesign-corouter-plan', visibility = {};
const props = {
 store: { subscribe: () => () => {}, getSnapshot: () => ({ status: 'ready', current: { provider, model: 'same-model' } }) },
 usageStore: { subscribe: () => () => {}, getSnapshot: () => ({ settings: { visibility } }) },
 readEntry, t, getLocale: () => 'zh'
};
const wrap = () => api.SubusagePillEntry(props);
const plan = wrap();
assert.equal(plan.props.openDesignRouteKind, 'plan');
provider = 'opendesign-corouter-paid';
const paid = wrap();
assert.equal(paid.props.openDesignRouteKind, 'paid');
assert.equal(plan.props.readEntry, paid.props.readEntry, '分类切换不拆分账号用量缓存');
assert.equal(plan.props.key, paid.props.key);
provider = 'opendesign';
assert.equal(wrap().props.openDesignRouteKind, null, '原始入口不硬猜模型分组');
provider = 'opendesign-corouter-plan';
visibility = { manualMatching: true, providerMappings: { 'kimi-coding': [provider] } };
assert.equal(wrap().props.openDesignRouteKind, null, '手动映射到其他订阅时不携带OpenDesign标注');

const text = node => node == null || typeof node === 'boolean' ? '' : Array.isArray(node) ? node.map(text).join(' ') : typeof node === 'object' ? text(node.children) : String(node);
function render(element, entry, open = false) {
 states = [{ entry, updatedAt: Date.now() }, null, null, false, open]; stateIndex = 0;
 return element.type(element.props);
}
assert.ok(text(render(plan, normal)).includes('使用套餐额度'), '收起药丸直接可见标注');
assert.ok(text(render(paid, normal)).includes('使用余额'));
const exhausted = { ...normal, windows: normal.windows.map(w => ({ ...w, percent: 100, status: 'rate-limited' })) };
assert.ok(text(render(plan, exhausted, true)).includes('继续使用此套餐模型会消耗余额'));
assert.ok(text(render(plan, exhausted, true)).includes('重置'), '弹层保留套餐重置说明');
assert.ok(text(render(paid, normal, true)).includes('不代表此模型的计费来源'));
assert.equal(render(plan, { ...normal, visible: false }), null, '原有显示开关仍有效');
console.log('PASS OpenDesign 套餐/余额标注、耗尽续用、未知状态、模型切换与药丸/弹层渲染');
