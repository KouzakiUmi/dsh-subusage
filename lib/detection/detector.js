/**
 * 自动探测状态机（4 态：identified / needs-review / auth-required / unsupported）：
 * - 受界候选端点顺序探测（最多 4 个 GET 端点，单次超时 4 秒）；
 * - 401/403 认证失败立即保留为 auth-required，严禁被后续 404 候选掩盖为 unsupported；
 * - 429 限流立即停止后续候选探测并透传 Retry-After；
 * - 探测结果不写入正式额度缓存；
 * - 重新探测时通过 mergeMappingWithLock 保留用户已锁定的字段映射；
 * - 原始预览统一经过 sanitizePreview 深度脱敏。
 */

import { resolveEndpointUrl, normalizeUsagePath, validateNonSecretHeaders } from "../http/request-plan.js";
import { executeReadOnlyRequest } from "../http/executor.js";
import { applyAuthHeaders, validateAuthConfig, authHeaderNames } from "../credentials/auth-appliers.js";
import { getDeclarativeRecipe, recipeNormalizedBaseUrl } from "../platform/registry.js";
import { DEFAULT_CANDIDATE_PATHS, matchKnownRecipeSignature } from "./recipes.js";
import { inferGenericResponse } from "./inference.js";
import { sanitizePreview, sanitizeStringValue } from "./sanitize-preview.js";
import { mergeMappingWithLock, normalizeCustomHttpPayload } from "../adapters/declarative/custom-http.js";
import { normalizeSub2ApiPayload } from "../adapters/declarative/sub2api.js";
import { normalizeLiteLLMPayload } from "../adapters/declarative/litellm.js";
import { normalizeNewApiPayload } from "../adapters/declarative/newapi.js";

export const DETECTION_STATES = ["identified", "needs-review", "auth-required", "unsupported"];

