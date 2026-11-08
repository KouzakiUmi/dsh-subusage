/**
 * RFC 6901 JSON Pointer 解析与安全求值（严禁 eval / Function，防原型链属性读取）。
 */

const FORBIDDEN_SEGMENTS = new Set(["__proto__", "prototype", "constructor"]);

export function unescapeToken(token) {
	return String(token).replace(/~1/g, "/").replace(/~0/g, "~");
}

export function escapeToken(token) {
	return String(token).replace(/~/g, "~0").replace(/\//g, "~1");
}

export function isValidPointer(pointer) {
	if (typeof pointer !== "string") return false;
	if (pointer === "") return true;
	if (!pointer.startsWith("/")) return false;
	// 检查是否存在非法的 ~ 转义（~ 后只能跟 0 或 1）
	if (/~(?![01])/.test(pointer)) return false;
	const parts = pointer.slice(1).split("/").map(unescapeToken);
	return parts.every(part => !FORBIDDEN_SEGMENTS.has(part));
}

export function parsePointer(pointer) {
	if (!isValidPointer(pointer)) return undefined;
	if (pointer === "") return [];
	return pointer.slice(1).split("/").map(unescapeToken);
}

export function formatPointer(tokens) {
	if (!Array.isArray(tokens) || !tokens.length) return "";
	return "/" + tokens.map(escapeToken).join("/");
}

export function getByPointer(root, pointer) {
	if (typeof pointer !== "string") return undefined;
	const tokens = parsePointer(pointer);
	if (!tokens) return undefined;
	let current = root;
	for (const token of tokens) {
		if (current === null || current === undefined || typeof current !== "object") return undefined;
		if (FORBIDDEN_SEGMENTS.has(token)) return undefined;
		if (Array.isArray(current)) {
			if (!/^(?:0|[1-9]\d*)$/.test(token)) return undefined;
			const index = Number(token);
			if (index < 0 || index >= current.length) return undefined;
			current = current[index];
		} else {
			if (!Object.prototype.hasOwnProperty.call(current, token)) return undefined;
			current = current[token];
		}
	}
	return current;
}

export function hasPointer(root, pointer) {
	if (typeof pointer !== "string") return false;
	const tokens = parsePointer(pointer);
	if (!tokens) return false;
	let current = root;
	for (const token of tokens) {
		if (current === null || current === undefined || typeof current !== "object") return false;
		if (FORBIDDEN_SEGMENTS.has(token)) return false;
		if (Array.isArray(current)) {
			if (!/^(?:0|[1-9]\d*)$/.test(token)) return false;
			const index = Number(token);
			if (index < 0 || index >= current.length) return false;
			current = current[index];
		} else {
			if (!Object.prototype.hasOwnProperty.call(current, token)) return false;
			current = current[token];
		}
	}
	return true;
}

/**
 * 枚举 JSON 树中的候选指针（用于自动探测与映射候选列表），受深度与节点上限约束。
 */
export function enumeratePointers(root, options = {}) {
	const maxDepth = Number.isFinite(options.maxDepth) ? options.maxDepth : 6;
	const maxNodes = Number.isFinite(options.maxNodes) ? options.maxNodes : 250;
	const results = [];
	const visit = (node, tokens, depth) => {
		if (results.length >= maxNodes || depth > maxDepth) return;
		if (node === null || node === undefined) return;
		const pointer = formatPointer(tokens);
		if (typeof node === "number" || typeof node === "string" || typeof node === "boolean") {
			results.push({ pointer, type: typeof node, value: node, key: tokens[tokens.length - 1] ?? "" });
			return;
		}
		if (Array.isArray(node)) {
			if (pointer) results.push({ pointer, type: "array", length: node.length, key: tokens[tokens.length - 1] ?? "" });
			const limit = Math.min(node.length, 10);
			for (let i = 0; i < limit; i++) {
				visit(node[i], [...tokens, String(i)], depth + 1);
				if (results.length >= maxNodes) return;
			}
			return;
		}
		if (typeof node === "object") {
			if (pointer) results.push({ pointer, type: "object", key: tokens[tokens.length - 1] ?? "" });
			for (const key of Object.keys(node)) {
				if (FORBIDDEN_SEGMENTS.has(key)) continue;
				visit(node[key], [...tokens, key], depth + 1);
				if (results.length >= maxNodes) return;
			}
		}
	};
	visit(root, [], 0);
	return results;
}
