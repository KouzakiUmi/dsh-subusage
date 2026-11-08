/**
 * DisplayProfile（展示配置契约）：
 * - 允许用户配置药丸与卡片的主展示指标（primaryMetric）、元素显示名称（elementLabels）、
 *   元素排序（elementOrders）、隐藏次要元素（hiddenElementIds）与小数精度（precision）；
 * - 严格语义护栏：严禁通过 DisplayProfile 篡改 role、unit、unitId、unitKind、poolScope、
 *   resetsAt、expiresAt、subject、aggregation、state、coverage 等事实语义；
 * - 缺失目标优雅降级：当 primaryMetric 指向的元素或账号在当前快照中缺席、或因共享钱包禁止求和时，
 *   自动回退到 auto 并在条目上附加 displayDegraded 诊断说明，绝不伪造 0 余额。
 */

import { canonicalizeEntry, sumAccountBalances, unitIdOf } from "../quota-entry.js";

const FORBIDDEN_SEMANTIC_KEYS = new Set([
	"role",
	"unit",
	"unitId",
	"unitKind",
	"poolScope",
	"resetsAt",
	"resetsAtPointer",
	"expiresAt",
	"expiresAtPointer",
	"percentSemantics",
	"scale",
	"subject",
	"aggregation",
	"state",
	"coverage",
	"freshness",
	"availability"
]);

export function isValidPrimaryMetric(metric) {
	if (typeof metric !== "string") return false;
	const trimmed = metric.trim();
	if (trimmed === "auto" || trimmed === "tightest-window") return true;
	if (/^element:[a-zA-Z0-9._:-]{1,64}$/.test(trimmed)) return true;
	if (/^account-total:[a-zA-Z0-9._:-]{1,32}$/.test(trimmed)) return true;
	if (/^account:[^\s]{1,128}$/.test(trimmed)) return true;
	return false;
}

export function validateDisplayProfile(raw) {
	if (raw === undefined || raw === null) return {};
	if (typeof raw !== "object" || Array.isArray(raw)) {
		throw new Error("DisplayProfile 必须是对象");
	}
	for (const key of Object.keys(raw)) {
		if (FORBIDDEN_SEMANTIC_KEYS.has(key)) {
			throw new Error(`DisplayProfile 严禁修改额度语义字段「${key}」`);
		}
	}

	const out = {};
	if (raw.primaryMetric !== undefined) {
		if (!isValidPrimaryMetric(raw.primaryMetric)) {
			throw new Error(`无效的 primaryMetric「${String(raw.primaryMetric)}」`);
		}
		out.primaryMetric = raw.primaryMetric.trim();
	}

	if (raw.hiddenElementIds !== undefined) {
		if (!Array.isArray(raw.hiddenElementIds) || raw.hiddenElementIds.length > 16) {
			throw new Error("hiddenElementIds 必须是长度不超过 16 的字符串数组");
		}
		const ids = raw.hiddenElementIds.map(id => {
			if (typeof id !== "string" || !id.trim() || id.trim().length > 64) {
				throw new Error("hiddenElementIds 包含无效的元素 ID");
			}
			return id.trim();
		});
		out.hiddenElementIds = [...new Set(ids)];
	}

	if (raw.elementLabels !== undefined) {
		if (!raw.elementLabels || typeof raw.elementLabels !== "object" || Array.isArray(raw.elementLabels)) {
			throw new Error("elementLabels 必须是键值对象");
		}
		const entries = Object.entries(raw.elementLabels);
		if (entries.length > 16) throw new Error("elementLabels 最多配置 16 项");
		const labels = {};
		for (const [k, v] of entries) {
			if (typeof v !== "string" || !v.trim() || v.trim().length > 48) {
				throw new Error(`elementLabels["${k}"] 必须是非空字符串（≤48 字符）`);
			}
			labels[k.trim()] = v.trim();
		}
		if (Object.keys(labels).length) out.elementLabels = labels;
	}

	if (raw.elementOrders !== undefined) {
		if (!raw.elementOrders || typeof raw.elementOrders !== "object" || Array.isArray(raw.elementOrders)) {
			throw new Error("elementOrders 必须是键值对象");
		}
		const entries = Object.entries(raw.elementOrders);
		if (entries.length > 16) throw new Error("elementOrders 最多配置 16 项");
		const orders = {};
		for (const [k, v] of entries) {
			if (typeof v !== "number" || !Number.isFinite(v)) {
				throw new Error(`elementOrders["${k}"] 必须是有限数字`);
			}
			orders[k.trim()] = v;
		}
		if (Object.keys(orders).length) out.elementOrders = orders;
	}

	if (raw.precision !== undefined) {
		if (!Number.isInteger(raw.precision) || raw.precision < 0 || raw.precision > 4) {
			throw new Error("precision 必须是 0 到 4 之间的整数");
		}
		out.precision = raw.precision;
	}

	return out;
}

function roundWithPrecision(val, precision) {
	if (typeof val !== "number" || !Number.isFinite(val) || precision === undefined) return val;
	const factor = 10 ** precision;
	const res = Math.round(val * factor) / factor;
	return Object.is(res, -0) ? 0 : res;
}

