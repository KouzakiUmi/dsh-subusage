// lib/providers/balances.js —— 余额/限额型 provider 归一化（余额直接显示，不硬凑窗口）。
//
// 模块只经参数 `api`（createWindowApi 产物）与宿主通信，不直引核心包。
// Host 侧在 lib/index.js 里保留同名薄包装器（默认传 windowApi）。

export function normalizeSiliconFlow(body, api) {
	const { failure } = api;
 const data = body?.data;
 if (!data || typeof data !== "object" || Array.isArray(data)) throw failure("subusage/response", "Invalid SiliconFlow user info response");
 const amount = value => typeof value === "number" && Number.isFinite(value) && value >= 0 ? Math.round(value * 100) / 100 : undefined;
 const total = amount(data.totalBalance) ?? amount(data.balance);
 if (total === undefined) throw failure("subusage/response", "SiliconFlow 响应没有可用余额");
 // 响应不带货币字段；该平台以人民币计价，所以按 CNY 显示，不猜测成其它货币。
 return { windows: [], extras: [{ kind: "balance", value: `${total} CNY` }], coverage: "complete" };
}
// DeepSeek 官方余额（余额型）：GET https://api.deepseek.com/user/balance，Bearer 与推理同一把 Key。
// 响应 { is_available, balance_infos: [{ currency, total_balance, granted_balance, topped_up_balance }] }，
// 金额是**字符串十进制**。余额没有上限也就没有百分比：不产出窗口，只产出 extras。
// DSH 账号服务已完成鉴权与余额响应投影；本插件不读取账号 grant/token。
export function normalizeDeepseekAccountBalance(body, api) {
	const { failure } = api;
 const decimal = /^-?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/i;
 if (body?.status !== "ready" || !Array.isArray(body.value)) throw failure("subusage/response", "本机 DeepSeek 账号余额读取失败，请检查 DSH 的账号与余额页面", true);
 const wallets = body.value.filter(row => ["CNY", "USD"].includes(row?.currency) && typeof row.balance === "string" && decimal.test(row.balance));
 if (!wallets.length || wallets.length !== body.value.length) throw failure("subusage/response", "本机 DeepSeek 账号没有有效的充值余额信息");
 const row = wallets.find(row => row.currency === "CNY") ?? wallets[0];
 return { windows: [], extras: [{ kind: "balance", value: `${row.balance} ${row.currency}` }], coverage: "complete" };
}
export function normalizeDeepseekBalance(body, api) {
	const { failure } = api;
	if (typeof body?.is_available !== "boolean") throw failure("subusage/response", "Invalid DeepSeek balance response");
	const infos = Array.isArray(body.balance_infos) ? body.balance_infos : [];
	const row = infos.find(item => item && typeof item.currency === "string" && typeof item.total_balance === "string" && /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)$/.test(item.total_balance));
	if (!row) throw failure("subusage/response", "DeepSeek 响应没有可用的余额信息");
	const currency = /^[A-Z]{3}$/.test(row.currency) ? row.currency : "";
	const extras = [{ kind: "balance", value: `${row.total_balance} ${currency}`.trim() }];
	// 余额不可用是行动项（去充值），不是 0 元余额的展示问题。
	if (body.is_available === false) extras.push({ kind: "plan", value: "余额不足，请充值" });
	return { windows: [], extras, coverage: "complete" };
}
// OpenRouter：/key 给 key 级限额与日/周/月用量（任意 key 可读），/credits 给账户余额
// （只对 management / provisioning key 开放）。余额拿不到时**静默降级**为只显示限额，
// 不因为余额端点 403 就把整个条目判失败。
// https://openrouter.ai/docs/api/api-reference/api-keys/get-current-key
export function normalizeOpenRouter(keyBody, creditBody, api) {
	const { failure, windowRow, cascadeRateLimited } = api;
	const data = keyBody?.data;
	if (!data || typeof data !== "object" || Array.isArray(data)) throw failure("subusage/response", "Invalid OpenRouter key response");
	const num = value => typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : undefined;
	const windows = [];
	const limit = num(data.limit), remaining = num(data.limit_remaining);
	if (limit !== undefined && limit > 0 && remaining !== undefined) {
		const kind = data.limit_reset === "monthly" ? "month" : data.limit_reset === "weekly" ? "week" : data.limit_reset === "daily" ? "day" : "period";
		windows.push(windowRow(kind, Math.max(0, limit - remaining) / limit * 100, undefined, undefined, { used: Math.round(Math.max(0, limit - remaining) * 100) / 100, limit, unit: "credits" }));
	}
	// 免费档没有 key 限额，但有免费模型的每日请求上限：它同样是一个真实窗口。
	const free = data.free_model_daily_requests;
	const freeLimit = num(free?.limit), freeUsed = num(free?.used);
	if (freeLimit !== undefined && freeLimit > 0 && freeUsed !== undefined) {
		windows.push(windowRow("day", Math.min(100, freeUsed / freeLimit * 100), undefined, undefined, { used: freeUsed, limit: freeLimit, unit: "requests" }));
	}
	const extras = [];
	const credits = creditBody?.data;
	const total = num(credits?.total_credits), spent = num(credits?.total_usage);
	if (total !== undefined && spent !== undefined) extras.push({ kind: "balance", value: `${Math.round(Math.max(0, total - spent) * 100) / 100} USD` });
	if (data.is_free_tier === true) extras.push({ kind: "plan", value: "Free tier" });
	if (!windows.length && num(data.usage) !== undefined) extras.push({ kind: "spend", value: `${Math.round(data.usage * 100) / 100} USD` });
	if (!windows.length && !extras.length) throw failure("subusage/response", "OpenRouter 响应没有可用的限额、余额或用量");
	return { windows: cascadeRateLimited(windows), extras, coverage: windows.length || extras.some(e => e.kind !== "plan") ? "complete" : "partial" };
}
// ── 余额型聚合商（各家单位与形状都不同，逐个显式换算，不做通用折算）────────────────
/** Novita：金额单位是 1/10000 USD（10000 = $1.00）。 */
export function normalizeNovitaBalance(body, api) {
	const { failure } = api;
	// 官方金额为十进制字符串；不接受空串、指数或十六进制等非金额写法。
	const raw = body?.availableBalance;
	const available = typeof raw === "number" && Number.isFinite(raw) ? raw
		: typeof raw === "string" && /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)$/.test(raw.trim()) && Number.isFinite(Number(raw)) ? Number(raw) : undefined;
	if (available === undefined) throw failure("subusage/response", "Invalid Novita balance response");
	return { windows: [], extras: [{ kind: "balance", value: `${Math.round(available / 100) / 100} USD` }], coverage: "complete" };
}
/** Hyperbolic：balanceCents 是美分。 */
export function normalizeHyperbolicBalance(body, api) {
	const { failure } = api;
	const cents = typeof body?.balanceCents === "number" && Number.isFinite(body.balanceCents) ? body.balanceCents : undefined;
	if (cents === undefined) throw failure("subusage/response", "Invalid Hyperbolic balance response");
	return { windows: [], extras: [{ kind: "balance", value: `${Math.round(cents) / 100} USD` }], coverage: "complete" };
}
/**
 * DeepInfra：预付资金以**负的** stripe_balance 表示，可用金额要取负；正值代表欠款。
 * 欠款是行动项，单独提示而不是显示成负余额。
 */
