import { summarizeCreditPackages } from "../credit-packages.js";
import { accountMetadata } from "../connect-usage.js";
// lib/providers/session.js —— 会话/登录态型 provider 归一化。
// 模块只经参数 `api`（createWindowApi 产物）与宿主通信，不直引核心包。

// Codex / ChatGPT 订阅用量：rate_limit.primary_window 与 secondary_window 各含 used_percent 与
// resets_at。免费档的次窗口是 30 天，所以有 window_seconds 时按它判窗口名，缺失时按位置回退 5h / 7d。
// credits 只在真正报告了可用余额时显示：has_credits=false、balance="0" 不画余额；unlimited 单独保留状态，
// 不把「无额度」画成 0。
// https://raw.githubusercontent.com/steipete/CodexBar/main/docs/codex.md
export function normalizeCodexUsage(body, api) {
	const { failure, windowRow, cascadeRateLimited, numeric } = api;
	const windows = [];
	const plan = typeof body?.plan_type === "string" ? body.plan_type.trim() : "";
	// 当前 Pro 三档无短窗；未知档位的缺失时长不按主窗口位置猜成 5h。
	const weeklyOnly = ["pro", "prolite", "promax"].includes(plan.toLowerCase());
	const windowKind = (row, fallback) => {
		const seconds = row?.window_seconds ?? row?.limit_window_seconds;
		if (!Number.isFinite(seconds) || seconds <= 0) return fallback;
		return seconds >= 2592000 ? "month" : seconds >= 604800 ? "week" : seconds >= 86400 ? "day" : "5h";
	};
	const push = (row, fallback) => {
		if (!row || typeof row !== "object" || Array.isArray(row)) return;
		if (!numeric(row.used_percent)) throw failure("subusage/response", "Invalid Codex used_percent");
		// 实测（2026-10-09）：resets_at 是 **Unix 秒数**，不是 ISO 串——两种都要认，否则重置时间会静默丢失。
		const raw = row.resets_at ?? row.reset_at;
		const reset = typeof raw === "string" && Number.isFinite(Date.parse(raw)) ? new Date(Date.parse(raw)).toISOString()
			: numeric(raw) && raw > 0 ? new Date(raw * 1000).toISOString()
			: undefined;
		windows.push(windowRow(windowKind(row, fallback), row.used_percent, reset));
	};
	const limits = body?.rate_limit && typeof body.rate_limit === "object" && !Array.isArray(body.rate_limit) ? body.rate_limit : {};
	const positional = !plan || ["plus", "team", "business"].includes(plan.toLowerCase());
	push(limits.primary_window, weeklyOnly ? "week" : positional ? "5h" : "rolling");
	push(limits.secondary_window, weeklyOnly ? "week" : positional ? "7d" : "rolling");
	const extras = [];
	if (plan) extras.push({ kind: "plan", value: plan });
	const credits = body?.credits && typeof body.credits === "object" && !Array.isArray(body.credits) ? body.credits : {};
	const balance = typeof credits.balance === "string" && credits.balance.trim() ? credits.balance.trim() : typeof credits.balance === "number" ? String(credits.balance) : "";
	const creditBalance = balance && /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)$/.test(balance) && Number.isFinite(Number(balance)) ? Number(balance) : undefined;
	if (credits.has_credits === true && credits.unlimited !== true && creditBalance !== undefined) extras.push({ kind: "balance", value: balance });
	if (credits.has_credits === true && credits.unlimited === true) extras.push({ kind: "credit-status", value: "unlimited" });
	const control = body?.spend_control;
	const member = control?.individual_limit;
	const memberLimit = Number(member?.limit), memberUsed = member?.used == null ? NaN : Number(member.used);
	if (member && Number.isFinite(memberLimit) && memberLimit > 0 && Number.isFinite(memberUsed) && memberUsed >= 0) {
		const reset = numeric(member.reset_at) && member.reset_at > 0 ? new Date(member.reset_at * 1000).toISOString() : undefined;
		windows.push({ ...windowRow("period", memberUsed / memberLimit * 100, reset, undefined, { used: memberUsed, limit: memberLimit, unit: "credits", scope: "member-budget" }), groupLabel: "groupMemberBudget" });
	}
	const reached = body?.rate_limit_reached_type?.kind;
	const restricted = control?.reached === true || ["workspace_owner_credits_depleted", "workspace_member_credits_depleted", "workspace_owner_usage_limit_reached", "workspace_member_usage_limit_reached"].includes(reached);
	const exhausted = windows.some(w => w.status === "rate-limited") || limits.limit_reached === true || limits.allowed === false;
	const creditFallback = credits.has_credits === true && (credits.unlimited === true || creditBalance > 0);
	const availability = restricted ? { availability: "blocked", availabilityReason: "spend-control" }
		: exhausted && creditFallback ? { availability: "unknown", availabilityReason: "credit-eligibility" }
		: exhausted ? { availability: "blocked", availabilityReason: "quota-exhausted" } : {};
	if (!windows.length && !extras.some(e => e.kind !== "plan") && !restricted) extras.push({ kind: "note", value: "未检测到订阅额度窗口" });
	const reported = windows.length || extras.some(e => e.kind !== "plan" && e.kind !== "note") || restricted;
	// 额外特性池未按所选模型映射前，不声称已完整覆盖它们。
	const partial = Array.isArray(body?.additional_rate_limits) && body.additional_rate_limits.length > 0;
	return { windows: cascadeRateLimited(windows), extras, coverage: reported && !partial ? "complete" : "partial", ...availability };
}


