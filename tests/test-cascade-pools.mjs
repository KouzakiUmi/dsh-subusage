// 连坐（cascade）口径的完整回归：谁该连坐、范围怎么算、连坐后读数怎么显示。
//
// 覆盖四层：
//  1. 归一化：Antigravity 同池周用尽 → 同池 5h 连坐，跨池不串；
//  2. Magpie：去重合并后按池补连坐（同一池身份只连坐自己）；
//  3. 渲染：连坐窗口保留自己的读数（Client 窗口卡片 / go-panel 行 / 工具文本）；
//  4. 选择：池耗尽的代表窗口优先取根因，不取被连坐的那条。
import assert from "node:assert/strict";
import { loadHostModule } from "./helpers.mjs";

const { normalizeKimi, normalizeZai, normalizeAntigravity, normalizeAntigravityAuthView } = await loadHostModule();
// Magpie 是独立模块，不经 Host 薄包装导出。
import { normalizeMagpie as magpieNormalize } from "../lib/magpie-usage.js";
import { sortWindowsByPeriod } from "../lib/providers/shared.js";

// ── [1] Antigravity：同池连坐，跨池隔离 ──────────────────────────────────────
{
	const entry = normalizeAntigravity({ status: "ok", groups: [
		{ name: "Gemini Models", buckets: [{ window: "5h", remainingPct: 100 }, { window: "7d", remainingPct: 0 }] },
		{ name: "Claude and GPT models", buckets: [{ window: "5h", remainingPct: 100 }, { window: "7d", remainingPct: 66.2 }] }
	] });
	const of = (pool, kind) => entry.windows.find(w => w.groupLabel === pool && w.kind === kind);
	assert.equal(of("Gemini Models", "week").status, "rate-limited", "Gemini 池周额度用尽");
	const gemini5h = of("Gemini Models", "5h");
	assert.equal(gemini5h.status, "rate-limited", "同池 5 小时连坐");
	assert.equal(gemini5h.cascade, true);
	assert.deepEqual(gemini5h.detail.blockedBy, ["week"]);
	assert.equal(gemini5h.percent, 0, "连坐不改写读数（percent 仍是已用的 0%）");
	const claude5h = of("Claude and GPT models", "5h");
	assert.equal(claude5h.status, "ok", "跨池不连坐：Claude 池的 5 小时保持正常");
	assert.equal(claude5h.cascade, undefined);
	// quotas 与 windows 同口径：连坐结果必须一起带出去，否则用 quotas 的消费方看不到。
	const quotaOf = (pool, period) => entry.quotas.find(q => q.type === "window" && q.pool === pool && q.period === period);
	assert.equal(quotaOf("Gemini Models", "5h").cascade, true, "quotas 同步连坐标记");
	assert.equal(quotaOf("Claude and GPT models", "5h").cascade, undefined);
	console.log("PASS Antigravity 归一化：同池周用尽连坐 5 小时、跨池不串、quotas 同步");
}

// ── [2] AntigravityAuthView（第二个提供方通道）同口径 ────────────────────────
{
	const view = normalizeAntigravityAuthView({ state: "available", groups: [
		{ group: "gemini", windows: [{ window: "5h", remainingFraction: 0.9 }, { window: "weekly", remainingFraction: 0 }] },
		{ group: "non-gemini", windows: [{ window: "5h", remainingFraction: 0.9 }, { window: "weekly", remainingFraction: 0.5 }] }
	] });
	const pick = (label, kind) => view.windows.find(w => w.groupLabel === label && w.kind === kind);
	assert.equal(pick("Gemini 模型", "5h").cascade, true, "gemini 池周用尽 → 该池 5h 连坐");
	assert.equal(pick("Claude 与 GPT 模型", "5h").status, "ok", "非 gemini 池不受影响");
	console.log("PASS AntigravityAuthView：两个提供方通道连坐口径一致");
}

// ── [3] Magpie：去重合并后按池补连坐 ─────────────────────────────────────────
{
	const cards = { data: [{
		provider: "antigravity", name: "Antigravity", kind: "subscription", user: "u@x.dev",
		windows: [
			{ name: "Claude & GPT · 7 days", used: 100, remaining: 0 },
			{ name: "Claude & GPT · 5 hours", used: 10, remaining: 90 },
			{ name: "Gemini · 7 days", used: 20, remaining: 80 },
			{ name: "Gemini · 5 hours", used: 10, remaining: 90 }
		],
		readAt: "2026-11-20T00:00:00Z"
	}] };
	const entry = magpieNormalize(cards, "magpie", "Magpie", Date.parse("2026-11-20T01:00:00Z"));
	const wins = entry.linkedAccounts[0].windows;
	const label = (w, pool, kind) => w.groupLabel === pool && w.kind === kind;
	const claude7 = wins.find(w => label(w, "non-gemini", "week"));
	const claude5 = wins.find(w => label(w, "non-gemini", "5h"));
	const gemini5 = wins.find(w => label(w, "gemini", "5h"));
	assert.equal(claude7.status, "rate-limited", "Claude 池周额度用尽");
	assert.equal(claude5.cascade, true, "同池 5 小时连坐");
	assert.equal(gemini5.status, "ok", "Gemini 池不连坐");
	assert.ok(wins.length >= 4, "去重不吞掉窗口");
	console.log("PASS Magpie：去重合并后按池连坐，跨池隔离");
}

