// 额度暂存层：把读到的结果固化到磁盘，让「显示」与「拉取」分成两条路径。
//
// 钉五件事：
//  1. SnapshotStore 的读写边界：只收 state=ok、坏文件忽略、版本不符忽略、上限淘汰、原子写；
//  2. Host 读到成功后落盘，新实例启动时回填（不必重启后全量重拉）；
//  3. cachedOnly 读取**不发任何上游请求**，且把过期暂存标 stale + 保留 lastSuccessAt；
//  4. 没有暂存的条目回 loading（「还没读过」≠「读不到」）；
//  5. dispose 时把内存结果落盘。
import assert from "node:assert/strict";
import { loadHostModule } from "./helpers.mjs";
import { SnapshotStore, SNAPSHOT_VERSION } from "../lib/snapshot-store.js";

const { SubUsageService } = await loadHostModule();
const now = Date.parse("2026-11-19T10:00:00+08:00");

/** 内存盘：记录每次写入的 mode，便于核对 0600。 */
function memoryIo() {
	const files = new Map(), writes = [];
	return {
		files, writes,
		readFileSync(path) { if (!files.has(path)) throw Object.assign(new Error("missing"), { code: "ENOENT" }); return files.get(path); },
		writeFileSync(path, value, options) { writes.push({ path, mode: options?.mode }); files.set(path, value); },
		renameSync(from, to) { if (!files.has(from)) throw new Error("rename missing"); files.set(to, files.get(from)); files.delete(from); },
		chmodSync() {}, mkdirSync() {}
	};
}

// ── [1] 纯单元：写入边界 ───────────────────────────────────────────────────
{
	const io = memoryIo();
	const store = new SnapshotStore({ io, path: "dir/cache.json", now: () => now });
	const ok = { providerId: "deepseek", state: "ok", windows: [], extras: [{ kind: "balance", value: "1 CNY" }] };
	store.put("deepseek", { entry: ok, at: now, fingerprint: "fp1" });
	// 非 ok 的条目不落盘：错误 / 缺凭据不是「读到的额度」。
	store.put("kimi-coding", { entry: { providerId: "kimi-coding", state: "error", error: "boom" }, at: now });
	store.put("zai-coding-cn", { entry: { providerId: "zai-coding-cn", state: "no-key" }, at: now });
	assert.deepEqual([...store.load().keys()], ["deepseek"], "只收 state=ok");
	store.flush();
	assert.equal(io.writes.at(-1).mode, 0o600, "暂存文件按 0600 写");
	const parsed = JSON.parse(io.files.get("dir/cache.json"));
	assert.equal(parsed.version, SNAPSHOT_VERSION);
	assert.deepEqual(Object.keys(parsed.entries), ["deepseek"]);
	assert.equal(parsed.entries.deepseek.entry.state, "ok");
	assert.equal(parsed.entries.deepseek.at, now);
	assert.equal(parsed.entries.deepseek.fingerprint, "fp1");

	// 新实例读回；损坏 / 版本不符 / 非对象一律当空。
	const reopened = new SnapshotStore({ io, path: "dir/cache.json", now: () => now });
	assert.equal(reopened.get("deepseek").entry.extras[0].value, "1 CNY");
	for (const broken of ["{oops", JSON.stringify({ version: 999, entries: {} }), JSON.stringify({ version: 1, entries: [] }), "[]"]) {
		const bad = memoryIo();
		bad.files.set("dir/cache.json", broken);
		assert.deepEqual([...new SnapshotStore({ io: bad, path: "dir/cache.json" }).load().keys()], [], `坏暂存按空处理：${broken.slice(0, 20)}`);
	}
	// delete + 上限淘汰
	store.delete("deepseek");
	assert.equal(store.get("deepseek"), undefined);
	const many = new SnapshotStore({ io: memoryIo(), path: "d/c.json", now: () => now });
	for (let i = 0; i < 210; i += 1) many.put(`p${i}`, { entry: { providerId: `p${i}`, state: "ok", windows: [], extras: [] }, at: now + i });
	assert.equal(many.load().size, 200, "超过上限按 at 保留最新 200 条");
	assert.ok(many.get("p209") && !many.get("p0"), "淘汰的是最旧的");
	console.log("PASS SnapshotStore：只收 ok、0600 原子写、坏文件与版本不符按空、delete 与上限淘汰");
}

// ── [2] Host 集成：落盘 → 回填 → cachedOnly 不发上游 ─────────────────────
function harness({ io, settings, reply, clock = now }) {
	const calls = [];
	const ctx = { get: () => undefined };
	const service = new SubUsageService(ctx, {
		io, configPath: "dir/config.json", snapshotPath: "dir/cache.json",
		now: () => clock,
		// 给一把假 Key：让条目走到 state=ok，才能验证「只有成功结果落盘」。
		resolveCredentials: async () => ({ value: "test-key" }),
		resolveEnvironment: () => undefined,
		fetch: async (url, init) => {
			calls.push({ url: String(url), method: init?.method });
			const body = reply(String(url));
			if (body === undefined) return { ok: false, status: 404, text: async () => "" };
			return { ok: true, status: 200, headers: { get: () => null }, text: async () => JSON.stringify(body) };
		}
	});
	return { service, calls };
}
const DEEPSEEK_BODY = { is_available: true, balance_infos: [{ currency: "CNY", total_balance: "12.34", granted_balance: "0.00", topped_up_balance: "12.34" }] };

