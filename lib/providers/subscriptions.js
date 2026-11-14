// lib/providers/subscriptions.js —— 订阅窗口型 provider 归一化。
//
// 模块只经参数 `api`（createWindowApi 产物：failure / windowRow /
// cascadeRateLimited / numeric）与宿主通信，不直引核心包，不读宿主私有状态。
// Host 侧在 lib/index.js 里保留同名薄包装器（默认传 windowApi），
// 已有调用方与测试零改动。

// 月总额快照与提供方插件 KNOWN_SUBSCRIPTION_PLANS 对齐（而非月剩余余额）。
// 来源：https://github.com/Mars-Sea/dsh-commandcode-provider/blob/main/src/capabilities.ts
const COMMAND_CODE_MONTHLY_CAPS = { "individual-go": 10, "individual-go-v1": 10, "individual-goat": 70, "individual-pro": 30, "individual-pro-v1": 80, "individual-provider": 15, "individual-max": 150, "individual-ultra": 300, "teams-pro": 40 };
function commandCodeMonthlyCap(planId) {
	const normalized = planId.toLowerCase().replace(/_/g, "-");
	const prefix = Object.keys(COMMAND_CODE_MONTHLY_CAPS).sort((a, b) => b.length - a.length).find(key => normalized === key || normalized.startsWith(`${key}-`));
	return prefix ? COMMAND_CODE_MONTHLY_CAPS[prefix] : undefined;
}

export function normalizeKimi(body, api) {
	const { failure, windowRow, cascadeRateLimited, numeric } = api;
	// 上游 /coding/v1/usages 有两代形态：新版 usages 比例池（limit_5h / limit_7d /
	// limit_month_total），旧版顶层 usage + limits[]（绝对 limit / used / remaining）。
	// 只有 300 分钟窗口在所有形态都下发，因此没有哪个窗口名可以当必需字段：现行账户
	// 下发 5h + 月池而省略 limit_7d，旧账户则完全没有 usages。不推断未知字段。
	const pools = [body?.usages, body?.usage, body?.limits].filter(v => v && typeof v === "object" && !Array.isArray(v));
	const windows = [];
	// limit_month_code 是 month_total 的 Code 份额而非独立预算，不作为独立窗口。
	for (const [field, kind] of [["limit_5h", "5h"], ["limit_7d", "7d"], ["limit_month_total", "month"]]) {
		const row = pools.map(pool => pool[field]).find(v => v !== undefined);
		if (row === undefined) continue;
		if (!numeric(row.used_ratio)) throw failure("subusage/response", "Invalid Kimi used_ratio");
		windows.push(windowRow(kind, row.used_ratio * 100, row.reset_time));
	}
	// 无比例池时退回绝对值：limits[] 的 300 分钟项是 5 小时窗口，顶层 usage 是周额度。
	if (!windows.length) {
		const absolute = (row, kind) => {
			const limit = Number(row?.limit), remaining = Number(row?.remaining);
			if (!Number.isFinite(limit) || limit <= 0 || !Number.isFinite(remaining)) return;
			windows.push(windowRow(kind, (limit - remaining) / limit * 100, row.resetTime));
		};
		const burst = (Array.isArray(body?.limits) ? body.limits : []).find(row => row?.window?.duration === 300 && row.window.timeUnit === "TIME_UNIT_MINUTE");
		if (burst) absolute(burst.detail, "5h");
		if (body?.usage && typeof body.usage === "object") absolute(body.usage, "week");
	}
	if (!windows.length) throw failure("subusage/response", "Invalid Kimi usage response");
	return cascadeRateLimited(windows);
}

export function normalizeZai(body, api) {
	const { failure, windowRow, cascadeRateLimited, numeric } = api;
	const data = body?.data;
	if (!Array.isArray(data?.limits)) throw failure("subusage/response", "Invalid Z.ai usage response");
	const windows = [];
	for (const l of data.limits) {
		const unit = l?.type === "TOKENS_LIMIT" && l.unit === undefined ? 3 : l?.unit;
		if (!["CREDIT_LIMIT", "TOKENS_LIMIT"].includes(l?.type) || ![3, 6].includes(unit)) continue;
		const reset = l.nextResetTime && Number.isFinite(new Date(l.nextResetTime).getTime()) ? new Date(l.nextResetTime).toISOString() : undefined;
		const detail = numeric(l.currentValue) && numeric(l.usage) ? { used: l.currentValue, limit: l.usage, unit: l.type === "TOKENS_LIMIT" ? "tokens" : "credits" } : undefined;
		windows.push(windowRow(unit === 3 ? "5h" : "week", l.percentage, reset, undefined, detail));
	}
	if (!windows.length) throw failure("subusage/response", "Z.ai response carries no coding-plan windows");
	return { windows: cascadeRateLimited(windows), level: typeof data.level === "string" ? data.level : undefined };
}

