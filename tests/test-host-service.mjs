// 完全内存设置/凭据/网络，不触碰真实 CONFIG_PATH。
import assert from "node:assert/strict";
import { loadHostModule } from "./helpers.mjs";
const { SubUsageService, subUsageRemote, normalizeKimi, normalizeMimo, normalizeZai } = await loadHostModule();
const Z = "zai-coding-cn", K = "kimi-coding", M = "xiaomi-token-plan-cn", O = "opencode-go";
const IDS = [Z, K, M, O];
const zBody = { data: { limits: [{ type: "CREDIT_LIMIT", unit: 3, percentage: 12 }, { type: "CREDIT_LIMIT", unit: 6, percentage: 20 }] } };
function harness(initial) {
 const files = new Map(initial ? [["memory/config", JSON.stringify(initial)]] : []);
 let now = Date.parse("2026-01-01T00:00:00Z"); let calls = []; let response = () => zBody;
 const io = { readFileSync(path) { if (!files.has(path)) throw Object.assign(new Error("missing"), { code: "ENOENT" }); return files.get(path); }, mkdirSync(path, options) { assert.equal(path, "memory"); assert.deepEqual(options, { recursive: true, mode: 0o700 }); }, writeFileSync(path, value, options) { assert.deepEqual(options, { encoding: "utf8", mode: 0o600 }); files.set(path, value); }, chmodSync(path, mode) { assert.equal(path, "memory/config.tmp"); assert.equal(mode, 0o600); assert(files.has(path)); files.set("permissions-checked", true); }, renameSync(from, to) { assert.equal(files.get("permissions-checked"), true); files.delete("permissions-checked"); files.set(to, files.get(from)); files.delete(from); } };
 const credential = {}; const environment = {};
 const ctx = { get() {}, llm: { listProviders: () => [{ id: Z }] }, effect() {} };
 const service = new SubUsageService(ctx, { io, configPath: "memory/config", now: () => now, resolveCredentials: async id => credential[id], resolveEnvironment: id => environment[id], fetch: async (url, options) => { calls.push({ url, options }); const value = await response(url, options); if (value instanceof Error) throw value; if (value?.http) return { ok: false, status: value.http, headers: { get: () => value.retryAfter ?? null } }; return { ok: true, status: 200, headers: { get: () => null }, text: async () => typeof value === "string" ? value : JSON.stringify(value) }; } });
 return { service, calls, files, credential, environment, tick: ms => now += ms, respond: fn => response = fn };
}
const descriptors = subUsageRemote.descriptors;
assert.equal(descriptors.find(d => d.method === "read").parameters.length, 0);
for (const [method, param, type] of [["refresh", "request", "SubUsageQuery"], ["save", "settings", "SubUsageSettings"]]) {
 const d = descriptors.find(d => d.method === method); assert.equal(d.parameters[0].wire, param); assert.equal(d.parameters[0].codec.typeSymbol, `dsh-subusage#${type}`);
}
for (const [method, type] of [["startMimoLogin", "MimoLoginStart"], ["cancelMimoLogin", "MimoLoginCancel"]]) {
 const d = descriptors.find(d => d.method === method); assert.equal(d.parameters[0].name, "request"); assert.equal(d.parameters[0].wire, "request"); assert.equal(d.parameters[0].source, "json"); assert.equal(d.parameters[0].codec.typeSymbol, `dsh-subusage#${type}`); assert.equal(d.result.typeSymbol, "dsh-subusage#SubUsageLoginState");
 assert.throws(() => d.parameters[0].codec.schema.parse({}));
}
assert.equal(descriptors.find(d => d.method === "getMimoLoginStatus").parameters.length, 0);
assert.equal(descriptors.find(d => d.method === "getMimoLoginStatus").result.typeSymbol, "dsh-subusage#SubUsageLoginState");
const h = harness({ keys: { [Z]: "old-manual", [K]: "kimi-manual" } });
h.credential[Z] = { value: "credential-key" }; h.environment[Z] = { value: "environment-key" };
let result = await h.service.refresh({ providerIds: [Z], force: false });
assert.equal(result.entries[0].keySource, "credentials"); assert.equal(h.calls[0].options.headers.authorization, "Bearer credential-key");
assert.deepEqual(Object.keys(result).sort(), ["configured", "entries", "settings", "updatedAt"]);
assert.equal(result.settings.keyModes[Z], "inherit"); assert.equal(result.settings.hasKeys[Z], true); assert.equal(result.configured[Z], true);
assert(!JSON.stringify(result).includes("old-manual")); assert(!("keys" in result.settings)); assert(!("cookie" in result.settings.xiaomi));
const count = h.calls.length;
await h.service.refresh({ providerIds: [Z], force: false }); assert.equal(h.calls.length, count);
const saved = await h.service.save({ providerId: Z, expectedRevision: result.settings.revision, keyMode: "manual", keyUpdate: { action: "replace", value: "new-manual" } });
assert.deepEqual(saved.entries, []); assert.equal(h.calls.length, count); assert.notEqual(saved.settings.revision, result.settings.revision);
await assert.rejects(h.service.save({ providerId: K, expectedRevision: result.settings.revision, keyUpdate: { action: "clear" } }), e => e.code === "subusage/revision-conflict");
result = await h.service.refresh({ providerIds: [Z], force: true }); assert.equal(result.entries[0].keySource, "manual"); assert.equal(h.calls.at(-1).options.headers.authorization, "Bearer new-manual");
assert.equal(result.entries[0].coverage, "complete"); assert.equal(result.entries[0].freshness, "fresh"); assert(result.entries[0].lastSuccessAt);
h.respond(() => ({ http: 429, retryAfter: "120" })); h.tick(61000);
result = await h.service.refresh({ providerIds: [Z], force: false });
assert.equal(result.entries[0].state, "error"); assert.equal(result.entries[0].freshness, "stale"); assert.equal(result.entries[0].retainPrevious, true); assert.equal(result.entries[0].windows[0].percent, 12);
const backoffCount = h.calls.length; await h.service.refresh({ providerIds: [Z], force: true }); assert.equal(h.calls.length, backoffCount);
h.tick(120001); h.respond(() => ({ http: 401 }));
result = await h.service.refresh({ providerIds: [Z], force: true }); assert.equal(result.entries[0].freshness, "unknown"); assert.equal(result.entries[0].windows, undefined); assert.equal(result.entries[0].retainPrevious, false);
await h.service.save({ providerId: Z, keyUpdate: { action: "clear" } });
result = await h.service.refresh({ providerIds: [Z], force: true }); assert.equal(result.entries[0].state, "no-key"); assert.equal(result.entries[0].windows, undefined);
await h.service.save({ providerId: Z, keyMode: "inherit" }); delete h.credential[Z];
h.respond(() => zBody); result = await h.service.refresh({ providerIds: [Z], force: true }); assert.equal(result.entries[0].keySource, "env");
const isolated = harness(); isolated.service.credentials = async id => { if (id === Z) throw new Error("DO NOT LEAK"); return undefined; };
result = await isolated.service.read(); assert.equal(result.entries.length, 4); assert.equal(result.entries[0].errorCode, "subusage/credentials"); assert(!JSON.stringify(result).includes("DO NOT LEAK")); assert.equal(isolated.calls.length, 0);
await assert.rejects(h.service.refresh({ providerIds: ["bad"], force: false })); await assert.rejects(h.service.refresh({ providerIds: [Z] }));
for (const cookie of ["userId=1", "api-platform_serviceToken=x; userId=1\r\nX-Evil: y", "api-platform_serviceToken=x; userId=1; bad", "api-platform_serviceToken=x; userId=1; userId=2"]) await assert.rejects(h.service.save({ providerId: M, cookieUpdate: { action: "replace", value: cookie } }));
const cookies = await h.service.save({ providerId: M, cookieUpdate: { action: "replace", value: 'api-platform_serviceToken="dummy"; userId=1; optional=' } }); assert.equal(cookies.settings.xiaomi.hasCookie, true); assert(!JSON.stringify(cookies).includes("dummy"));
h.respond(url => url.endsWith("/balance") ? { data: { balance: "1", currency: "CNY" } } : { data: {} });
result = await h.service.refresh({ providerIds: [M], force: true }); assert.equal(result.entries[0].coverage, "partial"); assert.deepEqual(result.entries[0].windows, []);
// 并发普通/force 合并；设置改变阻止旧请求写缓存。
const concurrent = harness({ keys: { [Z]: "key1" }, keyModes: { [Z]: "manual" } });
let release; concurrent.respond(() => new Promise(resolve => { release = resolve; }));
const first = concurrent.service.refresh({ providerIds: [Z], force: false });
await new Promise(resolve => setTimeout(resolve, 0));
const second = concurrent.service.refresh({ providerIds: [Z], force: true });
await new Promise(resolve => setTimeout(resolve, 0)); assert.equal(concurrent.calls.length, 1);
release(zBody); await Promise.all([first, second]);
concurrent.tick(61000);
const old = concurrent.service.refresh({ providerIds: [Z], force: true }); await new Promise(resolve => setTimeout(resolve, 0));
await concurrent.service.save({ providerId: Z, keyUpdate: { action: "replace", value: "key2" } });
const releaseOld = release; concurrent.respond(() => ({ data: { limits: [{ type: "CREDIT_LIMIT", unit: 3, percentage: 80 }] } }));
await concurrent.service.refresh({ providerIds: [Z], force: true }); releaseOld(zBody); const oldResult = await old;
assert.equal(oldResult.entries[0].errorCode, "subusage/config-changed"); assert.equal(oldResult.entries[0].windows, undefined);
assert.equal(oldResult.settings.revision, (await concurrent.service.refresh({ providerIds: [], force: false })).settings.revision);
assert.equal((await concurrent.service.refresh({ providerIds: [Z], force: false })).entries[0].windows[0].percent, 80);
// reset 到期可以越过TTL/backoff触发新尝试。
const reset = harness({ keys: { [Z]: "x" } });
reset.respond(() => ({ data: { limits: [{ type: "CREDIT_LIMIT", unit: 3, percentage: 100, nextResetTime: Date.parse("2026-01-01T00:00:10Z") }] } }));
await reset.service.refresh({ providerIds: [Z], force: false }); reset.tick(11000); await reset.service.refresh({ providerIds: [Z], force: false }); assert.equal(reset.calls.length, 2);
// 结构边界、99.5/raw判定、明确新版fixture、同级不连坐。
for (const key of ["usages", "usage", "limits"]) {
 const windows = normalizeKimi({ [key]: { limit_5h: { used_ratio: .995 }, limit_7d: { used_ratio: .9999 } } });
 assert.equal(windows[0].percent, 99.5); assert.equal(windows[0].status, "ok"); assert.equal(windows[1].percent, 99.9);
}
assert.throws(() => normalizeKimi({ usages: { limit_5h: {}, limit_7d: { used_ratio: 0 } } }));
assert.throws(() => normalizeZai({ data: { limits: [{ type: "CREDIT_LIMIT", unit: 3, percentage: NaN }] } }));
const peers = normalizeZai({ data: { limits: [{ type: "CREDIT_LIMIT", unit: 6, percentage: 100 }, { type: "CREDIT_LIMIT", unit: 6, percentage: 10 }, { type: "CREDIT_LIMIT", unit: 3, percentage: 0 }] } });
assert.equal(peers.windows[1].status, "ok"); assert.deepEqual(peers.windows[2].detail.blockedBy, ["week"]);
const mimo = normalizeMimo({ data: { balance: "0" } }, {}, { data: { usage: { items: [{ name: "plan_total_token", percent: .995 }] } } }); assert.equal(mimo.windows[0].percent, 99.5); assert.equal(mimo.windows[0].status, "ok");
const malformed = harness({ keys: { [Z]: "x" } }); malformed.respond(() => "not JSON"); result = await malformed.service.refresh({ providerIds: [Z], force: true }); assert.equal(result.entries[0].errorCode, "subusage/response"); assert.equal(result.entries[0].retryable, false);
malformed.respond(() => new Error("authorization=SECRET")); result = await malformed.service.refresh({ providerIds: [Z], force: true }); assert(!JSON.stringify(result).includes("SECRET")); assert.equal(result.entries[0].errorCode, "subusage/network");
h.service.dispose(); assert.equal(h.service.cache.size, 0); assert.equal(h.service.inflight.size, 0); await assert.rejects(h.service.read(), e => e.code === "subusage/disposed");
console.log("PASS Host service contracts/cache/patch/errors/normalizers (isolated memory fixtures)");
