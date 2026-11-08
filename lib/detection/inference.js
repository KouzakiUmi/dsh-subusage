/**
 * 未知 JSON 响应结构化推断与歧义检测（Generic Response Inference）：
 * - 基于数值守恒关系（used + remaining ≈ limit, 0 <= used <= limit, limit > 0）校验窗口；
 * - 主动检测并报告五大语义冲突：
 *   1. scope-conflict：同响应同时出现 balance 与 remaining（区分用户钱包 vs Key 配额，默认禁止跨 Key 求和）；
 *   2. percent-semantics：0~1 小数比率（如 0.39）或未指明方向的百分比（已用 vs 剩余）；
 *   3. timestamp-semantics：expires_at（套餐到期）与 reset_at（窗口重置）严格分离，绝不把 expires_at 填入 resetAtPointer；
 *   4. array-semantics / pool-scope：数组是周期窗口还是额度包，多池默认 shared 除非用户确认为 independent；
 *   5. unit-unknown：按「显式 unit/currency 字段 > 字段名后缀 > 货币符号前缀」推断单位，无证据绝不盲猜 USD；
 * - 所有启发式推断结果强制标记 requiresConfirmation: true。
 */

import { enumeratePointers, formatPointer } from "../http/json-pointer.js";
import { toNumber } from "../http/transforms.js";
import { sanitizePreview } from "./sanitize-preview.js";

function inferUnitFromKeyName(keyName) {
	const k = String(keyName ?? "").toLowerCase();
	if (/(?:^|_)usd(?:$|_)/.test(k)) return "USD";
	if (/(?:^|_)(?:cny|rmb)(?:$|_)/.test(k)) return "CNY";
	if (/(?:^|_)(?:credits?|points?)(?:$|_)/.test(k)) return "credits";
	if (/(?:^|_)tokens?(?:$|_)/.test(k)) return "tokens";
	if (/(?:^|_)requests?(?:$|_)/.test(k)) return "requests";
	return "";
}

function inferUnitFromStringSymbol(rawVal) {
	if (typeof rawVal !== "string") return "";
	const trimmed = rawVal.trim();
	if (trimmed.startsWith("$")) return "USD";
	if (trimmed.startsWith("¥") || trimmed.startsWith("￥")) return "CNY";
	return "";
}

