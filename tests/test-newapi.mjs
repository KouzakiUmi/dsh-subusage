// New API / one-api 自建站点：站点根规范化、Credits 换算、令牌/账户额度、
// 手动匹配继承与 Client 注册。按仓库约定只测本插件逻辑，不访问真实上游。
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import vm from "node:vm";
import { loadHostModule } from "./helpers.mjs";

const { SubUsageService, newapiRoot, normalizeNewApi } = await loadHostModule();
const ID = "newapi";
const NOW = Date.parse("2026-11-01T00:00:00Z");

const USAGE_UNLIMITED = {
	code: true, message: "ok",
	data: { object: "token_usage", name: "fixture-token", total_granted: 0, total_used: 0, total_available: 0, unlimited_quota: true, model_limits: {}, model_limits_enabled: false, expires_at: 0, user_quota: { total_available: 9388848, total_used: 611152 } }
};
const USAGE_LIMITED = {
	code: true, message: "ok",
	data: { object: "token_usage", name: "limited-token", total_granted: 1000000, total_used: 250000, total_available: 750000, unlimited_quota: false, expires_at: 0 }
};

// ── [1] 站点根规范化 ───────────────────────────────────────────────────
{
	assert.equal(newapiRoot("https://relay.example.com"), "https://relay.example.com");
	assert.equal(newapiRoot("https://relay.example.com/"), "https://relay.example.com");
	assert.equal(newapiRoot("https://relay.example.com/v1"), "https://relay.example.com");
	assert.equal(newapiRoot("https://relay.example.com/api/"), "https://relay.example.com");
	assert.equal(newapiRoot("https://relay.example.com/api/v1"), "https://relay.example.com");
	assert.equal(newapiRoot("https://gw.corp/relay/v1"), "https://gw.corp/relay");
	assert.equal(newapiRoot("http://127.0.0.1:3000"), "http://127.0.0.1:3000");
	assert.equal(newapiRoot("https://relay.example.com/v1?x=1#y"), "https://relay.example.com");
	for (const bad of ["", "   ", "not a url", "ftp://x.com", "file:///etc/passwd", "https://user:pass@x.com", undefined, null, 42]) {
		assert.equal(newapiRoot(bad), "", `非法地址视为未配置：${String(bad)}`);
	}
	console.log("PASS New API 站点根规范化");
}

// ── [2] 归一化（经宿主 windowApi，口径与站内一致） ──────────────────────
{
	const { createWindowApi } = await import("../lib/providers/shared.js");
	const failure = (code, message) => { const e = new Error(message); e.code = code; throw e; };
	const api = createWindowApi({ failure });
	const norm = (body, now = NOW) => normalizeNewApi(body, now, api);
	const out = norm(USAGE_UNLIMITED);
	assert.equal(out.coverage, "complete");
	assert.deepEqual(out.windows, []);
	assert.equal(out.extras.find(x => x.kind === "balance").value, "18.78 Credits");
	assert.equal(out.extras.find(x => x.kind === "spend").value, "1.22 Credits");
	assert.ok(out.extras.some(x => x.kind === "note" && x.value === "无限额度令牌：fixture-token"));
	assert.ok(!out.extras.some(x => x.kind === "account"));
	assert.ok(out.quotas.some(q => q.type === "amount" && q.amount.unit === "Credits"));

	const limited = norm(USAGE_LIMITED);
	assert.equal(limited.windows.length, 1);
	assert.equal(limited.windows[0].kind, "period");
	assert.equal(limited.windows[0].percent, 25);
	assert.equal(limited.windows[0].resetsAt, undefined);
	assert.equal(limited.extras.find(x => x.kind === "balance").value, "1.5 Credits");

	const future = Math.floor(Date.parse("2026-12-01T00:00:00Z") / 1000);
	const expiring = norm({ ...USAGE_LIMITED, data: { ...USAGE_LIMITED.data, expires_at: future } });
	assert.ok(expiring.extras.some(x => x.value === "令牌到期 2026-12-01（还有 30 天）"));
	assert.equal(expiring.windows[0].resetsAt, undefined);

	for (const bad of [{ code: false, message: "Invalid token" }, { success: false, message: "Invalid token" }]) {
		assert.throws(() => norm(bad), e => e.code === "subusage/auth");
	}
	assert.throws(() => norm({ code: true, data: { unlimited_quota: true, total_granted: 0, total_used: 0, total_available: 0 } }), /allow_user_quota_query/);
	assert.throws(() => norm({ code: true, data: { name: "only-meta", expires_at: 0 } }));
	console.log("PASS New API 归一化：换算、无限/有限令牌、到期说明、信封与错误映射");
}

