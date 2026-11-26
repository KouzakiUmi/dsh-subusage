// 读取与拉取解耦（issue #6 / #8）：多端点的每一路独立取数、独立暂存，任一路失败不牵连另一路。
//
// 钉四件事：
//  1. Z.ai 退订后「额度无窗口 + 账户余额可读」→ 按量计费展示，不再判「无法读取」；
//  2. 两路都没有新数据 → 仍按整条失败（不能用旧暂存把失败静默成成功）；
//  3. 某一路回落旧暂存、另一路是新数据 → 成功但 coverage partial；
//  4. MiMo 的 `items: null` 算空分组（无 Token Plan 的纯余额账号要能显示余额）。
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { loadHostModule } from "./helpers.mjs";

const { SubUsageService, normalizeZai, normalizeMimo, zaiBalanceExtras } = await loadHostModule();
const Z = "zai-coding-cn", G = "zai-cn", M = "xiaomi-token-plan-cn";

const QUOTA_URL = "monitor/usage/quota/limit";
const BALANCE_URL = "query-customer-account-report";
const quotaBody = { data: { level: "pro", limits: [{ type: "CREDIT_LIMIT", unit: 3, percentage: 12 }, { type: "CREDIT_LIMIT", unit: 6, percentage: 20 }] } };
const timeLimitQuota = { data: { limits: [{ type: "TIME_LIMIT", percentage: 71, currentValue: 715, usage: 1000, usageDetails: [{ modelCode: "search-prime", usage: 715 }, { modelCode: "web-reader", usage: 0 }, { modelCode: "zread", usage: 0 }] }] } };
const cancelledQuota = { data: { level: "pro" } };
const balanceBody = { code: 200, msg: "操作成功", success: true, data: { balance: "13.387515800", availableBalance: "13.387515800", frozenBalance: 0 } };

function harness({ providers = [Z], respond } = {}) {
	const files = new Map();
	let now = Date.parse("2026-11-20T00:00:00Z");
	const calls = [];
	const io = {
		readFileSync(path) { if (!files.has(path)) throw Object.assign(new Error("missing"), { code: "ENOENT" }); return files.get(path); },
		mkdirSync() {}, chmodSync() {},
		writeFileSync(path, value) { files.set(path, value); },
		renameSync(from, to) { files.set(to, files.get(from)); files.delete(from); }
	};
	const service = new SubUsageService(
		{ get() {}, llm: { listProviders: () => providers.map(id => ({ id })) }, effect() {} },
		{
			io, configPath: "memory/config", snapshotPath: "memory/cache.json", now: () => now,
			resolveCredentials: async () => ({ value: "test-key" }), resolveEnvironment: () => undefined,
			fetch: async (url, options) => {
				calls.push({ url: String(url), options });
				const value = await respond(String(url));
				if (value instanceof Error) throw value;
				if (value?.http) return { ok: false, status: value.http, headers: { get: () => null } };
				return { ok: true, status: 200, headers: { get: () => null }, text: async () => JSON.stringify(value) };
			}
		}
	);
	return { service, calls, files, tick: ms => { now += ms; } };
}

// ── [1] Z.ai 退订：额度没有窗口、余额照常可读 ──────────────────────────────
{
	const h = harness({ respond: url => (url.includes(BALANCE_URL) ? balanceBody : cancelledQuota) });
	const entry = (await h.service.refresh({ providerIds: [Z], force: true })).entries[0];
	assert.equal(entry.state, "ok", "退订不是「无法读取」");
	assert.deepEqual(entry.windows, [], "没有套餐窗口");
	assert.equal(entry.subscribed, false, "明确标成未订阅");
	assert.equal(entry.coverage, "complete", "余额读到了就是完整");
	const balance = entry.extras.find(x => x.kind === "balance");
	assert.equal(balance.value, "13.39 CNY", "availableBalance 优先、两位小数、固定 CNY");
	assert.ok(entry.extras.some(x => x.kind === "note" && /按量计费/.test(x.value)), "说明按量计费");
	h.service.dispose();
	console.log("PASS Z.ai 退订后展示账户余额（不再判无法读取）");
}

// ── [2] Z.ai 正常：窗口与余额并存 ─────────────────────────────────────────
{
	const h = harness({ respond: url => (url.includes(BALANCE_URL) ? balanceBody : quotaBody) });
	const entry = (await h.service.refresh({ providerIds: [Z], force: true })).entries[0];
	assert.equal(entry.state, "ok");
	assert.equal(entry.windows.length, 2, "套餐窗口照常");
	assert.equal(entry.extras.find(x => x.kind === "balance").value, "13.39 CNY", "余额作为附加行并存");
	h.service.dispose();
	console.log("PASS Z.ai 窗口与余额并存");
}

// ── [3] Z.ai 通用平台：TIME_LIMIT 工具调用窗 → plan extra ──────────────────
{
	const h = harness({ providers: [G], respond: url => (url.includes(BALANCE_URL) ? balanceBody : timeLimitQuota) });
	const entry = (await h.service.refresh({ providerIds: [G], force: true })).entries[0];
	assert.equal(entry.state, "ok");
	assert.deepEqual(entry.windows, [], "通用平台不把 Coding Plan 的 TOKENS 窗混进来");
	const tool = entry.extras.find(x => x.kind === "plan" && /月度调用/.test(x.value));
	assert.ok(tool, "TIME_LIMIT 要聚合成一条可读的 plan 附加行");
	assert.match(tool.value, /715\/1000（71%）/, "报出已用与总量");
	assert.match(tool.value, /search-prime 715 \/ web-reader 0 \/ zread 0/, "带上模型明细");
	h.service.dispose();
	console.log("PASS Z.ai 通用平台入口：TIME_LIMIT 工具调用窗可见");
}

