// SuperGrok / X Premium 订阅（xai-oauth）：normalizeSuperGrok（GetGrokCreditsConfig 响应）
// + 共享登录文件凭据直连 Grok CLI 计费代理。凭据来源为 ~/.grok/auth.json（grok login /
// dsh-grok-kit 登录写入）与旧版 ~/.dsh/.xai-oauth-auth.json，只读不写、不刷新 token。
// 不访问真实网络、真实 ~/.grok 或 ~/.dsh。
import assert from "node:assert/strict";
import { homedir } from "node:os";
import { join } from "node:path";
import { loadHostModule } from "./helpers.mjs";

const { SubUsageService, normalizeSuperGrok, subUsageRemote } = await loadHostModule();
const X = "xai-oauth";
const GROK_AUTH = join(homedir(), ".grok", "auth.json");
const DSH_AUTH = join(homedir(), ".dsh", ".xai-oauth-auth.json");
const PERIOD = { type: "USAGE_PERIOD_TYPE_WEEKLY", start: "2026-10-07T11:18:57.966152+00:00", end: "2026-10-14T11:18:57.966152+00:00" };
const billing = (config = {}, extra = {}) => ({ config: { currentPeriod: PERIOD, creditUsagePercent: 1, prepaidBalance: { val: 0 }, ...config }, ...extra });
const settings = (tier = "SuperGrok") => ({ subscription_tier_display: tier });

// ── 归一化：实测周池形态（已用 %、周窗、重置、套餐、加量余额）──────────────
const out = normalizeSuperGrok(billing(), settings());
assert.equal(out.windows.length, 1);
const week = out.windows[0];
assert.equal(week.kind, "week"); assert.equal(week.percent, 1); assert.equal(week.status, "ok");
assert.equal(week.resetsAt, new Date(PERIOD.end).toISOString());
assert.deepEqual(out.extras, [{ kind: "plan", value: "SuperGrok" }, { kind: "balance", value: "0.00 USD" }]);
assert.equal(out.coverage, "complete");
// creditUsagePercent 是已用百分比：100 即耗尽；99.95 按既有收顶规则显示 99.9。
assert.equal(normalizeSuperGrok(billing({ creditUsagePercent: 100 }), settings()).windows[0].status, "rate-limited");
assert.equal(normalizeSuperGrok(billing({ creditUsagePercent: 99.95 }), settings()).windows[0].percent, 99.9);
assert.equal(normalizeSuperGrok(billing({ creditUsagePercent: 0 }), settings()).windows[0].percent, 0);
assert.equal(normalizeSuperGrok(billing({ creditUsagePercent: 0 }), settings()).windows[0].status, "ok", "0% 不是额度耗尽");

// ── 周期归类：周/月/未知枚举/缺失周期，都不猜窗口名 ─────────────────────────
assert.equal(normalizeSuperGrok(billing({ currentPeriod: { ...PERIOD, type: "USAGE_PERIOD_TYPE_MONTHLY" } }), settings()).windows[0].kind, "month");
assert.equal(normalizeSuperGrok(billing({ currentPeriod: { ...PERIOD, type: "USAGE_PERIOD_TYPE_DAILY" } }), settings()).windows[0].kind, "sub");
assert.equal(normalizeSuperGrok(billing({ currentPeriod: { end: PERIOD.end } }), settings()).windows[0].kind, "sub", "缺 type 不猜周窗");
assert.equal(normalizeSuperGrok(billing({ currentPeriod: undefined }), settings()).windows[0].kind, "sub", "无任何账期信息归通用订阅池");
assert.equal(normalizeSuperGrok(billing({ currentPeriod: undefined, billingPeriodStart: "2026-10-01T00:00:00Z", billingPeriodEnd: "2026-11-01T00:00:00Z" }), settings()).windows[0].kind, "month", "旧形态按月账期");
// 重置时间只认合法日期字符串。
assert.equal(normalizeSuperGrok(billing({ currentPeriod: { ...PERIOD, end: "not-a-date" } }), settings()).windows[0].resetsAt, undefined);

