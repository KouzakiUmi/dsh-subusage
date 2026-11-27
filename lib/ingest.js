// 被动接入：其它插件把额度数据推过来，本插件只负责持久化与展示。
//
// 方向是**反的**：内置 provider 由本插件自己去上游拉；被动接入的源由对方推，本插件不主动取数、
// 不了解对方的上游，只在收到时校验形状、存盘、并在界面上给一张独立的卡。所以这里没有凭据、
// 没有轮询、没有重试——数据新鲜度由推送方的 `ttlMs` 声明，本插件只按它标 stale。
//
// 边界（刻意窄）：
// - source 名限制在 `[a-z0-9][a-z0-9._-]{0,63}`：它要拼进 provider id（`ingest:<source>`）与
//   HTTP/日志，不允许出现空白、斜杠、冒号，避免与内置 provider 撞名或破坏 wire 形状；
// - 形状校验只认本插件已有的额度元素（window / extras / quotas），未知字段丢弃并计入
//   `diagnostics`，不猜、不透传上游任意 JSON；
// - 落盘走与设置相同的秘密闸门：命中疑似凭据形态就整条拒绝（不是静默存下去）；
// - 单源与总量都有上限，防止某个推送方把配置文件撑爆。

import { canonicalizeEntry, legacyFromQuotas, quotaElement } from "./quota-entry.js";

export const INGEST_VERSION = 1;
/** provider id 前缀：与 33 个内置 provider 彻底隔离，推送方改名也不会撞。 */
export const INGEST_PREFIX = "ingest:";
const MAX_SOURCES = 50;
const MAX_WINDOWS = 16;
const MAX_EXTRAS = 40;
const MAX_STRING = 200;
const MAX_RECORD_BYTES = 64 * 1024;
const MAX_BYTES = 1024 * 1024;
const SOURCE_PATTERN = /^[a-z0-9][a-z0-9._-]{0,63}$/i;
/** 与 Host 落盘闸门同口径：疑似凭据形态一律不落盘。 */
const SECRET_SHAPE = /(?:Bearer\s|sk-[A-Za-z0-9]{16,}|cog_[A-Za-z0-9]{16,}|gh[psuo]_[A-Za-z0-9]{20,}|eyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}|devin-session-token\$|xox[abp]-)/;
const WINDOW_KINDS = ["5h", "day", "week", "month", "period", "rolling", "7d", "sub"];
const EXTRA_KINDS = ["balance", "plan", "note", "spend", "status", "account"];

const isObject = value => !!value && typeof value === "object" && !Array.isArray(value);
const finite = value => Number.isFinite(value) ? (Object.is(value, -0) ? 0 : value) : undefined;
const text = (value, max = MAX_STRING) => typeof value === "string" && value.trim() ? value.trim().slice(0, max) : "";
const bytes = value => Buffer.byteLength(value, "utf8");
const validReceivedAt = value => Number.isSafeInteger(value) && value > 0 && value <= 8_640_000_000_000_000;
const iso = value => typeof value === "string" && Number.isFinite(Date.parse(value)) ? new Date(value).toISOString() : undefined;

/** 推送方的 source 名是否合法（合法才能拼成 provider id）。 */
export function isValidIngestSource(source) {
	return typeof source === "string" && source.trim() === source && SOURCE_PATTERN.test(source);
}

/** 某个 provider id 是不是被动接入的源（`ingest:<source>`）。 */
export function isIngestId(id) {
	return typeof id === "string" && id.startsWith(INGEST_PREFIX) && isValidIngestSource(id.slice(INGEST_PREFIX.length));
}

export function ingestSourceOf(id) {
	return isIngestId(id) ? id.slice(INGEST_PREFIX.length) : "";
}

/**
 * 校验并规范化一次推送。返回 `{ record }` 或 `{ error }`——不抛错：
 * 推送方是别的插件，一次坏数据不该让它的调用链炸掉，也不该污染已有数据。
 */
