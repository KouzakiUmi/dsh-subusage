// Provider switches: persistence/migration/API presence/revision/cache/inflight. No real user files or keys.
import assert from "node:assert/strict";
import { loadHostModule } from "./helpers.mjs";
const { SubUsageService, subUsageRemote } = await loadHostModule();
const M = "minimax-cn", C = "commandcode", Z = "zai-coding-cn";
const files = new Map([["memory/config", JSON.stringify({ keys: { [M]: "fixture-key" }, zai: { type: 2, organization: "org", project: "project" } })]]);
let calls = 0, failure = false, pending;
const body = { base_resp: { status_code: 0 }, model_remains: [{ model_name: "general", current_interval_remaining_percent: 80, current_weekly_remaining_percent: 60 }] };
const io = { readFileSync(path) { if (!files.has(path)) throw Object.assign(new Error("missing"), { code: "ENOENT" }); return files.get(path); }, mkdirSync() {}, writeFileSync(path, value) { if (failure) throw new Error("write failed"); files.set(path, value); }, chmodSync() {}, renameSync(from, to) { files.set(to, files.get(from)); files.delete(from); } };
const options = { io, configPath: "memory/config", resolveCredentials: async () => undefined, resolveCredentialByName: async () => undefined, resolveEnvironment: () => undefined, resolveEnvironmentByName: () => undefined, fetch: async () => { calls++; if (pending) await pending; return { ok: true, status: 200, headers: { get: () => null }, text: async () => JSON.stringify(body) }; } };
const ctx = { effect() {}, llm: { listProviders: () => [{ id: Z }] } };
let service = new SubUsageService(ctx, options);
let result = await service.read();
assert.equal(result.settings.visibility.hideWithoutApi, true);
const DEFAULT_OFF = ["zai-coding", "synthetic", "nanogpt", "siliconflow", "openrouter", "novita", "hyperbolic", "deepinfra", "chutes", "ollama-cloud", "vercel-ai-gateway", "minimax", "zenmux", "litellm", "opendesign", "openai-codex", "github-copilot", "apigoto"];
const ARK_PERSONAL = ["arkcli-agent-plan", "arkcli-coding-plan"];
const ARK_TEAM = ["arkcli-agent-plan-team", "arkcli-coding-plan-team"];
const ARK_ROUTES = [...ARK_PERSONAL, ...ARK_TEAM];
assert.equal(result.settings.visibility.ark, true, "Ark 个人版组默认开启");
assert.equal(result.settings.visibility.arkTeam, false, "Ark Team 默认独立关闭");
assert(Object.entries(result.settings.visibility.providers).every(([id, on]) => ARK_PERSONAL.includes(id) ? on === result.settings.visibility.ark : ARK_TEAM.includes(id) ? on === result.settings.visibility.arkTeam : DEFAULT_OFF.includes(id) ? !on : on), "旧厂商保持默认值；Ark 逐条值分别跟随个人版 / Team 开关");
assert.equal(result.configured[Z], true); assert.equal(result.entries.find(e => e.providerId === Z).apiDetected, false, "有路由不代表有 Key");
assert.equal(result.configured[M], false); assert.equal(result.entries.find(e => e.providerId === M).apiDetected, true, "有手动 Key 即可检测，不依赖路由注册");
assert.equal(calls, 1); assert(!JSON.stringify(result).includes("fixture-key"));
const originalKeys = JSON.parse(files.get("memory/config")).keys;
const save = subUsageRemote.descriptors.find(d => d.method === "save").parameters[0].codec.schema;
for (const patch of [
 { visibility: { hideWithoutApi: true } },
 { expectedRevision: "r", visibility: {} },
 { expectedRevision: "r", visibility: { hideWithoutApi: "true" } },
 { expectedRevision: "r", visibility: { ark: "yes" } },
 { expectedRevision: "r", visibility: { arkTeam: "yes" } },
 { expectedRevision: "r", visibility: { providers: { unknown: false } } },
 { expectedRevision: "r", visibility: { providers: { [M]: 0 } } },
 { expectedRevision: "r", visibility: { providers: [] } },
 { expectedRevision: "r", visibility: { providers: {} } },
 { expectedRevision: "r", visibility: { extra: true } },
 { expectedRevision: "r", visibility: { providers: { [M]: false } }, providerId: M, keyUpdate: { action: "clear" } }
]) assert.throws(() => save.parse(patch));
// 个人版与 Team 独立：任一组的开关和禁用状态都不得改到另一组。
result = await service.save({ expectedRevision: result.settings.revision, visibility: { arkTeam: true } });
assert.equal(result.settings.visibility.ark, true);
assert.equal(result.settings.visibility.arkTeam, true);
assert(ARK_TEAM.every(id => result.settings.visibility.providers[id] === true));
result = await service.save({ expectedRevision: result.settings.revision, visibility: { ark: false } });
assert.equal(result.settings.visibility.arkTeam, true, "关闭个人版不得关闭 Team");
let arkStates = await service.refresh({ providerIds: [ARK_PERSONAL[0], ARK_TEAM[0]], force: true });
assert.equal(arkStates.entries.find(e => e.providerId === ARK_PERSONAL[0]).state, "disabled", JSON.stringify(arkStates.entries));
assert.notEqual(arkStates.entries.find(e => e.providerId === ARK_TEAM[0]).state, "disabled", "个人版关闭时 Team 仍可独立检测");
result = await service.save({ expectedRevision: result.settings.revision, visibility: { ark: true, arkTeam: false } });
assert(ARK_PERSONAL.every(id => result.settings.visibility.providers[id] === true));
assert(ARK_TEAM.every(id => result.settings.visibility.providers[id] === false));
arkStates = await service.refresh({ providerIds: [ARK_PERSONAL[0], ARK_TEAM[0]], force: true });
assert.notEqual(arkStates.entries.find(e => e.providerId === ARK_PERSONAL[0]).state, "disabled");
assert.equal(arkStates.entries.find(e => e.providerId === ARK_TEAM[0]).state, "disabled", "Team 关闭后不再检测，个人版不受影响");
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