export function normalizeDeepinfraBalance(body, api) {
	const { failure } = api;
	const raw = typeof body?.stripe_balance === "number" && Number.isFinite(body.stripe_balance) ? body.stripe_balance : undefined;
	if (raw === undefined) throw failure("subusage/response", "Invalid DeepInfra balance response");
	const available = Math.round(-raw * 100) / 100;
	const extras = [{ kind: "balance", value: `${Math.max(0, available)} USD` }];
	if (available < 0) extras.push({ kind: "plan", value: `欠款 ${Math.abs(available)} USD` });
	return { windows: [], extras, coverage: "complete" };
}
/** Chutes：{quota, used} 直接给绝对量；重置时刻接口不给，故不显示（不编造次日 00:00 UTC）。 */
export function normalizeChutesQuota(body, api) {
	const { failure, windowRow } = api;
	const num = value => typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : undefined;
	const quota = num(body?.quota), used = num(body?.used);
	if (quota === undefined || used === undefined) throw failure("subusage/response", "Invalid Chutes quota response");
	if (quota <= 0) throw failure("subusage/response", "Chutes 配额为 0，无法计算比例");
	return { windows: [windowRow("period", Math.min(100, used / quota * 100), undefined, undefined, { used, limit: quota, unit: "quota" })], extras: [], coverage: "complete" };
}
/** Ollama Cloud：limits.{session,weekly,monthly}.usage 是 **0–1 小数**；任一层缺失就跳过该窗口。 */
export function normalizeOllamaCloudUsage(body, api) {
	const { failure, windowRow, cascadeRateLimited } = api;
	const limits = body?.limits && typeof body.limits === "object" && !Array.isArray(body.limits) ? body.limits : {};
	const windows = [];
	for (const [field, kind] of [["session", "period"], ["weekly", "week"], ["monthly", "month"]]) {
		const usage = limits[field]?.usage;
		if (usage === undefined || usage === null) continue;
		if (typeof usage !== "number" || !Number.isFinite(usage) || usage < 0) throw failure("subusage/response", "Invalid Ollama Cloud usage");
		windows.push(windowRow(kind, Math.min(100, usage * 100)));
	}
	if (!windows.length) throw failure("subusage/response", "Ollama Cloud 响应没有可用的额度窗口");
	return { windows: cascadeRateLimited(windows), extras: [], coverage: "complete" };
}
/** Vercel AI Gateway：balance / total_used 是十进制字符串；没有限额也没有重置，只显示金额。 */
export function normalizeVercelCredits(body, api) {
	const { failure } = api;
	const decimal = value => typeof value === "string" && /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)$/.test(value.trim()) ? value.trim() : typeof value === "number" && Number.isFinite(value) ? String(value) : undefined;
	const balance = decimal(body?.balance) ?? decimal(body?.data?.balance);
	if (balance === undefined) throw failure("subusage/response", "Invalid Vercel AI Gateway credits response");
	return { windows: [], extras: [{ kind: "balance", value: `${balance} USD` }], coverage: "complete" };
}
// ZenMux：订阅配额走 subscription/detail（`quota_5_hour.usage_percentage` 是 **0–1 小数**），
// PAYG 余额走 payg/balance。两个端点都**只认 Management API Key**（推理 key 不适用），
// 因此继承变量单独命名，避免用户把推理 key 填进来。
// https://docs.zenmux.ai/api/platform/subscription-detail
export function normalizeZenmux(subscriptionBody, balanceBody, api) {
	const { failure, windowRow, cascadeRateLimited } = api;
	const num = value => typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : undefined;
	const windows = [], extras = [];
	const data = subscriptionBody?.data && typeof subscriptionBody.data === "object" && !Array.isArray(subscriptionBody.data) ? subscriptionBody.data : {};
	for (const [field, kind] of [["quota_5_hour", "5h"], ["quota_7_day", "week"]]) {
		const quota = data[field];
		if (quota === undefined || quota === null) continue;
		if (typeof quota !== "object" || Array.isArray(quota) || num(quota.usage_percentage) === undefined) throw failure("subusage/response", "Invalid ZenMux quota window");
		const detail = num(quota.used_flows) !== undefined && num(quota.max_flows) !== undefined ? { used: quota.used_flows, limit: quota.max_flows, unit: "flows" } : undefined;
		windows.push(windowRow(kind, quota.usage_percentage * 100, typeof quota.resets_at === "string" ? quota.resets_at : undefined, undefined, detail));
	}
	// quota_monthly 只有上限，未报告实时用量；不从短窗拼造月百分比。
	const tier = data.plan && typeof data.plan.tier === "string" ? data.plan.tier.trim() : "";
	if (tier) extras.push({ kind: "plan", value: tier });
	const balance = balanceBody?.data && typeof balanceBody.data === "object" && !Array.isArray(balanceBody.data) ? balanceBody.data : {};
	const total = num(balance.total_credits);
	if (total !== undefined) {
		const currency = typeof balance.currency === "string" && /^[A-Za-z]{3}$/.test(balance.currency) ? balance.currency.toUpperCase() : "";
		extras.push({ kind: "balance", value: `${Math.round(total * 100) / 100} ${currency}`.trim() });
	}
	if (!windows.length && !extras.length) throw failure("subusage/response", "ZenMux 响应没有可用的配额或余额");
	return { windows: cascadeRateLimited(windows), extras, coverage: windows.length || total !== undefined ? "complete" : "partial", ...(["suspended", "banned"].includes(data.account_status) ? { availability: "blocked", availabilityReason: "account-restricted" } : {}) };
}
/**
 * 把接口下发的窗口秒数映射到既有窗口档位。官方对 Design Plan 只承诺 5 小时 / 7 天两种窗口，
 * 且随套餐而变（Go 两个都有，Plus / Pro / Max 只有 7 天窗），所以按**实际时长**判断，
 * 不从套餐名反推窗口集合。
 */
