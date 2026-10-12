// 现行套餐与额度语义回归：官方类型、适用窗口、额度耗尽与实际可用性分离。
// 全部离线桩；不访问本机凭据或真实计费接口。
import assert from "node:assert/strict";
import { loadHostModule } from "./helpers.mjs";

const host = await loadHostModule();

// Novita 官方示例：availableBalance 为字符串，单位 1/10000 USD。
assert.equal(host.normalizeNovitaBalance({ availableBalance: "1000000" }).extras[0].value, "100 USD");
assert.equal(host.normalizeNovitaBalance({ availableBalance: "-10000" }).extras[0].value, "-1 USD");
for (const raw of ["", " ", "0x10", "1e6", "Infinity", {}, NaN]) {
	assert.throws(() => host.normalizeNovitaBalance({ availableBalance: raw }));
}

// ZenMux 周限制不能被短窗健康掩盖，月 cap 没有实时已用值不画假窗口。
const zen = host.normalizeZenmux({ data: {
	quota_5_hour: { usage_percentage: 0.01 },
	quota_7_day: { usage_percentage: 1, resets_at: "2026-10-19T00:00:00Z" },
	quota_monthly: { max_flows: 10000 }
} });
assert.deepEqual(zen.windows.map(w => w.kind), ["5h", "week"]);
assert.equal(zen.windows[1].status, "rate-limited");
assert.equal(zen.windows[0].cascade, true);
assert.equal(zen.windows[1].resetsAt, "2026-10-19T00:00:00.000Z");
assert.equal(zen.coverage, "complete");
assert.equal(host.normalizeZenmux(undefined, { data: { total_credits: 5 } }).coverage, "complete");
assert.equal(host.normalizeZenmux({ data: { account_status: "banned", quota_5_hour: { usage_percentage: 0 } } }).availability, "blocked");
assert.throws(() => host.normalizeZenmux({ data: { quota_7_day: { usage_percentage: "1" } } }));
// Codex 单周窗、企业金额/限制与工作区身份。
for (const plan of ["pro", "prolite", "promax"]) {
	const out = host.normalizeCodexUsage({ plan_type: plan, rate_limit: { primary_window: { used_percent: 10 } } });
	assert.equal(out.windows[0].kind, "week");
	assert.equal(out.coverage, "complete");
}
const enterprise = host.normalizeCodexUsage({ plan_type: "enterprise", credits: { has_credits: true, balance: "100" } });
assert.equal(enterprise.extras.find(e => e.kind === "balance").value, "100");
assert.equal(enterprise.extras.find(e => e.kind === "plan").value, "enterprise");
assert.equal(enterprise.coverage, "complete");
assert.equal(host.normalizeCodexUsage({ spend_control: { reached: true } }).availability, "blocked");
assert.equal(host.normalizeCodexUsage({ spend_control: { individual_limit: { limit: "10", used: "10" } } }).windows[0].status, "rate-limited");

// 多级预算均保留，官方嵌套响应不能丢失，Key耗尽不被Team覆盖。
const budgets = host.normalizeLitellm({ info: { spend: 10, max_budget: 10 } }, [
	{ team_info: { spend: 1, max_budget: 100 } }, { user_info: { spend: 20, max_budget: 20 } }
]);
assert.deepEqual(budgets.windows.map(w => w.percent), [100, 1, 100]);
assert.deepEqual(budgets.windows.map(w => w.budgetScope), ["key", "team", "user"]);
assert.equal(budgets.windows[0].status, "rate-limited");

// 已购CC额度绕过订阅窗口；赠金不在证据不足时假定可绕过。
const cc = purchased => host.normalizeCommandCode({ credits: { planId: "individual-goat", monthlyCredits: 0, purchasedCredits: purchased, freeCredits: 50 }, windowLimits: { fiveHour: { cap: 10, used: 10 } } });
assert.equal(cc(50).availability, "paygo");
assert.equal(cc(0).availability, "blocked");
assert.equal(cc(50).windows[0].status, "rate-limited", "窗口仍如实表达包含额度耗尽");

