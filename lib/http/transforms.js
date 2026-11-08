/**
 * 声明式响应映射白名单转换器（严禁 eval / Function，全纯函数可序列化）。
 */

import { getByPointer } from "./json-pointer.js";
import { PERIODS, UNIT_KINDS, unitIdOf } from "../quota-entry.js";

export const TRANSFORM_WHITELIST = new Set([
	"coalesce",
	"toNumber",
	"scale",
	"usedRatio",
	"remainingRatio",
	"limitMinusUsed",
	"timestamp",
	"unitMap",
	"roleMap",
	"arrayMap",
	"constant"
]);

export function toNumber(value) {
	if (typeof value === "number") return Number.isFinite(value) && !Object.is(value, -0) ? value : value === 0 ? 0 : undefined;
	if (typeof value === "string") {
		const trimmed = value.trim();
		if (!trimmed) return undefined;
		const cleaned = trimmed.replace(/^[$¥￥]\s*/, "").replace(/,/g, "");
		if (/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)$/.test(cleaned)) {
			const n = Number(cleaned);
			return Number.isFinite(n) ? (Object.is(n, -0) ? 0 : n) : undefined;
		}
	}
	return undefined;
}

export function coalesce(root, pointers) {
	if (!Array.isArray(pointers)) return undefined;
	for (const ptr of pointers) {
		const val = getByPointer(root, ptr);
		if (val !== undefined && val !== null && val !== "") return val;
	}
	return undefined;
}

export function scale(value, factor = 1) {
	const num = toNumber(value);
	const mul = toNumber(factor);
	if (num === undefined || mul === undefined || mul === 0) return undefined;
	const res = Math.round(num * mul * 1000000) / 1000000;
	return Object.is(res, -0) ? 0 : res;
}

export function usedRatio(used, limit) {
	const u = toNumber(used);
	const l = toNumber(limit);
	if (u === undefined || l === undefined || l <= 0) return undefined;
	const pct = Math.round((u / l) * 10000) / 100;
	return Math.max(0, Math.min(100, Object.is(pct, -0) ? 0 : pct));
}

export function remainingRatio(remaining, limit) {
	const r = toNumber(remaining);
	const l = toNumber(limit);
	if (r === undefined || l === undefined || l <= 0) return undefined;
	const usedPct = Math.round(((l - r) / l) * 10000) / 100;
	return Math.max(0, Math.min(100, Object.is(usedPct, -0) ? 0 : usedPct));
}

export function limitMinusUsed(limit, used) {
	const l = toNumber(limit);
	const u = toNumber(used);
	if (l === undefined || u === undefined) return undefined;
	const left = Math.round((l - u) * 10000) / 10000;
	return Math.max(0, Object.is(left, -0) ? 0 : left);
}

/**
 * 时间戳安全归一化：支持 ISO-8601、秒级/毫秒级 Unix 时间戳；哨兵值（<=0、-1）一律返回 undefined。
 */
export function timestamp(raw, mode = "auto") {
	if (raw === null || raw === undefined || raw === "") return undefined;
	if (typeof raw === "number") {
		if (!Number.isFinite(raw) || raw <= 0) return undefined;
		const ms = mode === "seconds" ? raw * 1000
			: mode === "ms" ? raw
			: raw < 1e11 ? raw * 1000 : raw;
		const d = new Date(ms);
		return Number.isFinite(d.getTime()) ? d.toISOString() : undefined;
	}
	if (typeof raw === "string") {
		const trimmed = raw.trim();
		if (!trimmed || trimmed === "-1" || trimmed === "0") return undefined;
		if (/^\d+$/.test(trimmed)) return timestamp(Number(trimmed), mode);
		const ms = Date.parse(trimmed);
		return Number.isFinite(ms) && ms > 0 ? new Date(ms).toISOString() : undefined;
	}
	return undefined;
}

/**
 * 单位映射：返回 { unit, unitId, unitKind }（不猜测未知单位的 unitKind）。
 */
export function unitMap(rawUnit, fallbackUnit = "") {
	const raw = typeof rawUnit === "string" && rawUnit.trim() ? rawUnit.trim()
		: typeof fallbackUnit === "string" && fallbackUnit.trim() ? fallbackUnit.trim() : "";
	if (!raw) return undefined;
	const unitId = unitIdOf(raw);
	let unit = raw;
	if (unitId === "usd") unit = "USD";
	else if (unitId === "cny") unit = "CNY";
	let unitKind = "";
	if (unitId === "usd" || unitId === "cny") unitKind = "cash";
	else if (unitId === "credit") unitKind = "credit";
	else if (unitId === "token") unitKind = "token";
	else if (unitId === "request") unitKind = "quota";
	return {
		unit,
		unitId,
		...(UNIT_KINDS.includes(unitKind) ? { unitKind } : {})
	};
}

export function roleMap(rawRole, mapping = {}, fallback = "balance") {
	if (typeof rawRole === "string" && rawRole.trim()) {
		const key = rawRole.trim();
		if (mapping && typeof mapping === "object" && Object.prototype.hasOwnProperty.call(mapping, key)) {
			return mapping[key];
		}
		return key;
	}
	return fallback;
}

/**
 * 从秒数或周期名称推断 QuotaEntry 标准窗口周期档位。
 */
export function windowPeriodFromHint(seconds, nameHint = "") {
	const sec = toNumber(seconds);
	if (sec !== undefined && sec > 0) {
		if (sec <= 6 * 3600) return "5h";
		if (sec <= 36 * 3600) return "day";
		if (sec <= 10 * 86400) return "week";
		if (sec <= 45 * 86400) return "month";
		return "period";
	}
	const hint = String(nameHint ?? "").trim().toLowerCase();
	if (!hint) return "period";
	if (PERIODS.includes(hint)) return hint;
	if (/5\s*h|five\s*hour|5\s*小时|session/.test(hint)) return "5h";
	if (/daily|day|1\s*d|24\s*h|日|天|今日/.test(hint)) return "day";
	if (/weekly|week|7\s*d|周|7\s*天/.test(hint)) return "week";
	if (/monthly|month|30\s*d|月/.test(hint)) return "month";
	if (/rolling|滚动/.test(hint)) return "rolling";
	if (/sub|subscription|套餐/.test(hint)) return "sub";
	return "period";
}