// ── 旧形态回退：无百分比时按美分绝对值折算；{}（proto3 零值）解码为 0 ────────
const legacy = normalizeSuperGrok({ config: { monthlyLimit: { val: 2000 }, used: { val: 1234 }, billingPeriodStart: "2026-10-01T00:00:00Z", billingPeriodEnd: "2026-11-01T00:00:00Z" } }, settings());
assert.equal(legacy.windows[0].percent, 61.7);
assert.equal(legacy.windows[0].kind, "month");
assert.equal(legacy.windows[0].resetsAt, new Date("2026-11-01T00:00:00Z").toISOString());
assert.equal(normalizeSuperGrok({ config: { monthlyLimit: { val: 100 }, used: {} } }, settings()).windows[0].percent, 0, "零值 used 不当作缺失");
// 无上限（limit<=0）不能折算比例，也不冒充零用量。
assert.throws(() => normalizeSuperGrok({ config: { monthlyLimit: { val: 0 }, used: { val: 5 } } }), (e) => e.code === "subusage/response");
assert.throws(() => normalizeSuperGrok({ config: { used: { val: 5 } } }), (e) => e.code === "subusage/response", "无 percent 且无上限 → 整包无效");
assert.throws(() => normalizeSuperGrok(billing({ creditUsagePercent: "5" }), settings()), (e) => e.code === "subusage/response");
assert.throws(() => normalizeSuperGrok(billing({ creditUsagePercent: undefined }), settings()), (e) => e.code === "subusage/response");
assert.throws(() => normalizeSuperGrok(null), (e) => e.code === "subusage/response");
assert.throws(() => normalizeSuperGrok({}), (e) => e.code === "subusage/response");

// ── extras：套餐名两级回退；余额只合并报告过的值 ───────────────────────────
assert.deepEqual(normalizeSuperGrok(billing({ creditUsagePercent: 1 }, { subscription_tier: "X Premium+" }), settings("SuperGrok")).extras, [{ kind: "plan", value: "SuperGrok" }, { kind: "balance", value: "0.00 USD" }], "settings 显示名优先");
assert.deepEqual(normalizeSuperGrok(billing({ creditUsagePercent: 1 }, { subscription_tier: "X Premium+" }), undefined).extras, [{ kind: "plan", value: "X Premium+" }, { kind: "balance", value: "0.00 USD" }], "settings 缺失回退 billing 响应");
assert.deepEqual(normalizeSuperGrok(billing({ creditUsagePercent: 1 }, { subscription_tier: "  " }), settings("   ")).extras, [{ kind: "balance", value: "0.00 USD" }], "空白套餐名不显示");
assert.deepEqual(normalizeSuperGrok(billing({ creditUsagePercent: 1, prepaidBalance: { val: 1250 } }), settings()).extras, [{ kind: "plan", value: "SuperGrok" }, { kind: "balance", value: "12.50 USD" }]);
assert.deepEqual(normalizeSuperGrok(billing({ creditUsagePercent: 1, prepaidBalance: { val: -50 } }), settings()).extras, [{ kind: "plan", value: "SuperGrok" }, { kind: "balance", value: "-0.50 USD" }], "负值余额如实显示，不当作缺失");
assert.ok(!normalizeSuperGrok(billing({ creditUsagePercent: 1, prepaidBalance: {} }), settings()).extras.some(x => x.kind === "balance"), "{} 零值不显示余额行");
assert.ok(!normalizeSuperGrok(billing({ creditUsagePercent: 1, prepaidBalance: undefined }), settings()).extras.some(x => x.kind === "balance"), "未报告的余额不冒充 0");

