/**
 * 探测预览深度脱敏器（sanitizePreview）：
 * - 遮蔽敏感键名（token/secret/password/cookie/api_key/authorization/jwt/credential 等）；
 * - 遮蔽疑似凭证字符串（JWT、sk-/ak-/rk- 前缀、Bearer 串、以及本次请求实际使用的秘密明文）；
 * - 遮蔽 URL 内嵌 userinfo；
 * - 限制嵌套深度、数组长度、对象键数与单串长度，确保预览安全轻量。
 */

const SENSITIVE_KEY_RE = /(?:^|[_-])(key|token|secret|password|passwd|pass_token|passtoken|cookie|session|api_key|apikey|access_key|secret_key|private_key|authorization|auth_token|refresh_token|jwt|credential|client_secret)(?:$|[_-])/i;
// camelCase 完整名：裸 key / clientSecret / privateKey / accessKey 等（复合名交给上面的 _/- 模式）。
const SENSITIVE_EXACT_RE = /^(key|token|secret|password|cookie|authorization|apikey|apiKey|accessToken|refreshToken|passToken|sessionToken|clientSecret|privateKey|accessKey|secretKey|authToken|sign|signature|credential)$/i;
const JWT_LIKE_RE = /^eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{5,}$/;
// 嵌入在长文本（错误消息、日志行）里的 JWT 也要抠掉，不要求整串匹配。
const JWT_EMBEDDED_RE = /eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{5,}/g;
const KEY_PREFIX_RE = /^(?:Bearer\s+\S+|sk-[A-Za-z0-9_-]{12,}|ak-[A-Za-z0-9_-]{12,}|rk-[A-Za-z0-9_-]{12,}|ghp_[A-Za-z0-9]{16,}|gho_[A-Za-z0-9]{16,})$/i;
// 嵌在文本里的 sk-/ak-/Bearer 形态（不限于整串）。
const KEY_EMBEDDED_RE = /\b(?:sk-[A-Za-z0-9_-]{12,}|ak-[A-Za-z0-9_-]{12,}|rk-[A-Za-z0-9_-]{12,}|ghp_[A-Za-z0-9]{16,}|gho_[A-Za-z0-9]{16,}|Bearer\s+[A-Za-z0-9_.~+/=-]{8,})/gi;
const URL_USERINFO_RE = /(https?:\/\/)([^/\s:@]+(?::[^/\s@]*)?@)/gi;

export function isSensitiveFieldName(key) {
	const k = String(key ?? "").trim();
	return SENSITIVE_EXACT_RE.test(k) || SENSITIVE_KEY_RE.test(k);
}

export function sanitizeStringValue(value, secretHints = []) {
	if (typeof value !== "string") return value;
	const trimmed = value.trim();
	if (!trimmed) return "";

	for (const hint of secretHints) {
		if (typeof hint === "string" && hint.trim().length >= 4 && trimmed.includes(hint.trim())) {
			return "[REDACTED]";
		}
	}

	if (JWT_LIKE_RE.test(trimmed) || KEY_PREFIX_RE.test(trimmed)) {
		return "[REDACTED]";
	}

	const maskedUrl = value
		.replace(URL_USERINFO_RE, "$1[REDACTED]@")
		.replace(JWT_EMBEDDED_RE, "[REDACTED]")
		.replace(KEY_EMBEDDED_RE, "[REDACTED]");
	if (maskedUrl.length > 200) {
		return maskedUrl.slice(0, 197) + "...";
	}
	return maskedUrl;
}

export function sanitizePreview(raw, options = {}) {
	const maxDepth = Number.isFinite(options.maxDepth) ? options.maxDepth : 6;
	const maxArrayItems = Number.isFinite(options.maxArrayItems) ? options.maxArrayItems : 10;
	const maxObjectKeys = Number.isFinite(options.maxObjectKeys) ? options.maxObjectKeys : 40;
	const secretHints = Array.isArray(options.secretHints)
		? options.secretHints.filter(s => typeof s === "string" && s.trim().length >= 4)
		: [];

	const visit = (node, depth) => {
		if (node === null || node === undefined) return null;
		if (typeof node === "boolean") return node;
		if (typeof node === "number") return Number.isFinite(node) && !Object.is(node, -0) ? node : 0;
		if (typeof node === "string") return sanitizeStringValue(node, secretHints);
		if (depth >= maxDepth) return "[Truncated]";
		if (Array.isArray(node)) {
			return node.slice(0, maxArrayItems).map(item => visit(item, depth + 1));
		}
		if (typeof node === "object") {
			const out = {};
			const keys = Object.keys(node).slice(0, maxObjectKeys);
			for (const key of keys) {
				if (key === "__proto__" || key === "prototype" || key === "constructor") continue;
				if (isSensitiveFieldName(key)) {
					out[key] = "[REDACTED]";
				} else {
					out[key] = visit(node[key], depth + 1);
				}
			}
			return out;
		}
		return String(node);
	};

	return visit(raw, 0);
}
