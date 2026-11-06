// DSH Go 原生面板回归：模型选择还原、路由归并、视图模型、客户端岛标记门控、
// Host 侧 dshGo 面板接线与数据馈送。全部为隔离桩：不碰网络、凭据与真实引擎。
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import { loadHostModule } from "./helpers.mjs";
import { goPanelData, goPanelModel, goPanelProviderName, goPanelUsageId, goPanelView, goPanelWords, ROUTE_USAGE_ID, LINKED_LABELS } from "../lib/go-panel.js";

const host = await loadHostModule();
const words = goPanelWords("zh-CN");

// ── 1. 路由别名表与 Client 的 ROUTE_PROVIDER_ALIAS 是同一份事实 ──────────────
// 两端各自漂移时 Go 面板会归并到错误的订阅（或归并不到），这里从 client.js
// 源码把表抽出来逐键比对——新增别名必须双端同步。
{
	let spec;
	const react = { createElement: () => null, Fragment: Symbol("f"), useState: v => [typeof v === "function" ? v() : v, () => {}], useRef: v => ({ current: v }), useEffect() {}, useCallback: f => f, useMemo: f => f(), useSyncExternalStore: () => null };
	vm.runInNewContext(readFileSync(new URL("../lib/client.js", import.meta.url), "utf8").replace("exports.apply = apply;", "exports.__test = { ROUTE_PROVIDER_ALIAS }; exports.apply = apply;"), {
		window: { __ModuleLoader__: { load: v => { spec = v; } } },
		document: { visibilityState: "visible", addEventListener() {}, removeEventListener() {} },
		console, setInterval: () => 0, clearInterval() {}, setTimeout, clearTimeout
	});
	const clientAlias = JSON.parse(JSON.stringify(spec.factory(() => react).__test.ROUTE_PROVIDER_ALIAS));
	assert.deepEqual(ROUTE_USAGE_ID, clientAlias, "go-panel 的 ROUTE_USAGE_ID 必须逐键等于 Client 的 ROUTE_PROVIDER_ALIAS");
}

// ── 2. 模型选择还原：对齐官方 model/selection + request/header 投影 ─────────
assert.equal(goPanelModel(undefined), null);
assert.equal(goPanelModel([]), null);
assert.equal(goPanelModel([{ type: "model/selection", data: { provider: "kimi-coding", model: "k2p5" } }])?.model, "k2p5");
// pending（选择未落地）优先于 lastUsed（上一次实际路由）。
{
	const events = [
		{ type: "request/header", data: { header: { config: { provider: "zai-coding-cn", model: "glm-4.6" } } } },
		{ type: "model/selection", data: { provider: "kimi-coding", model: "k2p5" } }
	];
	assert.deepEqual(goPanelModel(events)?.provider, "kimi-coding", "pending 选择压过上次路由");
}
{
	const events = [
		{ type: "model/selection", data: { provider: "kimi-coding", model: "k2p5" } },
		{ type: "request/header", data: { header: { config: { provider: "kimi-coding", model: "k2p5" } } } },
		{ type: "model/selection", data: { provider: "minimax-cn", model: "m2.1" } },
		{ type: "request/header", data: { header: { config: { provider: "minimax-cn", model: "m2.1" } } } }
	];
	assert.equal(goPanelModel(events)?.provider, "minimax-cn", "落地后取最新 lastUsed");
}
// 非字符串字段与不认识的事件不投影。
assert.equal(goPanelModel([{ type: "model/selection", data: { provider: "kimi-coding" } }, { type: "turn/input" }]), null);