export function applyDisplayProfile(entry, rawProfile) {
	if (!entry || typeof entry !== "object") return entry;
	const profile = validateDisplayProfile(rawProfile);
	if (!Object.keys(profile).length) return entry;

	const out = { ...entry };
	for (const sym of Object.getOwnPropertySymbols(entry)) out[sym] = entry[sym];

	const hiddenSet = new Set(profile.hiddenElementIds ?? []);
	const labels = profile.elementLabels ?? {};
	const orders = profile.elementOrders ?? {};
	const precision = profile.precision;

	const transformQuotas = (quotas) => {
		if (!Array.isArray(quotas)) return quotas;
		const filtered = [];
		for (const el of quotas) {
			if (!el || typeof el !== "object") continue;
			if (el.id && hiddenSet.has(el.id)) continue;
			const next = { ...el };
			if (el.id && labels[el.id]) next.label = labels[el.id];
			if (el.id && orders[el.id] !== undefined) next.order = orders[el.id];
			if (precision !== undefined && next.amount && typeof next.amount.value === "number") {
				next.amount = {
					...next.amount,
					value: roundWithPrecision(next.amount.value, precision)
				};
				if (next.type === "amount") {
					delete next.text; // 让 legacyFromQuotas 按新精度重新生成展示文本
				}
			}
			filtered.push(next);
		}
		return filtered.sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
	};

	if (Array.isArray(out.quotas)) {
		out.quotas = transformQuotas(out.quotas);
		// 清空旧 legacy 以便 canonicalizeEntry 根据新排序/标签重新派生
		delete out.windows;
		delete out.extras;
	}

	const metric = profile.primaryMetric ?? "auto";
	if (metric !== "auto") {
		if (metric === "tightest-window") {
			const windows = (out.quotas ?? []).filter(q => q.type === "window" && Number.isFinite(q.percent));
			if (windows.length) {
				const tightest = windows.reduce((best, cur) => (cur.percent > best.percent ? cur : best), windows[0]);
				out.displayPrimary = {
					kind: "window",
					metric,
					...(tightest.id ? { elementId: tightest.id } : {}),
					percent: tightest.percent,
					remainingPercent: Math.max(0, Math.round((100 - tightest.percent) * 100) / 100),
					...(tightest.label ? { label: tightest.label } : {})
				};
			} else {
				out.displayDegraded = {
					reason: "target-missing",
					requested: metric,
					fallback: "auto"
				};
			}
		} else if (metric.startsWith("element:")) {
			const targetId = metric.slice("element:".length);
			const hit = (out.quotas ?? []).find(q => q.id === targetId);
			if (hit) {
				out.displayPrimary = {
					kind: "element",
					metric,
					elementId: targetId,
					elementType: hit.type,
					...(hit.label ? { label: hit.label } : {}),
					...(hit.type === "window" && Number.isFinite(hit.percent) ? {
						percent: hit.percent,
						remainingPercent: Math.max(0, Math.round((100 - hit.percent) * 100) / 100)
					} : {}),
					...(hit.amount && Number.isFinite(hit.amount.value) ? {
						value: hit.amount.value,
						...(hit.amount.unit ? { unit: hit.amount.unit } : {}),
						...(hit.amount.unitId ? { unitId: hit.amount.unitId } : {})
					} : {})
				};
			} else {
				out.displayDegraded = {
					reason: "target-missing",
					requested: metric,
					fallback: "auto"
				};
			}
		} else if (metric.startsWith("account:")) {
			const targetAcc = metric.slice("account:".length);
			const linkedHit = (out.linkedAccounts ?? []).find(a => a?.accountId === targetAcc || a?.account === targetAcc);
			const keyHit = (out.keyAccounts ?? []).find(a => a?.ref === targetAcc);
			if (linkedHit || keyHit) {
				out.displayPrimary = {
					kind: "account",
					metric,
					accountId: targetAcc
				};
			} else {
				out.displayDegraded = {
					reason: "target-missing",
					requested: metric,
					fallback: "auto"
				};
			}
		} else if (metric.startsWith("account-total:")) {
			const requestedUnit = unitIdOf(metric.slice("account-total:".length));
			const accounts = Array.isArray(out.linkedAccounts) && out.linkedAccounts.length
				? out.linkedAccounts
				: Array.isArray(out.keyAccounts) && out.keyAccounts.length
				? out.keyAccounts
				: [];
			const totals = sumAccountBalances(accounts);
			const hit = totals.find(t => t.unitId === requestedUnit);
			if (hit && hit.count > 0) {
				out.displayPrimary = {
					kind: "account-total",
					metric,
					unitId: hit.unitId,
					...(hit.unit ? { unit: hit.unit } : {}),
					value: precision !== undefined ? roundWithPrecision(hit.value, precision) : hit.value,
					count: hit.count
				};
			} else {
				out.displayDegraded = {
					reason: "aggregation-unavailable",
					requested: metric,
					fallback: "auto"
				};
			}
		}
	}

	return canonicalizeEntry(out);
}
