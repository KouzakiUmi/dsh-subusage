// Command Code：normalizeCommandCode（/alpha/billing/credits 原始响应）+ 自读凭据直连拉取。
// 凭据来源与 @mars-sea/dsh-commandcode-provider 一致：凭据服务 → 启动环境 → ~/.commandcode/auth.json。
// 不访问真实网络、真实 ~/.commandcode 或 ~/.dsh。
import assert from "node:assert/strict";
import { homedir } from "node:os";
import { join } from "node:path";
import { loadHostModule } from "./helpers.mjs";

const { SubUsageService, normalizeCommandCode, subUsageRemote } = await loadHostModule();
const C = "commandcode";
const AUTH = join(homedir(), ".commandcode", "auth.json");
const RESET_5H = Date.parse("2026-01-01T05:00:00Z"), RESET_WEEK = Date.parse("2026-01-04T00:00:00Z");
const window5h = { used: 1, cap: 4, exceeded: false, resetAt: RESET_5H };
const windowWeek = { used: 9, cap: 10, exceeded: false, resetAt: RESET_WEEK };
const body = (limits = {}, credits = {}) => ({
	credits: { monthlyCredits: 1500, purchasedCredits: 30, freeCredits: 5, planId: "individual-pro-v1", ...credits },
	windowLimits: { fiveHour: window5h, weekly: windowWeek, ...limits }
});

// ── 归一化：三窗、比例、重置、extras、complete ─────────────────────────────
const out = normalizeCommandCode(body());
assert.equal(out.windows.length, 3);
assert.equal(out.windows.find(w => w.kind === "month").detail.limit, 80);
assert.equal(out.windows.find(w => w.kind === "month").percent, 0, "余额超过套餐总額时不能产生负用量");
const five = out.windows.find((w) => w.kind === "5h"), week = out.windows.find((w) => w.kind === "week");
assert.equal(five.percent, 25); assert.equal(five.status, "ok"); assert.equal(five.resetsAt, new Date(RESET_5H).toISOString());
assert.deepEqual({ used: five.detail.used, limit: five.detail.limit, unit: five.detail.unit }, { used: 1, limit: 4, unit: "credits" });
assert.equal(week.percent, 90); assert.equal(week.status, "ok");
assert.equal(out.coverage, "complete");
assert.deepEqual(out.extras, [{ kind: "plan", value: "individual-pro-v1" }, { kind: "monthly-balance", value: "1500 credits" }, { kind: "balance", value: "35 credits" }]);

// 用户截图：GOAT 月总额70、剩余55.86，月已用14.14（而非把55.86当上限）。
const monthly = normalizeCommandCode(body({}, { planId: "individual-goat", monthlyCredits: 55.86 }));
const month = monthly.windows.find(w => w.kind === "month");
assert.equal(month.percent, 20.2); assert.equal(month.status, "ok");
assert.deepEqual(month.detail, { used: 14.14, limit: 70, remaining: 55.86, unit: "credits", limitSource: "plan-snapshot" });
assert.equal(month.resetsAt, undefined, "未读取账期端点时不能编造月重置日期");
const emptyMonth = normalizeCommandCode(body({}, { planId: "individual-goat", monthlyCredits: 0 }));
assert.equal(emptyMonth.windows.find(w => w.kind === "month").status, "rate-limited");
assert.equal(emptyMonth.windows.find(w => w.kind === "5h").status, "ok", "月池耗尽不假定已购/赠送池或短窗也受限");
for (const [planId, cap] of [["individual-pro", 30], ["INDIVIDUAL_PRO_V1", 80], ["individual-go-v1", 10], ["individual-goat-annual", 70], ["teams-pro", 40]]) {
 assert.equal(normalizeCommandCode(body({}, { planId, monthlyCredits: 1 })).windows.find(w => w.kind === "month").detail.limit, cap);
}
for (const planId of ["unknown-plan", "individual-goatfake", "individual-prototype"]) {
 const unknown = normalizeCommandCode(body({}, { planId, monthlyCredits: 55.86 }));
 assert.ok(!unknown.windows.some(w => w.kind === "month")); assert.equal(unknown.coverage, "partial");
 assert.ok(unknown.extras.some(x => x.kind === "monthly-balance" && x.value === "55.86 credits"));
}
for (const monthlyCredits of [undefined, null, "55.86", NaN, Infinity]) {
 const missing = normalizeCommandCode(body({}, { monthlyCredits }));
 assert.ok(!missing.windows.some(w => w.kind === "month")); assert.equal(missing.coverage, "partial");
 assert.ok(!missing.extras.some(x => x.kind === "monthly-balance"));
}
assert.equal(normalizeCommandCode(body({}, { monthlyCredits: -1 })).windows.find(w => w.kind === "month").status, "rate-limited");
const invalidReset = normalizeCommandCode(body({ fiveHour: { ...window5h, resetAt: Number.MAX_VALUE } }));
assert.equal(invalidReset.windows.find(w => w.kind === "5h").resetsAt, undefined);


