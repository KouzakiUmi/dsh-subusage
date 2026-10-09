// 第一梯队余额型聚合商：Novita / Hyperbolic / DeepInfra / Chutes / Ollama Cloud / Vercel AI Gateway。
// 六家的单位与形状都不同（1/10000 USD、美分、负余额、绝对量、0–1 小数、十进制字符串），
// 这里逐个钉住换算，避免以后被"看起来差不多"的改动统一成错误的折算。
// 不访问真实接口，使用虚构 Key 与桩网络。
import assert from "node:assert/strict";
import { loadHostModule } from "./helpers.mjs";

const { SubUsageService, normalizeNovitaBalance, normalizeHyperbolicBalance, normalizeDeepinfraBalance, normalizeChutesQuota, normalizeOllamaCloudUsage, normalizeVercelCredits, normalizeZenmux, normalizeNanoGpt } = await loadHostModule();

// ── [1] 各家的单位换算 ───────────────────────────────────────────────────
{
	// Novita：单位 1/10000 USD（10000 = $1.00）。
	assert.equal(normalizeNovitaBalance({ availableBalance: 123456 }).extras[0].value, "12.35 USD");
	assert.equal(normalizeNovitaBalance({ availableBalance: 0 }).extras[0].value, "0 USD");
	assert.throws(() => normalizeNovitaBalance({ cashBalance: 1 }));
	assert.equal(normalizeNovitaBalance({ availableBalance: 123456 }).windows.length, 0, "余额型不产窗口");

	// Hyperbolic：美分。
	assert.equal(normalizeHyperbolicBalance({ balanceCents: 1234, maxOverdraftCents: 0 }).extras[0].value, "12.34 USD");
	assert.equal(normalizeHyperbolicBalance({ balanceCents: -50 }).extras[0].value, "-0.5 USD");
	assert.throws(() => normalizeHyperbolicBalance({}));

	// DeepInfra：stripe_balance 是**负的**预付资金，可用金额要取负；正值代表欠款。
	const ok = normalizeDeepinfraBalance({ stripe_balance: -10.5 });
	assert.equal(ok.extras[0].value, "10.5 USD");
	assert.equal(ok.extras.length, 1, "有余额就不提示欠款");
	const owed = normalizeDeepinfraBalance({ stripe_balance: 3.25 });
	assert.equal(owed.extras[0].value, "0 USD", "欠款时不显示负余额");
	assert.equal(owed.extras[1].value, "欠款 3.25 USD");
	assert.throws(() => normalizeDeepinfraBalance({}));

	// Chutes：{quota, used} 绝对量；重置时刻接口不给，不编造。
	const chutes = normalizeChutesQuota({ quota: 200, used: 50 });
	assert.equal(chutes.windows[0].percent, 25);
	assert.equal(chutes.windows[0].kind, "period");
	assert.equal(chutes.windows[0].resetsAt, undefined, "不编造重置时间");
	assert.equal(JSON.stringify(chutes.windows[0].detail), JSON.stringify({ used: 50, limit: 200, unit: "quota" }));
	assert.throws(() => normalizeChutesQuota({ quota: 0, used: 0 }), "零配额不猜比例");
	assert.throws(() => normalizeChutesQuota({ quota: 10 }));

	// Ollama Cloud：usage 是 0–1 小数；缺层跳过，非法值报错。
	const ollama = normalizeOllamaCloudUsage({ limits: { session: { usage: 0.5 }, weekly: { usage: 0.25 }, monthly: { usage: 1 } } });
	assert.deepEqual(ollama.windows.map(w => w.kind), ["period", "week", "month"]);
	assert.equal(ollama.windows[0].percent, 50);
	assert.equal(ollama.windows[2].status, "rate-limited", "100% 即限流");
	assert.equal(ollama.coverage, "complete");
	const partial = normalizeOllamaCloudUsage({ limits: { weekly: { usage: 0.1 } } });
	assert.deepEqual(partial.windows.map(w => w.kind), ["week"]);
	assert.equal(partial.coverage, "partial");
	assert.throws(() => normalizeOllamaCloudUsage({ limits: {} }));
	assert.throws(() => normalizeOllamaCloudUsage({ limits: { session: { usage: -1 } } }));

	// Vercel AI Gateway：十进制字符串。
	assert.equal(normalizeVercelCredits({ balance: "12.34", total_used: "5" }).extras[0].value, "12.34 USD");
	assert.equal(normalizeVercelCredits({ data: { balance: 3 } }).extras[0].value, "3 USD");
	assert.throws(() => normalizeVercelCredits({ balance: "abc" }));
	assert.throws(() => normalizeVercelCredits({}));
	console.log("PASS 余额型聚合商换算：1/10000、美分、负余额、绝对量、0–1 小数与十进制字符串");
}