// ── 中转聚合商（契约 2026-10-30 用真实 Key 实测）──────────────────────────
/**
 * APIGOTO：`GET /v1/usage`（推理 Key 的 Bearer）返回
 *   { is_active, isValid, mode, remaining, unit, subscription: {
 *       plan_name, policy_name, expires_at, used, limit, window_sec, unit } ,
 *     points, balance, balance_usd }
 * 窗口长度由 `window_sec` 决定——官方不保证固定周期，按秒数换算成既有档位，
 * 不从套餐名反推。百分比由 used/limit 算出（接口本身不给百分比）。
 * `subscription.expires_at` 是**套餐到期时间**，不是窗口重置时间：当成 resetsAt 写进去，
 * 会让「本周额度重置」显示成一个月后的日期，所以只作为套餐信息文字带出，不产 resetsAt。
 * `remaining` 是套餐内**剩余额度**（unit 给出的货币），`balance_usd` 是另开一个充值钱包：
 * 两者不是一回事。钱包为 0 时绝不能当成「余额耗尽」告警盖掉套餐里还剩下的钱。
 *
 * 显示取舍：`plan` 徽标只放套餐名（标题行一行内放得下）；到期日与剩余天数另起说明行，
 * 因为「还有 29 天」这类结论放进徽标会被挤成一串。`policy_name` 实测只比套餐名多一个厂商
 * 前缀，与套餐名相同时不重复占行。`mode` 只在能翻译成中文时显示；`points` 为 0 时不占行。
 * `now` 可注入，只为让「还有几天」的断言不依赖运行时刻。
 */
