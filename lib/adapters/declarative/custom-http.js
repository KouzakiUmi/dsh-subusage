/**
 * 通用声明式自定义 HTTP 适配器（custom-http）：
 * - 基于 RFC 6901 JSON Pointer 与白名单转换器将任意 JSON 映射为标准 QuotaEntry；
 * - 支持 mappingLock 锁定已确认字段，重新探测时保留锁定项；
 * - 严禁 eval / new Function。
 */

import { canonicalizeEntry, SUBJECT_KINDS, AGGREGATION_MODES, POOL_SCOPES, PERIODS, AMOUNT_ROLES, PACKAGE_ROLES } from "../../quota-entry.js";
import { isValidPointer, getByPointer } from "../../http/json-pointer.js";
import { toNumber, scale, usedRatio, remainingRatio, limitMinusUsed, timestamp, unitMap, windowPeriodFromHint } from "../../http/transforms.js";
import { unwrapEnvelope } from "../../http/request-plan.js";

export const CUSTOM_HTTP_RECIPE = Object.freeze({
	id: "custom-http",
	kind: "declarative-http",
	label: "自定义 HTTP 接口",
	defaultUsagePath: "/v1/usage",
	candidatePaths: ["/v1/usage", "/api/v1/usage", "/key/info", "/v1/dashboard/billing/credit_grants", "/user/balance"],
	defaultAuthKind: "bearer",
	supportedAuthKinds: ["bearer", "raw-authorization", "scheme-authorization", "x-api-key", "custom-header", "cookie", "none"],
	builtinEnvs: [],
	capabilities: {
		supportsCustomBaseUrl: true,
		supportsMultiKey: true,
		supportsRouteBinding: true,
		supportsDisplayProfile: true,
		supportsRecipeExport: true
	}
});

const POINTER_FIELD_NAMES = [
	"planPointer",
	"balancePointer",
	"usedPointer",
	"limitPointer",
	"remainingPointer",
	"percentPointer",
	"resetAtPointer",
	"expiresAtPointer",
	"spendPointer",
	"todaySpendPointer",
	"totalSpendPointer",
	"unitPointer",
	"windowsArrayPointer",
	"packagesArrayPointer"
];

function assertOptionalPointer(ptr, fieldName) {
	if (ptr === undefined || ptr === null || ptr === "") return undefined;
	if (typeof ptr !== "string" || !isValidPointer(ptr)) {
		throw new Error(`映射字段「${fieldName}」不是合法的 RFC 6901 JSON Pointer：${String(ptr)}`);
	}
	return ptr;
}