export function normalizeMimo(balBody, detailBody, usageBody, api) {
	const { failure, windowRow, numeric } = api;
	const rawBal = balBody?.data;
	const bal = rawBal && typeof rawBal.balance === "string" && /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)$/.test(rawBal.balance) && Number.isFinite(Number(rawBal.balance)) ? rawBal : undefined;
	const data = usageBody?.data ?? {}; const detail = detailBody?.data ?? {};
	const pick = (group, name) => Array.isArray(group?.items) ? group.items.find(i => i?.name === name) : undefined;
	const pools = [pick(data.usage, "plan_total_token"), pick(data.monthUsage, "month_total_token")].filter(Boolean);
	const pool = pools.find(row => row.limit !== 0) ?? pools[0];
	const groups = ["usage", "monthUsage"].filter(key => Object.hasOwn(data, key)).map(key => data[key]);
	const emptyGroups = groups.length > 0 && groups.every(group => group === null || Array.isArray(group?.items) && group.items.length === 0);
	const detailReadable = detailBody?.data === null || detailBody?.data && typeof detailBody.data === "object" && !Array.isArray(detailBody.data);
	const noSubscription = detailReadable && [undefined, 0].includes(detailBody?.code) && [undefined, 0].includes(usageBody?.code) && !detail.planName && !detail.planCode && (emptyGroups || pools.length > 0 && pools.every(row => row.limit === 0 && row.used === 0 && row.percent === 0));
	const poolDetail = numeric(pool?.used) && numeric(pool?.limit) && pool.limit > 0 ? { used: pool.used, limit: pool.limit, unit: "credits" } : undefined;
	const windows = pool && pool.limit !== 0 && numeric(pool.percent) ? [windowRow("sub", pool.percent * 100, detail.currentPeriodEnd, undefined, poolDetail)] : [];
	const currency = typeof bal?.currency === "string" && /^[A-Z]{3}$/.test(bal.currency) ? bal.currency : "";
	const extras = bal ? [{ kind: "balance", value: `${bal.balance} ${currency}`.trim() }] : [];
	if (!bal && !windows.length) throw failure("subusage/response", "MiMo 没有可读的余额或套餐用量");
	if (!bal) extras.push({ kind: "note", value: "余额暂不可读；套餐用量已更新" });
	const plan = detail.planName || detail.planCode;
	if (typeof plan === "string") extras.push({ kind: "plan", value: plan });
	return { windows, extras, balanceOk: !!bal, ...(windows.length ? { subscribed: true } : noSubscription ? { subscribed: false } : {}), coverage: windows.length || noSubscription && !!bal ? "complete" : "partial" };
}

export function normalizeOpencodeGo(body, api) {
	const { failure, windowRow, cascadeRateLimited } = api;
	const src = body?.usage ?? body;
	if (!src || typeof src !== "object") throw failure("subusage/response", "Invalid OpenCode Go usage response");
	const windows = [];
	for (const [key, kind] of Object.entries({ rolling: "rolling", weekly: "week", monthly: "month" })) if (src[key]) windows.push(windowRow(kind, src[key].percent, src[key].resetsAt, src[key].status));
	if (!windows.length) throw failure("subusage/response", "OpenCode Go response carries no usage windows");
	const plan = src.source ?? body.source;
	return { windows: cascadeRateLimited(windows), extras: typeof plan === "string" ? [{ kind: "plan", value: plan }] : [], coverage: windows.length === 3 ? "complete" : "partial" };
}

// Official quota contracts; never include unrelated search/image pools in the model badge.
// https://dev.synthetic.new/docs/synthetic/quotas
export function normalizeSynthetic(body, api) {
	const { failure, windowRow, numeric } = api;
	const row = body?.subscription;
	if (!numeric(row?.requests) || !numeric(row?.limit) || row.limit <= 0) throw failure("subusage/response", "Invalid Synthetic subscription quota");
	return { windows: [windowRow("rolling", row.requests / row.limit * 100, row.renewsAt, undefined, { used: row.requests, limit: row.limit, unit: "requests" })], extras: [], coverage: "complete" };
}

