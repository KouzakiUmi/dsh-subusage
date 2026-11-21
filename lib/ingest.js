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

import { canonicalizeEntry } from "./quota-entry.js";

export const INGEST_VERSION = 1;
/** provider id 前缀：与 33 个内置 provider 彻底隔离，推送方改名也不会撞。 */
export const INGEST_PREFIX = "ingest:";
const MAX_SOURCES = 50;
const MAX_WINDOWS = 16;
const MAX_EXTRAS = 40;
const MAX_STRING = 200;
const MAX_BYTES = 1024 * 1024;
const SOURCE_PATTERN = /^[a-z0-9][a-z0-9._-]{0,63}$/i;
/** 与 Host 落盘闸门同口径：疑似凭据形态一律不落盘。 */
const SECRET_SHAPE = /(?:Bearer\s|sk-[A-Za-z0-9]{16,}|cog_[A-Za-z0-9]{16,}|gh[psuo]_[A-Za-z0-9]{20,}|eyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}|devin-session-token\$|xox[abp]-)/;
const WINDOW_KINDS = ["5h", "day", "week", "month", "period", "rolling", "7d", "sub"];
const EXTRA_KINDS = ["balance", "plan", "note", "spend", "status", "account"];

const isObject = value => !!value && typeof value === "object" && !Array.isArray(value);
const finite = value => typeof value === "number" && Number.isFinite(value) ? value : undefined;
const text = (value, max = MAX_STRING) => typeof value === "string" && value.trim() ? value.trim().slice(0, max) : "";