export function validateCustomMapping(raw) {
	if (raw === undefined || raw === null) return {};
	if (typeof raw !== "object" || Array.isArray(raw)) {
		throw new Error("字段映射配置（mapping）必须是对象");
	}
	const out = {};
	if (raw.envelope === "none" || raw.envelope === "auto") out.envelope = raw.envelope;
	if (typeof raw.unit === "string" && raw.unit.trim()) out.unit = raw.unit.trim().slice(0, 32);
	if (raw.scale !== undefined) {
		const s = toNumber(raw.scale);
		if (s === undefined || s <= 0) throw new Error("mapping.scale 必须是大于 0 的有限数字");
		out.scale = s;
	}

	for (const key of POINTER_FIELD_NAMES) {
		const ptr = assertOptionalPointer(raw[key], key);
		if (ptr !== undefined) out[key] = ptr;
	}

	if (typeof raw.balanceLabel === "string" && raw.balanceLabel.trim()) out.balanceLabel = raw.balanceLabel.trim().slice(0, 48);
	if (raw.balanceRole !== undefined) {
		if (!AMOUNT_ROLES.includes(raw.balanceRole)) throw new Error(`未知 balanceRole「${String(raw.balanceRole)}」`);
		out.balanceRole = raw.balanceRole;
	}
	if (raw.balanceSubjectKind !== undefined) {
		if (!SUBJECT_KINDS.includes(raw.balanceSubjectKind)) throw new Error(`未知 balanceSubjectKind「${String(raw.balanceSubjectKind)}」`);
		out.balanceSubjectKind = raw.balanceSubjectKind;
	}
	if (raw.balanceAggregation !== undefined) {
		if (!AGGREGATION_MODES.includes(raw.balanceAggregation)) throw new Error(`未知 balanceAggregation「${String(raw.balanceAggregation)}」`);
		out.balanceAggregation = raw.balanceAggregation;
	}

	if (typeof raw.windowLabel === "string" && raw.windowLabel.trim()) out.windowLabel = raw.windowLabel.trim().slice(0, 48);
	if (raw.windowPeriod !== undefined) {
		if (!PERIODS.includes(raw.windowPeriod)) throw new Error(`未知 windowPeriod「${String(raw.windowPeriod)}」`);
		out.windowPeriod = raw.windowPeriod;
	}
	if (raw.percentSemantics !== undefined) {
		const validSemantics = ["used", "remaining", "fraction-used", "fraction-remaining"];
		if (!validSemantics.includes(raw.percentSemantics)) {
			throw new Error(`未知 percentSemantics「${String(raw.percentSemantics)}」`);
		}
		out.percentSemantics = raw.percentSemantics;
	}
	if (typeof raw.pool === "string" && raw.pool.trim()) out.pool = raw.pool.trim().slice(0, 48);
	if (raw.poolScope !== undefined) {
		if (!POOL_SCOPES.includes(raw.poolScope)) throw new Error(`未知 poolScope「${String(raw.poolScope)}」`);
		out.poolScope = raw.poolScope;
	}

	// 多余额规则数组
	if (Array.isArray(raw.balances)) {
		if (raw.balances.length > 8) throw new Error("mapping.balances 最多配置 8 项");
		out.balances = raw.balances.map((item, idx) => {
			if (!item || typeof item !== "object") throw new Error(`balances[${idx}] 必须是对象`);
			const pointer = assertOptionalPointer(item.pointer, `balances[${idx}].pointer`);
			if (!pointer) throw new Error(`balances[${idx}].pointer 不能为空`);
			const rule = {
				id: typeof item.id === "string" && item.id.trim() ? item.id.trim() : `balance-${idx}`,
				pointer
			};
			if (typeof item.label === "string" && item.label.trim()) rule.label = item.label.trim();
			if (item.role && AMOUNT_ROLES.includes(item.role)) rule.role = item.role;
			if (typeof item.unit === "string" && item.unit.trim()) rule.unit = item.unit.trim();
			if (item.subjectKind && SUBJECT_KINDS.includes(item.subjectKind)) rule.subjectKind = item.subjectKind;
			if (item.aggregationBalance && AGGREGATION_MODES.includes(item.aggregationBalance)) rule.aggregationBalance = item.aggregationBalance;
			return rule;
		});
	}

	// 多窗口规则数组
	if (Array.isArray(raw.windows)) {
		if (raw.windows.length > 8) throw new Error("mapping.windows 最多配置 8 项");
		out.windows = raw.windows.map((item, idx) => {
			if (!item || typeof item !== "object") throw new Error(`windows[${idx}] 必须是对象`);
			const rule = {
				id: typeof item.id === "string" && item.id.trim() ? item.id.trim() : `window-${idx}`
			};
			if (typeof item.label === "string" && item.label.trim()) rule.label = item.label.trim();
			if (item.period && PERIODS.includes(item.period)) rule.period = item.period;
			for (const pKey of ["usedPointer", "limitPointer", "remainingPointer", "percentPointer", "resetAtPointer"]) {
				const ptr = assertOptionalPointer(item[pKey], `windows[${idx}].${pKey}`);
				if (ptr !== undefined) rule[pKey] = ptr;
			}
			if (item.percentSemantics && ["used", "remaining", "fraction-used", "fraction-remaining"].includes(item.percentSemantics)) {
				rule.percentSemantics = item.percentSemantics;
			}
			if (typeof item.unit === "string" && item.unit.trim()) rule.unit = item.unit.trim();
			if (typeof item.pool === "string" && item.pool.trim()) rule.pool = item.pool.trim();
			if (item.poolScope && POOL_SCOPES.includes(item.poolScope)) rule.poolScope = item.poolScope;
			if (item.subjectKind && SUBJECT_KINDS.includes(item.subjectKind)) rule.subjectKind = item.subjectKind;
			return rule;
		});
	}

	// 数组型窗口规则（如 /rate_limits）
	if (raw.windowsArrayItem && typeof raw.windowsArrayItem === "object") {
		const itemSpec = {};
		for (const pKey of ["namePointer", "usedPointer", "limitPointer", "remainingPointer", "percentPointer", "resetAtPointer", "periodPointer", "unitPointer"]) {
			const ptr = assertOptionalPointer(raw.windowsArrayItem[pKey], `windowsArrayItem.${pKey}`);
			if (ptr !== undefined) itemSpec[pKey] = ptr;
		}
		if (raw.windowsArrayItem.poolScope && POOL_SCOPES.includes(raw.windowsArrayItem.poolScope)) {
			itemSpec.poolScope = raw.windowsArrayItem.poolScope;
		}
		out.windowsArrayItem = itemSpec;
	}

	// 数组型额度包规则（如 /packages）
	if (raw.packagesArrayItem && typeof raw.packagesArrayItem === "object") {
		const itemSpec = {};
		for (const pKey of ["labelPointer", "remainingPointer", "amountPointer", "expiresAtPointer", "unitPointer"]) {
			const ptr = assertOptionalPointer(raw.packagesArrayItem[pKey], `packagesArrayItem.${pKey}`);
			if (ptr !== undefined) itemSpec[pKey] = ptr;
		}
		if (raw.packagesArrayItem.role && PACKAGE_ROLES.includes(raw.packagesArrayItem.role)) {
			itemSpec.role = raw.packagesArrayItem.role;
		}
		out.packagesArrayItem = itemSpec;
	}

	if (Array.isArray(raw.mappingLock)) {
		const lockedFields = raw.mappingLock.filter(f => typeof f === "string" && f.trim()).map(f => f.trim());
		out.mappingLock = { lockedFields: [...new Set(lockedFields)] };
	} else if (raw.mappingLock && typeof raw.mappingLock === "object") {
		const lockedFields = Array.isArray(raw.mappingLock.lockedFields)
			? raw.mappingLock.lockedFields.filter(f => typeof f === "string" && f.trim()).map(f => f.trim())
			: [];
		out.mappingLock = {
			lockedFields: [...new Set(lockedFields)],
			...(typeof raw.mappingLock.lockedAt === "string" && raw.mappingLock.lockedAt.trim() ? { lockedAt: raw.mappingLock.lockedAt.trim() } : {})
		};
	}

	return out;
}

