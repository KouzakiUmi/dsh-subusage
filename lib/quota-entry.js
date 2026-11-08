/**
 * QuotaEntry —— 所有 provider / 联动 / 聚合器的**统一 wire 契约**，单一事实源。
 *
 * 设计目标：provider 侧只喂数据——每个额度元素自己声明 `order`（排序）、`label`（名字）、
 * `amount.unit`（单位）；状态推断、覆盖率、阈值告警、布局、i18n、弹层密度全部由
 * schema 管线统一负责。不再存在「每家一个协议」。
 *
 * 组合模型（可自由组合）：
 *   QuotaEntry
 *   ├─ quotas[]        顶层额度元素（无账号归属的订阅额度）
 *   └─ linkedAccounts[] 每个账号/卡一行
 *        └─ quotas[]    该行自己的额度元素
 *        元素可选 pool / poolLabel / poolScope —— 额度桶身份与共享语义
 *        （Antigravity 分池、AFP 分组、Magpie 渠道组），
 *        组合维度 = 「账户 × 池 × 元素」。
 *
 * 元素类型（type 判别联合）：
 *   window  周期窗口：percent（已用 %）+ period（5h/day/week/month/period/rolling/sub/7d）；
 *           amount/used/limit 带结构数字；status rate-limited/cascade 标耗尽与连带限制；
 *           poolScope:"independent" 声明该池是独立预算（部分池用尽 ≠ 全部受限），
 *           缺省 shared（同池内取最紧）。groupLabel 自动转换只标 pool，不标 independent。
 *   amount  数值额度：role 区分语义——balance 余额/积分、bonus 附赠、wallet 充值钱包、
 *           plan 套餐内剩余、monthly 月度余额、spend 花费；unit 原文 + unitId 聚合键
 *           （已知别名归一：credit(s)/积分→credit、token(s)→token、usd/$→usd、cny/¥/元→cny、
 *           request(s)→request，未知单位不猜，保留小写原文），unitKind 分类
 *           （cash/credit/token/quota）只按白名单认，货币识别归客户端告警阈值。
 *   package 额度包：role 周期/临时/永久；remaining/amount 带 unitId；expiresAt。
 *           **包是总额的分项，不再参与合计**——合计只加 role=balance 的 amount 元素。
 *   plan    套餐名徽标。   status 状态行（unlimited / restricted / …原文）。
 *   note    说明行（fallback 桶：role + text 保原文）。
 *
 * 通用字段：`id`（元素稳定身份，跨刷新识别同一额度）、`order`、`label`、`pool`/`poolLabel`。
 *
 * 兼容面：`windows`/`extras` 是渲染管线现行消费形状，wire 上与 `quotas` 并存；
 * `canonicalizeEntry()` 在出边界统一做——① ofmAccounts→linkedAccounts 别名折叠、
 * ② quotas 在场即权威派生 windows/extras、③ quotas 整体缺席才从 windows/extras 转换。
 * 归一化器逐步迁移到只产 quotas；全部迁完后 windows/extras 可退役（见 docs/quota-entry.md）。
 *
 * 聚合语义（明文约定，不靠 label/order 推断）：
 *   - 账户可用总额 = 该账户（行或顶层）role=balance 的 amount 元素按 unitId 分组合计；
 *   - package、bonus、wallet、plan、monthly 都是独立语义，不进总额；
 *   - 多单位不合并：unitId 不同就分别列出；unitKind 只是分类，不能跨 unitId 加和；
 *   - pool 只给池身份（稳定键），poolScope:"independent" 才是「独立预算」语义；
 *   - 诊断：`diagnostics[]` 列出收编时丢弃/降级的元素字段（生产降级、测试严格）。
 */

export const ENTRY_STATES = ["ok", "error", "disabled", "no-key", "no-cookie"];
export const COVERAGE = ["complete", "partial"];
export const FRESHNESS = ["fresh", "stale", "unknown"];
export const AVAILABILITY = ["included", "paygo", "blocked", "unknown"];