// ── 每周用尽 → 5 小时连坐（长周期限流连坐短周期）─────────────────────────
const limited = normalizeCommandCode(body({ weekly: { used: 10, cap: 10, exceeded: true, resetAt: RESET_WEEK } }));
assert.equal(limited.windows.find((w) => w.kind === "week").status, "rate-limited");
assert.equal(limited.windows.find((w) => w.kind === "5h").cascade, true);
assert.equal(limited.windows.find((w) => w.kind === "5h").status, "rate-limited");
assert.deepEqual(limited.windows.find((w) => w.kind === "5h").detail.blockedBy, ["week"]);

// ── cap:0 是报告过的无上限：0% 且不受限、无明细；比例达 100% 判耗尽 ───────
const uncapped = normalizeCommandCode(body({ fiveHour: { used: 5, cap: 0, exceeded: false, resetAt: 0 }, weekly: null }));
assert.equal(uncapped.windows.length, 2); // 5h无上限与已知套餐月池。
assert.equal(uncapped.windows[0].percent, 0); assert.equal(uncapped.windows[0].status, "ok");
assert.equal(uncapped.windows[0].detail, undefined); assert.equal(uncapped.windows[0].resetsAt, undefined);
assert.equal(uncapped.coverage, "complete", "absent 窗口是未报告上限，不算数据不完整");
const full = normalizeCommandCode(body({ fiveHour: { used: 4, cap: 4, exceeded: false, resetAt: 0 } }));
assert.equal(full.windows.find((w) => w.kind === "5h").status, "rate-limited", "原始比例 100% 即耗尽");

// ── 结构边界：缺 used/cap 不当作零用量；整包无效报错 ─────────────────────
assert.throws(() => normalizeCommandCode(body({ fiveHour: { cap: 4, exceeded: false, resetAt: 0 } })), (e) => e.code === "subusage/response");
assert.throws(() => normalizeCommandCode(body({ fiveHour: { used: "1", cap: 4, exceeded: false, resetAt: 0 } })), (e) => e.code === "subusage/response");
assert.throws(() => normalizeCommandCode({}), (e) => e.code === "subusage/response");
assert.throws(() => normalizeCommandCode({ credits: {}, windowLimits: {} }), (e) => e.code === "subusage/response");
assert.throws(() => normalizeCommandCode(null), (e) => e.code === "subusage/response");

// ── 无窗口时 partial；未报告的余额/套餐不冒充 ────────────────────────────
const noWindow = normalizeCommandCode({ credits: { planId: "individual-pro-v1", freeCredits: 5 } });
assert.deepEqual(noWindow.windows, []);
assert.equal(noWindow.coverage, "partial");
assert.deepEqual(noWindow.extras, [{ kind: "plan", value: "individual-pro-v1" }, { kind: "balance", value: "5 credits" }]);
const noBalance = normalizeCommandCode(body({}, { purchasedCredits: undefined, freeCredits: undefined }));
assert.ok(!noBalance.extras.some((x) => x.kind === "balance"), "未报告的余额字段不显示");

// ── 服务路径：凭据来源链、并行直连、错误映射 ───────────────────────────
function harness({ credential, environment, authText, respond, stored } = {}) {
	const files = new Map();
 if (stored) files.set("memory/config", JSON.stringify(stored));
	let now = Date.parse("2026-01-01T00:00:00Z");
	const calls = [];
	let response = respond ?? (() => body());
	const io = {
		readFileSync(path) {
			if (path === AUTH && authText !== undefined) return authText;
			if (!files.has(path)) throw Object.assign(new Error("missing"), { code: "ENOENT" });
			return files.get(path);
		},
		mkdirSync() {}, writeFileSync(path, value) { files.set(path, value); }, chmodSync() {}, renameSync() {}
	};
	const ctx = { get() {}, llm: { listProviders: () => [{ id: C }] }, effect() {} };
	const service = new SubUsageService(ctx, {
		io, configPath: "memory/config", now: () => now,
		resolveCredentials: async (id) => credential?.[id],
		resolveEnvironment: (id) => environment?.[id],
		fetch: async (url, options) => {
			calls.push({ url, options });
			const value = await response(url, options);
			if (value instanceof Error) throw value;
			if (value?.http) return { ok: false, status: value.http, headers: { get: () => value.retryAfter ?? null } };
			return { ok: true, status: 200, headers: { get: () => null }, text: async () => typeof value === "string" ? value : JSON.stringify(value) };
		}
	});
	return { service, calls, tick: (ms) => now += ms, respond: (fn) => response = fn };
}