/**
 * 重新探测时合并映射配置：保留 mappingLock.lockedFields 中已由用户确认锁定的字段。
 */
export function mergeMappingWithLock(currentMapping = {}, inferredMapping = {}) {
	const a = validateCustomMapping(currentMapping);
	const b = validateCustomMapping(inferredMapping);
	const [cur, inf] = !a.mappingLock && b.mappingLock ? [b, a] : [a, b];
	const locked = new Set(cur.mappingLock?.lockedFields ?? []);
	if (!locked.size) {
		return {
			...inf,
			...(cur.mappingLock ? { mappingLock: cur.mappingLock } : {})
		};
	}
	const merged = { ...inf };
	for (const field of locked) {
		if (field in cur) {
			merged[field] = cur[field];
		} else {
			delete merged[field];
		}
	}
	merged.mappingLock = cur.mappingLock;
	return merged;
}

function readPointerSmart(rawBody, unwrapped, pointer) {
	if (!pointer) return undefined;
	if (pointer.startsWith("/data/") || pointer === "/data") {
		const fromRaw = getByPointer(rawBody, pointer);
		if (fromRaw !== undefined) return fromRaw;
	}
	const fromUnwrapped = getByPointer(unwrapped, pointer);
	if (fromUnwrapped !== undefined) return fromUnwrapped;
	return getByPointer(rawBody, pointer);
}

