// New API（new-api / one-api）余额：站点地址 + 推理同一把 sk- Key + 令牌/账户额度。
// 契约来自 2026-11-01 用用户提供的演示 Key 只读核对过的响应形状；这里用同形状的虚构数据复现，
// 不访问真实接口、不写入真实 Key。额度单位按站点标准 500000 quota = 1 Credits。
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import vm from "node:vm";
import { loadHostModule } from "./helpers.mjs";

const { SubUsageService, subUsageRemote, newapiRoot, normalizeNewApi } = await loadHostModule();
const ID = "newapi";
const NOW = Date.parse("2026-11-01T00:00:00Z");

// 无限制令牌 + 账户额度：演示站实测形状（数值为虚构夹具）。
const USAGE_UNLIMITED = {
	code: true,
	message: "ok",
	data: {
		object: "token_usage",
		name: "fixture-token",
		total_granted: 0,
		total_used: 0,
		total_available: 0,
		unlimited_quota: true,
		model_limits: {},
		model_limits_enabled: false,
		expires_at: 0,
		user_quota: { total_available: 9388848, total_used: 611152 }
	}
};
// 有限令牌：自身有 2 Credits 上限，已用 0.5。
const USAGE_LIMITED = {
	code: true,
	message: "ok",
	data: {
		object: "token_usage",
		name: "limited-token",
		total_granted: 1000000,
		total_used: 250000,
		total_available: 750000,
		unlimited_quota: false,
		expires_at: 0
	}
};

// ── [1] 站点地址规范化 ───────────────────────────────────────────────────
{
	assert.equal(newapiRoot("https://relay.example.com"), "https://relay.example.com");
	assert.equal(newapiRoot("https://relay.example.com/"), "https://relay.example.com", "去掉尾部斜杠");
	assert.equal(newapiRoot("https://relay.example.com/v1"), "https://relay.example.com", "去掉 /v1（OpenAI 兼容地址）");
	assert.equal(newapiRoot("https://relay.example.com/api/"), "https://relay.example.com", "去掉 /api");
	assert.equal(newapiRoot("https://relay.example.com/api/v1"), "https://relay.example.com", "同时带 /api 与 /v1 时都去掉");
	assert.equal(newapiRoot("https://gw.corp/relay/v1"), "https://gw.corp/relay", "保留自建子路径，只去掉一层版本段");
	assert.equal(newapiRoot("http://127.0.0.1:3000"), "http://127.0.0.1:3000", "自建常跑在本地端口");
	assert.equal(newapiRoot("https://relay.example.com/v1?x=1#y"), "https://relay.example.com", "丢弃 query/hash");
	for (const bad of ["", "   ", "not a url", "ftp://x.com", "file:///etc/passwd", "https://user:pass@x.com", undefined, null, 42]) {
		assert.equal(newapiRoot(bad), "", `非法地址视为未配置：${String(bad)}`);
	}
	console.log("PASS New API 地址规范化：去尾斜杠与 /v1、/api、保留子路径、拒绝非 http(s) 与带凭据 URL");
}