// ── [1b] ZenMux：5h 配额（0–1 小数）+ PAYG 余额（仅 Management Key） ───────
{
	const out = normalizeZenmux(
		{ data: { plan: { tier: "pro", amount_usd: 20 }, currency: "usd", quota_5_hour: { usage_percentage: 0.3938, resets_at: "2026-10-09T12:00:00.000Z", max_flows: 100, used_flows: 39 } } },
		{ data: { currency: "usd", total_credits: 12.5, top_up_credits: 10, bonus_credits: 2.5 } });
	assert.deepEqual(out.windows.map(w => w.kind), ["5h"]);
	// windowRow 统一把百分比收敛到一位小数（既有行为）：0.3938 → 39.4。
	assert.equal(out.windows[0].percent, 39.4, "usage_percentage 是 0–1 小数");
	assert.equal(out.windows[0].resetsAt, new Date("2026-10-09T12:00:00.000Z").toISOString(), "resets_at 是 ISO");
	assert.equal(JSON.stringify(out.windows[0].detail), JSON.stringify({ used: 39, limit: 100, unit: "flows" }));
	assert.equal(out.extras[0].value, "pro", "套餐档位");
	assert.equal(out.extras[1].value, "12.5 USD", "PAYG 余额");
	assert.equal(out.coverage, "complete");
	// 余额端点被拒（额度端点只认 Management Key，推理 key 过不去）不影响配额。
	const noBalance = normalizeZenmux({ data: { quota_5_hour: { usage_percentage: 0.1 } } }, undefined);
	assert.deepEqual(noBalance.extras, [], "拿不到余额就不显示余额");
	assert.equal(noBalance.coverage, "complete");
	// 只有余额：算读到数据，但没有窗口只能标 partial。
	const onlyBalance = normalizeZenmux(undefined, { data: { currency: "usd", total_credits: 3 } });
	assert.deepEqual(onlyBalance.windows, []);
	assert.equal(onlyBalance.coverage, "partial");
	assert.equal(onlyBalance.extras[0].value, "3 USD");
	assert.throws(() => normalizeZenmux(undefined, undefined), "两个端点都空要报错");
	assert.throws(() => normalizeZenmux({ data: { quota_5_hour: { usage_percentage: "x" } } }, undefined), "非法百分比不当作 0");
	console.log("PASS ZenMux：5h 小数百分比、flows 明细、PAYG 余额与单端失败降级");
}

// ── [1c] NanoGPT 余额增强：余额是增量，缺失/非法都不影响配额 ──────────────
{
	const quota = { active: true, state: "active", limits: { dailyInputTokens: 100 }, dailyInputTokens: { used: 25, percentUsed: 0.25, resetAt: Date.parse("2026-10-10T00:00:00Z") } };
	const withBalance = normalizeNanoGpt(quota, { usd_balance: "12.34", nano_balance: "100" });
	assert.equal(withBalance.extras[0].value, "active", "原有套餐状态保留");
	assert.equal(withBalance.extras[1].value, "12.34 USD", "追加美元余额");
	assert.equal(withBalance.windows[0].percent, 25, "配额解析不受影响");
	assert.equal(normalizeNanoGpt(quota, undefined).extras.length, 1, "余额端点失败不追加条目");
	assert.equal(normalizeNanoGpt(quota, { usd_balance: "abc" }).extras.length, 1, "非法余额不显示");
	assert.equal(normalizeNanoGpt(quota, { usd_balance: "0" }).extras[1].value, "0 USD", "零余额照实显示");
	console.log("PASS NanoGPT：余额为增量条目，缺失或非法都不影响配额");
}

