// 中转聚合商三家：APIGOTO / 七牛云（qnaigc）/ UnoRouter。
// 契约全部来自 2026-10-30 用真实 Key 实测的响应，这里用同形状的虚构响应复现，
// 不访问真实接口、不写入真实 Key。
//
// 三家最容易搞错的两件事，正是本文件重点：
//   1. 七牛云只有**花费**接口（人民币元），没有余额接口 —— 花费不能当余额显示；
//   2. UnoRouter 的 unlimited_quota 与负的 total_available 不是「欠费」——
//      无限额度 Key 没有余额可言，只报累计消费。
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import vm from "node:vm";
import { loadHostModule } from "./helpers.mjs";

const { SubUsageService, normalizeApigoto, normalizeQnaigc, normalizeUnorouter } = await loadHostModule();

// 实测响应（2026-10-30），只把 Key 与账号名替换掉。
const APIGOTO_BODY = {
	is_active: true,
	isValid: true,
	mode: "subscription",
	remaining: 4.423321662329796,
	unit: "USD",
	subscription: {
		plan_name: "RouterCode PLUS-1027",
		policy_name: "APIGOTO PLUS-1027",
		expires_at: "2026-11-29T23:59:12Z",
		used: 20466109.3723,
		limit: 50000000,
		window_sec: 604800,
		unit: "rpm_credits"
	},
	points: 0,
	balance: "0.00000000",
	balance_usd: "0.00000000"
};
const QNAIGC_BODY = {
	status: true,
	data: { timezone: "Asia/Shanghai", api_keys: [{ api_key: "sk-33***05db7", name: "default", total_fee: 0.07, models: [] }] }
};
const UNOROUTER_BODY = {
	success: true,
	message: "",
	data: {
		object: "token_usage",
		name: "DSH",
		total_granted: 7228917,
		total_used: 13215921,
		total_available: -5987004,
		unlimited_quota: true,
		model_limits: {},
		model_limits_enabled: false,
		expires_at: 0
	}
};

// ── [1] APIGOTO 归一化 ───────────────────────────────────────────────────
{
	const out = normalizeApigoto(APIGOTO_BODY);
	assert.equal(out.coverage, "complete");
	assert.equal(out.windows.length, 1, "窗口只有一个");
	const [w] = out.windows;
	// window_sec = 604800 —— 一周，按秒数判定，不从套餐名猜。
	assert.equal(w.kind, "week", "窗口档位由 window_sec 决定");
	assert.equal(w.percent, 40.9, "百分比由 used/limit 算出并收敛到一位小数");
	assert.equal(w.status, "ok");
	assert.equal(w.resetsAt, undefined, "expires_at 是套餐到期时间，不能当成窗口重置时间");
	assert.equal(w.detail.unit, "rpm_credits", "窗口单位如实透传");
	assert.equal(w.detail.used, 20466109);
	assert.equal(w.detail.limit, 50000000);

	const plan = out.extras.find(x => x.kind === "plan");
	assert.ok(plan.value.includes("RouterCode PLUS-1027"), "套餐名在 plan 里");
	assert.ok(plan.value.includes("2026-11-29"), "套餐到期日作为文字带出，而不是伪装成 resetsAt");

	// 关键：套餐内 remaining 是主余额；充值钱包 balance_usd 为 0 不能盖掉它、
	// 也不能变成红色「余额耗尽」告警。
	const balance = out.extras.find(x => x.kind === "balance");
	assert.equal(balance.value, "4.42 USD", "主余额取套餐内 remaining，不是 0 元的充值钱包");
	assert.ok(!out.extras.some(x => x.kind === "note" && x.value.includes("钱包")), "钱包为 0 时不额外占一行");

	// 钱包确实有余额时才提一句。
	const withWallet = normalizeApigoto({ ...APIGOTO_BODY, balance_usd: "2.50000000" });
	assert.ok(withWallet.extras.some(x => x.kind === "note" && x.value.includes("2.5 USD")), "钱包有余额时说明");

	// 套餐失效是上游明确状态，要说出来。
	assert.ok(normalizeApigoto({ ...APIGOTO_BODY, is_active: false }).extras.some(x => x.kind === "note" && x.value.includes("停用")), "套餐停用要提示");

	// 上游改口径时宁可报错也不编数字。
	for (const bad of [undefined, null, {}, [], { subscription: null }]) {
		assert.throws(() => normalizeApigoto(bad), `非法响应必须报错：${JSON.stringify(bad)}`);
	}
	console.log("PASS APIGOTO：按 window_sec 定档、resetsAt 不误用 expires_at、套餐余额优先于 0 元钱包");
}

