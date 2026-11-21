// 可重试失败的自动重拉调度：失败条目到点后 Host 自己重拉，不等用户手点刷新。
// 计时器注入为假句柄队列（scheduleTimer 登记 fn、clearTimer 标 cancelled），测试逐个触发；
// 时间用 tick() 推进 now，与缓存 TTL/退避判定同一只钟。
// 排期时刻 = max(retryAt, at+TTL)：缓存命中条件是「retryAt 未到 || 年龄在 TTL(60s) 内」，
// 在 retryAt 单独触发照样命中缓存空跑——两者都过了才是正常读取真的会再发请求的时刻。
import assert from "node:assert/strict";
import { loadHostModule } from "./helpers.mjs";
const { SubUsageService } = await loadHostModule();
const Z = "zai-coding-cn";
const zBody = { data: { limits: [{ type: "CREDIT_LIMIT", unit: 3, percentage: 12 }, { type: "CREDIT_LIMIT", unit: 6, percentage: 20 }] } };
function harness(initial, extra = {}) {
	const files = new Map(initial ? [["memory/config", JSON.stringify(initial)]] : []);
	let now = Date.parse("2026-01-01T00:00:00Z"); let calls = []; let response = () => zBody;
	const timers = []; const timerQueue = () => timers.filter(t => !t.cancelled && !t.fired);
	const io = { readFileSync(path) { if (!files.has(path)) throw Object.assign(new Error("missing"), { code: "ENOENT" }); return files.get(path); }, mkdirSync() {}, writeFileSync(path, value) { files.set(path, value); }, chmodSync() {}, renameSync(from, to) { files.set(to, files.get(from)); files.delete(from); } };
	const credential = {}; const environment = {};
	const ctx = { get() {}, llm: { listProviders: () => [{ id: Z }] }, effect() {} };
	const service = new SubUsageService(ctx, { io, configPath: "memory/config", snapshotPath: null, now: () => now,
		resolveCredentials: async (id, refName) => credential[refName] ?? credential[id],
		resolveEnvironment: (id, refName) => environment[refName] ?? environment[id],
		fetch: async (url, options) => { calls.push({ url, options }); const value = await response(url, options); if (value instanceof Error) throw value; if (value?.http) return { ok: false, status: value.http, headers: { get: () => value.retryAfter ?? null } }; return { ok: true, status: 200, headers: { get: () => null }, text: async () => typeof value === "string" ? value : JSON.stringify(value) }; },
		scheduleTimer: (fn, ms) => { const timer = { fn, ms, cancelled: false }; timers.push(timer); return timer; },
		clearTimer: (handle) => { handle.cancelled = true; },
		...extra });
	return { service, calls, files, credential, environment, timers: timerQueue, tick: ms => now += ms, respond: fn => response = fn };
}
const fire = async (timer) => { assert.ok(timer && !timer.cancelled && !timer.fired, "要触发的重试计时器仍在队列里"); timer.fired = true; await timer.fn(); };

// 1) 成功读取不排重试
{
	const h = harness({ keys: { [Z]: "x" } });
	const r = await h.service.refresh({ providerIds: [Z], force: true });
	assert.equal(r.entries[0].state, "ok"); assert.ok(h.calls.length >= 2, "Z.ai 一次读取 = quota + balance 两路数据源");
	assert.equal(h.timers().length, 0, "成功条目不挂重试计时器");
	h.service.dispose();
}

// 2) 429 + Retry-After 120s（超过 TTL）：计时器按 retryAt 到期，到点自动重拉、恢复后撤销
{
	const h = harness({ keys: { [Z]: "x" } });
	h.respond(() => ({ http: 429, retryAfter: "120" }));
	const r = await h.service.refresh({ providerIds: [Z], force: true });
	assert.equal(r.entries[0].errorCode, "subusage/rate-limit"); assert.equal(r.entries[0].retryable, true);
	assert.equal(h.timers().length, 1, "可重试失败排了自动重拉");
	assert.equal(h.timers()[0].ms, 120000, "Retry-After 超过 TTL 时按它到期，而不是立刻重发");
	const before = h.calls.length; h.respond(() => zBody); h.tick(120000);
	await fire(h.timers()[0]);
	assert.ok(h.calls.length > before, "到点后自动向上游重拉了一轮");
	assert.equal(h.timers().length, 0, "恢复成功后计时器撤销");
	const snap = await h.service.read({ providerIds: [Z], force: false });
	assert.equal(snap.entries[0].state, "ok", "自动重拉的结果照常进缓存视图");
	h.service.dispose();
}

// 3) 退避短于 TTL 时按 TTL 排期（与正常读取同口径），失败链自动续排
{
	const h = harness({ keys: { [Z]: "x" } });
	h.respond(() => ({ http: 429 }));
	await h.service.refresh({ providerIds: [Z], force: true });
	assert.equal(h.timers()[0].ms, 60000, "指数退避(2s) 短于 TTL 时按 TTL 到点，避免命中缓存空跑");
	let before = h.calls.length; h.tick(60000); await fire(h.timers()[0]);
	assert.ok(h.calls.length > before, "第一轮自动重拉发出了请求");
	assert.equal(h.timers().length, 1, "第二次失败自动续排下一轮");
	assert.equal(h.timers()[0].ms, 60000);
	before = h.calls.length; h.tick(60000); await fire(h.timers()[0]);
	assert.ok(h.calls.length > before, "第二轮仍自动重拉，全程不需要手动刷新");
	h.service.dispose();
}

// 4) 不可重试错误（401）不排计时器
{
	const h = harness({ keys: { [Z]: "x" } });
	h.respond(() => ({ http: 401 }));
	const r = await h.service.refresh({ providerIds: [Z], force: true });
	assert.equal(r.entries[0].state, "error"); assert.equal(r.entries[0].retryable, false);
	assert.equal(h.timers().length, 0, "认证类失败不自动重试（等用户换凭据）");
	h.service.dispose();
}

// 5) invalidateProvider 撤销计时器：凭据/开关变化后不再按旧计划打上游
{
	const h = harness({ keys: { [Z]: "x" } });
	h.respond(() => ({ http: 429 }));
	await h.service.refresh({ providerIds: [Z], force: true });
	assert.equal(h.timers().length, 1);
	h.service.invalidateProvider(Z);
	assert.equal(h.timers().length, 0, "凭据/开关失效时撤销挂起的重拉");
	h.service.dispose();
}

// 6) dispose 清空全部计时器，卸载后不残留额度请求计划
{
	const h = harness({ keys: { [Z]: "x" } });
	h.respond(() => ({ http: 429 }));
	await h.service.refresh({ providerIds: [Z], force: true });
	assert.equal(h.timers().length, 1);
	h.service.dispose();
	assert.equal(h.timers().length, 0, "卸载后没有残留的额度请求计划");
}
console.log("test-auto-retry ✅");
