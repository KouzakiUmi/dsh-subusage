/**
 * 认证注入器（AuthKind）与适配器能力兼容性校验。
 */

export const AUTH_KINDS = [
	"bearer",
	"raw-authorization",
	"scheme-authorization",
	"x-api-key",
	"custom-header",
	"cookie",
	"volc-signature",
	"none"
];

export function validateAuthConfig(authKind, options = {}, supportedAuthKinds = null) {
	if (!AUTH_KINDS.includes(authKind)) {
		throw new Error(`不支持的认证方式「${String(authKind)}」`);
	}
	if (Array.isArray(supportedAuthKinds) && supportedAuthKinds.length > 0 && !supportedAuthKinds.includes(authKind)) {
		throw new Error(`当前适配器仅支持认证方式 [${supportedAuthKinds.join(", ")}]，不支持「${authKind}」`);
	}
	if (authKind === "custom-header") {
		const headerName = typeof options.customHeaderName === "string" ? options.customHeaderName.trim() : "";
		if (!headerName || !/^[a-zA-Z0-9-]+$/.test(headerName)) {
			throw new Error("custom-header 认证方式必须指定合法的请求头名称（customHeaderName）");
		}
	}
	if (authKind === "scheme-authorization") {
		const scheme = typeof options.authScheme === "string" ? options.authScheme.trim() : "";
		if (!scheme || !/^[a-zA-Z0-9._-]+$/.test(scheme)) {
			throw new Error("scheme-authorization 认证方式必须指定合法的认证前缀（authScheme，如 Token）");
		}
	}
	return true;
}

export function applyAuthHeaders(authKind, credential, options = {}) {
	if (authKind === "none") return {};
	const key = typeof credential?.key === "string" ? credential.key.trim() : "";
	if (!key) return {};

	switch (authKind) {
		case "bearer": {
			const clean = key.replace(/^Bearer\s+/i, "").trim();
			return { Authorization: `Bearer ${clean}` };
		}
		case "raw-authorization":
			return { Authorization: key };
		case "scheme-authorization": {
			const scheme = typeof options.authScheme === "string" && options.authScheme.trim() ? options.authScheme.trim() : "Bearer";
			const prefixRe = new RegExp(`^${scheme.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s+`, "i");
			const clean = key.replace(prefixRe, "").trim();
			return { Authorization: `${scheme} ${clean}` };
		}
		case "x-api-key":
			return { "X-API-Key": key };
		case "custom-header": {
			const headerName = typeof options.customHeaderName === "string" && options.customHeaderName.trim()
				? options.customHeaderName.trim()
				: "X-API-Key";
			return { [headerName]: key };
		}
		case "cookie":
			return { Cookie: key };
		default:
			return {};
	}
}