// ── [2] 七牛云归一化：花费，不是余额 ─────────────────────────────────────
{
	const out = normalizeQnaigc(QNAIGC_BODY, "month");
	assert.deepEqual(out.windows, [], "只有花费，没有额度窗口");
	const spend = out.extras.find(x => x.kind === "spend");
	assert.equal(spend.value, "0.07 CNY", "花费用人民币，且**不是** balance 类型");
	assert.ok(!out.extras.some(x => x.kind === "balance"), "绝不能产出 balance：会把花费读成余额");
	assert.ok(out.extras.some(x => x.kind === "note" && x.value.includes("本月消耗")), "口径写在 note 里");
	// 口径随 type 变化。
	assert.ok(normalizeQnaigc(QNAIGC_BODY, "day").extras.some(x => x.kind === "note" && x.value.includes("今日消耗")));
	assert.ok(normalizeQnaigc(QNAIGC_BODY, "week").extras.some(x => x.kind === "note" && x.value.includes("本周消耗")));
	// 多 Key 分组时求和（本插件用 Key 级鉴权只会有一条，但不把可能的多条丢掉）。
	assert.equal(normalizeQnaigc({ status: true, data: { api_keys: [{ total_fee: 0.1 }, { total_fee: 0.2 }] } }).extras[0].value, "0.3 CNY");
	// 非法响应报错，不当作 0 元。
	for (const bad of [undefined, null, {}, { status: true }, { status: true, data: {} }, { status: true, data: [] }]) {
		assert.throws(() => normalizeQnaigc(bad), `非法响应必须报错：${JSON.stringify(bad)}`);
	}
	assert.throws(() => normalizeQnaigc({ status: true, data: { api_keys: [{ total_fee: -1 }] } }), "负花费说明口径变了，报错");
	console.log("PASS 七牛云：spend 而非 balance、口径写进 note、非法值报错");
}

// ── [3] UnoRouter 归一化：无限额度 ≠ 欠费 ────────────────────────────────
{
	const out = normalizeUnorouter(UNOROUTER_BODY);
	assert.deepEqual(out.windows, [], "new-api 单 Key 没有窗口");
	assert.ok(!out.extras.some(x => x.kind === "balance"), "无限额度不报余额，避免与负的 total_available 自相矛盾");
	const spend = out.extras.find(x => x.kind === "spend");
	// 13215921 / 500000 = 26.4318…，官方口径 500000 单位 = 1 USD。
	assert.equal(spend.value, "26.43 USD", "累计消费按 500000 单位 = 1 USD 换算");
	assert.ok(out.extras.some(x => x.kind === "note" && x.value.includes("无限额度")), "无限额度要说明清楚");
	assert.equal(out.extras.find(x => x.kind === "account").value, "DSH", "Key 名称作为账户标注");

	// 有上限的普通 Key：余额取 total_available。
	const capped = normalizeUnorouter({ success: true, data: { name: "k", total_granted: 1000000, total_used: 250000, total_available: 750000, unlimited_quota: false } });
	assert.equal(capped.extras.find(x => x.kind === "balance").value, "1.5 USD");
	// 缺 total_available 时用 granted - used 兜底。
	assert.equal(normalizeUnorouter({ success: true, data: { total_granted: 1000000, total_used: 250000, unlimited_quota: false } }).extras.find(x => x.kind === "balance").value, "1.5 USD");

	// new-api 的失败也返回 HTTP 200，只是 success=false —— 归一化不认这个形状。
	for (const bad of [undefined, null, {}, { success: false, message: "x" }, { success: true }, { success: true, data: [] }]) {
		assert.throws(() => normalizeUnorouter(bad), `非法响应必须报错：${JSON.stringify(bad)}`);
	}
	console.log("PASS UnoRouter：无限额度只报累计消费、500000 单位换算、success=false 不算成功");
}

