/**
 * 声明式连接实例运行时（Platform Runtime）：
 * - 负责 ConnectionInstance 的凭据解析、HTTP 执行、响应归一化、多 Key 监控（keyAccounts）与 DisplayProfile 应用；
 * - 与 SubUsageService 的缓存、指纹、代次保护及临时失败回退（retainPrevious）无缝协同。
 */

import { canonicalizeEntry } from "../quota-entry.js";
import { getDeclarativeRecipe } from "./registry.js";
import { resolveCredentialChain } from "../credentials/resolver-chain.js";
import { applyAuthHeaders, authHeaderNames } from "../credentials/auth-appliers.js";
import { resolveEndpointUrl, validateNonSecretHeaders } from "../http/request-plan.js";
import { executeReadOnlyRequest } from "../http/executor.js";
import { applyDisplayProfile } from "./display-profile.js";

export function instanceFingerprintPayload(instance, identity) {
	return [
		instance.id,
		instance.adapterId,
		instance.baseUrl,
		instance.usagePath,
		instance.authKind,
		instance.authScheme ?? "",
		instance.customHeaderName ?? "",
		instance.headers ?? null,
		instance.mapping ?? null,
		identity.key ?? "",
		identity.source ?? "none",
		identity.ref ?? ""
	];
}

export async function resolveInstanceIdentity(instance, settings, runtimeDeps = {}, targetRef = "") {
	const recipe = getDeclarativeRecipe(instance.adapterId);
	// S3：自定义实例是用户配置的连接，绝不吃 routeEnvs——把别的路由的 apiKeyEnv
	// 注入实例链会让「实例被绑给任意路由」偷来不属于自己的凭据。routeBindings 只决定
	// 药丸归属，不改变实例用什么 Key。解析链：credentialRefs → builtinEnvs → 手动秘密。
	return resolveCredentialChain(
		{
			authKind: instance.authKind,
			mode: instance.credentialMode,
			manualSecret: settings?.instanceSecrets?.[instance.id] ?? "",
			credentialRefs: instance.credentialRefs ?? [],
			builtinEnvs: recipe?.builtinEnvs ?? [],
			targetRef
		},
		{
			resolveCredentialByName: runtimeDeps.resolveCredentialByName,
			resolveEnvironment: runtimeDeps.resolveEnvironment
		}
	);
}

export async function fetchDeclarativeInstanceData(instance, identity, runtimeDeps = {}) {
	const recipe = getDeclarativeRecipe(instance.adapterId);
	if (!recipe) {
		const err = new Error(`未知适配器「${instance.adapterId}」`);
		err.code = "subusage/config";
		throw err;
	}
	// 适配器可声明 dropsTrailingV1（LiteLLM）：其管理端点不在 OpenAI 兼容 /v1 之下。
	const url = resolveEndpointUrl(
		recipe.dropsTrailingV1 === true && /\/v1\/?$/.test(String(instance.baseUrl ?? "").replace(/\/+$/, ""))
			? String(instance.baseUrl).replace(/\/+$/, "").replace(/\/v1$/i, "")
			: instance.baseUrl,
		instance.usagePath,
		{ allowInsecureHttp: instance.allowInsecureHttp === true }
	);
	const safeHeaders = validateNonSecretHeaders(instance.headers,
		authHeaderNames(instance.authKind, { customHeaderName: instance.customHeaderName }));
	const authHeaders = applyAuthHeaders(instance.authKind, identity, {
		authScheme: instance.authScheme,
		customHeaderName: instance.customHeaderName
	});

	const res = await executeReadOnlyRequest(
		{
			method: "GET",
			url,
			headers: { ...safeHeaders, ...authHeaders }
		},
		{
			fetch: runtimeDeps.fetch,
			timeoutMs: runtimeDeps.timeoutMs ?? 15_000,
			now: runtimeDeps.now,
			secretHints: [identity?.key].filter(k => typeof k === "string" && k.trim())
		}
	);

	return recipe.normalize(res.body, {
		mapping: instance.mapping ?? {},
		now: runtimeDeps.now,
		keyId: identity.ref || "primary"
	});
}

export function buildInstanceBaseEntry(instance, identity, nowMs = Date.now()) {
	const recipe = getDeclarativeRecipe(instance.adapterId);
	const envName = instance.credentialRefs?.[0] ?? recipe?.builtinEnvs?.[0] ?? "CUSTOM_API_KEY";
	return {
		providerId: instance.id,
		label: instance.label,
		providerName: instance.label,
		adapterId: instance.adapterId,
		envName,
		keySource: identity.source ?? "none",
		...(identity.ref ? { keyRef: identity.ref } : {}),
		apiDetected: identity.source === "none" && instance.authKind !== "none" ? null : true,
		coverage: "partial",
		freshness: "unknown",
		lastSuccessAt: null,
		lastAttemptAt: new Date(nowMs).toISOString(),
		retryable: false,
		retainPrevious: false
	};
}

export function finalizeInstanceEntry(entry, instance, settings) {
	const profile = settings?.displayProfiles?.[instance.id];
	const withMeta = {
		...entry,
		label: instance.label,
		providerName: instance.label,
		ok: entry.state === "ok"
	};
	const canonical = canonicalizeEntry(withMeta);
	return profile ? applyDisplayProfile(canonical, profile) : canonical;
}

export function resolveCustomInstanceIds(names, instances) {
	const list = Array.isArray(instances) ? instances : [];
	const norm = raw => String(raw ?? "").trim().toLowerCase().replace(/[\s_.]+/g, "-");
	const matched = [];
	const unknown = [];
	for (const name of Array.isArray(names) ? names : []) {
		const key = norm(name);
		const hits = list.filter(inst => inst && (inst.id === name || norm(inst.id) === key || norm(inst.adapterId) === key));
		if (hits.length) {
			for (const h of hits) if (!matched.includes(h.id)) matched.push(h.id);
		} else {
			unknown.push(name);
		}
	}
	return { matched, unknown };
}
