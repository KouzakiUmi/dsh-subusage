// 火山方舟（Volcengine Ark）订阅额度适配：管控面 OpenAPI 的 AK/SK 签名与套餐窗口归一化。
//
// 额度接口只在管控面 OpenAPI 暴露，鉴权是 IAM Access Key 的 HMAC-SHA256 签名（V4 变体），
// 与推理用的方舟 API Key（Bearer / UUID 形态）是**两套完全不同的凭据**：
// 拿推理 Key 去签名只会得到 401/403，与接口可用性无关。
//
// 套餐额度分散在多个 Action 上，且官方 API 概览只公开了其中一部分（Team 系）：
//   - GetCodingPlanUsage  个人版 Coding Plan（Level + Percent，按次数计）
//   - GetAFPUsage         个人版 Agent Plan（AFP 绝对值，5 小时/日/周/月四个滚动窗口）
//   - GetSeatInfoUsage / ListSeatInfoUsages  Coding Plan 企业版席位（需 SeatID）
//   - GetSeatAFPUsage     Agent Plan 企业版席位（需 SeatIDs）
// 本插件按 provider 固定调用其中一个 Action：路由由官方插件 ark-plan-api 注册，
// ark-coding-plan-* 走 Coding Plan，ark-agent-plan-* 走 Agent Plan。
import { createHash, createHmac } from "node:crypto";

export const VOLC_HOST = "open.volcengineapi.com";
export const VOLC_REGION = "cn-beijing";
export const VOLC_SERVICE = "ark";
export const VOLC_VERSION = "2024-01-01";

const sha256Hex = value => createHash("sha256").update(value ?? "").digest("hex");
const hmac = (key, value, encoding) => createHmac("sha256", key).update(value).digest(encoding);

/**
 * RFC3986 严格转义。encodeURIComponent 会放过 ! ' ( ) * ，而签名要求把它们
 * 也转成 %XX —— 少转一个字符，服务端算出的签名就不同，表现为 InvalidSignature。
 */