// ── [4] Host 端到端：三家各自请求、默认关闭、Key 不回显 ──────────────────
{
	const files = new Map(), calls = [];
	const io = {
		readFileSync(path) { if (!files.has(path)) throw Object.assign(new Error("missing"), { code: "ENOENT" }); return files.get(path); },
		mkdirSync() {}, writeFileSync(path, value) { files.set(path, value); }, chmodSync() {},
		renameSync(from, to) { files.set(to, files.get(from)); files.delete(from); }
	};
	const keys = { apigoto: "sk-fixture-apigoto", qnaigc: "sk-fixture-qnaigc", unorouter: "sk-fixture-unorouter" };
	const bodies = { "api.apigoto.com": APIGOTO_BODY, "api.qnaigc.com": QNAIGC_BODY, "api.unorouter.com": UNOROUTER_BODY };
	const service = new SubUsageService({ effect() {}, llm: { listProviders: () => [] } }, {
		io, configPath: "memory/config",
		resolveCredentials: async id => keys[id] ? { value: keys[id] } : undefined,
		resolveEnvironment: () => undefined,
		fetch: async (url, options) => {
			calls.push({ url, options });
			const hostname = new URL(url).hostname;
			const body = bodies[hostname];
			if (!body) throw new Error(`unexpected host ${hostname}`);
			return { ok: true, status: 200, headers: { get: () => null }, text: async () => JSON.stringify(body) };
		}
	});

	let result = await service.read();
	for (const id of ["apigoto", "qnaigc", "unorouter"]) {
		assert.equal(result.settings.visibility.providers[id], false, `${id} 默认关闭`);
	}
	assert.equal(calls.length, 0, "默认关闭时即使继承到 Key 也不访问网络");

	result = await service.save({ expectedRevision: result.settings.revision, visibility: { providers: { apigoto: true, qnaigc: true, unorouter: true } } });
	result = await service.refresh({ providerIds: ["apigoto", "qnaigc", "unorouter"], force: true });
	const byId = new Map(result.entries.map(e => [e.providerId, e]));
	for (const id of ["apigoto", "qnaigc", "unorouter"]) assert.equal(byId.get(id).state, "ok", `${id} 读取成功`);

	const urls = Object.fromEntries(calls.map(c => [new URL(c.url).hostname, c.url]));
	assert.equal(urls["api.apigoto.com"], "https://api.apigoto.com/v1/usage");
	assert.equal(urls["api.qnaigc.com"], "https://api.qnaigc.com/v3/stat/usage/apikey/cost?type=month");
	assert.equal(urls["api.unorouter.com"], "https://api.unorouter.com/api/usage/token/");
	for (const call of calls) assert.match(call.options.headers.authorization, /^Bearer sk-fixture-/, "三家都用推理 Key 的 Bearer");

	assert.equal(byId.get("apigoto").windows[0].kind, "week");
	assert.equal(byId.get("qnaigc").extras.find(x => x.kind === "spend").value, "0.07 CNY");
	assert.equal(byId.get("unorouter").extras.find(x => x.kind === "spend").value, "26.43 USD");

	// 任何一把 Key 都不能出现在返回体里。
	const wire = JSON.stringify(result);
	for (const key of Object.values(keys)) assert.ok(!wire.includes(key), "响应不回显 Key");
	assert.equal(service.dispose(), undefined);
	console.log("PASS 三家 Host：默认关闭、各自端点、Bearer 同 Key、响应不回显 Key");
}

