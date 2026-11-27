/**
 * 额度暂存层：把已经读到的额度条目固化到磁盘，让 UI 先显示上次结果。
 *
 * 为什么需要它：额度条目的缓存过去只在内存里（60 秒 TTL），DSH 重启、插件重载或
 * 隔一分钟再打开设置页，所有条目都得重新打一遍上游——打开设置就是一次全量拉取。
 * 这里把「读到的结果」单独存一份：UI 读取走暂存（不碰上游），上游拉取由显式刷新
 * 与过期的 revalidate 驱动，两条路径分开。
 *
 * 边界（刻意保持很窄）：
 * - 只存**已成功读到**的条目（`state === "ok"`）；错误 / 缺凭据不落盘——否则重启后会
 *   把过期的错误当现状显示；
 * - 条目由宿主先用 `wireJson()` 净化再交进来，本模块只负责序列化与 IO，不解析业务语义；
 * - 文件按 0600 写（tmp + rename）；Windows 上 Node 的 stat.mode 恒显示 666、chmod 只能切只读位，
 *   实际保护来自所在目录 `~/.dsh` 的用户 ACL —— 与同目录的 dsh-subusage.json / 凭据库同一级别，
 *   不额外承诺 POSIX 语义；损坏 / 版本不符 / 超大一律当作空（额度是展示数据，读不到就重拉，
 *   绝不因为一份缓存坏了影响插件启动）；
 * - 有上限（条目数与字节数），超出时按 `at` 丢弃最旧的。
 */

export const SNAPSHOT_VERSION = 1;
/** 条目数上限：33 条内置 + 多 Key 监控 + 自定义实例，200 条足够且不会无限膨胀。 */
const MAX_ENTRIES = 200;
/** 文件大小上限：条目里只有窗口/金额/说明，2 MiB 覆盖最坏情况。 */
const MAX_BYTES = 2 * 1024 * 1024;
/**
 * 数据源暂存上限：一个 provider 可能有多个上游端点（MiMo 的余额/套餐/用量、Z.ai 的额度/账户余额），
 * 每一路单独存一份原始响应，供「这一路这次失败」时用上次成功的结果顶上。
 */
const MAX_SOURCES_PER_KEY = 16;
const MAX_SOURCE_KEYS = 400;
/** 落盘节流：一轮刷新会连写十几次，合并成一次。 */
const FLUSH_DELAY_MS = 800;

const isObject = value => value && typeof value === "object" && !Array.isArray(value);
const finite = value => typeof value === "number" && Number.isFinite(value) ? value : undefined;

export class SnapshotStore {
	/**
	 * @param {object} options
	 * @param {{ readFileSync, writeFileSync, renameSync, chmodSync, mkdirSync }} options.io 宿主注入的文件操作
	 * @param {string} options.path 暂存文件绝对路径
	 * @param {() => number} [options.now]
	 * @param {(error: Error) => void} [options.onError] 写失败只记录，不影响读取
	 */
	constructor({ io, path, now = Date.now, onError } = {}) {
		if (!io || typeof io.readFileSync !== "function") throw new TypeError("SnapshotStore 需要 io");
		if (typeof path !== "string" || !path) throw new TypeError("SnapshotStore 需要 path");
		this.io = io;
		this.path = path;
		this.now = now;
		this.onError = typeof onError === "function" ? onError : () => {};
		this.entries = new Map();
		// 数据源级暂存：`Map<cacheKey, { [source]: { body, at } }>`。与 entries 分开存，
		// 因为它们的生命周期不同——整条 entry 判失败时，某个源单独的成功结果仍要留着。
		this.sources = new Map();
		this.loaded = false;
		this.dirty = false;
		this.timer = null;
		this.disposed = false;
	}

	/**
	 * 载入磁盘暂存（幂等，只读一次）。返回 `Map<key, { entry, at, fingerprint }>`。
	 * 任何读取/解析问题都退化成空 Map：额度是展示数据，读不到就重拉。
	 */
	load() {
		if (this.loaded) return this.entries;
		this.loaded = true;
		let raw;
		try { raw = this.io.readFileSync(this.path, "utf8"); } catch { return this.entries; }
		if (typeof raw !== "string" || raw.length > MAX_BYTES) return this.entries;
		let parsed;
		try { parsed = JSON.parse(raw); } catch { return this.entries; }
		if (!isObject(parsed) || parsed.version !== SNAPSHOT_VERSION || !isObject(parsed.entries)) return this.entries;
		for (const [key, row] of Object.entries(parsed.entries)) {
			if (typeof key !== "string" || !key || key.length > 200) continue;
			if (!isObject(row) || !isObject(row.entry)) continue;
			const at = finite(row.at);
			if (at === undefined || at <= 0) continue;
			this.entries.set(key, {
				entry: row.entry,
				at,
				fingerprint: typeof row.fingerprint === "string" ? row.fingerprint : "",
			});
		}
		// 数据源级暂存是可选段：老文件没有它，按空处理（版本号不升，读不到就当没存过）。
		if (isObject(parsed.sources)) {
			for (const [key, row] of Object.entries(parsed.sources)) {
				if (typeof key !== "string" || !key || key.length > 200 || !isObject(row)) continue;
				const bucket = {};
				for (const [source, cell] of Object.entries(row)) {
					if (typeof source !== "string" || !source || source.length > 40 || !isObject(cell)) continue;
					const at = finite(cell.at);
					if (at === undefined || at <= 0 || !isObject(cell.body)) continue;
					bucket[source] = { body: cell.body, at, ...(typeof cell.fingerprint === "string" ? { fingerprint: cell.fingerprint } : {}) };
				}
				if (Object.keys(bucket).length) this.sources.set(key, bucket);
			}
		}
		return this.entries;
	}

