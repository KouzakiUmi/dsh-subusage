/**
 * sub2api 声明式适配器（Recipe + 语义归一化）：
 * - 默认端点：GET /v1/usage（兼容 { code, message, data } 信封与直出 JSON）；
 * - 认证方式：Bearer <api_key> 或 X-API-Key；
 * - 作用域语义：
 *   - quota / usage.today / usage.total 归属 Key 级（subject.kind = "key"）；
 *   - subscription 归属分组订阅（subject.kind = "group"）；
 *   - balance 归属用户级共享钱包（subject.kind = "user"，aggregation.balance = "forbid"），
 *     严禁在同用户多分组 Key 之间把共享 balance 重复相加；
 *   - subscription.expires_at 仅作到期说明 note，严禁写入窗口 resetsAt。
 */

import { canonicalizeEntry, unitIdOf } from "../../quota-entry.js";
import { toNumber, usedRatio, remainingRatio, limitMinusUsed, timestamp, unitMap, windowPeriodFromHint } from "../../http/transforms.js";
import { unwrapEnvelope } from "../../http/request-plan.js";

export const SUB2API_RECIPE = Object.freeze({
	id: "sub2api",
	kind: "declarative-http",
	label: "sub2api",
	defaultUsagePath: "/v1/usage",
	candidatePaths: ["/v1/usage", "/api/v1/usage"],
	defaultAuthKind: "bearer",
	supportedAuthKinds: ["bearer", "x-api-key", "custom-header", "raw-authorization"],
	builtinEnvs: ["SUB2API_API_KEY"],
	capabilities: {
		supportsCustomBaseUrl: true,
		supportsMultiKey: true,
		supportsRouteBinding: true,
		supportsDisplayProfile: true,
		supportsRecipeExport: true
	}
});

/** 按顺序取第一个能转成有限数字的候选：?? 链遇到不可解析的原始值（字符串 "abc"）会吞掉后面的数字。 */
function pickNumber(...candidates) {
	for (const c of candidates) {
		const n = toNumber(c);
		if (n !== undefined) return n;
	}
	return undefined;
}

function formatExpiryNote(isoString, nowMs = Date.now()) {
	const ms = Date.parse(isoString);
	if (!Number.isFinite(ms)) return "";
	const dateStr = isoString.slice(0, 10);
	const diffDays = Math.ceil((ms - nowMs) / 86_400_000);
	if (diffDays <= 0) {
		return `套餐已于 ${dateStr} 到期`;
	}
	return `套餐到期 ${dateStr}（还有 ${diffDays} 天）`;
}

function buildWindowElement({ id, label, period, used, limit, remaining, percentage, resetAt, resetSeconds, nowMs, unit = "USD", order, subject }) {
	const u = toNumber(used);
	const l = toNumber(limit);
	const r = toNumber(remaining);
	const p = toNumber(percentage);
	const pct = (l !== undefined && l > 0)
		? (u !== undefined ? usedRatio(u, l) : r !== undefined ? remainingRatio(r, l) : p !== undefined ? Math.max(0, Math.min(100, p)) : undefined)
		: (p !== undefined ? Math.max(0, Math.min(100, p)) : undefined);
	if (pct === undefined) return undefined;
	const actualUsed = u !== undefined ? u : (l !== undefined && l > 0 && r !== undefined ? limitMinusUsed(l, r) : undefined);
	// remaining 为负（limit 0/缺席时上游可能报 -1 哨兵）不能原样透成余额数字，截断为 0。
	const actualLeft = r !== undefined ? Math.max(0, r) : (l !== undefined && l > 0 && u !== undefined ? limitMinusUsed(l, u) : undefined);
	const uMap = unitMap(unit, "USD");
	const sec = toNumber(resetSeconds);
	const resetsAt = timestamp(resetAt) ?? (sec !== undefined && sec > 0 && Number.isFinite(nowMs) ? new Date(nowMs + sec * 1000).toISOString() : undefined);
	const exhausted = pct >= 100 || (actualLeft !== undefined && actualLeft <= 0);
	return {
		type: "window",
		id,
		label,
		order,
		period,
		percent: pct,
		...(actualUsed !== undefined ? {
			used: actualUsed,
			amount: {
				value: actualUsed,
				...(uMap ? uMap : {})
			}
		} : {}),
		...(l !== undefined && l > 0 ? { limit: l } : {}),
		...(actualLeft !== undefined ? { left: actualLeft } : {}),
		...(resetsAt ? { resetsAt } : {}),
		...(exhausted ? { status: "rate-limited" } : {}),
		...(subject ? { subject } : {})
	};
}

