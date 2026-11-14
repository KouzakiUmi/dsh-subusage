/**
 * New API / One API 声明式适配器（newapi）：
 * - 一等实例入口：站点根 + sk- Key 即完成接入，字段映射与单位换算内置（500000 quota = 1 Credits），
 *   不需要 JSON Pointer 配置——「难用的自定义」不再是一等上游的必经之路；
 * - 归一化与 provider 通道共享 classifyNewApiUsage 纯核心（lib/providers/newapi.js），两路不漂移；
 * - 站点根归一（去尾斜杠、剥末层 /v1 与 /api）由 recipe.baseUrlMode = "newapi-root" 声明，
 *   runtime 与探测在发请求前应用；文档路径优先，尾斜杠变体进入探测候选。
 */

import { canonicalizeEntry } from "../../quota-entry.js";
import { NEWAPI_QUOTA_PER_CREDIT, classifyNewApiUsage } from "../../providers/newapi.js";

export const NEWAPI_ADAPTER_RECIPE = Object.freeze({
	id: "newapi",
	kind: "declarative-http",
	label: "New API / One API 站点",
	defaultUsagePath: "/api/usage/token",
	candidatePaths: ["/api/usage/token", "/api/usage/token/"],
	defaultAuthKind: "bearer",
	supportedAuthKinds: ["bearer"],
	builtinEnvs: [],
	baseUrlMode: "newapi-root",
	capabilities: {
		supportsCustomBaseUrl: true,
		supportsMultiKey: true,
		supportsRouteBinding: true,
		supportsDisplayProfile: true,
		supportsRecipeExport: true
	}
});

const round2 = value => Math.round(value * 100) / 100;
const credits = value => `${round2(value / NEWAPI_QUOTA_PER_CREDIT)} Credits`;

/**
 * New API 响应 → 标准 QuotaEntry 元素（纯函数，无 windowApi 依赖）。
 * 三种形态与 provider 通道同口径：unlimited（账户余额为主池）/ limited（令牌窗口 + 余额）/
 * legacy（旧版仅账户余额）；信封 `code:false`/`success:false` 抛 `subusage/auth`。
 */
export function normalizeNewApiPayload(body, opts = {}) {
	const info = classifyNewApiUsage(body);
	const quotas = [];
	let order = 0;
	// 到期日是令牌到期，不是窗口重置：只作说明行，不写 resetsAt。
	if (info.expiresAt) {
		const at = info.expiresAt * 1000;
		const date = new Date(at).toISOString().slice(0, 10);
		const days = Math.ceil((at - (typeof opts.now === "number" ? opts.now : Date.now())) / 86400000);
		quotas.push({ type: "note", id: "token-expires", order: order++, role: "note", text: days > 0 ? `令牌到期 ${date}（还有 ${days} 天）` : `令牌已于 ${date} 到期` });
	}
	if (info.tokenName) {
		quotas.push({ type: "note", id: "token-name", order: order++, role: "note", text: info.mode === "unlimited" ? `无限额度令牌：${info.tokenName}` : `令牌：${info.tokenName}` });
	}
	if (info.mode === "unlimited") {
		quotas.push({ type: "amount", id: "balance", order: order++, role: "wallet", label: "账户余额", amount: { value: round2(info.walletAvailable / NEWAPI_QUOTA_PER_CREDIT), unit: "Credits" } });
		if (info.walletUsed !== undefined) quotas.push({ type: "amount", id: "spend", order: order++, role: "spend", label: "累计消费", amount: { value: round2(info.walletUsed / NEWAPI_QUOTA_PER_CREDIT), unit: "Credits" } });
	} else if (info.mode === "limited") {
		const granted = info.granted ?? 0;
		const used = info.used ?? 0;
		const available = info.available ?? 0;
		if (granted > 0) {
			const percent = Math.min(100, used / granted * 100);
			quotas.push({ type: "window", id: "token", order: order++, period: "period", percent, used: round2(used / NEWAPI_QUOTA_PER_CREDIT), limit: round2(granted / NEWAPI_QUOTA_PER_CREDIT), amount: { value: round2(used / NEWAPI_QUOTA_PER_CREDIT), unit: "Credits" } });
		}
		quotas.push({ type: "amount", id: "balance", order: order++, role: "plan", label: "令牌余额", amount: { value: round2(available / NEWAPI_QUOTA_PER_CREDIT), unit: "Credits" } });
		// 账户钱包只作说明行，不并入主余额（两个池，不混报）。
		if (info.walletAvailable !== undefined) {
			quotas.push({ type: "note", id: "wallet-note", order: order++, role: "note", text: info.walletAvailable > 0 ? `账户余额另有 ${credits(info.walletAvailable)}` : info.walletAvailable === 0 ? "账户余额为 0" : `账户余额为负（${round2(info.walletAvailable / NEWAPI_QUOTA_PER_CREDIT)} Credits）` });
		}
	} else {
		// legacy：令牌无数字，账户余额是唯一可读池。
		quotas.push({ type: "amount", id: "balance", order: order++, role: "wallet", label: "账户余额", amount: { value: round2(info.walletAvailable / NEWAPI_QUOTA_PER_CREDIT), unit: "Credits" } });
		if (info.walletUsed !== undefined) quotas.push({ type: "amount", id: "spend", order: order++, role: "spend", label: "累计消费", amount: { value: round2(info.walletUsed / NEWAPI_QUOTA_PER_CREDIT), unit: "Credits" } });
	}
	const entry = canonicalizeEntry({ quotas, coverage: "complete" });
	return {
		quotas: entry.quotas,
		windows: entry.windows ?? [],
		extras: entry.extras ?? [],
		coverage: "complete"
	};
}