export const PERIODS = ["5h", "day", "week", "month", "period", "rolling", "sub", "7d"];
export const UNIT_KINDS = ["cash", "credit", "token", "quota"];
export const AMOUNT_ROLES = ["balance", "bonus", "wallet", "plan", "monthly", "spend"];
export const PACKAGE_ROLES = ["recurring", "temporary", "permanent"];
export const NOTE_ROLES = ["account", "plan", "note", "unknown"];
export const QUOTA_TYPES = ["window", "amount", "package", "plan", "status", "note"];
export const POOL_SCOPES = ["shared", "independent"];
export const SUBJECT_KINDS = ["key", "user", "group", "seat", "account"];
export const AGGREGATION_MODES = ["allow", "forbid"];

/** 已知单位别名 → 聚合键（unitId）。未知单位不猜：unitId = 小写原文。 */
const UNIT_ALIASES = new Map(Object.entries({
	credit: "credit", credits: "credit", "积分": "credit", point: "credit", points: "credit",
	token: "token", tokens: "token",
	usd: "usd", "$": "usd", dollar: "usd", dollars: "usd",
	cny: "cny", "¥": "cny", "￥": "cny", rmb: "cny", "元": "cny",
	request: "request", requests: "request", "请求": "request", "次": "request"
}));
export function unitIdOf(unit) {
	const raw = String(unit ?? "").trim();
	if (!raw) return "";
	return UNIT_ALIASES.get(raw.toLowerCase()) ?? raw.toLowerCase();
}

const text = value => typeof value === "string" && value.trim() ? value.trim() : "";
const finite = value => Number.isFinite(value) ? value : undefined;
const issue = (issues, where, reason) => { if (Array.isArray(issues)) issues.push({ where, reason }); };

/** 契约已声明字段全集：验证失败也不回透传（坏形状不得复活）。 */
const RESERVED_KEYS = new Set([
	"type", "id", "label", "order", "pool", "poolLabel", "poolScope", "subject", "aggregation",
	"period", "percent", "amount", "used", "limit", "resetsAt", "status", "cascade", "blockedBy", "scope", "budgetScope",
	"role", "value", "text", "remaining", "expiresAt", "unit", "unitId", "unitKind",
	"planName", "note", "limitSource", "currentPeriodEnd", "holdsWhy", "componentOf", "left", "leftText"
]);

/** subject：作用域身份（key/user/group/seat/account + 可选 id）。 */
export function subjectOf(raw, issues, where) {
	if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
		if (raw !== undefined) issue(issues, where, "subject 不是对象，丢弃");
		return undefined;
	}
	const kind = SUBJECT_KINDS.includes(raw.kind) ? raw.kind : "";
	if (!kind) {
		issue(issues, where, `未知 subject.kind「${raw.kind}」，丢弃`);
		return undefined;
	}
	const subject = { kind };
	const id = text(raw.id); if (id) subject.id = id;
	return subject;
}

/** aggregation：聚合能力声明（balance: allow/forbid + 可选 reason）。 */
export function aggregationOf(raw, issues, where) {
	if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
		if (raw !== undefined) issue(issues, where, "aggregation 不是对象，丢弃");
		return undefined;
	}
	const aggregation = {};
	if (raw.balance !== undefined) {
		if (AGGREGATION_MODES.includes(raw.balance)) aggregation.balance = raw.balance;
		else issue(issues, where, `未知 aggregation.balance「${raw.balance}」，丢弃`);
	}
	const reason = text(raw.reason); if (reason) aggregation.reason = reason;
	return Object.keys(aggregation).length ? aggregation : undefined;
}

/** amount：结构数字 + 原文单位 + unitId 聚合键；unitKind 按白名单归位，认不出留空（不猜）。 */
function amountOf(raw, issues, where) {
	if (!raw || typeof raw !== "object") {
		if (raw !== undefined) issue(issues, where, "amount 不是对象，丢弃");
		return undefined;
	}
	const amount = {};
	if (finite(raw.value) !== undefined) amount.value = raw.value;
	else if (raw.value !== undefined) issue(issues, where, `amount.value 非有限数字（${typeof raw.value}），丢弃`);
	const unit = text(raw.unit); if (unit) amount.unit = unit;
	if (unit) amount.unitId = unitIdOf(unit);
	const kind = UNIT_KINDS.includes(raw.unitKind) ? raw.unitKind : "";
	if (raw.unitKind !== undefined && !kind) issue(issues, where, `未知 unitKind「${raw.unitKind}」，丢弃`);
	if (kind) amount.unitKind = kind;
	return Object.keys(amount).length ? amount : undefined;
}

