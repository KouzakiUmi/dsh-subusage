// SuperGrok / X Premium 订阅（xai-oauth）：normalizeSuperGrok（GetGrokCreditsConfig 响应）
// + 共享登录文件凭据直连 Grok CLI 计费代理。凭据来源为 ~/.grok/auth.json（grok login /
// dsh-grok-kit 登录写入）与旧版 ~/.dsh/.xai-oauth-auth.json。token 过期时借 dsh-grok-kit 的
// 官方会话链（XaiOAuthSession.getAuth）续约同一文件；兄弟插件不可用或刷新失败才退回手动提示。
// 不访问真实网络、真实 ~/.grok 或 ~/.dsh。
import assert from "node:assert/strict";
import { homedir } from "node:os";
import { join } from "node:path";
import { loadHostModule } from "./helpers.mjs";

const { SubUsageService, normalizeSuperGrok, subUsageRemote, parseGrokCreditsGrpcWeb } = await loadHostModule();
const X = "xai-oauth";
const GROK_AUTH = join(homedir(), ".grok", "auth.json");
const DSH_AUTH = join(homedir(), ".dsh", ".xai-oauth-auth.json");
const PERIOD = { type: "USAGE_PERIOD_TYPE_WEEKLY", start: "2026-10-07T11:18:57.966152+00:00", end: "2026-10-14T11:18:57.966152+00:00" };
function encodeVarint(n) {
	const bytes = [];
	let v = n >>> 0;
	while (v > 0x7f) { bytes.push((v & 0x7f) | 0x80); v >>>= 7; }
	bytes.push(v);
	return Buffer.from(bytes);
}
function protoBytes(number, bytes) { return Buffer.concat([encodeVarint(number * 8 + 2), encodeVarint(bytes.length), bytes]); }
function protoTimestamp(number, iso) {
	const ms = Date.parse(iso), seconds = Math.floor(ms / 1000), nanos = ms % 1000 * 1000000;
	return protoBytes(number, Buffer.concat([Buffer.from([8]), encodeVarint(seconds), ...(nanos ? [Buffer.from([16]), encodeVarint(nanos)] : [])]));
}
function grpcFrame(message, flag = 0) {
	const header = Buffer.alloc(5); header[0] = flag; header.writeUInt32BE(message.length, 1);
	return Buffer.concat([header, message]);
}
function encodeCreditsGrpcWeb({ percent, start, end, currentPeriod, trailerStatus, extraConfig = Buffer.alloc(0) }) {
	const parts = [];
	if (percent !== undefined) {
		const f = Buffer.alloc(4); f.writeFloatLE(percent, 0);
		parts.push(Buffer.from([0x0d]), f);
	}
	if (start) parts.push(protoTimestamp(4, start));
	if (end) parts.push(protoTimestamp(5, end));
	if (currentPeriod) parts.push(protoBytes(8, Buffer.concat([
		Buffer.from([8]), encodeVarint(currentPeriod.type ?? 2),
		...(currentPeriod.start ? [protoTimestamp(2, currentPeriod.start)] : []),
		...(currentPeriod.end ? [protoTimestamp(3, currentPeriod.end)] : [])
	])));
	parts.push(extraConfig);
	const data = grpcFrame(protoBytes(1, Buffer.concat(parts)));
	return trailerStatus === undefined ? data : Buffer.concat([data, grpcFrame(Buffer.from(`grpc-status: ${trailerStatus}\r\n`), 0x80)]);
}
{
	const parsed = parseGrokCreditsGrpcWeb(encodeCreditsGrpcWeb({ percent: 40, start: "2026-10-14T03:32:51Z", end: "2026-10-21T03:32:51Z" }));
	assert.equal(parsed.config.creditUsagePercent, 40);
	assert.equal(parsed.config.currentPeriod.type, "USAGE_PERIOD_TYPE_WEEKLY");
	assert.equal(parsed.config.currentPeriod.end, "2026-10-21T03:32:51.000Z");
	assert.equal(parseGrokCreditsGrpcWeb(new Uint8Array()), undefined);
	assert.equal(parseGrokCreditsGrpcWeb(Buffer.from([0, 0, 0, 0, 0])), undefined);
	const startOnly = parseGrokCreditsGrpcWeb(encodeCreditsGrpcWeb({ percent: 12, start: "2026-10-14T03:32:51Z" }));
	assert.equal(startOnly.config.creditUsagePercent, 12);
	assert.equal(startOnly.config.currentPeriod.start, "2026-10-14T03:32:51.000Z");
	assert.equal(startOnly.config.currentPeriod.end, undefined, "缺结束时间不拿开始时间冒充重置");
	assert.equal(startOnly.config.currentPeriod.type, undefined);
}
// 官方 descriptor：config[1] 是隐式 float 百分比（不是 0–1 比率），current_period 为 field 8。
const ZERO_PERIOD = { type: 2, start: "2026-10-21T03:32:51.963Z", end: "2026-10-28T03:32:51.963Z" };
const ZERO_NOW = Date.parse("2026-10-21T04:00:00Z");
const zeroFrame = (overrides = {}) => encodeCreditsGrpcWeb({ currentPeriod: ZERO_PERIOD, trailerStatus: 0, ...overrides });
{
	const result = parseGrokCreditsGrpcWeb(zeroFrame(), ZERO_NOW);
	assert.equal(result.config.creditUsagePercent, 0, "完整成功且活跃的当前周池，省略 float 就是 proto3 零值");
	assert.deepEqual(result.config.currentPeriod, { ...ZERO_PERIOD, type: "USAGE_PERIOD_TYPE_WEEKLY" });
	assert.equal(parseGrokCreditsGrpcWeb(zeroFrame({ percent: 0.4 }), ZERO_NOW).config.creditUsagePercent.toFixed(1), "0.4", "显式小数百分比不乘 100");
	assert.equal(parseGrokCreditsGrpcWeb(zeroFrame({ percent: 100 }), ZERO_NOW).config.creditUsagePercent, 100);
	assert.equal(parseGrokCreditsGrpcWeb(zeroFrame(), Date.parse(ZERO_PERIOD.start)).config.creditUsagePercent, 0, "起点包含在周期中");
	for (const time of [Date.parse(ZERO_PERIOD.start) - 1, Date.parse(ZERO_PERIOD.end), NaN]) {
		assert.equal(parseGrokCreditsGrpcWeb(zeroFrame(), time).config.creditUsagePercent, undefined, "未来/过期周期或非法时钟不能推断零");
	}
	for (const currentPeriod of [
		{ ...ZERO_PERIOD, type: 0 }, { ...ZERO_PERIOD, type: 3 },
		{ ...ZERO_PERIOD, start: undefined }, { ...ZERO_PERIOD, end: undefined },
		{ ...ZERO_PERIOD, start: ZERO_PERIOD.end, end: ZERO_PERIOD.start }
	]) assert.equal(parseGrokCreditsGrpcWeb(zeroFrame({ currentPeriod }), ZERO_NOW)?.config.creditUsagePercent, undefined);
	const month = parseGrokCreditsGrpcWeb(zeroFrame({ currentPeriod: { type: 1, start: "2026-10-01T00:00:00Z", end: "2026-11-01T00:00:00Z" } }), ZERO_NOW);
	assert.equal(month.config.creditUsagePercent, 0);
	assert.equal(month.config.currentPeriod.type, "USAGE_PERIOD_TYPE_MONTHLY");
	assert.equal(parseGrokCreditsGrpcWeb(zeroFrame({ trailerStatus: undefined }), ZERO_NOW).config.creditUsagePercent, undefined, "无成功 trailer 不确认隐式零");
	assert.equal(parseGrokCreditsGrpcWeb(zeroFrame({ currentPeriod: undefined, start: ZERO_PERIOD.start, end: ZERO_PERIOD.end }), ZERO_NOW).config.creditUsagePercent, undefined, "只有旧账期字段不能确认当前周池");
	assert.equal(parseGrokCreditsGrpcWeb(zeroFrame({ extraConfig: protoBytes(20, Buffer.from([0, 255, 255])) }), ZERO_NOW).config.creditUsagePercent, 0, "未知 opaque 字段不递归猜消息");
	assert.equal(parseGrokCreditsGrpcWeb(zeroFrame({ extraConfig: protoBytes(12, Buffer.alloc(0)) }), ZERO_NOW).config.creditUsagePercent, 0, "零金额消息不阻止零用量");
	const share = Buffer.alloc(4); share.writeFloatLE(20);
	assert.equal(parseGrokCreditsGrpcWeb(zeroFrame({ extraConfig: protoBytes(7, Buffer.concat([Buffer.from([8, 4, 21]), share])) }), ZERO_NOW).config.creditUsagePercent, undefined, "产品百分比不能冒充总量，也不能把缺总量认成零");
	const history = protoBytes(6, protoBytes(3, Buffer.concat([Buffer.from([8, 2]), protoTimestamp(2, ZERO_PERIOD.start), protoTimestamp(3, ZERO_PERIOD.end)])));
	assert.equal(parseGrokCreditsGrpcWeb(encodeCreditsGrpcWeb({ extraConfig: history, trailerStatus: 0 }), ZERO_NOW), undefined, "仅历史周期不算当前周期");
	for (const trailerStatus of [1, 13, 16]) assert.equal(parseGrokCreditsGrpcWeb(zeroFrame({ percent: 40, trailerStatus }), ZERO_NOW), undefined, "错误 trailer 即使有数据也拒绝");
	for (const bytes of [
		zeroFrame().subarray(0, -1), Buffer.concat([zeroFrame(), Buffer.from([0])]),
		grpcFrame(Buffer.from([0x0a, 0x05, 0x0d, 0, 0])), // 子消息 length 越界
		grpcFrame(protoBytes(1, Buffer.from([0]))), // 零字段号
		grpcFrame(protoBytes(1, Buffer.from([0x80, 0x80, 0x80, 0x80, 0x80, 0x80, 0x80, 0x80, 0x80, 2]))),
		grpcFrame(protoBytes(1, Buffer.from([0x0a, 0]))), // 已知 float 错 wire type
		zeroFrame({ percent: NaN }), zeroFrame({ percent: Infinity }), zeroFrame({ percent: -1 }),
		Buffer.concat([zeroFrame(), zeroFrame()]), grpcFrame(protoBytes(1, Buffer.alloc(0)), 1),
		zeroFrame({ extraConfig: protoBytes(8, Buffer.alloc(0)) }), // 重复 current_period
		zeroFrame({ extraConfig: protoBytes(6, Buffer.from([0])) }) // 已知历史消息损坏
	]) assert.equal(parseGrokCreditsGrpcWeb(bytes, ZERO_NOW), undefined, "不完整/畸形/压缩/重复数据不产生隐式零");
	const declared = { type: 1, start: "2026-10-01T00:00:00Z", end: "2026-11-01T00:00:00Z" };
	assert.equal(parseGrokCreditsGrpcWeb(zeroFrame({ percent: 2, start: ZERO_PERIOD.start, end: ZERO_PERIOD.end, currentPeriod: declared }), ZERO_NOW).config.currentPeriod.type, "USAGE_PERIOD_TYPE_MONTHLY", "field 8 是周期真源，不能被旧账期的周长度覆盖");
}
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
const periodOnly = normalizeSuperGrok(billing({ creditUsagePercent: undefined }), settings());
assert.deepEqual(periodOnly.windows, [], "未报告百分比不冒充 0%");
assert.equal(periodOnly.coverage, "partial");
assert.deepEqual(periodOnly.extras, [{ kind: "plan", value: "SuperGrok" }, { kind: "balance", value: "0.00 USD" }]);
assert.throws(() => normalizeSuperGrok(null), (e) => e.code === "subusage/response");
assert.throws(() => normalizeSuperGrok({}), (e) => e.code === "subusage/response");