// ── 3. 归并与显示名 ────────────────────────────────────────────────────────
assert.equal(goPanelUsageId("google-antigravity"), "antigravity");
assert.equal(goPanelUsageId("magpie-responses"), "magpie");
assert.equal(goPanelUsageId("kimi-coding"), "kimi-coding", "未登记路由原样返回");
assert.equal(goPanelUsageId("volcengine-agent-plan"), "arkcli-agent-plan", "旧插件路由归并到 arkcli");
assert.equal(goPanelUsageId("custom-route", { manualMatching: true, providerMappings: { "kimi-coding": ["custom-route"] } }), "kimi-coding", "手动映射优先");
assert.equal(goPanelUsageId("custom-route", { manualMatching: false, providerMappings: { "kimi-coding": ["custom-route"] } }), "custom-route", "开关关闭时映射不生效");
assert.equal(goPanelProviderName("kimi-coding", host.PROVIDERS, "zh"), "Kimi");
assert.equal(goPanelProviderName("ofm-qoder", host.PROVIDERS, "zh"), "Qoder · OFM");
assert.equal(goPanelProviderName("nope", host.PROVIDERS, "zh"), "nope");

// ── 4. 视图模型：窗口 / 余额 / 多账号 / 状态文案 ───────────────────────────
{
	const entry = {
		providerId: "kimi-coding", label: "Kimi", state: "ok", coverage: "complete", freshness: "fresh",
		updatedAt: "2026-11-06T10:00:00+08:00",
		windows: [
			{ kind: "5h", percent: 40, resetsAt: "2026-11-06T15:00:00+08:00" },
			{ kind: "week", percent: 96, status: "rate-limited", resetsAt: "2026-11-09T00:00:00+08:00" }
		],
		extras: [{ kind: "plan", value: "Coding Plan" }]
	};
	const data = goPanelData({ usageId: "kimi-coding", name: "Kimi", model: "k2p5" }, entry, { locale: "zh", now: Date.parse("2026-11-06T10:05:00+08:00") });
	assert.equal(data.model, "k2p5");
	assert.equal(data.stateText, "已获取");
	assert.equal(data.headline, "已限流", "rate-limited 优先于百分比");
	assert.equal(data.windows.length, 2);
	assert.equal(data.windows[0].trailing, `${words.left} 60%`);
	assert.equal(data.windows[1].tone, "bad");
	assert.equal(data.extras[0].value, "Coding Plan");
	// 显示按运行环境本地时区格式化：预期从 updatedAt 动态算，不钉死 +08:00（CI 跑 UTC）。
	const at = new Date(entry.updatedAt);
	const pad2 = n => String(n).padStart(2, "0");
	assert.match(data.updated, new RegExp(`${pad2(at.getMonth() + 1)}-${pad2(at.getDate())} ${pad2(at.getHours())}:${pad2(at.getMinutes())}`));
}
{
	// 多账号取激活行；纯余额条目标题取余额值。
	const entry = {
		providerId: "ofm-raccoon", state: "ok",
		linkedAccounts: [
			{ accountId: "a", account: "账号甲", windows: [{ kind: "day", percent: 10 }], extras: [] },
			{ accountId: "b", account: "账号乙", accountActive: true, windows: [], extras: [{ kind: "balance", value: "6300 积分" }] }
		]
	};
	const data = goPanelData({ usageId: "ofm-raccoon", name: "小浣熊 · OFM", model: "m" }, entry, { locale: "zh" });
	assert.equal(data.caption, "账户 账号乙");
	assert.match(data.headline, /6300/, "激活行的余额作标题");
}
{
	// 查询失败与「还没有模型路由记录」分开。
	const failed = goPanelData({ usageId: "kimi-coding", name: "Kimi", model: "m" }, null, { locale: "zh" });
	assert.equal(failed.headline, words.queryFailed);
	const noModel = goPanelData({ usageId: "", name: "", model: "" }, undefined, { locale: "zh" });
	assert.equal(noModel.note, "", "未就绪分支不写错误文案（由接线层补 noModel）");
	const en = goPanelData({ usageId: "kimi-coding", name: "Kimi", model: "m" }, { providerId: "kimi-coding", state: "ok", windows: [{ kind: "5h", percent: 40 }], extras: [] }, { locale: "en" });
	assert.equal(en.headline, `${goPanelWords("en").left} 60%`);
}

