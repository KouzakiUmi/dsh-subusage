// 来源偏好（逐来源停用 + 按路由绑定来源）：把联动项原来隐式的回退链拆成可控来源。
//
// 钉五件事：
//  1. 纯函数推导：每个条目有哪些来源、未绑定时的主来源组、绑定与停用的解析结果；
//  2. 未绑定路由时**不再自动补位**（OFM 有数据也不读）——缺数据就报缺席；
//  3. 绑定到某来源后只读那一个（不先试原生来源）；
//  4. 逐来源停用生效（停用 local 后只剩 plugin）；
//  5. 设置管线：save 补丁的校验、公开投影（available / labels）与坏配置回退。
import assert from "node:assert/strict";
import { loadHostModule } from "./helpers.mjs";
import { linkedSourceKeys, defaultSourceOrder, resolveLinkedSources, validateSourcePrefs } from "../lib/platform/sources.js";
import { LOCAL_CHANNELS } from "../lib/local-usage.js";

const { SubUsageService, subUsageRemote, LINKED_PROVIDERS, CLIENT_FETCH_LINKED_IDS } = await loadHostModule();
const now = Date.parse("2026-11-16T12:00:00+08:00");

// ── [1] 纯函数：可用来源与主来源组 ─────────────────────────────────────────
{
	const opts = id => ({ id, localChannels: LOCAL_CHANNELS });
	const sourced = (id, expectedKeys, expectedDefault) => {
		const meta = LINKED_PROVIDERS[id];
		assert.deepEqual(linkedSourceKeys(meta, opts(id)), expectedKeys, `${id} 的可用来源`);
		assert.deepEqual(defaultSourceOrder(meta, opts(id)), expectedDefault, `${id} 的主来源组`);
	};
	// 本机直取 + 独立插件 + OFM 都可用的典型条目（不再含已移除的 router 来源）。
	sourced("raccoon", ["local", "plugin", "ofm"], ["local", "plugin"]);
	sourced("loomy", ["local", "plugin", "ofm"], ["local", "plugin"]);
	// OFM 原生条目：主来源组是「本机直取 + OFM」。
	sourced("ofm-raccoon", ["local", "ofm"], ["local", "ofm"]);
	sourced("ofm-qodercn", ["local", "ofm"], ["local", "ofm"]);
	// Antigravity 在 OFM 覆盖范围外，两个提供方通道算同一个 plugin 来源。
	sourced("antigravity", ["plugin"], ["plugin"]);
	sourced("magpie", ["magpie"], ["magpie"]);
	// TRAE 中国版：本机直取 + 独立插件 + OFM。
	sourced("trae", ["local", "plugin", "ofm"], ["local", "plugin"]);
	assert.ok(!linkedSourceKeys(LINKED_PROVIDERS["trae-global"], { id: "trae-global", localChannels: LOCAL_CHANNELS }).includes("router"));
	assert.ok(!linkedSourceKeys(LINKED_PROVIDERS["trae-enterprise"], { id: "trae-enterprise", localChannels: LOCAL_CHANNELS }).includes("router"));
	// 未注册的 id 不炸。
	assert.deepEqual(linkedSourceKeys(undefined), []);
	assert.deepEqual(defaultSourceOrder(undefined), []);
	console.log("PASS 来源推导：可用来源、主来源组、未注册条目不抛错");
}

