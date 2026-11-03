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
 console, setInterval: () => 0, clearInterval() {}, setTimeout, clearTimeout,
 // 页面代取通道用到的同源 fetch：默认不存在（真实浏览器才有），需要时由用例注入。
 fetch: (...args) => { if (!pluginFetch) throw new Error('fetch 未注入'); return pluginFetch(...args); }
});
/** 用例注入的 fetch 桩：模拟渲染进程带 cookie 请求 /plugins/*。 */
export let pluginFetch = null;
export const setPluginFetch = value => { pluginFetch = value; };
export const api = spec.factory(() => react).__test;
export class Hooks {
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
const account = (name, value) => ({ accountId: name, account: name, state: 'ok', windows: [], extras: [{ kind: 'balance', value: `${value} 积分` }], coverage: 'complete', freshness: 'fresh', authStatus: 'present' });
export const ofmEntry = { providerId: 'ofm-raccoon', label: '小浣熊 · OFM', state: 'ok', windows: [], extras: [], coverage: 'complete', freshness: 'fresh', lastSuccessAt: new Date().toISOString(), ofmAccounts: [account('账号甲', 6600), account('账号乙', 6300)] };
const flush = async () => { for (let i = 0; i < 20; i++) await Promise.resolve(); };
export function nodes(tree) { if (!tree || typeof tree !== 'object') return []; return [tree, ...tree.children.flatMap(nodes)]; }
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
  for (const [route, id] of [['raccoon', 'raccoon'], ['loomy', 'loomy'], ['qoder', 'ofm-qoder'], ['qodercn', 'ofm-qodercn'], ['gemini', 'ofm-gemini'], ['trae', 'trae'], ['trae-global', 'trae-global'], ['workbuddy', 'workbuddy'], ['workbuddy-global', 'workbuddy-global']]) {
  const hooks = new Hooks(); const props = { store: { subscribe: () => () => {}, getSnapshot: () => ({ status: 'ready', current: { provider: route } }) }, usageStore, readEntry: id => usageStore.reader(id, true), t, getLocale: () => 'zh' };
  const tree = hooks.render(api.SubusagePillEntry, props); assert.equal(tree.props.providerId, id); hooks.dispose();
 }
 const status = api.computeStatus(ofmEntry, { providerId: 'ofm-raccoon', t, getLocale: () => 'zh' });
  assert.equal(status.key, 'accounts'); assert.equal(status.short, '总 12900 积分', '多账号药丸按用户选择显示同单位总积分');
  assert.equal(status.title, '总额度 · 12900 积分', '合计明确标注为总额度');
 const tree = await renderPill(); const markup = html(tree);
 assert(markup.includes('账号甲') && markup.includes('6600 积分') && markup.includes('账号乙') && markup.includes('6300 积分'));
  assert(!html(nodes(tree).find(n => n.props.role === 'group')).includes('12900'), '账号列表仍只列各自余额，不把合计重复成一个账号');
 let mountedStyle, removed = false;
 const unmountStyles = api.mountPillStyles({ head: { appendChild: style => { mountedStyle = style; } }, createElement: name => { assert.equal(name, 'style'); return { remove: () => { removed = true; } }; } });
 assert.equal(mountedStyle.textContent, api.PILL_ISLAND_CSS);
 unmountStyles(); assert.equal(removed, true, '客户端卸载清理样式');
 assert.equal(tree.props['data-expanded'], 'true');
 assert(nodes(tree).some(n => n.props.className === 'dsh-subusage-dialog' && n.props.style.position === 'absolute'), '桌面弹层保持原来的定位');
 usageStore.dispose();
}
{
 // 多账号窗口也沿用 Command Code：健康收起态只画余量条，账号行直接给各自余量。
 const windowed = {
  ...ofmEntry,
  ofmAccounts: [
   { ...account('账号甲', 0), windows: [{ kind: '5h', percent: 20, status: 'ok' }], extras: [] },
   { ...account('账号乙', 0), windows: [{ kind: '5h', percent: 40, status: 'ok' }, { kind: 'week', percent: 30, status: 'ok' }], extras: [] }
  ]
 };
 const status = api.computeStatus(windowed, { providerId: 'ofm-raccoon', t, getLocale: () => 'zh' });
 assert.equal(status.short, '', '健康多账号药丸不额外写百分比');
 assert.equal(status.tinted, false);
 assert.equal(status.pillWindows.length, 2, '顶层没有窗口时仍使用代表账号自己的窗口画药丸');
 assert(status.sub.includes('账号乙'), '悬浮说明与横幅指出余量条属于哪个账号');
 const tree = await renderPill(windowed);
 const toggle = tree.children.find(node => node.type === 'button' && node.props['aria-haspopup'] === 'dialog');
 assert.equal(toggle.children.length, 1, '健康药丸只有余量条，没有第二段文字');
 assert.equal(toggle.children[0].children.length, 2, '只画最紧账号的两窗，不混入另一账号的窗口');
 const markup = html(tree);
 assert(markup.includes('余 80%') && markup.includes('余 60%'), '账号行显示各自窗口余量，而不是暂无数据');
 const low = { ...windowed, ofmAccounts: windowed.ofmAccounts.map((row, index) => index ? row : { ...row, windows: [{ kind: '5h', percent: 80, status: 'ok' }] }) };
 const lowStatus = api.computeStatus(low, { providerId: 'ofm-raccoon', t, getLocale: () => 'zh' });
 assert.ok(lowStatus.short.includes(api.zh.badgeHigh) && !lowStatus.short.includes('余 '), '偏少时追加档位词，不回到健康百分比文案');
 assert.equal(lowStatus.tinted, true);
 const partial = { ...windowed, ofmAccounts: windowed.ofmAccounts.map((row, index) => index ? row : { ...row, coverage: 'partial', error: '订阅窗口暂不可读' }) };
 const partialStatus = api.computeStatus(partial, { providerId: 'ofm-raccoon', t, getLocale: () => 'zh' });
 assert.equal(partialStatus.short, api.zh.statusPartial, '单个账号部分失败时汇总药丸不能继续全绿');
 assert.equal(partialStatus.color, '#eab308');
 const exhausted = { ...windowed, freshness: 'stale', retainPrevious: true, ofmAccounts: windowed.ofmAccounts.map((row, index) => index ? { ...row, windows: [{ kind: '5h', percent: 100, status: 'rate-limited' }, row.windows[1]] } : row) };
 const exhaustedStatus = api.computeStatus(exhausted, { providerId: 'ofm-raccoon', t, getLocale: () => 'zh' });
 assert.equal(exhaustedStatus.title, api.zh.statusExhausted, '额度耗尽优先于缓存提示');
 assert.equal(exhaustedStatus.color, '#ef4444');
 assert(exhaustedStatus.short.includes(api.zh.pillLimited) && !exhaustedStatus.short.includes(api.zh.statusCache));
}
{
 const hooks = new Hooks(); let entry = structuredClone(ofmEntry), notify;
 entry.ofmAccounts[0].accountActive = true; entry.ofmAccounts[0].accountMode = 'auto';
 entry.ofmAccounts[1].authStatus = 'missing'; entry.ofmAccounts[1].coverage = 'partial';
 const reader = async () => entry; reader.subscribe = fn => { notify = fn; return () => { notify = null; }; }; reader.activate = () => () => {};
 const props = { providerId: entry.providerId, label: entry.label, readEntry: reader, t, getLocale: () => 'zh', cc: null };
 hooks.render(api.UsagePill, props); await flush();
 let tree = hooks.render(api.UsagePill, props);
 const toggle = () => nodes(tree).find(n => n.type === 'button' && n.props['aria-haspopup'] === 'dialog');
 toggle().props.onClick(); tree = hooks.render(api.UsagePill, props);
 assert(html(tree).includes('提供方当前账号') && html(tree).includes('账号池自动选择') && html(tree).includes('缺少凭据'));
 // 账号行本身是切换按钮（照 Command Code 账户区），名字在子树里而不是直接 children。
 const viewButton = label => nodes(tree).find(n => n.type === 'button' && JSON.stringify(n).includes(JSON.stringify(label)));
 viewButton('账号甲').props.onClick(); tree = hooks.render(api.UsagePill, props);
  assert(toggle().props.title.includes('12900'), '查看账号甲时药丸保持账号总额');
 // 账号全部平铺：选中甲不会把乙从列表里拿掉，二者都可直接点选切换。
 assert(html(tree).includes('账号甲') && html(tree).includes('账号乙'), '选中一个账号时另一个仍可见、可切换');
 assert(viewButton('账号甲').props['aria-pressed'] === true && viewButton('账号乙').props['aria-pressed'] === false);
 assert.equal(viewButton('账号甲').props.title, '全部账号', '选中后再次点击的入口明确回到全部账号');
 viewButton('账号乙').props.onClick(); tree = hooks.render(api.UsagePill, props);
  assert(toggle().props.title.includes('12900') && !toggle().props.title.includes('账号乙'), '查看其它账号不把药丸从总额切成单账号');
  assert(html(tree).includes('余额 6300 积分'), '其它账号的详情只在弹层显示');
 assert(viewButton('账号乙').props['aria-pressed'] === true && viewButton('账号甲').props['aria-pressed'] === false);
 // 再点已选中的账号取消选择，回到默认视图（药丸不再指向乙）。
 viewButton('账号乙').props.onClick(); tree = hooks.render(api.UsagePill, props);
 assert(!toggle().props.title.includes('账号乙'), '再点已选账号应取消选择');
 // 乙的缺凭据标签留在它自己的行里，取消选择后仍可见。
 assert(html(tree).includes('缺少凭据'));
 // 另一窗口移除选中账号后，旧选择不能继续复活旧余额。
 entry = { ...entry, ofmAccounts: [entry.ofmAccounts[0]] }; notify(entry); tree = hooks.render(api.UsagePill, props);
 assert(!html(tree).includes('6300'));
 assert(html(tree).includes('6600'));
 hooks.dispose(); assert.equal(notify, null);
}
{
 // 独立插件使用相同账号查看组件；单个失败只影响它本身。
 const row = { ...account('独立账号', 0), accountId: 'wb-1', accountActive: true, accountMode: 'fixed', authStatus: 'expired', authExpiresAt: '2026-11-01T00:00:00Z' };
 const entry = { providerId: 'workbuddy', label: 'WorkBuddy', state: 'ok', windows: [], extras: [], coverage: 'partial', freshness: 'fresh', linkedAccounts: [row, { ...account('失效账号', 0), accountId: 'wb-2', state: 'error', extras: [], coverage: 'partial', freshness: 'unknown', authStatus: 'unknown', error: '账号额度暂不可读' }] };
 const markup = html(await renderPill(entry));
 assert(markup.includes('固定账号') && markup.includes('记录的登录态已到期') && markup.includes('提供方记录到期'));
 assert(markup.includes('账号额度暂不可读') && markup.includes('鉴权状态待确认'));
 assert(markup.includes('查看账号额度') && !markup.includes('NaN'));
}
{
 // 逐账号的 extras 与汇总区同一口径：余额留正文，积分包与到期明细折进 details。
 // 回归的是真实故障：一个账号带十几条包/到期说明时，弹层曾被铺成一堵墙。
 const richAccount = {
  ...account('账号甲', 6600),
  extras: [
   { kind: 'balance', value: '6600 积分' },
   { kind: 'note', value: '包A：100 credits' },
   { kind: 'note', value: '包A 到期：2026-11-27T17:37:48.000Z' },
   { kind: 'note', value: '包B：8 credits' }
  ]
 };
 const entry = { ...ofmEntry, ofmAccounts: [richAccount, account('账号乙', 6300)] };
  // 未选中账号时说明不展开（避免每行一个「其他说明」）；选中后才在该账号下出现。
  const collapsed = html(await renderPill(entry));
  assert(!collapsed.includes('其他说明'), '未选中账号时不展开说明');
  const hooksEntry = structuredClone(entry);
  const hooks = new Hooks();
  const reader = async () => hooksEntry; reader.subscribe = () => () => {}; reader.activate = () => () => {};
  const props = { providerId: hooksEntry.providerId, label: hooksEntry.label || hooksEntry.providerId, readEntry: reader, t, getLocale: () => 'zh', cc: null };
  let picked = hooks.render(api.UsagePill, props); await flush(); picked = hooks.render(api.UsagePill, props);
  nodes(picked).find(n => n.type === 'button' && n.props['aria-haspopup'] === 'dialog').props.onClick();
  picked = hooks.render(api.UsagePill, props);
  nodes(picked).find(n => n.type === 'button' && JSON.stringify(n).includes(JSON.stringify('账号甲'))).props.onClick();
  picked = hooks.render(api.UsagePill, props); hooks.dispose();
  const markup = html(picked);
  assert(markup.includes('其他说明'), '选中账号后其说明在该账号下展开');
 assert(markup.includes('6600 积分'), '余额仍留在正文');
 assert(!markup.includes('2026-11-27T17:37:48.000Z'), '原始 ISO 时间不得原样显示');
 assert(!/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/.test(markup), '不得再出现裸 ISO 时间（已按本地时间格式化）');
  const folded = nodes(picked).filter(n => n.type === 'details' && nodes(n).some(x => x.type === 'summary'));
 assert(folded.length > 0, '至少有一个折叠块');
 assert(folded.every(n => n.props.open !== true), '折叠默认收起');
  // 多账号：账号全部平铺在收起列表（一行一个），不再把「其余账号」折叠掉。
  // 旧设计把“其余账号”再折一层，药丸读到了第二个账号、弹层里却看不到，用户会判定“没读取成功”。
  assert(collapsed.includes('6600 积分') && collapsed.includes('6300 积分'), '每个账号的余额都要在收起列表可见');
  const listFold = nodes(picked).find(n => n.type === 'details' && nodes(n).some(x => x.type === 'summary' && String(x.children?.[0] ?? '').includes('其他账号')));
 assert.equal(listFold, undefined, '不再把其余账号折叠掉');
   assert.equal(nodes(picked).filter(n => n.type === 'details').length, 1, '选中账号的逐条明细只保留一份折叠，不在列表和正文重复');
}
{
 // 页面代取通道：宿主说缺哪个 URL，页面 fetch 回来，宿主归一化。
 // 宿主进程没有浏览器凭据（/plugins/* 一律 403），所以这几条必须由渲染进程取。
 const steps = [];
 const usageStore = api.createUsageStore(async (method, request) => {
  if (method === 'read') return { settings: { revision: '1', visibility: { antigravity: false }, hasKeys: {}, keyModes: {} }, entries: [], configured: {} };
  if (method === 'linkedStep') {
   steps.push({ id: request.providerId, carried: request.responses.length });
   if (!request.responses.length) return { missing: { key: 'usage|region=cn', url: '/plugins/dsh-connect-trae/usage?region=cn' } };
   return { entry: { providerId: 'trae', label: 'Trae', state: 'ok', windows: [], extras: [{ kind: 'balance', value: '527.15 credits' }], coverage: 'complete', freshness: 'fresh' } };
  }
  throw new Error('unexpected ' + method);
 });
 const fetched = [];
 setPluginFetch(async (url, init) => { fetched.push([url, init && init.credentials]); return { ok: true, status: 200, json: async () => ({ status: 'signed-in', accounts: [] }) }; });
 await usageStore.readSettings();
 const entry = await usageStore.reader('trae')(true);
 assert.equal(steps.length, 2, '先问宿主缺什么，拿到后再回传');
 assert.deepEqual(steps.map(x => x.carried), [0, 1], '第二轮把已取到的响应带回去');
 assert.equal(fetched[0][0], '/plugins/dsh-connect-trae/usage?region=cn', '页面直接取相对路由');
 assert.equal(fetched[0][1], 'same-origin', '同源请求才带浏览器凭据');
 assert.equal(entry.state, 'ok');
 assert.equal(entry.extras.find(x => x.kind === 'balance').value, '527.15 credits');
 setPluginFetch(null);
}
{
 // 页面代取的失败路径：这些都必须**照实报出来**，不能被回退路径掩盖成「宿主直取的 403」。
 const settings = { settings: { revision: '1', visibility: { antigravity: false }, hasKeys: {}, keyModes: {} }, entries: [], configured: {} };
 const build = (linkedStep) => {
  const seen = { fallback: 0, steps: 0 };
  const store = api.createUsageStore(async (method, request) => {
   if (method === 'read') return settings;
   if (method === 'readLinked') { seen.fallback += 1; return { updatedAt: new Date().toISOString(), entries: [] }; }
   if (method === 'linkedStep') { seen.steps += 1; return linkedStep(request); }
   throw new Error('unexpected ' + method);
  });
  return { store, seen };
 };
 const missingUrl = (key) => ({ missing: { key, url: '/plugins/dsh-connect-trae/usage?region=cn' } });

 // 404：兄弟插件没装 → 页面把 404 原样回传，由宿主决定回落 OFM / EAC 还是回缺席条目；页面不替它判断，也不回退旧路径。
 {
  const absent = { providerId: 'raccoon', label: '小浣熊', state: 'error', windows: [], extras: [], coverage: 'partial', freshness: 'unknown', error: '小浣熊 未检测到可用额度入口；请启用 dsh-raccoon-connect 或 Our Free Model 并完成登录。' };
  const carried = [];
  const { store, seen } = build(request => { carried.push(request.responses.map(row => row.status)); return request.responses.length ? { entry: absent } : { missing: { key: 'status', url: '/plugins/dsh-raccoon-connect/status' } }; });
  setPluginFetch(async () => ({ ok: false, status: 404, json: async () => ({}) }));
  await store.readSettings();
  const entry = await store.reader('raccoon')(true);
  assert.equal(seen.steps, 2, '404 要带回宿主，让它走回落 / 缺席判定');
  assert.equal(JSON.stringify(carried), '[[],[404]]', '第二轮携带 404 行');
  assert.equal(seen.fallback, 0, '404 不得回退到宿主直取旧路径');
  assert.match(entry.error, /未检测到可用额度入口/, '最终结论来自宿主（回落或缺席原因），不是页面静默丢弃');
 }

 // 页面连不上本机服务（fetch 抛错 → status 0）：报「无法连接本机服务」，不回退。
 {
  const { store, seen } = build(() => ({ entry: { providerId: 'trae', label: 'Trae', state: 'error', windows: [], extras: [], coverage: 'partial', freshness: 'unknown', error: 'Trae 的额度接口请求失败：页面无法连接本机服务' } }));
  setPluginFetch(async () => { throw new Error('offline'); });
  await store.readSettings();
  const entry = await store.reader('trae')(true);
  assert.match(entry.error, /无法连接本机服务/);
  assert.equal(seen.fallback, 0, '网络层失败不得回退');
 }

 // 上游 5xx：照实报出来。
 {
  const { store, seen } = build(() => ({ entry: { providerId: 'trae', label: 'Trae', state: 'error', windows: [], extras: [], coverage: 'partial', freshness: 'unknown', error: 'Trae 的额度接口返回 HTTP 500' } }));
  setPluginFetch(async () => ({ ok: false, status: 500, json: async () => ({}) }));
  await store.readSettings();
  const entry = await store.reader('trae')(true);
  assert.match(entry.error, /HTTP 500/);
  assert.equal(seen.fallback, 0, '上游失败不得回退');
 }

 // 宿主不认识这个方法（旧版本）：这时才回退。
 {
  const { store, seen } = build(() => { throw new Error('Host/Client 契约版本不匹配：Host 缺少 linkedStep；请同时更新两端并重新加载或重启。'); });
  setPluginFetch(async () => ({ ok: true, status: 200, json: async () => ({}) }));
  await store.readSettings();
  await store.reader('trae')(true);
  assert.equal(seen.fallback, 1, '方法不存在时回退一次');
 }

 // 24 轮用尽：报「未能在预期轮次内完成」，而不是静默变成没有数据。
 {
  const { store, seen } = build(() => missingUrl('usage|region=cn'));
  let n = 0;
  setPluginFetch(async () => ({ ok: true, status: 200, json: async () => ({ round: n++ }) }));
  await store.readSettings();
  const entry = await store.reader('trae')(true);
  assert.equal(seen.steps, 24, '轮数有上界');
  assert.equal(seen.fallback, 0, '耗尽不得回退');
  assert.match(entry.error, /未能在预期轮次内完成/);
 }
 setPluginFetch(null);
}
console.log('PASS 联动账号客户端：OFM/独立路由、账号选择、当前/鉴权元数据、失败与删除隔离及 DSH Go 自适应样式');
