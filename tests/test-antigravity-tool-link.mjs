// 兄弟插件联动：本机实际安装的 dsh-tool-antigravity（Cordis 服务 `antigravityAuth`，
// AntigravityAuthService.usage(signal?, force?) → QuotaStatusView）。
// 数据形状照抄该包 lib/types/quota.d.ts；与既有 agyQuota（dsh-antigravity-acp）通道的关系：
// 同一份订阅只出一条 providerId="antigravity"，agyQuota 优先、antigravityAuth 回退。
import assert from "node:assert/strict";
import { loadHostModule } from "./helpers.mjs";

const { SubUsageService, normalizeAntigravityAuthView } = await loadHostModule();

// ── [1] 快照映射：剩余比例 → 已用百分比；两组各自带 groupLabel ──────────────
{
	const entry = normalizeAntigravityAuthView({
		state: "available",
		checkedAt: "2026-11-01T01:00:00.000Z",
		groups: [
			{ group: "gemini", modelCount: 6, windows: [
				{ window: "5h", remainingFraction: 0.8, resetTime: "2026-11-01T02:00:00Z" },
				{ window: "weekly", remainingFraction: 0.5, resetTime: "2026-11-06T00:00:00Z" }
			] },
			{ group: "non-gemini", modelCount: 12, windows: [
				{ window: "5h", remainingFraction: 0.25, resetTime: "2026-11-01T02:00:00Z" }
			] }
		]
	});
	assert.equal(entry.providerId, "antigravity");
	assert.equal(entry.label, "Antigravity");
	assert.equal(entry.state, "ok");
	assert.equal(entry.coverage, "complete");
	assert.equal(entry.freshness, "fresh");
	assert.equal(entry.lastSuccessAt, "2026-11-01T01:00:00.000Z");
	assert.deepEqual(entry.windows.map(w => w.kind), ["5h", "week", "5h"], "weekly 收敛到 week");
	assert.deepEqual(entry.windows.map(w => w.percent), [20, 50, 75], "剩余 0.8/0.5/0.25 → 已用 20/50/75");
	assert.deepEqual(entry.windows.map(w => w.groupLabel), ["Gemini 模型", "Gemini 模型", "Claude 与 GPT 模型"]);
	assert.equal(entry.windows[0].resetsAt, "2026-11-01T02:00:00.000Z");
	assert.equal(entry.windows[0].status, "ok");
	assert.ok(!("detail" in entry.windows[0]), "只有比例、没有绝对值，不得编造 detail");
	assert.deepEqual(entry.extras, []);
}

// ── [2] 状态机：未登录 → null；其余失败态 → 可读 error 条目 ──────────────────
{
	assert.equal(normalizeAntigravityAuthView({ state: "unauthenticated" }), null, "未登录不是故障，交给上层按点名/静默处理");
	for (const state of ["forbidden", "rate-limited", "timeout", "offline", "protocol-drift", "weird"]) {
		const entry = normalizeAntigravityAuthView({ state });
		assert.equal(entry.state, "error", `${state} 折成 error 条目`);
		assert.equal(entry.providerId, "antigravity");
		assert.ok(entry.error && entry.error.length > 4, `${state} 要有可读原因`);
		assert.deepEqual(entry.windows, []);
	}
	assert.throws(() => normalizeAntigravityAuthView(null), /不是对象/);
	assert.throws(() => normalizeAntigravityAuthView("x"), /不是对象/);
}

// ── [3] available 但没有窗口：partial 的 ok 条目（不把未知伪装成耗尽）────────
{
	const entry = normalizeAntigravityAuthView({ state: "available", checkedAt: "2026-11-01T01:00:00Z", groups: [] });
	assert.equal(entry.state, "ok");
	assert.equal(entry.coverage, "partial");
	assert.deepEqual(entry.windows, []);
	// 脏字段不造窗口：比例 / 窗口档位 / 重置时间任一缺失都跳过。
	const sparse = normalizeAntigravityAuthView({ state: "available", groups: [
		{ group: "gemini", windows: [
			{ window: "5h", resetTime: "2026-11-01T02:00:00Z" },
			{ window: "monthly", remainingFraction: 0.5, resetTime: "2026-12-01T00:00:00Z" },
			{ window: "weekly", remainingFraction: 1.2, resetTime: "2026-11-06T00:00:00Z" }
		] }
	] });
	assert.deepEqual(sparse.windows, []);
}