const served = harness({ credential: { [C]: { value: "credential-key" } } });
let result = await served.service.refresh({ providerIds: [C], force: false });
assert.equal(result.entries[0].state, "ok"); assert.equal(result.entries[0].keySource, "credentials");
assert.equal(result.entries[0].label, "Command Code"); assert.equal(result.entries[0].coverage, "complete");
assert.equal(served.calls.length, 2, "余额与套餐/账期并行拉取");
assert.equal(served.calls[1].url, "https://api.commandcode.ai/alpha/billing/subscriptions");
assert.equal(served.calls[0].url, "https://api.commandcode.ai/alpha/billing/credits");
assert.equal(served.calls[0].options.headers.authorization, "Bearer credential-key");
assert.equal(served.calls[0].options.headers["accept-encoding"], "identity");
assert.equal(served.calls[0].options.headers["x-command-code-version"], "1.73.0");
assert.equal(served.calls[0].options.headers["x-cli-environment"], "production");

const PERIOD_END = "2026-11-03T00:00:00Z";
const subscribed = harness({ credential: { [C]: { value: "key" } }, respond: url => url.endsWith("subscriptions") ? { data: { planId: "individual-goat", currentPeriodEnd: PERIOD_END } } : body({}, { planId: undefined, monthlyCredits: 55.86 }) });
const subscribedMonth = (await subscribed.service.refresh({ providerIds: [C], force: true })).entries[0].windows.find(w => w.kind === "month");
assert.equal(subscribedMonth.detail.limit, 70); assert.equal(subscribedMonth.detail.used, 14.14);
assert.equal(subscribedMonth.resetsAt, new Date(PERIOD_END).toISOString());
const fallbackPlan = harness({ credential: { [C]: { value: "key" } }, respond: url => url.endsWith("subscriptions") ? { http: 500 } : body() });
assert.equal((await fallbackPlan.service.refresh({ providerIds: [C], force: true })).entries[0].windows.find(w => w.kind === "month").detail.limit, 80);
const unknownPlan = harness({ credential: { [C]: { value: "key" } }, respond: url => url.endsWith("subscriptions") ? { http: 500 } : body({}, { planId: undefined }) });
const unknownEntry = (await unknownPlan.service.refresh({ providerIds: [C], force: true })).entries[0];
assert.equal(unknownEntry.state, "ok"); assert.equal(unknownEntry.coverage, "partial");
assert.ok(unknownEntry.extras.some(x => x.kind === "monthly-balance"));
const numericPeriod = normalizeCommandCode(body({}, { monthlyCredits: 1 }), { data: { planId: "individual-pro", currentPeriodEnd: Date.parse(PERIOD_END) } });
assert.equal(numericPeriod.windows.find(w => w.kind === "month").resetsAt, new Date(PERIOD_END).toISOString());
assert.equal(normalizeCommandCode(body(), { data: { currentPeriodEnd: Number.MAX_VALUE } }).windows.find(w => w.kind === "month").resetsAt, undefined);
const almostEmpty = normalizeCommandCode(body({}, { monthlyCredits: .001 }));
assert.equal(almostEmpty.windows.find(w => w.kind === "month").status, "ok");
assert.equal(almostEmpty.windows.find(w => w.kind === "month").percent, 99.9);

// 来源链：凭据服务 → 启动环境 → ~/.commandcode/auth.json → 无
const envOnly = harness({ environment: { [C]: { value: "env-key" } }, authText: JSON.stringify({ apiKey: "auth-key" }) });
assert.equal((await envOnly.service.refresh({ providerIds: [C], force: false })).entries[0].keySource, "env");
const fileOnly = harness({ authText: JSON.stringify({ commandcode: { type: "oauth", access: "oauth-token" } }) });
const fileEntry = (await fileOnly.service.refresh({ providerIds: [C], force: false })).entries[0];
assert.equal(fileEntry.keySource, "auth-file"); assert.equal(fileEntry.state, "ok");
assert.equal(fileOnly.calls[0].options.headers.authorization, "Bearer oauth-token");
const noKey = harness();
const noKeyEntry = (await noKey.service.refresh({ providerIds: [C], force: false })).entries[0];
assert.equal(noKeyEntry.state, "no-key"); assert.equal(noKeyEntry.errorCode, "subusage/no-key");
assert.equal(noKey.calls.length, 0, "缺凭据不发请求");