// https://docs.nano-gpt.com/api-reference/endpoint/subscription-usage
// 第二个参数是 /api/check-balance 的可选余额响应：余额是**增量**，拿不到就不显示，不影响配额。
export function normalizeNanoGpt(body, balanceBody, api) {
	const { failure, windowRow, cascadeRateLimited, numeric } = api;
	if (typeof body?.active !== "boolean" || !["active", "grace", "inactive"].includes(body.state)) throw failure("subusage/response", "Invalid NanoGPT subscription response");
	const windows = []; let partial = false;
	if (body.active && body.state !== "inactive") for (const [field, kind, limit] of [["dailyInputTokens", "day", body.limits?.dailyInputTokens], ["weeklyInputTokens", "week", body.limits?.weeklyInputTokens], ["tokens", "period", body.tokenLimits?.total]]) {
		const row = body[field];
		if (row == null && limit == null) continue;
		if (row?.degraded === true || !numeric(row?.percentUsed) || !numeric(limit) || limit <= 0 || !numeric(row?.used)) { partial = true; continue; }
		const reset = numeric(row.resetAt) && Number.isFinite(new Date(row.resetAt).getTime()) ? new Date(row.resetAt).toISOString() : undefined;
		windows.push(windowRow(kind, row.percentUsed * 100, reset, undefined, { used: row.used, limit, unit: "tokens" }));
	}
	const extras = [{ kind: "plan", value: body.state }];
	const usd = typeof balanceBody?.usd_balance === "string" && /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)$/.test(balanceBody.usd_balance.trim()) ? balanceBody.usd_balance.trim() : undefined;
	if (usd) extras.push({ kind: "balance", value: `${usd} USD` });
	const routing = body?.routing;
	const mode = routing?.recommendedMode;
	const availability = mode === "unavailable" ? { availability: "blocked", availabilityReason: "routing-policy" }
		: mode === "subscription" ? { availability: routing.subscriptionQuotaAvailable === true ? "included" : "unknown", availabilityReason: "routing-advice" }
		: mode === "paygo" ? { availability: usd !== undefined && Number.isFinite(Number(usd)) && Number(usd) > 0 && routing.paidSpendPolicyAllowsBalance !== false ? "paygo" : "unknown", availabilityReason: "routing-advice" } : {};
	return { windows: cascadeRateLimited(windows), extras, coverage: (windows.length || usd !== undefined || mode === "unavailable") && !partial ? "complete" : "partial", ...availability };
}

// 官方 CLI 的计数消歧规则：有 remaining_percent 时按它校准；旧响应 usage_count 是剩余。
// https://github.com/MiniMax-AI/cli/blob/main/src/utils/quota.ts
export function normalizeMinimax(body, api) {
	const { failure, windowRow, cascadeRateLimited, numeric } = api;
	const code = body?.base_resp?.status_code;
	if (code !== 0) {
		if ([1004, 2049].includes(code)) throw failure("subusage/auth", "MiniMax 订阅 Key 无效或已失效");
		if ([1001, 1002].includes(code)) throw failure("subusage/http", "MiniMax 用量接口暂时不可用", true);
		throw failure("subusage/response", "MiniMax 用量接口未返回成功状态");
	}
	if (!Array.isArray(body.model_remains)) throw failure("subusage/response", "Invalid MiniMax usage response");
	// 不能将视频/图像池混到当前编程模型的药丸，也不能累加共享模型池。
	const general = body.model_remains.filter(row => row?.model_name === "general");
	const candidates = general.length ? general : body.model_remains.filter(row => typeof row?.model_name === "string" && /^MiniMax-M/i.test(row.model_name));
	if (candidates.length !== 1) throw failure("subusage/response", "MiniMax response carries no unambiguous coding quota");
	const row = candidates[0], windows = [];
	for (const [prefix, kind, end] of [["current_interval", "5h", "end_time"], ["current_weekly", "week", "weekly_end_time"]]) {
		const status = row[`${prefix}_status`];
		// 无上限或未开通池不画虚假的 0% 用量；零总计也不证明额度耗尽。
		if (status === 3) continue;
		if (status !== undefined && ![1, 2].includes(status)) throw failure("subusage/response", "Invalid MiniMax quota status");
		const total = row[`${prefix}_total_count`], reported = row[`${prefix}_usage_count`], percent = row[`${prefix}_remaining_percent`];
		if (percent !== undefined && !numeric(percent)) throw failure("subusage/response", "Invalid MiniMax remaining percentage");
		let remaining, detail;
		if (numeric(total) && total > 0 && numeric(reported) && reported <= total) {
			remaining = reported;
			if (percent !== undefined) {
				const asRemaining = Math.abs(reported / total * 100 - percent);
				const asUsed = Math.abs((total - reported) / total * 100 - percent);
				if (Math.min(asRemaining, asUsed) > 1) remaining = undefined;
				else if (asUsed < asRemaining) remaining = total - reported;
			}
			if (remaining !== undefined) detail = { used: total - remaining, limit: total, remaining, unit: "quota" };
		}
		if (percent === undefined && remaining === undefined && status !== 2) {
			if ((total === undefined && reported === undefined) || (total === 0 && reported === 0)) continue;
			throw failure("subusage/response", "Invalid MiniMax quota counts");
		}
		const usedPercent = status === 2 ? 100 : Math.max(0, 100 - (percent ?? remaining / total * 100));
		const endTime = row[end];
		const reset = numeric(endTime) && endTime > 0 && Number.isFinite(new Date(endTime).getTime()) ? new Date(endTime).toISOString() : undefined;
		windows.push(windowRow(kind, usedPercent, reset, undefined, detail));
	}
	const unlimited = !windows.length && row.current_interval_status === 3 && row.current_weekly_status === 3;
	return { windows: cascadeRateLimited(windows), extras: unlimited ? [{ kind: "quota-status", value: "unlimited" }] : [], coverage: windows.length || [row.current_interval_status, row.current_weekly_status].includes(3) ? "complete" : "partial" };
}