// ── 服务路径：共享登录文件解析、请求头、并行拉取、错误映射 ─────────────────
function harness({ grokText, dshText, respond, stored } = {}) {
	const files = new Map([[GROK_AUTH, grokText], [DSH_AUTH, dshText]].filter(([, v]) => v !== undefined));
	if (stored) files.set("memory/config", JSON.stringify(stored));
	let now = Date.parse("2026-01-01T00:00:00Z");
	const calls = [];
	let response = respond ?? ((url) => url.includes("billing") ? billing() : settings());
	const io = {
		readFileSync(path) {
			if (!files.has(path)) throw Object.assign(new Error("missing"), { code: "ENOENT" });
			return files.get(path);
		},
		mkdirSync() {}, writeFileSync(path, value) { files.set(path, value); }, chmodSync() {}, renameSync() {}
	};
	const ctx = { get() {}, llm: { listProviders: () => [{ id: X }] }, effect() {} };
	const service = new SubUsageService(ctx, {
		io, configPath: "memory/config", now: () => now,
		fetch: async (url, options) => {
			calls.push({ url, options });
			const value = await response(url, options);
			if (value instanceof Error) throw value;
			if (value?.http) return { ok: false, status: value.http, headers: { get: () => value.retryAfter ?? null } };
			return { ok: true, status: 200, headers: { get: () => null }, text: async () => typeof value === "string" ? value : JSON.stringify(value) };
		}
	});
	return { service, calls, tick: (ms) => now += ms, files };
}
const SLOT = "https://auth.x.ai::b1a00492-073a-47ea-816f-4c329264a828";
const grokDoc = (slot = {}) => JSON.stringify({ [SLOT]: { key: "oauth-bearer", user_id: "user-1", refresh_token: "r", auth_mode: "oidc", ...slot } });

const served = harness({ grokText: grokDoc() });
const entry = (await served.service.refresh({ providerIds: [X], force: false })).entries[0];
assert.equal(entry.state, "ok"); assert.equal(entry.keySource, "auth-file");
assert.equal(entry.label, "SuperGrok"); assert.equal(entry.coverage, "complete");
assert.equal(served.calls.length, 2, "billing 与 settings 并行拉取");
assert.equal(served.calls[0].url, "https://cli-chat-proxy.grok.com/v1/billing?format=credits");
assert.equal(served.calls[1].url, "https://cli-chat-proxy.grok.com/v1/settings");
for (const call of served.calls) {
	assert.equal(call.options.headers.authorization, "Bearer oauth-bearer");
	assert.equal(call.options.headers["x-xai-token-auth"], "xai-grok-cli", "X-XAI-Token-Auth 是 token_header 字符串而非布尔");
	assert.equal(call.options.headers["x-userid"], "user-1");
	assert.equal(call.options.headers["x-grok-client-version"], "1.0.13");
}
assert.deepEqual(entry.extras, [{ kind: "plan", value: "SuperGrok" }, { kind: "balance", value: "0.00 USD" }]);

// ── 过期 token：不发请求，直接说「去刷一次」，而不是笼统的「凭据已失效」──────
// 登录文件里的 access token 短命（实测 ~24h），本插件刻意不代刷（refresh-token 轮换归 Grok CLI /
// grok-kit 的锁协议）。但不读 expires_at 的话，用户看到的只是上游 401 转成的「登录或凭据已失效」，
// 而他那边的 Grok Kit 明明写着「已登录」——两边对不上，只会以为插件坏了。
{
	const expired = harness({ grokText: grokDoc({ expires_at: "2025-12-31T00:00:00.000Z" }) });
	const stale = (await expired.service.refresh({ providerIds: [X], force: true })).entries[0];
	assert.equal(stale.state, "error");
	assert.equal(stale.errorCode, "subusage/auth");
	assert.ok(stale.error.includes("过期") && stale.error.includes("已于"), "要说是过期，不是笼统的凭据失效");
	assert.ok(stale.error.includes("Grok CLI") && stale.error.includes("不代刷"), "给出可执行的下一步，并说明为什么不代刷");
	assert.equal(expired.calls.length, 0, "已过期就不发这一枪");
	expired.service.dispose();
}
{
	// 未过期照常请求：别把好 token 判死。
	const fresh = harness({ grokText: grokDoc({ expires_at: "2026-06-01T00:00:00.000Z" }) });
	assert.equal((await fresh.service.refresh({ providerIds: [X], force: true })).entries[0].state, "ok");
	assert.equal(fresh.calls.length, 2);
	fresh.service.dispose();
}
{
	// 没有 expires_at 的形态（旧信封）不当作过期。
	const noExpiry = harness({ grokText: grokDoc() });
	assert.equal((await noExpiry.service.refresh({ providerIds: [X], force: true })).entries[0].state, "ok");
	noExpiry.service.dispose();
}