/** 单个额度元素规范化：未知字段保留（向前兼容），枚举字段只按白名单收。 */
export function quotaElement(raw, order, issues) {
	const where = `quotas[${order}]`;
	if (!raw || typeof raw !== "object" || Array.isArray(raw)) { issue(issues, where, "元素不是对象，丢弃"); return undefined; }
	if (!QUOTA_TYPES.includes(raw.type)) { issue(issues, where, `未知 type「${raw.type}」，丢弃`); return undefined; }
	const element = { type: raw.type };
	const id = text(raw.id); if (id) element.id = id;
	const label = text(raw.label); if (label) element.label = label;
	element.order = Number.isFinite(raw.order) ? raw.order : order;
	const pool = text(raw.pool); if (pool) element.pool = pool;
	const poolLabel = text(raw.poolLabel); if (poolLabel) element.poolLabel = poolLabel;
	const subject = subjectOf(raw.subject, issues, `${where}.subject`); if (subject) element.subject = subject;
	const aggregation = aggregationOf(raw.aggregation, issues, `${where}.aggregation`); if (aggregation) element.aggregation = aggregation;

	if (raw.type === "window") {
		const period = PERIODS.includes(raw.period) ? raw.period : "period";
		if (raw.period !== undefined && !PERIODS.includes(raw.period)) issue(issues, where, `未知 period「${raw.period}」归 period`);
		element.period = period;
		if (raw.poolScope === "independent") element.poolScope = "independent";
		else if (raw.poolScope !== undefined) issue(issues, where, `未知 poolScope「${raw.poolScope}」，丢弃`);
		if (finite(raw.percent) !== undefined) element.percent = raw.percent;
		else if (raw.percent !== undefined) issue(issues, where, "percent 非有限数字，丢弃");
		const amount = amountOf(raw.amount, issues, `${where}.amount`); if (amount) element.amount = amount;
		if (finite(raw.used) !== undefined) element.used = raw.used;
		if (finite(raw.limit) !== undefined) element.limit = raw.limit;
		if (finite(raw.left) !== undefined) element.left = raw.left;
		const leftText = text(raw.leftText); if (leftText) element.leftText = leftText;
		const resetsAt = text(raw.resetsAt); if (resetsAt) element.resetsAt = resetsAt;
		if (raw.status === "rate-limited") element.status = "rate-limited";
		else if (raw.status !== undefined) issue(issues, where, `未知 status「${raw.status}」，丢弃`);
		if (raw.cascade === true) element.cascade = true;
		else if (raw.cascade !== undefined) issue(issues, where, "cascade 非布尔 true，丢弃");
		if (Array.isArray(raw.blockedBy) && raw.blockedBy.length) element.blockedBy = raw.blockedBy.map(text).filter(Boolean);
		else if (raw.blockedBy !== undefined) issue(issues, where, "blockedBy 非数组，丢弃");
		const scope = text(raw.scope); if (scope) element.scope = scope;
		const budgetScope = text(raw.budgetScope); if (budgetScope) element.budgetScope = budgetScope;
		const note = text(raw.note); if (note) element.note = note;
		const planName = text(raw.planName); if (planName) element.planName = planName;
		const limitSource = text(raw.limitSource); if (limitSource) element.limitSource = limitSource;
		const currentPeriodEnd = text(raw.currentPeriodEnd); if (currentPeriodEnd) element.currentPeriodEnd = currentPeriodEnd;
	} else if (raw.type === "amount") {
		// 未知 role 不归 balance：拼错的「grant」当余额会产生错误的告警与合计。
		// 保留原文交给消费者；缺省时才是 balance。
		const role = AMOUNT_ROLES.includes(raw.role) ? raw.role : text(raw.role);
		if (raw.role !== undefined && !AMOUNT_ROLES.includes(raw.role)) issue(issues, where, `未知 amount role「${raw.role}」，保原文`);
		element.role = role || "balance";
		const amount = amountOf(raw.amount, issues, `${where}.amount`); if (amount) element.amount = amount;
		const value = text(raw.value); if (value) element.text = value; // 预格式文本兜底
		// componentOf = 总额的分项（如 Trae Work/通用积分 ⊆ available）：合计时跳过，防重复计数。
		const componentOf = text(raw.componentOf); if (componentOf) element.componentOf = componentOf;
	} else if (raw.type === "package") {
		const role = PACKAGE_ROLES.includes(raw.role) ? raw.role : text(raw.role);
		if (raw.role !== undefined && !PACKAGE_ROLES.includes(raw.role)) issue(issues, where, `未知 package role「${raw.role}」，保原文`);
		element.role = role || "temporary";
		const amount = amountOf(raw.amount, issues, `${where}.amount`); if (amount) element.amount = amount;
		const remaining = amountOf(raw.remaining, issues, `${where}.remaining`); if (remaining) element.remaining = remaining;
		const expiresAt = text(raw.expiresAt); if (expiresAt) element.expiresAt = expiresAt;
	} else if (raw.type === "plan" || raw.type === "status") {
		const value = text(raw.value); if (value) element.value = value;
	} else { // note
		const role = NOTE_ROLES.includes(raw.role) ? raw.role : "note";
		if (raw.role !== undefined && !NOTE_ROLES.includes(raw.role)) issue(issues, where, `未知 note role「${raw.role}」归 note`);
		element.role = role;
		const value = text(raw.value ?? raw.text); if (value) element.text = value;
	}
	// 未识别字段原样透传，契约升级不丢数据；契约已声明的字段即使验证失败也**不**回透传——
	// 坏形状回写会让「认不出丢」的白名单失效（percent:'oops' / unitKind:'bogus' 复活）。
	for (const key of Object.keys(raw)) if (!(key in element) && !RESERVED_KEYS.has(key)) element[key] = raw[key];
	return element;
}