export function normalizeCopilotUsage(body, api) {
	const { failure, windowRow } = api;
 if (!body || typeof body !== "object" || Array.isArray(body)) throw failure("subusage/response", "Invalid Copilot usage response");
 const plan = typeof body.copilot_plan === "string" ? body.copilot_plan.trim() : "";
 const stamp = value => typeof value === "string" && Number.isFinite(Date.parse(value)) ? new Date(Date.parse(value)).toISOString() : undefined;
 const reset = stamp(body.quota_reset_date) ?? stamp(body.limited_user_reset_date);
 const count = value => typeof value === "number" && Number.isFinite(value) ? value : undefined;
 const record = value => value && typeof value === "object" && !Array.isArray(value) ? value : undefined;
 const snapshots = record(body.quota_snapshots) ?? {};
 // 返回 undefined = 该桶不可画（缺失 / 占位）；{ unlimited } = 明确不设限。
 const bucket = row => {
  row = record(row);
  if (!row) return undefined;
  const entitlement = count(row.entitlement), remaining = count(row.remaining) ?? count(row.quota_remaining);
  if (row.unlimited === true || entitlement === -1 || remaining === -1) return { unlimited: true };
  if (entitlement === undefined || entitlement <= 0) return undefined;
  const left = count(row.percent_remaining);
  const percent = left !== undefined ? 100 - left : remaining !== undefined ? (entitlement - remaining) / entitlement * 100 : undefined;
  if (percent === undefined) return undefined;
  // 实测（2026-10-23）：remaining 是取整的整数（755）而 quota_remaining 是浮点（755.6），credits_used 与账面一致（744）；有它就用它。
  const used = count(row.credits_used);
  const detail = used !== undefined && used >= 0 ? { used, limit: entitlement, unit: "requests" } : remaining !== undefined ? { used: Math.max(0, entitlement - remaining), limit: entitlement, unit: "requests" } : undefined;
  return { percent: Math.min(100, Math.max(0, percent)), detail };
 };
 const windows = [];
 const extras = [];
 if (plan) extras.push({ kind: "plan", value: plan });
 const premiumRow = record(snapshots.premium_interactions);
 const premium = bucket(premiumRow);
 const push = (label, found) => { if (found?.percent !== undefined) windows.push({ ...windowRow("month", found.percent, reset, undefined, found.detail), groupLabel: label }); };
 push("Premium requests", premium);
 if (premium?.unlimited) extras.push({ kind: "quota-status", value: "unlimited" });
 push("Chat", bucket(snapshots.chat));
 push("Completions", bucket(snapshots.completions));
 // 免费档旧形态：只在没有任何桶可画时才读，避免付费账号残留的 limited_* 字段冒出免费档窗口。
 if (!windows.length && !premium?.unlimited) {
  const remaining = record(body.limited_user_quotas), total = record(body.monthly_quotas);
  for (const [field, label] of [["chat", "Chat"], ["completions", "Completions"]]) {
   const left = count(remaining?.[field]), size = count(total?.[field]);
   if (left === undefined || size === undefined || size <= 0) continue;
   push(label, { percent: Math.min(100, Math.max(0, (size - left) / size * 100)), detail: { used: Math.max(0, size - left), limit: size, unit: "requests" } });
  }
 }
 // 超出月度主池后的额外用量：只有用户启用了额外计费才有意义（占位桶 entitlement 为 0，premium 为 undefined，不会走到这里）。
 const overagePermitted = premium?.percent !== undefined && premiumRow?.overage_permitted === true;
 const overage = count(premiumRow?.overage_count);
 if (overagePermitted && overage > 0) extras.push({ kind: "note", value: `已产生 ${overage} 次超额用量（已启用额外计费）` });
 const exhausted = premium?.percent >= 100;
 if (!windows.length && !premium?.unlimited) extras.push({ kind: "note", value: /business|enterprise|team/i.test(plan) || (premiumRow && !premium && count(premiumRow.entitlement) === 0 && body.token_based_billing === true && !/individual|free|pro/i.test(plan)) ? "该席位由组织计费，GitHub 不返回个人额度" : "未检测到 Copilot 额度窗口" });
 const reported = windows.length > 0 || premium?.unlimited === true;
 return { windows, extras, coverage: reported ? "complete" : "partial", ...(exhausted && overagePermitted ? { availability: "paygo", availabilityReason: "overage-permitted" } : {}) };
}
export function normalizeOpenDesign(body, summary, api) {
	const { failure, windowRow, windowKindFromSeconds, cascadeRateLimited } = api;
	const root = body && typeof body === "object" && !Array.isArray(body) ? body : undefined;
	if (!root) throw failure("subusage/response", "OpenDesign 响应不是 JSON 对象");
	// 这个端点没有公开文档：一个预期字段都读不到时，说明契约又变了（改名、外面套了信封、
	// 或者直接回了错误壳）。这种情况必须报「无法解析」，不能把「什么都没读到」说成
	// 「该账号没有订阅」——那是一个确定的负面结论，比未知更误导人。
	// 判据只认「额度语义」字段：eligible / tier / windows。**不认 workspaceId**——它在每条
	// 200 响应里都有，单凭它只能说明「是同一个工作区」，不能说明额度读到了；也不认
	// generatedAt 这种通用时间戳。tier 明确为 null 是「确定没有套餐」，算读到了答案。
	const recognized = typeof root.eligible === "boolean" || typeof root.tier === "string" || root.tier === null || Array.isArray(root.windows);
	if (!recognized) throw failure("subusage/response", "OpenDesign 响应没有可用的配额或余额");
	// 非负额度（字符串或数字都收）；取不到合法值就返回 undefined，绝不当作 0。
	const credits = value => {
		if (typeof value === "number") return Number.isFinite(value) && value >= 0 ? value : undefined;
		if (typeof value !== "string" || !/^\d+$/.test(value.trim())) return undefined;
		const parsed = Number(value.trim());
		return Number.isFinite(parsed) ? parsed : undefined;
	};
	const windows = [];
	for (const row of Array.isArray(root.windows) ? root.windows : []) {
		if (!row || typeof row !== "object" || Array.isArray(row)) continue;
		const seconds = typeof row.durationSeconds === "number" && Number.isFinite(row.durationSeconds) && row.durationSeconds > 0 ? row.durationSeconds : undefined;
		const used = credits(row.usedCredits), limit = credits(row.limitCredits);
		// 上限读不到或为 0 时**跳过该窗口**，而不是画成 0%：不同模型的额度消耗倍率本来就不同，
		// 少一行读数好过编造一行。
		if (seconds === undefined || used === undefined || limit === undefined || limit <= 0) continue;
		// remainingCredits 是接口自己报的剩余量，能拿到就照报（它与 limit − used 未必相等：
		// 不同模型的消耗倍率不同），拿不到就只报 used / limit。
		const remaining = credits(row.remainingCredits);
		const detail = remaining === undefined ? { used, limit, unit: "credits" } : { used, remaining, limit, unit: "credits" };
		windows.push(windowRow(windowKindFromSeconds(seconds), Math.min(100, used / limit * 100), typeof row.resetsAt === "string" ? row.resetsAt : undefined, undefined, detail));
	}
	const extras = [];
	const TIER = { go: "Go", plus: "Plus", pro: "Pro", max: "Max" };
	const tier = typeof root.tier === "string" && root.tier.trim() ? TIER[root.tier.trim()] ?? root.tier.trim() : "";
	if (tier) extras.push({ kind: "plan", value: tier });
	// 账号级余额汇总是**另一个池**：Design Plan 的 5 小时 / 7 天窗只约束 Design Plan 额度，
	// 套餐模型额度与钱包余额不在 coding-plan-usage 里。汇总缺失时照常只报窗口。
	const billing = openDesignBilling(summary, api);
	extras.push(...billing.extras);
	// balanceOk 与 MiMo 共用同一套「登录验证」契约：CookieLogin 只在它为真时才保存 Cookie。
	// 走到这里请求已经成功并解析完毕，因此是 true——「未订阅」也是读到了确定的答案，不是失败。
	// 既没有窗口也没有档位：该账号没有 Design Plan 订阅，用 subscribed:false 让前端收起额度区，
	// 而不是画一张 0% 的空卡片；钱包余额照常保留。
	if (!windows.length && !tier) {
		extras.unshift({ kind: "plan", value: "该账号没有 Design Plan 订阅" });
		return { windows: [], extras, coverage: "complete", subscribed: false, balanceOk: true };
	}
	// 汇总没有本期发放总额；模型等效额度不能作为钱包分母，因此不追加推算的月池窗口。
	// 有档位却读不到窗口，与「有窗口」不同：额度线还没下发，标 partial，别让它看起来是完整读数。
	return { windows: cascadeRateLimited(windows), extras, coverage: windows.length ? "complete" : "partial", balanceOk: true };
}
const openDesignNumber = value => {
	if (typeof value === "number") return Number.isFinite(value) ? value : undefined;
	const raw = typeof value === "string" ? value.trim() : "";
	return /^-?\d+(\.\d+)?$/.test(raw) && Number.isFinite(Number(raw)) ? Number(raw) : undefined;
};
/** 钱包余额与套餐模型额度的剩余量。读不到就什么都不报，绝不补 0。 */
export function openDesignBilling(summary, api) {
	const { failure } = api;
	const extras = [];
	if (!summary || typeof summary !== "object" || Array.isArray(summary)) return { extras };
	const perUsd = openDesignNumber(summary.creditsPerUsd);
	const subscription = openDesignNumber(summary.balances?.subscriptionCredits);
	if (perUsd !== undefined && perUsd > 0 && subscription !== undefined && subscription >= 0) {
		extras.push({ kind: "monthly-balance", value: `${Math.round(subscription / perUsd * 100) / 100} USD` });
	}
	// 页面上的「钱包余额」= 订阅额度 + 充值额度（2026-10-20 与控制台悬浮明细逐项对过）。
	const balance = openDesignNumber(summary.balanceUsd) ?? openDesignNumber(summary.totalAvailableCreditsUsd);
	if (balance !== undefined && balance >= 0) extras.push({ kind: "balance", value: `${Math.round(balance * 100) / 100} USD` });
	return { extras };
}