// ── [2] 归一化 ───────────────────────────────────────────────────────────
{
	const out = normalizeNewApi(USAGE_UNLIMITED, NOW);
	assert.equal(out.coverage, "complete");
	assert.deepEqual(out.windows, [], "无限制令牌不产额度窗口");
	const balance = out.extras.find(x => x.kind === "balance");
	assert.equal(balance.value, "18.78 Credits", "账户余额按 500000 = 1 Credits 换算并收敛两位小数");
	const spend = out.extras.find(x => x.kind === "spend");
	assert.equal(spend.value, "1.22 Credits", "账户累计消费用 spend，不放进 balance");
	assert.ok(out.extras.some(x => x.kind === "note" && x.value === "无限额度令牌：fixture-token"), "说明这是无限额度令牌");
	assert.ok(!out.extras.some(x => x.kind === "account"), "不产 account 附加行");

	// 有限令牌：额度窗口 + 令牌余额；没有账户额度时不出现账户说明。
	const limited = normalizeNewApi(USAGE_LIMITED, NOW);
	assert.equal(limited.coverage, "complete");
	assert.equal(limited.windows.length, 1);
	assert.equal(limited.windows[0].kind, "period");
	assert.equal(limited.windows[0].percent, 25, "used / granted 算百分比");
	assert.equal(limited.windows[0].resetsAt, undefined, "令牌额度没有重置时间，不编造");
	assert.deepEqual(limited.windows[0].detail, { used: 0.5, limit: 2, remaining: 1.5, unit: "Credits" });
	assert.equal(limited.extras.find(x => x.kind === "balance").value, "1.5 Credits");
	assert.ok(!limited.extras.some(x => x.kind === "spend"), "有限令牌的已用已在窗口里，不重复报账户消费");

	// 有限令牌 + 账户额度：主余额仍是令牌可用额度，账户钱包只作说明，两个池不合并。
	const both = normalizeNewApi({ ...USAGE_LIMITED, data: { ...USAGE_LIMITED.data, user_quota: { total_available: 9388848, total_used: 611152 } } }, NOW);
	assert.equal(both.extras.find(x => x.kind === "balance").value, "1.5 Credits", "主余额取令牌可用额度");
	assert.ok(both.extras.some(x => x.kind === "note" && x.value === "账户余额另有 18.78 Credits"), "账户钱包另起说明");
	assert.ok(!both.extras.some(x => x.kind === "spend"), "两个池的 used 不混报");
	const zeroWallet = normalizeNewApi({ ...USAGE_LIMITED, data: { ...USAGE_LIMITED.data, user_quota: { total_available: 0 } } }, NOW);
	assert.ok(zeroWallet.extras.some(x => x.value === "账户余额为 0"), "账户余额为 0 也要说，避免误以为令牌额度可单独使用");
	const negativeWallet = normalizeNewApi({ ...USAGE_LIMITED, data: { ...USAGE_LIMITED.data, user_quota: { total_available: -500000 } } }, NOW);
	assert.ok(negativeWallet.extras.some(x => x.value === "账户余额为负（-1 Credits）"), "负余额如实说明，不夹成 0");

	// 显式非无限但全 0：这是确定的 0 余额，不是未知。
	const zero = normalizeNewApi({ code: true, data: { total_granted: 0, total_used: 0, total_available: 0, unlimited_quota: false } }, NOW);
	assert.equal(zero.extras.find(x => x.kind === "balance").value, "0 Credits");
	assert.deepEqual(zero.windows, []);

	// 无限额度却没有 user_quota：没有可读余额，给可行动错误，而不是报 0。
	assert.throws(() => normalizeNewApi({ code: true, data: { unlimited_quota: true, total_granted: 0, total_used: 0, total_available: 0 } }, NOW), /allow_user_quota_query/);
	// 什么都没读到：不能把令牌名/到期当额度。
	assert.throws(() => normalizeNewApi({ code: true, data: { name: "only-meta", expires_at: 0 } }, NOW));
	// 旧版 one-api 不报 unlimited_quota：令牌没有任何额度数字时，账户余额是唯一可读池。
	const legacy = normalizeNewApi({ success: true, data: { name: "legacy", user_quota: { total_available: 500000, total_used: 100000 } } }, NOW);
	assert.equal(legacy.extras.find(x => x.kind === "balance").value, "1 Credits");
	assert.equal(legacy.extras.find(x => x.kind === "spend").value, "0.2 Credits");
	assert.ok(legacy.extras.some(x => x.kind === "note" && x.value === "账户余额 · 令牌：legacy"));

	// 到期日只作说明行，不写进 resetsAt。
	const future = Math.floor(Date.parse("2026-12-01T00:00:00Z") / 1000);
	const expiring = normalizeNewApi({ ...USAGE_LIMITED, data: { ...USAGE_LIMITED.data, expires_at: future } }, NOW);
	assert.ok(expiring.extras.some(x => x.value === "令牌到期 2026-12-01（还有 30 天）"));
	assert.equal(expiring.windows[0].resetsAt, undefined);
	const expired = normalizeNewApi({ ...USAGE_LIMITED, data: { ...USAGE_LIMITED.data, expires_at: future } }, Date.parse("2026-12-05T00:00:00Z"));
	assert.ok(expired.extras.some(x => x.value === "令牌已于 2026-12-01 到期"), "已过期改写，不显示「还有 0 天」");

	// 两代成功信封都认；显式失败是认证错误，且带上截断后的上游 message。
	assert.equal(normalizeNewApi({ success: true, data: { total_granted: 1000000, total_used: 0, total_available: 1000000, unlimited_quota: false } }, NOW).extras.find(x => x.kind === "balance").value, "2 Credits");
	for (const bad of [{ code: false, message: "Invalid token" }, { success: false, message: "Invalid token" }]) {
		assert.throws(() => normalizeNewApi(bad, NOW), error => error.code === "subusage/auth" && error.message.includes("Invalid token"));
	}
	for (const bad of [undefined, null, {}, [], { code: true }, { code: true, data: [] }, { message: "no marker", data: {} }]) {
		assert.throws(() => normalizeNewApi(bad, NOW), `非法响应必须报错：${JSON.stringify(bad)}`);
	}
	console.log("PASS New API 归一化：Credits 换算、无限/有限令牌、账户余额说明、到期不进 resetsAt、两种信封与错误映射");
}