export function quotaList(raw, issues) {
	if (!Array.isArray(raw)) return undefined;
	const list = raw.map((item, index) => quotaElement(item, index, issues)).filter(Boolean);
	return list.length ? list : undefined;
}

// ── legacy → quotas ──────────────────────────────────────────────────────

/** windows 行 → window 元素（percent/detail/budgetScope/groupLabel 全量映射）。 */
function quotaFromWindow(w, order, issues) {
	if (!w || typeof w !== "object") { issue(issues, `windows[${order}]`, "行不是对象，跳过"); return undefined; }
	const element = { type: "window", order };
	// groupLabel 只给池身份：OFM Cline 把窗口类型名放这里，并不等价独立池——不标 poolScope。
	if (w.groupLabel) { element.pool = text(w.groupLabel); element.poolLabel = text(w.groupLabel); }
	if (PERIODS.includes(w.kind)) element.period = w.kind;
	if (finite(w.percent) !== undefined) element.percent = w.percent;
	const detail = w.detail && typeof w.detail === "object" ? w.detail : {};
	const amount = {};
	if (finite(detail.used) !== undefined) { element.used = detail.used; amount.value = detail.used; }
	if (finite(detail.limit) !== undefined) element.limit = detail.limit;
	if (finite(detail.left) !== undefined) element.left = detail.left;
	if (text(detail.leftText)) element.leftText = text(detail.leftText);
	const unit = text(detail.unit); if (unit) { amount.unit = unit; amount.unitId = unitIdOf(unit); }
	const unitKind = UNIT_KINDS.includes(detail.unitKind) ? detail.unitKind
		: /credit|积分|point/i.test(unit) ? "credit" : /token/i.test(unit) ? "token" : "";
	if (unitKind) amount.unitKind = unitKind;
	if (Object.keys(amount).length) element.amount = amount;
	if (detail.scope) element.scope = text(detail.scope);
	if (detail.note) element.note = text(detail.note);
	if (detail.planName) element.planName = text(detail.planName);
	if (detail.limitSource) element.limitSource = text(detail.limitSource);
	if (detail.currentPeriodEnd) element.currentPeriodEnd = text(detail.currentPeriodEnd);
	if (w.budgetScope) element.budgetScope = text(w.budgetScope);
	const resetsAt = text(w.resetsAt); if (resetsAt) element.resetsAt = resetsAt;
	if (w.status === "rate-limited") element.status = "rate-limited";
	if (w.cascade === true) element.cascade = true;
	if (Array.isArray(detail.blockedBy) && detail.blockedBy.length) element.blockedBy = detail.blockedBy.map(text).filter(Boolean);
	return element;
}