export function normalizeSub2ApiPayload(rawBody, options = {}) {
	const nowMs = typeof options.now === "function" ? options.now() : Date.now();
	const data = unwrapEnvelope(rawBody);
	const quotas = [];
	let order = 0;

	const hasFlatSubFields = [
		"daily_limit_usd", "weekly_limit_usd", "monthly_limit_usd",
		"daily_usage_usd", "weekly_usage_usd", "monthly_usage_usd",
		"daily", "weekly", "monthly"
	].some(k => data[k] !== undefined);
	const sub = data.subscription && typeof data.subscription === "object" && !Array.isArray(data.subscription)
		? data.subscription
		: hasFlatSubFields
			? data
			: null;
	const quota = data.quota && typeof data.quota === "object" && !Array.isArray(data.quota)
		? data.quota
		: null;
	const usage = data.usage && typeof data.usage === "object" && !Array.isArray(data.usage)
		? data.usage
		: null;

	const defaultUnit = typeof data.unit === "string" && data.unit.trim() ? data.unit.trim()
		: typeof data.currency === "string" && data.currency.trim() ? data.currency.trim()
		: typeof quota?.unit === "string" && quota.unit.trim() ? quota.unit.trim()
		: "USD";

	// 1. 套餐/分组名称徽标（plan）
	const planName = [
		data.plan_name,
		data.planName,
		sub?.plan_name,
		sub?.planName,
		sub?.group_name,
		data.group_name,
		data.groupName
	].find(v => typeof v === "string" && v.trim());
	if (planName) {
		quotas.push({
			type: "plan",
			id: "plan",
			order: order++,
			value: planName.trim()
		});
	}

	const groupSubject = {
		kind: "group",
		...(typeof (sub?.group_id ?? data.group_id) === "string" || typeof (sub?.group_id ?? data.group_id) === "number"
			? { id: String(sub?.group_id ?? data.group_id) }
			: planName ? { id: planName.trim() } : {})
	};
	const keySubject = {
		kind: "key",
		...(typeof options.keyId === "string" && options.keyId.trim() ? { id: options.keyId.trim() } : {})
	};
	const userSubject = {
		kind: "user",
		...(typeof (data.user_id ?? data.userId) === "string" || typeof (data.user_id ?? data.userId) === "number"
			? { id: String(data.user_id ?? data.userId) }
			: {})
	};

	// 2. 订阅窗口（支持扁平 daily_usage_usd / daily_limit_usd 与嵌套 daily.{used,limit,remaining,reset_at}）
	if (sub) {
		const subWindows = [
			{
				id: "sub-day",
				label: "日配额",
				period: "day",
				node: sub.daily,
				used: pickNumber(sub.daily?.used, sub.daily_usage_usd, sub.daily_used),
				limit: pickNumber(sub.daily?.limit, sub.daily_limit_usd, sub.daily_limit),
				remaining: pickNumber(sub.daily?.remaining, sub.daily_remaining_usd, sub.daily_remaining),
				resetAt: sub.daily?.reset_at ?? sub.daily?.resets_at ?? sub.daily_reset_at,
				unit: sub.daily?.unit ?? sub.unit ?? defaultUnit
			},
			{
				id: "sub-week",
				label: "周配额",
				period: "week",
				node: sub.weekly,
				used: pickNumber(sub.weekly?.used, sub.weekly_usage_usd, sub.weekly_used),
				limit: pickNumber(sub.weekly?.limit, sub.weekly_limit_usd, sub.weekly_limit),
				remaining: pickNumber(sub.weekly?.remaining, sub.weekly_remaining_usd, sub.weekly_remaining),
				resetAt: sub.weekly?.reset_at ?? sub.weekly?.resets_at ?? sub.weekly_reset_at,
				unit: sub.weekly?.unit ?? sub.unit ?? defaultUnit
			},
			{
				id: "sub-month",
				label: "月配额",
				period: "month",
				node: sub.monthly,
				used: pickNumber(sub.monthly?.used, sub.monthly_usage_usd, sub.monthly_used),
				limit: pickNumber(sub.monthly?.limit, sub.monthly_limit_usd, sub.monthly_limit),
				remaining: pickNumber(sub.monthly?.remaining, sub.monthly_remaining_usd, sub.monthly_remaining),
				resetAt: sub.monthly?.reset_at ?? sub.monthly?.resets_at ?? sub.monthly_reset_at,
				unit: sub.monthly?.unit ?? sub.unit ?? defaultUnit
			}
		];
		for (const item of subWindows) {
			const win = buildWindowElement({
				id: item.id,
				label: item.label,
				period: item.period,
				used: item.used,
				limit: item.limit,
				remaining: item.remaining,
				resetAt: item.resetAt,
				unit: item.unit,
				order: order++,
				subject: groupSubject
			});
			if (win) quotas.push(win);
		}
		// 订阅套餐内剩余总额（若存在独立的 remaining_usd / remaining）
		const subRemaining = pickNumber(sub.remaining_usd, sub.remaining);
		const subLimit = pickNumber(sub.limit_usd, sub.limit);
		const subUsed = pickNumber(sub.used_usd, sub.used);
		if (subLimit !== undefined && subLimit > 0 && (subRemaining !== undefined || subUsed !== undefined)) {
			const win = buildWindowElement({
				id: "sub-total",
				label: "套餐配额",
				period: "sub",
				used: subUsed,
				limit: subLimit,
				remaining: subRemaining,
				resetAt: sub.reset_at ?? sub.resets_at,
				unit: sub.unit ?? defaultUnit,
				order: order++,
				subject: groupSubject
			});
			if (win) quotas.push(win);
		} else if (subRemaining !== undefined) {
			const uMap = unitMap(sub.unit ?? defaultUnit, "USD");
			quotas.push({
				type: "amount",
				id: "sub-remaining",
				label: "套餐剩余",
				order: order++,
				role: "plan",
				amount: { value: subRemaining, ...(uMap ? uMap : {}) },
				subject: groupSubject
			});
		}
	}

	// 3. Key 级配额（quota: { limit, used, remaining, reset_at, unit }）
	if (quota) {
		const qLimit = pickNumber(quota.limit, quota.limit_usd, quota.total);
		const qUsed = pickNumber(quota.used, quota.used_usd);
		const qRem = pickNumber(quota.remaining, quota.remaining_usd, quota.left);
		const qUnit = quota.unit ?? defaultUnit;
		if (qLimit !== undefined && qLimit > 0 && (qUsed !== undefined || qRem !== undefined)) {
			const win = buildWindowElement({
				id: "key-quota",
				label: "Key 配额",
				period: windowPeriodFromHint(quota.window_seconds ?? quota.period_seconds, quota.period ?? "period"),
				used: qUsed,
				limit: qLimit,
				remaining: qRem,
				resetAt: quota.reset_at ?? quota.resets_at,
				unit: qUnit,
				order: order++,
				subject: keySubject
			});
			if (win) quotas.push(win);
		} else if (qRem !== undefined) {
			const uMap = unitMap(qUnit, "USD");
			quotas.push({
				type: "amount",
				id: "key-remaining",
				label: "Key 剩余配额",
				order: order++,
				role: "balance",
				amount: { value: qRem, ...(uMap ? uMap : {}) },
				subject: keySubject,
				aggregation: { balance: "allow" }
			});
		}
	}

	// 4. 速率限制数组（rate_limits[]）
	if (Array.isArray(data.rate_limits)) {
		data.rate_limits.slice(0, 8).forEach((rl, idx) => {
			if (!rl || typeof rl !== "object") return;
			const label = typeof rl.name === "string" && rl.name.trim() ? rl.name.trim()
				: typeof rl.label === "string" && rl.label.trim() ? rl.label.trim()
				: `限流窗口 ${idx + 1}`;
			const period = windowPeriodFromHint(rl.window_seconds ?? rl.duration_seconds, rl.period ?? rl.window ?? label);
			const win = buildWindowElement({
				id: `rate-limit-${idx}`,
				label,
				period,
				used: pickNumber(rl.used, rl.current),
				limit: pickNumber(rl.limit, rl.max),
				remaining: pickNumber(rl.remaining, rl.left),
				percentage: rl.percentage ?? rl.percent,
				resetAt: rl.reset_at ?? rl.resets_at,
				resetSeconds: rl.reset_seconds ?? rl.reset_in,
				nowMs,
				unit: rl.unit ?? "requests",
				order: order++,
				subject: keySubject
			});
			if (win) quotas.push(win);
		});
	}

	// 5. 顶层直出 { limit, used, remaining } 兜底（当既无 quota 对象也无 subscription 对象时）
	const hasWindowsSoFar = quotas.some(q => q.type === "window");
	if (!quota && !sub) {
		const topLimit = pickNumber(data.limit, data.hard_limit_usd, data.total_quota);
		const topUsed = pickNumber(data.used, data.total_usage);
		const topRem = pickNumber(data.remaining, data.remaining_usd, data.quota_remaining);
		if (topLimit !== undefined && topLimit > 0 && (topUsed !== undefined || topRem !== undefined)) {
			const win = buildWindowElement({
				id: "quota-window",
				label: "配额",
				period: "period",
				used: topUsed,
				limit: topLimit,
				remaining: topRem,
				resetAt: data.reset_at ?? data.resets_at,
				unit: defaultUnit,
				order: order++,
				subject: keySubject
			});
			if (win) quotas.push(win);
		} else if (topRem !== undefined && toNumber(data.balance ?? data.user_balance) === undefined) {
			const uMap = unitMap(defaultUnit, "USD");
			quotas.push({
				type: "amount",
				id: "key-remaining",
				label: "剩余配额",
				order: order++,
				role: "balance",
				amount: { value: topRem, ...(uMap ? uMap : {}) },
				subject: keySubject,
				aggregation: { balance: "allow" }
			});
		}
	}

	// 6. 用户级余额（balance / user_balance / wallet_balance）：
	//    - 若已有窗口或 Key 级独立配额，则作为充值钱包（role: "wallet"），钱包为 0 不告警；
	//    - 若无窗口与 Key 独立配额（纯按量分组 Key），则作为可用余额（role: "balance"），
	//      但显式标记 subject.kind="user" 且 aggregation.balance="forbid"（reason="shared-owner"），
	//      防止同用户多把分组 Key 把同一钱包余额重复相加。
	const rawBalance = pickNumber(data.balance, data.user_balance, data.wallet_balance, data.balance_usd);
	if (rawBalance !== undefined) {
		const hasPrimaryQuota = quotas.some(q => q.type === "window" || (q.type === "amount" && q.id === "key-remaining"));
		const uMap = unitMap(data.balance_unit ?? defaultUnit, "USD");
		quotas.push({
			type: "amount",
			id: "user-balance",
			label: hasPrimaryQuota ? "账户钱包" : "账户余额",
			order: order++,
			role: hasPrimaryQuota ? "wallet" : "balance",
			amount: {
				value: rawBalance,
				...(uMap ? uMap : {})
			},
			subject: userSubject,
			aggregation: { balance: "forbid", reason: "shared-owner" }
		});
	}

	// 7. 花费指标（usage.today / usage.total 或顶层 today_usage_usd / total_usage_usd）：一律用 spend，绝不混入 balance
	const todaySpend = pickNumber(usage?.today?.cost_usd, usage?.today?.cost, usage?.today, usage?.today_usd, usage?.daily, data.today_usage_usd, data.daily_spend);
	if (todaySpend !== undefined) {
		const uMap = unitMap(usage?.unit ?? defaultUnit, "USD");
		quotas.push({
			type: "amount",
			id: "spend-today",
			label: "今日花费",
			order: order++,
			role: "spend",
			amount: { value: todaySpend, ...(uMap ? uMap : {}) },
			subject: keySubject
		});
	}
	const totalSpend = pickNumber(usage?.total?.cost_usd, usage?.total?.cost, usage?.total, usage?.total_usd, data.total_usage_usd, data.total_spend);
	if (totalSpend !== undefined) {
		const uMap = unitMap(usage?.unit ?? defaultUnit, "USD");
		quotas.push({
			type: "amount",
			id: "spend-total",
			label: "累计花费",
			order: order++,
			role: "spend",
			amount: { value: totalSpend, ...(uMap ? uMap : {}) },
			subject: keySubject
		});
	}

	// 8. 套餐到期时间（subscription.expires_at 或 data.expires_at）：只产 note，绝不写进 resetsAt
	const rawExpiresAt = timestamp(sub?.expires_at ?? sub?.expiresAt ?? data.expires_at ?? data.expiresAt);
	if (rawExpiresAt) {
		const noteText = formatExpiryNote(rawExpiresAt, nowMs);
		if (noteText) {
			quotas.push({
				type: "note",
				id: "sub-expires",
				order: order++,
				role: "expiry-summary",
				text: noteText
			});
		}
	}

	if (!quotas.length) {
		const err = new Error("sub2api 响应未包含可识别的配额、订阅窗口或余额字段");
		err.code = "subusage/response";
		throw err;
	}

	const entry = canonicalizeEntry({
		quotas,
		subject: keySubject,
		coverage: "complete"
	});
	return {
		quotas: entry.quotas,
		windows: entry.windows ?? [],
		extras: entry.extras ?? [],
		subject: entry.subject,
		coverage: "complete"
	};
}