function computeWindowFromRule(rawBody, unwrapped, rule, defaultUnit, scaleFactor, order) {
	const rawUsed = readPointerSmart(rawBody, unwrapped, rule.usedPointer);
	const rawLimit = readPointerSmart(rawBody, unwrapped, rule.limitPointer);
	const rawRem = readPointerSmart(rawBody, unwrapped, rule.remainingPointer);
	const rawPct = readPointerSmart(rawBody, unwrapped, rule.percentPointer);

	const used = scaleFactor !== 1 ? scale(rawUsed, scaleFactor) : toNumber(rawUsed);
	const limit = scaleFactor !== 1 ? scale(rawLimit, scaleFactor) : toNumber(rawLimit);
	const rem = scaleFactor !== 1 ? scale(rawRem, scaleFactor) : toNumber(rawRem);
	const pctNum = toNumber(rawPct);

	let percent;
	const semantics = rule.percentSemantics ?? "used";
	if (pctNum !== undefined) {
		if (semantics === "remaining") percent = Math.max(0, Math.min(100, Math.round((100 - pctNum) * 100) / 100));
		else if (semantics === "fraction-used") percent = Math.max(0, Math.min(100, Math.round(pctNum * 10000) / 100));
		else if (semantics === "fraction-remaining") percent = Math.max(0, Math.min(100, Math.round((1 - pctNum) * 10000) / 100));
		else percent = Math.max(0, Math.min(100, Math.round(pctNum * 100) / 100));
	} else if (limit !== undefined && limit > 0) {
		if (used !== undefined) percent = usedRatio(used, limit);
		else if (rem !== undefined) percent = remainingRatio(rem, limit);
	}

	if (percent === undefined) return undefined;
	const actualUsed = used !== undefined ? used : (limit !== undefined && rem !== undefined ? limitMinusUsed(limit, rem) : undefined);
	const actualLeft = rem !== undefined ? Math.max(0, rem) : (limit !== undefined && used !== undefined ? limitMinusUsed(limit, used) : undefined);
	const uMap = unitMap(rule.unit || defaultUnit);
	const resetsAt = timestamp(readPointerSmart(rawBody, unwrapped, rule.resetAtPointer));
	const exhausted = percent >= 100 || (actualLeft !== undefined && actualLeft <= 0);

	return {
		type: "window",
		id: rule.id || `window-${order}`,
		...(rule.label ? { label: rule.label } : {}),
		order,
		period: rule.period || "period",
		percent,
		...(actualUsed !== undefined ? {
			used: actualUsed,
			amount: {
				value: actualUsed,
				...(uMap ? uMap : {})
			}
		} : {}),
		...(limit !== undefined && limit > 0 ? { limit } : {}),
		...(actualLeft !== undefined ? { left: actualLeft } : {}),
		...(resetsAt ? { resetsAt } : {}),
		...(exhausted ? { status: "rate-limited" } : {}),
		...(rule.pool ? { pool: rule.pool, poolLabel: rule.pool } : {}),
		...(rule.poolScope === "independent" ? { poolScope: "independent" } : {}),
		...(rule.subjectKind ? { subject: { kind: rule.subjectKind } } : {})
	};
}

