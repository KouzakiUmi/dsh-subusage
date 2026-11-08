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

/**
 * 流式读取响应体并强制字节上限：Content-Length 可谎报/缺失（chunked），
 * 必须在收到信号时立刻取消，而不是等 text() 攒满再截断。
 */
async function readBodyLimited(response, maxBytes, signal) {
	const body = response?.body;
	if (body && typeof body.getReader === "function") {
		const reader = body.getReader();
		const chunks = [];
		let total = 0;
		try {
			for (;;) {
				const { done, value } = await reader.read();
				if (done) break;
				const bytes = value instanceof Uint8Array ? value : new TextEncoder().encode(String(value ?? ""));
				total += bytes.byteLength;
				if (total > maxBytes) {
					try { await reader.cancel(); } catch { /* 忽略取消异常 */ }
					const err = new Error(`响应体超过安全上限（${maxBytes} 字节）`);
					err.code = "subusage/response";
					throw err;
				}
				chunks.push(bytes);
			}
		} finally {
			try { reader.releaseLock?.(); } catch { /* 部分实现没有 releaseLock */ }
		}
		return new TextDecoder().decode(concatBytes(chunks, total));
	}
	const text = await response.text();
	if (Buffer.byteLength(text, "utf8") > maxBytes) {
		const err = new Error(`响应体超过安全上限（${maxBytes} 字节）`);
		err.code = "subusage/response";
		throw err;
	}
	return text;
}

function concatBytes(chunks, total) {
	const out = new Uint8Array(total);
	let offset = 0;
	for (const c of chunks) { out.set(c, offset); offset += c.byteLength; }
	return out;
}

/**
 * 深度+广度双护栏：嵌套 ≤24 层，单对象键/单数组元素 ≤500，总节点数 ≤20000，
 * 防止宽而浅的 JSON 炸弹拖垮归一化。
 */
function checkJsonBreadth(value, budget = { nodes: 20000 }) {
	if (--budget.nodes < 0) throw new Error("JSON 节点数超出安全上限");
	if (!value || typeof value !== "object") return;
	const entries = Array.isArray(value) ? value : Object.values(value);
	for (const item of entries) checkJsonBreadth(item, budget);
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

/** 把上游返回的错误文本净化后再拼进错误：上游可回显我们的凭据头或嵌入密钥形态。 */
export function sanitizeUpstreamMessage(raw, secretHints = []) {
	if (typeof raw !== "string") return "";
	let msg = raw.trim();
	if (!msg) return "";
	for (const hint of secretHints) {
		if (typeof hint === "string" && hint.trim().length >= 4 && msg.includes(hint.trim())) {
			msg = msg.split(hint.trim()).join("[REDACTED]");
		}
	}
	msg = msg
		.replace(/eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{5,}/g, "[REDACTED]")
		.replace(/\b(?:sk-[A-Za-z0-9_-]{12,}|ak-[A-Za-z0-9_-]{12,}|rk-[A-Za-z0-9_-]{12,}|ghp_[A-Za-z0-9]{16,}|gho_[A-Za-z0-9]{16,}|Bearer\s+[A-Za-z0-9_.~+/=-]{8,})/gi, "[REDACTED]");
	return msg.length > 200 ? `${msg.slice(0, 197)}...` : msg;
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
	const secretHints = Array.isArray(options.secretHints) ? options.secretHints.filter(s => typeof s === "string" && s.trim().length >= 4) : [];

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
			const isAbort = cause?.name === "AbortError" || controller.signal.aborted;
			const err = new Error(isAbort ? "请求超时" : "网络请求失败");
			err.code = "subusage/network";
			err.retryable = true;
			throw err;
		}

		const status = response?.status ?? 0;
		let text = "";
		try {
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

		// 检查响应体大小（Content-Length 可谎报，流式读取时还会二次截断）
		const contentLength = Number(response?.headers?.get?.("content-length"));
		if (Number.isFinite(contentLength) && contentLength > maxBytes) {
			const err = new Error(`响应体过大（${contentLength} 字节，上限 ${maxBytes} 字节）`);
			err.code = "subusage/response";
			err.status = status;
			throw err;
		}

		try {
			text = await readBodyLimited(response, maxBytes, controller.signal);
		} catch (readErr) {
			const isAbort = readErr?.name === "AbortError" || controller.signal.aborted;
			const err = new Error(isAbort ? "请求超时" : (readErr?.code === "subusage/response" ? readErr.message : "读取响应内容失败"));
			err.code = isAbort ? "subusage/network" : "subusage/response";
			err.status = status;
			err.retryable = true;
			throw err;
		}
		} finally {
			clearTimeout(timer);
		}

		let json;
		if (text.trim()) {
			try {
				json = JSON.parse(text);
				checkJsonDepth(json);
				checkJsonBreadth(json);
			} catch (parseErr) {
				if (response?.ok) {
					const isLimit = /嵌套|超出安全上限/.test(parseErr?.message ?? "");
					const err = new Error(isLimit ? parseErr.message : "上游未返回有效 JSON");
					err.code = "subusage/response";
					err.status = status;
					throw err;
				}
			}
		}

		if (!response?.ok) {
			const retryAfterMs = status === 429 ? parseRetryAfterMs(response?.headers?.get?.("retry-after"), nowMs) : undefined;
			const upstreamMsg = sanitizeUpstreamMessage(
				typeof json?.error?.message === "string" && json.error.message.trim() ? json.error.message
					: typeof json?.message === "string" && json.message.trim() ? json.message
					: typeof json?.msg === "string" && json.msg.trim() ? json.msg : "", secretHints);
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