// ── 4.5 聚合卡服务卡：当前调用的上游卡（与药丸同一命中顺序）──────────────────
{
	const card = (id, group, name, windows = [], extras = []) =>
		({ accountId: id, account: `${name} 卡`, providerGroup: group, providerName: name, windows, extras });
	const win = (percent, groupLabel) => ({ kind: "month", percent, ...(groupLabel ? { groupLabel } : {}) });
	const devin = card("card-devin", "devin", "Devin", [win(96)]);
	const kimi = card("card-kimi", "kimi", "Kimi", [win(40)]);
	const gemini = card("card-gem", "gemini", "Gemini", [win(10)]);
	// 模型前缀归组：模型 id 的 provider/ 前缀直接是分组（auto/* 组模型则看 owned_by）。
	{
		const entry = { providerId: "magpie", state: "ok", linkedAccounts: [devin, kimi], routeContext: {} };
		const data = goPanelData({ usageId: "magpie", name: "Magpie", model: "kimi/k3.1-pro" }, entry, { locale: "zh" });
		assert.equal(data.windows[0].title, "每月");
		assert.equal(data.headline, `${words.left} 60%`, "命中 kimi 卡的窗口而非全卡最紧窗");
		assert.equal(data.caption, "Kimi");
	}
	// auto/* 组模型：前缀 auto 不是分组，按 /v1/models 的 owned_by 归组。
	// 目录里的 id 与 DSH 选中模型 id 同字（Host 逐字透传 /v1/models 的 id），先认完整 id、
	// 再去掉 auto/ group/ 前缀认模型名——两种拼写都要能归到同一张卡。
	{
		const entry = { providerId: "magpie", state: "ok", linkedAccounts: [devin, kimi], routeContext: {}, models: [{ id: "auto/kimi-k3.1-pro", owned_by: "kimi" }] };
		for (const model of ["auto/kimi-k3.1-pro", "group/kimi-k3.1-pro"]) {
			const data = goPanelData({ usageId: "magpie", name: "Magpie", model }, entry, { locale: "zh" });
			assert.equal(data.caption, "Kimi", `${model} 应按 owned_by 归组`);
		}
	}
	// 在途 live 压过模型归组；live 的 cardId 跨组时拒绝回指、回落到同组第一卡。
	{
		const entry = { providerId: "magpie", state: "ok", linkedAccounts: [devin, kimi],
			routeContext: { live: true, provider: "kimi", model: "devin/swe-2", cardId: "card-devin" } };
		const data = goPanelData({ usageId: "magpie", name: "Magpie", model: "devin/swe-2" }, entry, { locale: "zh" });
		assert.equal(data.headline, `${words.left} 60%`, "live 指 kimi 卡");
		assert.equal(data.caption, "Kimi · 当前调用");
	}
	// 上次路由 provider 兜底：模型认不出的组按 routeContext.provider 找卡并标「上次命中」。
	{
		const entry = { providerId: "magpie", state: "ok", linkedAccounts: [devin, kimi],
			routeContext: { provider: "devin", model: "unknown/x" } };
		const data = goPanelData({ usageId: "magpie", name: "Magpie", model: "unknown/x" }, entry, { locale: "zh" });
		assert.equal(data.headline, `${words.left} 4%`);
		assert.equal(data.caption, "Devin · 上次命中");
	}
	// 切会话：magpie 的路由遥测不分会话（DSH 不发 X-Magpie-Session），另一个对话正在跑的
	// 请求不能当成本会话的命中卡；req 与本会话模型一致时 live 仍然优先。
	{
		const entry = { providerId: "magpie", state: "ok", linkedAccounts: [devin, kimi],
			routeContext: { live: true, provider: "devin", model: "swe-2", req: "devin/swe-2", cardId: "card-devin" } };
		const data = goPanelData({ usageId: "magpie", name: "Magpie", model: "kimi/k3.1-pro" }, entry, { locale: "zh" });
		assert.equal(data.headline, `${words.left} 60%`, "按本会话模型命中 kimi 卡");
		assert.equal(data.caption, "Kimi", "不得把别的对话的渠道标成本会话当前调用");
	}
	{
		const entry = { providerId: "magpie", state: "ok", linkedAccounts: [devin, kimi],
			routeContext: { live: true, provider: "kimi", model: "k3.1-pro", req: "devin/swe-2", cardId: "card-kimi" } };
		const data = goPanelData({ usageId: "magpie", name: "Magpie", model: "devin/swe-2" }, entry, { locale: "zh" });
		assert.equal(data.headline, `${words.left} 60%`);
		assert.equal(data.caption, "Kimi · 当前调用", "本会话在途请求仍按 live 命中实际承接的卡");
	}
	{
		const entry = { providerId: "magpie", state: "ok", linkedAccounts: [devin, kimi],
			routeContext: { live: true, provider: "kimi", model: "k3.1-pro", cardId: "card-kimi" } };
		const data = goPanelData({ usageId: "magpie", name: "Magpie", model: "devin/swe-2" }, entry, { locale: "zh" });
		assert.equal(data.caption, "Kimi · 当前调用", "req 缺席时无法证伪，维持认它在途");
	}
	// 无路由口径也不认组 → 退回激活/首行聚合总览。
	{
		const entry = { providerId: "magpie", state: "ok", linkedAccounts: [devin, kimi] };
		const data = goPanelData({ usageId: "magpie", name: "Magpie", model: "unknown/x" }, entry, { locale: "zh" });
		assert.equal(data.headline, `${words.left} 4%`, "无命中按首行聚合");
	}
	// 分池卡（Antigravity）：命中卡再按模型收窄到池窗口；认不出池窗口全给。
	// 真实 magpie 下模型 id 带分组前缀（antigravity/gemini-4-flash），收窄以它为池词汇。
	{
		const pools = card("c1", "antigravity", "AG", [{ kind: "week", percent: 10, groupLabel: "non-gemini" }, { kind: "week", percent: 50, groupLabel: "gemini" }]);
		const entry = { providerId: "magpie", state: "ok", linkedAccounts: [pools], routeContext: {} };
		const claude = goPanelData({ usageId: "magpie", name: "Magpie", model: "antigravity/claude-opus-4.5" }, entry, { locale: "zh" });
		assert.equal(claude.windows.length, 1, "claude 模型只留 non-gemini 池");
		assert.equal(claude.headline, `${words.left} 90%`);
		const agyGemini = goPanelData({ usageId: "magpie", name: "Magpie", model: "antigravity/gemini-4-flash" }, entry, { locale: "zh" });
		assert.equal(agyGemini.windows.length, 1, "gemini 模型只留 gemini 池");
		assert.equal(agyGemini.headline, `${words.left} 50%`);
		const strange = goPanelData({ usageId: "magpie", name: "Magpie", model: "antigravity/zzz-qqq" }, entry, { locale: "zh" });
		assert.equal(strange.windows.length, 2, "命中卡但认不出池时退回整卡窗口");
	}
}

