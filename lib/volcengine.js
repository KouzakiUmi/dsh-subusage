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
 * 接口只给百分比，不返回绝对量，因此不产出 detail（Cap 字段未在任何来源证实存在，不编造）。
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
const AFP_WINDOWS = [["AFPFiveHour", "5h"], ["AFPDaily", "day"], ["AFPWeekly", "week"], ["AFPMonthly", "month"]];

/**
 * 个人版 Agent Plan：Result 下四个滚动窗口。
 * Quota 为 0/缺失表示该窗口不适用（例如视觉模型不占 5 小时额度），不产出行、更不当成 0%。
 */
export function parseVolcAgentPlan(body) {
	const result = body?.Result;
	if (!result || typeof result !== "object") return { subscribed: false, windows: [], plan: undefined };
	const windows = [];
	let reported = false;
	for (const [field, kind] of AFP_WINDOWS) {
		const row = result[field];
		if (!row || typeof row !== "object") continue;
		reported = true;
		const quota = amount(row.Quota), used = amount(row.Used);
		if (quota === undefined || used === undefined) throw new Error("Volcengine AFP window is invalid");
		if (quota <= 0) continue;
		windows.push({ kind, percent: Math.min(100, used / quota * 100), resetsAt: fromEpoch(row.ResetTime, "milliseconds"), detail: { used, limit: quota, unit: "AFP" } });
	}
	const plan = typeof result.PlanType === "string" && result.PlanType.trim() ? result.PlanType.trim() : undefined;
	return { subscribed: windows.length > 0 || reported, windows, plan };
}
