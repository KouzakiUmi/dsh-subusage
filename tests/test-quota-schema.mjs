// QuotaEntry 统一契约：元素白名单、quotas ↔ legacy 双向适配、边界收编。
import assert from "node:assert/strict";
import {
	canonicalizeEntry, quotaElement, quotasFromLegacy, legacyFromQuotas, unitIdOf,
	PERIODS, UNIT_KINDS, AMOUNT_ROLES, QUOTA_TYPES
} from "../lib/quota-entry.js";

// ── 元素白名单 ────────────────────────────────────────────────
const window = quotaElement({ type: "window", label: "周额度", period: "week", percent: 42, amount: { value: 580, unit: "积分", unitKind: "credit" }, resetsAt: "2026-11-12T00:00:00Z", order: 0 });
assert.equal(window.period, "week");
assert.equal(window.amount.unitKind, "credit");
assert.equal(quotaElement({ type: "window", period: "bogus" }).period, "period", "未知周期归 period 不猜");
assert.equal(quotaElement({ type: "window", amount: { value: 1, unit: "weird", unitKind: "bogus" } }).amount.unitKind, undefined, "未知 unitKind 丢不硬归");
assert.equal(quotaElement({ type: "window", status: "exhausted" }).status, undefined, "非 rate-limited 不保留");
assert.equal(quotaElement({ type: "amount", role: "bogus" }).role, "bogus", "未知 role 保原文不归 balance");
assert.equal(quotaElement({ type: "amount" }).role, "balance", "缺省 role 才是 balance");
assert.equal(quotaElement({ type: "weird" }), undefined, "未知类型整条丢弃");
assert.equal(quotaElement({ type: "note", role: "account", text: "账号 A", custom: { x: 1 } }).custom.x, 1, "未知字段透传");
assert.equal(quotaElement({ type: "window", period: "5h" }, 7).order, 7, "缺 order 用数组位置");
// 已声明字段验证失败不得回透传（坏形状复活会让白名单失效）
const bad = quotaElement({ type: "window", percent: "oops", cascade: "yes", blockedBy: "x", amount: { value: "NaN", unitKind: "bogus" }, period: "day" });
assert.equal(bad.percent, undefined, "坏 percent 不复活");
assert.equal(bad.cascade, undefined, "非 true cascade 不复活");
assert.equal(bad.blockedBy, undefined, "非数组 blockedBy 不复活");
assert.equal(bad.amount, undefined, "整体无效 amount 不复活");

// 扩展字段：id / poolScope / unitId
const pooled = quotaElement({ type: "window", id: "w5h", pool: "gemini", poolScope: "independent", period: "5h" });
assert.equal(pooled.poolScope, "independent");
assert.equal(pooled.id, "w5h");
assert.equal(quotaElement({ type: "window", poolScope: "bogus" }).poolScope, undefined, "未知 poolScope 丢弃");
const amt = quotaElement({ type: "amount", role: "balance", amount: { value: 6600, unit: "Credits" } });
assert.equal(amt.amount.unitId, "credit", "Credit(s) 归一 unitId");
assert.equal(unitIdOf("积分"), "credit");
assert.equal(unitIdOf("Tokens"), "token");
assert.equal(unitIdOf("weird-unit"), "weird-unit", "未知单位小写原文不猜");

// componentOf：总额分项保留标记，消费侧跳过重复合计
const comp = quotaElement({ type: "amount", role: "balance", componentOf: "available", amount: { value: 5, unit: "credits" } });
assert.equal(comp.componentOf, "available", "componentOf 透传保留");

// diagnostics：丢弃/降级留记录
const diagEntry = canonicalizeEntry({ providerId: "x", state: "ok", quotas: [{ type: "window", percent: "oops", period: "day" }, { type: "bogus" }] });
assert.ok(Array.isArray(diagEntry.diagnostics) && diagEntry.diagnostics.length >= 2, "坏字段与未知类型进 diagnostics");
assert.equal(diagEntry.quotas.length, 1, "未知 type 整元素丢弃");

// ── legacy → quotas ───────────────────────────────────────────
const legacy = {
	windows: [
		{ kind: "5h", percent: 80, resetsAt: "2026-11-06T10:00:00Z", groupLabel: "Gemini", status: "ok", detail: { used: 400, limit: 500, unit: "requests" } },
		{ kind: "week", percent: 100, status: "rate-limited", cascade: true, detail: { blockedBy: ["month"] } }
	],
	extras: [
		{ kind: "plan", value: "Pro" },
		{ kind: "balance", value: "$12.34" },
		{ kind: "spend", value: "3.5 USD" },
		{ kind: "monthly-balance", value: "200 credits" },
		{ kind: "quota-status", value: "unlimited" },
		{ kind: "account", value: "当前账号 a@x" },
		{ kind: "note", value: "套餐 2026-12-01 到期" }
	]
};
const quotas = quotasFromLegacy(legacy);
assert.equal(quotas.length, 9);
const w0 = quotas[0];
assert.equal(w0.type, "window");
assert.equal(w0.pool, "Gemini");
assert.equal(w0.used, 400);
assert.equal(w0.limit, 500);
assert.equal(w0.amount.unit, "requests");
const w1 = quotas[1];
assert.equal(w1.status, "rate-limited");
assert.equal(w1.cascade, true);
assert.deepEqual(w1.blockedBy, ["month"]);
assert.equal(quotas[2].type, "plan");
const bal = quotas[3];
assert.equal(bal.type, "amount");
assert.equal(bal.amount.value, 12.34);
assert.equal(bal.amount.unit, "USD");
assert.equal(bal.amount.unitKind, "cash");
assert.equal(quotas[4].role, "spend");
assert.equal(quotas[5].role, "monthly");
assert.equal(quotas[5].amount.value, 200);
assert.equal(quotas[5].amount.unitKind, "credit");
assert.equal(quotas[6].type, "status");
assert.equal(quotas[7].role, "account");
assert.equal(quotas[8].type, "note");