// ── extras：套餐名两级回退；余额只合并报告过的值 ───────────────────────────
assert.deepEqual(normalizeSuperGrok(billing({ creditUsagePercent: 1 }, { subscription_tier: "X Premium+" }), settings("SuperGrok")).extras, [{ kind: "plan", value: "SuperGrok" }, { kind: "balance", value: "0.00 USD" }], "settings 显示名优先");
assert.deepEqual(normalizeSuperGrok(billing({ creditUsagePercent: 1 }, { subscription_tier: "X Premium+" }), undefined).extras, [{ kind: "plan", value: "X Premium+" }, { kind: "balance", value: "0.00 USD" }], "settings 缺失回退 billing 响应");
assert.deepEqual(normalizeSuperGrok(billing({ creditUsagePercent: 1 }, { subscription_tier: "  " }), settings("   ")).extras, [{ kind: "balance", value: "0.00 USD" }], "空白套餐名不显示");
assert.deepEqual(normalizeSuperGrok(billing({ creditUsagePercent: 1, prepaidBalance: { val: 1250 } }), settings()).extras, [{ kind: "plan", value: "SuperGrok" }, { kind: "balance", value: "12.50 USD" }]);
assert.deepEqual(normalizeSuperGrok(billing({ creditUsagePercent: 1, prepaidBalance: { val: -50 } }), settings()).extras, [{ kind: "plan", value: "SuperGrok" }, { kind: "balance", value: "-0.50 USD" }], "负值余额如实显示，不当作缺失");
assert.deepEqual(normalizeSuperGrok(billing({ prepaidBalance: {} }), settings()).extras.at(-1), { kind: "balance", value: "0.00 USD" }, "官方 proto3 Cent 空消息明确代表零余额");
assert.ok(!normalizeSuperGrok(billing({ creditUsagePercent: 1, prepaidBalance: undefined }), settings()).extras.some(x => x.kind === "balance"), "未报告的余额不冒充 0");

