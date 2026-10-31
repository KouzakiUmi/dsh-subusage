// 中转聚合商：APIGOTO（订阅窗口 + 套餐内余额 + 套餐到期）。
// 契约来自 2026-10-30 用真实 Key 实测的响应，这里用同形状的虚构响应复现，
// 不访问真实接口、不写入真实 Key。
//
// 本文件重点钉住最容易搞错的几件事：
//   1. `subscription.expires_at` 是**套餐到期日**，不是窗口重置时间，不能写进 resetsAt；
//   2. 套餐内 `remaining` 与充值钱包 `balance_usd` 是两个池，钱包为 0 不能盖掉套餐余额；
//   3. 窗口档位由 `window_sec` 秒数换算，不从套餐名反推；
//   4. 到期倒计时与「积分为 0 不占行」这类显示取舍。
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import vm from "node:vm";
import { loadHostModule } from "./helpers.mjs";

const { SubUsageService, PROVIDERS, normalizeApigoto } = await loadHostModule();

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
// 让「还有几天」的断言不依赖运行时刻：取一个早于到期日的固定时间。
const AT = Date.parse("2026-10-30T00:00:00Z");

// ── [1] 归一化 ───────────────────────────────────────────────────────────
{
	const out = normalizeApigoto(APIGOTO_BODY, AT);
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

	// 徽标只放套餐名；到期日与剩余天数另起说明行，不塞进徽标。
	const plan = out.extras.find(x => x.kind === "plan");
	assert.equal(plan.value, "RouterCode PLUS-1027", "plan 徽标只放套餐名");
	assert.ok(!plan.value.includes("到期"), "到期日不在 plan 徽标里");
	const expiry = out.extras.find(x => x.kind === "note" && x.value.includes("套餐到期"));
	assert.equal(expiry.value, "套餐到期 2026-11-29（还有 31 天）", "到期日带剩余天数");
	assert.equal(out.extras.filter(x => x.kind === "note" && x.value.includes("套餐到期")).length, 1, "到期只占一行");

	// 策略名与套餐名不同时单独说明；相同时不重复占行。
	assert.ok(out.extras.some(x => x.kind === "note" && x.value === "策略 APIGOTO PLUS-1027"), "策略名与套餐名不同则说明");
	const samePolicy = normalizeApigoto({ ...APIGOTO_BODY, subscription: { ...APIGOTO_BODY.subscription, policy_name: "RouterCode PLUS-1027" } }, AT);
	assert.ok(!samePolicy.extras.some(x => x.value.startsWith("策略")), "策略名与套餐名相同则不重复");

	// 计费模式翻成人话；积分为 0 不占行。
	assert.ok(out.extras.some(x => x.value === "计费模式：订阅制"), "mode 翻成中文");
	assert.ok(!out.extras.some(x => x.value.startsWith("积分")), "积分为 0 时不占行");
	assert.ok(normalizeApigoto({ ...APIGOTO_BODY, points: 120 }, AT).extras.some(x => x.value === "积分 120"), "积分非 0 时显示");

	// 关键：套餐内 remaining 是主余额；充值钱包 balance_usd 为 0 不能盖掉它、
	// 也不能变成红色「余额耗尽」告警。
	const balance = out.extras.find(x => x.kind === "balance");
	assert.equal(balance.value, "4.42 USD", "主余额取套餐内 remaining，不是 0 元的充值钱包");
	assert.ok(!out.extras.some(x => x.kind === "note" && x.value.includes("钱包")), "钱包为 0 时不额外占一行");

	// 钱包确实有余额时才提一句。
	const withWallet = normalizeApigoto({ ...APIGOTO_BODY, balance_usd: "2.50000000" }, AT);
	assert.equal(withWallet.extras.find(x => x.value.includes("充值钱包")).value, "充值钱包另有 2.5 USD", "钱包有余额时说明");

	// 已过到期日要明确说出来，而不是显示「还有 0 天」。
	const expired = normalizeApigoto(APIGOTO_BODY, Date.parse("2026-12-05T00:00:00Z"));
	assert.equal(expired.extras.find(x => x.value.includes("套餐已于")).value, "套餐已于 2026-11-29 到期");

	// 套餐失效是上游明确状态，要说出来。
	assert.ok(normalizeApigoto({ ...APIGOTO_BODY, is_active: false }, AT).extras.some(x => x.kind === "note" && x.value.includes("停用")), "套餐停用要提示");

	// 上游改口径时宁可报错也不编数字。
	for (const bad of [undefined, null, {}, [], { subscription: null }]) {
		assert.throws(() => normalizeApigoto(bad, AT), `非法响应必须报错：${JSON.stringify(bad)}`);
	}
	// 只有元数据（套餐名 / 到期 / 策略 / 模式 / 积分）而没有窗口与余额：这不是额度数据，
	// 不能让一条「计费模式：订阅制」把失败装成成功。
	const metaOnly = { is_active: true, isValid: true, mode: "subscription", points: 0, subscription: { plan_name: "P", policy_name: "P", expires_at: "2026-11-29T23:59:12Z" } };
	assert.throws(() => normalizeApigoto(metaOnly, AT), "只有元数据必须报错，不能当成读到额度");
	// 但上游明确的「套餐无效或已停用」是真实状态，仍要如实返回。
	const disabled = normalizeApigoto({ ...metaOnly, is_active: false }, AT);
	assert.ok(disabled.extras.some(x => x.value === "套餐无效或已停用"), "停用状态照常返回");
	console.log("PASS APIGOTO：按 window_sec 定档、到期倒计时独立成行、套餐余额优先于 0 元钱包");
}