// ── 5. 视图结构与面板预算（对齐 components.md 上限）────────────────────────
{
	const view = goPanelView({}, { locale: "zh" });
	assert.equal(view.type, "stack");
	assert.ok(view.children.length <= 32);
	const allowed = new Set(["stack", "row", "text", "callout", "steps", "compare", "metric", "chart", "progress", "list", "keyValue", "table", "actions", "image"]);
	const nodes = (n) => [n, ...(Array.isArray(n.children) ? n.children.flatMap(nodes) : [])];
	const all = nodes(view);
	assert.ok(all.length <= 120);
	for (const n of all) assert.ok(allowed.has(n.type), `未知组件 ${n.type}`);
	// 绑定路径只允许 data.* 形状；动作 id 白名单。
	const bindings = JSON.stringify(view).match(/"\$"\s*:\s*"data\.[^"]*"/g) ?? [];
	assert.ok(bindings.length >= 8, "数据绑定必须覆盖面板字段");
	const actions = nodes(view).flatMap(n => Array.isArray(n.items) ? n.items : []).filter(i => i?.action);
	assert.deepEqual(actions.map(i => i.action), ["refresh"]);
	// 视图 JSON ≤ 32 KiB（面板预算）；状态条不在本插件 Go 贡献里。
	assert.ok(Buffer.byteLength(JSON.stringify(view)) <= 32 * 1024);
	// 数据模型同样收在预算内：30 个窗口 + 30 条 extras 也应远小于 32 KiB。
	const big = goPanelData({ usageId: "x", name: "X", model: "m" }, {
		providerId: "x", state: "ok", updatedAt: new Date().toISOString(),
		windows: Array.from({ length: 30 }, (_, i) => ({ kind: "day", percent: i, resetsAt: "2099-01-01T00:00:00Z" })),
		extras: Array.from({ length: 30 }, (_, i) => ({ kind: "note", value: `extra ${i}` }))
	}, { locale: "zh" });
	assert.ok(Buffer.byteLength(JSON.stringify(big)) <= 32 * 1024);
	assert.equal(big.windows.length, 8, "窗口行截断到 8");
	assert.equal(big.extras.length, 8, "附加行截断到 8");
}