export function normalizeCommandCode(body, subscriptionBody, api) {
	const { failure, windowRow, cascadeRateLimited, numeric } = api;
	// 输入是 Command Code 计费接口（/alpha/billing/credits）的原始响应体。
	// absent 窗口 ≠ 零额度：未报告的窗口不画额度行；cap:0 是报告过的无上限，按不受限展示。
	// 已出现的窗口块缺 used/cap 属非法（不当作零用量）；exceeded 缺省视为未超限，resetAt 无值不显示。
	const credits = body?.credits && typeof body.credits === "object" && !Array.isArray(body.credits) ? body.credits : {};
	const limits = body?.windowLimits && typeof body.windowLimits === "object" && !Array.isArray(body.windowLimits) ? body.windowLimits : {};
	if (!Object.keys(credits).length && !Object.keys(limits).length) throw failure("subusage/response", "Invalid Command Code usage response");
	const windows = [];
	for (const [key, kind] of [["fiveHour", "5h"], ["weekly", "week"]]) {
		const w = limits[key];
		if (w === undefined || w === null) continue;
		if (typeof w !== "object" || Array.isArray(w)) throw failure("subusage/response", "Invalid Command Code usage window");
		const cap = w.cap, used = w.used;
		if (!numeric(cap) || !numeric(used)) throw failure("subusage/response", "Invalid Command Code usage window");
		const resetAt = typeof w.resetAt === "number" && w.resetAt > 0 && Number.isFinite(new Date(w.resetAt).getTime()) ? new Date(w.resetAt).toISOString() : undefined;
		windows.push(windowRow(kind, cap > 0 ? used / cap * 100 : 0, resetAt, w.exceeded === true ? "rate-limited" : undefined, cap > 0 ? { used, limit: cap, unit: "credits" } : undefined));
	}
	const extras = [];
	const subscription = subscriptionBody?.data && typeof subscriptionBody.data === "object" && !Array.isArray(subscriptionBody.data) ? subscriptionBody.data : {};
	const plan = typeof subscription.planId === "string" && subscription.planId.trim() ? subscription.planId.trim() : typeof credits.planId === "string" ? credits.planId.trim() : "";
	if (plan) extras.push({ kind: "plan", value: plan });
	const remaining = credits.monthlyCredits;
	const monthlyCap = commandCodeMonthlyCap(plan);
	const hasMonthlyBalance = typeof remaining === "number" && Number.isFinite(remaining);
	if (hasMonthlyBalance) extras.push({ kind: "monthly-balance", value: `${Math.round(remaining * 100) / 100} credits` });
	if (hasMonthlyBalance && monthlyCap !== undefined) {
		const used = Math.max(0, monthlyCap - remaining);
		// 这是套餐月池，不含购买/赠送余额；余额大于快照总额时不显示负用量。
		const end = subscription.currentPeriodEnd;
		const date = typeof end === "string" ? new Date(end) : typeof end === "number" && end > 0 ? new Date(end) : null;
		const resetsAt = date && Number.isFinite(date.getTime()) ? date.toISOString() : undefined;
		windows.push(windowRow("month", used / monthlyCap * 100, resetsAt, undefined, { used: Math.round(used * 1000000) / 1000000, limit: monthlyCap, remaining, unit: "credits", limitSource: "plan-snapshot" }));
	}
	// 余额只合并真正报告过的已购/赠送额度；未报告的字段不冒充 0。
	const reported = ["purchasedCredits", "freeCredits"].map(field => credits[field]).filter(v => typeof v === "number" && Number.isFinite(v));
	if (reported.length) extras.push({ kind: "balance", value: `${Math.round(reported.reduce((sum, v) => sum + Math.max(0, v), 0) * 100) / 100} credits` });
	// 月池耗尽并不证明已购/赠送池或短窗口也不可用；只级联接口的周/5小时限制。
	cascadeRateLimited(windows.filter(w => w.kind !== "month"));
	const exhausted = windows.some(w => w.status === "rate-limited");
	const purchased = credits.purchasedCredits;
	const availability = exhausted && numeric(purchased) && purchased > 0 ? { availability: "paygo", availabilityReason: "paid-credits" }
		: exhausted ? { availability: "blocked", availabilityReason: "quota-exhausted" } : {};
	return { windows, extras, coverage: hasMonthlyBalance || windows.length || reported.length ? "complete" : "partial", ...availability };
}