// ── [2] 纯函数：绑定与停用的解析 ───────────────────────────────────────────
{
	const meta = LINKED_PROVIDERS.raccoon;
	const opts = { id: "raccoon", localChannels: LOCAL_CHANNELS };
	// 未绑定 → 主来源组。
	assert.deepEqual(resolveLinkedSources(meta, {}, "any-route", opts), ["local", "plugin"]);
	// 绑定到其它条目的路由不影响本条目。
	assert.deepEqual(resolveLinkedSources(meta, { bindings: { r1: { linkedId: "loomy", source: "ofm" } } }, "r1", opts), ["local", "plugin"]);
	// 绑定到本条目 → 只那一个来源。
	assert.deepEqual(resolveLinkedSources(meta, { bindings: { r1: { linkedId: "raccoon", source: "ofm" } } }, "r1", opts), ["ofm"]);
	// 逐来源停用：从主来源组里剔除。
	assert.deepEqual(resolveLinkedSources(meta, { disabled: { raccoon: ["local"] } }, undefined, opts), ["plugin"]);
	assert.deepEqual(resolveLinkedSources(meta, { disabled: { raccoon: ["local", "plugin"] } }, undefined, opts), [], "全停用 = 没有可用来源，不是「回退到没停用的」");
	// 绑定的来源被停用 → 没有可用来源（不偷偷回退到主来源组）。
	assert.deepEqual(resolveLinkedSources(meta, { bindings: { r1: { linkedId: "raccoon", source: "ofm" } }, disabled: { raccoon: ["ofm"] } }, "r1", opts), []);
	// 停用表只对声明的条目生效，别的条目的停用不影响本条目。
	assert.deepEqual(resolveLinkedSources(meta, { disabled: { loomy: ["local"] } }, undefined, opts), ["local", "plugin"]);
	console.log("PASS 来源解析：绑定优先、停用剔除、绑定的来源被停用即无来源、不跨条目串味");
}

// ── [3] 校验：坏配置拒绝，未知条目/来源拒绝 ────────────────────────────────
{
	const linkedIds = new Set(Object.keys(LINKED_PROVIDERS));
	const sourcesOf = id => linkedSourceKeys(LINKED_PROVIDERS[id], { id, localChannels: LOCAL_CHANNELS });
	const ok = validateSourcePrefs({ disabled: { raccoon: ["ofm", "bogus", "ofm"] }, bindings: { "kimi/k3": { linkedId: "raccoon", source: "ofm" } } }, { linkedIds, sourcesOf });
	assert.deepEqual(ok.disabled, { raccoon: ["ofm"] }, "未知来源 key 丢弃、重复去重");
	assert.deepEqual(ok.bindings, { "kimi/k3": { linkedId: "raccoon", source: "ofm" } });
	assert.deepEqual(validateSourcePrefs(undefined), { disabled: {}, bindings: {} });
	assert.deepEqual(validateSourcePrefs(null), { disabled: {}, bindings: {} });
	for (const [raw, hint] of [
		[[], "数组不是对象"],
		[{ disabled: [] }, "disabled 形状"],
		[{ disabled: { nope: ["ofm"] } }, "未知条目"],
		[{ disabled: { raccoon: "ofm" } }, "停用列表必须是数组"],
		[{ bindings: [] }, "bindings 形状"],
		[{ bindings: { " ": { linkedId: "raccoon", source: "ofm" } } }, "空路由 id"],
		[{ bindings: { "a b": { linkedId: "raccoon", source: "ofm" } } }, "含空格的路由 id"],
		[{ bindings: { r1: { linkedId: "nope", source: "ofm" } } }, "未知条目绑定"],
		[{ bindings: { r1: { linkedId: "raccoon", source: "magpie" } } }, "条目不支持的来源"],
		[{ bindings: { r1: { linkedId: "raccoon", source: "router" } } }, "已移除的 router 来源被拒绝"],
		[{ bindings: { r1: "raccoon" } }, "绑定必须是对象"],
	]) assert.throws(() => validateSourcePrefs(raw, { linkedIds, sourcesOf }), hint);
	console.log("PASS 来源校验：未知条目/来源拒绝、key 去重过滤、空与坏形状分别处理");
}