// ── The X Subscription：复用一个共享池，不按产品/套餐倍数虚构额外窗口 ─────
for (const tier of ["Plus", "Premium", "Super", "Ultra"]) {
 const data = normalizeSuperGrok(billing({ creditUsagePercent: 42.5, isUnifiedBillingUser: true, prepaidBalance: { val: 1250 }, productUsage: [{ product: "GrokChat", usagePercent: 20 }, { product: "Cursor", usagePercent: 22.5 }] }), settings(tier));
 assert.equal(data.windows.length, 1);
 assert.equal(data.windows[0].kind, "week");
 assert.equal(data.windows[0].percent, 42.5);
 assert.deepEqual(data.extras, [{ kind: "plan", value: tier }, { kind: "balance", value: "12.50 USD" }]);
}
assert.equal(normalizeSuperGrok(billing({ creditUsagePercent: undefined, onDemandCap: { val: 100 }, onDemandUsed: { val: 50 } })).coverage, "partial", "充值支出比例不是订阅比例");
assert.throws(() => normalizeSuperGrok(billing({ creditUsagePercent: null })), e => e.code === "subusage/response");
assert.throws(() => normalizeSuperGrok(billing({ creditUsagePercent: undefined, currentPeriod: { type: "USAGE_PERIOD_TYPE_WEEKLY", end: "invalid" } })), e => e.code === "subusage/response");
assert.ok(!normalizeSuperGrok(billing({ prepaidBalance: { val: "10" } })).extras.some(x => x.kind === "balance"));