export async function probeConnectionEndpoint(params = {}, runtimeOptions = {}) {
	const {
		baseUrl,
		usagePath,
		adapterId,
		authKind = "bearer",
		authScheme,
		customHeaderName,
		credential,
		headers: customHeaders,
		allowInsecureHttp = false,
		existingMapping = {}
	} = params;

	validateAuthConfig(authKind, { authScheme, customHeaderName });
	const safeHeaders = validateNonSecretHeaders(customHeaders,
		authHeaderNames(authKind, { customHeaderName }));
	const authHeaders = applyAuthHeaders(authKind, credential, { authScheme, customHeaderName });
	const secretKey = typeof credential?.key === "string" && credential.key.trim() ? credential.key.trim() : "";
	const secretHints = secretKey ? [secretKey] : [];
	// 进入探测结果的任何上游字符串都过脱敏：suggestedMapping / explanations / attempts 与预览同口径。
	const clean = value => sanitizePreview(value, { secretHints });
	const cleanString = value => (typeof value === "string" ? sanitizeStringValue(value, secretHints) : value);
	// 适配器声明的站点根归一（newapi 剥末层 /v1 与 /api）：粘贴 OpenAI 兼容根也能探到正确站点；
	// 候选路径优先适配器自己的 candidatePaths（newapi 的 /api/usage/token 不在通用默认里）。
	const probeRecipe = typeof adapterId === "string" && adapterId.trim() ? getDeclarativeRecipe(adapterId.trim()) : undefined;
	const root = recipeNormalizedBaseUrl(probeRecipe, baseUrl);

	const candidatePaths = typeof usagePath === "string" && usagePath.trim()
		? [normalizeUsagePath(usagePath)]
		: Array.isArray(params.candidatePaths) && params.candidatePaths.length
			? params.candidatePaths.slice(0, 4).map(normalizeUsagePath)
			: Array.isArray(probeRecipe?.candidatePaths) && probeRecipe.candidatePaths.length
				? probeRecipe.candidatePaths.slice(0, 4).map(normalizeUsagePath)
				: DEFAULT_CANDIDATE_PATHS.slice(0, 4);

	const attempts = [];
	let firstAuthError = null;
	let lastResponseBody = null;
	let lastResponsePath = null;

	for (const candidatePath of candidatePaths) {
		const targetUrl = resolveEndpointUrl(root, candidatePath, { allowInsecureHttp });
		try {
			const res = await executeReadOnlyRequest(
				{
					method: "GET",
					url: targetUrl,
					headers: { ...safeHeaders, ...authHeaders }
				},
				{
					fetch: runtimeOptions.fetch,
					timeoutMs: runtimeOptions.timeoutMs ?? 4_000,
					now: runtimeOptions.now,
					secretHints
				}
			);
			attempts.push({ path: candidatePath, status: res.status, ok: true });
			lastResponseBody = res.body;
			lastResponsePath = candidatePath;

			// 0. 业务信封错误码（HTTP 200 但 { code: 401 } 或 code/success 显式 false）：按认证失败处理而不是识别成功。
			// New API / one-api 系认证被拒返回 { code: false, message }；generic `code:false` 同样按上游拒绝透传。
			const envCode = res.body && typeof res.body === "object" && !Array.isArray(res.body) ? res.body.code : undefined;
			if (envCode === 401 || envCode === "401" || envCode === 403 || envCode === "403"
				|| (res.body && typeof res.body === "object" && !Array.isArray(res.body) && (res.body.success === false || res.body.code === false))) {
				firstAuthError = {
					path: candidatePath,
					status: typeof envCode === "number" ? envCode : Number(envCode) || res.status,
					message: cleanString(typeof res.body.message === "string" && res.body.message.trim()
						? res.body.message.trim()
						: res.body.success === false || res.body.code === false ? "上游返回失败" : `上游返回错误码 ${String(envCode)}`)
				};
				break;
			}

			// 1. 尝试命中已知 Recipe 签名
			const known = matchKnownRecipeSignature(res.body, candidatePath);
			if (known) {
				// 先合并 mappingLock（用户锁定优先），再用合并后的 mapping 做预览归一化。
				const mergedMapping = known.suggestedMapping
					? mergeMappingWithLock(existingMapping, known.suggestedMapping)
					: existingMapping;
				let normalizedPreview = null;
				let normalizeFailed = false;
				try {
					if (known.adapterId === "sub2api") normalizedPreview = normalizeSub2ApiPayload(res.body, { now: runtimeOptions.now });
					else if (known.adapterId === "litellm") normalizedPreview = normalizeLiteLLMPayload(res.body, { now: runtimeOptions.now });
					else if (known.adapterId === "newapi") normalizedPreview = normalizeNewApiPayload(res.body, { now: runtimeOptions.now });
					else if (known.suggestedMapping || Object.keys(mergedMapping).length) normalizedPreview = normalizeCustomHttpPayload(res.body, mergedMapping);
				} catch {
					normalizeFailed = true;
				}
				if (normalizeFailed) {
					// 签名命中但归一化失败：降级为 needs-review，交给用户确认而不是盲信配方。
					return {
						status: "needs-review",
						adapterId: known.adapterId,
						recipeId: known.recipeId,
						confidence: "medium",
						requiresConfirmation: true,
						usagePath: candidatePath,
						reason: `命中 ${known.recipeId} 结构但归一化失败，请人工核对字段映射`,
						suggestedMapping: clean(mergedMapping),
						conflicts: [],
						explanations: [known.reason, "归一化失败"],
						rawPreview: clean(res.body),
						attempts
					};
				}

				return {
					status: "identified",
					adapterId: known.adapterId,
					recipeId: known.recipeId,
					confidence: "high",
					requiresConfirmation: false,
					usagePath: candidatePath,
					reason: known.reason,
					suggestedMapping: clean(mergedMapping),
					conflicts: [],
					explanations: [cleanString(known.reason)],
					rawPreview: clean(res.body),
					...(normalizedPreview ? { normalizedPreview: clean(normalizedPreview) } : {}),
					attempts
				};
			}

			// 2. 尝试通用结构化推断
			const inferred = inferGenericResponse(res.body, { secretHints });
			const mergedMapping = mergeMappingWithLock(existingMapping, inferred.suggestedMapping);
			if (inferred.matched || Object.keys(mergedMapping).some(k => k !== "mappingLock")) {
				let normalizedPreview = null;
				try {
					normalizedPreview = normalizeCustomHttpPayload(res.body, mergedMapping);
				} catch {
					normalizedPreview = null;
				}
				return {
					status: "needs-review",
					adapterId: "custom-http",
					confidence: inferred.confidence,
					requiresConfirmation: true,
					usagePath: candidatePath,
					reason: inferred.conflicts.length
						? `已提取候选字段映射，但存在 ${inferred.conflicts.length} 项语义待确认`
						: "已通过结构化推断生成候选映射，请确认后保存",
					suggestedMapping: clean(mergedMapping),
					conflicts: clean(inferred.conflicts),
					explanations: clean(inferred.explanations),
					candidatePointers: inferred.candidatePointers,
					rawPreview: clean(res.body),
					...(normalizedPreview ? { normalizedPreview: clean(normalizedPreview) } : {}),
					attempts
				};
			}
		} catch (err) {
			const httpStatus = err?.status ?? 0;
			attempts.push({
				path: candidatePath,
				status: httpStatus,
				ok: false,
				errorCode: err?.code ?? "subusage/error",
				message: cleanString(err?.message ?? "请求失败")
			});

			// 关键规则：401/403 认证失败立即中断候选探测，绝不能被后续候选的 404 覆盖为 unsupported
			if (err?.code === "subusage/auth" || httpStatus === 401 || httpStatus === 403) {
				firstAuthError = {
					path: candidatePath,
					status: httpStatus,
					message: cleanString(err.message)
				};
				break;
			}

			// 429 限流立即停止探测后续候选
			if (err?.code === "subusage/rate-limit" || httpStatus === 429) {
				return {
					status: "unsupported",
					errorCode: "subusage/rate-limit",
					usagePath: candidatePath,
					reason: cleanString(err.message),
					...(err.retryAfterMs !== undefined ? { retryAfterMs: err.retryAfterMs } : {}),
					requiresConfirmation: true,
					attempts
				};
			}

			// 跨源重定向被拦截立即返回
			if (err?.code === "subusage/redirect-blocked") {
				return {
					status: "unsupported",
					errorCode: "subusage/redirect-blocked",
					usagePath: candidatePath,
					reason: cleanString(err.message),
					requiresConfirmation: true,
					attempts
				};
			}
		}
	}

	if (firstAuthError) {
		return {
			status: "auth-required",
			usagePath: firstAuthError.path,
			httpStatus: firstAuthError.status,
			reason: firstAuthError.message,
			requiresConfirmation: false,
			attempts
		};
	}

	if (lastResponseBody) {
		const fallbackInferred = inferGenericResponse(lastResponseBody);
		return {
			status: "unsupported",
			adapterId: "custom-http",
			usagePath: lastResponsePath,
			reason: "端点返回了 JSON，但未识别出已知网关结构或标准配额字段，您可以手动指定 JSON Pointer 映射",
			requiresConfirmation: true,
			suggestedMapping: mergeMappingWithLock(existingMapping, {}),
			conflicts: fallbackInferred.conflicts,
			candidatePointers: fallbackInferred.candidatePointers,
			rawPreview: sanitizePreview(lastResponseBody, { secretHints }),
			attempts
		};
	}

	return {
		status: "unsupported",
		reason: attempts.length
			? `候选端点均不可用（${attempts.map(a => `${a.path}: ${a.status || a.errorCode}`).join("，")}）`
			: "未找到可用的只读额度端点",
		requiresConfirmation: true,
		attempts
	};
}
