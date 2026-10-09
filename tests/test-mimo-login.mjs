// 所有 browser/cookie/IO/fetch 都是 dummy；绝不启动真实 Chrome。
import assert from "node:assert/strict";
import { MimoLogin, extractMimoCookie, extractMimoSession, MIMO_API_URLS, MIMO_LOGIN_URL, MIMO_ORIGIN } from "../lib/mimo-login.js";
import { loadHostModule } from "./helpers.mjs";
const { SubUsageService } = await loadHostModule();
const M = "xiaomi-token-plan-cn", Z = "zai-coding-cn";
const delay = ms => new Promise(r => setTimeout(r, ms));
const deferred = () => { let resolve; const promise = new Promise(r => resolve = r); return { resolve, promise }; };
const cookies = [
 { name: "api-platform_serviceToken", value: "dummy-token", domain: ".xiaomimimo.com", path: "/", httpOnly: true, secure: true, expires: -1 },
 { name: "userId", value: "dummy-user", domain: "platform.xiaomimimo.com", path: "/api/v1", httpOnly: true, secure: true, expires: -1 }
];
const cookie = "api-platform_serviceToken=dummy-token; userId=dummy-user";
assert.equal(extractMimoCookie(cookies), cookie);
assert.equal(extractMimoCookie([...cookies, { ...cookies[0], domain: "evil.example" }]), cookie);
for (const changes of [{ domain: "evilxiaomimimo.com" }, { domain: ".com" }, { domain: ".xiaomimimo.com.evil" }, { path: "/api/v1/balance" }, { path: "/api/v10" }, { expires: 1 }]) assert.equal(extractMimoCookie([{ ...cookies[0], ...changes }, cookies[1]]), null);
assert.equal(extractMimoCookie([...cookies, cookies[0]]), null);