{
	const io = memoryIo();
	io.files.set("dir/config.json", JSON.stringify({ visibility: { providers: { deepseek: true } } }));
	// 第一轮：真读到并落盘。
	const first = harness({ io, reply: url => (url.includes("deepseek") ? DEEPSEEK_BODY : undefined) });
	const got = await first.service.refresh({ providerIds: ["deepseek"], force: true });
	assert.equal(got.entries[0].state, "ok");
	assert.equal(first.calls.length, 1, "显式 refresh 才发上游");
	first.service.dispose(); // dispose 时落盘
	assert.ok(io.files.get("dir/cache.json"), "dispose 把暂存写盘");

	// 第二轮（模拟重启）：新实例启动即回填，cachedOnly 读取只发 0 个上游请求。
	const second = harness({ io, clock: now + 3600_000, reply: () => { throw new Error("cachedOnly 不该打上游"); } });
	const shown = await second.service.refresh({ providerIds: ["deepseek"], force: false, cachedOnly: true });
	const entry = shown.entries[0];
	assert.equal(second.calls.length, 0, "cachedOnly 一个上游请求都不发");
	assert.equal(entry.state, "ok");
	assert.equal(entry.extras.find(x => x.kind === "balance").value, "12.34 CNY");
	assert.equal(entry.freshness, "stale", "重启回填的暂存按过期标记");
	assert.equal(entry.lastSuccessAt, new Date(now).toISOString(), "保留上次成功时间");
	// 没有暂存的条目回 loading，而不是 no-key / error。
	const missing = (await second.service.refresh({ providerIds: ["kimi-coding"], force: false, cachedOnly: true })).entries[0];
	assert.equal(missing.state, "loading", "没读过 ≠ 读不到");
	assert.equal(second.calls.length, 0);
	second.service.dispose();
	console.log("PASS Host：读到即落盘、重启回填、cachedOnly 零上游请求、没暂存回 loading");
}

// ── [3] 错误 / 缺凭据不落盘：重启后不会把过期错误当现状 ────────────────────
{
	const io = memoryIo();
	io.files.set("dir/config.json", JSON.stringify({ visibility: { providers: { "kimi-coding": true } } }));
	const first = harness({ io, reply: () => undefined }); // 一律 404 → 失败条目
	const failed = await first.service.refresh({ providerIds: ["kimi-coding"], force: true });
	assert.notEqual(failed.entries[0].state, "ok");
	first.service.dispose();
	const cached = io.files.get("dir/cache.json");
	assert.equal(cached === undefined || !Object.keys(JSON.parse(cached).entries).length, true, "失败条目不入暂存");
	const second = harness({ io, reply: () => undefined });
	const shown = await second.service.refresh({ providerIds: ["kimi-coding"], force: false, cachedOnly: true });
	assert.equal(shown.entries[0].state, "loading", "重启后回到「还没读过」，而不是复述旧错误");
	second.service.dispose();
	console.log("PASS 失败条目不落盘：重启后是 loading，不复述过期错误");
}

// ── [3b] 秘密形态闸门：疑似凭据的条目整条不落盘 ────────────────────────────
{
	const io = memoryIo();
	io.files.set("dir/config.json", JSON.stringify({ visibility: { providers: { openrouter: true } } }));
	// 上游若把 token 混进可展示字段，落盘前必须被拦下（宁可少一条暂存）。
	const leaky = { data: { label: "额度", key: "sk-abcdefghijklmnopqrstuvwxyz012345" } };
	const service = new SubUsageService({ get: () => undefined }, {
		io, configPath: "dir/config.json", snapshotPath: "dir/cache.json", now: () => now,
		resolveCredentials: async () => ({ value: "test-key" }), resolveEnvironment: () => undefined,
		fetch: async () => ({ ok: true, status: 200, headers: { get: () => null }, text: async () => JSON.stringify(leaky) })
	});
	await service.refresh({ providerIds: ["openrouter"], force: true });
	service.dispose();
	const raw = io.files.get("dir/cache.json");
	const entries = raw ? Object.keys(JSON.parse(raw).entries) : [];
	assert.deepEqual(entries, [], "含 sk- 形态的条目不写入暂存");
	assert.equal(raw === undefined || !raw.includes("sk-abcdefghij"), true, "暂存文件里不得出现该串");
	console.log("PASS 秘密形态闸门：疑似凭据的条目整条跳过落盘");
}

// ── [4] snapshotPath: null 关闭暂存（隔离测试用） ──────────────────────────
{
	const io = memoryIo();
	io.files.set("dir/config.json", JSON.stringify({ visibility: { providers: { deepseek: true } } }));
	const service = new SubUsageService({ get: () => undefined }, {
		io, configPath: "dir/config.json", snapshotPath: null, now: () => now,
		resolveCredentials: async () => ({ value: "test-key" }), resolveEnvironment: () => undefined,
		fetch: async () => ({ ok: true, status: 200, headers: { get: () => null }, text: async () => JSON.stringify(DEEPSEEK_BODY) })
	});
	await service.refresh({ providerIds: ["deepseek"], force: true });
	service.dispose();
	assert.equal(io.files.has("dir/cache.json"), false, "关闭时不写暂存文件");
	console.log("PASS snapshotPath=null：完全不写盘");
}
