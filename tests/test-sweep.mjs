// Host 后台扫描（warmup + 周期保鲜）：冷启动后不再等 UI 触发第一次上游请求。
// sweep 默认关、apply() 显式开——本文件显式传 sweepIntervalMs/sweepWarmupMs 验证开启路径，
// 其余测试不传即保持关闭，注入的假计时器队列里不会出现周期计时器。
// 复用 test-auto-retry 的计时器桩：scheduleTimer 登记 {fn,ms}、clearTimer 标 cancelled，fire() 逐个触发。
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
const fire = async (timer) => { assert.ok(timer && !timer.cancelled && !timer.fired, "要触发的计时器仍在队列里"); timer.fired = true; await timer.fn(); };
// 构造时把 visibility.providers 写成默认开（生产 settings 加载时即为每个 id 填显式布尔）。
const on = id => ({ visibility: { providers: { [id]: true } } });

// 1) 默认关闭：不传 sweepIntervalMs 时不挂任何计时器（保护既有测试的假计时器假设）
{
	const h = harness({ keys: { [Z]: "x" }, ...on(Z) });
	assert.equal(h.timers().length, 0, "sweep 未开启时构造不挂计时器");
	h.service.dispose();
}

// 2) warmup：启动后按 sweepWarmupMs 排一轮，到点全量拉取，之后按 interval 续排
{
	const h = harness({ keys: { [Z]: "x" }, ...on(Z) }, { sweepIntervalMs: 60000, sweepWarmupMs: 5000 });
	assert.equal(h.timers().length, 1);
	assert.equal(h.timers()[0].ms, 5000, "第一轮按 warmup 延迟而不是 interval");
	h.tick(5000);
	await fire(h.timers()[0]);
	assert.ok(h.calls.length >= 2, "warmup 一轮拉到了上游（quota + balance 两路）");
	const snap = await h.service.read({ providerIds: [Z], force: false, cachedOnly: true });
	assert.equal(snap.entries[0].state, "ok", "扫描结果进缓存视图，UI 读暂存即可");
	assert.equal(h.timers().length, 1);
	assert.equal(h.timers()[0].ms, 60000, "完成后按 interval 续排下一轮");
	h.service.dispose();
}

// 3) 周期保鲜：TTL 内的下一轮撞上缓存命中不再发请求；陈旧后才补拉
{
	const h = harness({ keys: { [Z]: "x" }, ...on(Z) }, { sweepIntervalMs: 60000, sweepWarmupMs: 0 });
	await fire(h.timers()[0]);
	const first = h.calls.length;
	assert.ok(first >= 2);
	h.tick(30000); await fire(h.timers()[0]); // 30s < TTL(60s)：年龄未过期
	assert.equal(h.calls.length, first, "TTL 内的周期轮不发上游请求（非 force 命中缓存）");
	h.tick(60000); await fire(h.timers()[0]); // 累计 90s：超过 TTL
	assert.ok(h.calls.length > first, "条目陈旧后周期轮补拉");
	h.service.dispose();
}

// 4) 失败自链：warmup 一轮失败后，退避计时器自己长出来（不再需要 UI 先点一次）
{
	const h = harness({ keys: { [Z]: "x" }, ...on(Z) }, { sweepIntervalMs: 60000, sweepWarmupMs: 0 });
	h.respond(() => ({ http: 429 }));
	await fire(h.timers()[0]);
	const retry = h.timers().filter(t => t.ms === 60000);
	assert.ok(retry.length >= 2, "sweep 续排 + 失败重试计时器同时在场");
	h.respond(() => zBody);
	h.tick(60000);
	// 触发重试计时器（与 sweep 同刻度的那只也可能先被点到，重试句柄按 cacheKey 辨认）：
	// 队列里 retry 与 sweep 都是 60s，全部触发后上游应已恢复且缓存转 ok。
	for (const t of [...h.timers()]) await fire(t);
	const snap = await h.service.read({ providerIds: [Z], force: false, cachedOnly: true });
	assert.equal(snap.entries[0].state, "ok", "失败条目到点自愈，全程无 UI 触发");
	h.service.dispose();
}

// 5) 跳过期：无凭据 provider 记 no-key 后，后续轮次连身份解析都不再做；disabled 同理
{
	const h = harness({ ...on(Z) }, { sweepIntervalMs: 60000, sweepWarmupMs: 0 });
	await fire(h.timers()[0]); // 第一轮：无凭据 → no-key（identity 解析过，无上游请求）
	assert.equal(h.calls.length, 0, "无凭据时不打上游");
	const snap = await h.service.read({ providerIds: [Z], force: false, cachedOnly: true });
	assert.equal(snap.entries[0].state, "no-key");
	h.tick(60000); await fire(h.timers()[0]);
	assert.equal(h.calls.length, 0, "no-key 结论行不再每轮重判");
	// 开关关掉也一样：配置里显式 disabled 的 provider 第一轮就跳过
	const h2 = harness({ keys: { [Z]: "x" }, visibility: { providers: { [Z]: false } } }, { sweepIntervalMs: 60000, sweepWarmupMs: 0 });
	await fire(h2.timers()[0]);
	assert.equal(h2.calls.length, 0, "开关关闭的 provider 不拉");
	h.service.dispose(); h2.service.dispose();
}

// 6) dispose 停钟：卸载后不留周期计时器，已触发的 sweep 也不再续排
{
	const h = harness({ keys: { [Z]: "x" }, ...on(Z) }, { sweepIntervalMs: 60000, sweepWarmupMs: 5000 });
	assert.equal(h.timers().length, 1);
	h.service.dispose();
	assert.equal(h.timers().length, 0, "dispose 撤销挂起的 sweep 计时器");
}
console.log("test-sweep ✅");