// extractMimoSession 额外给出平台声明的过期时刻（毫秒），供 Host 取 min(24h 上限, 观测值)。
// 两个都是会话 Cookie（expires:-1）时返回 0，由 24 小时上限兜底。
assert.equal(extractMimoSession(cookies).cookie, cookie);
assert.equal(extractMimoSession(cookies).expiresAt, 0, "会话 Cookie 没有可用的过期时间");
const withExpiry = (a, b) => [{ ...cookies[0], expires: a }, { ...cookies[1], expires: b }];
const future = Math.floor((Date.now() + 8 * 3600 * 1000) / 1000);
assert.equal(extractMimoSession(withExpiry(future, future)).expiresAt, future * 1000);
assert.equal(extractMimoSession(withExpiry(future, future + 3600)).expiresAt, future * 1000, "取两个必需 Cookie 中更早的过期时刻");
assert.equal(extractMimoSession(withExpiry(future, -1)).expiresAt, future * 1000, "其中一个为会话 Cookie 时仍采用另一个的过期时刻");
assert.equal(extractMimoSession(withExpiry(1, future)), null, "已过期的必需 Cookie 不得进入会话");
function harness(options = {}) {
 let content = null, writes = 0, launches = 0, closes = 0, calls = 0;
 let suppliedCookies = options.cookies ?? cookies;
 const events = {};
 const browser = { on(event, cb) { events[event] = cb; }, async close() { closes++; }, async newContext() { return { cookies: async urls => { assert.deepEqual(urls, MIMO_API_URLS); return suppliedCookies; }, newPage: async () => ({ on(event, cb) { events[`page:${event}`] = cb; }, goto: async url => { assert.equal(url, MIMO_LOGIN_URL, "第一步必须落到控制台套餐页：站点首页不触发登录，用户还得自己点进控制台"); assert.notEqual(url, MIMO_ORIGIN, "不能只打开首页"); } }) }; } };
 const io = { readFileSync() { if (content === null) throw Object.assign(new Error(), { code: "ENOENT" }); return content; }, mkdirSync() {}, writeFileSync(_, value) { writes++; content = value; }, chmodSync() {}, renameSync() {} };
 let http = 200, body = options.partial ? { data: {} } : { data: { usage: { items: [{ name: "plan_total_token", percent: .1 }] } } };
 const service = new SubUsageService({ effect() {}, get() {}, llm: { listProviders: () => [] } }, {
  io, configPath: "dummy/config", resolveCredentials: async () => undefined, resolveEnvironment: () => undefined,
  fetch: async (url, init) => { calls++; assert.equal(init.headers.cookie, cookie); assert(init.signal); if (options.fetch) return options.fetch(url, init); return { status: http, ok: http === 200, headers: { get: () => null }, text: async () => JSON.stringify(url.endsWith("/balance") ? { data: { balance: "0", currency: "CNY" } } : body) }; },
  mimoLogin: { pollMs: 1, timeoutMs: 1000, ...options.login, launch: async args => { launches++; assert.deepEqual(args, { channel: "chrome", headless: false }); return options.launch ? options.launch(browser) : browser; } }
 });
 return { service, browser, events, external(fn) { const stored = JSON.parse(content); fn(stored); content = JSON.stringify(stored); }, revision: () => service.result(service.load(), []).settings.revision, get writes() { return writes; }, get launches() { return launches; }, get closes() { return closes; }, get calls() { return calls; }, setHttp: value => http = value, setCookies: value => suppliedCookies = value };
}
async function until(h, states) { for (let i = 0; i < 200; i++) { const s = h.service.getMimoLoginStatus(); if (states.includes(s.state)) return s; await delay(2); } throw new Error("stub state did not settle"); }
const h = harness();
assert.deepEqual(h.service.getMimoLoginStatus(), { jobId: null, state: "idle" });
assert.throws(() => h.service.startMimoLogin({}));
assert.throws(() => h.service.startMimoLogin({ expectedRevision: "stale" }), e => e.code === "subusage/revision-conflict");
const start = h.service.startMimoLogin({ expectedRevision: h.revision() }); assert.equal(start.state, "launching"); assert.equal(h.launches, 0);
assert.equal(h.service.startMimoLogin({ expectedRevision: "ignored-on-active" }).jobId, start.jobId);
const success = await until(h, ["success"]); assert.equal(h.writes, 1); assert.equal(h.launches, 1); assert.equal(success.result.entries[0].coverage, "complete");
assert.equal(h.service.load().xiaomi.cookie, cookie); assert(!JSON.stringify(success).includes("dummy-token")); assert(!JSON.stringify(success).includes("dummy-user"));
assert(h.closes >= 1); const calls = h.calls; await h.service.refresh({ providerIds: [M], force: false }); assert.equal(h.calls, calls); h.service.dispose();
const partial = harness({ partial: true }); partial.service.startMimoLogin({ expectedRevision: partial.revision() }); const p = await until(partial, ["success"]); assert.equal(p.result.entries[0].coverage, "partial"); assert(p.message.includes("额度未知")); assert.equal(partial.writes, 1); partial.service.dispose();
const auth = harness(); auth.setHttp(401); auth.service.startMimoLogin({ expectedRevision: auth.revision() }); await until(auth, ["waiting"]); await delay(10); assert.equal(auth.writes, 0); assert(auth.calls <= 3); auth.service.dispose();
const quotaFail = harness({ fetch: async url => ({ status: url.endsWith("/usage") ? 429 : 200, ok: !url.endsWith("/usage"), headers: { get: () => "120" }, text: async () => JSON.stringify({ data: { balance: "1" } }) }) }); quotaFail.service.startMimoLogin({ expectedRevision: quotaFail.revision() }); await until(quotaFail, ["waiting"]); await delay(10); assert.equal(quotaFail.writes, 0); assert(quotaFail.calls <= 3); quotaFail.service.dispose();
// 已启动后、提交前的同MiMo材料冲突；第三方补丁能合并。
for (const conflict of [true, false]) {
 const gate = deferred(); const c = harness({ launch: async b => { await gate.promise; return b; } });
 c.service.startMimoLogin({ expectedRevision: c.revision() }); await delay(1);
 await c.service.save({ providerId: conflict ? M : Z, keyUpdate: { action: "replace", value: "external-dummy" } }); gate.resolve();
 const result = await until(c, ["success", "error"]);
 assert.equal(result.state, conflict ? "error" : "success"); assert.equal(c.writes, conflict ? 1 : 2);
 if (conflict) assert.equal(result.errorCode, "subusage/revision-conflict"); else assert.equal(c.service.load().keys[Z], "external-dummy"); c.service.dispose();
}
// 取消迟到的 launch，旧 UI 不能取消后一个任务；dispose 也关闭迟到 browser。
for (const dispose of [false, true]) {
 const gate = deferred(); const c = harness({ launch: async b => { await gate.promise; return b; }, cookies: [] });
 const old = c.service.startMimoLogin({ expectedRevision: c.revision() }); await delay(1);
 if (dispose) c.service.dispose(); else c.service.cancelMimoLogin({ jobId: old.jobId });
 assert.equal(c.service.getMimoLoginStatus().state, "cancelled"); gate.resolve(); await delay(10); assert(c.closes >= 1); assert.equal(c.writes, 0);
 if (!dispose) { const next = c.service.startMimoLogin({ expectedRevision: c.revision() }); assert.notEqual(next.jobId, old.jobId); assert.equal(c.service.cancelMimoLogin({ jobId: old.jobId }).state, "launching"); c.service.cancelMimoLogin({ jobId: next.jobId }); c.service.dispose(); }
}
const timeout = harness({ cookies: [], login: { timeoutMs: 10 } }); timeout.service.startMimoLogin({ expectedRevision: timeout.revision() }); const timed = await until(timeout, ["error"]); assert.equal(timed.errorCode, "subusage/login-timeout"); assert.equal(timeout.writes, 0); assert(timeout.closes >= 1); timeout.service.dispose();
const closed = harness({ cookies: [] }); closed.service.startMimoLogin({ expectedRevision: closed.revision() }); await until(closed, ["waiting"]); closed.events["page:close"](); assert.equal(closed.service.getMimoLoginStatus().state, "cancelled"); assert.equal(closed.writes, 0); closed.service.dispose();
const launchFail = harness({ launch: async () => { throw new Error("URL?token=DO_NOT_LEAK"); } }); launchFail.service.startMimoLogin({ expectedRevision: launchFail.revision() }); const fail = await until(launchFail, ["error"]); assert.equal(fail.errorCode, "subusage/chrome-unavailable"); assert(!JSON.stringify(fail).includes("DO_NOT_LEAK")); launchFail.service.dispose();
// 验证期间取消：AbortSignal 可见，迟到 fetch 返回不得持久化。
const gate = deferred(); let abortSignal;
const verifying = harness({ fetch: async (_, init) => { abortSignal = init.signal; await gate.promise; return { status: 200, ok: true, headers: { get: () => null }, text: async () => JSON.stringify({ data: { balance: "1", usage: { items: [{ name: "plan_total_token", percent: .1 }] } } }) }; } });
const v = verifying.service.startMimoLogin({ expectedRevision: verifying.revision() }); await until(verifying, ["verifying"]); verifying.service.cancelMimoLogin({ jobId: v.jobId }); assert(abortSignal.aborted); gate.resolve(); await delay(10); assert.equal(verifying.writes, 0); assert.equal(verifying.service.getMimoLoginStatus().state, "cancelled"); verifying.service.dispose();
const missing = harness({ cookies: [cookies[0]] }); const missingStart = missing.service.startMimoLogin({ expectedRevision: missing.revision() }); await until(missing, ["waiting"]); await delay(10); assert.equal(missing.calls, 0); missing.service.cancelMimoLogin({ jobId: missingStart.jobId }); missing.service.dispose();
const immediate = harness(); const immediateStart = immediate.service.startMimoLogin({ expectedRevision: immediate.revision() }); immediate.service.cancelMimoLogin({ jobId: immediateStart.jobId }); await delay(5); assert.equal(immediate.launches, 0); immediate.service.dispose();
const ioFail = harness(); ioFail.service.io.writeFileSync = () => { throw new Error("DO_NOT_LEAK_cookie=dummy-token"); }; ioFail.service.startMimoLogin({ expectedRevision: ioFail.revision() }); const ioState = await until(ioFail, ["error"]); assert.equal(ioState.errorCode, "subusage/config"); assert(!JSON.stringify(ioState).includes("dummy-token")); ioFail.service.dispose();
// 终态不能回放已清除/替换的登录，也不能把其他provider的新revision回退。
for (const mode of ["clear", "replace", "external", "other"]) {
 const replay = harness(); replay.service.startMimoLogin({ expectedRevision: replay.revision() }); const oldResult = await until(replay, ["success"]);
 if (mode === "external") replay.external(s => { s.xiaomi.cookie = "api-platform_serviceToken=external; userId=other"; });
 else if (mode === "other") await replay.service.save({ providerId: Z, keyUpdate: { action: "replace", value: "latest-zai-dummy" } });
 else await replay.service.save({ providerId: M, cookieUpdate: mode === "clear" ? { action: "clear" } : { action: "replace", value: "api-platform_serviceToken=external; userId=other" } });
 const next = replay.service.getMimoLoginStatus();
 if (mode === "other") { assert.equal(next.state, "success"); assert.notEqual(next.result.settings.revision, oldResult.result.settings.revision); assert.equal(next.result.settings.revision, replay.revision()); assert.equal(next.result.settings.hasKeys[Z], true); }
 else { assert.deepEqual(next, { jobId: null, state: "idle" }); assert.equal(replay.service.getMimoLoginStatus().result, undefined); }
 replay.service.dispose();
}
console.log("PASS MiMo login async/cookies/isolation/verification/revision/cancel/dispose/timeout/terminal-replay (fully stubbed)");