/** extras 行 → 元素。balance/spend 只按文本能解析时填 amount.value；解析不出就只留 text（不猜）。 */
function quotaFromExtra(x, order, issues) {
	if (!x || typeof x !== "object") { issue(issues, `extras[${order}]`, "行不是对象，跳过"); return undefined; }
	const kind = text(x.kind), value = text(x.value);
	if (kind === "plan") return { type: "plan", order, ...(value ? { value } : {}) };
	if (kind === "quota-status" || kind === "credit-status") return { type: "status", order, ...(value ? { value } : {}) };
	if (kind === "balance" || kind === "monthly-balance" || kind === "spend" || kind.endsWith("-spend")) {
		const role = kind === "spend" || kind.endsWith("-spend") ? "spend" : kind === "monthly-balance" ? "monthly" : "balance";
		const element = { type: "amount", role, order, ...(value ? { text: value } : {}) };
		// 尽量把文本拆成结构数字：「1234 积分」/「$12.34」/「¥5」。
		const match = value.match(/^(¥|￥|\$)?\s*([+-]?(?:\d+(?:\.\d*)?|\.\d+))\s*(.*)$/);
		if (match) {
			const amount = { value: Number(match[2]) };
			const unit = match[1] === "$" ? "USD" : (match[1] === "¥" || match[1] === "￥") ? "CNY" : text(match[3]);
			if (unit) { amount.unit = unit; amount.unitId = unitIdOf(unit); }
			if (amount.unit === "USD" || amount.unit === "CNY") amount.unitKind = "cash";
			else if (/credit|积分|point/i.test(amount.unit ?? "")) amount.unitKind = "credit";
			else if (/token/i.test(amount.unit ?? "")) amount.unitKind = "token";
			element.amount = amount;
		}
		return element;
	}
	return { type: "note", role: kind === "account" ? "account" : "note", order, ...(value ? { text: value } : {}), ...(kind && kind !== "note" && kind !== "account" ? { legacyKind: kind } : {}) };
}

// ── quotas → legacy ──────────────────────────────────────────────────────

function windowFromQuota(element) {
	const w = { kind: element.period ?? "period" };
	const groupLabel = text(element.poolLabel) || text(element.pool); if (groupLabel) w.groupLabel = groupLabel;
	if (finite(element.percent) !== undefined) w.percent = element.percent;
	else if (finite(element.used) !== undefined && finite(element.limit) !== undefined && element.limit > 0)
		w.percent = Math.round((element.used / element.limit) * 10000) / 100; // used/limit 可推导才给百分比，绝不写 NaN
	if (element.status === "rate-limited") w.status = "rate-limited"; else w.status = "ok";
	const detail = {};
	if (finite(element.used) !== undefined) detail.used = element.used;
	if (finite(element.limit) !== undefined) detail.limit = element.limit;
	if (finite(element.left) !== undefined) detail.left = element.left;
	if (text(element.leftText)) detail.leftText = element.leftText;
	const unit = text(element.amount?.unit); if (unit) detail.unit = unit;
	const scope = text(element.scope); if (scope) detail.scope = scope;
	const note = text(element.note) || text(element.label); if (note) detail.note = note;
	const planName = text(element.planName); if (planName) detail.planName = planName;
	const limitSource = text(element.limitSource); if (limitSource) detail.limitSource = limitSource;
	const currentPeriodEnd = text(element.currentPeriodEnd); if (currentPeriodEnd) detail.currentPeriodEnd = currentPeriodEnd;
	if (Array.isArray(element.blockedBy) && element.blockedBy.length) detail.blockedBy = element.blockedBy;
	if (Object.keys(detail).length) w.detail = detail;
	if (element.cascade === true) w.cascade = true;
	if (element.budgetScope) w.budgetScope = element.budgetScope;
	if (element.resetsAt) w.resetsAt = element.resetsAt;
	return w;
}

function amountText(element) {
	if (element.text) return element.text;
	if (element.amount && finite(element.amount.value) !== undefined) {
		const v = element.amount.value, unit = text(element.amount.unit);
		if (unit === "USD") return `$${Math.round(v * 100) / 100}`;
		if (unit === "CNY") return `¥${Math.round(v * 100) / 100}`;
		return `${Math.round(v * 100) / 100}${unit ? ` ${unit}` : ""}`;
	}
	return "";
}

