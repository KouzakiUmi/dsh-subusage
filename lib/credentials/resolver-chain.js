/**
 * 统一凭据解析链（CredentialProfile Resolver Chain）：
 *
 * inherit 优先级：
 *   1. 绑定路由实际 apiKeyEnv（先凭据服务、后启动环境）
 *   2. 实例/提供商配置的 credentialRefs（最多 8 个引用名，先凭据服务、后启动环境）
 *   3. 适配器内置 envName / envAliases（先凭据服务、后启动环境）
 *   4. 手动保存的秘密值兜底（manual secret）
 *
 * manual 模式：
 *   - 当手头存在非空手动秘密值时优先使用；
 *   - 若手动秘密被清除或为空，自动回落走 inherit 解析链（与 AGENTS.md 既有规则完全一致）。
 */

export const MAX_CREDENTIAL_REFS = 8;

export function normalizeCredentialRefs(refs) {
	if (refs === undefined || refs === null) return [];
	if (!Array.isArray(refs)) {
		throw new Error("凭据引用列表（credentialRefs）必须是字符串数组");
	}
	if (refs.length > MAX_CREDENTIAL_REFS) {
		throw new Error(`每个实例最多配置 ${MAX_CREDENTIAL_REFS} 个凭据引用名`);
	}
	const seen = new Set();
	const out = [];
	for (const item of refs) {
		if (typeof item !== "string") throw new Error("凭据引用名必须是字符串");
		const trimmed = item.trim();
		if (!trimmed) throw new Error("凭据引用名不能为空");
		if (trimmed.length > 128 || /[\s\r\n]/.test(trimmed)) {
			throw new Error(`凭据引用名「${trimmed.slice(0, 32)}」格式无效`);
		}
		if (seen.has(trimmed)) {
			throw new Error(`凭据引用名「${trimmed}」重复`);
		}
		seen.add(trimmed);
		out.push(trimmed);
	}
	return out;
}

async function resolveSingleRef(ref, resolvers = {}) {
	if (!ref || typeof ref !== "string") return undefined;
	const cleanRef = ref.trim();
	if (!cleanRef) return undefined;

	if (typeof resolvers.resolveCredentialByName === "function") {
		try {
			const record = await resolvers.resolveCredentialByName(cleanRef);
			const value = typeof record === "string" ? record.trim()
				: typeof record?.value === "string" ? record.value.trim() : "";
			if (value) return { key: value, source: "credentials", ref: cleanRef };
		} catch {
			// 单个引用查询异常不中断后续链条
		}
	}

	if (typeof resolvers.resolveEnvironment === "function") {
		try {
			const envVal = await resolvers.resolveEnvironment(cleanRef);
			const value = typeof envVal === "string" ? envVal.trim() : "";
			if (value) return { key: value, source: "env", ref: cleanRef };
		} catch {
			// 忽略环境读取异常
		}
	}

	return undefined;
}

/**
 * 解析连接实例或提供商的凭据。
 */
export async function resolveCredentialChain(profile = {}, resolvers = {}) {
	if (profile.authKind === "none") {
		return { key: "", source: "none" };
	}

	const targetRef = typeof profile.targetRef === "string" ? profile.targetRef.trim() : "";
	if (targetRef) {
		const hit = await resolveSingleRef(targetRef, resolvers);
		return hit ?? { key: "", source: "none", ref: targetRef };
	}

	const manualSecret = typeof profile.manualSecret === "string" ? profile.manualSecret.trim() : "";
	const mode = profile.mode === "manual" ? "manual" : "inherit";

	if (mode === "manual" && manualSecret) {
		return { key: manualSecret, source: "manual" };
	}

	// 1. 绑定路由的 apiKeyEnv
	const routeEnvs = Array.isArray(profile.routeEnvs) ? profile.routeEnvs : [];
	for (const ref of routeEnvs) {
		const hit = await resolveSingleRef(ref, resolvers);
		if (hit) return hit;
	}

	// 2. 实例配置的 credentialRefs
	const credentialRefs = Array.isArray(profile.credentialRefs) ? profile.credentialRefs : [];
	for (const ref of credentialRefs) {
		const hit = await resolveSingleRef(ref, resolvers);
		if (hit) return hit;
	}

	// 3. 适配器内置的 envName / envAliases
	const builtinEnvs = Array.isArray(profile.builtinEnvs) ? profile.builtinEnvs : [];
	for (const ref of builtinEnvs) {
		const hit = await resolveSingleRef(ref, resolvers);
		if (hit) return hit;
	}

	// 4. 手动秘密兜底
	if (manualSecret) {
		return { key: manualSecret, source: "manual" };
	}

	return { key: "", source: "none" };
}