export function parseIngestPayload(payload, now = Date.now, legacy = false) {
	try { return normalizeIngestPayload(payload, now, legacy); }
	catch { return { error: "推送内容无法读取" }; }
}

function normalizeIngestPayload(payload, now, legacy) {
	if (!isObject(payload)) return { error: "推送内容必须是一个对象" };
	const source = payload.source;
	if (!isValidIngestSource(source)) return { error: "source 缺失或非法：需要 [a-z0-9][a-z0-9._-]{0,63}" };
	const diagnostics = [];
	const at = payload.receivedAt === undefined ? now() : payload.receivedAt;
	if (!validReceivedAt(at)) return { error: "receivedAt 必须是有效的正整数毫秒时间戳" };
	if (payload.quotas !== undefined && !Array.isArray(payload.quotas)) return { error: "quotas 必须是数组" };
	const quotas = Array.isArray(payload.quotas) ? sanitizeQuotas(payload.quotas, diagnostics) : undefined;
	const { windows, extras } = quotas === undefined ? sanitizeLegacy(payload, diagnostics) : legacyFromQuotas(quotas);
	const state = payload.state === "error" ? "error" : "ok";
	if (state === "ok" && !windows.length && !extras.length && !(quotas && quotas.length)) {
		return { error: "推送内容里没有任何可展示的额度（windows / extras / quotas 都为空）" };
	}
	const ttlMs = finite(payload.ttlMs) > 0 ? Math.min(payload.ttlMs, 7 * 86400000) : undefined;
	const record = {
		source,
		label: text(payload.label, 64) || source,
		state,
		...(state === "error" ? { error: text(payload.error) || "推送方报告读取失败" } : {}),
		...(quotas === undefined ? { windows, extras } : { quotas }),
		...(payload.coverage === "partial" ? { coverage: "partial" } : {}),
		...(ttlMs !== undefined ? { ttlMs } : {}),
		receivedAt: at,
		...(diagnostics.length ? { diagnostics } : {})
	};
	const json = JSON.stringify(record);
	if (SECRET_SHAPE.test(json)) return { error: "推送内容里出现疑似凭据形态，已拒绝写入" };
	if ((legacy ? json.length : bytes(json)) > MAX_RECORD_BYTES) return { error: "单条推送超过 64 KiB 上限" };
	return { record };
}

function sanitizeLegacy(payload, diagnostics) {
	const windows = [];
	const rawWindows = Array.isArray(payload.windows) ? payload.windows.slice(0, MAX_WINDOWS) : [];
	if (Array.isArray(payload.windows) && payload.windows.length > MAX_WINDOWS) diagnostics.push(`窗口超过 ${MAX_WINDOWS} 条，已截断`);
	for (const [index, raw] of rawWindows.entries()) {
		if (!isObject(raw)) { diagnostics.push(`windows[${index}] 不是对象，已跳过`); continue; }
		const percent = finite(raw.percent);
		if (percent === undefined || percent < 0 || percent > 100) { diagnostics.push(`windows[${index}] 的 percent 必须是 0–100 的数字，已跳过`); continue; }
		const kind = WINDOW_KINDS.includes(raw.kind) ? raw.kind : "period";
		if (raw.kind !== undefined && !WINDOW_KINDS.includes(raw.kind)) diagnostics.push(`windows[${index}] 的 kind 未知，按 period 处理`);
		const resetsAt = iso(raw.resetsAt);
		if (raw.resetsAt !== undefined && resetsAt === undefined) diagnostics.push(`windows[${index}] 的 resetsAt 无法解析，已忽略`);
		windows.push({
			kind,
			percent,
			status: percent >= 100 ? "rate-limited" : "ok",
			...(resetsAt ? { resetsAt } : {}),
			...(isObject(raw.detail) ? { detail: sanitizeDetail(raw.detail) } : {}),
			...(text(raw.groupLabel, 64) ? { groupLabel: text(raw.groupLabel, 64) } : {})
		});
	}

	const extras = [];
	const rawExtras = Array.isArray(payload.extras) ? payload.extras.slice(0, MAX_EXTRAS) : [];
	if (Array.isArray(payload.extras) && payload.extras.length > MAX_EXTRAS) diagnostics.push(`附加行超过 ${MAX_EXTRAS} 条，已截断`);
	for (const [index, raw] of rawExtras.entries()) {
		if (!isObject(raw)) { diagnostics.push(`extras[${index}] 不是对象，已跳过`); continue; }
		const kind = EXTRA_KINDS.includes(raw.kind) ? raw.kind : "note";
		if (raw.kind !== undefined && !EXTRA_KINDS.includes(raw.kind)) diagnostics.push(`extras[${index}] 的 kind 未知，按 note 处理`);
		const value = text(raw.value);
		if (!value) { diagnostics.push(`extras[${index}] 的 value 为空，已跳过`); continue; }
		extras.push({ kind, value });
	}

	return { windows, extras };
}

