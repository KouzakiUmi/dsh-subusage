/**
 * ConnectionInstance（连接实例管理与 Recipe 导入导出）：
 * - 支持同一适配器（如 sub2api、litellm、custom-http）实例化多个独立连接；
 * - 秘密值（instanceSecrets）与公开实例配置严格分离，publicInstanceView 永不暴露秘密；
 * - Recipe 导出自动剥离秘密、凭据引用名、私有 Base URL、路由绑定与账户 ID。
 */

import { getDeclarativeRecipe } from "./registry.js";
import { normalizeBaseUrl, normalizeUsagePath, validateNonSecretHeaders } from "../http/request-plan.js";
import { validateAuthConfig, authHeaderNames } from "../credentials/auth-appliers.js";
import { validateLifecycleMode, LIFECYCLE_MODES } from "../credentials/lifecycle.js";
import { normalizeCredentialRefs } from "../credentials/resolver-chain.js";
import { validateCustomMapping } from "../adapters/declarative/custom-http.js";

export const MAX_CUSTOM_INSTANCES = 24;

export function validateInstanceId(id, reservedIds = new Set()) {
	if (typeof id !== "string" || !id.trim()) {
		throw new Error("实例 ID 不能为空");
	}
	const clean = id.trim();
	if (!/^[a-z0-9][a-z0-9._:-]{0,62}$/.test(clean)) {
		throw new Error(`实例 ID「${clean}」格式无效，仅允许小写字母、数字及 ._:- 且长度不超过 63`);
	}
	if (reservedIds instanceof Set && reservedIds.has(clean)) {
		throw new Error(`实例 ID「${clean}」与内置提供商或联动通道重名`);
	}
	return clean;
}

export function validateConnectionInstance(raw, reservedIds = new Set()) {
	if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
		throw new Error("连接实例配置必须是对象");
	}
	const id = validateInstanceId(raw.id, reservedIds);
	const adapterId = typeof raw.adapterId === "string" && raw.adapterId.trim() ? raw.adapterId.trim() : "sub2api";
	const recipe = getDeclarativeRecipe(adapterId);
	if (!recipe) {
		throw new Error(`未知的声明式适配器类型「${adapterId}」`);
	}

	const label = typeof raw.label === "string" && raw.label.trim()
		? raw.label.trim().slice(0, 64)
		: `${recipe.label} (${id})`;
	const enabled = raw.enabled !== false;
	const allowInsecureHttp = raw.allowInsecureHttp === true;
	const baseUrl = normalizeBaseUrl(raw.baseUrl, { allowInsecureHttp });
	const usagePath = normalizeUsagePath(raw.usagePath || recipe.defaultUsagePath);

	const cp = raw.credentialProfile && typeof raw.credentialProfile === "object" && !Array.isArray(raw.credentialProfile)
		? raw.credentialProfile
		: {};
	const rawAuthKind = raw.authKind ?? cp.authKind;
	const authKind = typeof rawAuthKind === "string" && rawAuthKind.trim()
		? rawAuthKind.trim()
		: recipe.defaultAuthKind;
	const rawAuthScheme = raw.authScheme ?? cp.authScheme;
	const authScheme = typeof rawAuthScheme === "string" && rawAuthScheme.trim() ? rawAuthScheme.trim() : undefined;
	const rawCustomHeader = raw.customHeaderName ?? raw.authHeader ?? cp.customHeaderName ?? cp.authHeader;
	const customHeaderName = typeof rawCustomHeader === "string" && rawCustomHeader.trim() ? rawCustomHeader.trim() : undefined;
	validateAuthConfig(authKind, { authScheme, customHeaderName }, recipe.supportedAuthKinds);

	const rawMode = raw.credentialMode ?? cp.credentialMode ?? (cp.manualSecretId ? "manual" : undefined);
	const credentialMode = rawMode === "manual" ? "manual" : "inherit";
	// 凭据生命周期：缺省 read-only（插件不主动刷新/轮换凭据）；显式值按白名单校验。
	const rawLifecycle = raw.lifecycle ?? cp.lifecycle;
	const lifecycle = rawLifecycle === undefined ? "read-only" : validateLifecycleMode(rawLifecycle);
	const credentialRefs = normalizeCredentialRefs(raw.credentialRefs ?? cp.credentialRefs);
	const headers = validateNonSecretHeaders(raw.headers, authHeaderNames(authKind, { customHeaderName }));
	const mapping = validateCustomMapping(raw.mapping);

	let routeIds = [];
	if (raw.routeIds !== undefined) {
		if (!Array.isArray(raw.routeIds) || raw.routeIds.length > 8) {
			throw new Error("实例关联的 routeIds 必须是长度不超过 8 的字符串数组");
		}
		const seen = new Set();
		for (const r of raw.routeIds) {
			if (typeof r !== "string" || !r.trim() || r.trim().length > 64) {
				throw new Error("routeIds 包含无效的路由 ID");
			}
			const trimmed = r.trim();
			if (!seen.has(trimmed)) {
				seen.add(trimmed);
				routeIds.push(trimmed);
			}
		}
	}

	return {
		id,
		adapterId,
		label,
		enabled,
		baseUrl,
		usagePath,
		...(allowInsecureHttp ? { allowInsecureHttp: true } : {}),
		authKind,
		...(authScheme ? { authScheme } : {}),
		...(customHeaderName ? { customHeaderName } : {}),
		credentialMode,
		lifecycle,
		credentialRefs,
		...(Object.keys(headers).length ? { headers } : {}),
		...(Object.keys(mapping).length ? { mapping } : {}),
		...(routeIds.length ? { routeIds } : {})
	};
}