// NanoGPT官方执行建议不能被base quota百分比覆盖；PAYG未知余额不承诺可用。
const nanoBody = { active: true, state: "active", limits: { weeklyInputTokens: 60000000 }, weeklyInputTokens: { used: 60000000, percentUsed: 1 }, routing: { recommendedMode: "subscription", subscriptionQuotaAvailable: true } };
assert.equal(host.normalizeNanoGpt(nanoBody).availability, "included");
assert.equal(host.normalizeNanoGpt({ ...nanoBody, routing: { recommendedMode: "paygo" } }).availability, "unknown");
assert.equal(host.normalizeNanoGpt({ ...nanoBody, routing: { recommendedMode: "paygo" } }, { usd_balance: "10" }).availability, "paygo");
assert.equal(host.normalizeNanoGpt({ ...nanoBody, routing: { recommendedMode: "unavailable" } }, { usd_balance: "10" }).availability, "blocked");
assert.equal(host.normalizeOllamaCloudUsage({ limits: { monthly: { usage: 0.1 } } }).coverage, "complete");
assert.equal(host.normalizeOpenRouter({ data: { limit: null, usage: 1 } }).extras[0].kind, "spend");
assert.equal(host.normalizeOpenRouter({ data: { limit: null } }, { data: { total_credits: 20, total_usage: 1 } }).coverage, "complete");

const missing = { readFileSync() { throw Object.assign(new Error("missing"), { code: "ENOENT" }); } };
const response = (body, status = 200) => ({ ok: status >= 200 && status < 300, status, headers: { get: () => null }, text: async () => JSON.stringify(body) });
const service = new host.SubUsageService({ effect() {} }, { io: missing, fetch: async () => response({ Result: { AFPWeekly: { Quota: 100, Used: 100 }, AFPMonthly: { Quota: 1000, Used: 100 }, AFPDaily: { Quota: 500, Used: 1 } } }) });
const afp = await service.fetchProvider("arkcli-agent-plan", { key: "fixture", secret: "fixture" }, {});
assert.equal(afp.windows.find(w => w.kind === "day").status, "ok", "文本周不能级联独立日能力");
service.dispose();
const notSubscribed = new host.SubUsageService({ effect() {} }, { io: missing, fetch: async () => response({ ResponseMetadata: { Error: { Code: "NotFound.BillingType" } } }, 404) });
assert.equal((await notSubscribed.fetchProvider("arkcli-coding-plan", { key: "fixture", secret: "fixture" }, {})).subscribed, false);
notSubscribed.dispose();
// 同token切换工作区也要失效缓存；quota视图透传可用性而非凭据。
{
	const files = new Map(), calls = [];
	let accountId = "workspace-a";
	const io = { readFileSync(path) { if (!files.has(path)) throw Object.assign(new Error("missing"), { code: "ENOENT" }); return files.get(path); }, mkdirSync() {}, writeFileSync(path, value) { files.set(path, value); }, chmodSync() {}, renameSync(from, to) { files.set(to, files.get(from)); files.delete(from); } };
	const s = new host.SubUsageService({ effect() {} }, { io, configPath: "memory/identity", resolveCodexAuth: async () => ({ key: "fixture-token", accountId }), fetch: async (url, options) => { calls.push(options.headers); return response({ plan_type: "pro", rate_limit: { primary_window: { used_percent: 100, limit_window_seconds: 604800 } } }); } });
	const before = await s.read({ providerIds: ["openai-codex"], force: false });
	await s.save({ expectedRevision: before.settings.revision, visibility: { providers: { "openai-codex": true } } });
	await s.refresh({ providerIds: ["openai-codex"], force: false });
	await s.refresh({ providerIds: ["openai-codex"], force: false });
	assert.equal(calls.length, 1, "同工作区命中缓存");
	accountId = "workspace-b";
	const view = await s.quota({ providerIds: ["codex"] });
	assert.equal(calls.length, 2, "同token工作区变化不复用旧缓存");
	assert.equal(calls[1]["ChatGPT-Account-Id"], "workspace-b");
	assert.equal(view.providers[0].availability, "blocked");
	assert.equal(view.providers[0].availabilityReason, "quota-exhausted");
	assert.ok(!JSON.stringify(view).includes("fixture-token"));
	assert.ok(!JSON.stringify(view).includes("workspace-b"));
	s.dispose();
}
console.log("PASS 额度语义：官方类型、适用窗口、多预算、支付路径、AFP范围、未订阅信封与工作区缓存");
