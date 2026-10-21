// Grok consumer billing 的 proto3 float 零值不会上线路；只有完整成功响应中的
// 活跃 current_period 才能据此认定 0%，不能把任意缺字段响应当作零用量。
// 契约来源：https://cdn.grok.com/_next/static/chunks/32g78bk5hhe1q.js
// 本模块只解析 gRPC-web 帧，不发网络请求。

export const GROK_GRPC_CREDITS_URL = "https://grok.com/grok_api_v2.GrokBuildBilling/GetGrokCreditsConfig";
export const GROK_GRPC_EMPTY_FRAME = new Uint8Array([0, 0, 0, 0, 0]);

const SCHEMAS = {
	response: { 1: "config" },
	config: { 1: 5, 2: "cent", 3: "cent", 4: "timestamp", 5: "timestamp", 6: "history", 7: "product", 8: "period", 11: 0, 12: "cent", 13: 0 },
	period: { 1: 0, 2: "timestamp", 3: "timestamp" },
	timestamp: { 1: 0, 2: 0 },
	cent: { 1: 0 },
	history: { 1: "cycle", 2: "cent", 3: "period" },
	cycle: { 1: 0, 2: 0 },
	product: { 1: 0, 2: 5 }
};
const PERIOD_TYPES = { 1: "USAGE_PERIOD_TYPE_MONTHLY", 2: "USAGE_PERIOD_TYPE_WEEKLY" };

function invalid() { throw new Error("Invalid Grok billing frame"); }
function asBytes(body) {
	if (body instanceof Uint8Array) return body;
	if (body instanceof ArrayBuffer) return new Uint8Array(body);
	return undefined;
}

function readVarint(bytes, cursor) {
	let value = 0n;
	for (let shift = 0n; shift < 70n; shift += 7n) {
		if (cursor.offset >= bytes.length) invalid();
		const byte = bytes[cursor.offset++];
		if (shift === 63n && byte > 1) invalid();
		value |= BigInt(byte & 0x7f) << shift;
		if (!(byte & 0x80)) return value;
	}
	invalid();
}

// 只递归 schema 声明的消息；未知 length-delimited 字段可能是字符串/opaque bytes。
function readMessage(bytes, schemaName) {
	const cursor = { offset: 0 }, fields = [], seen = new Set();
	const schema = SCHEMAS[schemaName];
	while (cursor.offset < bytes.length) {
		const tag = readVarint(bytes, cursor);
		const number = Number(tag >> 3n), wire = Number(tag & 7n);
		if (number < 1 || number > 536870911) invalid();
		const expected = schema[number];
		if (expected !== undefined) {
			if (wire !== (typeof expected === "string" ? 2 : expected)) invalid();
			if (seen.has(number) && !(schemaName === "config" && (number === 6 || number === 7))) invalid();
			seen.add(number);
		}
		let value;
		if (wire === 0) value = readVarint(bytes, cursor);
		else {
			const length = wire === 1 ? 8 : wire === 5 ? 4 : wire === 2 ? Number(readVarint(bytes, cursor)) : invalid();
			if (!Number.isSafeInteger(length) || length < 0 || length > bytes.length - cursor.offset) invalid();
			value = bytes.subarray(cursor.offset, cursor.offset + length);
			cursor.offset += length;
		}
		fields.push({ number, wire, value, ...(typeof expected === "string" ? { children: readMessage(value, expected) } : {}) });
	}
	return fields;
}
function field(fields, number) { return fields.find(row => row.number === number); }
function hasFloat(fields) { return fields.some(row => row.wire === 5 || row.children && hasFloat(row.children)); }
function timestamp(fields) {
	if (!fields) return undefined;
	const seconds = field(fields, 1)?.value ?? 0n;
	const nanos = field(fields, 2)?.value ?? 0n;
	if (seconds > 253402300799n || nanos >= 1000000000n) invalid();
	return new Date(Number(seconds) * 1000 + Number(nanos / 1000000n)).toISOString();
}

function grpcWebMessage(bytes) {
	let offset = 0, message, status;
	while (offset < bytes.length) {
		if (offset + 5 > bytes.length) invalid();
		const flag = bytes[offset];
		const length = new DataView(bytes.buffer, bytes.byteOffset + offset + 1, 4).getUint32(0);
		offset += 5;
		if (length > bytes.length - offset || (flag !== 0 && flag !== 0x80)) invalid();
		const frame = bytes.subarray(offset, offset + length);
		offset += length;
		if (flag === 0) {
			if (message || status !== undefined) invalid();
			message = frame;
		} else {
			const text = new TextDecoder("utf-8", { fatal: true }).decode(frame);
			for (const line of text.split(/\r?\n/)) {
				if (!line) continue;
				const separator = line.indexOf(":");
				if (separator < 1) invalid();
				if (line.slice(0, separator).trim().toLowerCase() !== "grpc-status") continue;
				const value = line.slice(separator + 1).trim();
				if (status !== undefined || value !== "0") invalid();
				status = 0;
			}
		}
	}
	return message ? { message, successful: status === 0 } : undefined;
}

function periodType(startIso, endIso) {
	if (!startIso || !endIso) return undefined;
	const days = (Date.parse(endIso) - Date.parse(startIso)) / 86400000;
	if (days >= 4 && days <= 12) return "USAGE_PERIOD_TYPE_WEEKLY";
	if (days >= 20 && days <= 45) return "USAGE_PERIOD_TYPE_MONTHLY";
	return undefined;
}

/**
 * 转成 normalizeSuperGrok 认识的形态。显式百分比保持 0–100 的原单位，不乘 100。
 * 隐式零值另要求成功 trailer、有效活跃 current_period、整包无 float 字段。
 * 任一帧/已知消息不完整或非法均返回 undefined；不从历史周期或金额推算零用量。
 */
export function parseGrokCreditsGrpcWeb(body, now = Date.now()) {
	const bytes = asBytes(body);
	if (!bytes?.length) return undefined;
	try {
		const framed = grpcWebMessage(bytes);
		if (!framed) return undefined;
		const root = readMessage(framed.message, "response");
		const config = field(root, 1)?.children;
		if (!config) return undefined;
		const usage = field(config, 1);
		let usedPercent = usage ? new DataView(usage.value.buffer, usage.value.byteOffset, 4).getFloat32(0, true) : undefined;
		if (usedPercent !== undefined && (!Number.isFinite(usedPercent) || usedPercent < 0)) return undefined;
		const period = field(config, 8)?.children;
		const start = timestamp(period ? field(period, 2)?.children : field(config, 4)?.children);
		const end = timestamp(period ? field(period, 3)?.children : field(config, 5)?.children);
		const type = period ? PERIOD_TYPES[Number(field(period, 1)?.value ?? 0n)] : periodType(start, end);
		if (usedPercent === undefined && framed.successful && period && type && start && end
			&& Number.isFinite(now) && Date.parse(start) <= now && now < Date.parse(end) && !hasFloat(root)) usedPercent = 0;
		const currentPeriod = end || start
			? { ...(type ? { type } : {}), ...(start ? { start } : {}), ...(end ? { end } : {}) }
			: undefined;
		if (usedPercent === undefined && !currentPeriod) return undefined;
		return { config: {
			...(usedPercent !== undefined ? { creditUsagePercent: usedPercent } : {}),
			...(currentPeriod ? { currentPeriod } : {})
		} };
	} catch { return undefined; }
}