// ── [4] 服务接线：antigravityAuth 通道（agyQuota 缺席）──────────────────────
const TOOL_SNAPSHOT = {
	state: "available", checkedAt: "2026-11-01T01:00:00.000Z",
	groups: [{ group: "gemini", modelCount: 1, windows: [{ window: "5h", remainingFraction: 0.6, resetTime: "2026-11-01T02:00:00Z" }] }]
};
function harness(services = {}, options = {}) {
	const files = new Map();
	const io = {
		readFileSync(path) { if (!files.has(path)) throw Object.assign(new Error("missing"), { code: "ENOENT" }); return files.get(path); },
		mkdirSync() {}, writeFileSync(path, value) { files.set(path, value); }, chmodSync() {}, renameSync() {}
	};
	const ctx = { get: name => services[name] };
	const service = new SubUsageService(ctx, {
		io, configPath: "memory/config",
		resolveCredentials: async () => undefined,
		resolveEnvironment: () => undefined,
		fetch: async () => { throw new Error("测试不得发起网络请求"); },
		linkedTimeoutMs: options.linkedTimeoutMs ?? 50
	});
	return { service, ctx };
}
{
	const calls = [];
	const auth = { usage: async (signal, force) => { calls.push({ signal: signal === undefined, force }); return TOOL_SNAPSHOT; } };
	const { service } = harness({ antigravityAuth: auth });
	const only = await service.quota({ providerIds: ["antigravity"] });
	assert.deepEqual(only.providers.map(p => p.providerId), ["antigravity"]);
	assert.deepEqual(only.providers[0].windows.map(w => [w.kind, w.percent]), [["5h", 40]]);
	assert.equal(calls.length, 1);
	assert.deepEqual(calls[0], { signal: true, force: false });
	await service.quota({ providerIds: ["antigravity"], force: true });
	assert.equal(calls[1].force, true, "refresh 透传为 usage(_, true)");
	// 路由 id / 包名别名都能点名。
	for (const name of ["google-antigravity", "dsh-tool-antigravity", "agy"]) {
		const view = await service.quota({ providerIds: [name] });
		assert.deepEqual(view.providers.map(p => p.providerId), ["antigravity"], `${name} → antigravity`);
	}
	// 不点名：32 家 + 联动 1 家。
	const all = await service.quota();
	assert.equal(all.providers.length, 33);
	for (const entry of all.providers) for (const [key, value] of Object.entries(entry)) assert.notEqual(value, undefined, `${entry.providerId}.${key} 不得是 undefined`);
	service.dispose();
}

// ── [5] agyQuota 优先：两个服务都在场时只问 agyQuota，不并列两条 ─────────────
{
	let toolCalls = 0;
	const agy = { read: async () => ({ status: "ok", updatedAt: "2026-11-01T01:00:00.000Z", plan: "Pro", groups: [{ name: "Gemini Models", buckets: [{ window: "5h", remainingPct: 70 }] }] }) };
	const auth = { usage: async () => { toolCalls++; return TOOL_SNAPSHOT; } };
	const { service } = harness({ agyQuota: agy, antigravityAuth: auth });
	const view = await service.quota({ providerIds: ["antigravity"] });
	assert.equal(view.providers.length, 1, "同一份订阅只出一条");
	assert.equal(view.providers[0].extras.find(x => x.kind === "plan")?.value, "Pro", "取的是 agyQuota 快照");
	assert.equal(toolCalls, 0, "agyQuota 在场时不得再调 antigravityAuth");
	service.dispose();
}

// ── [6] 回退：agyQuota 缺席（或版本旧没有 read）时落到 antigravityAuth ───────
{
	const auth = { usage: async () => TOOL_SNAPSHOT };
	const { service: s1 } = harness({ antigravityAuth: auth, agyQuota: {} });
	assert.equal((await s1.quota({ providerIds: ["antigravity"] })).providers[0].state, "ok", "agyQuota 没有 read 方法 → 回退");
	s1.dispose();
	const { service: s2 } = harness({ antigravityAuth: auth });
	assert.equal((await s2.quota({ providerIds: ["antigravity"] })).providers[0].state, "ok", "agyQuota 未注册 → 回退");
	s2.dispose();
}

// ── [7] 未登录：全量查询静默，点名给登录指引 ────────────────────────────────
{
	const { service } = harness({ antigravityAuth: { usage: async () => ({ state: "unauthenticated" }) } });
	const all = await service.quota();
	assert.equal(all.providers.length, 32, "未登录的联动项不在全量报告里占行");
	assert.ok(!all.providers.some(p => p.providerId === "antigravity"));
	const named = await service.quota({ providerIds: ["antigravity"] });
	const row = named.providers.find(p => p.providerId === "antigravity");
	assert.equal(row.state, "error");
	assert.ok(row.error.includes("Google 授权") || row.error.includes("antigravity-auth"), "要告诉用户去哪登录");
	service.dispose();
}

// ── [8] 两个通道都缺席：点名给双通道安装指引 ────────────────────────────────
{
	const { service } = harness({});
	const named = await service.quota({ providerIds: ["google-antigravity"] });
	const row = named.providers.find(p => p.providerId === "antigravity");
	assert.equal(row.state, "error");
	assert.ok(row.error.includes("dsh-tool-antigravity") && row.error.includes("dsh-antigravity-acp"));
	service.dispose();
}

// ── [9] readLinked：客户端药丸的独立取数口（只回 entries，不带 settings）─────
{
	const auth = { usage: async () => TOOL_SNAPSHOT };
	const { service } = harness({ antigravityAuth: auth });
	const result = await service.readLinked({ providerIds: ["antigravity"], force: true });
	assert.equal((await service.readLinked(undefined)).entries.length, 0, "缺省请求合法：返回空条目集");
	assert.equal(typeof result.updatedAt, "string");
	assert.ok(!("settings" in result) && !("configured" in result), "联动结果不带设置快照");
	assert.equal(result.entries.length, 1);
	assert.equal(result.entries[0].providerId, "antigravity");
	// 非联动 id 被丢弃；点名的联动项缺席时回一条缺席说明（与 quota() 点名同语义）。
	const other = await service.readLinked({ providerIds: ["deepseek", "trae-global"], force: false });
	assert.equal(other.entries.length, 1, "deepseek 不是联动项被丢弃；trae-global 按点名保留缺席说明");
	assert.equal(other.entries[0].providerId, "trae-global");
	assert.equal(other.entries[0].state, "error");
	service.dispose();
}

console.log("PASS 兄弟插件联动：dsh-tool-antigravity（antigravityAuth）快照换算、双通道优先级与客户端取数口");