// ── quotas → legacy 回写 ──────────────────────────────────────
const back = legacyFromQuotas(quotas);
assert.equal(back.windows.length, 2);
assert.equal(back.windows[0].groupLabel, "Gemini");
assert.equal(back.windows[0].detail.used, 400);
assert.equal(back.windows[1].status, "rate-limited");
assert.equal(back.extras.find(x => x.kind === "plan").value, "Pro");
assert.equal(back.extras.find(x => x.kind === "balance").value, "$12.34");
assert.equal(back.extras.find(x => x.kind === "spend").value, "3.5 USD");
assert.equal(back.extras.find(x => x.kind === "monthly-balance").value, "200 credits");
assert.equal(back.extras.find(x => x.kind === "account").value, "当前账号 a@x");

// 组合元素：额度包/附赠/钱包/套餐金额 → note/balance 行，文本可读不造数
const mixed = [
	{ type: "plan", value: "Pro", order: 0 },
	{ type: "amount", role: "bonus", label: "附赠金额", amount: { value: 50, unit: "USD", unitKind: "cash" }, order: 1 },
	{ type: "amount", role: "wallet", label: "充值钱包", amount: { value: 8, unit: "USD", unitKind: "cash" }, order: 2 },
	{ type: "package", label: "临时包", role: "temporary", remaining: { value: 6000, unit: "积分", unitKind: "credit" }, expiresAt: "2026-12-01", order: 3 }
];
const derived = legacyFromQuotas(mixed);
assert.equal(derived.extras.find(x => x.kind === "balance").value, "附赠金额 $50", "附赠按余额行展示且保名字");
assert.ok(derived.extras.some(x => x.value.includes("6000") && x.value.includes("到期")), "额度包带剩余与到期");
assert.equal(derived.windows.length, 0, "无 window 元素不产生窗口行");

// ── canonicalizeEntry：别名折叠 + 双向补齐 ────────────────────
const SYM = Symbol("quota-source");
const oldStyle = {
	providerId: "ofm-raccoon", label: "小浣熊 · OFM", state: "ok",
	windows: [], extras: [{ kind: "balance", value: "6600 积分" }],
	coverage: "complete", freshness: "fresh",
	ofmAccounts: [{ accountId: "a", account: "账号甲", state: "ok", windows: [], extras: [{ kind: "balance", value: "6600 积分" }] }],
	[SYM]: "ofm:raccoon"
};
const canon = canonicalizeEntry(oldStyle);
assert.equal(canon.ofmAccounts, undefined, "wire 上不再有 ofmAccounts");
assert.equal(canon.linkedAccounts.length, 1);
assert.equal(canon.linkedAccounts[0].providerId, undefined, "行内 providerId 由调用方标");
assert.equal(canon.quotas.length, 1, "无 quotas 时从 extras 转换");
assert.equal(canon.quotas[0].type, "amount");
assert.equal(canon.quotas[0].amount.value, 6600);
assert.equal(canon.linkedAccounts[0].quotas[0].type, "amount", "账号行同样收编");
assert.equal(canon[SYM], "ofm:raccoon", "Symbol 键保留");

const quotasOnly = {
	providerId: "magpie", label: "Magpie", state: "ok",
	quotas: [
		{ type: "window", period: "day", percent: 30, amount: { value: 70, unit: "requests" }, order: 0 }
	],
	coverage: "complete", freshness: "fresh"
};
const canon2 = canonicalizeEntry(quotasOnly);
assert.equal(canon2.windows.length, 1, "quotas 原生 → 派生 windows 给旧渲染端");
assert.equal(canon2.windows[0].percent, 30);
assert.equal(canon2.extras.length, 0);

const empty = canonicalizeEntry({ providerId: "x", state: "error" });
assert.equal(empty.windows, undefined, "未报告 ≠ 空：缺席保持缺席");
assert.equal(empty.extras, undefined);
assert.deepEqual(empty.quotas, [], "quotas 恒为数组");

// quotas 显式在场即权威：[] 不被 extras 复活
const explicitEmpty = canonicalizeEntry({ providerId: "x", state: "ok", quotas: [], extras: [{ kind: "balance", value: "5" }] });
assert.deepEqual(explicitEmpty.quotas, [], "显式 quotas:[] 不从 extras 导入");
assert.equal(explicitEmpty.extras.length, 1, "已存在的 extras 保留（附加数据不抹）");

// pool 无 poolLabel 时 pool 本身就是 legacy 池身份
const poolOnly = legacyFromQuotas([{ type: "window", period: "day", percent: 10, pool: "gemini", order: 0 }]);
assert.equal(poolOnly.windows[0].groupLabel, "gemini", "pool 兜底 groupLabel");

// used/limit 能推导时 percent 不出 NaN
const derivable = legacyFromQuotas([{ type: "window", period: "week", used: 40, limit: 100, order: 0 }]);
assert.equal(derivable.windows[0].percent, 40, "percent 由 used/limit 推导");
const notDerivable = legacyFromQuotas([{ type: "window", period: "week", used: 40, order: 0 }]);
assert.equal(notDerivable.windows[0].percent, undefined, "推不出不给错误百分比");

console.log("PASS QuotaEntry 契约：元素白名单、legacy↔quotas 双向、边界收编与别名折叠");
