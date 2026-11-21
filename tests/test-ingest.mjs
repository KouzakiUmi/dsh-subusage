// 被动接入：别的插件把额度推过来，本插件只负责持久化与展示（开关只控制显不显示）。
//
// 钉六件事：
//  1. 推送形状校验：source 命名、空内容、疑似凭据一律拒绝，坏窗口跳过而不整体失败；
//  2. 推来的数据成为独立卡（provider id = `ingest:<source>`），全量查询与点名都能看到；
//  3. 落盘持久化：新实例（模拟重启）不重新推送也能看到；
//  4. 隐藏开关只影响显示，不影响数据；
//  5. ttlMs 过期只标 stale，不隐藏卡片；
//  6. 撤回会真的删掉数据。
import assert from "node:assert/strict";
import { loadHostModule } from "./helpers.mjs";
import { INGEST_PREFIX, isValidIngestSource, parseIngestPayload } from "../lib/ingest.js";

const { SubUsageService } = await loadHostModule();
const ID = source => `${INGEST_PREFIX}${source}`;

function harness({ files = new Map(), now = () => Date.parse("2026-11-20T12:00:00Z") } = {}) {
	const io = {
		readFileSync(path) { if (!files.has(path)) throw Object.assign(new Error("missing"), { code: "ENOENT" }); return files.get(path); },
		mkdirSync() {}, chmodSync() {},
		writeFileSync(path, value) { files.set(path, value); },
		renameSync(from, to) { files.set(to, files.get(from)); files.delete(from); }
	};
	const service = new SubUsageService({ get() {}, llm: { listProviders: () => [] }, effect() {} }, {
		io, configPath: "memory/config", snapshotPath: "memory/cache.json", ingestPath: "memory/ingest.json", now,
		resolveCredentials: async () => undefined, resolveEnvironment: () => undefined,
		fetch: async () => ({ ok: true, status: 200, headers: { get: () => null }, text: async () => "{}" })
	});
	return { service, files };
}

// ── [1] 形状校验 ──────────────────────────────────────────────────────────
{
	assert.equal(isValidIngestSource("relay-a"), true);
	assert.equal(isValidIngestSource("a.b_c-1"), true);
	assert.equal(isValidIngestSource("Bad Name"), false, "不允许空格");
	assert.equal(isValidIngestSource("has:colon"), false, "不允许冒号（会破坏 provider id）");
	assert.equal(isValidIngestSource(""), false);
	assert.equal(isValidIngestSource("x".repeat(65)), false, "超长拒绝");

	const ok = parseIngestPayload({ source: "re", windows: [{ kind: "5h", percent: 42 }] }, () => 1);
	assert.equal(ok.record.source, "re");
	assert.equal(ok.record.windows[0].status, "ok");
	const done = parseIngestPayload({ source: "re", windows: [{ percent: 100 }] }, () => 1);
	assert.equal(done.record.windows[0].status, "rate-limited", "100% 即限流");

	// 坏窗口跳过、好窗口留下，并留下诊断
	const mixed = parseIngestPayload({ source: "re", windows: [{ percent: 20 }, { percent: 200 }, { nope: 1 }] }, () => 1);
	assert.equal(mixed.record.windows.length, 1, "非法窗口被跳过");
	assert.ok(mixed.record.diagnostics.length >= 2, "跳过要留诊断");

	assert.match(parseIngestPayload({ source: "ok-one" }, () => 1).error, /没有任何可展示的额度/);
	assert.match(parseIngestPayload({ source: "x", extras: [{ kind: "note", value: "Bearer abcdefghijklmnopqrstuvwxyz" }] }, () => 1).error, /疑似凭据/, "秘密闸门");
	assert.match(parseIngestPayload(null, () => 1).error, /必须是一个对象/);
	console.log("PASS 推送形状：source 命名、空内容、秘密闸门、坏窗口跳过");
}

// ── [2] 推来的数据成为独立卡 ──────────────────────────────────────────────
{
	const { service } = harness();
	const ack = service.ingest({ source: "relay-a", label: "Relay A", windows: [{ kind: "5h", percent: 30 }, { kind: "week", percent: 80 }], extras: [{ kind: "balance", value: "12.30 CNY" }] });
	assert.equal(ack.ok, true);
	assert.equal(ack.providerId, ID("relay-a"));

	const all = await service.quota({ providerIds: [] });
	const card = all.providers.find(row => row.providerId === ID("relay-a"));
	assert.ok(card, "全量查询里出现这张卡");
	assert.equal(card.label, "Relay A");
	assert.equal(card.state, "ok");
	assert.deepEqual(card.windows.map(w => w.kind), ["5h", "week"], "窗口顺序也按短在上");
	assert.equal(card.extras.find(x => x.kind === "balance").value, "12.30 CNY");

	const named = await service.quota({ providerIds: [ID("relay-a")] });
	assert.equal(named.providers.length, 1, "点名单个被动源");
	assert.equal(named.providers[0].providerId, ID("relay-a"));

	// 没推过的源点名：给可读原因，不静默缺席
	const missing = await service.quota({ providerIds: [ID("nobody")] });
	assert.equal(missing.providers[0].state, "error");
	assert.match(missing.providers[0].error, /没有被推送方/);
	service.dispose();
	console.log("PASS 被动源成卡：全量可见、可点名、未推过的给可读原因");
}

