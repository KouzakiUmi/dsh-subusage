// 完全内存设置/凭据/网络，不触碰真实 CONFIG_PATH。
import assert from "node:assert/strict";
import { loadHostModule } from "./helpers.mjs";
const { SubUsageService, subUsageRemote, normalizeKimi, normalizeMimo, normalizeZai } = await loadHostModule();
const Z = "zai-coding-cn", K = "kimi-coding", M = "xiaomi-token-plan-cn", O = "opencode-go";
const IDS = [Z, K, M, O];
const zBody = { data: { limits: [{ type: "CREDIT_LIMIT", unit: 3, percentage: 12 }, { type: "CREDIT_LIMIT", unit: 6, percentage: 20 }] } };
function harness(initial, extra = {}) {
 const files = new Map(initial ? [["memory/config", JSON.stringify(initial)]] : []);
 let now = Date.parse("2026-01-01T00:00:00Z"); let calls = []; let response = () => zBody;
 const io = { readFileSync(path) { if (!files.has(path)) throw Object.assign(new Error("missing"), { code: "ENOENT" }); return files.get(path); }, mkdirSync(path, options) { assert.equal(path, "memory"); assert.deepEqual(options, { recursive: true, mode: 0o700 }); }, writeFileSync(path, value, options) { assert.deepEqual(options, { encoding: "utf8", mode: 0o600 }); files.set(path, value); }, chmodSync(path, mode) { assert.equal(path, "memory/config.tmp"); assert.equal(mode, 0o600); assert(files.has(path)); files.set("permissions-checked", true); }, renameSync(from, to) { assert.equal(files.get("permissions-checked"), true); files.delete("permissions-checked"); files.set(to, files.get(from)); files.delete(from); } };
 const credential = {}; const environment = {};
 const ctx = { get() {}, llm: { listProviders: () => [{ id: Z }] }, effect() {} };
 // 解析器按引用名取数时，测试数据可以按「引用名」或「provider id」注册；id 键保持旧用例语义。
 const service = new SubUsageService(ctx, { io, configPath: "memory/config", now: () => now, resolveCredentials: async (id, refName) => credential[refName] ?? credential[id], resolveEnvironment: (id, refName) => environment[refName] ?? environment[id], fetch: async (url, options) => { calls.push({ url, options }); const value = await response(url, options); if (value instanceof Error) throw value; if (value?.http) return { ok: false, status: value.http, headers: { get: () => value.retryAfter ?? null } }; return { ok: true, status: 200, headers: { get: () => null }, text: async () => typeof value === "string" ? value : JSON.stringify(value) }; }, ...extra });
 return { service, calls, files, credential, environment, tick: ms => now += ms, respond: fn => response = fn };
}
const descriptors = subUsageRemote.descriptors;
assert.deepEqual(descriptors.find(d => d.method === "read").parameters.map(p => [p.wire, p.codec.typeSymbol]), [["request", "dsh-subusage#SubUsageQuery"]], "read 接受与 refresh 相同的可选查询（携带 commandCodeAccount）");
assert.equal(descriptors.find(d => d.method === "read").parameters[0].acceptsUndefined, true, "read 的 request 在 wire 层可选（兼容旧 client 无参调用）");
assert.equal(descriptors.find(d => d.method === "refresh").parameters[0].acceptsUndefined, undefined, "refresh 的 request 仍为必填");
const missingQuery = descriptors.find(d => d.method === "read").parameters[0].codec.schema.parse(undefined);
assert.equal(missingQuery.force, false);
assert.equal(missingQuery.commandCodeAccount, "");
assert.ok(Array.isArray(missingQuery.providerIds) && missingQuery.providerIds.length > 0, "缺参 query 解析为全量默认账户查询");
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
assert.deepEqual(Object.keys(result).sort(), ["availableProviders", "configured", "entries", "settings", "updatedAt"]);
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
// 3xx（redirect: "manual" 下的域名迁移/跳转）不是鉴权失败：必须映射 subusage/response 而不是 subusage/auth，
// 否则用户会被误导去重新登录；401 仍保持 subusage/auth。
h.tick(120001); h.respond(() => ({ http: 302 }));
result = await h.service.refresh({ providerIds: [Z], force: true });
assert.equal(result.entries[0].errorCode, "subusage/response");
assert.notEqual(result.entries[0].errorCode, "subusage/auth", "3xx 不得误诊为鉴权失败");
h.tick(120001); h.respond(() => ({ http: 401 }));
result = await h.service.refresh({ providerIds: [Z], force: true }); assert.equal(result.entries[0].errorCode, "subusage/auth");
// 清除手动 Key 后必须自动回到继承：凭据服务里还有值就继续用它，而不是 no-key。
await h.service.save({ providerId: Z, keyUpdate: { action: "clear" } });
result = await h.service.refresh({ providerIds: [Z], force: true });
assert.equal(result.settings.keyModes[Z], "inherit"); assert.equal(result.entries[0].keySource, "credentials"); assert.equal(result.entries[0].errorCode, "subusage/auth");
await h.service.save({ providerId: Z, keyMode: "inherit" }); delete h.credential[Z];
h.respond(() => zBody); result = await h.service.refresh({ providerIds: [Z], force: true }); assert.equal(result.entries[0].keySource, "env");
// 客户端 Models 页保存自定义 Key 时写进路由声明的 apiKeyEnv，它可能与内置 envName 不同
// （本机 Kimi 路由就是 KIMI_API_KEY vs KIMI_CODING_API_KEY）。解析必须先认路由实际的
// 引用名，否则客户端新 Key 永远读不到，只会继续拿环境变量里的旧值。
const routed = harness();
routed.service.ctx.llm.listConfigurableProviders = () => [{ provider: K, settingsNs: "llm-pi-ai", settingsPath: ["providers", K] }];
routed.service.settingsService = { describe: ({ redactSecrets }) => { assert.equal(redactSecrets, true, "读取路由配置必须脱敏"); return [{ ns: "llm-pi-ai", value: { providers: { [K]: { apiKeyEnv: "KIMI_API_KEY" } } } }]; } };
routed.credential.KIMI_API_KEY = { value: "client-new" };
routed.environment.KIMI_CODING_API_KEY = { value: "env-old" };
routed.respond(() => ({ http: 401 }));
const routedResult = await routed.service.refresh({ providerIds: [K], force: true });
assert.equal(routedResult.entries[0].keySource, "credentials");
assert.equal(routed.calls[0].options.headers.authorization, "Bearer client-new", "客户端新 Key 必须优先于内置名的旧环境变量");
// 旧配置里 manual 模式却没有手动 Key（清 keys 未改模式）：不能整体短路，仍要回落继承。
const staleManual = harness({ keyModes: { [Z]: "manual" }, keys: {} });
staleManual.environment[Z] = { value: "env-fallback" };
result = await staleManual.service.refresh({ providerIds: [Z], force: true });
assert.equal(result.entries[0].keySource, "env");
const isolated = harness(); isolated.service.credentials = async id => { if (id === Z) throw new Error("DO NOT LEAK"); return undefined; };
result = await isolated.service.read(); assert.equal(result.entries.length, 31); assert.equal(result.entries[0].errorCode, "subusage/credentials"); assert(!JSON.stringify(result).includes("DO NOT LEAK")); assert.equal(isolated.calls.length, 0);
// identity 解析（凭据服务/登录文件读取）与 HTTP 一样可能永久挂起：默认 10s（对齐 fetchJson 的
// AbortSignal.timeout）。注入极短 identityTimeoutMs + 永不 resolve 的 resolveCredentials，验证
// 超时后该家在短时间内返回可读 error 条目、不拖死同批其它 provider（Client 的「刷新中」不再
// 永久卡住），也不被 client 的 /auth|credential/ 判定当成凭据失效导去重新登录入口。
assert.equal(h.service.identityTimeoutMs, 10000, "identity 超时默认与 HTTP 的 10s 对齐");
const hanging = harness({ xiaomi: { cookie: "api-platform_serviceToken=S; userId=1" } }, { identityTimeoutMs: 15, resolveCredentials: () => new Promise(() => {}) });
hanging.respond(url => url.endsWith("/balance") ? { data: { balance: "1", currency: "CNY" } } : { data: {} });
let hungGuard; const hungStart = Date.now();
const hung = await Promise.race([hanging.service.refresh({ providerIds: [Z, M], force: true }), new Promise((_, reject) => { hungGuard = setTimeout(() => reject(new Error("identity 超时未生效：refresh 5 秒内未返回")), 5000); })]).finally(() => clearTimeout(hungGuard));
assert.ok(Date.now() - hungStart < 5000, "identity 挂起时 refresh 应在超时后立即返回，而不是永久等待");
const hungZai = hung.entries.find(e => e.providerId === Z);
assert.equal(hungZai.state, "error");
assert.equal(hungZai.errorCode, "subusage/identity-timeout");
assert.ok(hungZai.error.includes("超时"), "超时错误必须可读");
assert.ok(!/auth|credential/i.test(hungZai.errorCode), "identity 超时不得被当成 auth/credential 失效");
assert.equal(hung.entries.find(e => e.providerId === M).state, "ok", "单家凭据服务挂起不得拖死同批其它 provider");
// 未知 provider id 不再整体拒绝（客户端已更新、Host 未重启时必然出现）：过滤掉它，并回一条可读的
// unknown-provider 条目，好过让用户只看到网关的 boundary validation。形状错误（缺 force）仍拒绝。
const unknownResult = await h.service.refresh({ providerIds: ["bad"], force: false });
assert.equal(unknownResult.entries.length, 1);
assert.equal(unknownResult.entries[0].providerId, "bad");
assert.equal(unknownResult.entries[0].errorCode, "subusage/unknown-provider");
assert.ok(unknownResult.entries[0].error.includes("重启 DSH"));
await assert.rejects(h.service.refresh({ providerIds: [Z] }));
for (const cookie of ["userId=1", "api-platform_serviceToken=x; userId=1\r\nX-Evil: y", "api-platform_serviceToken=x; userId=1; bad", "api-platform_serviceToken=x; userId=1; userId=2"]) await assert.rejects(h.service.save({ providerId: M, cookieUpdate: { action: "replace", value: cookie } }));
const cookies = await h.service.save({ providerId: M, cookieUpdate: { action: "replace", value: 'api-platform_serviceToken="dummy"; userId=1; optional=' } }); assert.equal(cookies.settings.xiaomi.hasCookie, true); assert(!JSON.stringify(cookies).includes("dummy"));
h.respond(url => url.endsWith("/balance") ? { data: { balance: "1", currency: "CNY" } } : { data: {} });
result = await h.service.refresh({ providerIds: [M], force: true }); assert.equal(result.entries[0].coverage, "partial"); assert.deepEqual(result.entries[0].windows, []);
// 手动 Cookie 的普通刷新/缓存路径也必须脱敏服务端回显；分号后的空格不能截断秘密。
const reflectedCookie = "api-platform_serviceToken=REFLECTED-TOKEN; userId=REFLECTED-USER";
const reflected = harness({ xiaomi: { cookie: reflectedCookie } });
reflected.respond(url => url.endsWith("/balance") ? { data: { balance: "1", currency: "CNY" } } : url.endsWith("/detail") ? { data: { planName: reflectedCookie } } : { data: {} });
const reflectedResult = await reflected.service.refresh({ providerIds: [M], force: true });
assert.equal(reflectedResult.entries[0].state, "ok");
for (const secret of [reflectedCookie, "REFLECTED-TOKEN", "REFLECTED-USER"]) {
 assert(!JSON.stringify(reflectedResult).includes(secret), "刷新结果不得回显 Cookie 秘密");
 assert(!JSON.stringify(await reflected.service.refresh({ providerIds: [M], force: false })).includes(secret), "缓存结果不得回显 Cookie 秘密");
}
const quoted = harness({ xiaomi: { cookie: 'api-platform_serviceToken="QUOTED-TOKEN";   userId="QUOTED-USER"' } });
quoted.respond(url => url.endsWith("/balance") ? { data: { balance: "1" } } : url.endsWith("/detail") ? { data: { planName: "QUOTED-TOKEN / QUOTED-USER" } } : { data: {} });
assert.equal((await quoted.service.refresh({ providerIds: [M], force: true })).entries[0].extras.find(x => x.kind === "plan").value, "[redacted] / [redacted]");
// 短 Cookie 不得破坏可信语义/日期/数值余额；登录提交重复脱敏也一样。
const shortCookie = "api-platform_serviceToken=SAFE-TOKEN; userId=1; optional=s; another=o";
const short = harness({ xiaomi: { cookie: shortCookie } });
short.respond(url => url.endsWith("/balance") ? { data: { balance: "12.50", currency: "CNY" } } : url.endsWith("/detail") ? { data: { currentPeriodEnd: "2026-10-26T23:59:59+08:00" } } : { data: { usage: { items: [{ name: "plan_total_token", percent: .2, used: 10, limit: 100 }] } } });
const shortEntry = (await short.service.refresh({ providerIds: [M], force: true })).entries[0];
const checkShort = value => {
 assert.equal(value.providerId, M); assert.equal(value.state, "ok"); assert.equal(value.coverage, "complete");
 assert.equal(value.windows[0].kind, "sub"); assert.equal(value.windows[0].detail.unit, "credits");
 assert.equal(value.windows[0].resetsAt, "2026-10-26T15:59:59.000Z");
 assert.equal(value.extras[0].value, "12.50 CNY"); assert(Number.isFinite(Date.parse(value.lastSuccessAt)));
};
checkShort(shortEntry);
const verifiedShort = await short.service.fetchProvider(M, { key: shortCookie, source: "cookie" }, short.service.load());
checkShort(short.service.commitMimoLogin(shortCookie, short.service.mimoMaterial(short.service.load()), verifiedShort).entries[0]);
// Date.parse 接受 RFC 日期括号注释；只能返回规范化 ISO，不能回放注释中的秘密。
const annotated = harness({ xiaomi: { cookie: reflectedCookie } });
annotated.respond(url => url.endsWith("/balance") ? { data: { balance: "12.50", currency: "CNY" } } : url.endsWith("/detail") ? { data: { currentPeriodEnd: "Mon, 26 Oct 2026 23:59:59 GMT (REFLECTED-TOKEN)" } } : { data: { usage: { items: [{ name: "plan_total_token", percent: .2, used: 10, limit: 100 }] } } });
const checkAnnotated = result => {
 assert.equal(result.entries[0].windows[0].resetsAt, "2026-10-26T23:59:59.000Z");
 assert(!JSON.stringify(result).includes("REFLECTED-TOKEN"));
};
checkAnnotated(await annotated.service.refresh({ providerIds: [M], force: true }));
checkAnnotated(await annotated.service.refresh({ providerIds: [M], force: false }));
const annotatedData = await annotated.service.fetchProvider(M, { key: reflectedCookie, source: "cookie" }, annotated.service.load());
checkAnnotated(annotated.service.commitMimoLogin(reflectedCookie, annotated.service.mimoMaterial(annotated.service.load()), annotatedData));
// 非法明细对象及对象键不能流入 RPC；缺数值明细不伪造 used/limit。
const nested = harness({ xiaomi: { cookie: reflectedCookie } });
nested.respond(url => url.endsWith("/balance") ? { data: { balance: "1", currency: "REFLECTED-TOKEN" } } : url.endsWith("/detail") ? { data: {} } : { data: { usage: { items: [{ name: "plan_total_token", percent: .2, used: { "REFLECTED-TOKEN": "echo" }, limit: 100 }] } } });
const nestedResult = await nested.service.refresh({ providerIds: [M], force: true });
assert.equal(nestedResult.entries[0].windows[0].detail, undefined);
assert(!JSON.stringify(nestedResult).includes("REFLECTED-TOKEN"));
assert(!JSON.stringify(await nested.service.refresh({ providerIds: [M], force: false })).includes("REFLECTED-TOKEN"));
for (const balance of ["REFLECTED-TOKEN", "", "NaN", "Infinity", "0x10"]) assert.throws(() => normalizeMimo({ data: { balance } }, {}, {}));
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
// Kimi 现行响应实测形态：limit_7d 缺失不是结构错误，月池生效，month_code 不作独立窗口。
const kimiLive = normalizeKimi({ limits: [{ window: { duration: 300, timeUnit: "TIME_UNIT_MINUTE" }, detail: { limit: "100", remaining: "100", resetTime: "2026-10-08T12:08:05.600596Z" } }], booster_wallet: { status: "STATUS_DISABLED" }, usages: { limit_5h: { used_ratio: 0, reset_time: "2026-10-08T12:08:05Z" }, limit_month_total: { used_ratio: 0.0006, reset_time: "2026-11-08T00:00:00Z" }, limit_month_code: { used_ratio: 0, reset_time: "2026-11-08T00:00:00Z" } } });
assert.deepEqual(kimiLive.map(w => w.kind), ["5h", "month"]);
assert.equal(kimiLive[0].percent, 0); assert.equal(kimiLive[1].percent, 0.1);
// 无比例池时退回绝对值：limits[] 的 300 分钟项 = 5 小时窗口，顶层 usage = 周额度。
const kimiAbsolute = normalizeKimi({ usage: { limit: "100", used: "26", remaining: "74", resetTime: "2026-08-11T15:53:05Z" }, limits: [{ window: { duration: 300, timeUnit: "TIME_UNIT_MINUTE" }, detail: { limit: "200", used: "139", remaining: "61", resetTime: "2026-08-11T14:00:00Z" } }] });
assert.deepEqual(kimiAbsolute.map(w => w.kind), ["5h", "week"]);
assert.equal(kimiAbsolute[0].percent, 69.5); assert.equal(kimiAbsolute[1].percent, 26);
assert.throws(() => normalizeKimi({ usages: { unknown_window: { used_ratio: 0 } } }));
assert.throws(() => normalizeZai({ data: { limits: [{ type: "CREDIT_LIMIT", unit: 3, percentage: NaN }] } }));
const peers = normalizeZai({ data: { limits: [{ type: "CREDIT_LIMIT", unit: 6, percentage: 100 }, { type: "CREDIT_LIMIT", unit: 6, percentage: 10 }, { type: "CREDIT_LIMIT", unit: 3, percentage: 0 }] } });
assert.equal(peers.windows[1].status, "ok"); assert.deepEqual(peers.windows[2].detail.blockedBy, ["week"]);
const mimo = normalizeMimo({ data: { balance: "0" } }, {}, { data: { usage: { items: [{ name: "plan_total_token", percent: .995 }] } } }); assert.equal(mimo.windows[0].percent, 99.5); assert.equal(mimo.windows[0].status, "ok");
const malformed = harness({ keys: { [Z]: "x" } }); malformed.respond(() => "not JSON"); result = await malformed.service.refresh({ providerIds: [Z], force: true }); assert.equal(result.entries[0].errorCode, "subusage/response"); assert.equal(result.entries[0].retryable, false);
malformed.respond(() => new Error("authorization=SECRET")); result = await malformed.service.refresh({ providerIds: [Z], force: true }); assert(!JSON.stringify(result).includes("SECRET")); assert.equal(result.entries[0].errorCode, "subusage/network");
h.service.dispose(); assert.equal(h.service.cache.size, 0); assert.equal(h.service.inflight.size, 0); await assert.rejects(h.service.read(), e => e.code === "subusage/disposed");
console.log("PASS Host service contracts/cache/patch/errors/normalizers (isolated memory fixtures)");