// ── [2] Host 端到端：默认关闭、端点来自元数据、Key 不回显 ─────────────────
{
	const files = new Map(), calls = [];
	const io = {
		readFileSync(path) { if (!files.has(path)) throw Object.assign(new Error("missing"), { code: "ENOENT" }); return files.get(path); },
		mkdirSync() {}, writeFileSync(path, value) { files.set(path, value); }, chmodSync() {},
		renameSync(from, to) { files.set(to, files.get(from)); files.delete(from); }
	};
	const KEY = "sk-fixture-apigoto";
	const service = new SubUsageService({ effect() {}, llm: { listProviders: () => [] } }, {
		io, configPath: "memory/config",
		resolveCredentials: async id => id === "apigoto" ? { value: KEY } : undefined,
		resolveEnvironment: () => undefined,
		fetch: async (url, options) => {
			calls.push({ url, options });
			if (new URL(url).hostname !== "api.apigoto.com") throw new Error(`unexpected host ${url}`);
			return { ok: true, status: 200, headers: { get: () => null }, text: async () => JSON.stringify(APIGOTO_BODY) };
		}
	});

	let result = await service.read();
	assert.equal(result.settings.visibility.providers.apigoto, false, "默认关闭");
	assert.equal(calls.length, 0, "默认关闭时即使继承到 Key 也不访问网络");

	result = await service.save({ expectedRevision: result.settings.revision, visibility: { providers: { apigoto: true } } });
	result = await service.refresh({ providerIds: ["apigoto"], force: true });
	const entry = result.entries.find(e => e.providerId === "apigoto");
	assert.equal(entry.state, "ok", "读取成功");

	assert.equal(calls.length, 1, "只请求一个端点");
	assert.equal(calls[0].url, PROVIDERS.apigoto.usageUrl, "端点来自 PROVIDERS.usageUrl");
	assert.equal(PROVIDERS.apigoto.usageUrl, "https://api.apigoto.com/v1/usage");
	assert.match(calls[0].options.headers.authorization, new RegExp(`^Bearer ${KEY}$`), "用推理 Key 的 Bearer");
	assert.equal(entry.windows[0].kind, "week");

	// Key 不能出现在返回体里。
	assert.ok(!JSON.stringify(result).includes(KEY), "响应不回显 Key");
	assert.equal(service.dispose(), undefined);
	console.log("PASS APIGOTO Host：默认关闭、端点来自元数据、Bearer 同 Key、响应不回显 Key");
}

// ── [3] Client：注册、顺序、默认关闭 ─────────────────────────────────────
{
	let spec;
	const react = { createElement: () => null, Fragment: "fragment", useState: (v) => [typeof v === "function" ? v() : v, () => {}], useRef: (v) => ({ current: v }), useEffect: () => {}, useMemo: (f) => f(), useSyncExternalStore: () => null };
	const code = readFileSync(fileURLToPath(new URL("../lib/client.js", import.meta.url)), "utf8");
	vm.runInNewContext(code.replace("exports.apply = apply;", "exports.__test = { PROVIDER_ORDER, PROVIDER_META, ROUTE_PROVIDER_ALIAS, balanceText, extraLabel }; exports.apply = apply;"), { window: { __ModuleLoader__: { load: (value) => { spec = value; } } }, console });
	const client = spec.factory((name) => { assert.equal(name, "react"); return react; });
	const { PROVIDER_ORDER, PROVIDER_META, ROUTE_PROVIDER_ALIAS, balanceText, extraLabel } = client.__test;

	assert.ok(PROVIDER_ORDER.includes("apigoto"), "apigoto 在提供商顺序中");
	assert.equal(PROVIDER_META.apigoto.defaultEnabled, false, "默认关闭");
	assert.equal(PROVIDER_META.apigoto.envName, "APIGOTO_API_KEY");
	// 追加在既有条目之后，不打乱现有位置。
	assert.ok(PROVIDER_ORDER.indexOf("apigoto") > PROVIDER_ORDER.indexOf("github-copilot"), "追加在既有条目之后");

	// 已移除的两家不得残留：注册表、顺序表与路由别名三处都要干净。
	for (const gone of ["unorouter", "qnaigc"]) {
		assert.ok(!PROVIDER_ORDER.includes(gone), `${gone} 已从顺序表移除`);
		assert.ok(!(gone in PROVIDER_META), `${gone} 已从注册表移除`);
	}
	assert.equal(ROUTE_PROVIDER_ALIAS["unorouter-sonnet"], undefined, "unorouter 路由别名已移除");

	const t = key => key;
	assert.equal(extraLabel({ kind: "balance" }, t, "apigoto"), "balanceLabel");
	assert.equal(balanceText({ extras: [{ kind: "balance", value: "4.42 USD" }] }, t), "balanceLabel 4.42 USD");
	console.log("PASS APIGOTO Client：注册、默认关闭、顺序追加、已移除两家无残留");
}

console.log("\n中转聚合商适配测试全部通过 ✅");
