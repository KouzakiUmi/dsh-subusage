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

/**
 * 逐跳/伪头与协议级请求头一律禁止：Host 可把请求路由到同 IP 的其他虚拟主机带走凭据，
 * Content-Length/Transfer-Encoding/Connection 可投毒下游解析，:authority 等伪头同理。
 */
const FORBIDDEN_HEADER_NAMES = new Set([
	"host",
	"content-length",
	"transfer-encoding",
	"connection",
	"keep-alive",
	"upgrade",
	"te",
	"trailer",
	"expect",
	"accept-encoding",
	"origin",
	"referer",
	"proxy-connection",
	":authority",
	":method",
	":path",
	":scheme"
]);

const IPV4_RE = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/;

function ipv4Parts(h) {
	const m = String(h).match(IPV4_RE);
	if (!m) return null;
	const parts = m.slice(1, 5).map(Number);
	return parts.every(p => p >= 0 && p <= 255) ? parts : null;
}

/** 回环只认字面量：localhost / 127.0.0.0/8 / ::1 / 0.0.0.0；绝不按域名前缀猜。 */
export function isLoopbackHost(hostname) {
	const h = String(hostname ?? "").trim().toLowerCase().replace(/^\[|\]$/g, "");
	if (h === "localhost" || h === "::1" || h === "0.0.0.0") return true;
	const ipv4 = ipv4Parts(h);
	return !!ipv4 && ipv4[0] === 127;
}

export function isPrivateNetworkHost(hostname) {
	const h = String(hostname ?? "").trim().toLowerCase().replace(/^\[|\]$/g, "");
	if (isLoopbackHost(h)) return true;
	if (h.endsWith(".local") || h.endsWith(".lan") || h.endsWith(".internal") || h.endsWith(".home")) return true;
	// IPv6 字面量：ULA(fc00::/7) 与链路本地(fe80::/10) 才算私网；IPv6 必含冒号。
	if (h.includes(":")) {
		return h.startsWith("fc") || h.startsWith("fd") || h.startsWith("fe8") || h.startsWith("fe9") || h.startsWith("fea") || h.startsWith("feb") || h === "::1";
	}
	// 单标签主机名（如 http://gateway）按内网处理，公网明文 HTTP 才需要显式放行。
	if (!h.includes(".")) return true;
	const ipv4 = ipv4Parts(h);
	if (ipv4) {
		const [a, b] = ipv4;
		if (a === 10) return true;
		if (a === 192 && b === 168) return true;
		if (a === 172 && b >= 16 && b <= 31) return true;
		if (a === 100 && b >= 64 && b <= 127) return true; // Tailscale / CGNAT
		if (a === 169 && b === 254) return true; // link-local
	}
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
	// %2e 编码的 .. 会被 WHATWG URL 解析成上级目录穿越出反代子路径，必须按解码后形态校验。
	let decoded = withSlash;
	try { decoded = decodeURIComponent(withSlash); } catch { throw new Error("端点路径包含非法百分号编码"); }
	if (withSlash.includes("..") || decoded.includes("..") || decoded.includes("\\") || decoded.includes("#")) {
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
 * authHeaderNames：本实例 authKind 实际会注入的头名（大小写不敏感），用户 headers 与之同名的项
 * 必须拒绝而不是靠合并顺序侥幸压过鉴权头——不同 fetch 实现对同名头合并语义不一致。
 */
export function validateNonSecretHeaders(headers, authHeaderNames = []) {
	if (headers === undefined || headers === null) return {};
	if (typeof headers !== "object" || Array.isArray(headers)) {
		throw new Error("自定义请求头必须是键值对对象");
	}
	const out = {};
	const authNames = new Set((authHeaderNames ?? []).map(n => String(n ?? "").trim().toLowerCase()).filter(Boolean));
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
		if (FORBIDDEN_HEADER_NAMES.has(key.toLowerCase()) || key.startsWith(":")) {
			throw new Error(`请求头「${key}」是协议级/逐跳头，不得通过公开 headers 注入`);
		}
		if (authNames.has(key.toLowerCase())) {
			throw new Error(`请求头「${key}」与本实例认证头同名，请改由 authKind 配置，不得在 headers 中重复注入`);
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
	// { success: false, message } 是无 code 信封的另一主流形态。
	if (body.success === false) {
		const msg = typeof body.message === "string" && body.message.trim() ? body.message.trim()
			: typeof body.msg === "string" && body.msg.trim() ? body.msg.trim()
			: typeof body.error === "string" && body.error.trim() ? body.error.trim()
			: "上游返回失败";
		const err = new Error(msg);
		err.upstreamCode = body.code ?? "success:false";
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
		// 信封确认成功后：data 是什么就返回什么（数组/标量原样），缺 data 才回整体。
		if ("data" in body) return body.data ?? {};
	}
	return body;
}