// ── [4] Host：未绑定不补位 / 绑定生效 / 停用生效 ───────────────────────────
function harness({ settings, ofm = true, desktop = 404, now: clock } = {}) {
	const files = new Map();
	if (settings !== undefined) files.set("memory/config", JSON.stringify(settings));
	const io = {
		readFileSync(path) { if (!files.has(path)) throw Object.assign(new Error("missing"), { code: "ENOENT" }); return files.get(path); },
		mkdirSync() {}, writeFileSync(path, value) { files.set(path, value); }, chmodSync() {}, renameSync() {}
	};
	let ofmReads = 0, desktopCalls = 0;
	const ctx = { get: name => {
		if (name === "webServer") return { getOrigin: () => "http://127.0.0.1:4321" };
		return undefined;
	} };
	const service = new SubUsageService(ctx, {
		io, configPath: "memory/config", now: () => (clock ?? now),
		resolveCredentials: async () => undefined,
		resolveEnvironment: () => undefined,
		resolveOfmUsage: async channel => {
			ofmReads += 1;
			if (!ofm) return undefined;
			return { provider: channel, generatedAt: clock ?? now, accounts: [{ accountId: "ofm-1", nickname: "ofm", balance: { total: 777, packages: [{ name: "包", active: true, remaining: 777, unit: "积分" }] } }] };
		},
		fetch: async url => {
			desktopCalls += 1;
			if (desktop === 404) return { ok: false, status: 404, text: async () => "" };
			return { ok: true, status: 200, text: async () => JSON.stringify(desktop) };
		},
		linkedTimeoutMs: 200
	});
	return { service, counts: () => ({ ofmReads, desktopCalls }) };
}
const BIND_OFM = { sources: { bindings: { "route-a": { linkedId: "raccoon", source: "ofm" } } } };
{
	// 未绑定：独立插件 404、OFM 有数据 —— 也不读 OFM，如实报缺席并给安装指引。
	const { service, counts } = harness({ settings: {} });
	const row = (await service.readLinked({ providerIds: ["raccoon"], force: true, routeId: "route-a" })).entries[0];
	assert.equal(row.state, "error");
	assert.match(row.error, /dsh-raccoon-connect/, "说清该装哪个插件");
	assert.equal(counts().ofmReads, 0, "未绑定路由时不得自动读 OFM 补位");
	service.dispose();
}
{
	// 不传 routeId（全量/工具查询）：同样只走主来源组。
	const { service, counts } = harness({ settings: BIND_OFM });
	const row = (await service.readLinked({ providerIds: ["raccoon"], force: true })).entries[0];
	assert.equal(row.state, "error", "没有路由上下文时绑定不生效");
	assert.equal(counts().ofmReads, 0);
	service.dispose();
}
{
	// 绑定到 OFM：读 OFM，且**不再**先打独立插件。
	const { service, counts } = harness({ settings: BIND_OFM });
	const row = (await service.readLinked({ providerIds: ["raccoon"], force: true, routeId: "route-a" })).entries[0];
	assert.equal(row.state, "ok");
	assert.equal(row.extras.find(x => x.kind === "balance").value, "777 积分");
	assert.equal(counts().ofmReads, 1, "绑定来源是单选的：只读 OFM");
	assert.equal(counts().desktopCalls, 0, "绑定 OFM 后不请求独立插件");
	service.dispose();
}
{
	// 停用 local：只有 plugin 可用。插件 404 → 缺席（不去找 OFM）。
	const { service, counts } = harness({ settings: { sources: { disabled: { raccoon: ["local"] } } } });
	const row = (await service.readLinked({ providerIds: ["raccoon"], force: true, routeId: "route-a" })).entries[0];
	assert.equal(row.state, "error");
	assert.equal(counts().ofmReads, 0);
	service.dispose();
}
{
	// 全部来源被停用：空来源 → 缺席（不是「回退到没停用的」）。
	const { service, counts } = harness({ settings: { sources: { disabled: { raccoon: ["local", "plugin", "ofm"] } } } });
	const row = (await service.readLinked({ providerIds: ["raccoon"], force: true, routeId: "route-a" })).entries[0];
	assert.equal(row.state, "error");
	assert.equal(counts().ofmReads + counts().desktopCalls, 0, "全停用时一个来源都不碰");
	service.dispose();
}
console.log("PASS Host：未绑定不补位、无路由上下文绑定不生效、绑定单选生效、停用与全停用");