// 旧/手写配置不能绕过managed边界，使用本插件私存Key。
const obsolete = harness({ stored: { keys: { [C]: "obsolete-secret" }, keyModes: { [C]: "manual" } }, authText: JSON.stringify({ apiKey: "actual-cli-key" }) });
const obsoleteResult = await obsolete.service.refresh({ providerIds: [C], force: true });
assert.equal(obsoleteResult.entries[0].keySource, "auth-file");
assert.equal(obsolete.calls[0].options.headers.authorization, "Bearer actual-cli-key");
assert.equal(obsoleteResult.settings.hasKeys[C], false);
assert.equal(obsoleteResult.settings.keyModes[C], "inherit");
const obsoleteOnly = harness({ stored: { keys: { [C]: "obsolete-secret" }, keyModes: { [C]: "manual" } } });
assert.equal((await obsoleteOnly.service.read()).entries.find(e => e.providerId === C).state, "no-key");
assert.ok(!obsoleteOnly.calls.some(call => call.url.includes("commandcode.ai")));

// auth.json 兼容各形态（对齐提供方插件的 resolveAuthFileApiKey）
for (const [text, want] of [
	[JSON.stringify({ apiKey: "direct-key" }), "direct-key"],
	[JSON.stringify({ commandcode: "string-key" }), "string-key"],
	[JSON.stringify({ commandcode: { type: "api", key: "api-key" } }), "api-key"],
	[JSON.stringify({ "command-code": { type: "oauth", access: "oauth-token" } }), "oauth-token"],
	[JSON.stringify({ commandcode: { key: "no-type-key" } }), "no-type-key"]
]) {
	const probe = harness({ authText: text });
	assert.equal((await probe.service.refresh({ providerIds: [C], force: false })).entries[0].keySource, "auth-file");
	assert.equal(probe.calls[0].options.headers.authorization, `Bearer ${want}`);
}

// 错误映射：401 认证失效不保留；429 退避并保留旧窗口；坏 JSON 不猜额度
const failed = harness({ credential: { [C]: { value: "credential-key" } }, respond: () => ({ http: 401 }) });
const authEntry = (await failed.service.refresh({ providerIds: [C], force: true })).entries[0];
assert.equal(authEntry.state, "error"); assert.equal(authEntry.errorCode, "subusage/auth"); assert.equal(authEntry.retainPrevious, false);

const flaky = harness({ credential: { [C]: { value: "credential-key" } } });
await flaky.service.refresh({ providerIds: [C], force: false });
flaky.tick(61000); flaky.respond(() => ({ http: 429, retryAfter: "120" }));
const staleEntry = (await flaky.service.refresh({ providerIds: [C], force: false })).entries[0];
assert.equal(staleEntry.errorCode, "subusage/rate-limit"); assert.equal(staleEntry.retryable, true);
assert.equal(staleEntry.freshness, "stale"); assert.equal(staleEntry.windows[0].percent, 25);
const backoff = flaky.calls.length;
await flaky.service.refresh({ providerIds: [C], force: true });
assert.equal(flaky.calls.length, backoff, "429 退避期间不重发");

const malformed = harness({ credential: { [C]: { value: "credential-key" } }, respond: () => "not JSON" });
const badEntry = (await malformed.service.refresh({ providerIds: [C], force: true })).entries[0];
assert.equal(badEntry.errorCode, "subusage/response"); assert.equal(badEntry.retryable, false);

// 保存边界：managed 提供方拒绝任何凭据补丁，只接受裸 patch
const save = subUsageRemote.descriptors.find((d) => d.method === "save");
assert.throws(() => save.parameters[0].codec.schema.parse({ providerId: C, keyUpdate: { action: "keep" } }), /managed by the provider plugin/);
assert.throws(() => save.parameters[0].codec.schema.parse({ providerId: C, keyMode: "manual" }), /managed by the provider plugin/);
assert.throws(() => save.parameters[0].codec.schema.parse({ providerId: C, cookieUpdate: { action: "keep" } }), /managed by the provider plugin/);
assert.equal(save.parameters[0].codec.schema.parse({ providerId: C, expectedRevision: "r" }).providerId, C);

console.log("PASS Command Code 月额度/账期/部分数据/短窗连坐/非法日期 + 托管凭据来源链与并行拉取（凭据服务/环境/auth.json）");