// ── [4] 无分池的 provider 仍是全量连坐（旧行为不变） ────────────────────────
{
	const kimi = normalizeKimi({ usages: {
		limit_5h: { used_ratio: 0.05, reset_time: "2026-11-20T14:00:00Z" },
		limit_7d: { used_ratio: 1, reset_time: "2026-11-25T00:00:00Z" }
	} });
	assert.equal(kimi.find(w => w.kind === "5h").cascade, true, "Kimi 无 groupLabel → 仍然全量连坐");
const zai = normalizeZai({ data: { level: "pro", limits: [
		{ type: "CREDIT_LIMIT", unit: 3, percentage: 10, usage: 2000, currentValue: 200, remaining: 1800, nextResetTime: 1790000000000 },
		{ type: "CREDIT_LIMIT", unit: 6, percentage: 100, usage: 10000, currentValue: 10000, remaining: 0, nextResetTime: 1790500000000 }
	] } });
	assert.equal(zai.windows.find(w => w.kind === "5h").cascade, true, "Z.ai 同口径");
	console.log("PASS 无分池 provider：连坐范围回退 all，行为与旧版一致");
}

// ── [5] 展示顺序：短周期在上、长周期在下 ────────────────────────────────────
// 上游下发顺序不固定（Antigravity 的 Gemini 组有时把 7 days 放前面），不排会让同一个界面在
// 两次刷新之间上下颠倒。排序稳定、同周期保持上游顺序；有 groupLabel 时只组内排序。
{
	// Kimi：5h → 7d → month
	const kimi = normalizeKimi({ usages: {
		limit_5h: { used_ratio: 0.2, reset_time: "2026-11-20T18:00:00Z" },
		limit_7d: { used_ratio: 0.3, reset_time: "2026-11-25T00:00:00Z" },
		limit_month_total: { used_ratio: 0.4, reset_time: "2026-12-01T00:00:00Z" }
	} });
	assert.deepEqual(kimi.map(w => w.kind), ["5h", "7d", "month"], "Kimi 短到长");

	// Antigravity：上游把 7d 放前面也必须排成 5h 在前
	const shuffled = normalizeAntigravity({ status: "ok", groups: [
		{ name: "Gemini Models", buckets: [{ window: "7d", remainingPct: 60 }, { window: "5h", remainingPct: 80 }] }
	] });
	assert.deepEqual(shuffled.windows.map(w => w.kind), ["5h", "week"], "上游乱序也要短在上");

	// 分组：组内排序，组间保持首次出现顺序（不能把一个组的两条窗拆到别的组标题下）
	const grouped = normalizeAntigravity({ status: "ok", groups: [
		{ name: "Gemini Models", buckets: [{ window: "7d", remainingPct: 60 }, { window: "5h", remainingPct: 80 }] },
		{ name: "Claude and GPT models", buckets: [{ window: "7d", remainingPct: 20 }] }
	] });
	assert.deepEqual(grouped.windows.map(w => `${w.groupLabel}:${w.kind}`), [
		"Gemini Models:5h", "Gemini Models:week", "Claude and GPT models:week"
	], "组内短在上、组间不混排");

	// 第二个提供方通道同口径
	const view = normalizeAntigravityAuthView({ state: "available", groups: [
		{ group: "gemini", windows: [{ window: "weekly", remainingFraction: 0.6 }, { window: "5h", remainingFraction: 0.8 }] }
	] });
	assert.deepEqual(view.windows.map(w => w.kind), ["5h", "week"], "AuthView 同口径");

	// Magpie 的 antigravity 卡：去重合并后仍按周期排
	const cards = { data: [{
		provider: "antigravity", name: "Antigravity", kind: "subscription", user: "u@x.dev",
		windows: [
			{ name: "Gemini · 7 days", used: 40, remaining: 60 },
			{ name: "Gemini · 5 hours", used: 20, remaining: 80 }
		],
		readAt: "2026-11-20T00:00:00Z"
	}] };
	const magpie = magpieNormalize(cards, "magpie", "Magpie", Date.parse("2026-11-20T01:00:00Z")).linkedAccounts[0];
	assert.deepEqual(magpie.windows.map(w => w.kind), ["5h", "week"], "Magpie 卡短在上");
	console.log("PASS 展示顺序：短周期在上、长周期在下（含分组内排序与上游乱序）");
}

// ── [6] 排序的池边界：groupLabel 不是池身份时不分组 ──────────────────────────
// OFM 把上游的窗口类型名（5h / weekly）放进 groupLabel 当分组标题，它并不代表独立池；
// 这种数据必须按全局周期排，否则每个窗口自成一组 → 排序完全不起作用。
{
	const grouped = sortWindowsByPeriod([
		{ kind: "week", groupLabel: "weekly" }, { kind: "5h", groupLabel: "5h" }
	], { poolKey: null });
	assert.deepEqual(grouped.map(w => w.kind), ["5h", "week"], "poolKey:null 时全局按周期排");

	const pooled = sortWindowsByPeriod([
		{ kind: "week", groupLabel: "池A" }, { kind: "5h", groupLabel: "池A" },
		{ kind: "week", groupLabel: "池B" }
	]);
	assert.deepEqual(pooled.map(w => `${w.groupLabel}:${w.kind}`), ["池A:5h", "池A:week", "池B:week"], "真分池时只组内排");
	console.log("PASS 排序池边界：groupLabel 是池才分组，否则全局按周期");
}
