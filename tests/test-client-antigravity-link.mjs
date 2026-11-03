// 客户端药丸联动：选中 dsh-tool-antigravity 的模型路由 google-antigravity 时，
// 药丸归并到联动项 antigravity，取数走 Host 的 readLinked（不读凭据、不占普通设置卡片）；
// visibility.antigravity 独立控制取数与显隐。
import { readFileSync } from "node:fs";
import vm from "node:vm";
import assert from "node:assert/strict";
import { loadHostModule } from "./helpers.mjs";

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
vm.runInNewContext(source.replace("exports.apply = apply;", "exports.__test = { createUsageStore, SubusagePillEntry, UsagePill, UsageWindowList, computeStatus, statusBanner, displayGroupLabel, zh, en, PILL_LINKED_META, parseLinkedQuery }; exports.apply = apply;"), {
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

// 三个独立池、四个窗口：截图中的 Claude/GPT 耗尽只限制它所属的池。
{
	const { normalizeAntigravity, normalizeAntigravityAuthView } = await loadHostModule();
	const resetGemini = "2026-11-06T00:00:00Z", resetClaude = "2026-11-02T00:00:00Z", resetArgon = "2026-11-04T00:00:00Z";
	const entry = normalizeAntigravity({ status: "ok", updatedAt: new FakeDate(clock).toISOString(), groups: [
		{ name: "Gemini Models", buckets: [{ window: "5h", remainingPct: 100 }, { window: "7d", remainingPct: 66.2, resetTime: resetGemini }] },
		{ name: "Claude and GPT models", buckets: [{ window: "7d", remainingPct: 0, resetTime: resetClaude }] },
		{ name: "gemini-argon", buckets: [{ window: "7d", remainingPct: 23.5, resetTime: resetArgon }] }
	] });
	const statusFor = (value, locale = api.zh, providerId = "antigravity") => api.computeStatus(value, { providerId, t: key => locale[key] || key, getLocale: () => locale === api.zh ? "zh" : "en" });
	const textOf = node => node == null || typeof node === "boolean" ? "" : typeof node !== "object" ? String(node) : Array.isArray(node) ? node.map(textOf).join(" ") : typeof node.type === "function" ? textOf(node.type({ ...node.props, children: node.children })) : (node.children || []).map(textOf).join(" ");
	for (const [locale, short, title, names] of [
		[api.zh, "1/3 池用尽", "部分额度池已用尽", ["Gemini 模型", "Claude 与 GPT 模型", "Gemini Argon 模型"]],
		[api.en, "1/3 pools used up", "Some quota pools used up", ["Gemini models", "Claude and GPT models", "Gemini Argon models"]]
	]) {
		const status = statusFor(entry, locale);
		assert.equal(status.key, "independent-pools");
		assert.equal(status.color, "#eab308", "部分池耗尽用黄色提醒，不能把整个订阅标红");
		assert.equal(status.short, short, "按池计数，不把 Gemini 的两个窗口当成两个池");
		assert.equal(status.title, title);
		const lines = status.sub.split("\n");
		assert.equal(lines.length, 3);
		for (let i = 0; i < names.length; i++) assert.ok(lines[i].includes(names[i]), `每个池的依据须带可读名称：${lines[i]}`);
		assert.ok(lines[0].includes("66.2%") && lines[1].includes("0%") && lines[2].includes("23.5%"), "同池取最紧窗口，跨池各自保留比例");
		assert.ok(lines.every(line => line.includes(locale === api.zh ? "后重置" : "resets in")), "每个池保留自己的重置时间");
		const banner = api.statusBanner(status);
		assert.ok(textOf(banner).includes(title));
		assert.ok(!textOf(banner).includes("%") && !textOf(banner).includes(names[0]), "横幅只给结论，不重复下方逐池数字和名称");
		assert.equal(banner.children[1].children.length, 1, "分池横幅不再渲染多行摘要");
		assert.equal(banner.props.style.padding, "12px 14px", "分池横幅与 Command Code 使用同一尺寸，不另造紧凑样式");
		const list = api.UsageWindowList({ windows: entry.windows, t: key => locale[key] || key, getLocale: () => "zh" });
		for (const name of names) assert.ok(textOf(list).includes(name), "列表标题与横幅使用相同显示名");
		assert.ok(!textOf(list).includes("gemini-argon"));
	}
	const healthy = { ...entry, windows: entry.windows.map(w => ({ ...w, percent: 10, status: "ok" })) };
	assert.equal(statusFor(healthy).tinted, false);
	assert.equal(statusFor(healthy).short, "");
	assert.equal(statusFor(healthy).title, "各额度池独立计算");
	const low = { ...healthy, windows: healthy.windows.map(w => w.groupLabel === "gemini-argon" ? { ...w, percent: 95 } : w) };
	assert.equal(statusFor(low).short, "1/3 池偏少");
	assert.equal(statusFor(low).title, "部分额度池余量偏低");
	const almostEmpty = { ...healthy, windows: healthy.windows.map(w => ({ ...w, percent: 99.99 })) };
	assert.equal(statusFor(almostEmpty).short, "3/3 池偏少", "显示舍入为 0% 仍不能把非零余量当成耗尽");
	const allLimited = { ...entry, windows: entry.windows.map(w => ({ ...w, percent: 100, status: "rate-limited" })) };
	assert.equal(statusFor(allLimited).color, "#ef4444");
	assert.equal(statusFor(allLimited).short, "3/3 池用尽");
	assert.equal(statusFor(allLimited).title, "已报告的额度池均已用尽");
	assert.equal(statusFor({ ...allLimited, windows: allLimited.windows.map(w => ({ ...w, status: "ok" })) }).short, "3/3 池用尽", "百分比确认用尽时不依赖状态字段重复确认");
	const mixedWithinPool = { ...entry, windows: entry.windows.map(w => w.groupLabel === "Gemini Models" && w.kind === "5h" ? { ...w, percent: 100, status: "rate-limited" } : w) };
	assert.equal(statusFor(mixedWithinPool).short, "2/3 池用尽", "同池任一窗口耗尽限制该池，但另一池有余量仍不是全部耗尽");
	const stale = { ...allLimited, state: "error", freshness: "stale", retainPrevious: true };
	assert.equal(statusFor(stale).key, "degraded");
	assert.equal(statusFor(stale).title, "缓存数据");
	assert.equal(statusFor(stale).color, "#eab308", "旧读数不宣告全部池当前耗尽");
	assert.equal(statusFor({ ...entry, coverage: "partial" }).title, api.zh.statusPartial);
	assert.equal(statusFor({ ...allLimited, coverage: "partial" }).title, api.zh.statusPartial, "部分数据不能直接宣告全部额度池用尽");
	assert.equal(statusFor({ ...entry, state: "error", windows: [], freshness: "unknown" }).key, "error");
	assert.equal(statusFor(allLimited, api.zh, "kimi-coding").key, "blocked", "普通订阅仍按共享约束的最差窗判断");
	assert.equal(statusFor({ ...entry, windows: [entry.windows[2]] }).short, "1/1 池用尽", "只计上游实际报告的池，不补造另外两池");
	assert.equal(api.displayGroupLabel("Future pool", t), "Future pool", "未知池保留提供方名称，不误并到 Gemini");
	const interleaved = { ...entry, windows: [entry.windows[0], entry.windows[2], entry.windows[1], entry.windows[3]] };
	assert.equal(statusFor(interleaved).short, "1/3 池用尽", "非相邻同名窗口仍属于同一个池");

	// 第二个通道只报告两池时，按实际池数计算并翻译其已有中文标签。
	const authEntry = normalizeAntigravityAuthView({ state: "available", groups: [
		{ group: "gemini", windows: [{ window: "5h", remainingFraction: 1 }, { window: "weekly", remainingFraction: 0.8 }] },
		{ group: "non-gemini", windows: [{ window: "weekly", remainingFraction: 0 }] }
	] });
	assert.equal(statusFor(authEntry).short, "1/2 池用尽");
	assert.ok(statusFor(authEntry, api.en).sub.includes("Claude and GPT models"));

	// 执行真实药丸：折叠文案、悬浮说明与弹层横幅共享分池判断。
	const hooks = new Hooks();
	const props = { providerId: "antigravity", label: "Antigravity", readEntry: async () => entry, t, getLocale: () => "zh", cc: null };
	hooks.render(api.UsagePill, props); await flush();
	let tree = hooks.render(api.UsagePill, props);
	const button = tree.children.find(node => node.type === "button");
	assert.ok(textOf(button).includes("1/3 池用尽"));
	assert.ok(button.props.title.includes("Gemini Argon 模型") && button.props.title.includes("23.5%"), "悬浮与无障碍说明覆盖各池，不只描述最差窗口");
	button.props.onClick();
	tree = hooks.render(api.UsagePill, props);
	assert.ok(textOf(tree).includes("部分额度池已用尽"));
	assert.ok(!textOf(tree).includes("最紧张"));
	assert.ok(!textOf(tree).includes("额度已用尽"), "不能退回整个订阅耗尽的横幅");
	const dialog = tree.children.find(node => node.props?.role === "dialog");
	const banner = dialog.children.find(node => node.props?.role === "status");
	assert.equal(textOf(banner).trim(), "⚠ 部分额度池已用尽");
	assert.equal(banner.props.style.borderRadius, 12, "药丸弹层横幅保持统一圆角");
	assert.ok(!textOf(banner).includes("66.2%") && !textOf(banner).includes("后重置"));
	assert.equal(textOf(dialog).split("Gemini 模型").length - 1, 1, "池名仅在额度列表出现一次");
	assert.equal(textOf(dialog).split("66.2%").length - 1, 1, "余量仅在额度卡片出现一次");
	const staleBanner = api.statusBanner(statusFor(stale));
	assert.ok(textOf(staleBanner).includes(api.zh.statusCache), "缓存提示保持可见");
	const ordinary = statusFor(allLimited, api.zh, "kimi-coding");
	assert.ok(textOf(api.statusBanner(ordinary)).includes(ordinary.sub), "普通订阅的状态依据不受影响");
	for (const slot of hooks.slots) slot?.cleanup?.();
}

console.log("PASS 客户端 Antigravity 联动与独立额度池：分池限额、中英可读名称、缓存/失败、药丸/横幅/悬浮说明与普通订阅回归");