export function normalizeApigoto(body, now = Date.now(), api) {
	const { failure, windowRow, windowKindFromSeconds, windowExtrasResult } = api;
	if (!body || typeof body !== "object" || Array.isArray(body)) throw failure("subusage/response", "Invalid APIGOTO usage response");
	const num = value => typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : undefined;
	const decimal = value => typeof value === "string" && /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)$/.test(value.trim()) ? Number(value) : num(value);
	const round = value => Math.round(value * 100) / 100;
	const windows = [];
	const extras = [];
	const sub = body.subscription && typeof body.subscription === "object" && !Array.isArray(body.subscription) ? body.subscription : undefined;
	if (sub) {
		const used = num(sub.used), limit = num(sub.limit);
		if (used !== undefined && limit !== undefined && limit > 0) {
			const seconds = num(sub.window_sec);
			const kind = seconds === undefined || seconds <= 0 ? "period" : windowKindFromSeconds(seconds);
			// 窗口单位随套餐而定（实测是 rpm_credits），如实带出去而不是硬写成 requests。
			const unit = typeof sub.unit === "string" && sub.unit.trim() ? sub.unit.trim() : undefined;
			windows.push(windowRow(kind, Math.min(100, used / limit * 100), undefined, undefined, { used: Math.round(used), limit: Math.round(limit), ...(unit ? { unit } : {}) }));
		}
		const plan = typeof sub.plan_name === "string" && sub.plan_name.trim() ? sub.plan_name.trim() : "";
		if (plan) extras.push({ kind: "plan", value: plan });
		// 到期日：这是套餐到期，不是窗口重置。带上剩余天数才看得出「快到期了没有」。
		if (typeof sub.expires_at === "string" && Number.isFinite(Date.parse(sub.expires_at))) {
			const at = Date.parse(sub.expires_at);
			const date = new Date(at).toISOString().slice(0, 10);
			const days = Math.ceil((at - now) / 86400000);
			extras.push({ kind: "note", value: days > 0 ? `套餐到期 ${date}（还有 ${days} 天）` : `套餐已于 ${date} 到期` });
		}
		// 策略名与套餐名实测只差厂商前缀；重复一遍等于同一句话说两次。
		const policy = typeof sub.policy_name === "string" && sub.policy_name.trim() ? sub.policy_name.trim() : "";
		if (policy && policy !== plan) extras.push({ kind: "note", value: `策略 ${policy}` });
	}
	// 计费模式：只认得出订阅制与按量计费两种，其它原样带出，不猜。
	const mode = typeof body.mode === "string" && body.mode.trim() ? body.mode.trim() : "";
	if (mode) {
		// 用 Map 而非对象字面量：`obj[mode]` 会命中 `__proto__` / `constructor` 这类原型属性，
		// 把上游的奇怪取值渲染成 `[object Object]`。
		const MODE_LABEL = new Map([["subscription", "订阅制"], ["paygo", "按量计费"], ["pay-as-you-go", "按量计费"]]);
		extras.push({ kind: "note", value: `计费模式：${MODE_LABEL.get(mode.toLowerCase()) ?? mode}` });
	}
	// 积分：0 是没有信息量的默认值，不占行。
	const points = num(body.points);
	if (points !== undefined && points > 0) extras.push({ kind: "note", value: `积分 ${round(points)}` });
	// 主余额取套餐内的 remaining（单位随 unit，实测 USD）；它缺了才回落到充值钱包 balance_usd。
	const remaining = decimal(body.remaining);
	const wallet = decimal(body.balance_usd);
	const currency = typeof body.unit === "string" && /^[A-Z]{3}$/.test(body.unit.trim()) ? body.unit.trim() : "USD";
	if (remaining !== undefined) {
		extras.push({ kind: "balance", value: `${round(remaining)} ${currency}` });
		// 充值钱包另有余额时才提一句，0 元钱包不是告警，不占一行。
		if (wallet !== undefined && wallet > 0) extras.push({ kind: "note", value: `充值钱包另有 ${round(wallet)} USD` });
	} else if (wallet !== undefined) extras.push({ kind: "balance", value: `${round(wallet)} USD` });
	// is_active=false / isValid=false 是明确的上游状态（套餐失效或 Key 被停用），不是解析问题。
	if (body.is_active === false || body.isValid === false) extras.push({ kind: "note", value: "套餐无效或已停用" });
	// 原生 quotas：订阅窗口 + 套餐名徽标 + plan-remaining 总额 + wallet 充值池（不进总额）。
	const quotas = [];
	let qOrder = 0;
	for (const w of windows) quotas.push({ type: "window", order: qOrder++, id: "subscription", period: w.kind, percent: w.percent, used: w.detail?.used, limit: w.detail?.limit, amount: { value: w.detail?.used, unit: w.detail?.unit } });
	if (sub && typeof sub.plan_name === "string" && sub.plan_name.trim()) quotas.push({ type: "plan", order: qOrder++, id: "plan", value: sub.plan_name.trim() });
	if (remaining !== undefined) quotas.push({ type: "amount", order: qOrder++, id: "remaining", role: "plan", label: "套餐剩余", amount: { value: round(remaining), unit: currency } });
	if (wallet !== undefined && wallet > 0) quotas.push({ type: "amount", order: qOrder++, id: "wallet", role: "wallet", label: "充值钱包", amount: { value: round(wallet), unit: "USD" } });
	if (body.is_active === false || body.isValid === false) quotas.push({ type: "status", order: qOrder++, id: "invalid", value: "套餐无效或已停用" });
	// 「有数据」只算窗口、余额或上游明确的停用状态。套餐名 / 到期 / 策略 / 模式 / 积分都是元数据，
	// 只有它们说明这次响应里没有额度可读——不能让一条「计费模式：订阅制」把失败装成成功。
	const hasQuota = windows.length > 0 || extras.some(item => item.kind === "balance" || item.kind === "spend");
	const hasStatus = extras.some(item => item.kind === "note" && item.value === "套餐无效或已停用");
	if (!hasQuota && !hasStatus) throw failure("subusage/response", "APIGOTO 响应没有可用的额度或余额");
	return windowExtrasResult({ windows, extras, quotas, coverage: windows.length && extras.some(e => e.kind === "balance") ? "complete" : "partial" });
}
/**
 * OpenDesign（open-design.ai / Powerformer）Coding Plan 订阅额度。
 * 契约是 2026-10-18 用真实账号实测出来的（`GET /api/v1/workspaces/<id>/billing/coding-plan-usage`）：
 * 结构是**扁平的**，没有嵌套的 codingPlan，也没有钱包余额字段。
 *   { workspaceId, generatedAt, eligible: boolean, tier: "go"|"plus"|"pro"|"max"|null,
 *     windows: [{ policyId, durationSeconds, resetMode, usedCredits,
 *                 limitCredits, remainingCredits, windowStart, resetsAt }] }
 * 三个额度字段都是**字符串**（额度最小单位的整数），接口本身不下发百分比：百分比只能由
 * usedCredits / limitCredits 自己算。
 * 官方语义（https://open-design.ai/model-credits/）：7 天与 5 小时窗只约束 Design Plan
 * 额度；plan model credits 不受这两个窗约束、按账期发放与重置，两者共用同一份消费记录。
 *
 * 第二个参数 `summary` 是 `GET /api/v1/billing/summary`（账号级，2026-10-20 实测）的原始响应，
 * 可省略：它带来**另一个池**——套餐模型额度（订阅额度）与钱包余额（订阅 + 充值），
 * 不在上面那个接口里。该接口字段（均为字符串）：
 *   { balanceUsd, creditsPerUsd: 10000, balances: { subscriptionCredits, rechargeCredits,
 *     totalAvailableCredits }, membershipTier, subscriptionCurrentPeriodStart / End, ... }
 */
