// Provider switches: persistence/migration/API presence/revision/cache/inflight. No real user files or keys.
import assert from "node:assert/strict";
import { loadHostModule } from "./helpers.mjs";
const { SubUsageService, subUsageRemote } = await loadHostModule();
const M = "minimax-cn", C = "commandcode", Z = "zai-coding-cn";
const files = new Map([["memory/config", JSON.stringify({ keys: { [M]: "fixture-key" }, zai: { type: 2, organization: "org", project: "project" } })]]);
let calls = 0, failure = false, pending;
const body = { base_resp: { status_code: 0 }, model_remains: [{ model_name: "general", current_interval_remaining_percent: 80, current_weekly_remaining_percent: 60 }] };
const io = { readFileSync(path) { if (!files.has(path)) throw Object.assign(new Error("missing"), { code: "ENOENT" }); return files.get(path); }, mkdirSync() {}, writeFileSync(path, value) { if (failure) throw new Error("write failed"); files.set(path, value); }, chmodSync() {}, renameSync(from, to) { files.set(to, files.get(from)); files.delete(from); } };
const options = { io, configPath: "memory/config", resolveCredentials: async () => undefined, resolveEnvironment: () => undefined, fetch: async () => { calls++; if (pending) await pending; return { ok: true, status: 200, headers: { get: () => null }, text: async () => JSON.stringify(body) }; } };
const ctx = { effect() {}, llm: { listProviders: () => [{ id: Z }] } };
let service = new SubUsageService(ctx, options);
let result = await service.read();
assert.equal(result.settings.visibility.hideWithoutApi, true);
assert(Object.values(result.settings.visibility.providers).every(Boolean), "旧配置全部开关默认开启");
assert.equal(result.configured[Z], true); assert.equal(result.entries.find(e => e.providerId === Z).apiDetected, false, "有路由不代表有 Key");
assert.equal(result.configured[M], false); assert.equal(result.entries.find(e => e.providerId === M).apiDetected, true, "有手动 Key 即可检测，不依赖路由注册");
assert.equal(calls, 1); assert(!JSON.stringify(result).includes("fixture-key"));
const originalKeys = JSON.parse(files.get("memory/config")).keys;
const save = subUsageRemote.descriptors.find(d => d.method === "save").parameters[0].codec.schema;
for (const patch of [
 { visibility: { hideWithoutApi: true } },
 { expectedRevision: "r", visibility: {} },
 { expectedRevision: "r", visibility: { hideWithoutApi: "true" } },
 { expectedRevision: "r", visibility: { providers: { unknown: false } } },
 { expectedRevision: "r", visibility: { providers: { [M]: 0 } } },
 { expectedRevision: "r", visibility: { providers: [] } },
 { expectedRevision: "r", visibility: { providers: {} } },
 { expectedRevision: "r", visibility: { extra: true } },
 { expectedRevision: "r", visibility: { providers: { [M]: false } }, providerId: M, keyUpdate: { action: "clear" } }
]) assert.throws(() => save.parse(patch));
const initialRevision = result.settings.revision;
result = await service.save({ expectedRevision: initialRevision, visibility: { hideWithoutApi: false } });
assert.equal(result.settings.visibility.hideWithoutApi, false);
await service.refresh({ providerIds: [M], force: false }); assert.equal(calls, 1, "只改隐藏策略不清用量缓存");
await assert.rejects(service.save({ expectedRevision: initialRevision, visibility: { hideWithoutApi: true } }), e => e.code === "subusage/revision-conflict");
result = await service.save({ expectedRevision: result.settings.revision, visibility: { providers: { [M]: false, [C]: false } } });
const stored = JSON.parse(files.get("memory/config")); assert.deepEqual(stored.keys, originalKeys); assert.equal(stored.zai.organization, "org"); assert.equal(stored.visibility.providers[Z], true);
result = await service.refresh({ providerIds: [M], force: true }); assert.equal(calls, 1, "关闭后即使强制刷新也不请求用量接口");
assert.equal(result.entries[0].state, "disabled"); assert.equal(result.entries[0].apiDetected, true); assert.deepEqual(result.entries[0].windows, []);
service.dispose(); service = new SubUsageService(ctx, options);
result = await service.read(); assert.equal(result.settings.visibility.providers[M], false); assert.equal(result.settings.visibility.providers[C], false); assert.equal(calls, 1, "跨实例持久化关闭状态");
const previous = files.get("memory/config"); failure = true;
await assert.rejects(service.save({ expectedRevision: result.settings.revision, visibility: { providers: { [M]: true } } }));
assert.equal(files.get("memory/config"), previous); failure = false;
result = await service.save({ expectedRevision: result.settings.revision, visibility: { providers: { [M]: true } } });
result = await service.refresh({ providerIds: [M], force: true }); assert.equal(calls, 2); assert.equal(result.entries[0].state, "ok");
let release; pending = new Promise(resolve => release = resolve);
const old = service.refresh({ providerIds: [M], force: true });
for (let i = 0; i < 20 && calls < 3; i++) await Promise.resolve(); assert.equal(calls, 3);
await service.save({ expectedRevision: result.settings.revision, visibility: { providers: { [M]: false } } }); release(); await old; pending = null;
result = await service.refresh({ providerIds: [M], force: true }); assert.equal(result.entries[0].state, "disabled"); assert.equal(calls, 3, "关闭后迟到请求不会复活缓存或触发新请求");
service.dispose();
console.log("PASS provider switches, API presence, migration, persistence, cache and race guards");