// The X Subscription / SuperGrok 统一用量池：GetGrokCreditsConfig 响应（官方 grok CLI 的
// /v1/billing?format=credits）。creditUsagePercent 是“已用”百分比（0-100），剩余由
// client 取补；新形态用 creditUsagePercent + currentPeriod（周/月），旧形态回退
// monthlyLimit/used（美分）+ 月账期。无绝对额度字段时不编造明细。
export function normalizeSuperGrok(body, settingsBody, api) {
	const { failure, windowRow, numeric } = api;
	const config = body?.config && typeof body.config === "object" && !Array.isArray(body.config) ? body.config : {};
	const period = config.currentPeriod && typeof config.currentPeriod === "object" && !Array.isArray(config.currentPeriod) ? config.currentPeriod : undefined;
	// 官方 Cent 是 proto3 消息：{} 明确代表 0；缺失消息与坏 val 则仍是未知。
	const cent = row => row && typeof row === "object" && !Array.isArray(row)
		? row.val === undefined ? Object.keys(row).length === 0 ? 0 : undefined
		: typeof row.val === "number" && Number.isFinite(row.val) ? row.val : undefined
		: undefined;
	let percent;
	if (numeric(config.creditUsagePercent)) percent = config.creditUsagePercent;
	else {
		// 旧形态按美分绝对值折算比例；{}（proto3 零值）解码为 0，无上限（limit<=0）不折算。
		const limit = cent(config.monthlyLimit), used = cent(config.used) ?? 0;
		if (limit !== undefined && limit > 0) percent = used / limit * 100;
	}
	// 统一计费代理会成功返回周期/余额却省略百分比：不伪造 0%，保留其它已报告数据。
	const periodOnly = config.creditUsagePercent === undefined && period
		&& ["USAGE_PERIOD_TYPE_WEEKLY", "USAGE_PERIOD_TYPE_MONTHLY"].includes(period.type)
		&& typeof period.end === "string" && Number.isFinite(Date.parse(period.end));
	if (percent === undefined && !periodOnly) throw failure("subusage/response", "Invalid Grok subscription billing response");
	// 周期类型是 proto 枚举名；未知/缺失类型不猜窗口名，按通用订阅池展示；旧形态按月账期。
	const kind = period?.type === "USAGE_PERIOD_TYPE_WEEKLY" ? "week" : period?.type === "USAGE_PERIOD_TYPE_MONTHLY" ? "month" : period ? "sub"
		: config.billingPeriodStart !== undefined || config.billingPeriodEnd !== undefined ? "month" : "sub";
	const windows = percent === undefined ? [] : [windowRow(kind, percent, period?.end ?? config.billingPeriodEnd)];
	const extras = [];
	const plan = typeof settingsBody?.subscription_tier_display === "string" && settingsBody.subscription_tier_display.trim() ? settingsBody.subscription_tier_display.trim()
		: typeof body?.subscription_tier === "string" && body.subscription_tier.trim() ? body.subscription_tier.trim() : "";
	if (plan) extras.push({ kind: "plan", value: plan });
	// prepaidBalance（已购加量余额）以美分计价；只合并真正报告过的值，未报告不冒充 0。
	const prepaid = cent(config.prepaidBalance);
	if (prepaid !== undefined) extras.push({ kind: "balance", value: `${(prepaid / 100).toFixed(2)} USD` });
	return { windows, extras, coverage: percent === undefined ? "partial" : "complete" };
}
