// lib/providers/shared.js —— provider 归一化共用 API（纯函数，无 DSH 核心包依赖）。
//
// 模块间通信按 API 形式：调用方（lib/index.js 或各 provider 模块）用
// `createWindowApi({ failure })` 建一份窗口 API 再传给归一化函数，不直接
// 共享模块私有状态。数字口径（百分比截断、档位划分）只在这里定义一处。

function numeric(v) { return typeof v === "number" && Number.isFinite(v) && v >= 0; }

const RANK = { month: 0, sub: 0, period: 0, week: 1, "7d": 1, day: 2, "5h": 2, rolling: 2 };
/** 周期长度档位（越小越短），只服务展示排序与连坐层级两处。 */
const PERIOD_LEN = { "5h": 1, day: 2, rolling: 2, "7d": 3, week: 3, month: 4, period: 5, sub: 6 };

/**
 * 展示顺序：**短周期在上、长周期在下**（5 小时 → 日 → 周 → 月 → 周期）。
 *
 * 上游下发顺序不固定（Antigravity 的 Gemini 组有时把 7 days 放前面），不排的话同一个界面
 * 会在两次刷新之间上下颠倒。排序是稳定的，同周期保持上游顺序。
 *
 * **有 `groupLabel` 时只组内排序**：分组是「这条窗约束哪批模型」的实际分组标题，跨组混排会
 * 把同一组的窗口拆到别的组标题下面。组间保持各自首次出现的顺序。
 *
 * `poolKey: null` 表示「这个 provider 的 groupLabel 不是池身份」（OFM 把上游的窗口类型名塞在
 * groupLabel 里用来做分组标题），此时按全局周期排序，不按 label 分组。
 */
export function sortWindowsByPeriod(windows, { poolKey = "groupLabel" } = {}) {
	if (!Array.isArray(windows) || windows.length < 2) return windows;
	const len = w => PERIOD_LEN[w?.kind] ?? 9;
	const byPeriod = (a, b) => len(a) - len(b);
	if (!poolKey || !windows.some(w => w?.[poolKey])) { windows.sort(byPeriod); return windows; }
	const order = new Map();
	windows.forEach((w, index) => {
		const key = w?.[poolKey] ?? `#${index}`;
		if (!order.has(key)) order.set(key, []);
		order.get(key).push(w);
	});
	const sorted = [];
	for (const bucket of order.values()) sorted.push(...bucket.sort(byPeriod));
	windows.length = 0;
	windows.push(...sorted);
	return windows;
}

/**
 * 按窗口秒数归一到插件统一的窗口档位；无法判断大小时退回通用 `period`，
 * 不从套餐名或百分比反推档位。
 */
function windowKindFromSeconds(seconds) {
	if (seconds <= 6 * 3600) return "5h";
	if (seconds <= 36 * 3600) return "day";
	if (seconds <= 8 * 86400) return "week";
	if (seconds <= 32 * 86400) return "month";
	return "period";
}

/**
 * 上层窗口用尽 → 下层窗口连坐。
 *
 * **连坐范围按池判定**：groupLabel 是池身份（Antigravity 的模型分组、Magpie 的渠道池），
 * 优先于 detail.scope——后者在 Antigravity 里恒为 "all"（表示「约束全部模型」），拿它当池
 * 会把不同池串成一起：一个池的周额度用尽，会把别的池的 5 小时也标红。没有分池的 provider
 * 两者都缺席，回退 "all"（全量连坐，与旧行为一致）。
 *
 * 宿主与各 provider 共用这一份实现：曾经 lib/index.js 复刻过一份，改一处忘另一处就会
 * 出现「Host 说连坐、药丸说正常」这类分叉。
 */
export function cascadeRateLimitedRaw(windows) {
	const roots = windows.filter(w => w.status === "rate-limited");
	const scopeOf = w => w.groupLabel ?? w.detail?.scope ?? "all";
	for (const w of windows) {
		const blockers = roots.filter(root => {
			const sourceScope = scopeOf(root), targetScope = scopeOf(w);
			return (sourceScope === "all" || sourceScope === targetScope) && (RANK[root.kind] ?? 3) < (RANK[w.kind] ?? 3);
		});
		if (blockers.length) { if (w.status !== "rate-limited") w.cascade = true; w.status = "rate-limited"; w.detail = { ...w.detail, blockedBy: [...new Set(blockers.map(root => root.kind))] }; }
	}
	return windows;
}
/**
 * 排序 + 连坐：**所有窗口型 provider 的必经之路**。
 *
 * 把「短周期在上」的顺序统一放在这里，就不会出现「某个 provider 忘了排序 → 它的窗口在界面上
 * 上下颠倒」。排序是稳定且幂等的，对已经排好的数组没有副作用。
 */
export function cascadeRateLimited(windows) {
	return cascadeRateLimitedRaw(sortWindowsByPeriod(windows));
}

/**
 * 建一份窗口 API。failure 是调用方的错误工厂（签名与 RemoteError 一致）；
 * linkedProviders 是 Host 的联动元数据表（只读），自建上游按需取 label/panel。
 * 各 provider 模块只经这份 API 与宿主通信，不直引核心包。
 * numeric 随 API 一并下发：各归一化的数字判定口径与宿主一致。
 */
export function createWindowApi({ failure, linkedProviders }) {
	if (typeof failure !== "function") throw new TypeError("createWindowApi 需要 failure 工厂");
	function windowRow(kind, raw, resetsAt, status, detail) {
		if (!numeric(raw)) throw failure("subusage/response", "用量百分比缺失或无效");
		const percent = raw < 100 ? Math.min(99.9, Math.round(raw * 10) / 10) : Math.round(raw * 10) / 10;
		return { kind, percent, status: status === "rate-limited" || raw >= 100 ? "rate-limited" : "ok", ...(typeof resetsAt === "string" && Number.isFinite(Date.parse(resetsAt)) ? { resetsAt: new Date(resetsAt).toISOString() } : {}), ...(detail ? { detail } : {}) };
	}
	/**
	 * 「窗口 + 附加行」型 provider 的统一返回结构：windows 统一过级联，
	 * extras 保持调用方顺序，coverage 缺省 complete。字段名与默认值只在这里定义一处。
	 */
	function windowExtrasResult({ windows = [], extras = [], coverage = "complete", quotas } = {}) {
			// 先按周期长度排（短在上），再判连坐：顺序统一在出口处定，避免各家自由发挥。
			return { windows: cascadeRateLimited(windows), extras, coverage, ...(Array.isArray(quotas) ? { quotas } : {}) };
	}
	return { failure, windowRow, windowKindFromSeconds, windowExtrasResult, cascadeRateLimited, sortWindowsByPeriod, numeric, linkedProviders };
}