/**
 * 额度接口的路径里必须带真实 workspaceId：`GET .../workspaces/current` 单独请求是 200，
 * 但把 `current` 当路径参数塞进额度 URL 会回 403 `workspace_member_required`（2026-10-18 实测）。
 * 所以先读当前工作区拿到 id，再拼额度 URL。id 只放行裸标识符，避免拼出别的路径。
 */
export function normalizeAntigravity(snapshot, api) {
	const { failure, windowRow } = api;
	const root = snapshot && typeof snapshot === "object" && !Array.isArray(snapshot) ? snapshot : undefined;
	if (!root) throw failure("subusage/response", "Antigravity 额度快照不是对象");
	const groups = Array.isArray(root.groups) ? root.groups : [];
	const windows = [], extras = [];
	let disabled = 0, unreported = 0;
	for (const group of groups) {
		const name = typeof group?.name === "string" ? group.name.trim() : "";
		for (const bucket of Array.isArray(group?.buckets) ? group.buckets : []) {
			if (!bucket || typeof bucket !== "object" || Array.isArray(bucket)) continue;
			if (bucket.disabled === true) { disabled++; continue; }
			const remaining = antigravityRemaining(bucket);
			if (remaining === undefined) { unreported++; continue; }
			// 组名本身就是「这条窗口约束哪批模型」（Gemini Models / Claude and GPT models…），
			// 单组时同样保留：丢了它就看不出这条百分比管的是哪批模型。
			windows.push({ ...windowRow(antigravityWindowKind(bucket), 100 - remaining, bucket.resetTime), ...(name ? { groupLabel: name } : {}) });
		}
	}
	if (disabled) extras.push({ kind: "note", value: `${disabled} 个额度窗口已停用（本账号不可用）` });
	if (unreported) extras.push({ kind: "note", value: `${unreported} 个额度窗口未报告剩余比例` });
	const plan = typeof root.plan === "string" ? root.plan.trim() : "";
	if (plan) extras.push({ kind: "plan", value: plan });
	const credits = root.credits && typeof root.credits === "object" ? root.credits : undefined;
	if (credits?.status === "ok" && Number.isSafeInteger(credits.remainingCredits) && credits.remainingCredits >= 0) extras.push({ kind: "balance", value: `${credits.remainingCredits} credits` });
	else if (!plan && typeof credits?.planName === "string" && credits.planName.trim()) extras.push({ kind: "plan", value: credits.planName.trim() });
	if (root.status !== "ok") {
		const reason = typeof root.error?.message === "string" && root.error.message.trim() ? root.error.message : "Antigravity 额度读取失败";
		return { providerId: "antigravity", label: (api.linkedProviders && api.linkedProviders.antigravity && api.linkedProviders.antigravity.label) || "Antigravity", state: "error", windows: [], extras, coverage: "partial", freshness: "unknown", error: reason };
	}
	// 原生 quotas：每池窗口带 poolScope:"independent"——Antigravity 的分池是真独立预算，
	// 这是整个仓库里唯一该标 independent 的地方。
	const quotas = [];
	let qOrder = 0;
	for (const w of windows) quotas.push({ type: "window", order: qOrder++, period: w.kind, percent: w.percent, pool: w.groupLabel, poolLabel: w.groupLabel, poolScope: "independent", ...(w.resetsAt ? { resetsAt: w.resetsAt } : {}) });
	if (plan) quotas.push({ type: "plan", order: qOrder++, id: "plan", value: plan });
	if (credits?.status === "ok" && Number.isSafeInteger(credits.remainingCredits) && credits.remainingCredits >= 0) quotas.push({ type: "amount", order: qOrder++, id: "credits", role: "balance", amount: { value: credits.remainingCredits, unit: "credits" } });
	return {
		providerId: "antigravity", label: (api.linkedProviders && api.linkedProviders.antigravity && api.linkedProviders.antigravity.label) || "Antigravity", state: "ok", windows, extras, quotas,
		coverage: windows.length ? "complete" : "partial",
		freshness: root.stale === true ? "stale" : "fresh",
		...(typeof root.updatedAt === "string" && Number.isFinite(Date.parse(root.updatedAt)) ? { lastSuccessAt: new Date(root.updatedAt).toISOString() } : {})
	};
}
/** 剩余比例（0..100）：`remainingPct` 优先，其次 0..1 的 `remainingFraction`；都不合法就返回 undefined。 */
function antigravityRemaining(bucket) {
	const pct = Number.isFinite(bucket.remainingPct) && bucket.remainingPct >= 0 && bucket.remainingPct <= 100 ? bucket.remainingPct : undefined;
	if (pct !== undefined) return pct;
	const fraction = Number.isFinite(bucket.remainingFraction) && bucket.remainingFraction >= 0 && bucket.remainingFraction <= 1 ? bucket.remainingFraction : undefined;
	return fraction === undefined ? undefined : fraction * 100;
}
/** 窗口长度 → 本插件的 kind 词汇；只用官方下发的 `window` / `name` 判断，认不出就按 `period`。 */
function antigravityWindowKind(bucket) {
	const raw = `${typeof bucket.window === "string" ? bucket.window : ""} ${typeof bucket.name === "string" ? bucket.name : ""}`.toLowerCase();
	if (/5\s*h|5\s*小时|five\s*-?\s*hour/.test(raw)) return "5h";
	if (/7\s*d|week|每周|周/.test(raw)) return "week";
	if (/month|每月|月度|月/.test(raw)) return "month";
	if (/day|daily|每日|每天|天/.test(raw)) return "day";
	return "period";
}
/**
 * dsh-tool-antigravity（服务名 `antigravityAuth`，方法 `usage()`）的配额视图 → 本插件条目。
 * 视图形状照抄该包 `lib/types/quota.d.ts` 的 `QuotaStatusView`（v0.5.x，由
 * @cortexkit/antigravity-auth-core 的 retrieveUserQuotaSummary 归一化产出）：
 *   { state: "available" | "unauthenticated" | "forbidden" | "rate-limited"
 *           | "offline" | "timeout" | "protocol-drift",
 *     checkedAt?: ISO,
 *     groups?: [{ group: "gemini" | "non-gemini", modelCount,
 *                 windows: [{ window: "5h" | "weekly", remainingFraction: 0..1, resetTime }] }] }
 * 换算约定与 normalizeAntigravity 一致：
 * 1. 它报的是**剩余**比例，对外 percent = 已用 = `(1 − remainingFraction) × 100`；
 * 2. `gemini` / `non-gemini` 两组分别标注 groupLabel（该组窗口约束哪批模型，徽章口径照抄它
 *    自己的 pet-balance 卡片：Gemini / Claude / GPT）；
 * 3. `unauthenticated` 与 Trae 联动的 signed-out 同口径：返回 null——没登录不是故障，
 *    全量查询里不占行，点名时由 linkedProvider 补一条可执行说明；
 * 4. 其余非 available 状态各给一条可读 error（查询限流 ≠ 额度用尽，绝不画成红色耗尽窗口）。
 */