// ── 服务路径：共享登录文件解析、请求头、并行拉取、错误映射 ─────────────────
function harness({ grokText, dshText, respond, stored, grokKit, useDefaultLoader, initialNow = Date.parse("2026-01-01T00:00:00Z") } = {}) {
	const files = new Map([[GROK_AUTH, grokText], [DSH_AUTH, dshText]].filter(([, v]) => v !== undefined));
	if (stored) files.set("memory/config", JSON.stringify(stored));
	let now = initialNow;
	const calls = [];
	const kitCalls = [];
	let response = respond ?? ((url) => url.includes("billing") ? billing() : settings());
	const io = {
		readFileSync(path) {
			if (!files.has(path)) throw Object.assign(new Error("missing"), { code: "ENOENT" });
			return files.get(path);
		},
		mkdirSync() {}, writeFileSync(path, value) { files.set(path, value); }, chmodSync() {}, renameSync() {}
	};
	const ctx = { get() {}, llm: { listProviders: () => [{ id: X }] }, effect() {} };
	// 默认显式返回「未安装兄弟插件」：测试主机即使装着 dsh-grok-kit，也绝不让真实刷新链/网络参与。
	// useDefaultLoader 例外：不注入，走模块里真实的 loadGrokKit（tmpdir 副本中 import 必然失败，
	// 用于覆盖其 catch→undefined 降级路径本身）。
	const resolveGrokKit = useDefaultLoader
		? undefined
		: async () => { kitCalls.push("load"); return grokKit ?? null; };
	const service = new SubUsageService(ctx, {
		io, configPath: "memory/config", now: () => now, resolveGrokKit,
		fetch: async (url, options) => {
			calls.push({ url, options });
			const value = await response(url, options);
			if (value instanceof Error) throw value;
			if (value?.http) return { ok: false, status: value.http, headers: { get: () => value.retryAfter ?? null } };
			if (value?.grpcWeb) return {
				ok: true, status: 200,
				headers: { get: (name) => String(name).toLowerCase() === "content-type" ? "application/grpc-web+proto" : String(name).toLowerCase() === "grpc-status" ? "0" : null },
				arrayBuffer: async () => value.grpcWeb,
				text: async () => { throw new Error("not json"); }
			};
			return { ok: true, status: 200, headers: { get: () => null }, text: async () => typeof value === "string" ? value : JSON.stringify(value), arrayBuffer: async () => new Uint8Array() };
		}
	});
	return { service, calls, kitCalls, tick: (ms) => now += ms, files };
}
const SLOT = "https://auth.x.ai::b1a00492-073a-47ea-816f-4c329264a828";
const grokDoc = (slot = {}) => JSON.stringify({ [SLOT]: { key: "oauth-bearer", user_id: "user-1", refresh_token: "r", auth_mode: "oidc", ...slot } });

