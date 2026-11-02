// 客户端药丸联动：选中 dsh-tool-antigravity 的模型路由 google-antigravity 时，
// 药丸归并到联动项 antigravity，取数走 Host 的 readLinked（不读凭据、不占普通设置卡片）；
// visibility.antigravity 独立控制取数与显隐。
import { readFileSync } from "node:fs";
import vm from "node:vm";
import assert from "node:assert/strict";

const source = readFileSync(new URL("../lib/client.js", import.meta.url), "utf8");
let spec;
let clock = Date.parse("2026-11-01T01:00:00Z");
const events = new Map();
const document = {
	visibilityState: "visible",
	addEventListener(name, fn) { if (!events.has(name)) events.set(name, new Set()); events.get(name).add(fn); },
	removeEventListener(name, fn) { events.get(name)?.delete(fn); }
};
class FakeDate extends Date { static now() { return clock; } }
let harness;
const react = {
	createElement: (type, props, ...children) => ({ type, props: props || {}, children: children.flat(Infinity).filter(x => x !== null && x !== false && x !== undefined) }),
	Fragment: "fragment",
	useState: initial => harness.state(initial),
	useRef: value => harness.ref(value),
	useEffect: (fn, deps) => harness.effect(fn, deps),
	useMemo: (fn, deps) => harness.memo(fn, deps),
	useSyncExternalStore: (subscribe, getSnapshot) => getSnapshot()
};
vm.runInNewContext(source.replace("exports.apply = apply;", "exports.__test = { createUsageStore, SubusagePillEntry, PILL_LINKED_META, parseLinkedQuery }; exports.apply = apply;"), {
	window: { localStorage: { getItem: () => null, setItem: () => {} }, __ModuleLoader__: { load: value => { spec = value; } } },
	document, console, Date: FakeDate,
	setInterval: () => 0, clearInterval: () => {}, setTimeout: (fn) => { fn?.(); return 0; }, clearTimeout: () => {}
});
const plugin = spec.factory(() => react), api = plugin.__test;
const t = key => api.zh?.[key] || key;
const flush = async () => { for (let i = 0; i < 12; i++) await Promise.resolve(); };
class Hooks {
	slots = []; index = 0; queue = [];
	state(initial) { const i = this.index++; if (!(i in this.slots)) this.slots[i] = { value: typeof initial === "function" ? initial() : initial }; return [this.slots[i].value, v => { this.slots[i].value = typeof v === "function" ? v(this.slots[i].value) : v; }]; }
	ref(value) { const i = this.index++; return this.slots[i] ||= { current: value }; }
	changed(a, b) { return !a || a.length !== b.length || a.some((v, i) => !Object.is(v, b[i])); }
	effect(fn, deps) { const i = this.index++; const prev = this.slots[i]; if (!prev || this.changed(prev.deps, deps)) { this.slots[i] = { deps, cleanup: prev?.cleanup }; this.queue.push(() => { this.slots[i].cleanup?.(); this.slots[i].cleanup = fn(); }); } }
	memo(fn, deps) { const i = this.index++; if (!this.slots[i] || this.changed(this.slots[i].deps, deps)) { this.slots[i] = { deps, value: fn() }; } return this.slots[i].value; }
	render(component, props) { harness = this; this.index = 0; const tree = component(props); for (const fn of this.queue.splice(0)) fn(); return tree; }
}

const linkedEntry = (over = {}) => ({
	providerId: "antigravity", state: "ok", coverage: "complete", freshness: "fresh",
	windows: [
		{ kind: "5h", percent: 20, status: "ok", resetsAt: "2026-11-01T02:00:00.000Z", groupLabel: "Gemini 模型" },
		{ kind: "week", percent: 50, status: "ok", groupLabel: "Gemini 模型" }
	],
	extras: [], lastSuccessAt: new FakeDate(clock).toISOString(), ...over
});
const linkedResult = entries => ({ updatedAt: new FakeDate(clock).toISOString(), entries });
const settingsResult = (antigravity = true, entries = []) => ({ updatedAt: new FakeDate(clock).toISOString(), settings: { revision: "1", visibility: { antigravity }, hasKeys: {}, keyModes: {} }, configured: {}, entries });