export function normalizeAntigravityAuthView(view, api) {
	const { failure, windowRow } = api;
	const root = view && typeof view === "object" && !Array.isArray(view) ? view : undefined;
	if (!root) throw failure("subusage/response", "Antigravity 配额视图不是对象");
	const base = { providerId: "antigravity", label: (api.linkedProviders && api.linkedProviders.antigravity && api.linkedProviders.antigravity.label) || "Antigravity", windows: [], extras: [], coverage: "partial", freshness: "unknown" };
	const fail = message => ({ ...base, state: "error", error: message });
	switch (root.state) {
		case "unauthenticated": return null;
		case "forbidden": return fail("当前 Antigravity 账号无权查询配额（未完成 Google 授权、企业授权受限，或未开通 Cloud Code Assist）");
		case "rate-limited": return fail("Antigravity 配额查询被限流，请稍后重试");
		case "timeout": return fail("Antigravity 配额查询超时，请稍后重试");
		case "offline": return fail("Antigravity 配额服务暂时不可达（网络或代理问题），请稍后重试");
		case "protocol-drift": return fail("Antigravity 配额响应格式无法识别，提供方插件（dsh-tool-antigravity）可能需要更新");
		case "available": break;
		default: return fail("Antigravity 配额状态无法识别");
	}
	const groupLabels = { gemini: "Gemini 模型", "non-gemini": "Claude 与 GPT 模型" };
	const windowKinds = { "5h": "5h", weekly: "week" };
	const windows = [];
	for (const group of Array.isArray(root.groups) ? root.groups : []) {
		if (!group || typeof group !== "object" || Array.isArray(group)) continue;
		const label = groupLabels[group.group] ?? (typeof group.group === "string" ? group.group : "");
		for (const bucket of Array.isArray(group.windows) ? group.windows : []) {
			if (!bucket || typeof bucket !== "object" || Array.isArray(bucket)) continue;
			const fraction = Number.isFinite(bucket.remainingFraction) && bucket.remainingFraction >= 0 && bucket.remainingFraction <= 1 ? bucket.remainingFraction : undefined;
			// 比例 / 窗口档位缺任一个都不造窗口（与对方 normalizeQuotaResponse 的放行条件一致）。
			if (fraction === undefined || !(bucket.window in windowKinds)) continue;
			windows.push({
				...windowRow(windowKinds[bucket.window], (1 - fraction) * 100, bucket.resetTime),
				...(label ? { groupLabel: label } : {})
			});
		}
	}
	const quotas = windows.map((w, i) => ({ type: "window", order: i, period: w.kind, percent: w.percent, pool: w.groupLabel, poolLabel: w.groupLabel, poolScope: "independent", ...(w.resetsAt ? { resetsAt: w.resetsAt } : {}) }));
	return {
		...base, state: "ok", windows, quotas,
		coverage: windows.length ? "complete" : "partial",
		freshness: "fresh",
		...(typeof root.checkedAt === "string" && Number.isFinite(Date.parse(root.checkedAt)) ? { lastSuccessAt: new Date(root.checkedAt).toISOString() } : {})
	};
}
/**
 * dsh-connect-trae 的用量文档（`TraeWebUsage`）→ 本插件的条目。
 * 文档形状取自该包 `lib/index.d.ts` 的 `TraeWebUsage`（v4.3.0）；它由对方挂在
 * `/plugins/dsh-connect-trae/usage?region=<cn|enterprise|ai>` 的路由产出，是它自己卡片读的那份。
 * 三个 tab 的语义不同，因此三种映射：
 *  - `cn`：积分制。`credits.total/consumed/available` 是**积分包的合计上限 / 已用 / 余量**
 *    （绝对值，不是百分比），所以按 `consumed / total` 算已用比例；Work 积分与通用积分两个桶
 *    分别照实报成备注，积分包的到期提醒也照它自己的口径报。
 *  - `ai`：订阅制，没有积分字段；只有 `payStatus`（档位、试用、是否买了套餐）。
 *  - `enterprise`：租户额度**它自己也读不到**（所有租户额度端点 404），照实说「只能在企业控制台看」，
 *    绝不把个人积分挪到企业标题下。
 * `status: "signed-out"` 返回 `null`（该区域没登录，不算故障，也没有数字可报）。
 */