/** 推送方的 source 名是否合法（合法才能拼成 provider id）。 */
export function isValidIngestSource(source) {
	return typeof source === "string" && SOURCE_PATTERN.test(source);
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
export function parseIngestPayload(payload, now = Date.now) {
	if (!isObject(payload)) return { error: "推送内容必须是一个对象" };
	const source = text(payload.source, 64);
	if (!isValidIngestSource(source)) return { error: "source 缺失或非法：需要 [a-z0-9][a-z0-9._-]{0,63}" };

	const diagnostics = [];
	const windows = [];
	const rawWindows = Array.isArray(payload.windows) ? payload.windows.slice(0, MAX_WINDOWS) : [];
	if (Array.isArray(payload.windows) && payload.windows.length > MAX_WINDOWS) diagnostics.push(`窗口超过 ${MAX_WINDOWS} 条，已截断`);
	for (const [index, raw] of rawWindows.entries()) {
		if (!isObject(raw)) { diagnostics.push(`windows[${index}] 不是对象，已跳过`); continue; }
		const percent = finite(raw.percent);
		if (percent === undefined || percent < 0 || percent > 100) { diagnostics.push(`windows[${index}] 的 percent 必须是 0–100 的数字，已跳过`); continue; }
		const kind = WINDOW_KINDS.includes(raw.kind) ? raw.kind : "period";
		if (raw.kind !== undefined && !WINDOW_KINDS.includes(raw.kind)) diagnostics.push(`windows[${index}] 的 kind「${text(raw.kind, 24)}」未知，按 period 处理`);
		const resetsAt = typeof raw.resetsAt === "string" && Number.isFinite(Date.parse(raw.resetsAt)) ? new Date(raw.resetsAt).toISOString() : undefined;
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
		if (raw.kind !== undefined && !EXTRA_KINDS.includes(raw.kind)) diagnostics.push(`extras[${index}] 的 kind「${text(raw.kind, 24)}」未知，按 note 处理`);
		const value = text(raw.value);
		if (!value) { diagnostics.push(`extras[${index}] 的 value 为空，已跳过`); continue; }
		extras.push({ kind, value });
	}

	// 直接给 QuotaEntry 元素也认（推送方本来就用本插件的契约时不必降级成 windows/extras）。
	const quotas = Array.isArray(payload.quotas) ? payload.quotas.filter(isObject).slice(0, MAX_WINDOWS + MAX_EXTRAS) : undefined;

	const state = payload.state === "error" ? "error" : "ok";
	const error = state === "error" ? text(payload.error) || "推送方报告读取失败" : "";
	if (state === "ok" && !windows.length && !extras.length && !(quotas && quotas.length)) {
		return { error: "推送内容里没有任何可展示的额度（windows / extras / quotas 都为空）" };
	}

	const ttlMs = finite(payload.ttlMs) !== undefined && payload.ttlMs > 0 ? Math.min(payload.ttlMs, 7 * 86400000) : undefined;
	const label = text(payload.label, 64) || source;
	const at = finite(payload.receivedAt) ?? now();
	const record = {
		source,
		label,
		state,
		...(error ? { error } : {}),
		windows,
		extras,
		...(quotas && quotas.length ? { quotas } : {}),
		...(text(payload.coverage, 16) ? { coverage: text(payload.coverage, 16) } : {}),
		...(ttlMs !== undefined ? { ttlMs } : {}),
		receivedAt: at,
		...(diagnostics.length ? { diagnostics } : {})
	};
	// 落盘前过秘密闸门：宁可拒绝这次推送，也不往明文副本里写 token。
	if (SECRET_SHAPE.test(JSON.stringify(record))) return { error: "推送内容里出现疑似凭据形态，已拒绝写入" };
	if (JSON.stringify(record).length > 64 * 1024) return { error: "单条推送超过 64 KB 上限" };
	return { record };
}

/** detail 只保留本插件认识的字段，其余丢弃。 */
function sanitizeDetail(detail) {
	const out = {};
	for (const key of ["used", "limit", "left", "remaining", "unit", "unitKind", "scope", "note", "planName", "leftText"]) {
		const value = detail[key];
		if (typeof value === "number" && Number.isFinite(value)) out[key] = value;
		else if (typeof value === "string" && value.trim()) out[key] = value.trim().slice(0, MAX_STRING);
	}
	return out;
}

/**
 * 把一条记的推送变成 QuotaEntry（`ingest:<source>`）。
 * 过期不隐藏：数据是对方给的，本插件不做「它已经失效」的判断，只把 `freshness` 标成 stale。
 */
export function ingestEntry(record, now = Date.now()) {
	const expired = record.ttlMs !== undefined && now - record.receivedAt > record.ttlMs;
	const entry = {
		providerId: `${INGEST_PREFIX}${record.source}`,
		label: record.label,
		state: record.state,
		...(record.error ? { error: record.error, errorCode: "subusage/ingest" } : {}),
		windows: record.windows || [],
		extras: record.extras || [],
		...(record.quotas ? { quotas: record.quotas } : {}),
		coverage: record.coverage === "partial" ? "partial" : "complete",
		freshness: expired ? "stale" : "fresh",
		lastAttemptAt: new Date(record.receivedAt).toISOString(),
		...(record.state === "ok" ? { lastSuccessAt: new Date(record.receivedAt).toISOString() } : {}),
		ingestSource: record.source,
		...(record.ttlMs !== undefined ? { ingestTtlMs: record.ttlMs } : {}),
		...(record.diagnostics ? { diagnostics: record.diagnostics } : {})
	};
	return canonicalizeEntry(entry);
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
	}

	load() {
		if (this.loaded) return this.sources;
		this.loaded = true;
		let raw;
		try { raw = this.io.readFileSync(this.path, "utf8"); } catch { return this.sources; }
		if (typeof raw !== "string" || raw.length > MAX_BYTES) return this.sources;
		let parsed;
		try { parsed = JSON.parse(raw); } catch { return this.sources; }
		if (!isObject(parsed) || parsed.version !== INGEST_VERSION || !isObject(parsed.sources)) return this.sources;
		for (const [source, record] of Object.entries(parsed.sources)) {
			if (!isValidIngestSource(source) || !isObject(record)) continue;
			const at = finite(record.receivedAt);
			if (at === undefined || at <= 0) continue;
			this.sources.set(source, { ...record, source });
		}
		return this.sources;
	}

	/** 写入一条（同名覆盖），返回落盘后的记录。 */
	put(record) {
		this.load();
		this.sources.set(record.source, record);
		// 源数上限：按最近推送时间保留最新的 MAX_SOURCES 个。
		if (this.sources.size > MAX_SOURCES) {
			const kept = [...this.sources.values()].sort((a, b) => b.receivedAt - a.receivedAt).slice(0, MAX_SOURCES);
			this.sources = new Map(kept.map(item => [item.source, item]));
		}
		this.flush();
		return record;
	}

	delete(source) {
		this.load();
		const removed = this.sources.delete(source);
		if (removed) this.flush();
		return removed;
	}

	get(source) {
		return this.load().get(source);
	}

	list() {
		return [...this.load().values()].sort((a, b) => a.source.localeCompare(b.source));
	}

	flush() {
		const payload = { version: INGEST_VERSION, savedAt: this.now(), sources: Object.fromEntries(this.sources) };
		let text0;
		try { text0 = JSON.stringify(payload); } catch (error) { this.onError(error); return false; }
		if (typeof text0 !== "string" || text0.length > MAX_BYTES) { this.onError(new Error("被动接入数据超过容量上限")); return false; }
		try {
			this.io.mkdirSync?.(dirnameOf(this.path), { recursive: true, mode: 0o700 });
			const tmp = `${this.path}.tmp`;
			this.io.writeFileSync(tmp, text0, { encoding: "utf8", mode: 0o600 });
			this.io.chmodSync?.(tmp, 0o600);
			this.io.renameSync(tmp, this.path);
			return true;
		} catch (error) {
			this.onError(error);
			return false;
		}
	}
}

function dirnameOf(path) {
	const index = Math.max(path.lastIndexOf("/"), path.lastIndexOf("\\"));
	return index > 0 ? path.slice(0, index) : ".";
}