function extraFromQuota(element) {
	if (element.type === "plan") return element.value ? { kind: "plan", value: element.value } : undefined;
	if (element.type === "status") return element.value ? { kind: "quota-status", value: element.value } : undefined;
	if (element.type === "note") return element.text ? { kind: element.role === "account" ? "account" : "note", value: element.text } : undefined;
	if (element.type === "amount") {
		const kind = element.role === "spend" ? "spend" : element.role === "monthly" ? "monthly-balance" : "balance";
		const base = amountText(element);
		if (!base) return undefined;
		// 有名字的多池金额（附赠/钱包/套餐）保留 label，否则多条 balance 全是「余额」分不清。
		const label = text(element.label);
		return { kind, value: label ? `${label} ${base}` : base };
	}
	if (element.type === "package") {
		const parts = [];
		if (element.label) parts.push(element.label);
		if (element.remaining && finite(element.remaining.value) !== undefined) parts.push(`剩 ${Math.round(element.remaining.value * 100) / 100}${element.remaining.unit ? ` ${element.remaining.unit}` : ""}`);
		else if (element.amount && finite(element.amount.value) !== undefined) parts.push(`${Math.round(element.amount.value * 100) / 100}${element.amount.unit ? ` ${element.amount.unit}` : ""}`);
		if (element.expiresAt) parts.push(`${element.expiresAt} 到期`);
		return parts.length ? { kind: "note", value: parts.join(" · ") } : undefined;
	}
	return undefined;
}

/** 把元素表派生成现行 windows/extras（保顺序；window 元素在前，其余按 order）。 */
export function legacyFromQuotas(quotas) {
	const list = (quotas ?? []).slice().sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
	const windows = [], extras = [];
	for (const element of list) {
		if (element.type === "window") { const w = windowFromQuota(element); if (w) windows.push(w); }
		else { const x = extraFromQuota(element); if (x) extras.push(x); }
	}
	return { windows, extras };
}

/** 把现行 windows/extras 转换成结构化元素表。 */
export function quotasFromLegacy(entry, issues) {
	const quotas = [];
	(entry?.windows ?? []).forEach((w, i) => { const el = quotaFromWindow(w, i, issues); if (el) quotas.push(el); });
	const offset = quotas.length;
	(entry?.extras ?? []).forEach((x, i) => { const el = quotaFromExtra(x, offset + i, issues); if (el) quotas.push(el); });
	return quotas.length ? quotas : undefined;
}

// ── 条目收编 ──────────────────────────────────────────────────────────────

/**
 * 出边界统一收编：复制 entry（含 Symbol 键），
 * - `ofmAccounts` 别名列折叠进 `linkedAccounts`（wire 上不再有 ofmAccounts）；
 * - **quotas 在场即权威**：`quotas` 是数组（含显式 `[]`）时按它派生 windows/extras，
 *   不从 legacy 反向导入（否则 `quotas:[]` 会被旧 extras 复活、双轨可分叉）；
 * - `quotas` 整体缺席时才从 windows/extras 转换（旧归一化器兼容层）；
 * - `windows`/`extras` 保留「缺席 ≠ 空」：没有就没有，不用 [] 顶替；
 *   `quotas` 恒为数组，消费者不用判空；
 * - 收编丢弃/降级记录进 `diagnostics[]`（缺席 = 干净；上游秘密原文不进诊断）。
 * 未知字段透传；不填造 coverage/freshness（那些由调用方语义决定）。
 */
export function canonicalizeEntry(entry) {
	if (!entry || typeof entry !== "object") return entry;
	const out = { ...entry };
	for (const key of Object.getOwnPropertySymbols(entry)) out[key] = entry[key];

	const accounts = Array.isArray(out.linkedAccounts) ? out.linkedAccounts
		: Array.isArray(out.ofmAccounts) ? out.ofmAccounts : undefined;
	const issues = [];
	if (accounts) out.linkedAccounts = accounts.map((account, index) => canonicalizeAccount(account, issues, `linkedAccounts[${index}]`));
	delete out.ofmAccounts;

	if ("subject" in out) {
		const subject = subjectOf(out.subject, issues, "subject");
		if (subject) out.subject = subject;
		else delete out.subject;
	}
	if ("aggregation" in out) {
		const aggregation = aggregationOf(out.aggregation, issues, "aggregation");
		if (aggregation) out.aggregation = aggregation;
		else delete out.aggregation;
	}

	canonicalizeShape(out, issues);
	if (issues.length) out.diagnostics = issues;
	return out;
}