/** detail 只保留本插件认识的字段，其余丢弃。 */
function sanitizeDetail(detail) {
	const out = {};
	for (const key of ["used", "limit", "left", "remaining"]) if (finite(detail[key]) !== undefined) out[key] = finite(detail[key]);
	for (const key of ["unit", "unitKind", "scope", "note", "planName", "leftText"]) if (text(detail[key])) out[key] = text(detail[key]);
	return out;
}

const QUOTA_TEXT_FIELDS = ["type", "id", "label", "pool", "poolLabel", "poolScope", "period", "status", "scope", "budgetScope", "role", "leftText", "planName", "note", "limitSource", "componentOf"];
const QUOTA_NUMBER_FIELDS = ["order", "percent", "used", "limit", "left"];
const QUOTA_DATE_FIELDS = ["resetsAt", "expiresAt", "currentPeriodEnd"];
const QUOTA_FIELDS = new Set([...QUOTA_TEXT_FIELDS, ...QUOTA_NUMBER_FIELDS, ...QUOTA_DATE_FIELDS, "value", "text", "amount", "remaining", "subject", "aggregation", "cascade", "blockedBy"]);
const numericAmount = raw => isObject(raw) ? { value: finite(raw.value), unit: text(raw.unit), ...(text(raw.unitKind) ? { unitKind: text(raw.unitKind) } : {}) } : undefined;

/** 只向统一额度归一化器传声明字段，避免其兼容性透传把上游任意内容带进上报文件。 */
function sanitizeQuota(raw, index, diagnostics) {
	if (!isObject(raw)) return undefined;
	if (Object.keys(raw).some(key => !QUOTA_FIELDS.has(key))) diagnostics.push(`quotas[${index}] 含未知字段，已忽略`);
	const projected = {};
	for (const key of QUOTA_TEXT_FIELDS) if (text(raw[key])) projected[key] = text(raw[key]);
	for (const key of QUOTA_NUMBER_FIELDS) if (finite(raw[key]) !== undefined) projected[key] = finite(raw[key]);
	if (raw.type === "window") {
		const percent = raw.percent === undefined && projected.used !== undefined && projected.limit > 0
			? Math.round((projected.used / projected.limit) * 10000) / 100 : finite(raw.percent);
		if (percent === undefined || percent < 0 || percent > 100) return undefined;
		projected.percent = percent;
		if (percent === 100) projected.status = "rate-limited";
		else if (projected.status === "ok") delete projected.status;
	}
	for (const key of QUOTA_DATE_FIELDS) {
		const stamp = iso(raw[key]);
		if (stamp) projected[key] = stamp;
		else if (raw[key] !== undefined) diagnostics.push(`quotas[${index}] 的 ${key} 无法解析，已忽略`);
	}
	for (const key of ["amount", "remaining"]) if (isObject(raw[key])) projected[key] = numericAmount(raw[key]);
	if (text(raw.value ?? raw.text)) projected.value = text(raw.value ?? raw.text);
	if (isObject(raw.subject)) projected.subject = { kind: text(raw.subject.kind), id: text(raw.subject.id) };
	if (isObject(raw.aggregation)) projected.aggregation = { balance: text(raw.aggregation.balance) || undefined, reason: text(raw.aggregation.reason) };
	if (raw.cascade === true) projected.cascade = true;
	if (Array.isArray(raw.blockedBy)) projected.blockedBy = raw.blockedBy.slice(0, MAX_WINDOWS).map(value => text(value)).filter(Boolean);
	const issues = [];
	const element = quotaElement(projected, index, issues);
	if (issues.length && element) diagnostics.push(`quotas[${index}] 含不支持的字段值，已归一化`);
	if (!element || (element.type !== "window" && !legacyFromQuotas([element]).extras.length)) return undefined;
	return element;
}