const unified = harness({ grokText: grokDoc(), respond: url => url.includes("billing") ? billing({ creditUsagePercent: 23, isUnifiedBillingUser: true, prepaidBalance: { val: 450 } }) : settings("Premium") });
const unifiedEntry = (await unified.service.refresh({ providerIds: [X], force: true })).entries[0];
assert.equal(unifiedEntry.state, "ok");
assert.equal(unifiedEntry.windows.length, 1);
assert.equal(unifiedEntry.windows[0].percent, 23);
assert.deepEqual(unifiedEntry.extras, [{ kind: "plan", value: "Premium" }, { kind: "balance", value: "4.50 USD" }]);
assert.equal(unified.calls.length, 2, "新套餐不重复请求 Cursor 池");
const aliasEntry = (await unified.service.quota({ providerIds: ["X Subscription"] })).providers;
assert.equal(aliasEntry.length, 1);
assert.equal(aliasEntry[0].providerId, X);
assert.equal(unified.calls.length, 2, "别名命中同一路由缓存");
unified.service.dispose();
const omitted = harness({ grokText: grokDoc(), respond: url => url.includes("billing") ? billing({ creditUsagePercent: undefined, isUnifiedBillingUser: true }) : settings("Ultra") });
const omittedEntry = (await omitted.service.refresh({ providerIds: [X], force: true })).entries[0];
assert.equal(omittedEntry.state, "ok");
assert.equal(omittedEntry.coverage, "partial");
assert.deepEqual(omittedEntry.windows, []);
assert.deepEqual(omittedEntry.extras, [{ kind: "plan", value: "Ultra" }, { kind: "balance", value: "0.00 USD" }]);
omitted.service.dispose();

const served = harness({ grokText: grokDoc() });
const entry = (await served.service.refresh({ providerIds: [X], force: false })).entries[0];
assert.equal(entry.state, "ok"); assert.equal(entry.keySource, "auth-file");
assert.equal(entry.label, "Grok (X / SuperGrok)"); assert.equal(entry.coverage, "complete");
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