/** quotas ↔ legacy 在场性规则，条目与账号行共用。 */
function canonicalizeShape(out, issues) {
	if (Array.isArray(out.quotas)) {
		// quotas 明确在场（含 []）：权威源，派生 legacy。显式空 = 该条目没有额度元素。
		out.quotas = quotaList(out.quotas, issues) ?? [];
		const legacy = legacyFromQuotas(out.quotas);
		if (!Array.isArray(out.windows) || !out.windows.length) out.windows = legacy.windows;
		if (!Array.isArray(out.extras) || !out.extras.length) out.extras = legacy.extras;
	} else {
		out.quotas = quotasFromLegacy(out, issues) ?? [];
	}
}

/** 账号行同样收编：linkedAccounts 行内 quotas ↔ windows/extras 互转，字段语义一致。 */
export function canonicalizeAccount(row, issues, where = "account") {
	if (!row || typeof row !== "object") return row;
	const out = { ...row };
	const scoped = issues ? [] : undefined;
	if ("subject" in out) {
		const subject = subjectOf(out.subject, scoped, "subject");
		if (subject) out.subject = subject;
		else delete out.subject;
	}
	if ("aggregation" in out) {
		const aggregation = aggregationOf(out.aggregation, scoped, "aggregation");
		if (aggregation) out.aggregation = aggregation;
		else delete out.aggregation;
	}
	canonicalizeShape(out, scoped);
	if (issues && scoped?.length) for (const item of scoped) issues.push({ where, ...item });
	return out;
}

/**
 * 判断某个余额元素是否允许参与跨账号/跨 Key 总额相加：
 * - 必须是 type="amount" 且 role="balance"，且无 componentOf 分项标记；
 * - 元素级或账号级显式声明 aggregation.balance="forbid" 时禁止相加；
 * - Key 级行内携带的 user 级共享余额（如 sub2api 多把 Key 共用同一用户钱包），
 *   除非显式声明 aggregation.balance="allow"，否则禁止跨 Key 重复相加。
 */
export function canSumBalanceElement(element, account) {
	if (!element || element.type !== "amount" || (element.role ?? "balance") !== "balance") return false;
	if (element.componentOf) return false;
	if (element.aggregation?.balance === "forbid" || account?.aggregation?.balance === "forbid") return false;
	if (element.subject?.kind === "user" && account?.subject?.kind === "key" && element.aggregation?.balance !== "allow") return false;
	return Number.isFinite(element.amount?.value);
}

/**
 * 跨账号/跨 Key 合计可用余额（按 unitId 分组）：
 * - 遵循 canSumBalanceElement 聚合护栏；
 * - 若元素带有明确的共享主体身份（subject.kind !== "key" && subject.id），同一主体 + unitId 只计入一次。
 */
export function sumAccountBalances(accounts) {
	if (!Array.isArray(accounts) || !accounts.length) return [];
	const byUnit = new Map();
	const seenSharedSubjects = new Set();
	for (const account of accounts) {
		if (!account || typeof account !== "object") continue;
		const quotas = Array.isArray(account.quotas) ? account.quotas : (quotasFromLegacy(account) ?? []);
		for (const element of quotas) {
			if (!canSumBalanceElement(element, account)) continue;
			const unit = text(element.amount?.unit);
			const unitId = text(element.amount?.unitId) || unitIdOf(unit) || "__unitless__";
			if (element.subject?.id && element.subject.kind && element.subject.kind !== "key") {
				const sharedKey = `${element.subject.kind}:${element.subject.id}:${unitId}`;
				if (seenSharedSubjects.has(sharedKey)) continue;
				seenSharedSubjects.add(sharedKey);
			}
			const prev = byUnit.get(unitId);
			if (prev) {
				prev.value = Math.round((prev.value + element.amount.value) * 10000) / 10000;
				prev.count += 1;
			} else {
				byUnit.set(unitId, {
					unitId: unitId === "__unitless__" ? "" : unitId,
					unit,
					...(element.amount?.unitKind ? { unitKind: element.amount.unitKind } : {}),
					value: element.amount.value,
					count: 1
				});
			}
		}
	}
	return [...byUnit.values()];
}