// ── [1] reader("antigravity") 先读开关，再走 readLinked，不调普通 refresh ───
{
	const calls = [];
	const store = api.createUsageStore((method, query) => { calls.push({ method, query }); return method === "read" ? settingsResult() : linkedResult([linkedEntry()]); });
	const reader = store.reader("antigravity", true);
	const e = await reader();
	await flush();
	assert.deepEqual(calls.map(c => c.method), ["read", "readLinked"], "首次先读独立开关，之后只打 readLinked");
	assert.deepEqual(JSON.parse(JSON.stringify(calls[0].query)), { providerIds: [], force: false, commandCodeAccount: "" }, "首次只读设置，不取普通 provider 额度");
	assert.deepEqual(JSON.parse(JSON.stringify(calls[1].query)), { providerIds: ["antigravity"], force: false });
	assert.equal(e.state, "ok");
	assert.equal(e.visible, true, "联动条目不套「无凭据默认收起」规则");
	assert.equal(e.windows.length, 2);
	// 手动刷新透传 force。
	await reader(true);
	assert.equal(calls.at(-1).query.force, true);
	store.dispose();
}

// ── [2] 未装提供方插件：Host 回 error 条目，药丸仍可见（给出缺席原因而非消失）──
{
	const store = api.createUsageStore(method => method === "read" ? settingsResult() : linkedResult([{
		providerId: "antigravity", state: "error", coverage: "partial", freshness: "unknown", windows: [], extras: [],
		error: "Antigravity 额度来自 Antigravity 提供方插件，但本机没有检测到可用通道：请安装并登录 dsh-tool-antigravity（antigravityAuth 服务）或 dsh-antigravity-acp（agyQuota 服务），重启 DSH 后这条会自动出现。"
	}]));
	const e = await store.reader("antigravity", true)();
	assert.equal(e.state, "error");
	assert.equal(e.visible, true, "点名的联动项缺席时不隐藏");
	store.dispose();
}

// ── [3] 普通 provider 回归：仍走 refresh，联动分流不影响既有路径 ──────────────
{
	const calls = [];
	const regularEntry = { providerId: "zai-coding-cn", state: "ok", coverage: "complete", freshness: "fresh", windows: [{ kind: "sub", percent: 10, status: "ok" }], extras: [], apiDetected: true, keySource: "env" };
	const store = api.createUsageStore((method, query) => {
		calls.push({ method, query });
		return { updatedAt: new FakeDate(clock).toISOString(), settings: { revision: "1", visibility: {}, hasKeys: {}, keyModes: {} }, configured: { "zai-coding-cn": true }, entries: method === "read" ? [regularEntry] : [regularEntry] };
	});
	await store.reader("zai-coding-cn", true)();
	await flush();
	assert.ok(calls.some(c => c.method === "read"), "默认关闭/路由项仍先做一次设置预读");
	assert.ok(calls.some(c => c.method === "refresh"), "普通 provider 走 refresh");
	assert.ok(!calls.some(c => c.method === "readLinked"));
	store.dispose();
}

// 独立开关关闭：先读设置，不发 readLinked，reader 隐藏；开启后才查询。
{
	const calls = [];
	const store = api.createUsageStore((method, query) => { calls.push({ method, query }); return method === "read" ? settingsResult(false) : linkedResult([linkedEntry()]); });
	const e = await store.reader("antigravity", true)();
	assert.equal(e.visible, false);
	assert.deepEqual(calls.map(call => call.method), ["read"], "关闭时不发起联动取数");
	store.dispose();
}
// 关闭后清除旧条目，并阻挡关闭前发出的迟到响应。
{
	let release;
	const store = api.createUsageStore(method => method === "read" ? settingsResult() : method === "save" ? settingsResult(false) : new Promise(resolve => { release = resolve; }));
	const pending = store.reader("antigravity", true)();
	while (!release) await flush();
	const saved = await store.save({ expectedRevision: "1", visibility: { antigravity: false } });
	assert.equal(saved.settings.visibility.antigravity, false);
	release(linkedResult([linkedEntry()])); await pending;
	const current = await store.reader("antigravity", true)();
	assert.equal(current.visible, false);
	assert.ok(!store.getSnapshot().entries.some(e => e.providerId === "antigravity"), "关闭后旧额度立即移除，迟到响应不得复活");
	store.dispose();
}