export function normalizeCustomHttpPayload(rawBody, rawMapping = {}) {
	const mapping = validateCustomMapping(rawMapping);
	const unwrapped = unwrapEnvelope(rawBody, { envelope: mapping.envelope ?? "auto" });
	const scaleFactor = mapping.scale ?? 1;
	const dynamicUnit = mapping.unitPointer ? readPointerSmart(rawBody, unwrapped, mapping.unitPointer) : undefined;
	const defaultUnit = (typeof dynamicUnit === "string" && dynamicUnit.trim() ? dynamicUnit.trim() : mapping.unit) ?? "";

	const quotas = [];
	let order = 0;

	// 1. 套餐徽标（planPointer）
	if (mapping.planPointer) {
		const planVal = readPointerSmart(rawBody, unwrapped, mapping.planPointer);
		if (typeof planVal === "string" && planVal.trim()) {
			quotas.push({
				type: "plan",
				id: "plan",
				order: order++,
				value: planVal.trim()
			});
		}
	}

	// 2. 单窗口映射或多窗口映射
	if (mapping.usedPointer || mapping.limitPointer || mapping.percentPointer || (mapping.remainingPointer && mapping.limitPointer)) {
		const win = computeWindowFromRule(rawBody, unwrapped, {
			id: "primary-window",
			label: mapping.windowLabel,
			period: mapping.windowPeriod ?? "period",
			usedPointer: mapping.usedPointer,
			limitPointer: mapping.limitPointer,
			remainingPointer: mapping.remainingPointer,
			percentPointer: mapping.percentPointer,
			percentSemantics: mapping.percentSemantics,
			resetAtPointer: mapping.resetAtPointer,
			unit: defaultUnit,
			pool: mapping.pool,
			poolScope: mapping.poolScope
		}, defaultUnit, scaleFactor, order);
		if (win) {
			quotas.push(win);
			order++;
		}
	}

	if (Array.isArray(mapping.windows)) {
		for (const wRule of mapping.windows) {
			const win = computeWindowFromRule(rawBody, unwrapped, wRule, defaultUnit, scaleFactor, order);
			if (win) {
				quotas.push(win);
				order++;
			}
		}
	}

	// 3. 数组型窗口（windowsArrayPointer）
	if (mapping.windowsArrayPointer) {
		const arr = readPointerSmart(rawBody, unwrapped, mapping.windowsArrayPointer);
		if (Array.isArray(arr)) {
			const itemSpec = mapping.windowsArrayItem ?? {};
			arr.slice(0, 8).forEach((row, idx) => {
				if (!row || typeof row !== "object") return;
				const rawName = itemSpec.namePointer ? getByPointer(row, itemSpec.namePointer) : (row.name ?? row.label ?? row.period);
				const rawPeriod = itemSpec.periodPointer ? getByPointer(row, itemSpec.periodPointer) : (row.period ?? row.window ?? rawName);
				const rowUnit = itemSpec.unitPointer ? getByPointer(row, itemSpec.unitPointer) : (row.unit ?? defaultUnit);
				const win = computeWindowFromRule(row, row, {
					id: `arr-window-${idx}`,
					label: typeof rawName === "string" && rawName.trim() ? rawName.trim() : `窗口 ${idx + 1}`,
					period: windowPeriodFromHint(row.window_seconds, rawPeriod),
					usedPointer: itemSpec.usedPointer ?? "/used",
					limitPointer: itemSpec.limitPointer ?? "/limit",
					remainingPointer: itemSpec.remainingPointer ?? "/remaining",
					percentPointer: itemSpec.percentPointer ?? "/percent",
					resetAtPointer: itemSpec.resetAtPointer ?? "/reset_at",
					unit: typeof rowUnit === "string" ? rowUnit : defaultUnit,
					pool: typeof rawName === "string" && itemSpec.poolScope === "independent" ? rawName.trim() : undefined,
					poolScope: itemSpec.poolScope
				}, defaultUnit, scaleFactor, order);
				if (win) {
					quotas.push(win);
					order++;
				}
			});
		}
	}

	// 4. 余额映射（balancePointer 或 remainingPointer 单纯余额，以及 balances 数组）
	const singleBalancePtr = mapping.balancePointer || (!mapping.limitPointer && !mapping.usedPointer && !mapping.percentPointer ? mapping.remainingPointer : undefined);
	if (singleBalancePtr) {
		const rawVal = readPointerSmart(rawBody, unwrapped, singleBalancePtr);
		const val = scaleFactor !== 1 ? scale(rawVal, scaleFactor) : toNumber(rawVal);
		if (val !== undefined) {
			const uMap = unitMap(defaultUnit);
			const role = mapping.balanceRole ?? "balance";
			const subjectKind = mapping.balanceSubjectKind ?? "key";
			// 未知端点不能默认可加：shared-wallet 语义只有用户能确认，缺省一律 forbid。
			const aggMode = mapping.balanceAggregation ?? "forbid";
			quotas.push({
				type: "amount",
				id: "primary-balance",
				...(mapping.balanceLabel ? { label: mapping.balanceLabel } : {}),
				order: order++,
				role,
				amount: {
					value: val,
					...(uMap ? uMap : {})
				},
				subject: { kind: subjectKind },
				aggregation: { balance: aggMode, ...(aggMode === "forbid" ? { reason: "shared-owner" } : {}) }
			});
		}
	}

	if (Array.isArray(mapping.balances)) {
		for (const bRule of mapping.balances) {
			const rawVal = readPointerSmart(rawBody, unwrapped, bRule.pointer);
			const val = scaleFactor !== 1 ? scale(rawVal, scaleFactor) : toNumber(rawVal);
			if (val !== undefined) {
				const uMap = unitMap(bRule.unit || defaultUnit);
				const subjectKind = bRule.subjectKind ?? "key";
				const aggMode = bRule.aggregationBalance ?? "forbid";
				quotas.push({
					type: "amount",
					id: bRule.id,
					...(bRule.label ? { label: bRule.label } : {}),
					order: order++,
					role: bRule.role ?? "balance",
					amount: {
						value: val,
						...(uMap ? uMap : {})
					},
					subject: { kind: subjectKind },
					aggregation: { balance: aggMode, ...(aggMode === "forbid" ? { reason: "shared-owner" } : {}) }
				});
			}
		}
	}

	// 5. 数组型额度包（packagesArrayPointer）
	if (mapping.packagesArrayPointer) {
		const arr = readPointerSmart(rawBody, unwrapped, mapping.packagesArrayPointer);
		if (Array.isArray(arr)) {
			const itemSpec = mapping.packagesArrayItem ?? {};
			arr.slice(0, 12).forEach((pkg, idx) => {
				if (!pkg || typeof pkg !== "object") return;
				const label = itemSpec.labelPointer ? getByPointer(pkg, itemSpec.labelPointer) : (pkg.name ?? pkg.label ?? pkg.title);
				const remVal = toNumber(itemSpec.remainingPointer ? getByPointer(pkg, itemSpec.remainingPointer) : (pkg.remaining ?? pkg.left));
				const amtVal = toNumber(itemSpec.amountPointer ? getByPointer(pkg, itemSpec.amountPointer) : (pkg.amount ?? pkg.total ?? pkg.limit));
				if (remVal === undefined && amtVal === undefined) return;
				const pkgUnit = itemSpec.unitPointer ? getByPointer(pkg, itemSpec.unitPointer) : (pkg.unit ?? defaultUnit);
				const uMap = unitMap(typeof pkgUnit === "string" ? pkgUnit : defaultUnit);
				const expiresAt = timestamp(itemSpec.expiresAtPointer ? getByPointer(pkg, itemSpec.expiresAtPointer) : (pkg.expires_at ?? pkg.expiresAt));
				quotas.push({
					type: "package",
					id: `pkg-${idx}`,
					...(typeof label === "string" && label.trim() ? { label: label.trim() } : {}),
					order: order++,
					role: itemSpec.role ?? "temporary",
					...(amtVal !== undefined ? { amount: { value: amtVal, ...(uMap ? uMap : {}) } } : {}),
					...(remVal !== undefined ? { remaining: { value: remVal, ...(uMap ? uMap : {}) } } : {}),
					...(expiresAt ? { expiresAt } : {})
				});
			});
		}
	}

	// 6. 花费指标（spendPointer / todaySpendPointer / totalSpendPointer）
	const spendRules = [
		{ ptr: mapping.todaySpendPointer, id: "spend-today", label: "今日花费" },
		{ ptr: mapping.totalSpendPointer, id: "spend-total", label: "累计花费" },
		{ ptr: mapping.spendPointer, id: "spend", label: "花费" }
	];
	for (const sRule of spendRules) {
		if (!sRule.ptr) continue;
		const rawVal = readPointerSmart(rawBody, unwrapped, sRule.ptr);
		const val = scaleFactor !== 1 ? scale(rawVal, scaleFactor) : toNumber(rawVal);
		if (val !== undefined) {
			const uMap = unitMap(defaultUnit);
			quotas.push({
				type: "amount",
				id: sRule.id,
				label: sRule.label,
				order: order++,
				role: "spend",
				amount: { value: val, ...(uMap ? uMap : {}) }
			});
		}
	}

	// 7. 到期时间说明（expiresAtPointer：只产 note，不写 resetsAt）
	if (mapping.expiresAtPointer) {
		const expiresIso = timestamp(readPointerSmart(rawBody, unwrapped, mapping.expiresAtPointer));
		if (expiresIso) {
			quotas.push({
				type: "note",
				id: "expires-at",
				order: order++,
				role: "note",
				text: `到期时间 ${expiresIso.slice(0, 10)}`
			});
		}
	}

	if (!quotas.length) {
		const err = new Error("根据当前 JSON Pointer 映射未能提取到任何有效额度元素");
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
