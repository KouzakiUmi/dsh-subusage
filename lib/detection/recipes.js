/**
 * 已知网关与提供商响应签名指纹库（优先于启发式通用推断）。
 */

import { toNumber } from "../http/transforms.js";

export const DEFAULT_CANDIDATE_PATHS = [
	"/v1/usage",
	"/api/v1/usage",
	"/key/info",
	"/v1/dashboard/billing/credit_grants"
];

/**
 * 识别 JSON 响应是否命中已知适配器签名。
 */
export function matchKnownRecipeSignature(rawBody, usagePath = "") {
	if (!rawBody || typeof rawBody !== "object" || Array.isArray(rawBody)) return undefined;
	const data = rawBody.data && typeof rawBody.data === "object" && !Array.isArray(rawBody.data)
		? rawBody.data
		: rawBody;
	const path = String(usagePath ?? "").trim();

	// 1. sub2api 签名：存在 subscription（含 daily/weekly/monthly）或 quota + (balance | usage | rate_limits | planName)
	const hasSub2ApiSub = data.subscription && typeof data.subscription === "object" && (
		data.subscription.daily !== undefined ||
		data.subscription.weekly !== undefined ||
		data.subscription.monthly !== undefined ||
		data.subscription.daily_usage_usd !== undefined ||
		data.subscription.daily_limit_usd !== undefined ||
		data.subscription.monthly_usage_usd !== undefined ||
		data.subscription.monthly_limit_usd !== undefined
	);
	const hasSub2ApiQuota = data.quota && typeof data.quota === "object" && (
		toNumber(data.quota.limit ?? data.quota.limit_usd) !== undefined ||
		toNumber(data.quota.remaining ?? data.quota.remaining_usd) !== undefined
	);
	const hasSub2ApiRateLimits = Array.isArray(data.rate_limits);
	const hasSub2ApiCombo = (hasSub2ApiSub || hasSub2ApiQuota || hasSub2ApiRateLimits) && (
		toNumber(data.balance ?? data.user_balance) !== undefined ||
		(data.usage && typeof data.usage === "object") ||
		typeof (data.planName ?? data.plan_name ?? data.group_name) === "string" ||
		hasSub2ApiSub
	);
	if (hasSub2ApiCombo) {
		return {
			matched: true,
			recipeId: "sub2api",
			adapterId: "sub2api",
			confidence: "high",
			reason: "命中 sub2api 网关响应结构（subscription / quota / balance / usage 组合特征）",
			usagePath: path || "/v1/usage"
		};
	}

	// 2. LiteLLM 签名：/key/info 或包含 info.{spend, max_budget, budget_duration}
	const info = data.info && typeof data.info === "object" ? data.info : data.key_info && typeof data.key_info === "object" ? data.key_info : null;
	const isLiteLLM = (info && (toNumber(info.spend) !== undefined || "max_budget" in info || "budget_duration" in info))
		|| (toNumber(data.spend) !== undefined && ("max_budget" in data || "budget_duration" in data || "tpm_limit" in data || "rpm_limit" in data));
	if (isLiteLLM) {
		return {
			matched: true,
			recipeId: "litellm",
			adapterId: "litellm",
			confidence: "high",
			reason: "命中 LiteLLM 网关响应结构（spend / max_budget / budget_duration 特征）",
			usagePath: path || "/key/info"
		};
	}

	// 3. DeepSeek 余额数组签名：balance_infos[].total_balance
	if (Array.isArray(data.balance_infos) && data.balance_infos.some(b => b && typeof b === "object" && "total_balance" in b)) {
		return {
			matched: true,
			recipeId: "deepseek-compatible",
			adapterId: "custom-http",
			confidence: "high",
			reason: "命中 DeepSeek 风格 balance_infos 结构",
			usagePath: path || "/user/balance",
			suggestedMapping: {
				balancePointer: "/balance_infos/0/total_balance",
				unitPointer: "/balance_infos/0/currency"
			}
		};
	}

	// 4. OpenAI credit_grants 兼容签名：total_granted / total_used / total_available
	if (toNumber(data.total_granted) !== undefined && toNumber(data.total_used) !== undefined && toNumber(data.total_available) !== undefined) {
		return {
			matched: true,
			recipeId: "openai-credit-grants",
			adapterId: "custom-http",
			confidence: "high",
			reason: "命中 credit_grants 结构（total_granted / total_used / total_available）",
			usagePath: path || "/v1/dashboard/billing/credit_grants",
			suggestedMapping: {
				usedPointer: rawBody.data ? "/data/total_used" : "/total_used",
				limitPointer: rawBody.data ? "/data/total_granted" : "/total_granted",
				remainingPointer: rawBody.data ? "/data/total_available" : "/total_available",
				unit: "USD"
			}
		};
	}

	return undefined;
}