// ── [3] 持久化：重启后不重新推送也在 ──────────────────────────────────────
{
	const files = new Map();
	const first = harness({ files });
	first.service.ingest({ source: "relay-b", label: "Relay B", windows: [{ kind: "day", percent: 10 }] });
	first.service.dispose();

	const second = harness({ files });
	const card = (await second.service.quota({ providerIds: [ID("relay-b")] })).providers[0];
	assert.equal(card.state, "ok", "新实例直接读到");
	assert.equal(card.windows[0].percent, 10);
	second.service.dispose();
	console.log("PASS 持久化：重启后数据仍在");
}

// ── [4] 隐藏开关只影响显示 ────────────────────────────────────────────────
{
	const { service } = harness();
	service.ingest({ source: "relay-c", label: "Relay C", windows: [{ kind: "5h", percent: 5 }] });
	const before = await service.read();
	assert.ok(before.entries.some(row => row.providerId === ID("relay-c")), "默认显示（read 的全量兜底也带被动源）");
	assert.deepEqual(before.settings.ingest.sources.map(item => ({ source: item.source, label: item.label, state: item.state })), [{ source: "relay-c", label: "Relay C", state: "ok" }], "publicSettings.ingest.sources 投影完整源清单");
	assert.equal(typeof before.settings.ingest.sources[0].receivedAt, "number", "receivedAt 为毫秒数");
	assert.equal("ttlMs" in before.settings.ingest.sources[0], false, "缺省字段不写 undefined（lossless JSON）");
	// cachedOnly 首屏读取指定 ingest id 也能直接返回当前卡片、不触发崩溃。
	const cached = await service.refresh({ providerIds: [ID("relay-c")], force: false, cachedOnly: true });
	assert.equal(cached.entries.length, 1);
	assert.equal(cached.entries[0].providerId, ID("relay-c"));
	assert.equal(cached.entries[0].state, "ok");

	const saved = await service.save({ expectedRevision: before.settings.revision, ingest: { hidden: ["relay-c"] } });
	assert.deepEqual(saved.settings.ingest.hidden, ["relay-c"]);

	const after = await service.read();
	assert.ok(!after.entries.some(row => row.providerId === ID("relay-c")), "隐藏后不在全量结果里");
	const named = await service.quota({ providerIds: [ID("relay-c")] });
	assert.equal(named.providers[0].state, "error");
	assert.match(named.providers[0].error, /隐藏/, "点名时说明被隐藏");
	// 数据没被删：取消隐藏立刻回来
	await service.save({ expectedRevision: saved.settings.revision, ingest: { hidden: [] } });
	const back = await service.quota({ providerIds: [ID("relay-c")] });
	assert.equal(back.providers[0].state, "ok", "取消隐藏后数据还在");
	service.dispose();
	console.log("PASS 隐藏开关：只影响显示，数据保留，可随时恢复");
}

// ── [5] ttl 过期只标 stale ────────────────────────────────────────────────
{
	let clock = Date.parse("2026-11-20T12:00:00Z");
	const { service } = harness({ now: () => clock });
	service.ingest({ source: "relay-d", windows: [{ kind: "5h", percent: 50 }], ttlMs: 60_000 });
	assert.equal((await service.quota({ providerIds: [ID("relay-d")] })).providers[0].freshness, "fresh");
	clock += 120_000;
	const stale = (await service.quota({ providerIds: [ID("relay-d")] })).providers[0];
	assert.equal(stale.freshness, "stale", "超过 ttl 标 stale");
	assert.equal(stale.state, "ok", "但卡片仍然在、仍然可读");
	assert.equal(stale.windows[0].percent, 50);
	service.dispose();
	console.log("PASS ttl 过期：标 stale 但不隐藏");
}

// ── [6] 撤回真的删数据 ────────────────────────────────────────────────────
{
	const files = new Map();
	const first = harness({ files });
	first.service.ingest({ source: "relay-e", windows: [{ kind: "5h", percent: 1 }] });
	assert.deepEqual(first.service.listIngest().sources.map(item => item.source), ["relay-e"]);
	const gone = first.service.revokeIngest("relay-e");
	assert.equal(gone.ok, true);
	assert.equal(gone.removed, true);
	assert.equal((await first.service.quota({ providerIds: [ID("relay-e")] })).providers[0].state, "error");
	first.service.dispose();

	const second = harness({ files });
	assert.match((await second.service.quota({ providerIds: [ID("relay-e")] })).providers[0].error, /没有被推送方/, "重启后也没回来");
	second.service.dispose();
	console.log("PASS 撤回：内存与落盘数据一起删掉");
}