export function volcEscape(value) {
	return encodeURIComponent(String(value)).replace(/[!'()*]/g, char => `%${char.charCodeAt(0).toString(16).toUpperCase()}`);
}

/** X-Date 格式：yyyyMMdd'T'HHmmss'Z'（UTC，无分隔符、无毫秒）。 */
export function volcDateFormat(ms) {
	return new Date(ms).toISOString().replace(/[-:]|\.\d{3}/g, "");
}

/** 查询串按参数名升序，用严格转义拼接（Action 与 Version 走 query，不在 body 里）。 */
export function volcCanonicalQuery(params) {
	return Object.keys(params).sort().map(key => `${volcEscape(key)}=${volcEscape(params[key])}`).join("&");
}

/**
 * 生成一次调用的 URL 与签名头。签名密钥派生链：
 *   kDate = HMAC(SK, yyyyMMdd) → kRegion = HMAC(kDate, region)
 *   → kService = HMAC(kRegion, service) → kSigning = HMAC(kService, "request")
 * 待签串与 AWS SigV4 同形，但算法名写 HMAC-SHA256，scope 末段固定为 request。
 */
export function volcSignature({ accessKeyId, secretAccessKey, action, version = VOLC_VERSION, body = "{}", date = Date.now(), host = VOLC_HOST, region = VOLC_REGION, service = VOLC_SERVICE }) {
	const xDate = volcDateFormat(date);
	const shortDate = xDate.slice(0, 8);
	const payloadHash = sha256Hex(body);
	const query = volcCanonicalQuery({ Action: action, Version: version });
	const signedHeaders = "content-type;host;x-content-sha256;x-date";
	const canonicalHeaders = [
		"content-type:application/json",
		`host:${host}`,
		`x-content-sha256:${payloadHash}`,
		`x-date:${xDate}`
	].join("\n") + "\n";
	const credentialScope = `${shortDate}/${region}/${service}/request`;
	const canonicalRequest = ["POST", "/", query, canonicalHeaders, signedHeaders, payloadHash].join("\n");
	const stringToSign = ["HMAC-SHA256", xDate, credentialScope, sha256Hex(canonicalRequest)].join("\n");
	const signingKey = hmac(hmac(hmac(hmac(secretAccessKey, shortDate), region), service), "request");
	return {
		url: `https://${host}/?${query}`,
		headers: {
			"content-type": "application/json",
			"x-content-sha256": payloadHash,
			"x-date": xDate,
			authorization: `HMAC-SHA256 Credential=${accessKeyId}/${credentialScope}, SignedHeaders=${signedHeaders}, Signature=${hmac(signingKey, stringToSign, "hex")}`
		}
	};
}

/** 业务信封错误：ResponseMetadata.Error 比 HTTP 状态码更能说明拒绝原因。 */
export function volcError(body) {
	const error = body?.ResponseMetadata?.Error;
	if (!error || typeof error !== "object") return undefined;
	const code = typeof error.Code === "string" && error.Code.trim() ? error.Code.trim() : "UnknownError";
	const message = typeof error.Message === "string" && error.Message.trim() ? error.Message.trim() : "";
	return { code, message };
}

function finite(value) {
	return typeof value === "number" && Number.isFinite(value);
}
/** 额度字段是字符串数字（"50.0"），只接受有限非负数；非法值不当作 0。 */
function amount(value) {
	if (typeof value === "number" && Number.isFinite(value) && value >= 0) return value;
	if (typeof value === "string" && value.trim() && Number.isFinite(Number(value))) {
		const parsed = Number(value);
		return parsed >= 0 ? parsed : undefined;
	}
	return undefined;
}
/** 重置时间戳单位不统一：Coding Plan 是秒，Agent Plan 是毫秒。 */
function fromEpoch(value, unit) {
	if (!Number.isSafeInteger(value) && !Number.isFinite(value)) return undefined;
	const ms = unit === "seconds" ? value * 1000 : value;
	return Number.isFinite(ms) && ms > 0 && Number.isFinite(new Date(ms).getTime()) ? new Date(ms).toISOString() : undefined;
}

// Level 是后端下发的窗口名；未登记的取值不产出窗口，不猜语义。
const CODING_LEVELS = {
	session: "5h", "5h": "5h", five_hour: "5h", fivehour: "5h",
	weekly: "week", week: "week", "7d": "week", seven_day: "week",
	monthly: "month", month: "month", thirty_day: "month"
};

/**
 * 个人版 Coding Plan：Result.QuotaUsage[] 每项一个窗口。
 * Percent 是**已用百分数**（0–100，实测常见 0.39 这类小值，不能按「≤1 即小数」放大）。
 * 接口只给百分比，不返回绝对量，因此不产出 detail。
 * 真实响应里还带 `Cap` / `RewardTotalPercent` / `HasReward`（2026-10-10 用本机 AK/SK 实测：三个窗口
 * 都是 `Cap: 100`、`RewardTotalPercent: 0`、`HasReward: false`）——**字段确实存在**，但没有任何官方
 * 说明它们的语义（像百分比刻度，也像次数上限），所以不展示：不编造单位，也不把 100 读成"还有 100 次"。
 */
export function parseVolcCodingPlan(body) {
	// 正常走 OpenAPI 的 ResponseMetadata + Result 信封；个别抓包形态把字段放在顶层，两者都接受。
	const result = body?.Result && typeof body.Result === "object" && !Array.isArray(body.Result) ? body.Result : body;
	const rows = Array.isArray(result?.QuotaUsage) ? result.QuotaUsage : [];
	const windows = [];
	for (const row of rows) {
		const kind = CODING_LEVELS[String(row?.Level ?? "").trim().toLowerCase()];
		if (!kind) continue;
		const percent = amount(row?.Percent);
		if (percent === undefined) throw new Error("Volcengine Coding Plan percent is invalid");
		windows.push({ kind, percent, resetsAt: fromEpoch(row?.ResetTimestamp, "seconds") });
	}
	return { subscribed: rows.length > 0, windows };
}

// Agent Plan 的 AFP 窗口：Quota / Used 是绝对值，比例由两者算出。
// 顺序即展示顺序，第三列是**额度线分组**：文本 / 向量模型走 5 小时 → 周 → 月（同一条线），
// 而日限额只在视觉模型、语音模型与 Harness 上生效，是另一条线。两组各自成组展示并标注影响范围，
// 否则把两条线的配额并排放在一起，谁都会把"日比周还高"读成插件算错了。
const AFP_WINDOWS = [
	["AFPFiveHour", "5h", "文本 / 向量模型"],
	["AFPWeekly", "week", "文本 / 向量模型"],
	["AFPMonthly", "month", "文本 / 向量模型"],
	["AFPDaily", "day", "视觉 / 语音模型与 Harness"]
];

/**
 * 个人版 Agent Plan：Result 下四个滚动窗口。
 * Quota 为 0/缺失表示该窗口不适用（例如视觉模型不占 5 小时额度），不产出行、更不当成 0%。
 */
export function parseVolcAgentPlan(body) {
	const result = body?.Result;
	if (!result || typeof result !== "object") return { subscribed: false, windows: [], plan: undefined };
	const windows = [];
	let reported = false;
	for (const [field, kind, groupLabel] of AFP_WINDOWS) {
		const row = result[field];
		if (!row || typeof row !== "object") continue;
		reported = true;
		const quota = amount(row.Quota), used = amount(row.Used);
		if (quota === undefined || used === undefined) throw new Error("Volcengine AFP window is invalid");
		if (quota <= 0) continue;
		windows.push({ kind, percent: Math.min(100, used / quota * 100), resetsAt: fromEpoch(row.ResetTime, "milliseconds"), groupLabel, detail: { used, limit: quota, unit: "AFP" } });
	}
	const plan = typeof result.PlanType === "string" && result.PlanType.trim() ? result.PlanType.trim() : undefined;
	return { subscribed: windows.length > 0 || reported, windows, plan };
}

// ── 企业版/团队版：额度挂在「席位」上，要先 ListSeatInfos 取 SeatID ────────────────

/** 从 ListSeatInfos 的响应里取席位 ID 列表（路径为 Result.Data[].SeatID）。 */
export function parseVolcSeatIds(body) {
	const data = body?.Result?.Data;
	if (!Array.isArray(data)) return [];
	return data.map(row => typeof row?.SeatID === "string" && row.SeatID.trim() ? row.SeatID.trim() : undefined).filter(Boolean);
}

/** Agent Plan 企业版单个席位：GetSeatAFPUsage 的响应（Result.SeatAFPUsages[]，取第一条）。 */
export function parseVolcSeatAfp(body) {
	const rows = body?.Result?.SeatAFPUsages;
	if (!Array.isArray(rows) || !rows.length) return { subscribed: false, windows: [] };
	const row = rows[0] && typeof rows[0] === "object" ? rows[0] : {};
	const windows = [];
	let reported = false;
	// 席位版 Agent Plan 与个人版共用同一组 AFP 窗口（含那条只覆盖视觉 / 语音模型与 Harness 的日限额），
	// 所以分组标注也要一起带上，否则席位卡片里同样会把两条额度线混着显示。
	for (const [field, kind, groupLabel] of AFP_WINDOWS) {
		const window = row[field];
		if (!window || typeof window !== "object") continue;
		reported = true;
		const quota = amount(window.Quota), used = amount(window.Used);
		if (quota === undefined || used === undefined) throw new Error("Volcengine seat AFP window is invalid");
		if (quota <= 0) continue;
		windows.push({ kind, percent: Math.min(100, used / quota * 100), resetsAt: fromEpoch(window.ResetTime, "milliseconds"), groupLabel, detail: { used, limit: quota, unit: "AFP" } });
	}
	const plan = typeof row.PlanType === "string" && row.PlanType.trim() ? row.PlanType.trim() : undefined;
	const seatId = typeof row.SeatID === "string" && row.SeatID.trim() ? row.SeatID.trim() : undefined;
	return { subscribed: windows.length > 0 || reported, windows, plan, seatId };
}

/**
 * Coding Plan 企业版单个席位：GetSeatInfoUsage 的响应（Result.SeatInfoUsage）。
 * 三个字段都是**已用百分比**（字符串），缺字段不产出行、不当作 0。
 * 窗口语义：WeeklyUsage→周、MonthlyUsage→月；ShortTermUsage 国内文档写「近 5 分钟用量」、
 * 国际站英文文档写「5 小时百分比」，两站冲突——按短周期窗口处理，存疑见 docs/development.md。
 */
export function parseVolcSeatCoding(body) {
	// **站点间结构不同**（已核实）：国际站是 `Result.SeatInfoUsage.*`，中国站契约是 `Result.*` 直挂。
	// 只认一种会让另一站点静默读不到数据，所以两条路径都试。
	const result = body?.Result && typeof body.Result === "object" && !Array.isArray(body.Result) ? body.Result : undefined;
	const nested = result?.SeatInfoUsage;
	const info = nested && typeof nested === "object" && !Array.isArray(nested) ? nested : result;
	if (!info || typeof info !== "object" || Array.isArray(info)) return { subscribed: false, windows: [] };
	const windows = [];
	// 三个 usage 字段各带一个同族的重置时刻（毫秒）：只给百分比不给重置会让它和别家不一致。
	// 注意 5 小时用量为 0 时 ShortTermResetMilestone 返回 -1，fromEpoch 的 ms>0 判定会挡掉。
	for (const [field, kind, resetField] of [["ShortTermUsage", "5h", "ShortTermResetMilestone"], ["WeeklyUsage", "week", "WeeklyResetMilestone"], ["MonthlyUsage", "month", "MonthlyResetMilestone"]]) {
		const value = amount(info[field]);
		if (value === undefined) continue;
		windows.push({ kind, percent: Math.min(100, value), resetsAt: fromEpoch(info[resetField], "milliseconds") });
	}
	const seatId = typeof info.SeatID === "string" && info.SeatID.trim() ? info.SeatID.trim() : undefined;
	return { subscribed: windows.length > 0, windows, seatId };
}
