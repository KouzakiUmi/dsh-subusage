import assert from "node:assert/strict";
import { validateDisplayProfile, applyDisplayProfile, isValidPrimaryMetric } from "../lib/platform/display-profile.js";
import { canonicalizeEntry } from "../lib/quota-entry.js";
import { loadHostModule } from "./helpers.mjs";

const { SubUsageService, wireJson } = await loadHostModule();

// 1. primaryMetric 语法校验
assert.equal(isValidPrimaryMetric("auto"), true);
assert.equal(isValidPrimaryMetric("tightest-window"), true);
assert.equal(isValidPrimaryMetric("element:balance"), true);
assert.equal(isValidPrimaryMetric("account-total:USD"), true);
assert.equal(isValidPrimaryMetric("account:acc-1"), true);
assert.equal(isValidPrimaryMetric("invalid-metric"), false);

// 2. DisplayProfile 语义护栏：严禁修改额度语义字段
for (const forbiddenKey of [
	"role",
	"unit",
	"unitId",
	"unitKind",
	"poolScope",
	"resetsAt",
	"resetsAtPointer",
	"expiresAt",
	"expiresAtPointer",
	"percentSemantics",
	"scale",
	"subject",
	"aggregation",
	"state",
	"coverage"
]) {
	assert.throws(
		() => validateDisplayProfile({ [forbiddenKey]: "override" }),
		new RegExp(`DisplayProfile 严禁修改额度语义字段「${forbiddenKey}」`),
		`应当拒绝语义字段 ${forbiddenKey}`
	);
}

// 3. applyDisplayProfile：主指标选择（element:<id> / tightest-window / account-total:<unitId>）、标签覆盖、排序、隐藏元素
const baseEntry = canonicalizeEntry({
	providerId: "sub2api-team",
	providerName: "Team Sub2API",
	ok: true,
	state: "ok",
	coverage: "full",
	quotas: [
		{
			id: "sub-daily",
			type: "window",
			period: "day",
			label: "日订阅",
			order: 10,
			percent: 25,
			resetsAt: "2026-04-21T00:00:00.000Z",
			subject: { kind: "group" }
		},
		{
			id: "sub-monthly",
			type: "window",
			period: "month",
			label: "月订阅",
			order: 20,
			percent: 70,
			resetsAt: "2026-05-01T00:00:00.000Z",
			subject: { kind: "group" }
		},
		{
			id: "wallet",
			type: "amount",
			role: "wallet",
			label: "账户钱包",
			order: 30,
			amount: { value: 42.6789, unit: "USD" },
			subject: { kind: "user", id: "u-1" },
			aggregation: { balance: "forbid", reason: "shared-owner" }
		},
		{
			id: "spend-today",
			type: "amount",
			role: "spend",
			label: "今日消耗",
			order: 40,
			amount: { value: 1.234, unit: "USD" }
		}
	]
});

const appliedElement = applyDisplayProfile(baseEntry, {
	primaryMetric: "element:wallet",
	elementLabels: { wallet: "团队共享钱包", "sub-daily": "每日限额" },
	elementOrders: { wallet: 1, "sub-daily": 2, "sub-monthly": 3 },
	hiddenElementIds: ["spend-today"],
	precision: 2
});

assert.equal(appliedElement.displayPrimary?.kind, "element");
assert.equal(appliedElement.displayPrimary?.elementId, "wallet");
assert.equal(appliedElement.displayPrimary?.value, 42.68, "按 precision=2 格式化展示数值");
assert.equal(appliedElement.displayPrimary?.unit, "USD");
assert.equal(appliedElement.displayPrimary?.unitId, "usd");
assert.equal(appliedElement.quotas.some(q => q.id === "spend-today"), false, "hiddenElementIds 隐藏次要元素");
assert.equal(appliedElement.quotas[0].id, "wallet", "按 elementOrders 调整展示顺序");
assert.equal(appliedElement.quotas[0].label, "团队共享钱包", "按 elementLabels 覆盖显示名");
assert.equal(appliedElement.quotas[0].role, "wallet", "role 语义保持不变");
assert.equal(appliedElement.quotas[0].aggregation?.balance, "forbid", "aggregation 语义保持不变");
assert.equal(appliedElement.quotas.find(q => q.label === "每日限额")?.percent, 25, "底层窗口百分比不被篡改");
assert.equal(appliedElement.windows.find(w => w.kind === "day")?.percent, 25, "legacy windows 百分比不被篡改");

// 4. tightest-window 主指标
const appliedTightest = applyDisplayProfile(baseEntry, {
	primaryMetric: "tightest-window"
});
assert.equal(appliedTightest.displayPrimary?.kind, "window");
assert.equal(appliedTightest.displayPrimary?.elementId, "sub-monthly");
assert.equal(appliedTightest.displayPrimary?.percent, 70);
assert.equal(appliedTightest.displayPrimary?.remainingPercent, 30);

