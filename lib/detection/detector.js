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
import { applyAuthHeaders, validateAuthConfig } from "../credentials/auth-appliers.js";
import { DEFAULT_CANDIDATE_PATHS, matchKnownRecipeSignature } from "./recipes.js";
import { inferGenericResponse } from "./inference.js";
import { sanitizePreview } from "./sanitize-preview.js";
import { mergeMappingWithLock, normalizeCustomHttpPayload } from "../adapters/declarative/custom-http.js";
import { normalizeSub2ApiPayload } from "../adapters/declarative/sub2api.js";
import { normalizeLiteLLMPayload } from "../adapters/declarative/litellm.js";

export const DETECTION_STATES = ["identified", "needs-review", "auth-required", "unsupported"];

export async function probeConnectionEndpoint(params = {}, runtimeOptions = {}) {
	const {
		baseUrl,
		usagePath,
		authKind = "bearer",
		authScheme,
		customHeaderName,
		credential,
		headers: customHeaders,
		allowInsecureHttp = false,
		existingMapping = {}
	} = params;

	validateAuthConfig(authKind, { authScheme, customHeaderName });
	const safeHeaders = validateNonSecretHeaders(customHeaders);
	const authHeaders = applyAuthHeaders(authKind, credential, { authScheme, customHeaderName });
	const secretKey = typeof credential?.key === "string" && credential.key.trim() ? credential.key.trim() : "";
	const secretHints = secretKey ? [secretKey] : [];

	const candidatePaths = typeof usagePath === "string" && usagePath.trim()
		? [normalizeUsagePath(usagePath)]
		: Array.isArray(params.candidatePaths) && params.candidatePaths.length
			? params.candidatePaths.slice(0, 4).map(normalizeUsagePath)
			: DEFAULT_CANDIDATE_PATHS.slice(0, 4);

	const attempts = [];
	let firstAuthError = null;
	let lastResponseBody = null;
	let lastResponsePath = null;

	for (const candidatePath of candidatePaths) {
		const targetUrl = resolveEndpointUrl(baseUrl, candidatePath, { allowInsecureHttp });
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
					now: runtimeOptions.now
				}
			);
			attempts.push({ path: candidatePath, status: res.status, ok: true });
			lastResponseBody = res.body;
			lastResponsePath = candidatePath;

			// 1. 尝试命中已知 Recipe 签名
			const known = matchKnownRecipeSignature(res.body, candidatePath);
			if (known) {
				let normalizedPreview = null;
				try {
					if (known.adapterId === "sub2api") normalizedPreview = normalizeSub2ApiPayload(res.body, { now: runtimeOptions.now });
					else if (known.adapterId === "litellm") normalizedPreview = normalizeLiteLLMPayload(res.body, { now: runtimeOptions.now });
					else if (known.suggestedMapping) normalizedPreview = normalizeCustomHttpPayload(res.body, known.suggestedMapping);
				} catch {
					normalizedPreview = null;
				}
				const mergedMapping = known.suggestedMapping
					? mergeMappingWithLock(existingMapping, known.suggestedMapping)
					: existingMapping;

				return {
					status: "identified",
					adapterId: known.adapterId,
					recipeId: known.recipeId,
					confidence: "high",
					requiresConfirmation: false,
					usagePath: candidatePath,
					reason: known.reason,
					suggestedMapping: mergedMapping,
					conflicts: [],
					explanations: [known.reason],
					rawPreview: sanitizePreview(res.body, { secretHints }),
					...(normalizedPreview ? { normalizedPreview } : {}),
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
					suggestedMapping: mergedMapping,
					conflicts: inferred.conflicts,
					explanations: inferred.explanations,
					candidatePointers: inferred.candidatePointers,
					rawPreview: sanitizePreview(res.body, { secretHints }),
					...(normalizedPreview ? { normalizedPreview } : {}),
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
				message: err?.message ?? "请求失败"
			});

			// 关键规则：401/403 认证失败立即中断候选探测，绝不能被后续候选的 404 覆盖为 unsupported
			if (err?.code === "subusage/auth" || httpStatus === 401 || httpStatus === 403) {
				firstAuthError = {
					path: candidatePath,
					status: httpStatus,
					message: err.message
				};
				break;
			}

			// 429 限流立即停止探测后续候选
			if (err?.code === "subusage/rate-limit" || httpStatus === 429) {
				return {
					status: "unsupported",
					errorCode: "subusage/rate-limit",
					usagePath: candidatePath,
					reason: err.message,
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
					reason: err.message,
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