// ── [3] Host 端到端：默认关闭、地址来自设置、Bearer、缓存失效与错误映射 ──
{
	function harness(fetchImpl) {
		const files = new Map(), calls = [];
		const io = {
			readFileSync(path) { if (!files.has(path)) throw Object.assign(new Error("missing"), { code: "ENOENT" }); return files.get(path); },
			mkdirSync() {}, writeFileSync(path, value) { files.set(path, value); }, chmodSync() {},
			renameSync(from, to) { files.set(to, files.get(from)); files.delete(from); }
		};
		const service = new SubUsageService({ effect() {}, llm: { listProviders: () => [] } }, {
			io, configPath: "memory/config", now: () => NOW,
			resolveCredentials: async id => id === ID ? { value: "sk-fixture-newapi" } : undefined,
			resolveEnvironment: () => undefined,
			fetch: async (url, options) => { calls.push({ url, options }); return fetchImpl(url, options); }
		});
		return { service, calls, files };
	}
	const okFetch = async url => {
		if (!url.endsWith("/api/usage/token/")) throw new Error(`unexpected url ${url}`);
		return { ok: true, status: 200, headers: { get: () => null }, text: async () => JSON.stringify(USAGE_UNLIMITED) };
	};

	const h = harness(okFetch);
	let result = await h.service.read();
	assert.equal(result.settings.visibility.providers[ID], false, "默认关闭");
	assert.equal(h.calls.length, 0, "默认关闭时即使继承到 Key 也不访问网络");
	assert.equal(result.settings.newapi.baseUrl, "", "公开设置带站点地址且默认为空");

	// 站点地址补丁：只接受 newapi 自己、只含 baseUrl。
	const save = subUsageRemote.descriptors.find(d => d.method === "save").parameters[0].codec.schema;
	assert.equal(save.parse({ providerId: ID, newapi: { baseUrl: "https://relay.example.com/v1" } }).newapi.baseUrl, "https://relay.example.com/v1");
	for (const patch of [
		{ providerId: "deepseek", newapi: { baseUrl: "https://x" } },
		{ providerId: ID, newapi: { baseUrl: 1 } },
		{ providerId: ID, newapi: { baseUrl: "https://x", extra: true } },
		{ providerId: ID, newapi: { baseUrl: "https://x\n" } }
	]) assert.throws(() => save.parse(patch), `非法 New API 补丁必须拒绝：${JSON.stringify(patch)}`);

	result = await h.service.save({ expectedRevision: result.settings.revision, providerId: ID, newapi: { baseUrl: "https://relay.example.com/v1" } });
	assert.equal(result.settings.newapi.baseUrl, "https://relay.example.com/v1", "设置里原样保留用户输入");
	result = await h.service.save({ expectedRevision: result.settings.revision, visibility: { providers: { [ID]: true } } });
	result = await h.service.refresh({ providerIds: [ID], force: true });
	const entry = result.entries.find(e => e.providerId === ID);
	assert.equal(entry.state, "ok");
	assert.equal(h.calls.length, 1, "只请求令牌用量端点");
	assert.equal(h.calls[0].url, "https://relay.example.com/api/usage/token/", "尾斜杠 + 站点根，/v1 已被去掉");
	assert.match(h.calls[0].options.headers.authorization, /^Bearer sk-fixture-newapi$/, "推理同一把 sk- Key");
	assert.equal(entry.extras.find(x => x.kind === "balance").value, "18.78 Credits");
	assert.ok(!JSON.stringify(result).includes("sk-fixture-newapi"), "响应不回显 Key");

	// 改站点地址：指纹与保存失效都要求重新取数。
	result = await h.service.save({ expectedRevision: result.settings.revision, providerId: ID, newapi: { baseUrl: "https://second.example.com/relay/api" } });
	result = await h.service.refresh({ providerIds: [ID], force: true });
	assert.equal(h.calls.length, 2);
	assert.equal(h.calls[1].url, "https://second.example.com/relay/api/usage/token/", "保留子路径，只去掉 /api");
	assert.equal(result.entries.find(e => e.providerId === ID).state, "ok");

	// 清空地址：按「未配置」处理，不再发请求。
	const before = h.calls.length;
	result = await h.service.save({ expectedRevision: result.settings.revision, providerId: ID, newapi: { baseUrl: "  " } });
	result = await h.service.refresh({ providerIds: [ID], force: true });
	const missing = result.entries.find(e => e.providerId === ID);
	assert.equal(missing.state, "error");
	assert.equal(missing.errorCode, "subusage/credentials");
	assert.match(missing.error, /未配置 New API 站点地址/);
	assert.equal(h.calls.length, before, "缺地址不访问网络");
	h.service.dispose();

	// 401：映射成可行动的认证错误，而不是泛化失败。
	const auth = harness(async () => ({ ok: false, status: 401, headers: { get: () => null }, text: async () => "{}" }));
	result = await auth.service.read();
	result = await auth.service.save({ expectedRevision: result.settings.revision, providerId: ID, newapi: { baseUrl: "https://relay.example.com" } });
	result = await auth.service.save({ expectedRevision: result.settings.revision, visibility: { providers: { [ID]: true } } });
	const denied = (await auth.service.refresh({ providerIds: [ID], force: true })).entries[0];
	assert.equal(denied.state, "error");
	assert.equal(denied.errorCode, "subusage/auth");
	assert.match(denied.error, /同一把 sk- Key/);
	auth.service.dispose();

	// 404：站点不是 New API / 版本过旧。
	const notFound = harness(async () => ({ ok: false, status: 404, headers: { get: () => null }, text: async () => "{}" }));
	result = await notFound.service.read();
	result = await notFound.service.save({ expectedRevision: result.settings.revision, providerId: ID, newapi: { baseUrl: "https://relay.example.com" } });
	result = await notFound.service.save({ expectedRevision: result.settings.revision, visibility: { providers: { [ID]: true } } });
	const absent = (await notFound.service.refresh({ providerIds: [ID], force: true })).entries[0];
	assert.equal(absent.state, "error");
	assert.match(absent.error, /没有 \/api\/usage\/token\//);
	notFound.service.dispose();

	// HTTP 200 + success:false：one-api 系把失败放在信封里，必须映射为认证错误。
	const business = harness(async () => ({ ok: true, status: 200, headers: { get: () => null }, text: async () => JSON.stringify({ success: false, message: "Invalid token" }) }));
	result = await business.service.read();
	result = await business.service.save({ expectedRevision: result.settings.revision, providerId: ID, newapi: { baseUrl: "https://relay.example.com" } });
	result = await business.service.save({ expectedRevision: result.settings.revision, visibility: { providers: { [ID]: true } } });
	const refused = (await business.service.refresh({ providerIds: [ID], force: true })).entries[0];
	assert.equal(refused.state, "error");
	assert.equal(refused.errorCode, "subusage/auth");
	assert.match(refused.error, /Invalid token/);
	business.service.dispose();
	console.log("PASS New API Host：默认关闭、地址来自设置、尾斜杠端点与 Bearer、改地址重新取数、缺地址/401/404/业务失败映射");
}

// ── [4] Client：注册、顺序、地址草稿与补丁、余额型可见性 ─────────────────
{
	let spec;
	const react = { createElement: () => null, Fragment: "fragment", useState: (v) => [typeof v === "function" ? v() : v, () => {}], useRef: (v) => ({ current: v }), useEffect: () => {}, useMemo: (f) => f(), useSyncExternalStore: () => null };
	const code = readFileSync(fileURLToPath(new URL("../lib/client.js", import.meta.url)), "utf8");
	vm.runInNewContext(code.replace("exports.apply = apply;", "exports.__test = { PROVIDER_ORDER, PROVIDER_META, ROUTE_PROVIDER_ALIAS, draftFor, settingsPatch, providerVisible, balanceText }; exports.apply = apply;"), { window: { __ModuleLoader__: { load: (value) => { spec = value; } } }, console });
	const api = spec.factory((name) => { assert.equal(name, "react"); return react; }).__test;
	const flat = (v) => JSON.stringify(v);
	assert.ok(api.PROVIDER_ORDER.includes(ID), "newapi 在提供商顺序中");
	assert.ok(api.PROVIDER_ORDER.indexOf(ID) > api.PROVIDER_ORDER.indexOf("apigoto"), "追加在既有条目之后");
	assert.equal(api.PROVIDER_META[ID].defaultEnabled, false);
	assert.equal(api.PROVIDER_META[ID].envName, "NEWAPI_API_KEY");
	assert.equal(api.ROUTE_PROVIDER_ALIAS["new-api"], ID, "new-api 路由归并到本订阅");
	assert.equal(api.ROUTE_PROVIDER_ALIAS["one-api"], ID, "one-api 路由归并到本订阅");

	const draft = api.draftFor({ keyModes: {}, newapi: { baseUrl: "https://relay.example.com/v1" } }, ID);
	assert.equal(draft.newapi.baseUrl, "https://relay.example.com/v1", "地址回填");
	assert.equal(flat(api.settingsPatch(ID, draft, "rev").newapi), flat({ baseUrl: "https://relay.example.com/v1" }));
	assert.equal(flat(api.settingsPatch(ID, { ...draft, newapi: { baseUrl: "  https://relay.example.com/  " } }, "rev").newapi), flat({ baseUrl: "https://relay.example.com/" }), "提交前 trim");
	assert.equal(api.settingsPatch(ID, { ...draft, newapi: { baseUrl: "   " } }, "rev").newapi.baseUrl, "", "全空白归一成空串（清空语义）");
	assert.equal(api.settingsPatch("deepseek", api.draftFor({}, "deepseek"), "rev").newapi, undefined, "别的 provider 不提交 New API 补丁");

	// 余额型：没有同名路由、没有手动 Key 时仍可查询（站点地址 + 额外引用名即可）。
	const visible = api.providerVisible({ visibility: { hideWithoutApi: true, providers: { [ID]: true } } }, ID, undefined, { entries: [], settings: { hasKeys: {}, keyModes: { [ID]: "inherit" } }, configured: {} });
	assert.equal(visible, true, "New API 不按模型路由收起");
	assert.equal(api.balanceText({ providerId: ID, extras: [{ kind: "balance", value: "18.78 Credits" }] }, key => key), "balanceLabel 18.78 Credits");
	console.log("PASS New API Client：注册、顺序、路由别名、地址草稿/补丁、余额型可见性与 Credits 文案");
}

console.log("\nNew API 适配测试全部通过 ✅");