// ── REST 200 缺百分比：有界 consumer 核验；保留 REST 周期、套餐与余额 ──────
{
	const period = { ...ZERO_PERIOD, type: "USAGE_PERIOD_TYPE_WEEKLY" };
	function partialHarness(grpc, { restPeriod = period, percent, http = 200 } = {}) {
		return harness({ grokText: grokDoc(), initialNow: ZERO_NOW, respond: url => {
			if (String(url).includes("GetGrokCreditsConfig")) return typeof grpc === "function" ? grpc() : grpc;
			if (String(url).includes("billing")) return http !== 200 ? { http } : billing({ creditUsagePercent: percent, currentPeriod: restPeriod, prepaidBalance: { val: 1250 } });
			return settings("SuperGrok");
		} });
	}
	const verified = partialHarness({ grpcWeb: zeroFrame() });
	const result = (await verified.service.refresh({ providerIds: [X], force: true })).entries[0];
	assert.equal(result.state, "ok"); assert.equal(result.coverage, "complete");
	assert.equal(result.windows[0].kind, "week"); assert.equal(result.windows[0].percent, 0);
	assert.equal(result.windows[0].status, "ok"); assert.equal(result.windows[0].resetsAt, ZERO_PERIOD.end);
	assert.deepEqual(result.extras, [{ kind: "plan", value: "SuperGrok" }, { kind: "balance", value: "12.50 USD" }]);
	assert.equal(verified.calls.length, 3, "REST + settings + 一次可选核验");
	assert.equal(verified.calls[2].options.headers.authorization, "Bearer oauth-bearer");
	await verified.service.refresh({ providerIds: [X], force: false });
	assert.equal(verified.calls.length, 3, "核验结果复用既有缓存");
	verified.service.dispose();
	const explicit = partialHarness({ grpcWeb: zeroFrame({ percent: 12.5 }) });
	assert.equal((await explicit.service.refresh({ providerIds: [X], force: true })).entries[0].windows[0].percent, 12.5, "补查也接受真正上线路的百分比");
	explicit.service.dispose();
	for (const grpc of [
		{ http: 401 }, { http: 500 }, new Error("network failed"),
		{ grpcWeb: zeroFrame({ trailerStatus: 16 }) }, { grpcWeb: zeroFrame().subarray(0, -1) },
		{ grpcWeb: zeroFrame({ currentPeriod: { ...ZERO_PERIOD, start: "2026-10-14T03:32:51.963Z", end: ZERO_PERIOD.start } }) },
		{ grpcWeb: zeroFrame({ currentPeriod: { ...ZERO_PERIOD, end: "2026-10-29T03:32:51.963Z" } }) },
		{ grpcWeb: zeroFrame({ percent: 40, currentPeriod: { ...ZERO_PERIOD, type: 1 } }) },
		{ grpcWeb: zeroFrame({ percent: 40, currentPeriod: undefined }) }
	]) {
		const h = partialHarness(grpc);
		const row = (await h.service.refresh({ providerIds: [X], force: true })).entries[0];
		assert.equal(row.state, "ok"); assert.equal(row.coverage, "partial"); assert.deepEqual(row.windows, []);
		assert.equal(row.extras.at(-1).value, "12.50 USD", "核验失败/过期/周期不一致保留 REST 余额");
		assert.equal(h.calls.length, 3, "不因可选核验失败无限重试"); h.service.dispose();
	}
	const known = partialHarness({ http: 500 }, { percent: 0 });
	assert.equal((await known.service.refresh({ providerIds: [X], force: true })).entries[0].windows[0].percent, 0);
	assert.equal(known.calls.length, 2, "REST 显式零不补查"); known.service.dispose();
	const fallback = partialHarness({ grpcWeb: zeroFrame() }, { http: 500 });
	const recovered = (await fallback.service.refresh({ providerIds: [X], force: true })).entries[0];
	assert.equal(recovered.state, "ok"); assert.equal(recovered.windows[0].percent, 0, "原有 500 回退同样支持隐式零");
	fallback.service.dispose();
	const parent = new AbortController();
	const aborting = partialHarness(() => { parent.abort(); return new Error("cancelled"); });
	const partial = await aborting.service.fetchProvider(X, { key: "oauth-bearer" }, {}, parent.signal);
	assert.equal(partial.coverage, "partial");
	assert.equal(aborting.calls[2].options.signal.aborted, true, "补查信号随父生命周期取消");
	aborting.service.dispose();
}