// ── [4b] 路由别名：Unified Router 的 Raccoon 订阅版模型面归到同一条目 ──────
{
	// unified-router 0.9.10 起把 Raccoon 拆成 `raccoon`（免费面）与 `raccoon-pro`（订阅面）两个模型路由，
	// 但账号只有一个池、余额同源——两个路由都必须落到同一条联动项，否则选订阅版模型时药丸消失。
	const { service } = harness({ settings: {} });
	// 只测「只指向一条」的写法：`raccoon` 是厂商名，命中 raccoon + ofm-raccoon 两条（既有口径），
	// 那种情况下缺席是静默的，不能用来断言单条归属。
	for (const name of ["raccoon-pro", "raccoonpro"]) {
		const rows = (await service.quota({ providerIds: [name] })).providers.map(row => row.providerId);
		assert.ok(rows.includes("raccoon"), `${name} 应归到 raccoon 条目（实际 ${JSON.stringify(rows)}）`);
	}
	service.dispose();
}

// ── [5] 设置管线：save 补丁、公开投影 ──────────────────────────────────────
{
	const { service } = harness({ settings: {} });
	const initial = await service.read();
	assert.deepEqual(initial.settings.sources.disabled, {});
	assert.deepEqual(initial.settings.sources.bindings, {});
	// 公开投影带每个条目的可用来源与标签，前端不需要复制推导规则。
	assert.deepEqual(initial.settings.sources.available.raccoon, ["local", "plugin", "ofm"]);
	assert.deepEqual(initial.settings.sources.available.antigravity, ["plugin"]);
	assert.equal("router" in initial.settings.sources.labels, false, "router 来源已移除");
	for (const id of CLIENT_FETCH_LINKED_IDS) assert.ok(Array.isArray(initial.settings.sources.available[id]), `${id} 有可用来源投影`);
	// save 补丁：整体替换 disabled 与 bindings。
	const saved = await service.save({ expectedRevision: initial.revision, sources: { disabled: { raccoon: ["local"] }, bindings: { "route-b": { linkedId: "raccoon", source: "ofm" } } } });
	assert.deepEqual(saved.settings.sources.disabled, { raccoon: ["local"] });
	assert.deepEqual(saved.settings.sources.bindings, { "route-b": { linkedId: "raccoon", source: "ofm" } });
	// 再给空对象 = 全部清空。
	const cleared = await service.save({ expectedRevision: saved.revision, sources: { disabled: {}, bindings: {} } });
	assert.deepEqual(cleared.settings.sources.disabled, {});
	assert.deepEqual(cleared.settings.sources.bindings, {});
	// 坏补丁被拒（不让用户的绑定静默丢失）。
	assert.throws(() => subUsageRemote.descriptors.find(d => d.method === "save").parameters[0].codec.schema.parse({ sources: { bindings: { r1: { linkedId: "raccoon", source: "nope" } } } }), /不支持来源|Invalid sources/);
	service.dispose();
}
{
	// 配置文件里的坏来源偏好整体忽略，回到默认（主来源组、不补位），不影响其它设置。
	const files = new Map([["memory/config", JSON.stringify({ sources: { bindings: { r1: { linkedId: "gone", source: "ofm" } } }, visibility: { providers: { deepseek: true } } })]]);
	const io = {
		readFileSync(path) { if (!files.has(path)) throw Object.assign(new Error("missing"), { code: "ENOENT" }); return files.get(path); },
		mkdirSync() {}, writeFileSync(path, value) { files.set(path, value); }, chmodSync() {}, renameSync() {}
	};
	const service = new SubUsageService({ get: () => undefined }, { io, configPath: "memory/config", resolveCredentials: async () => undefined, resolveEnvironment: () => undefined });
	const read = await service.read();
	assert.deepEqual(read.settings.sources.bindings, {}, "坏绑定整体忽略");
	assert.equal(read.settings.visibility.providers.deepseek, true, "其它设置照常保留");
	service.dispose();
}
console.log("PASS 设置管线：默认值、公开投影、save 补丁整体替换与清空、坏补丁拒绝、坏配置忽略");