// ── [2] Host：鉴权头与请求路径 ───────────────────────────────────────────
{
	const cases = [
		{ id: "novita", url: "https://api.novita.ai/openapi/v1/billing/balance/detail", auth: "Bearer", body: { availableBalance: 10000 } },
		{ id: "hyperbolic", url: "https://api.hyperbolic.ai/v2/customer/balance", auth: "Bearer", body: { balanceCents: 500 } },
		{ id: "deepinfra", url: "https://api.deepinfra.com/payment/checklist?compute_owed=true", auth: "Bearer", body: { stripe_balance: -2 } },
		{ id: "chutes", url: "https://api.chutes.ai/users/me/quota_usage/me", auth: "Bearer", body: { quota: 100, used: 10 } },
		{ id: "vercel-ai-gateway", url: "https://ai-gateway.vercel.sh/v1/credits", auth: "Bearer", body: { balance: "7.5" } },
		// Ollama Cloud 是唯一的例外：裸 Authorization，**不加 Bearer**。
		{ id: "ollama-cloud", url: "https://ollama.com/api/usage", auth: "raw", body: { limits: { session: { usage: 0.1 } } } }
	];
	for (const item of cases) {
		const files = new Map(), calls = [];
		const io = {
			readFileSync(path) { if (!files.has(path)) throw Object.assign(new Error("missing"), { code: "ENOENT" }); return files.get(path); },
			mkdirSync() {}, writeFileSync(path, value) { files.set(path, value); }, chmodSync() {},
			renameSync(from, to) { files.set(to, files.get(from)); files.delete(from); }
		};
		const key = `fixture-${item.id}`;
		const service = new SubUsageService({ effect() {}, llm: { listProviders: () => [] } }, {
			io, configPath: "memory/config",
			resolveCredentials: async id => id === item.id ? { value: key } : undefined,
			resolveEnvironment: () => undefined,
			fetch: async (url, options) => {
				calls.push({ url, options });
				return { ok: true, status: 200, headers: { get: () => null }, text: async () => JSON.stringify(item.body) };
			}
		});
		let result = await service.read();
		assert.equal(result.settings.visibility.providers[item.id], false, `${item.id} 默认关闭`);
		assert.equal(calls.length, 0, `${item.id} 默认关闭不请求`);
		result = await service.save({ expectedRevision: result.settings.revision, visibility: { providers: { [item.id]: true } } });
		result = await service.refresh({ providerIds: [item.id], force: true });
		const entry = result.entries[0];
		assert.equal(entry.state, "ok", `${item.id} 应读取成功`);
		assert.equal(calls[0].url, item.url, `${item.id} 端点`);
		assert.equal(calls[0].options.headers.authorization, item.auth === "raw" ? key : `Bearer ${key}`, `${item.id} 鉴权头`);
		assert.ok(!JSON.stringify(result).includes(key), `${item.id} 响应不回显 Key`);
		service.dispose();
	}
	console.log("PASS 余额型聚合商 Host：六家端点、默认关闭不请求与 Ollama 的裸 Authorization");
}

// ── [2b] ZenMux Host：两个端点并行，余额被拒仍算成功 ──────────────────────
{
	const files = new Map(), calls = [];
	const io = {
		readFileSync(path) { if (!files.has(path)) throw Object.assign(new Error("missing"), { code: "ENOENT" }); return files.get(path); },
		mkdirSync() {}, writeFileSync(path, value) { files.set(path, value); }, chmodSync() {},
		renameSync(from, to) { files.set(to, files.get(from)); files.delete(from); }
	};
	const key = "fixture-zenmux-management";
	let balanceStatus = 200;
	const service = new SubUsageService({ effect() {}, llm: { listProviders: () => [] } }, {
		io, configPath: "memory/config",
		resolveCredentials: async id => id === "zenmux" ? { value: key } : undefined,
		resolveEnvironment: () => undefined,
		fetch: async (url, options) => {
			calls.push({ url, options });
			if (url.includes("payg/balance")) return balanceStatus === 200
				? { ok: true, status: 200, headers: { get: () => null }, text: async () => JSON.stringify({ data: { currency: "usd", total_credits: 12.5 } }) }
				: { ok: false, status: balanceStatus, headers: { get: () => null }, text: async () => JSON.stringify({ error: {} }) };
			return { ok: true, status: 200, headers: { get: () => null }, text: async () => JSON.stringify({ data: { plan: { tier: "pro" }, quota_5_hour: { usage_percentage: 0.25 } } }) };
		}
	});
	let result = await service.read();
	assert.equal(result.settings.visibility.providers.zenmux, false, "默认关闭");
	assert.equal(calls.length, 0, "默认关闭不请求");
	result = await service.save({ expectedRevision: result.settings.revision, visibility: { providers: { zenmux: true } } });
	result = await service.refresh({ providerIds: ["zenmux"], force: true });
	let entry = result.entries[0];
	assert.equal(entry.state, "ok");
	assert.equal(JSON.stringify(calls.map(c => c.url)), JSON.stringify(["https://zenmux.ai/api/v1/management/subscription/detail", "https://zenmux.ai/api/v1/management/payg/balance"]), "两个端点各一次");
	assert.equal(calls[0].options.headers.authorization, `Bearer ${key}`);
	assert.equal(entry.windows[0].percent, 25);
	assert.equal(entry.extras.length, 2);
	assert.ok(!JSON.stringify(result).includes(key), "响应不回显 Management Key");
	// 余额端点被拒：条目仍是 ok，只少余额。
	balanceStatus = 403; calls.length = 0;
	result = await service.refresh({ providerIds: ["zenmux"], force: true });
	entry = result.entries[0];
	assert.equal(entry.state, "ok", "余额端点被拒不影响配额");
	assert.equal(entry.windows[0].percent, 25);
	assert.equal(entry.extras.length, 1, "只剩套餐档位");
	service.dispose();
	console.log("PASS ZenMux Host：两端点并行、Management Key 鉴权与余额 403 降级");
}

console.log("\n余额型聚合商测试全部通过 ✅");