	/** 取一条暂存（含载入）。没有则 undefined。 */
	get(key) {
		return this.load().get(key);
	}

	/** 记一条读到成功结果的条目；`entry` 必须已被宿主净化（不含秘密）。 */
	put(key, { entry, at = this.now(), fingerprint = "" } = {}) {
		if (this.disposed || typeof key !== "string" || !key || !isObject(entry)) return;
		if (entry.state !== "ok") return; // 失败 / 缺凭据不落盘，避免重启后把过期错误当现状
		this.entries.set(key, { entry, at, fingerprint });
		this.trim();
		this.markDirty();
	}

	/** 删掉一条（凭据变化、条目被移除时）。 */
	delete(key) {
		const removedEntry = this.entries.delete(key);
		const removedSources = this.sources.delete(key);
		if (removedEntry || removedSources) this.markDirty();
	}

	/**
	 * 记一个数据源这次的原始响应（宿主已净化、不含秘密）。**与 entry 判成功/失败无关**：
	 * 正是要留住「整条判失败、但这一路读到了」的结果，读取时才能把上次的余额继续显示出来。
	 */
	putSource(key, source, body, fingerprint) {
		if (this.disposed || typeof key !== "string" || !key || typeof source !== "string" || !source) return;
		if (!isObject(body)) return; // 只存对象响应；标量/数组形态的上游响应没有可回放的字段
		const bucket = this.sources.get(key) ?? {};
		bucket[source] = { body, at: this.now(), ...(typeof fingerprint === "string" ? { fingerprint } : {}) };
		// 每个条目最多留 MAX_SOURCES_PER_KEY 路，按时间淘汰最旧。
		const names = Object.keys(bucket);
		if (names.length > MAX_SOURCES_PER_KEY) {
			names.sort((a, b) => bucket[b].at - bucket[a].at);
			for (const name of names.slice(MAX_SOURCES_PER_KEY)) delete bucket[name];
		}
		this.sources.set(key, bucket);
		this.trimSources();
		this.markDirty();
	}

	/** 取某条目某一路的上次成功响应；没有则 undefined。 */
	getSource(key, source) {
		this.load();
		return this.sources.get(key)?.[source];
	}

	/** 落盘：先按 `at` 淘汰到条目上限，再原子写。失败只上报，不影响后续读写。 */
	flush() {
		if (this.timer !== null) { clearTimeout(this.timer); this.timer = null; }
		if (!this.dirty || this.disposed) { this.dirty = false; return; }
		this.trim();
		const sources = Object.fromEntries([...this.sources].filter(([, bucket]) => Object.keys(bucket).length));
		const payload = { version: SNAPSHOT_VERSION, savedAt: this.now(), entries: Object.fromEntries(this.entries), ...(Object.keys(sources).length ? { sources } : {}) };
		let text;
		try { text = JSON.stringify(payload); } catch (error) { this.onError(error); return; }
		if (typeof text !== "string" || text.length > MAX_BYTES) {
			// 超上限说明条目形状异常（不该发生）：丢掉最旧的一半再试一次，仍超就放弃本次落盘。
			const keys = [...this.entries.entries()].sort((a, b) => b[1].at - a[1].at).slice(0, Math.ceil(this.entries.size / 2));
			this.entries = new Map(keys);
			try { text = JSON.stringify({ version: SNAPSHOT_VERSION, savedAt: this.now(), entries: Object.fromEntries(this.entries), ...(Object.keys(sources).length ? { sources } : {}) }); } catch { return; }
			if (typeof text !== "string" || text.length > MAX_BYTES) return;
		}
		try {
			this.io.mkdirSync?.(this.dirOf(), { recursive: true, mode: 0o700 });
			const tmp = `${this.path}.tmp`;
			this.io.writeFileSync(tmp, text, { encoding: "utf8", mode: 0o600 });
			this.io.chmodSync?.(tmp, 0o600);
			this.io.renameSync(tmp, this.path);
			this.dirty = false;
		} catch (error) {
			this.onError(error);
		}
	}

	dispose() {
		this.flush();
		this.disposed = true;
		this.entries.clear();
		this.sources.clear();
	}

	/** 标脏并安排一次节流落盘。 */
	markDirty() {
		this.dirty = true;
		if (this.disposed || this.timer !== null) return;
		this.timer = setTimeout(() => { this.timer = null; this.flush(); }, FLUSH_DELAY_MS);
		this.timer?.unref?.();
	}

	/** 条目数上限：保留 `at` 最新的 MAX_ENTRIES 条。 */
	trim() {
		if (this.entries.size <= MAX_ENTRIES) return;
		const kept = [...this.entries.entries()].sort((a, b) => b[1].at - a[1].at).slice(0, MAX_ENTRIES);
		this.entries = new Map(kept);
	}

	/** 数据源条目上限：按每个条目里最新的一路时间保留 MAX_SOURCE_KEYS 个条目。 */
	trimSources() {
		if (this.sources.size <= MAX_SOURCE_KEYS) return;
		const newest = bucket => Math.max(...Object.values(bucket).map(cell => cell.at || 0));
		const kept = [...this.sources.entries()].sort((a, b) => newest(b[1]) - newest(a[1])).slice(0, MAX_SOURCE_KEYS);
		this.sources = new Map(kept);
	}

	dirOf() {
		const index = Math.max(this.path.lastIndexOf("/"), this.path.lastIndexOf("\\"));
		return index > 0 ? this.path.slice(0, index) : ".";
	}
}