// 手动映射仅修改显示设置；多端点持久化、开关保留、重复路由拒绝。
{
 const local = harness();
 let state = await local.service.read({ providerIds: [], force: false });
 assert.equal(state.settings.visibility.manualMatching, false);
 assert.deepEqual(state.availableProviders, [Z]);
 const beforeConfigured = state.configured;
 const mappings = { [K]: ["custom-kimi", "custom-kimi-alt"] };
 state = await local.service.save({ expectedRevision: state.settings.revision, visibility: { manualMatching: true, providerMappings: mappings } });
 assert.deepEqual(state.settings.visibility.providerMappings, mappings);
 assert.deepEqual(state.configured, beforeConfigured);
 assert.equal(local.calls.length, 0, "显示绑定不调用订阅接口");
 const restored = harness(JSON.parse(local.files.get("memory/config")));
 let loaded = await restored.service.read({ providerIds: [], force: false });
 assert.equal(loaded.settings.visibility.manualMatching, true);
 assert.deepEqual(loaded.settings.visibility.providerMappings, mappings);
 loaded = await restored.service.save({ expectedRevision: loaded.settings.revision, visibility: { manualMatching: false } });
 assert.deepEqual(loaded.settings.visibility.providerMappings, mappings);
 for (const providerMappings of [{ [K]: ["same", "same"] }, { [K]: ["same"], [Z]: ["same"] }, { unknown: ["route"] }, { [K]: [""] }]) {
  await assert.rejects(restored.service.save({ expectedRevision: loaded.settings.revision, visibility: { providerMappings } }), error => error.code === "subusage/invalid-request");
 }
}

// 显示映射的保存不作废在途查询；检测/凭据配置仍沿用原有变更保护。
for (const visibility of [{ manualMatching: true, providerMappings: { [Z]: ["custom-zai", "custom-zai-alt"] } }, { hideWithoutApi: false }]) {
 const local = harness(); local.credential[Z] = { value: "test-key" };
 const initial = await local.service.read({ providerIds: [], force: false });
 let release, started;
 const ready = new Promise(resolve => { started = resolve; });
 const pendingResponse = new Promise(resolve => { release = resolve; });
 local.respond(() => { started(); return pendingResponse; });
 const pending = local.service.refresh({ providerIds: [Z], force: true });
 await ready;
 await local.service.save({ expectedRevision: initial.settings.revision, visibility });
 release(zBody);
 const finished = await pending;
 if (visibility.manualMatching) {
  assert.equal(finished.entries[0].state, "ok", "保存显示映射不能作废在途额度");
  assert.equal(finished.settings.visibility.manualMatching, true);
  assert.deepEqual(finished.settings.visibility.providerMappings[Z], ["custom-zai", "custom-zai-alt"]);
 } else assert.equal(finished.entries[0].errorCode, "subusage/config-changed", "其他配置变更保护保持不变");
 local.service.dispose();
}