// 5. 缺失目标优雅降级（不伪造 0 余额、无 NaN/undefined）
const appliedMissing = applyDisplayProfile(baseEntry, {
	primaryMetric: "element:non-existent-id"
});
assert.equal(appliedMissing.displayPrimary, undefined);
assert.equal(appliedMissing.displayDegraded?.reason, "target-missing");
assert.equal(appliedMissing.displayDegraded?.requested, "element:non-existent-id");
assert.equal(appliedMissing.displayDegraded?.fallback, "auto");
const lossless = wireJson(appliedMissing);
assert.equal(lossless.displayDegraded.reason, "target-missing");

// 6. account-total 主指标：共享钱包禁止跨 Key 累加时触发 aggregation-unavailable 降级
const multiKeySharedWalletEntry = canonicalizeEntry({
	providerId: "sub2api-team",
	providerName: "Team Sub2API",
	ok: true,
	state: "ok",
	coverage: "full",
	quotas: [],
	keyAccounts: [
		{
			ref: "key-1",
			label: "Key 1",
			ok: true,
			quotas: [
				{
					id: "wallet",
					type: "amount",
					role: "wallet",
					label: "钱包",
					amount: { value: 50, unit: "USD" },
					subject: { kind: "user", id: "u-1" },
					aggregation: { balance: "forbid", reason: "shared-owner" }
				}
			]
		},
		{
			ref: "key-2",
			label: "Key 2",
			ok: true,
			quotas: [
				{
					id: "wallet",
					type: "amount",
					role: "wallet",
					label: "钱包",
					amount: { value: 50, unit: "USD" },
					subject: { kind: "user", id: "u-1" },
					aggregation: { balance: "forbid", reason: "shared-owner" }
				}
			]
		}
	]
});
const degradedTotal = applyDisplayProfile(multiKeySharedWalletEntry, {
	primaryMetric: "account-total:USD"
});
assert.equal(degradedTotal.displayPrimary, undefined, "禁止跨 Key 重复累加共享钱包");
assert.equal(degradedTotal.displayDegraded?.reason, "aggregation-unavailable");

// 7. 修改 DisplayProfile 或 RouteBinding 时绝不清空 SubUsageService 正式数据缓存
const files = new Map();
const io = {
	readFileSync(p) { if (!files.has(p)) throw Object.assign(new Error("ENOENT"), { code: "ENOENT" }); return files.get(p); },
	mkdirSync() {},
	writeFileSync(p, v) { files.set(p, v); },
	chmodSync() {},
	renameSync(from, to) { files.set(to, files.get(from)); files.delete(from); }
};
let upstreamCalls = 0;
const service = new SubUsageService(
	{
		get() {},
		llm: { listProviders: () => [{ id: "my-sub2api", type: "openai" }] },
		effect() {}
	},
	{
		io,
		configPath: "memory/config.json",
		fetch: async url => {
			upstreamCalls += 1;
			return {
				ok: true,
				status: 200,
				url,
				headers: { get: () => null },
				text: async () => JSON.stringify({
					planName: "Pro",
					subscription: { daily_usage_usd: 3, daily_limit_usd: 10 },
					balance: 88.5
				})
			};
		}
	}
);

// 新建自定义实例并首次查询写入缓存
await service.save({
	instance: {
		id: "sub2api-main",
		adapterId: "sub2api",
		label: "主力 Sub2API",
		baseUrl: "https://sub2api.example.com",
		credentialProfile: {
			authKind: "bearer",
			manualSecretId: "sub2api-main"
		}
	},
	secretUpdate: {
		instanceId: "sub2api-main",
		secret: "sk-sub2api-secret-123456"
	}
});

const snap1 = await service.refresh({ providerIds: ["sub2api-main"], force: true });
assert.equal(upstreamCalls, 1);
assert.equal(snap1.entries[0].ok, true);

// 仅修改 DisplayProfile 与 RouteBinding，缓存不得失效
const cacheSizeBefore = service.cache.size;
assert(cacheSizeBefore > 0, "首次查询后缓存已写入");

await service.save({
	instance: {
		id: "sub2api-main",
		adapterId: "sub2api",
		label: "主力 Sub2API（改名）",
		baseUrl: "https://sub2api.example.com",
		credentialProfile: {
			authKind: "bearer",
			manualSecretId: "sub2api-main"
		},
		displayProfile: {
			primaryMetric: "element:user-balance",
			precision: 1
		}
	},
	routeBindings: {
		"my-sub2api": "sub2api-main"
	}
});

assert.equal(service.cache.size, cacheSizeBefore, "修改 DisplayProfile 与 RouteBinding 不清空正式数据缓存");
const snap2 = await service.read();
assert.equal(upstreamCalls, 1, "read() 直接命中缓存并在出口动态应用新 DisplayProfile");
const entryAfterProfile = snap2.entries.find(e => e.providerId === "sub2api-main");
assert.equal(entryAfterProfile?.providerName, "主力 Sub2API（改名）");
assert.equal(entryAfterProfile?.displayPrimary?.elementId, "user-balance");
assert.equal(entryAfterProfile?.displayPrimary?.value, 88.5);

service.dispose();
console.log("PASS DisplayProfile：语义护栏、主指标选择、缺失优雅降级、禁止共享钱包重复求和与零缓存失效");