export function normalizeTrae(snapshot, providerId = "trae", now = Date.now(), api) {
	const { failure, windowRow } = api;
	const linkedProviders = api.linkedProviders ?? {};
	const meta = linkedProviders[providerId] ?? linkedProviders.trae;
	if (!snapshot || typeof snapshot !== "object" || Array.isArray(snapshot)) throw failure("subusage/response", "Trae 用量响应不是对象");
	if (Array.isArray(snapshot.accountReadings) && snapshot.accountReadings.length) {
		const accounts = snapshot.accountReadings.map(row => {
			const entry = normalizeTrae({ ...snapshot, accountReadings: undefined, status: "signed-in", accountId: row.id, accountName: row.accountName, credits: row.credits, payStatus: row.payStatus, creditsError: undefined, payStatusError: undefined }, providerId, now, api);
			if (!entry) return null;
			const data = { ...entry, ...accountMetadata(row, snapshot, now), extras: entry.extras.filter(extra => extra.kind !== "account") };
			if (meta.panel !== "enterprise" && (row.error || !row.credits && !row.payStatus)) return { ...data, state: "error", freshness: "unknown", coverage: "partial", windows: [], extras: [], error: "提供方未能读取此账号额度，请检查该账号登录状态" };
			if (meta.panel === "enterprise") return data;
			const checkedAt = Number.isFinite(snapshot.generatedAt) && snapshot.generatedAt > 0 && snapshot.generatedAt <= 8.64e15 ? new Date(snapshot.generatedAt).toISOString() : undefined;
			const fresh = checkedAt && snapshot.generatedAt <= now + 60000 && now - snapshot.generatedAt <= 180000 && !row.refreshFailed;
			return { ...data, freshness: fresh ? "fresh" : "stale", ...(checkedAt && !row.refreshFailed ? { lastSuccessAt: checkedAt } : {}), ...(row.refreshFailed ? { coverage: "partial", error: "提供方刷新失败，保留已有额度" } : {}) };
		}).filter(Boolean);
		if (!accounts.length) return null;
		if (accounts.length === 1) return { ...accounts[0], linkedAccounts: accounts };
		const successful = accounts.filter(account => account.state === "ok");
		return { providerId, label: meta.label, state: successful.length ? "ok" : "error", windows: [], extras: [], coverage: accounts.every(account => account.state === "ok" && account.coverage === "complete") ? "complete" : "partial", freshness: successful.length ? successful.every(account => account.freshness === "fresh") ? "fresh" : "stale" : "unknown", linkedAccounts: accounts, ...(!successful.length ? { error: "提供方未能读取已登录账号的额度" } : {}) };
	}
	if (snapshot.status === "signed-out") return null;
	const base = { providerId, label: meta.label, state: "ok", windows: [], extras: [], coverage: "partial", freshness: "fresh" };
	if (snapshot.status === "error") return { ...base, state: "error", freshness: "unknown", error: typeof snapshot.message === "string" && snapshot.message.trim() ? snapshot.message : "Trae 用量读取失败" };
	if (snapshot.status !== "signed-in") throw failure("subusage/response", `Trae 用量响应的 status 无法识别：${String(snapshot.status)}`);
	const extras = [];
	// 绑定的账号名只在「本机不止一个账号」时才写：单账号时它只是重复标题，多账号时它是
	// 「这份数字属于谁」的唯一线索（对方卡片的账号表就靠它区分）。
	const accounts = Array.isArray(snapshot.accounts) ? snapshot.accounts : [];
	const accountName = typeof snapshot.accountName === "string" ? snapshot.accountName.trim() : "";
	if (accountName && accounts.length > 1) extras.push({ kind: "account", value: `${traeMaskAccount(accountName)}（本机共 ${accounts.length} 个账号）` });
	const windows = [];
	if (meta.panel === "enterprise" && !accounts.some(account => account?.enterprise === true)) return null;
	if (meta.panel === "cn") {
		const credits = snapshot.credits && typeof snapshot.credits === "object" && !Array.isArray(snapshot.credits) ? snapshot.credits : undefined;
		const total = traeNumber(credits?.total), consumed = traeNumber(credits?.consumed), available = traeNumber(credits?.available);
		// 有上限才给百分比；没有上限就只报余量，绝不拿 0 当分母。
		if (total !== undefined && total > 0 && consumed !== undefined) {
			windows.push(windowRow("period", consumed / total * 100, undefined, undefined, {
				used: traeRound(consumed), limit: traeRound(total),
				remaining: traeRound(Math.max(0, available ?? total - consumed)), unit: "credits"
			}));
		}
		if (available !== undefined) extras.push({ kind: "balance", value: `${traeRound(available)} credits` });
		const work = traeNumber(credits?.workAvailable), general = traeNumber(credits?.generalAvailable);
		// 只在真报了值的时候写：缺席就什么都不说，而不是补一个 0（与 traeNumber 的口径一致）。
		const buckets = [];
		if (work !== undefined) buckets.push(`Work 积分 ${traeRound(work)}`);
		if (general !== undefined) buckets.push(`通用积分 ${traeRound(general)}`);
		if (buckets.length) extras.push({ kind: "note", value: buckets.join(" / ") });
		const packageRows = Array.isArray(credits?.accounts) ? credits.accounts.map(pkg => ({
			name: traeText(pkg?.displayDesc, 120) || "积分包", remaining: traeNumber(pkg?.remain), unit: "credits",
			expiresAt: traeNumber(pkg?.expiresAtMs) > 0 ? pkg.expiresAtMs : undefined,
		})) : [];
		const packageSummary = packageRows.length ? summarizeCreditPackages(packageRows, now) : undefined;
		if (packageRows.length) extras.push(...packageSummary.extras);
		else extras.push(...traeExpiryNotes(credits?.expiry));
		if (!credits && traeText(snapshot.creditsError)) extras.push({ kind: "note", value: `积分读取失败：${traeText(snapshot.creditsError)}` });
		// 原生 quotas：窗口 + 总余额 + Work/通用积分分项（componentOf=balance 防重复合计）+ 结构化包。
		const quotas = [];
		if (windows.length) {
			const w = windows[0];
			quotas.push({ type: "window", order: 0, id: "credits", period: "period", percent: w.percent, used: w.detail?.used, limit: w.detail?.limit, amount: { value: w.detail?.used, unit: "credits" } });
		}
		let qOrder = quotas.length;
		if (available !== undefined) quotas.push({ type: "amount", order: qOrder++, id: "available", role: "balance", label: "可用积分", amount: { value: traeRound(available), unit: "credits" } });
		if (work !== undefined) quotas.push({ type: "amount", order: qOrder++, id: "work", role: "balance", componentOf: "available", label: "Work 积分", amount: { value: traeRound(work), unit: "credits" } });
		if (general !== undefined) quotas.push({ type: "amount", order: qOrder++, id: "general", role: "balance", componentOf: "available", label: "通用积分", amount: { value: traeRound(general), unit: "credits" } });
		for (const pkg of packageSummary?.quotaPackages ?? []) quotas.push({ ...pkg, order: qOrder++ });
		return { ...base, windows, extras, quotas, coverage: credits ? "complete" : "partial" };
	}
	if (meta.panel === "ai") {
		const pay = snapshot.payStatus && typeof snapshot.payStatus === "object" && !Array.isArray(snapshot.payStatus) ? snapshot.payStatus : undefined;
		if (pay) {
			const plan = typeof pay.payIdentityStr === "string" ? pay.payIdentityStr.trim() : "";
			if (plan) extras.push({ kind: "plan", value: plan });
			if (pay.inTrial === true && Number.isFinite(pay.trialEndTimeMs) && pay.trialEndTimeMs > 0) extras.push({ kind: "note", value: `试用至 ${new Date(pay.trialEndTimeMs).toISOString()}` });
			else if (pay.inTrial === true) extras.push({ kind: "note", value: "试用中" });
			if (pay.hasPackage === false) extras.push({ kind: "note", value: "未订阅付费套餐" });
		} else if (traeText(snapshot.payStatusError)) extras.push({ kind: "note", value: `订阅状态读取失败：${traeText(snapshot.payStatusError)}` });
		return { ...base, extras, coverage: pay ? "complete" : "partial" };
	}
	// enterprise：有企业账号但额度不可读——把这个事实说清楚，不留一个空的「额度」。
	extras.push({ kind: "note", value: "企业租户额度只能在企业控制台查看，本插件没有可读的接口（不报个人积分）" });
	return { ...base, extras };
}
/** 非负有限数字（对方的金额都是 number）；不合法就返回 undefined，绝不当作 0。 */
function traeNumber(value) {
	return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : undefined;
}
const traeRound = value => Math.round(value * 100) / 100;
/** 上游文本进模型上下文前截断：对方可能回一整段 HTML/堆栈，原样塞进去只会挤掉真正的数据。 */
function traeText(value, limit = 200) {
	if (typeof value !== "string") return "";
	const text = value.trim();
	return text.length > limit ? `${text.slice(0, limit)}…` : text;
}
/** 账号名掩码：实测是邮箱形态，模型不需要完整地址，能分辨是哪一份即可。 */
function traeMaskAccount(name) {
	const text = name.trim(), at = text.indexOf("@");
	if (at > 0) return `${text.slice(0, 1)}***@${text.slice(at + 1)}`;
	return text.length > 2 ? `${text.slice(0, 1)}***` : text;
}
/** 旧聚合响应没有逐包日期：只保留仍需关注的 24 小时 / 3 天窗口，已过期与 7 天档不展示。 */
function traeExpiryNotes(expiry) {
	if (!expiry || typeof expiry !== "object" || Array.isArray(expiry)) return [];
	const tiers = [["within24h", "24 小时内到期"], ["within3d", "3 天内到期"]];
	const notes = [];
	for (const [key, label] of tiers) {
		const bucket = expiry[key];
		const total = traeNumber(bucket?.total);
		if (total === undefined || total <= 0) continue;
		const earliest = Number.isFinite(bucket?.earliestExpiresAtMs) && bucket.earliestExpiresAtMs > 0 ? `（最早 ${new Date(bucket.earliestExpiresAtMs).toISOString()}）` : "";
		notes.push({ kind: "note", value: `${label}：${traeRound(total)} credits${earliest}` });
	}
	return notes;
}
/**
 * LiteLLM 的管理端点在 **proxy 根**（不是 /v1）：去掉尾部斜杠与常见的 /v1 后缀，
 * 否则会拼成 /v1/key/info 而 404。只接受 http(s)，其它协议一律视为未配置。
 */
