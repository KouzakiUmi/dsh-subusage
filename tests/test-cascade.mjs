// 限额层级连坐单测：外层用尽 → 内层 0% 也 rate-limited；反向不连坐。
import { loadHostModule, makeAssert } from "./helpers.mjs";

const { normalizeKimi, normalizeZai } = await loadHostModule();
const assert = makeAssert();

// ① Kimi：7 天用尽，5 小时只有 5% → 5h 连坐
const kimi = normalizeKimi({ usages: {
	limit_5h: { used_ratio: 0.05, reset_time: "2026-09-30T14:00:00Z" },
	limit_7d: { used_ratio: 1.0, reset_time: "2026-10-05T00:00:00Z" }
} });
const k5 = kimi.find((w) => w.kind === "5h");
const k7 = kimi.find((w) => w.kind === "7d");
assert(k7.status === "rate-limited", "Kimi 7 天 = rate-limited");
assert(k5.status === "rate-limited" && k5.cascade === true, "Kimi 5 小时连坐（即便 5%）");

// ② 反向：5h 用尽但 7d 未尽 → 7d 保持 ok
const kimi2 = normalizeKimi({ usages: {
	limit_5h: { used_ratio: 1.0, reset_time: "2026-09-30T14:00:00Z" },
	limit_7d: { used_ratio: 0.2, reset_time: "2026-10-05T00:00:00Z" }
} });
assert(kimi2.find((w) => w.kind === "7d").status === "ok", "反向不连坐：7 天保持 ok");

// ③ Z.ai：周窗用尽，5h 只有 10% → 连坐；Credits 明细携带
const zai = normalizeZai({ data: { level: "pro", limits: [
	{ type: "CREDIT_LIMIT", unit: 3, percentage: 10, usage: 2000, currentValue: 200, remaining: 1800, nextResetTime: 1790000000000 },
	{ type: "CREDIT_LIMIT", unit: 6, percentage: 100, usage: 10000, currentValue: 10000, remaining: 0, nextResetTime: 1790500000000 }
] } });
const z5 = zai.windows.find((w) => w.kind === "5h");
const zw = zai.windows.find((w) => w.kind === "week");
assert(zw.status === "rate-limited", "Z.ai 周窗 = rate-limited");
assert(z5.status === "rate-limited" && z5.cascade === true, "Z.ai 5h 连坐（即便 10%）");
assert(z5.detail && z5.detail.used === 200 && z5.detail.limit === 2000, "Z.ai Credits 明细携带（used/limit）");

// ④ 双窗口正常时无连坐
const kimi3 = normalizeKimi({ usages: {
	limit_5h: { used_ratio: 0.1, reset_time: "2026-09-30T14:00:00Z" },
	limit_7d: { used_ratio: 0.3, reset_time: "2026-10-05T00:00:00Z" }
} });
assert(kimi3.every((w) => w.status === "ok" && !w.cascade), "正常时无连坐标记");
assert.summary();