function sanitizeQuotas(raw, diagnostics) {
	const max = MAX_WINDOWS + MAX_EXTRAS;
	if (raw.length > max) diagnostics.push(`额度元素超过 ${max} 条，已截断`);
	const quotas = [];
	let windows = 0, extras = 0;
	for (const [index, item] of raw.slice(0, max).entries()) {
		const element = sanitizeQuota(item, index, diagnostics);
		if (!element) { diagnostics.push(`quotas[${index}] 没有有效的额度，已跳过`); continue; }
		if (element.type === "window" ? ++windows <= MAX_WINDOWS : ++extras <= MAX_EXTRAS) quotas.push(element);
	}
	if (windows > MAX_WINDOWS) diagnostics.push(`额度窗口超过 ${MAX_WINDOWS} 条，已截断`);
	if (extras > MAX_EXTRAS) diagnostics.push(`非窗口额度超过 ${MAX_EXTRAS} 条，已截断`);
	return quotas;
}

/**
 * 把一条记的推送变成 QuotaEntry（`ingest:<source>`）。
 * 过期不隐藏：数据是对方给的，本插件不做「它已经失效」的判断，只把 `freshness` 标成 stale。
 */
export function ingestEntry(record, now = Date.now()) {
	const expired = record.ttlMs !== undefined && now - record.receivedAt > record.ttlMs;
	const quotas = Array.isArray(record.quotas) ? structuredClone(record.quotas) : undefined;
	const entry = {
		providerId: `${INGEST_PREFIX}${record.source}`,
		label: record.label,
		state: record.state,
		...(record.error ? { error: record.error, errorCode: "subusage/ingest" } : {}),
		...(quotas
			? { quotas, ...legacyFromQuotas(quotas) }
			: { windows: structuredClone(record.windows), extras: structuredClone(record.extras) }),
		coverage: record.coverage === "partial" ? "partial" : "complete",
		freshness: expired ? "stale" : "fresh",
		lastAttemptAt: new Date(record.receivedAt).toISOString(),
		...(record.state === "ok" ? { lastSuccessAt: new Date(record.receivedAt).toISOString() } : {}),
		ingestSource: record.source,
		...(record.ttlMs !== undefined ? { ingestTtlMs: record.ttlMs } : {}),
		...(record.diagnostics ? { diagnostics: [...record.diagnostics] } : {})
	};
	return quotas ? entry : canonicalizeEntry(entry);
}

/**
 * 推送记录仓库：一个 JSON 文件存所有源，0600、原子写。
 * 与额度暂存（snapshot-store）分开——那是可丢的缓存，这是推送方交过来的**数据本体**，丢了就是真丢。
 */
export class IngestStore {
	constructor({ io, path, now = Date.now, onError } = {}) {
		if (!io || typeof io.readFileSync !== "function") throw new TypeError("IngestStore 需要 io");
		if (typeof path !== "string" || !path) throw new TypeError("IngestStore 需要 path");
		this.io = io;
		this.path = path;
		this.now = now;
		this.onError = typeof onError === "function" ? onError : () => {};
		this.sources = new Map();
		this.loaded = false;
		this.readError = false;
	}

