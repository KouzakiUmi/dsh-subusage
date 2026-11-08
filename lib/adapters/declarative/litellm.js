/**
 * LiteLLM 网关声明式/混合适配器（/key/info、/user/info、/team/info）。
 */

import { canonicalizeEntry } from "../../quota-entry.js";
import { toNumber, usedRatio, limitMinusUsed, timestamp, unitMap, windowPeriodFromHint } from "../../http/transforms.js";
import { unwrapEnvelope } from "../../http/request-plan.js";

export const LITELLM_RECIPE = Object.freeze({
	id: "litellm",
	kind: "declarative-http",
	label: "LiteLLM",
	defaultUsagePath: "/key/info",
	candidatePaths: ["/key/info", "/user/info", "/team/info"],
	defaultAuthKind: "bearer",
	supportedAuthKinds: ["bearer", "x-api-key", "custom-header"],
	builtinEnvs: ["LITELLM_API_KEY"],
	capabilities: {
		supportsCustomBaseUrl: true,
		supportsMultiKey: true,
		supportsRouteBinding: true,
		supportsDisplayProfile: true,
		supportsRecipeExport: true
	},
	// LiteLLM 管理端点挂在根路径（/key/info 等），不是 OpenAI 兼容层（/v1/*）。
	// 用户常把 OpenAI 形式 http://host:4000/v1 填进 baseUrl：endpoint 合成时剥掉 /v1，
	// 否则打到 /v1/key/info 一律 404。子路径反代（/litellm/v1）不在此列——只剥末尾 /v1。
	dropsTrailingV1: true
});

export function normalizeLiteLLMPayload(rawBody, options = {}) {
	const data = unwrapEnvelope(rawBody);
	// /key/info: {key, info:{...}}  |  /user/info: {user_id, user_info:{max_budget, spend, models, keys}}
	// /team/info: {team_id, team_info:{max_budget, spend}} —— 三种响应都归一到同一个 info 对象。
	const info = data.info && typeof data.info === "object" && !Array.isArray(data.info)
		? data.info
		: data.key_info && typeof data.key_info === "object"
		? data.key_info
		: data.user_info && typeof data.user_info === "object"
		? data.user_info
		: data.team_info && typeof data.team_info === "object"
		? data.team_info
		: data;

	const quotas = [];
	let order = 0;

	const alias = [info.key_alias, info.team_alias, info.key_name, data.key_alias, data.team_alias]
		.find(v => typeof v === "string" && v.trim());
	if (alias) {
		quotas.push({
			type: "plan",
			id: "plan",
			order: order++,
			value: alias.trim()
		});
	}

	const spend = toNumber(info.spend ?? data.spend);
	const maxBudget = toNumber(info.max_budget ?? data.max_budget);
	const uMap = unitMap("USD", "USD");

	if (maxBudget !== undefined && maxBudget > 0 && spend !== undefined) {
		const pct = usedRatio(spend, maxBudget);
		const left = limitMinusUsed(maxBudget, spend);
		const resetsAt = timestamp(info.budget_reset_at ?? data.budget_reset_at);
		const period = windowPeriodFromHint(null, info.budget_duration ?? data.budget_duration ?? "period");
		quotas.push({
			type: "window",
			id: "key-budget",
			label: "Key 预算",
			order: order++,
			period,
			percent: pct,
			used: spend,
			limit: maxBudget,
			...(left !== undefined ? { left } : {}),
			amount: { value: spend, ...uMap },
			...(resetsAt ? { resetsAt } : {}),
			...(pct >= 100 || (left !== undefined && left <= 0) ? { status: "rate-limited" } : {}),
			subject: { kind: "key" }
		});
	} else if (spend !== undefined) {
		quotas.push({
			type: "status",
			id: "budget-unlimited",
			order: order++,
			value: "unlimited"
		});
		quotas.push({
			type: "amount",
			id: "key-spend",
			label: "累计花费",
			order: order++,
			role: "spend",
			amount: { value: spend, ...uMap },
			subject: { kind: "key" }
		});
	}

	// 若附带 team_budget / team_spend
	const teamSpend = toNumber(info.team_spend ?? data.team_spend ?? data.team_info?.spend);
	const teamMax = toNumber(info.team_max_budget ?? data.team_max_budget ?? data.team_info?.max_budget);
	if (teamMax !== undefined && teamMax > 0 && teamSpend !== undefined) {
		const pct = usedRatio(teamSpend, teamMax);
		const left = limitMinusUsed(teamMax, teamSpend);
		quotas.push({
			type: "window",
			id: "team-budget",
			label: "团队预算",
			order: order++,
			period: "period",
			percent: pct,
			used: teamSpend,
			limit: teamMax,
			...(left !== undefined ? { left } : {}),
			amount: { value: teamSpend, ...uMap },
			...(pct >= 100 || (left !== undefined && left <= 0) ? { status: "rate-limited" } : {}),
			subject: {
				kind: "group",
				...(typeof (info.team_id ?? data.team_id) === "string" ? { id: info.team_id ?? data.team_id } : {})
			}
		});
	}

	const expiresIso = timestamp(info.expires ?? data.expires);
	if (expiresIso) {
		quotas.push({
			type: "note",
			id: "key-expires",
			order: order++,
			role: "note",
			text: `Key 到期 ${expiresIso.slice(0, 10)}`
		});
	}

	if (!quotas.length) {
		const err = new Error("LiteLLM 响应未包含可识别的 spend 或 max_budget 字段");
		err.code = "subusage/response";
		throw err;
	}

	const entry = canonicalizeEntry({
		quotas,
		coverage: "complete"
	});
	return {
		quotas: entry.quotas,
		windows: entry.windows ?? [],
		extras: entry.extras ?? [],
		coverage: "complete"
	};
}