function harness(fetchImpl, overrides = {}) {
	const files = new Map(), calls = [];
	const io = { readFileSync(p) { if (!files.has(p)) throw Object.assign(new Error("missing"), { code: "ENOENT" }); return files.get(p); }, mkdirSync() {}, writeFileSync(p, v) { files.set(p, v); }, chmodSync() {}, renameSync(f, t) { files.set(t, files.get(f)); files.delete(f); } };
	const ctx = overrides.ctx ?? { effect() {}, llm: { listProviders: () => [] } };
	const service = new SubUsageService(ctx, {
		io, configPath: "memory/config", now: () => NOW,
		resolveCredentials: async id => id === ID ? { value: "sk-fixture-newapi" } : undefined,
		resolveEnvironment: () => undefined,
		fetch: async (url, options) => { calls.push({ url, options }); return fetchImpl(url, options); },
		...overrides.options
	});
	return { service, calls, files };
}

// ── [3] Host 端到端 ────────────────────────────────────────────────────
{
	const okFetch = async url => {
		if (!url.endsWith("/api/usage/token") && !url.endsWith("/api/usage/token/")) throw new Error(`unexpected url ${url}`);
		return { ok: true, status: 200, headers: { get: () => null }, text: async () => JSON.stringify(USAGE_UNLIMITED) };
	};
	const h = harness(okFetch);
	let result = await h.service.read();
	assert.equal(result.settings.visibility.providers[ID], false, "默认关闭");
	assert.equal(h.calls.length, 0);
	assert.equal(result.settings.newapi.baseUrl, "");
	result = await h.service.save({ expectedRevision: result.settings.revision, providerId: ID, newapi: { baseUrl: "https://relay.example.com/v1" } });
	assert.equal(result.settings.newapi.baseUrl, "https://relay.example.com/v1", "设置里原样保留用户输入");
	result = await h.service.save({ expectedRevision: result.settings.revision, visibility: { providers: { [ID]: true } } });
	result = await h.service.refresh({ providerIds: [ID], force: true });
	const entry = result.entries.find(e => e.providerId === ID);
	assert.equal(entry.state, "ok");
	assert.equal(h.calls.length, 1);
	assert.equal(h.calls[0].url, "https://relay.example.com/api/usage/token", "文档路径优先，/v1 已被去掉");
	assert.match(h.calls[0].options.headers.authorization, /^Bearer sk-fixture-newapi$/);
	assert.equal(entry.extras.find(x => x.kind === "balance").value, "18.78 Credits");
	assert.ok(!JSON.stringify(result).includes("sk-fixture-newapi"));
	result = await h.service.save({ expectedRevision: result.settings.revision, providerId: ID, newapi: { baseUrl: "  " } });
	result = await h.service.refresh({ providerIds: [ID], force: true });
	assert.equal(result.entries.find(e => e.providerId === ID).state, "error");
	h.service.dispose();

	const denied = harness(async () => ({ ok: false, status: 401, headers: { get: () => null }, text: async () => "{}" }));
	result = await denied.service.read();
	result = await denied.service.save({ expectedRevision: result.settings.revision, providerId: ID, newapi: { baseUrl: "https://relay.example.com" } });
	result = await denied.service.save({ expectedRevision: result.settings.revision, visibility: { providers: { [ID]: true } } });
	const e401 = (await denied.service.refresh({ providerIds: [ID], force: true })).entries[0];
	assert.equal(e401.state, "error");
	assert.match(e401.error, /同一把 sk- Key/);
	denied.service.dispose();
	console.log("PASS New API Host：默认关闭、地址来自设置、Bearer、缺地址/401 映射");
}