	load() {
		if (this.loaded) return this.sources;
		this.loaded = true;
		this.readError = false;
		let raw;
		try { raw = this.io.readFileSync(this.path, "utf8"); }
		catch (error) {
			if (error?.code !== "ENOENT") { this.readError = true; this.loaded = false; this.onError(error); }
			return this.sources;
		}
		// v1 旧版按 UTF-16 长度限制，升级后仍可读取并逐步撤回旧快照。
		if (typeof raw !== "string" || raw.length > MAX_BYTES) { this.readError = true; return this.sources; }
		let parsed;
		try { parsed = JSON.parse(raw); } catch { this.readError = true; return this.sources; }
		if (!isObject(parsed) || parsed.version !== INGEST_VERSION || !isObject(parsed.sources)) { this.readError = true; return this.sources; }
		for (const [source, record] of Object.entries(parsed.sources)) {
			if (!isValidIngestSource(source) || !isObject(record)) continue;
			if (!validReceivedAt(record.receivedAt)) continue;
			const parsedRecord = parseIngestPayload({ ...record, source }, this.now, true).record;
			if (parsedRecord) {
				const diagnostics = Array.isArray(record.diagnostics) ? record.diagnostics.slice(0, MAX_WINDOWS + MAX_EXTRAS).map(value => text(value)).filter(value => value && !SECRET_SHAPE.test(value)) : [];
				if (diagnostics.length) parsedRecord.diagnostics = [...new Set([...diagnostics, ...(parsedRecord.diagnostics ?? [])])];
				this.sources.set(source, parsedRecord);
			}
		}
		return this.sources;
	}

	/** 同名覆盖；先提交磁盘，再发布内存视图。 */
	put(record) {
		const next = new Map(this.load());
		if (this.readError) return { ok: false, error: "无法读取已有上报数据" };
		next.set(record.source, record);
		// 源数上限：按最近推送时间保留最新的 MAX_SOURCES 个。
		if (next.size > MAX_SOURCES) {
			const sorted = [...next.values()].sort((a, b) => b.receivedAt - a.receivedAt || Number(b.source === record.source) - Number(a.source === record.source));
			const evicted = sorted.at(-1);
			if (evicted.source === record.source) return { ok: false, error: `已保留最近 ${MAX_SOURCES} 个来源，本次上报时间更早` };
			next.delete(evicted.source);
		}
		return this.commit(next);
	}

	delete(source) {
		const next = new Map(this.load());
		if (this.readError) return { ok: false, error: "无法读取已有上报数据" };
		if (!next.delete(source)) return { ok: true, removed: false };
		const result = this.commit(next, true);
		return result.ok ? { ok: true, removed: true } : result;
	}

	get(source) {
		return this.load().get(source);
	}

	list() {
		return [...this.load().values()].sort((a, b) => a.source.localeCompare(b.source));
	}

	commit(next, shrinking = false) {
		try {
			const payload = { version: INGEST_VERSION, savedAt: this.now(), sources: Object.fromEntries(next) };
			const json = JSON.stringify(payload);
			if (bytes(json) > MAX_BYTES && (!shrinking || json.length > MAX_BYTES)) return { ok: false, error: "上报数据超过 1 MiB 容量上限" };
			this.io.mkdirSync?.(dirnameOf(this.path), { recursive: true, mode: 0o700 });
			const tmp = `${this.path}.tmp`;
			this.io.writeFileSync(tmp, json, { encoding: "utf8", mode: 0o600 });
			this.io.chmodSync?.(tmp, 0o600);
			this.io.renameSync(tmp, this.path);
			this.sources = next;
			return { ok: true };
		} catch (error) {
			this.onError(error);
			return { ok: false, error: "无法保存上报数据" };
		}
	}
}

function dirnameOf(path) {
	const index = Math.max(path.lastIndexOf("/"), path.lastIndexOf("\\"));
	return index > 0 ? path.slice(0, index) : ".";
}
