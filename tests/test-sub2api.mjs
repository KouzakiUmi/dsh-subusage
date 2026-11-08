// sub2api 声明式适配器与多分组 Key 监控隔离回归测试
import assert from "node:assert/strict";
import { normalizeSub2ApiPayload } from "../lib/adapters/declarative/sub2api.js";
import { resolveEndpointUrl } from "../lib/http/request-plan.js";
import { sumAccountBalances, canSumBalanceElement } from "../lib/quota-entry.js";
import { loadHostModule } from "./helpers.mjs";

const { SubUsageService } = await loadHostModule();

// 1. 完整 sub2api /v1/usage 响应归一化：套餐名、日/周/月窗口、Key 额度、速率限制、用户共享余额、今日/累计花费、套餐到期时间
const nowMs = Date.parse("2026-10-01T12:00:00Z");
const fullResponse = {
	planName: "Pro Coding Subscription",
	remaining: 15.5,
	unit: "USD",
	balance: 50.0,
	expires_at: "2026-12-31T23:59:59Z",
	subscription: {
		daily_usage_usd: 4.5,
		daily_limit_usd: 10.0,
		weekly_usage_usd: 20.0,
		weekly_limit_usd: 50.0,
		monthly_usage_usd: 150.0,
		monthly_limit_usd: 200.0,
		expires_at: "2026-12-31T23:59:59Z"
	},
	quota: {
		used: 30,
		limit: 100,
		remaining: 70,
		unit: "USD",
		reset_at: "2026-10-15T00:00:00Z"
	},
	rate_limits: [
		{ window: "5h", used: 45, limit: 100, reset_seconds: 3600, unit: "requests" },
		{ window: "7d", percentage: 80, reset_seconds: 86400 }
	],
	usage: {
		today: { cost_usd: 4.5, requests: 120, total_tokens: 45000 },
		total: { cost_usd: 150.0, requests: 3400, total_tokens: 1200000 }
	}
};

const normalized = normalizeSub2ApiPayload(fullResponse, { now: () => nowMs, keyId: "GROUP_A" });
assert.equal(normalized.coverage, "complete");
assert.deepEqual(normalized.subject, { kind: "key", id: "GROUP_A" });

// 套餐名
const planEl = normalized.quotas.find(q => q.type === "plan");
assert.equal(planEl?.value, "Pro Coding Subscription");

// 订阅日/周/月窗口 + Key 总额度窗口 + rate_limits 窗口
const windowIds = normalized.quotas.filter(q => q.type === "window").map(q => q.id);
assert(windowIds.includes("sub-day"), "含日额度窗口");
assert(windowIds.includes("sub-week"), "含周额度窗口");
assert(windowIds.includes("sub-month"), "含月额度窗口");
assert(windowIds.includes("key-quota"), "含 Key 总额度窗口");
assert(windowIds.includes("rate-limit-0"), "含 5h 速率限制窗口");
assert(windowIds.includes("rate-limit-1"), "含 7d 速率限制窗口");

// 严禁把 expires_at 映射为订阅窗口的 resetsAt
for (const win of normalized.quotas.filter(q => q.type === "window" && q.id.startsWith("sub-"))) {
	assert.equal(win.resetsAt, undefined, `${win.id} 不得将 expires_at 当作 resetsAt`);
}
// expires_at 只能进 note 元素（id: "sub-expires"，role: "expiry-summary"）
const expiryNote = normalized.quotas.find(q => q.type === "note" && q.id === "sub-expires");
assert(expiryNote && expiryNote.text.includes("2026-12-31"), "expires_at 作为到期说明保留");

// balance 必须标记为 user 作用域且禁止跨 Key 相加
const userWallet = normalized.quotas.find(q => q.id === "user-balance");
assert(userWallet, "含 user-balance 元素");
assert.equal(userWallet?.amount?.value, 50);
assert.equal(userWallet?.amount?.unit, "USD");
assert.deepEqual(userWallet?.subject, { kind: "user" });
assert.deepEqual(userWallet?.aggregation, { balance: "forbid", reason: "shared-owner" });
assert.equal(canSumBalanceElement(userWallet, normalized), false, "key 级条目上的 user 级共享余额禁止跨行相加");

// usage.today / usage.total 只能映射为 spend，绝不能当成可用余额 balance
const spendEls = normalized.quotas.filter(q => q.type === "amount" && q.role === "spend");
assert.equal(spendEls.length, 2, "今日花费与累计花费均映射为 role=spend");