// ── [4] 两路都没有新数据 → 整条失败（旧暂存不得把失败静默成成功）─────────────
{
	let phase = "ok";
	const h = harness({ respond: url => {
		if (phase === "ok") return url.includes(BALANCE_URL) ? balanceBody : quotaBody;
		if (url.includes(BALANCE_URL)) return { http: 500 };
		return { http: 429, retryAfter: "30" };
	} });
	await h.service.refresh({ providerIds: [Z], force: true }); // 先成功，攒下暂存
	phase = "fail";
	h.tick(120000);
	const entry = (await h.service.refresh({ providerIds: [Z], force: true })).entries[0];
	assert.equal(entry.state, "error", "两路都失败仍然是失败");
	assert.ok(entry.errorCode, "保留真实错误码");
	h.service.dispose();
	console.log("PASS 两路都失败 → 仍判失败，不被暂存掩盖");
}

// ── [4] 一路回落、另一路新数据 → 成功但 partial ────────────────────────────
{
	let quotaOk = true;
	const h = harness({ respond: url => {
		if (url.includes(BALANCE_URL)) return balanceBody;
		return quotaOk ? quotaBody : { http: 500 };
	} });
	await h.service.refresh({ providerIds: [Z], force: true });
	quotaOk = false;
	h.tick(120000);
	const entry = (await h.service.refresh({ providerIds: [Z], force: true })).entries[0];
	assert.equal(entry.state, "ok", "余额是新的，就能展示");
	assert.equal(entry.windows.length, 2, "额度这一路用上次成功的结果顶上");
	assert.equal(entry.coverage, "partial", "有一路是旧数据，覆盖度要降级");
	h.service.dispose();
	console.log("PASS 一路回落 + 一路新鲜 → 可展示但 coverage partial");
}

// ── [5] 余额金额归一化边界 ────────────────────────────────────────────────
{
	assert.deepEqual(zaiBalanceExtras({ data: { availableBalance: "10.5", balance: "99" } }), [{ kind: "balance", value: "10.50 CNY" }], "availableBalance 优先");
	assert.deepEqual(zaiBalanceExtras({ data: { balance: 8 } }), [{ kind: "balance", value: "8.00 CNY" }], "数字金额也认");
	assert.deepEqual(zaiBalanceExtras({ data: { availableBalance: "0" } }), [{ kind: "balance", value: "0.00 CNY" }], "0 元如实显示");
	assert.deepEqual(zaiBalanceExtras({ data: { balance: "0", frozenBalance: "2.5" } }).map(x => x.kind), ["balance", "note"], "有冻结金额才补说明");
	assert.deepEqual(zaiBalanceExtras({ data: {} }), [], "没有金额什么都没产");
	assert.deepEqual(zaiBalanceExtras(undefined), []);
	// 无窗口 + 无余额 → 仍抛错
	assert.throws(() => normalizeZai(cancelledQuota), /no coding-plan windows/);
	const balanceOnly = normalizeZai(undefined, undefined, { balanceBody });
	assert.equal(balanceOnly.coverage, "partial", "只有余额端点成功时必须标 partial");
	assert.equal(balanceOnly.extras.find(x => x.kind === "balance").value, "13.39 CNY");
	console.log("PASS Z.ai 余额归一化边界（字符串/数字/0/冻结/缺失）");
}

// ── [6] MiMo：items: null 算空分组，纯余额账号不再「数据不完整」──────────────
{
	const usage = { data: { monthUsage: { percent: 0, items: null }, usage: null } };
	const detail = { data: { planCode: null, planName: null, currentPeriodEnd: null, expired: null } };
	const bal = { data: { balance: "10.45", frozenBalance: "0.00", currency: "CNY" } };
	const out = normalizeMimo(bal, detail, usage);
	assert.deepEqual(out.windows, []);
	assert.equal(out.balanceOk, true);
	assert.equal(out.subscribed, false, "items:null 视为没有订阅");
	assert.equal(out.coverage, "complete", "余额读到了就是完整，不是 partial");
	assert.equal(out.extras.find(x => x.kind === "balance").value, "10.45 CNY");
	// 真订阅仍有窗口时不受影响
	const subscribed = normalizeMimo(bal, { data: { planName: "Pro" } }, { data: { usage: { items: [{ name: "plan_total_token", percent: 30 }] } } });
	assert.equal(subscribed.windows.length, 1);
	assert.equal(subscribed.subscribed, true);
	console.log("PASS MiMo items:null 视为无订阅，纯余额账号 coverage complete");
}

// ── [7] 路由归并：xiaomi / mimo → xiaomi-token-plan-cn（Client 与 go-panel 同表）───
{
	const client = readFileSync(new URL("../lib/client.js", import.meta.url), "utf8");
	const panel = readFileSync(new URL("../lib/go-panel.js", import.meta.url), "utf8");
	for (const route of ["xiaomi", "mimo", "xiaomimimo"]) {
		const pattern = new RegExp(`${route}:\\s*"xiaomi-token-plan-cn"`);
		assert.ok(pattern.test(client), `Client 路由表缺 ${route}`);
		assert.ok(pattern.test(panel), `go-panel 路由表缺 ${route}`);
	}
	// detectConfigured：路由用 xiaomi 注册时，额度入口也算「已配置」，否则 hideWithoutApi 会把卡片藏起来。
	const h = harness({ providers: ["xiaomi"], respond: url => (url.includes(BALANCE_URL) ? balanceBody : quotaBody) });
	const result = await h.service.refresh({ providerIds: [], force: false });
	assert.equal(result.configured[M], true, "注册成 xiaomi 也要算配置了 MiMo");
	h.service.dispose();
	console.log("PASS 路由归并：xiaomi/mimo/xiaomimimo 落到同一入口，detectConfigured 同步");
}