// ── [5] UnoRouter success=false 在 Host 侧变成认证错误而不是数字 ──────────
{
	const files = new Map();
	const io = {
		readFileSync(path) { if (!files.has(path)) throw Object.assign(new Error("missing"), { code: "ENOENT" }); return files.get(path); },
		mkdirSync() {}, writeFileSync(path, value) { files.set(path, value); }, chmodSync() {},
		renameSync(from, to) { files.set(to, files.get(from)); files.delete(from); }
	};
	const service = new SubUsageService({ effect() {}, llm: { listProviders: () => [] } }, {
		io, configPath: "memory/config",
		resolveCredentials: async id => id === "unorouter" ? { value: "sk-fixture-bad" } : undefined,
		resolveEnvironment: () => undefined,
		fetch: async () => ({ ok: true, status: 200, headers: { get: () => null }, text: async () => JSON.stringify({ success: false, message: "Unauthorized, invalid access token" }) })
	});
	let result = await service.read();
	result = await service.save({ expectedRevision: result.settings.revision, visibility: { providers: { unorouter: true } } });
	result = await service.refresh({ providerIds: ["unorouter"], force: true });
	const entry = result.entries[0];
	assert.equal(entry.state, "error", "success=false 不能当成成功");
	assert.equal(entry.errorCode, "subusage/auth");
	assert.ok(entry.error.includes("Unauthorized"), "把上游说明原样带出，便于排障");
	assert.equal(service.dispose(), undefined);
	console.log("PASS UnoRouter：success=false 映射为认证错误");
}

// ── [6] Client：注册、顺序、别名 ─────────────────────────────────────────
{
	let spec;
	const react = { createElement: () => null, Fragment: "fragment", useState: (v) => [typeof v === "function" ? v() : v, () => {}], useRef: (v) => ({ current: v }), useEffect: () => {}, useMemo: (f) => f(), useSyncExternalStore: () => null };
	const code = readFileSync(fileURLToPath(new URL("../lib/client.js", import.meta.url)), "utf8");
	vm.runInNewContext(code.replace("exports.apply = apply;", "exports.__test = { PROVIDER_ORDER, PROVIDER_META, ROUTE_PROVIDER_ALIAS, balanceText, extraLabel }; exports.apply = apply;"), { window: { __ModuleLoader__: { load: (value) => { spec = value; } } }, console });
	const client = spec.factory((name) => { assert.equal(name, "react"); return react; });
	const { PROVIDER_ORDER, PROVIDER_META, ROUTE_PROVIDER_ALIAS, balanceText, extraLabel } = client.__test;

	for (const id of ["apigoto", "qnaigc", "unorouter"]) {
		assert.ok(PROVIDER_ORDER.includes(id), `${id} 在提供商顺序中`);
		assert.equal(PROVIDER_META[id].defaultEnabled, false, `${id} 默认关闭`);
	}
	assert.equal(PROVIDER_META["apigoto"].envName, "APIGOTO_API_KEY");
	assert.equal(PROVIDER_META["qnaigc"].envName, "QNAIGC_API_KEY");
	assert.equal(PROVIDER_META["unorouter"].envName, "UNOROUTER_API_KEY");
	// 追加在既有条目之后，不打乱现有位置。
	assert.ok(PROVIDER_ORDER.indexOf("apigoto") > PROVIDER_ORDER.indexOf("github-copilot"), "追加在既有条目之后");

	// 两条 UnoRouter 路由共用一份额度，必须归并。
	assert.equal(ROUTE_PROVIDER_ALIAS["unorouter-sonnet"], "unorouter", "unorouter-sonnet 归并到 unorouter");

	const t = key => key;
	// 七牛云与 UnoRouter 只有花费时，药丸显示花费而不是「暂无额度数据」。
	assert.equal(balanceText({ extras: [{ kind: "spend", value: "0.07 CNY" }] }, t), "spendLabel 0.07 CNY");
	assert.equal(balanceText({ extras: [{ kind: "spend", value: "26.43 USD" }] }, t), "spendLabel 26.43 USD");
	assert.equal(extraLabel({ kind: "spend" }, t, "qnaigc"), "spendLabel", "花费走 spendLabel，不冒充余额");
	assert.equal(extraLabel({ kind: "balance" }, t, "apigoto"), "balanceLabel");
	console.log("PASS 三家 Client：注册、默认关闭、顺序追加、unorouter-sonnet 归并、花费文案");
}

console.log("\n中转聚合商适配测试全部通过 ✅");