// 2. 扁平字段兼容（daily_usage_usd 直接在顶层或 data 信封内）
const flatEnvelope = {
	code: 0,
	data: {
		daily_usage_usd: 2.5,
		daily_limit_usd: 10.0,
		balance: 25.0
	}
};
const flatNorm = normalizeSub2ApiPayload(flatEnvelope, { now: () => nowMs });
assert.equal(flatNorm.windows.length, 1);
assert.equal(flatNorm.windows[0].kind, "day");
assert.equal(flatNorm.windows[0].percent, 25);

// 3. URL 拼接去重与子路径保留
assert.equal(resolveEndpointUrl("https://sub2api.example.com", "/v1/usage"), "https://sub2api.example.com/v1/usage");
assert.equal(resolveEndpointUrl("https://sub2api.example.com/v1", "/v1/usage"), "https://sub2api.example.com/v1/usage");
assert.equal(resolveEndpointUrl("https://sub2api.example.com/v1/", "/v1/usage"), "https://sub2api.example.com/v1/usage");
assert.equal(resolveEndpointUrl("https://sub2api.example.com/gateway/v1", "/v1/usage"), "https://sub2api.example.com/gateway/v1/usage");

// 4. 多分组 Key 同时监控（Group A Key + Group B Key）：各自独立显示分组订阅窗口，但不把共享用户余额 $50 翻倍成 $100
const files = new Map();
const env = {
	SUB2API_GROUP_A_KEY: "sk-sub2api-group-a",
	SUB2API_GROUP_B_KEY: "sk-sub2api-group-b"
};
const io = {
	readFileSync(p) { if (!files.has(p)) throw Object.assign(new Error("ENOENT"), { code: "ENOENT" }); return files.get(p); },
	mkdirSync() {},
	writeFileSync(p, v) { files.set(p, v); },
	chmodSync() {},
	renameSync(from, to) { files.set(to, files.get(from)); files.delete(from); }
};
const ctx = {
	get() { return undefined; },
	llm: { listProviders: () => [{ id: "sub2api-route" }] },
	effect() {},
	__env: env
};
const service = new SubUsageService(ctx, {
	io,
	configPath: "memory/config.json",
	now: () => nowMs,
	resolveCredentials: async () => undefined,
	resolveEnvironment: (_id, refName) => env[refName] ? { value: env[refName] } : undefined,
	fetch: async (url, init) => {
		const auth = init?.headers?.authorization ?? init?.headers?.Authorization ?? "";
		const isGroupB = auth.includes("sk-sub2api-group-b");
		const payload = {
			planName: isGroupB ? "Group B Plan" : "Group A Plan",
			balance: 50.0, // 同一用户的共享钱包余额都是 $50
			subscription: {
				daily_usage_usd: isGroupB ? 8.0 : 2.0,
				daily_limit_usd: 10.0
			}
		};
		return {
			ok: true,
			status: 200,
			url,
			headers: { get: () => null },
			text: async () => JSON.stringify(payload)
		};
	}
});

await service.save({
	instance: {
		id: "sub2api-main",
		adapterId: "sub2api",
		label: "Sub2API 主站",
		baseUrl: "https://sub2api.example.com/v1",
		usagePath: "/v1/usage",
		authKind: "bearer",
		credentialMode: "inherit",
		credentialRefs: ["SUB2API_GROUP_A_KEY", "SUB2API_GROUP_B_KEY"],
		routeIds: ["sub2api-route"]
	}
});

const refreshed = await service.refresh({ providerIds: ["sub2api-main"], force: true });
const mainEntry = refreshed.entries.find(e => e.providerId === "sub2api-main");
assert(mainEntry, "返回 sub2api-main 主条目");
assert.equal(mainEntry.state, "ok");
assert.equal(mainEntry.windows[0].percent, 20, "主条目为 Group A（已用 20%）");
assert(Array.isArray(mainEntry.keyAccounts) && mainEntry.keyAccounts.length === 1, "挂接 Group B 的 keyAccounts");
assert.equal(mainEntry.keyAccounts[0].ref, "SUB2API_GROUP_B_KEY");
assert.equal(mainEntry.keyAccounts[0].windows[0].percent, 80, "Group B 独立显示已用 80%");

// 验证跨 Key 求和不会将共享的 $50 用户钱包累加为 $100
const summedShared = sumAccountBalances([mainEntry, ...mainEntry.keyAccounts]);
assert.equal(summedShared.length, 0, "共享用户钱包余额（aggregation.balance=forbid）绝不跨 Key 相加");

service.dispose();
console.log("PASS sub2api 声明式适配器：嵌套/扁平订阅窗口、expires_at 隔离、共享钱包禁加总、多分组 Key 监控与 /v1 URL 去重");