export function inferGenericResponse(rawBody, options = {}) {
	if (!rawBody || typeof rawBody !== "object" || Array.isArray(rawBody)) {
		return {
			matched: false,
			confidence: "none",
			requiresConfirmation: true,
			suggestedMapping: {},
			conflicts: [{ kind: "invalid-root", message: "响应根节点不是 JSON 对象" }],
			explanations: [],
			candidatePointers: []
		};
	}

	const hasDataEnvelope = rawBody.data && typeof rawBody.data === "object" && !Array.isArray(rawBody.data);
	const rootObj = hasDataEnvelope ? rawBody.data : rawBody;
	const baseTokens = hasDataEnvelope ? ["data"] : [];
	const ptr = (...segs) => formatPointer([...baseTokens, ...segs]);

	const suggestedMapping = {};
	const conflicts = [];
	const explanations = [];
	const safeBody = sanitizePreview(rawBody, { secretHints: options.secretHints });
	const candidatePointers = enumeratePointers(safeBody, { maxDepth: 5, maxNodes: 200 });

	// 1. 单位证据收集（优先级：显式字段 > 字段名后缀 > 字符串符号）
	let detectedUnit = "";
	for (const uKey of ["currency", "unit", "balance_unit"]) {
		if (typeof rootObj[uKey] === "string" && rootObj[uKey].trim()) {
			detectedUnit = rootObj[uKey].trim();
			suggestedMapping.unitPointer = ptr(uKey);
			suggestedMapping.unit = detectedUnit;
			explanations.push(`从显式字段 ${ptr(uKey)} 识别到单位「${detectedUnit}」`);
			break;
		}
	}

	// 2. 套餐名识别
	for (const pKey of ["plan_name", "planName", "plan", "tier", "group_name"]) {
		if (typeof rootObj[pKey] === "string" && rootObj[pKey].trim()) {
			suggestedMapping.planPointer = ptr(pKey);
			explanations.push(`识别到套餐/分组名称字段 ${ptr(pKey)}`);
			break;
		}
	}

	// 3. 检索候选窗口对象（根节点或 quota / usage / subscription / billing 子对象）
	const windowContainers = [
		{ obj: rootObj, prefix: [] },
		...(rootObj.quota && typeof rootObj.quota === "object" && !Array.isArray(rootObj.quota) ? [{ obj: rootObj.quota, prefix: ["quota"] }] : []),
		...(rootObj.subscription && typeof rootObj.subscription === "object" && !Array.isArray(rootObj.subscription) ? [{ obj: rootObj.subscription, prefix: ["subscription"] }] : []),
		...(rootObj.billing && typeof rootObj.billing === "object" && !Array.isArray(rootObj.billing) ? [{ obj: rootObj.billing, prefix: ["billing"] }] : [])
	];

	let foundWindow = false;
	for (const container of windowContainers) {
		const cObj = container.obj;
		const cPtr = (...s) => formatPointer([...baseTokens, ...container.prefix, ...s]);

		const usedKey = ["used", "used_usd", "total_used", "usage", "current"].find(k => toNumber(cObj[k]) !== undefined);
		const limitKey = ["limit", "limit_usd", "max_budget", "hard_limit", "total_granted", "total", "max"].find(k => {
			const n = toNumber(cObj[k]);
			return n !== undefined && n > 0;
		});
		const remKey = ["remaining", "remaining_usd", "total_available", "available", "left"].find(k => toNumber(cObj[k]) !== undefined);

		if (limitKey && (usedKey || remKey)) {
			const limitVal = toNumber(cObj[limitKey]);
			const usedVal = usedKey ? toNumber(cObj[usedKey]) : undefined;
			const remVal = remKey ? toNumber(cObj[remKey]) : undefined;

			if (usedVal !== undefined && remVal !== undefined) {
				const sumDiff = Math.abs((usedVal + remVal) - limitVal);
				const tolerance = Math.max(0.01, limitVal * 0.02);
				if (sumDiff <= tolerance) {
					explanations.push(`满足数值守恒校验：${cPtr(usedKey)} (${usedVal}) + ${cPtr(remKey)} (${remVal}) ≈ ${cPtr(limitKey)} (${limitVal})`);
				} else {
					conflicts.push({
						kind: "triple-inconsistent",
						fields: [cPtr(usedKey), cPtr(remKey), cPtr(limitKey)],
						message: `已用 (${usedVal}) + 剩余 (${remVal}) 与总额度 (${limitVal}) 不守恒，请确认三者是否属于同一配额池`
					});
				}
			}

			if (usedKey) suggestedMapping.usedPointer = cPtr(usedKey);
			suggestedMapping.limitPointer = cPtr(limitKey);
			if (remKey) suggestedMapping.remainingPointer = cPtr(remKey);

			if (!detectedUnit) {
				const suffixUnit = inferUnitFromKeyName(limitKey) || inferUnitFromKeyName(usedKey) || inferUnitFromKeyName(remKey)
					|| inferUnitFromStringSymbol(cObj[limitKey]);
				if (suffixUnit) {
					detectedUnit = suffixUnit;
					suggestedMapping.unit = suffixUnit;
					explanations.push(`从字段名或符号推断单位为「${suffixUnit}」`);
				}
			}

			// 检查重置时间 vs 到期时间
			const resetKey = ["reset_at", "resets_at", "resetAt", "resetsAt", "budget_reset_at"].find(k => cObj[k] !== undefined && cObj[k] !== null);
			const expireKey = ["expires_at", "expiresAt", "expired_at", "expire_at"].find(k => cObj[k] !== undefined && cObj[k] !== null);
			if (resetKey) {
				suggestedMapping.resetAtPointer = cPtr(resetKey);
			}
			if (expireKey) {
				suggestedMapping.expiresAtPointer = cPtr(expireKey);
				if (!resetKey) {
					conflicts.push({
						kind: "timestamp-semantics",
						fields: [cPtr(expireKey)],
						message: `检测到 ${cPtr(expireKey)}，已按「套餐到期时间（note）」处理而非「周期重置时间（resetsAt）」；若该字段实际为窗口重置点请手动调整`
					});
				}
			}

			foundWindow = true;
			break;
		}
	}

	// 4. 百分比/比率单字段检测（如 ratio: 0.39 或 percent: 39）
	if (!foundWindow) {
		const pctKey = ["percent", "used_percent", "usage_percent", "remaining_percent", "ratio", "usage_ratio", "remaining_ratio"].find(k => toNumber(rootObj[k]) !== undefined);
		if (pctKey) {
			const val = toNumber(rootObj[pctKey]);
			suggestedMapping.percentPointer = ptr(pctKey);
			const isRemainingName = /remaining|left/i.test(pctKey);
			if (val > 0 && val < 1 && /ratio|percent/i.test(pctKey)) {
				suggestedMapping.percentSemantics = isRemainingName ? "fraction-remaining" : "fraction-used";
				conflicts.push({
					kind: "percent-semantics",
					fields: [ptr(pctKey)],
					message: `字段 ${ptr(pctKey)} 值为小数 ${val}，无法仅凭数值断言是「已用比例 (${Math.round(val * 100)}%)」、「剩余比例」还是「${val}%」，请确认百分比语义`
				});
			} else {
				suggestedMapping.percentSemantics = isRemainingName ? "remaining" : "used";
				conflicts.push({
					kind: "percent-semantics",
					fields: [ptr(pctKey)],
					message: `字段 ${ptr(pctKey)} 值为 ${val}，请确认其代表「已用百分比」还是「剩余百分比」`
				});
			}
			foundWindow = true;
		}
	}

	// 5. 余额与剩余配额检测（及双余额作用域冲突检测）
	const balanceKey = ["balance", "balance_usd", "user_balance", "wallet_balance", "total_balance", "credit_balance"].find(k => toNumber(rootObj[k]) !== undefined);
	const topRemKey = ["remaining", "remaining_usd", "quota_remaining", "available"].find(k => toNumber(rootObj[k]) !== undefined);
	const nestedRemPtr = suggestedMapping.remainingPointer;

	if (balanceKey) {
		suggestedMapping.balancePointer = ptr(balanceKey);
		if (!detectedUnit) {
			const u = inferUnitFromKeyName(balanceKey) || inferUnitFromStringSymbol(rootObj[balanceKey]);
			if (u) {
				detectedUnit = u;
				suggestedMapping.unit = u;
			}
		}
		if (nestedRemPtr || (topRemKey && topRemKey !== balanceKey)) {
			const otherPtr = nestedRemPtr || ptr(topRemKey);
			suggestedMapping.balanceSubjectKind = "user";
			suggestedMapping.balanceAggregation = "forbid";
			if (foundWindow) suggestedMapping.balanceRole = "wallet";
			conflicts.push({
				kind: "scope-conflict",
				fields: [ptr(balanceKey), otherPtr],
				message: `响应同时包含余额字段 ${ptr(balanceKey)} 与配额剩余字段 ${otherPtr}：已将 ${ptr(balanceKey)} 默认标记为用户级共享钱包（禁止跨 Key 重复求和），请确认两者作用域`
			});
		}
	} else if (!foundWindow && topRemKey) {
		suggestedMapping.balancePointer = ptr(topRemKey);
		if (!detectedUnit) {
			const u = inferUnitFromKeyName(topRemKey) || inferUnitFromStringSymbol(rootObj[topRemKey]);
			if (u) {
				detectedUnit = u;
				suggestedMapping.unit = u;
			}
		}
	}

	// 6. 花费字段识别（绝不混入 balance）
	const spendKey = ["spend", "total_spend", "today_spend", "daily_spend", "cost"].find(k => toNumber(rootObj[k]) !== undefined);
	if (spendKey) {
		suggestedMapping.spendPointer = ptr(spendKey);
		explanations.push(`识别到花费指标 ${ptr(spendKey)}（映射为 role="spend"，不计入可用余额）`);
	}

	// 7. 数组结构识别（窗口数组 vs 额度包数组 vs 独立池歧义）
	for (const [k, v] of Object.entries(rootObj)) {
		if (!Array.isArray(v) || !v.length || typeof v[0] !== "object" || v[0] === null) continue;
		const sample = v[0];
		const hasWinShape = (toNumber(sample.limit) !== undefined && (toNumber(sample.used) !== undefined || toNumber(sample.remaining) !== undefined))
			|| toNumber(sample.percent) !== undefined;
		const hasPkgShape = (toNumber(sample.remaining) !== undefined || toNumber(sample.amount) !== undefined)
			&& (sample.expires_at !== undefined || sample.expiresAt !== undefined);
		if (hasWinShape && !suggestedMapping.windowsArrayPointer) {
			suggestedMapping.windowsArrayPointer = ptr(k);
			explanations.push(`识别到窗口数组 ${ptr(k)}`);
			if (v.length > 1 && (sample.pool !== undefined || sample.group !== undefined || sample.model !== undefined || sample.name !== undefined)) {
				conflicts.push({
					kind: "pool-scope",
					fields: [ptr(k)],
					message: `窗口数组 ${ptr(k)} 含多个条目，默认按共享预算（shared，取最紧窗口）处理；若各池相互独立请手动切换为 independent`
				});
			}
		} else if (hasPkgShape && !suggestedMapping.packagesArrayPointer) {
			suggestedMapping.packagesArrayPointer = ptr(k);
			explanations.push(`识别到额度包数组 ${ptr(k)}`);
		}
	}

	// 8. 顶层到期时间检查（若尚未记录）
	if (!suggestedMapping.expiresAtPointer) {
		const topExpireKey = ["expires_at", "expiresAt", "expired_at"].find(k => rootObj[k] !== undefined && rootObj[k] !== null);
		if (topExpireKey) {
			suggestedMapping.expiresAtPointer = ptr(topExpireKey);
		}
	}

	// 9. 单位未知提示
	const hasNumericMapping = Boolean(
		suggestedMapping.balancePointer ||
		suggestedMapping.limitPointer ||
		suggestedMapping.usedPointer ||
		suggestedMapping.spendPointer
	);
	if (hasNumericMapping && !detectedUnit) {
		conflicts.push({
			kind: "unit-unknown",
			fields: [],
			message: "响应未包含明确的货币或单位信息（currency / unit），未自动猜测单位，请在映射确认中指定（如 USD、CNY、credits、tokens）"
		});
	}

	const hasAnyMapping = Boolean(
		suggestedMapping.balancePointer ||
		suggestedMapping.limitPointer ||
		suggestedMapping.percentPointer ||
		suggestedMapping.windowsArrayPointer ||
		suggestedMapping.packagesArrayPointer ||
		suggestedMapping.spendPointer
	);

	return {
		matched: hasAnyMapping,
		confidence: !hasAnyMapping ? "none" : conflicts.length === 0 ? "medium" : "low",
		requiresConfirmation: true,
		suggestedMapping,
		conflicts,
		explanations,
		candidatePointers
	};
}
