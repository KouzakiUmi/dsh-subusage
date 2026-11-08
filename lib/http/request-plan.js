/**
 * 声明式 HTTP 请求计划构建、URL 规范化与安全边界校验。
 */

const SECRET_HEADER_NAMES = new Set([
	"authorization",
	"proxy-authorization",
	"cookie",
	"set-cookie",
	"x-api-key",
	"api-key",
	"x-auth-token",
	"x-access-token"
]);

export function isLoopbackHost(hostname) {
	const h = String(hostname ?? "").trim().toLowerCase().replace(/^\[|\]$/g, "");
	return h === "localhost" || h === "127.0.0.1" || h === "::1" || h.startsWith("127.");
}

export function isPrivateNetworkHost(hostname) {
	const h = String(hostname ?? "").trim().toLowerCase().replace(/^\[|\]$/g, "");
	if (isLoopbackHost(h)) return true;
	if (h.endsWith(".local") || h.endsWith(".lan") || h.endsWith(".internal") || h.endsWith(".home") || !h.includes(".")) return true;
	const ipv4 = h.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
	if (ipv4) {
		const [a, b] = [Number(ipv4[1]), Number(ipv4[2])];
		if (a === 10) return true;
		if (a === 192 && b === 168) return true;
		if (a === 172 && b >= 16 && b <= 31) return true;
		if (a === 100 && b >= 64 && b <= 127) return true; // Tailscale / CGNAT
	}
	if (h.startsWith("fc") || h.startsWith("fd") || h.startsWith("fe80:")) return true;
	return false;
}

/**
 * 校验并规范化 Base URL：
 * - 拒绝内嵌用户名/密码或 #fragment；
 * - 默认要求 HTTPS，本机回环允许 HTTP，私网地址需 allowInsecureHttp 显式放行，公网明文 HTTP 一律拒绝；
 * - 去除末尾斜杠，保留反向代理子路径（如 /sub2api）。
 */
export function normalizeBaseUrl(rawUrl, options = {}) {
	if (typeof rawUrl !== "string" || !rawUrl.trim()) {
		throw new Error("Base URL 不能为空");
	}
	let parsed;
	try {
		parsed = new URL(rawUrl.trim());
	} catch {
		throw new Error("Base URL 格式无效，请填写完整的 http(s):// 地址");
	}
	if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
		throw new Error(`不支持的 URL 协议「${parsed.protocol}」，仅支持 https: 或受控 http:`);
	}
	if (parsed.username || parsed.password) {
		throw new Error("Base URL 不得内嵌用户名或密码，请通过凭据设置配置认证");
	}
	if (parsed.hash) {
		throw new Error("Base URL 不得包含 #fragment 片段");
	}
	if (parsed.search) {
		throw new Error("Base URL 不得包含查询参数，请将查询参数配置在端点路径中");
	}
	if (parsed.protocol === "http:") {
		const host = parsed.hostname;
		if (!isLoopbackHost(host)) {
			if (isPrivateNetworkHost(host)) {
				if (options.allowInsecureHttp !== true) {
					throw new Error("非本机回环的私网 HTTP 地址默认拦截，请改用 HTTPS 或显式开启 allowInsecureHttp");
				}
			} else {
				throw new Error("禁止向公网明文 HTTP 地址发送凭据，请使用 HTTPS");
			}
		}
	}
	const cleanPath = parsed.pathname.replace(/\/+$/, "");
	return `${parsed.origin}${cleanPath}`;
}

/**
 * 规范化只读端点路径（以 / 开头，禁止 .. 穿越与协议注入）。
 */
export function normalizeUsagePath(rawPath) {
	if (typeof rawPath !== "string" || !rawPath.trim()) {
		throw new Error("端点路径不能为空");
	}
	const trimmed = rawPath.trim();
	if (/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(trimmed) || trimmed.startsWith("//")) {
		throw new Error("端点路径不得包含完整协议或主机名");
	}
	const withSlash = trimmed.startsWith("/") ? trimmed : `/${trimmed}`;
	if (withSlash.includes("..") || withSlash.includes("\\") || withSlash.includes("#")) {
		throw new Error("端点路径包含非法字符");
	}
	return withSlash;
}

/**
 * 拼接 Base URL 与端点路径：
 * - 保留自定义反向代理子路径（如 https://gw.example.com/sub2api + /v1/usage -> https://gw.example.com/sub2api/v1/usage）
 * - 自动去重末尾 /v1（如 https://gw.example.com/sub2api/v1 + /v1/usage -> https://gw.example.com/sub2api/v1/usage）
 */
export function resolveEndpointUrl(baseUrl, usagePath, options = {}) {
	const normalizedBase = normalizeBaseUrl(baseUrl, options);
	const normalizedPath = normalizeUsagePath(usagePath);
	if (normalizedBase.endsWith("/v1") && (normalizedPath === "/v1" || normalizedPath.startsWith("/v1/"))) {
		return `${normalizedBase.slice(0, -3)}${normalizedPath}`;
	}
	return `${normalizedBase}${normalizedPath}`;
}

/**
 * 校验非秘密自定义请求头（秘密必须走 CredentialProfile / authKind，不得混入公开 headers）。
 */
export function validateNonSecretHeaders(headers) {
	if (headers === undefined || headers === null) return {};
	if (typeof headers !== "object" || Array.isArray(headers)) {
		throw new Error("自定义请求头必须是键值对对象");
	}
	const out = {};
	const entries = Object.entries(headers);
	if (entries.length > 16) {
		throw new Error("自定义非秘密请求头最多支持 16 项");
	}
	for (const [rawKey, rawVal] of entries) {
		const key = String(rawKey ?? "").trim();
		if (!key || !/^[a-zA-Z0-9-]+$/.test(key)) {
			throw new Error(`请求头名称「${key}」格式无效`);
		}
		if (SECRET_HEADER_NAMES.has(key.toLowerCase()) || /secret|token|password|cookie|key/i.test(key)) {
			throw new Error(`请求头「${key}」属于敏感凭据头，请使用认证方式（authKind）与凭据配置，不得写入公开 headers`);
		}
		if (typeof rawVal !== "string" || rawVal.length > 256 || /[\r\n]/.test(rawVal)) {
			throw new Error(`请求头「${key}」的值无效`);
		}
		out[key] = rawVal.trim();
	}
	return out;
}

/**
 * 解包常见网关响应信封（支持 { code: 0, message, data } 与直出顶层 JSON）。
 */
export function unwrapEnvelope(body, options = {}) {
	if (!body || typeof body !== "object" || Array.isArray(body)) {
		throw new Error("响应不是有效的 JSON 对象");
	}
	if (options.envelope === "none") return body;
	// 若存在明确的错误码或 error 对象
	if (body.error && typeof body.error === "object" && typeof body.error.message === "string") {
		const err = new Error(body.error.message.trim() || "上游返回错误");
		err.upstreamCode = body.error.code ?? body.error.type;
		throw err;
	}
	if ("code" in body && body.code !== undefined && body.code !== null) {
		const code = body.code;
		const okCodes = options.okCodes ?? [0, 200, "0", "200", "000000", "ok", "OK", "success", "SUCCESS"];
		if (!okCodes.includes(code)) {
			const msg = typeof body.message === "string" && body.message.trim() ? body.message.trim()
				: typeof body.msg === "string" && body.msg.trim() ? body.msg.trim()
				: `上游返回错误码 ${String(code)}`;
			const err = new Error(msg);
			err.upstreamCode = code;
			throw err;
		}
		if (body.data && typeof body.data === "object" && !Array.isArray(body.data)) {
			return body.data;
		}
	}
	return body;
}