export function publicInstanceView(instance, hasSecret = false) {
	const has = Boolean(hasSecret);
	return {
		id: instance.id,
		adapterId: instance.adapterId,
		label: instance.label,
		enabled: instance.enabled !== false,
		baseUrl: instance.baseUrl,
		usagePath: instance.usagePath,
		...(instance.allowInsecureHttp ? { allowInsecureHttp: true } : {}),
		authKind: instance.authKind,
		...(instance.authScheme ? { authScheme: instance.authScheme } : {}),
		...(instance.customHeaderName ? { customHeaderName: instance.customHeaderName } : {}),
		credentialMode: instance.credentialMode === "manual" && has ? "manual" : "inherit",
		lifecycle: LIFECYCLE_MODES.includes(instance.lifecycle) ? instance.lifecycle : "read-only",
		hasSecret: has,
		credentialRefs: Array.isArray(instance.credentialRefs) ? [...instance.credentialRefs] : [],
		...(instance.headers && Object.keys(instance.headers).length ? { headers: { ...instance.headers } } : {}),
		...(instance.mapping && Object.keys(instance.mapping).length ? { mapping: instance.mapping } : {}),
		...(Array.isArray(instance.routeIds) && instance.routeIds.length ? { routeIds: [...instance.routeIds] } : {})
	};
}

/**
 * 导出可分享的只读 Recipe JSON（严格剥离秘密、凭据引用名、私有 Base URL、路由绑定与账户 ID）。
 */
export function exportInstanceRecipe(instance) {
	if (!instance || typeof instance !== "object") {
		throw new Error("要导出的实例不存在");
	}
	const recipe = getDeclarativeRecipe(instance.adapterId);
	if (!recipe) {
		throw new Error(`适配器「${String(instance.adapterId)}」不支持导出 Recipe`);
	}
	const cleanHeaders = validateNonSecretHeaders(instance.headers,
		authHeaderNames(instance.authKind, { customHeaderName: instance.customHeaderName }));
	const cleanMapping = validateCustomMapping(instance.mapping);
	// 导出时剥离 mappingLock.lockedAt 等会话态时间戳，保留 lockedFields
	return {
		schemaVersion: 1,
		kind: "subusage-adapter-recipe",
		adapterId: instance.adapterId,
		label: instance.label || recipe.label,
		usagePath: instance.usagePath || recipe.defaultUsagePath,
		authKind: instance.authKind || recipe.defaultAuthKind,
		...(instance.authScheme ? { authScheme: instance.authScheme } : {}),
		...(instance.customHeaderName ? { customHeaderName: instance.customHeaderName } : {}),
		...(Object.keys(cleanHeaders).length ? { headers: cleanHeaders } : {}),
		...(Object.keys(cleanMapping).length ? { mapping: cleanMapping } : {})
	};
}

/**
 * 从导入的 Recipe JSON 创建连接实例（拒绝任何夹带秘密或非法字段的导入包）。
 */
export function importInstanceRecipe(rawRecipe, overrides = {}, reservedIds = new Set()) {
	if (!rawRecipe || typeof rawRecipe !== "object" || Array.isArray(rawRecipe)) {
		throw new Error("导入的 Recipe 必须是 JSON 对象");
	}
	if (rawRecipe.schemaVersion !== 1 || rawRecipe.kind !== "subusage-adapter-recipe") {
		throw new Error("Recipe 版本或类型不匹配（需为 schemaVersion: 1, kind: 'subusage-adapter-recipe'）");
	}
	for (const forbidden of ["secret", "apiKey", "password", "token", "cookie", "credentialRefs"]) {
		if (forbidden in rawRecipe) {
			throw new Error(`导入的 Recipe 不得包含敏感或环境绑定字段「${forbidden}」`);
		}
	}
	return validateConnectionInstance({
		id: overrides.id ?? rawRecipe.id,
		adapterId: rawRecipe.adapterId,
		label: overrides.label ?? rawRecipe.label,
		enabled: overrides.enabled ?? true,
		baseUrl: overrides.baseUrl,
		allowInsecureHttp: overrides.allowInsecureHttp === true,
		usagePath: overrides.usagePath ?? rawRecipe.usagePath,
		authKind: overrides.authKind ?? rawRecipe.authKind,
		authScheme: overrides.authScheme ?? rawRecipe.authScheme,
		customHeaderName: overrides.customHeaderName ?? rawRecipe.customHeaderName,
		credentialMode: overrides.credentialMode ?? "inherit",
		credentialRefs: overrides.credentialRefs ?? [],
		headers: overrides.headers ?? rawRecipe.headers,
		mapping: overrides.mapping ?? rawRecipe.mapping,
		routeIds: overrides.routeIds ?? []
	}, reservedIds);
}
