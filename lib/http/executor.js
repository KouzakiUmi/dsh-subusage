/**
 * 受控只读 HTTP 执行器：
 * - 强制只读方法（GET，或内置 Recipe 显式声明的只读 POST）；
 * - 拦截跨源重定向（防止凭据头随 301/302 泄露到第三方域名）；
 * - 响应体大小上限（1 MiB）与 JSON 深度校验；
 * - 解析 429 Retry-After 与标准错误分类。
 */

export const MAX_RESPONSE_BYTES = 1024 * 1024; // 1 MiB

export function parseRetryAfterMs(headerValue, nowMs = Date.now()) {
	if (typeof headerValue !== "string" || !headerValue.trim()) return undefined;
	const trimmed = headerValue.trim();
	if (/^\d+$/.test(trimmed)) {
		const seconds = Number(trimmed);
		return Number.isFinite(seconds) && seconds >= 0 ? Math.min(seconds * 1000, 300_000) : undefined;
	}
	const dateMs = Date.parse(trimmed);
	if (Number.isFinite(dateMs) && dateMs > nowMs) {
		return Math.min(dateMs - nowMs, 300_000);
	}
	return undefined;
}

function checkJsonDepth(value, maxDepth = 24, current = 0) {
	if (current > maxDepth) throw new Error("JSON 嵌套层级超出安全上限");
	if (!value || typeof value !== "object") return;
	if (Array.isArray(value)) {
		for (let i = 0; i < Math.min(value.length, 500); i++) checkJsonDepth(value[i], maxDepth, current + 1);
		return;
	}
	for (const k of Object.keys(value)) {
		checkJsonDepth(value[k], maxDepth, current + 1);
	}
}

export async function executeReadOnlyRequest(plan, options = {}) {
	const fetchImpl = options.fetch ?? globalThis.fetch;
	if (typeof fetchImpl !== "function") {
		const err = new Error("当前运行环境缺少 fetch 实现");
		err.code = "subusage/network";
		throw err;
	}
	const method = (plan.method ?? "GET").toUpperCase();
	if (method !== "GET" && !(method === "POST" && plan.allowReadOnlyPost === true)) {
		const err = new Error(`禁止使用非只读 HTTP 方法「${method}」`);
		err.code = "subusage/invalid-method";
		throw err;
	}

	const timeoutMs = Number.isFinite(options.timeoutMs) ? options.timeoutMs : 15_000;
	const maxBytes = Number.isFinite(options.maxBytes) ? options.maxBytes : MAX_RESPONSE_BYTES;
	const nowMs = typeof options.now === "function" ? options.now() : Date.now();

	let currentUrl = plan.url;
	const initialOrigin = new URL(currentUrl).origin;
	let hops = 0;

	while (hops <= 2) {
		const controller = new AbortController();
		const timer = setTimeout(() => controller.abort(), timeoutMs);
		let response;
		try {
			response = await fetchImpl(currentUrl, {
				method,
				headers: { accept: "application/json", ...(plan.headers ?? {}) },
				...(method === "POST" && plan.body !== undefined ? { body: typeof plan.body === "string" ? plan.body : JSON.stringify(plan.body) } : {}),
				redirect: "manual",
				signal: controller.signal
			});
		} catch (cause) {
			clearTimeout(timer);
			const isAbort = cause?.name === "AbortError";
			const err = new Error(isAbort ? "请求超时" : "网络请求失败");
			err.code = "subusage/network";
			err.retryable = true;
			throw err;
		} finally {
			clearTimeout(timer);
		}

		const status = response?.status ?? 0;
		if (status >= 300 && status < 400) {
			const location = response?.headers?.get?.("location");
			if (!location) {
				const err = new Error(`上游返回重定向 HTTP ${status} 但缺少 Location 头`);
				err.code = "subusage/http";
				err.status = status;
				throw err;
			}
			let targetUrl;
			try {
				targetUrl = new URL(location, currentUrl);
			} catch {
				const err = new Error("上游重定向地址无效");
				err.code = "subusage/http";
				err.status = status;
				throw err;
			}
			if (targetUrl.origin !== initialOrigin) {
				const err = new Error(`已拦截跨源重定向（${initialOrigin} -> ${targetUrl.origin}），防止凭据泄露`);
				err.code = "subusage/redirect-blocked";
				err.status = status;
				throw err;
			}
			currentUrl = targetUrl.toString();
			hops += 1;
			continue;
		}

		// 检查响应体大小
		const contentLength = Number(response?.headers?.get?.("content-length"));
		if (Number.isFinite(contentLength) && contentLength > maxBytes) {
			const err = new Error(`响应体过大（${contentLength} 字节，上限 ${maxBytes} 字节）`);
			err.code = "subusage/response";
			err.status = status;
			throw err;
		}

		let text = "";
		try {
			text = await response.text();
		} catch {
			const err = new Error("读取响应内容失败");
			err.code = "subusage/response";
			err.retryable = true;
			throw err;
		}

		if (Buffer.byteLength(text, "utf8") > maxBytes) {
			const err = new Error(`响应体超过安全上限（${maxBytes} 字节）`);
			err.code = "subusage/response";
			err.status = status;
			throw err;
		}

		let json;
		if (text.trim()) {
			try {
				json = JSON.parse(text);
				checkJsonDepth(json);
			} catch (parseErr) {
				if (response?.ok) {
					const err = new Error(parseErr?.message?.includes("嵌套") ? parseErr.message : "上游未返回有效 JSON");
					err.code = "subusage/response";
					err.status = status;
					throw err;
				}
			}
		}

		if (!response?.ok) {
			const retryAfterMs = status === 429 ? parseRetryAfterMs(response?.headers?.get?.("retry-after"), nowMs) : undefined;
			const upstreamMsg = typeof json?.error?.message === "string" && json.error.message.trim() ? json.error.message.trim()
				: typeof json?.message === "string" && json.message.trim() ? json.message.trim()
				: typeof json?.msg === "string" && json.msg.trim() ? json.msg.trim() : "";
			if (status === 401 || status === 403) {
				const err = new Error(upstreamMsg ? `认证失败（HTTP ${status}）：${upstreamMsg}` : `认证失败（HTTP ${status}），请检查凭据`);
				err.code = "subusage/auth";
				err.status = status;
				err.retryable = false;
				throw err;
			}
			if (status === 429) {
				const err = new Error(upstreamMsg ? `请求过于频繁（HTTP 429）：${upstreamMsg}` : "请求过于频繁（HTTP 429）");
				err.code = "subusage/rate-limit";
				err.status = 429;
				err.retryable = true;
				if (retryAfterMs !== undefined) err.retryAfterMs = retryAfterMs;
				throw err;
			}
			const retryable = status >= 500 && status <= 599;
			const err = new Error(upstreamMsg ? `HTTP ${status}：${upstreamMsg}` : `上游返回 HTTP ${status}`);
			err.code = "subusage/http";
			err.status = status;
			err.retryable = retryable;
			throw err;
		}

		if (json === undefined || json === null || typeof json !== "object") {
			const err = new Error("上游未返回有效的 JSON 对象");
			err.code = "subusage/response";
			err.status = status;
			throw err;
		}

		return {
			status,
			url: currentUrl,
			body: json,
			headers: response?.headers
		};
	}

	const err = new Error("重定向次数过多");
	err.code = "subusage/http";
	throw err;
}
