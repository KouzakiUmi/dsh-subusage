// Grok CLI 计费代理 `?format=credits` 在部分统一计费账号上会 500
// （Failed to serialize billing response）。grok.com 的 gRPC-web
// GetGrokCreditsConfig 仍能用同一 OAuth Bearer 返回 credit_usage_percent。
// 本模块只解析 gRPC-web 帧，不发网络请求。

export const GROK_GRPC_CREDITS_URL = "https://grok.com/grok_api_v2.GrokBuildBilling/GetGrokCreditsConfig";
export const GROK_GRPC_EMPTY_FRAME = new Uint8Array([0, 0, 0, 0, 0]);

function asBytes(body) {
	if (body instanceof Uint8Array) return body;
	if (body instanceof ArrayBuffer) return new Uint8Array(body);
	if (Buffer.isBuffer(body)) return new Uint8Array(body.buffer, body.byteOffset, body.byteLength);
	return undefined;
}

function readVarint(message, offset) {
	let result = 0;
	let shift = 0;
	let next = offset;
	while (next < message.length && shift <= 35) {
		const byte = message[next++];
		result |= (byte & 0x7f) << shift;
		if ((byte & 0x80) === 0) return { value: result >>> 0, next };
		shift += 7;
	}
	return undefined;
}

function skipField(message, offset, wire) {
	if (wire === 0) return readVarint(message, offset)?.next;
	if (wire === 1) return offset + 8 <= message.length ? offset + 8 : undefined;
	if (wire === 2) {
		const length = readVarint(message, offset);
		if (!length) return undefined;
		const next = length.next + length.value;
		return next <= message.length ? next : undefined;
	}
	if (wire === 5) return offset + 4 <= message.length ? offset + 4 : undefined;
	return undefined;
}

function readLengthDelimitedField(message, fieldNumber) {
	let offset = 0;
	while (offset < message.length) {
		const tag = message[offset++];
		if (tag === undefined) return undefined;
		const field = tag >>> 3;
		const wire = tag & 7;
		if (wire === 2) {
			const length = readVarint(message, offset);
			if (!length) return undefined;
			offset = length.next;
			const value = message.subarray(offset, offset + length.value);
			offset += length.value;
			if (field === fieldNumber) return value;
			continue;
		}
		const skipped = skipField(message, offset, wire);
		if (skipped === undefined) return undefined;
		offset = skipped;
	}
	return undefined;
}

function readFloatField(message, fieldNumber) {
	let offset = 0;
	while (offset < message.length) {
		const tag = message[offset++];
		if (tag === undefined) return undefined;
		const field = tag >>> 3;
		const wire = tag & 7;
		if (wire === 5) {
			if (offset + 4 > message.length) return undefined;
			const value = new DataView(message.buffer, message.byteOffset + offset, 4).getFloat32(0, true);
			offset += 4;
			if (field === fieldNumber) return value;
			continue;
		}
		const skipped = skipField(message, offset, wire);
		if (skipped === undefined) return undefined;
		offset = skipped;
	}
	return undefined;
}

function readTimestampField(message, fieldNumber) {
	const nested = readLengthDelimitedField(message, fieldNumber);
	if (!nested) return undefined;
	let offset = 0;
	let seconds;
	while (offset < nested.length) {
		const tag = nested[offset++];
		if (tag === undefined) break;
		const field = tag >>> 3;
		const wire = tag & 7;
		if (wire === 0) {
			const value = readVarint(nested, offset);
			if (!value) break;
			offset = value.next;
			if (field === 1) seconds = value.value;
			continue;
		}
		const skipped = skipField(nested, offset, wire);
		if (skipped === undefined) break;
		offset = skipped;
	}
	if (seconds === undefined) return undefined;
	return new Date(seconds * 1000).toISOString();
}

function firstGrpcWebDataMessage(bytes) {
	let offset = 0;
	while (offset + 5 <= bytes.length) {
		const compressed = bytes[offset];
		const length = (bytes[offset + 1] << 24) | (bytes[offset + 2] << 16) | (bytes[offset + 3] << 8) | bytes[offset + 4];
		offset += 5;
		if (length < 0 || offset + length > bytes.length) return undefined;
		const frame = bytes.subarray(offset, offset + length);
		offset += length;
		if (compressed === 0x80 || compressed !== 0) continue;
		if (frame.length >= 11 && Buffer.from(frame.subarray(0, 11)).toString("utf8") === "grpc-status") continue;
		return frame;
	}
	return undefined;
}

function periodType(startIso, endIso) {
	if (!startIso || !endIso) return undefined;
	const start = Date.parse(startIso);
	const end = Date.parse(endIso);
	if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return undefined;
	const days = (end - start) / 86400000;
	if (days >= 4 && days <= 12) return "USAGE_PERIOD_TYPE_WEEKLY";
	if (days >= 20 && days <= 45) return "USAGE_PERIOD_TYPE_MONTHLY";
	return undefined;
}

/**
 * 把 GetGrokCreditsConfig 的 gRPC-web 响应收成 normalizeSuperGrok 认识的 JSON 形态。
 * 解析失败返回 undefined，不编造 0%。
 */
export function parseGrokCreditsGrpcWeb(body) {
	const bytes = asBytes(body);
	if (!bytes?.length) return undefined;
	const message = firstGrpcWebDataMessage(bytes);
	if (!message) return undefined;
	const config = readLengthDelimitedField(message, 1) ?? message;
	const usedPercent = readFloatField(config, 1);
	const start = readTimestampField(config, 4);
	const end = readTimestampField(config, 5);
	const type = periodType(start, end);
	const currentPeriod = end || start
		? { ...(type ? { type } : {}), ...(start ? { start } : {}), ...(end ? { end } : {}) }
		: undefined;
	if (usedPercent !== undefined && !(typeof usedPercent === "number" && Number.isFinite(usedPercent))) return undefined;
	if (usedPercent === undefined && !currentPeriod) return undefined;
	return {
		config: {
			...(usedPercent !== undefined ? { creditUsagePercent: usedPercent } : {}),
			...(currentPeriod ? { currentPeriod } : {})
		}
	};
}