// 另一窗口关闭后 Host 回空列表：旧窗口移除额度，且不覆盖设置，重新开启后可恢复。
{
	let enabled = true;
	const rpc = method => method === "read" || method === "save" ? settingsResult(enabled) : linkedResult(enabled ? [linkedEntry()] : []);
	const viewing = api.createUsageStore(rpc), editing = api.createUsageStore(rpc);
	const reader = viewing.reader("antigravity", true);
	assert.equal((await reader()).visible, true);
	enabled = false;
	await editing.save({ expectedRevision: "1", visibility: { antigravity: false } });
	assert.equal((await reader(true)).visible, false, "另一窗口关闭后的空响应必须隐藏旧药丸");
	assert.equal(viewing.getSnapshot().settings.visibility.antigravity, true, "联动响应不覆盖本地设置快照");
	assert.equal(viewing.getSnapshot().entries.find(e => e.providerId === "antigravity").windows.length, 0);
	enabled = true;
	await editing.save({ expectedRevision: "1", visibility: { antigravity: true } });
	assert.equal((await reader(true)).visible, true, "后续轮询应能恢复远端重新开启的额度");
	viewing.dispose(); editing.dispose();
}

// ── [4] 药丸入口：google-antigravity 路由 → antigravity 联动药丸 ────────────
{
	const usageStore = api.createUsageStore(method => method === "read" ? settingsResult() : linkedResult([linkedEntry()]));
	const readEntry = (id) => {
		const fn = async () => usageStore.getSnapshot().entries.find(e => e.providerId === id) || { providerId: id, state: "loading", windows: [] };
		fn.subscribe = () => () => {}; fn.activate = () => () => {};
		return fn;
	};
	const modelStore = provider => ({ subscribe: () => () => {}, getSnapshot: () => ({ status: "ready", current: { provider } }) });
	const propsFor = provider => ({ store: modelStore(provider), usageStore, readEntry, t, getLocale: () => "zh", cc: null, setCommandCodeAccount: null });
	const hooks = new Hooks();
	const tree = hooks.render(api.SubusagePillEntry, propsFor("google-antigravity"));
	assert.equal(tree.type?.name || tree.type, "UsagePill");
	assert.equal(tree.props.providerId, "antigravity", "google-antigravity 路由归并到联动项");
	assert.equal(tree.props.label, "Antigravity");
	// 直接用联动 id 也认。
	const direct = hooks.render(api.SubusagePillEntry, propsFor("antigravity"));
	assert.equal(direct.props.providerId, "antigravity");
	// 不认识的路由不渲染药丸。
	const none = hooks.render(api.SubusagePillEntry, propsFor("some-other-route"));
	assert.equal(none, null);
	usageStore.dispose();
}

// ── [5] 联动查询 codec：白名单与 Host LINKED_IDS 对齐 ───────────────────────
{
	assert.doesNotThrow(() => api.parseLinkedQuery({ providerIds: ["antigravity"], force: false }));
	assert.doesNotThrow(() => api.parseLinkedQuery({ providerIds: ["trae-global"], force: true }));
	assert.throws(() => api.parseLinkedQuery({ providerIds: ["deepseek"], force: false }), /Invalid dsh-subusage linked query/);
	assert.throws(() => api.parseLinkedQuery({ providerIds: ["antigravity"], force: "yes" }), /Invalid dsh-subusage linked query/);
}

console.log("PASS 客户端药丸联动：google-antigravity 路由归并、readLinked 取数、缺席可见与普通 provider 回归");