// settings 拉取失败不阻塞用量：套餐回退 billing 响应，无则不显示。
const settingsDown = harness({ grokText: grokDoc(), respond: (url) => url.includes("billing") ? billing({ creditUsagePercent: 30 }, { subscription_tier: "X Premium+" }) : { http: 500 } });
const downEntry = (await settingsDown.service.refresh({ providerIds: [X], force: true })).entries[0];
assert.equal(downEntry.state, "ok"); assert.equal(downEntry.windows[0].percent, 30);
assert.deepEqual(downEntry.extras, [{ kind: "plan", value: "X Premium+" }, { kind: "balance", value: "0.00 USD" }]);

// 槽位解析：优先 auth.x.ai，其次旧签发方，最后任意槽位；user_id 缺失回退 JWT sub。
const jwt = (sub) => `h.${Buffer.from(JSON.stringify({ sub })).toString("base64url")}.s`;
const multiSlot = JSON.stringify({
	"xai::api_key": { key: "api-key-slot" },
	"https://accounts.x.ai/sign-in": { key: "legacy-slot", user_id: "legacy-user" }
});
const multi = harness({ grokText: multiSlot });
assert.equal((await multi.service.refresh({ providerIds: [X], force: false })).entries[0].keySource, "auth-file");
assert.equal(multi.calls[0].options.headers.authorization, "Bearer legacy-slot", "无 auth.x.ai 槽位时取旧签发方槽位");
assert.equal(multi.calls[0].options.headers["x-userid"], "legacy-user");
const preferred = harness({ grokText: JSON.stringify({ "https://accounts.x.ai/sign-in": { key: "legacy-slot" }, [SLOT]: { key: "oidc-slot", user_id: "oidc-user" } }) });
assert.equal((await preferred.service.refresh({ providerIds: [X], force: false })).entries[0].state, "ok");
assert.equal(preferred.calls[0].options.headers.authorization, "Bearer oidc-slot", "auth.x.ai 槽位优先");
const fallbackAny = harness({ grokText: JSON.stringify({ "xai::api_key": { key: "any-slot" } }) });
assert.equal((await fallbackAny.service.refresh({ providerIds: [X], force: false })).entries[0].keySource, "auth-file");
assert.equal(fallbackAny.calls[0].options.headers.authorization, "Bearer any-slot");
const fromJwt = harness({ grokText: JSON.stringify({ [SLOT]: { key: jwt("jwt-user") } }) });
assert.equal((await fromJwt.service.refresh({ providerIds: [X], force: false })).entries[0].state, "ok");
assert.equal(fromJwt.calls[0].options.headers["x-userid"], "jwt-user", "登录文件缺 user_id 时取 JWT sub");
assert.equal(fromJwt.calls[0].options.headers.authorization, `Bearer ${jwt("jwt-user")}`);

// dsh 旧版信封格式（~/.dsh/.xai-oauth-auth.json）。
const envelope = harness({ dshText: JSON.stringify({ version: 1, credential: { type: "oauth", access: "envelope-bearer", refresh: "r", expires: Date.now() + 60000, accountId: "acct-9" } }) });
const envelopeEntry = (await envelope.service.refresh({ providerIds: [X], force: false })).entries[0];
assert.equal(envelopeEntry.state, "ok"); assert.equal(envelopeEntry.keySource, "auth-file");
assert.equal(envelope.calls[0].options.headers.authorization, "Bearer envelope-bearer");
assert.equal(envelope.calls[0].options.headers["x-userid"], "acct-9");
// ~/.grok/auth.json 存在时优先于 dsh 信封（与 grok-kit 的 resolveXaiOAuthStorePath 同序）。
const both = harness({ grokText: grokDoc(), dshText: JSON.stringify({ version: 1, credential: { type: "oauth", access: "envelope-bearer", refresh: "r", expires: 1, accountId: "acct-9" } }) });
await both.service.refresh({ providerIds: [X], force: false });
assert.equal(both.calls[0].options.headers.authorization, "Bearer oauth-bearer");