export function normalizeLitellm(keyBody, budgetBody, api) {
	const { failure, windowRow } = api;
	const num = value => typeof value === "number" && Number.isFinite(value) ? value : undefined;
	const pick = value => value && typeof value === "object" && !Array.isArray(value) ? value : undefined;
	// 真实响应是 `{ key, info: {...} }`；也接受直接把字段放在顶层。
	const keyInfo = pick(keyBody?.info) ?? pick(keyBody);
	if (!keyInfo) throw failure("subusage/response", "Invalid LiteLLM key info response");
	const scopes = [["key", keyInfo]];
	for (const body of Array.isArray(budgetBody) ? budgetBody : [budgetBody]) {
		if (pick(body?.team_info)) scopes.push(["team", body.team_info]);
		else if (pick(body?.user_info)) scopes.push(["user", body.user_info]);
		else if (pick(body)) scopes.push(["scope", body]);
	}
	const windows = [], extras = [];
	const round = value => Math.round(value * 100) / 100;
	for (const [scope, row] of scopes) {
		const spend = num(row.spend), maxBudget = num(row.max_budget);
		if (spend === undefined || spend < 0) continue;
		if (maxBudget !== undefined && maxBudget > 0) {
			const resetAt = typeof row.budget_reset_at === "string" ? row.budget_reset_at : undefined;
			windows.push({ ...windowRow("period", spend / maxBudget * 100, resetAt, undefined, { used: round(spend), limit: round(maxBudget), unit: "USD" }), ...(scopes.length > 1 ? { budgetScope: scope } : {}) });
		} else extras.push({ kind: scope === "key" ? "spend" : `${scope}-spend`, value: `${round(spend)} USD` });
	}
	if (!windows.length && !extras.length) throw failure("subusage/response", "LiteLLM 响应没有可用的预算或花费");
	// 各预算同时约束，不用更宽松的上级覆盖 Key。
	return { windows, extras, coverage: "complete" };
}