// ── 6. Client 岛标记门控：Go 岛内不注册输入区药丸 ─────────────────────────
// 桌面网页版照旧注册；设置页与 remote/settings 注入不受岛标记影响。
function clientApply(isIsland) {
	let spec;
	const react = { createElement: () => null, Fragment: Symbol("f"), useState: v => [typeof v === "function" ? v() : v, () => {}], useRef: v => ({ current: v }), useEffect() {}, useCallback: f => f, useMemo: f => f(), useSyncExternalStore: () => null };
	const slots = { injects: [], inject(name, factory) { this.injects.push(name); return factory(); }, register: () => () => {} };
	const scope = { effect() {}, slots, modelDirectories: { directoryFor: () => ({ store: { subscribe: () => () => {}, getSnapshot: () => null } }) }, remote: { settings: {} } };
	const ctx = {
		effect() {}, get() { return undefined; },
		locale: { register: () => () => {}, bind: () => key => key, getLocale: () => ({ active: "zh" }) },
		remote: { $mount: () => Promise.resolve(() => {}), settings: {} },
		slots,
		inject(_names, cb) { return cb(scope); }
	};
	vm.runInNewContext(readFileSync(new URL("../lib/client.js", import.meta.url), "utf8"), {
		window: { __ModuleLoader__: { load: v => { spec = v; } } },
		document: {
			visibilityState: "visible", addEventListener() {}, removeEventListener() {},
			documentElement: { hasAttribute: name => isIsland && name === "data-dsh-go-island" }
		},
		console, setInterval: () => 0, clearInterval() {}, setTimeout, clearTimeout
	});
	spec.factory(() => react).apply(ctx);
	return slots.injects;
}
assert.ok(!clientApply(true).includes("conversation.input.right"), "Go 岛内不注册输入区药丸");
assert.ok(clientApply(false).includes("conversation.input.right"), "桌面网页版仍注册药丸");
assert.ok(clientApply(true).includes("settings.section"), "设置页在岛内照常注册");