// ── 过期 token：借 dsh-grok-kit 官方会话链续约，而不是只读不刷或自己裸 POST ──
// 登录文件里的 access token 短命，而 grok-kit 的自动刷新是懒触发（仅聊天/搜索遇过期才刷）；
// 本插件每分钟读用量、最常发现过期，故过期时走 getAuth("xai") 官方链（同一文件 store、写锁内
// 二次检查、compare-and-write），刷新后重读文件拿新 token。以下均不访问真实网络/真实 grok-kit。
const EXPIRED = "2025-12-31T00:00:00.000Z";
const RENEWED = "2026-06-01T00:00:00.000Z";
// 模拟 dsh-grok-kit 导出：XaiOAuthSession 实例只有 models.getAuth 与 dispose 被本插件使用。
const sessions = [];
const fakeKit = (getAuth) => ({
	XaiOAuthSession: class {
		constructor() { sessions.push(this); this.getAuthCalls = 0; this.disposed = false;
			this.models = { getAuth: async (provider, opts) => { this.getAuthCalls++; return getAuth(this, provider, opts); } }; }
		dispose() { this.disposed = true; }
	}
});
{
	// 场景 1：续约成功——计费请求带新 token，旧 token 一枪不发，会话被 dispose。
	const h = harness({
		grokText: grokDoc({ expires_at: EXPIRED }),
		grokKit: fakeKit(() => {
			h.files.set(GROK_AUTH, grokDoc({ key: "new-bearer", expires_at: RENEWED }));
			return { source: "OAuth", auth: { apiKey: "new-bearer" } };
		})
	});
	const entry = (await h.service.refresh({ providerIds: [X], force: true })).entries[0];
	assert.equal(entry.state, "ok", "续约后照常拉用量");
	assert.equal(entry.keySource, "auth-file");
	assert.equal(sessions.at(-1).getAuthCalls, 1, "经 grok-kit 官方链刷新一次");
	assert.equal(sessions.at(-1).disposed, true, "会话用完即 dispose");
	assert.deepEqual(h.kitCalls, ["load"]);
	assert.equal(h.calls.length, 2, "billing 与 settings 各一枪");
	for (const call of h.calls) assert.equal(call.options.headers.authorization, "Bearer new-bearer", "请求带的是续约后的新 token");
	assert.ok(!h.calls.some(c => String(c.options.headers.authorization).includes("oauth-bearer")), "旧 token 绝不发出");
	h.service.dispose();
}
{
	// 场景 2：刷新链抛错（refresh_token 失效等）——明确报告「自动刷新失败」与上游原因，引导重新登录，不发计费请求。
	const h2 = harness({
		grokText: grokDoc({ expires_at: EXPIRED }),
		grokKit: fakeKit(() => { throw new Error("xAI OAuth token refresh failed (HTTP 400): invalid_grant"); })
	});
	const stale = (await h2.service.refresh({ providerIds: [X], force: true })).entries[0];
	assert.equal(stale.state, "error");
	assert.equal(stale.errorCode, "subusage/auth");
	assert.ok(stale.error.includes("自动刷新失败"), "要说是自动刷新失败");
	assert.ok(stale.error.includes("invalid_grant"), "带上上游原因，便于排错");
	assert.ok(stale.error.includes("重新登录"), "给出可执行的下一步");
	assert.equal(h2.calls.length, 0, "刷新失败就不发计费请求");
	assert.equal(sessions.at(-1).disposed, true, "失败路径也 dispose 会话");
	h2.service.dispose();
}
{
	// 场景 3：兄弟插件不可用（未安装 / resolveGrokKit 抛错 / 旧版本无 XaiOAuthSession 导出）——
	// 退回旧的手动提示，不崩溃、不发请求。
	for (const grokKit of [null, {}, { XaiOAuthSession: null }]) {
		const h3 = harness({ grokText: grokDoc({ expires_at: EXPIRED }), grokKit });
		const e = (await h3.service.refresh({ providerIds: [X], force: true })).entries[0];
		assert.equal(e.state, "error");
		assert.equal(e.errorCode, "subusage/auth");
		assert.ok(e.error.includes("未能加载 dsh-grok-kit"), `不可用分支提示（kit=${JSON.stringify(Object.keys(grokKit ?? {}))}）`);
		assert.ok(!e.error.includes("自动刷新失败"), "未尝试刷新时不能说是刷新失败");
		assert.equal(h3.calls.length, 0);
		h3.service.dispose();
	}
	const throwing = harness({ grokText: grokDoc({ expires_at: EXPIRED }), grokKit: undefined });
	throwing.service.resolveGrokKit = async () => { throw new Error("boom"); };
	const e2 = (await throwing.service.refresh({ providerIds: [X], force: true })).entries[0];
	assert.equal(e2.state, "error");
	assert.ok(e2.error.includes("未能加载 dsh-grok-kit"), "加载器抛错也按不可用降级");
	throwing.service.dispose();
}
{
	// 场景 3b：真实 loadGrokKit 的降级路径（不注入 loader）。测试副本在 tmpdir，动态
	// import("dsh-grok-kit") 沿副本路径解析必然失败，loadGrokKit 的 catch 必须把它变成
	// undefined → 走「未能加载」降级，而不是把模块解析错误抛给用户。
	const real = harness({ grokText: grokDoc({ expires_at: EXPIRED }), useDefaultLoader: true });
	const e3 = (await real.service.refresh({ providerIds: [X], force: true })).entries[0];
	assert.equal(e3.state, "error");
	assert.equal(e3.errorCode, "subusage/auth");
	assert.ok(e3.error.includes("未能加载 dsh-grok-kit"), "真实 loadGrokKit 解析失败时静默降级");
	assert.ok(!e3.error.includes("自动刷新失败"), "解析失败不算刷新失败");
	assert.equal(real.calls.length, 0, "降级路径不发计费请求");
	real.service.dispose();
}
{
	// 场景 4：getAuth 自己失败（如拿不到写锁），但文件已被并发的另一进程刷新——以文件观察为准，续约成功。
	// 刷新协议本来就是锁内二次检查 + compare-and-write：谁刷成都落同一文件，本插件不依赖 getAuth 的返回值。
	const h4 = harness({
		grokText: grokDoc({ expires_at: EXPIRED }),
		grokKit: fakeKit(() => {
			h4.files.set(GROK_AUTH, grokDoc({ key: "raced-bearer", expires_at: RENEWED }));
			throw new Error("xai-oauth: credential store lock wait timed out");
		})
	});
	const entry = (await h4.service.refresh({ providerIds: [X], force: true })).entries[0];
	assert.equal(entry.state, "ok", "并发进程已刷新文件时照样成功");
	assert.equal(h4.calls.length, 2, "billing 与 settings 各一枪，every 断言不能建立在空数组上");
	assert.ok(h4.calls.every(c => c.options.headers.authorization === "Bearer raced-bearer"));
	h4.service.dispose();
}
{
	// 场景 5：未过期不加载 grok-kit——零额外耦合开销。
	const fresh = harness({ grokText: grokDoc({ expires_at: RENEWED }) });
	assert.equal((await fresh.service.refresh({ providerIds: [X], force: true })).entries[0].state, "ok");
	assert.equal(fresh.kitCalls.length, 0, "token 未过期不碰刷新链");
	assert.equal(fresh.calls.length, 2);
	fresh.service.dispose();
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
assert.ok(temporary.calls.some(c => String(c.url).includes("GetGrokCreditsConfig")), "HTTP 500 后尝试 gRPC-web 回退");
assert.ok(!denied.calls.some(c => String(c.url).includes("GetGrokCreditsConfig")), "401 不走 gRPC 回退");
const clientError = harness({ grokText: grokDoc(), respond: () => ({ http: 400 }) });
assert.equal((await clientError.service.refresh({ providerIds: [X], force: true })).entries[0].errorCode, "subusage/http");
assert.ok(!clientError.calls.some(c => String(c.url).includes("GetGrokCreditsConfig")), "HTTP 400 不回退");
clientError.service.dispose();
{
	const grpcBody = encodeCreditsGrpcWeb({ percent: 40, start: "2026-10-14T03:32:51Z", end: "2026-10-21T03:32:51Z" });
	const grpc = harness({
		grokText: grokDoc(),
		respond: (url) => {
			if (String(url).includes("GetGrokCreditsConfig")) return { grpcWeb: grpcBody };
			if (String(url).includes("billing")) return { http: 500 };
			return settings("SuperGrok");
		}
	});
	const grpcEntry = (await grpc.service.refresh({ providerIds: [X], force: true })).entries[0];
	assert.equal(grpcEntry.state, "ok", "credits 500 时 gRPC-web 恢复周池");
	assert.equal(grpcEntry.windows[0].percent, 40);
	assert.equal(grpcEntry.windows[0].kind, "week");
	assert.equal(grpcEntry.windows[0].resetsAt, "2026-10-21T03:32:51.000Z");
	assert.deepEqual(grpcEntry.extras, [{ kind: "plan", value: "SuperGrok" }]);
	const grpcCall = grpc.calls.find(c => String(c.url) === "https://grok.com/grok_api_v2.GrokBuildBilling/GetGrokCreditsConfig");
	assert.equal(grpcCall.options.method, "POST");
	assert.equal(grpcCall.options.headers.authorization, "Bearer oauth-bearer");
	assert.equal(grpcCall.options.headers["x-xai-token-auth"], "xai-grok-cli");
	assert.equal(grpcCall.options.headers["x-grpc-web"], "1");
	grpc.service.dispose();
}
{
	const unusable = harness({
		grokText: grokDoc(),
		respond: (url) => {
			if (String(url).includes("GetGrokCreditsConfig")) return { grpcWeb: encodeCreditsGrpcWeb({ start: "2026-10-14T03:32:51Z" }) };
			if (String(url).includes("billing")) return { http: 500 };
			return settings();
		}
	});
	const unusableEntry = (await unusable.service.refresh({ providerIds: [X], force: true })).entries[0];
	assert.equal(unusableEntry.errorCode, "subusage/http", "gRPC 可解析但归一化失败时仍报原 REST 错误");
	assert.match(unusableEntry.error, /HTTP 500/);
	unusable.service.dispose();
}
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
