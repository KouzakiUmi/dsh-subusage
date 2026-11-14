// lib/providers/shared.js —— provider 归一化共用 API（纯函数，无 DSH 核心包依赖）。
//
// 模块间通信按 API 形式：调用方（lib/index.js 或各 provider 模块）用
// `createWindowApi({ failure })` 建一份窗口 API 再传给归一化函数，不直接
// 共享模块私有状态。数字口径（百分比截断、档位划分）只在这里定义一处。

function numeric(v) { return typeof v === "number" && Number.isFinite(v) && v >= 0; }

const RANK = { month: 0, sub: 0, period: 0, week: 1, "7d": 1, day: 2, "5h": 2, rolling: 2 };

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

function cascadeRateLimited(windows) {
	const roots = windows.filter(w => w.status === "rate-limited");
	for (const w of windows) {
		const blockers = roots.filter(root => {
			const sourceScope = root.detail?.scope ?? "all", targetScope = w.detail?.scope ?? "all";
			return (sourceScope === "all" || sourceScope === targetScope) && (RANK[root.kind] ?? 3) < (RANK[w.kind] ?? 3);
		});
		if (blockers.length) { if (w.status !== "rate-limited") w.cascade = true; w.status = "rate-limited"; w.detail = { ...w.detail, blockedBy: [...new Set(blockers.map(root => root.kind))] }; }
	}
	return windows;
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
		return { windows: cascadeRateLimited(windows), extras, coverage, ...(Array.isArray(quotas) ? { quotas } : {}) };
	}
	return { failure, windowRow, windowKindFromSeconds, windowExtrasResult, cascadeRateLimited, numeric, linkedProviders };
}