// ── 7. Host 侧 dshGo 面板接线：view/data/refresh/会话事件 ────────────────────
{
	const panels = {};
	const events = [];
	const listeners = {};
	const fakeService = {
		calls: [],
		load() { return { visibility: { manualMatching: false, providerMappings: {} } }; },
		async quota(request) {
			this.calls.push(request);
			return { providers: [{ providerId: "kimi-coding", state: "ok", updatedAt: "2026-11-06T10:00:00+08:00", windows: [{ kind: "5h", percent: 40 }], extras: [] }] };
		}
	};
	const fakeSession = {
		id: "s1",
		snapshotEvents: () => [{ type: "request/header", data: { header: { config: { provider: "kimi-coding", model: "k2p5" } } } }]
	};
	const scope = {
		effect() {}, get(n) { return undefined; },
		typert: { register() {} }, tools: { register() {} },
		settings: undefined,
		dshGo: { panel(id, cfg) { panels[id] = cfg; return () => {}; } },
		logger: { info() {}, warn() {}, error() {} }
	};
	const ctx = {
		__env: {},
		effect() {},
		get(n) { if (n === "subUsage") return fakeService; if (n === "sessions") return { get: id => id === "s1" ? fakeSession : undefined }; if (n === "llm") return { listProviders: () => [] }; return undefined; },
		inject(names, cb) { if (names.includes("dshGo") && !scope.dshGo) return; return cb(scope); },
		on(name, cb) { (listeners[name] ??= []).push(cb); },
		plugin(cls, config) { return new cls(ctx, config); },
		logger: scope.logger
	};
	host.apply(ctx);
	assert.ok(panels.usage, "dshGo 在场时必须注册 usage 面板");
	assert.equal(typeof panels.usage.view, "function");
	assert.equal(typeof panels.usage.data, "function");
	assert.equal(typeof panels.usage.actions.refresh, "function");
	// 桌面（dshGo 缺席）不注册：注入回调不触发，行为与改动前一致。
	const scopeNoGo = { effect() {}, typert: { register() {} }, tools: { register() {} }, settings: undefined, logger: scope.logger };
	const ctxNoGo = { ...ctx, get() { return undefined; }, inject(names, cb) { return names.includes("dshGo") ? undefined : cb(scopeNoGo); } };
	const panelsDesktop = {};
	scopeNoGo.dshGo = { panel(id, cfg) { panelsDesktop[id] = cfg; } };
	host.apply(ctxNoGo);
	assert.equal(Object.keys(panelsDesktop).length, 0, "桌面主机没有 dshGo 服务时面板不出现");
	// 数据馈送：emit 的第一份数据携带模型与窗口行；手动 refresh 穿透 force。
	const emitted = [];
	const cancel = panels.usage.data({ sessionId: "s1" }, d => emitted.push(d), { locale: "zh" });
	for (let i = 0; i < 20 && emitted.length === 0; i++) await new Promise(r => setImmediate(r));
	assert.equal(emitted.length, 1);
	assert.equal(emitted[0].model, "k2p5");
	assert.equal(emitted[0].provider, "Kimi");
	assert.equal(emitted[0].headline, `${words.left} 60%`);
	assert.equal(fakeService.calls.length, 1);
	assert.equal(fakeService.calls[0].force, false);
	panels.usage.actions.refresh({ sessionId: "s1" }, { locale: "zh" });
	for (let i = 0; i < 20 && fakeService.calls.length < 2; i++) await new Promise(r => setImmediate(r));
	assert.equal(fakeService.calls[1].force, true, "刷新动作必须穿透缓存");
	// 会话里的 model/selection 事件会触发重读；其他会话的事件不触发。
	fakeSession.snapshotEvents = () => [
		{ type: "request/header", data: { header: { config: { provider: "kimi-coding", model: "k2p5" } } } },
		{ type: "model/selection", data: { provider: "google-antigravity", model: "claude-opus" } }
	];
	listeners["session/event"].forEach(cb => cb(fakeSession, { type: "model/selection", data: {} }));
	for (let i = 0; i < 20 && fakeService.calls.length < 3; i++) await new Promise(r => setImmediate(r));
	assert.equal(fakeService.calls.length, 3);
	assert.equal(fakeService.calls[2].providerIds[0], "antigravity", "切换模型后按新路由取数");
	const before = fakeService.calls.length;
	listeners["session/event"].forEach(cb => cb({ id: "s9" }, { type: "model/selection", data: {} }));
	for (let i = 0; i < 10; i++) await new Promise(r => setImmediate(r));
	assert.equal(fakeService.calls.length, before, "别的会话的事件不刷新本面板");
	listeners["session/event"].forEach(cb => cb(fakeSession, { type: "turn/input", data: {} }));
	assert.equal(fakeService.calls.length, before, "无关事件类型不刷新");
	if (typeof cancel === "function") cancel();
	// 视图绑定到同一份数据形状。
	const view = panels.usage.view({ sessionId: "s1" }, { locale: "zh" });
	assert.equal(view.type, "stack");
}
console.log("PASS dsh-go 面板：路由归并、模型还原、视图模型、客户端门控、Host 接线与数据馈送");