// ── [4] 手动匹配继承 ───────────────────────────────────────────────────
{
	const route = { provider: "yyapi", settingsNs: "llm-pi-ai", settingsPath: ["providers", "yyapi"] };
	const ctx = { effect() {}, llm: { listProviders: () => [{ id: "yyapi" }], listConfigurableProviders: () => [route] } };
	const settingsService = { describe: () => [{ ns: "llm-pi-ai", value: { providers: { yyapi: { apiKeyEnv: "CUSTOM_RELAY_API_KEY", baseURL: "https://www.relay.example.com/v1" } } } }] };
	const h = harness(async () => ({ ok: true, status: 200, headers: { get: () => null }, text: async () => JSON.stringify(USAGE_UNLIMITED) }), {
		ctx, options: { settingsService, resolveCredentials: async (id, ref) => id === ID && ref === "CUSTOM_RELAY_API_KEY" ? { value: "sk-mapped-route" } : undefined }
	});
	let result = await h.service.read();
	result = await h.service.save({ expectedRevision: result.settings.revision, visibility: { manualMatching: true, providerMappings: { [ID]: ["yyapi"] }, providers: { [ID]: true } } });
	result = await h.service.refresh({ providerIds: [ID], force: true });
	assert.equal(result.entries[0].state, "ok", "绑定路由后用路由的站点与 Key 取数");
	assert.equal(h.calls[0].url, "https://www.relay.example.com/api/usage/token");
	assert.match(h.calls[0].options.headers.authorization, /^Bearer sk-mapped-route$/);
	result = await h.service.save({ expectedRevision: result.settings.revision, visibility: { manualMatching: false } });
	assert.deepEqual(result.settings.visibility.providerMappings[ID], ["yyapi"], "关闭开关保留映射");
	result = await h.service.refresh({ providerIds: [ID], force: true });
	assert.equal(result.entries[0].state, "no-key", "关闭手动匹配后不再沿用路由 Key");
	h.service.dispose();
	console.log("PASS New API 手动匹配：继承路由 baseURL/apiKeyEnv、关闭即停止");
}

// ── [5] Client 注册 ────────────────────────────────────────────────────
{
	let spec;
	const react = { createElement: () => null, Fragment: "fragment", useState: (v) => [typeof v === "function" ? v() : v, () => {}], useRef: (v) => ({ current: v }), useEffect: () => {}, useMemo: (f) => f(), useCallback: (f) => f(), useSyncExternalStore: () => null };
	const code = readFileSync(fileURLToPath(new URL("../lib/client.js", import.meta.url)), "utf8");
	vm.runInNewContext(code.replace("exports.apply = apply;", "exports.__test = { PROVIDER_ORDER, PROVIDER_META, ROUTE_PROVIDER_ALIAS, draftFor, settingsPatch, providerVisible, balanceVisual }; exports.apply = apply;"), { window: { __ModuleLoader__: { load: (value) => { spec = value; } } }, console });
	const api = spec.factory((name) => { assert.equal(name, "react"); return react; }).__test;
	assert.ok(api.PROVIDER_ORDER.includes(ID));
	assert.equal(api.PROVIDER_ORDER.indexOf(ID), api.PROVIDER_ORDER.indexOf("apigoto") + 1);
	assert.equal(api.PROVIDER_META[ID].envName, "NEWAPI_API_KEY");
	assert.equal(api.PROVIDER_META[ID].defaultEnabled, false);
	assert.equal(api.ROUTE_PROVIDER_ALIAS["new-api"], ID);
	assert.equal(api.ROUTE_PROVIDER_ALIAS["one-api"], ID);
	const draft = api.draftFor({ keyModes: {}, newapi: { baseUrl: "https://relay.example.com/v1" } }, ID);
	assert.equal(draft.newapi.baseUrl, "https://relay.example.com/v1");
	assert.equal(api.settingsPatch(ID, draft, "rev").newapi.baseUrl, "https://relay.example.com/v1");
	const visible = api.providerVisible({ visibility: { hideWithoutApi: true, providers: { [ID]: true } } }, ID, undefined, { entries: [], settings: { hasKeys: {}, keyModes: { [ID]: "inherit" } }, configured: {} });
	assert.equal(visible, true, "余额型豁免：无同名路由也能查");
	const visual = api.balanceVisual({ providerId: ID, extras: [{ kind: "balance", value: "18.78 Credits" }] }, key => key);
	assert.equal(visual.color, "#22c55e");
	assert.equal(visual.icon, "✓");
	assert.equal(api.balanceVisual({ providerId: "commandcode", extras: [{ kind: "balance", value: "18.78 Credits" }] }, key => key).icon, "ℹ", "其它家 credits 不套用");
	console.log("PASS New API Client：注册、顺序、别名、草稿补丁、可见性与配色");
}

console.log("\nNew API 适配测试全部通过 ✅");