// ── 缺凭据 / 坏文件：no-key，不发请求；旧配置不能绕过 managed 边界 ─────────
const noFile = harness();
const noKey = (await noFile.service.refresh({ providerIds: [X], force: false })).entries[0];
assert.equal(noKey.state, "no-key"); assert.equal(noKey.errorCode, "subusage/no-key");
assert.ok(noKey.error.includes("Grok"), "no-key 文案指向 Grok 登录");
assert.equal(noFile.calls.length, 0, "缺凭据不发请求");
const emptyDoc = harness({ grokText: "{}" });
assert.equal((await emptyDoc.service.refresh({ providerIds: [X], force: false })).entries[0].state, "no-key", "空 Grok 文档（无槽位）按未登录");
assert.equal(emptyDoc.calls.length, 0);
const broken = harness({ grokText: "not JSON" });
assert.equal((await broken.service.refresh({ providerIds: [X], force: false })).entries[0].state, "no-key", "坏文件按未登录，不当作凭据");
const obsolete = harness({ grokText: grokDoc(), stored: { keys: { [X]: "obsolete-secret" }, keyModes: { [X]: "manual" } } });
const obsoleteResult = await obsolete.service.refresh({ providerIds: [X], force: true });
assert.equal(obsoleteResult.entries[0].keySource, "auth-file");
assert.equal(obsolete.calls[0].options.headers.authorization, "Bearer oauth-bearer", "旧配置私存 Key 不生效");
assert.equal(obsoleteResult.settings.hasKeys[X], false);
assert.equal(obsoleteResult.settings.keyModes[X], "inherit");
assert.throws(() => subUsageRemote.descriptors.find((d) => d.method === "save").parameters[0].codec.schema.parse({ providerId: X, keyUpdate: { action: "keep" } }), /managed by the provider plugin/, "managed 边界拒绝写凭据");
assert.throws(() => subUsageRemote.descriptors.find((d) => d.method === "save").parameters[0].codec.schema.parse({ providerId: X, keyMode: "manual" }), /managed by the provider plugin/);

// ── 错误映射与缓存 ─────────────────────────────────────────────────────────
const denied = harness({ grokText: grokDoc(), respond: () => ({ http: 401 }) });
assert.equal((await denied.service.refresh({ providerIds: [X], force: true })).entries[0].errorCode, "subusage/auth");
const temporary = harness({ grokText: grokDoc(), respond: () => ({ http: 500 }) });
assert.equal((await temporary.service.refresh({ providerIds: [X], force: true })).entries[0].errorCode, "subusage/http");
const badJson = harness({ grokText: grokDoc(), respond: () => "not JSON" });
assert.equal((await badJson.service.refresh({ providerIds: [X], force: true })).entries[0].errorCode, "subusage/response");
// TTL 内命中缓存；token 轮换（文件变化）后 fingerprint 变化必须重新拉取。
const caching = harness({ grokText: grokDoc() });
await caching.service.refresh({ providerIds: [X], force: false });
await caching.service.refresh({ providerIds: [X], force: false });
assert.equal(caching.calls.length, 2, "TTL 内命中缓存");
caching.files.set(GROK_AUTH, grokDoc({ key: "rotated-bearer" }));
await caching.service.refresh({ providerIds: [X], force: false });
assert.equal(caching.calls.length, 4, "token 轮换后重新拉取");
assert.equal(caching.calls.at(-1).options.headers.authorization, "Bearer rotated-bearer");
caching.tick(60001);
await caching.service.refresh({ providerIds: [X], force: false });
assert.equal(caching.calls.length, 6, "过 TTL 后重新拉取");

console.log("PASS SuperGrok 归一化、共享登录文件凭据、请求头、并行拉取、错误映射与缓存");
