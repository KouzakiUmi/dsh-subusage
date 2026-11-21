// Devin（dsh-devin-provider 注册的 `devin` 路由）额度：官方 GetUserStatus，Connect JSON 协议。
// 只用虚构 token 与桩网络；不读真实凭据文件、不访问真实接口。
import assert from "node:assert/strict";
import { loadHostModule } from "./helpers.mjs";

const {
	SubUsageService, subUsageRemote, normalizeDevin, devinProviderCredentials,
	readDevinState, devinActiveAccount, parseDevinCliCredentials, devinServerUrl
} = await loadHostModule();
const ID = "devin";
const RPC = "/exa.seat_management_pb.SeatManagementService/GetUserStatus";
const fail = (fn, code) => assert.throws(fn, e => e.code === code, `应抛出 ${code}`);
const norm = path => String(path).replace(/\\/g, "/");
/** 只含被测文件的内存盘；缺文件抛 ENOENT。 */
const disk = files => ({
	readFileSync: (path) => {
		const key = norm(path);
		if (files.has(key)) return files.get(key);
		throw Object.assign(new Error(`ENOENT ${key}`), { code: "ENOENT" });
	}
});

// ── [1] 账号元数据与三种凭据模式 ─────────────────────────────────────────────
{
	// state.json 形状照抄 devin 插件（非密钥元数据 + 全局设置）；当前账号按 activeAccountId。
	const state = {
		version: 1,
		accounts: [{ id: "devin-1", authMode: "oauth" }, { id: "devin-2", authMode: "cli" }],
		activeAccountId: "devin-2",
		settings: { serverUrl: "" }
	};
	const parsed = readDevinState(disk(new Map([["/v/state.json", JSON.stringify(state)]])), "/v/state.json");
	assert.equal(parsed.accounts.length, 2);
	assert.equal(devinActiveAccount(parsed).id, "devin-2", "路由实际使用的账号以 activeAccountId 为准");
	assert.equal(devinActiveAccount({ accounts: [{ id: "only" }], activeAccountId: "" }).id, "only");
	assert.equal(devinActiveAccount({ accounts: [{ id: "a" }, { id: "b" }], activeAccountId: "gone" }).id, "a", "指向已消失账号时退回首个（devin 插件自己的降级）");
	assert.equal(devinActiveAccount({ accounts: [] }), undefined);
	// 文件缺失 / 损坏 / 没有账号：当作没有 Devin 登录，不是错误。
	assert.equal(readDevinState(disk(new Map()), "/v/state.json"), undefined);
	assert.equal(readDevinState(disk(new Map([["/v/state.json", "{oops"]])), "/v/state.json"), undefined);
	assert.equal(readDevinState(disk(new Map([["/v/state.json", JSON.stringify({ accounts: [] })]])), "/v/state.json"), undefined);

	// oauth / api-key：读凭据库 grant 记录 `dsh-devin-provider/<accountId>` 的 payload.key。
	const seenKeys = [];
	const grant = {
		readRecord: async key => { seenKeys.push(key); return { kind: "grant", payload: { key: "  devin-session-token$fixture  ", server: "https://server.codeium.com", updatedAt: "2026-11-14T14:47:13.988Z" } }; },
		resolve: () => { throw new Error("must not resolve refs"); },
		deleteRecord: () => { throw new Error("must not delete"); },
		modifyRecord: () => { throw new Error("must not write"); }
	};
	const io = disk(new Map([["/v/state.json", JSON.stringify({ ...state, activeAccountId: "devin-1" })]]));
	const cred = await devinProviderCredentials({ io, credentials: grant, statePath: "/v/state.json", env: {} });
	assert.deepEqual(seenKeys, ["dsh-devin-provider/devin-1"], "按 devin 插件的 credentialKey 读取");
	assert.equal(cred.key, "devin-session-token$fixture", "token 两端空白被 trim");
	assert.equal(cred.server, "https://server.codeium.com");
	assert.equal(cred.accountId, "devin-1");
	assert.equal(cred.source, "devin-grant");
	// 记录存在但没有 key（未保存凭据）/ 记录不存在 / 坏记录：按未登录或格式异常，都不返回 token。
	assert.equal(await devinProviderCredentials({ io, credentials: { readRecord: async () => ({ kind: "grant", payload: {} }) }, statePath: "/v/state.json", env: {} }), undefined);
	assert.equal(await devinProviderCredentials({ io, credentials: { readRecord: async () => undefined }, statePath: "/v/state.json", env: {} }), undefined);
	await assert.rejects(devinProviderCredentials({ io, credentials: { readRecord: async () => ({ kind: "oauth" }) }, statePath: "/v/state.json", env: {} }), e => e.code === "subusage/credential" && !e.message.includes("fixture"));
	// 没有凭据服务时回落 devin 插件写在受保护目录的 0o600 文件（与 writeGrant 同一路径形状）。
	const fallback = disk(new Map([
		["/v/state.json", JSON.stringify({ ...state, activeAccountId: "devin-1" })],
		["/v/credentials/devin-1.json", JSON.stringify({ key: "fallback-key", server: "https://server.codeium.com" })]
	]));
	assert.equal((await devinProviderCredentials({ io: fallback, credentials: undefined, statePath: "/v/state.json", env: {} })).key, "fallback-key");

	// cli 模式：读 devin CLI 的 credentials.toml（windsurf_api_key / api_server_url），不改写它。
	const toml = 'windsurf_api_key = "cli-key"\napi_server_url = "https://server.codeium.com"\ndevin_webapp_host = "app.devin.ai"\n';
	assert.deepEqual(parseDevinCliCredentials(toml), { key: "cli-key", server: "https://server.codeium.com" });
	assert.equal(parseDevinCliCredentials("devin_webapp_host = \"app.devin.ai\"\n"), undefined, "没有 windsurf_api_key 就是没登录");
	assert.equal(parseDevinCliCredentials(""), undefined);
	const cliDisk = disk(new Map([
		["/v/state.json", JSON.stringify({ ...state, activeAccountId: "devin-2" })],
		["/appdata/devin/credentials.toml", toml]
	]));
	const cli = await devinProviderCredentials({ io: cliDisk, credentials: { readRecord: async () => undefined }, statePath: "/v/state.json", env: { APPDATA: "/appdata" } });
	assert.equal(cli.key, "cli-key");
	assert.equal(cli.source, "devin-cli");
	// CLI 文件临时不在时回落到保存的 grant（与 devin 插件 resolveCredential 同序）。
	const cliFallback = disk(new Map([
		["/v/state.json", JSON.stringify({ ...state, activeAccountId: "devin-2" })],
		["/appdata/devin/credentials.toml", 'windsurf_api_key = ""\n']
	]));
	assert.equal((await devinProviderCredentials({ io: cliFallback, credentials: { readRecord: async () => ({ kind: "grant", payload: { key: "stale-grant" } }) }, statePath: "/v/state.json", env: { APPDATA: "/appdata" } })).key, "stale-grant");

	// reference 模式：走它声明的凭据引用名（凭据服务优先，超集不存在时才看启动环境）。
	const refState = JSON.stringify({ accounts: [{ id: "devin-3", authMode: "reference", apiKeyRef: "DEVIN_API_KEY" }], activeAccountId: "devin-3" });
	const refIo = disk(new Map([["/v/state.json", refState]]));
	const refCred = await devinProviderCredentials({ io: refIo, credentials: { readRecord: async () => undefined, resolve: async ref => ({ value: ref.name === "DEVIN_API_KEY" ? "ref-key" : undefined }) }, statePath: "/v/state.json", env: {} });
	assert.equal(refCred.key, "ref-key");
	assert.equal(refCred.source, "devin-reference");
	assert.equal(await devinProviderCredentials({ io: refIo, credentials: undefined, environment: () => undefined, statePath: "/v/state.json", env: {} }), undefined, "引用解析不到就是未登录");
	assert.equal((await devinProviderCredentials({ io: refIo, credentials: undefined, environment: ref => ref === "DEVIN_API_KEY" ? { value: "env-key" } : undefined, statePath: "/v/state.json", env: {} })).key, "env-key", "无凭据服务时看启动环境");

	// 站点地址：https 透传，回环 http 允许（自建反代），公网明文/带账号/怪协议一律拒绝。
	assert.equal(devinServerUrl("https://server.codeium.com/"), "https://server.codeium.com");
	assert.equal(devinServerUrl("https://gw.example.com/devin/"), "https://gw.example.com/devin");
	assert.equal(devinServerUrl("http://127.0.0.1:8080"), "http://127.0.0.1:8080");
	assert.equal(devinServerUrl("http://localhost:3425/"), "http://localhost:3425");
	for (const bad of ["http://server.codeium.com", "https://user:pw@host.example.com", "file:///c:/x", "not a url", "", null]) assert.equal(devinServerUrl(bad), undefined, `${bad} 必须拒绝`);
	// 全站设置里的 serverUrl 是兜底；环境变量压过一切（与 devin 插件 serverFor 同序）。
	const siteState = JSON.stringify({ accounts: [{ id: "devin-1", authMode: "oauth" }], activeAccountId: "devin-1", settings: { serverUrl: "https://site.example.com" } });
	assert.equal((await devinProviderCredentials({ io: disk(new Map([["/v/state.json", siteState]])), credentials: { readRecord: async () => ({ kind: "grant", payload: { key: "k" } }) }, statePath: "/v/state.json", env: {} })).server, "https://site.example.com");
	assert.equal((await devinProviderCredentials({ io: disk(new Map([["/v/state.json", siteState]])), credentials: { readRecord: async () => ({ kind: "grant", payload: { key: "k" } }) }, statePath: "/v/state.json", env: { WINDSURF_API_SERVER_URL: "https://env.example.com" } })).server, "https://env.example.com");
	assert.equal((await devinProviderCredentials({ io: disk(new Map([["/v/state.json", siteState]])), credentials: { readRecord: async () => ({ kind: "grant", payload: { key: "k" } }) }, statePath: "/v/state.json", env: { WINDSURF_API_SERVER_URL: "http://public.example.com" } })).server, "https://site.example.com", "被拒绝的 server 不生效");
	console.log("PASS Devin 凭据：state 读取/当前账号、grant、CLI toml、引用名、回落文件、server 优先级与安全校验");
}

// ── [2] 归一化：真机形态、缺失不猜、隐藏窗口、超额符号 ─────────────────────────
{
	// 2026-11-16 真机 GetUserStatus 的字段形状（数值照抄，账号信息不取）。
	const live = {
		userStatus: {
			email: "user@example.com",
			teamsTier: "TEAMS_TIER_DEVIN_PRO",
			planStatus: {
				planInfo: { planName: "Pro", teamsTier: "TEAMS_TIER_DEVIN_PRO", billingStrategy: "BILLING_STRATEGY_QUOTA" },
				planStart: "2026-11-05T16:12:53Z",
				planEnd: "2026-12-05T16:12:53Z",
				availablePromptCredits: -1,
				dailyQuotaRemainingPercent: 81,
				// 上游是 Connect JSON 序列化的 protobuf：int64 实测是字符串，不是 number。
				overageBalanceMicros: "-77928",
				// 百分比也可能是字符串形态，两种都要认（只认 number 会静默少画窗口）。
				weeklyQuotaRemainingPercent: "90",
				dailyQuotaResetAtUnix: 1794816000,
				weeklyQuotaResetAtUnix: 1795334400
			}
		}
	};
	const now = Date.parse("2026-11-16T09:46:28+08:00");
	const out = normalizeDevin(live, now);
	assert.deepEqual(out.windows.map(w => [w.kind, w.percent]), [["day", 19], ["week", 10]], "接口给的是剩余百分比，对外输出已用");
	assert.equal(out.windows[0].resetsAt, new Date(1794816000 * 1000).toISOString(), "Unix 秒 → ISO");
	assert.equal(out.windows[1].resetsAt, new Date(1795334400 * 1000).toISOString());
	assert.equal(out.windows[0].status, "ok");
	assert.equal(out.coverage, "complete");
	assert.deepEqual(out.extras, [
		{ kind: "plan", value: "Pro" },
		{ kind: "note", value: "套餐周期至 2026-12-05（还有 20 天）" },
		{ kind: "note", value: "超额余额 −$0.08" }
	], "套餐名取 planName、planEnd 说成周期、负超额如实写成透支（不冒充可用余额）");
	// 正超额是可用的充值余额；0 不占行。
	const positive = normalizeDevin({ userStatus: { planStatus: { overageBalanceMicros: 2500000 } } }, now);
	assert.deepEqual(positive.extras, [{ kind: "balance", value: "$2.50" }]);
	assert.deepEqual(normalizeDevin({ userStatus: { planStatus: { overageBalanceMicros: 0 } } }, now).extras, []);
	// 端口有值但不是数字（如空串 / 非数字文本）不当作 0，也不猜。
	assert.deepEqual(normalizeDevin({ userStatus: { planStatus: { overageBalanceMicros: "" } } }, now).extras, []);
	// 百分比缺席是否「零值省略」看 billingStrategy：quota 套餐里重置时间在而百分比没下发，
	// 是 proto3 JSON 把 0 省掉（2026-11-21 实测 weeklyQuotaRemainingPercent 在剩余 0% 时整字段缺席），
	// 与 devin 插件同口径画成满格已用，并把日窗连坐——这正是真机上「周用尽、日 100%」的本来面貌。
	const exhaustedWeek = normalizeDevin({ userStatus: { planStatus: {
		planInfo: { billingStrategy: "BILLING_STRATEGY_QUOTA", planName: "Pro" },
		dailyQuotaRemainingPercent: 100,
		dailyQuotaResetAtUnix: 1795248000,
		weeklyQuotaResetAtUnix: 1795334400
	} } }, now);
	assert.deepEqual(exhaustedWeek.windows.map(w => [w.kind, w.percent, w.status, w.cascade === true]), [
		["day", 0, "rate-limited", true],
		["week", 100, "rate-limited", false]
	], "周百分比缺席 + quota 套餐 + 有重置时间 = 周窗用尽，日窗连坐但保留自己的 100% 剩余");
	assert.equal(exhaustedWeek.coverage, "complete");
	assert.ok(exhaustedWeek.windows[0].detail.blockedBy.includes("week"));
	// 日窗同规则：百分比缺席 + 有重置时间 = 已用尽。
	const exhaustedDay = normalizeDevin({ userStatus: { planStatus: {
		planInfo: { billingStrategy: "BILLING_STRATEGY_QUOTA" },
		dailyQuotaResetAtUnix: 1795248000,
		weeklyQuotaRemainingPercent: 50, weeklyQuotaResetAtUnix: 1795334400
	} } }, now);
	assert.deepEqual(exhaustedDay.windows.map(w => [w.kind, w.percent, w.status]), [["day", 100, "rate-limited"], ["week", 50, "ok"]]);
	// 没有 billingStrategy 判据时（旧响应 / 形状变化）仍不猜：不画窗口，覆盖率降为 partial。
	const missing = normalizeDevin({ userStatus: { planStatus: { dailyQuotaResetAtUnix: 1794816000, weeklyQuotaResetAtUnix: 1795334400 } } }, now);
	assert.deepEqual(missing.windows, []);
	assert.equal(missing.coverage, "partial");
	// quota 套餐但连重置时间都没有 = 上游没下发这个窗口，不补造。
	assert.deepEqual(normalizeDevin({ userStatus: { planStatus: { planInfo: { billingStrategy: "BILLING_STRATEGY_QUOTA" } } } }, now).windows, []);
	// 隐藏优先于零值省略：quota 套餐里 hideWeeklyQuota 的窗即使缺席也不画。
	const hiddenGone = normalizeDevin({ userStatus: { planStatus: {
		planInfo: { billingStrategy: "BILLING_STRATEGY_QUOTA", hideWeeklyQuota: true },
		dailyQuotaRemainingPercent: 80, dailyQuotaResetAtUnix: 1795248000, weeklyQuotaResetAtUnix: 1795334400
	} } }, now);
	assert.deepEqual(hiddenGone.windows.map(w => w.kind), ["day"]);
	// 套餐里被隐藏的窗口（hideDailyQuota / hideWeeklyQuota）不适用，不补造。
	const hidden = normalizeDevin({ userStatus: { planStatus: { planInfo: { hideDailyQuota: true }, dailyQuotaRemainingPercent: 100, weeklyQuotaRemainingPercent: 40 } } }, now);
	assert.deepEqual(hidden.windows.map(w => w.kind), ["week"]);
	// 用尽：100% 已用 + 限流态；周池用尽会级联把日窗口也标成限流（周池是更高一层的总预算）。
	const spent = normalizeDevin({ userStatus: { planStatus: { dailyQuotaRemainingPercent: 40, weeklyQuotaRemainingPercent: 0 } } }, now);
	assert.deepEqual(spent.windows.map(w => [w.kind, w.status, w.cascade === true]), [["day", "rate-limited", true], ["week", "rate-limited", false]]);
	// 越界百分比夹在 0..100，不让界面出现负数或 120%。
	assert.deepEqual(normalizeDevin({ userStatus: { planStatus: { dailyQuotaRemainingPercent: 130 } } }, now).windows.map(w => w.percent), [0]);
	// 只有 teamsTier 时把枚举翻成可读套餐名；planEnd 已过期如实说结束。
	const tierOnly = normalizeDevin({ userStatus: { teamsTier: "TEAMS_TIER_DEVIN_TEAM_V2", planStatus: { planEnd: "2026-11-01T00:00:00Z" } } }, now);
	assert.deepEqual(tierOnly.extras, [
		{ kind: "plan", value: "Devin Team" },
		{ kind: "note", value: "套餐周期已于 2026-11-01 结束" }
	]);
	// ACU 计费套餐才有的字段不下发时不要补造。
	assert.ok(!normalizeDevin(live, now).windows.some(w => w.kind === "acu"));
	// 非对象响应 / 没有 planStatus：格式错误，不是「0 额度」。
	for (const body of [null, "x", [], {}, { userStatus: {} }, { userStatus: { planStatus: [] } }]) fail(() => normalizeDevin(body, now), "subusage/response");
	console.log("PASS Devin 归一化：剩余→已用、Unix 秒重置、缺失不猜、隐藏窗口、超额正负、级联、坏响应");
}

// ── [3] Host 端到端：请求形状、缓存隔离、401 映射、结果不含 token ───────────────
{
	const KEY = "devin-session-token$fixture";
	const requests = [];
	const state = JSON.stringify({ version: 1, accounts: [{ id: "devin-1", authMode: "oauth", label: "KouzakiUmi", identity: { email: "user@example.com" } }], activeAccountId: "devin-1", settings: { serverUrl: "" } });
	const files = new Map([
		["memory/subscription", JSON.stringify({ visibility: { providers: { [ID]: true } } })],
		["/v/state.json", state]
	]);
	let status = 200;
	let payload = { userStatus: { planStatus: { planInfo: { planName: "Pro" }, dailyQuotaRemainingPercent: 81, weeklyQuotaRemainingPercent: 90, dailyQuotaResetAtUnix: 1794816000, weeklyQuotaResetAtUnix: 1795334400 } } };
	const credentials = { readRecord: async key => key === "dsh-devin-provider/devin-1" ? { kind: "grant", payload: { key: KEY, server: "https://server.codeium.com" } } : undefined };
	const service = new SubUsageService({ effect() {}, get: name => name === "credentials" ? credentials : undefined, llm: { listProviders: () => [{ id: ID }] } }, {
		io: disk(files), configPath: "memory/subscription", devinStatePath: "/v/state.json",
		fetch: async (url, options) => { requests.push({ url, headers: options.headers, method: options.method, body: options.body }); return { ok: status === 200, status, headers: { get: () => null }, text: async () => JSON.stringify(payload) }; }
	});
	const first = await service.refresh({ providerIds: [ID], force: false });
	const entry = first.entries[0];
	assert.equal(entry.state, "ok");
	assert.equal(entry.providerId, ID);
	assert.equal(entry.keySource, "devin-grant");
	assert.equal(entry.apiDetected, true);
	assert.deepEqual(entry.windows.map(w => [w.kind, w.percent]), [["day", 19], ["week", 10]]);
	assert.equal(entry.coverage, "complete");
	assert.equal(requests.length, 1);
	assert.equal(requests[0].url, `https://server.codeium.com${RPC}`);
	assert.equal(requests[0].method, "POST");
	assert.equal(requests[0].headers["content-type"], "application/json");
	assert.equal(requests[0].headers["connect-protocol-version"], "1");
	assert.equal(requests[0].headers.authorization, undefined, "凭据放在请求体元数据里，不走 Authorization 头");
	const sent = JSON.parse(requests[0].body);
	assert.equal(sent.metadata.apiKey, KEY);
	assert.equal(sent.metadata.ideName, "devin-cli");
	assert.equal(sent.metadata.extensionName, "devin-cli");
	assert.ok(sent.metadata.ideVersion, "带客户端版本号");
	assert.equal(sent.metadata.os, process.platform === "win32" ? "windows" : process.platform);
	assert.ok(!JSON.stringify(first).includes(KEY), "结果里没有 token");
	// TTL 内命中缓存。
	await service.refresh({ providerIds: [ID], force: false });
	assert.equal(requests.length, 1);
	// 强制刷新会重新请求（用户点刷新时不该静默复用）。
	await service.refresh({ providerIds: [ID], force: true });
	assert.equal(requests.length, 2);
	// 401：映射成 subusage/auth，并且说清去哪个设置页重登；不沿用旧额度、不回显 token。
	status = 401;
	const rejected = (await service.refresh({ providerIds: [ID], force: true })).entries[0];
	assert.equal(rejected.state, "error");
	assert.equal(rejected.errorCode, "subusage/auth");
	assert.ok(rejected.error.includes("Devin Provider"), "指出去哪儿重新登录");
	assert.ok(!rejected.windows?.length, "401 不沿用旧额度");
	assert.ok(!JSON.stringify(rejected).includes(KEY));
	// 上游 5xx 是可重试的普通失败，不与登录失效混为一谈。
	status = 503;
	const down = (await service.refresh({ providerIds: [ID], force: true })).entries[0];
	assert.equal(down.errorCode, "subusage/http");
	assert.equal(down.retryable, true);
	service.dispose();
	console.log("PASS Devin Host：Connect JSON 请求形状、缓存、401 专属文案、5xx 可重试、结果不含 token");
}

// ── [4] 未登录 / 别名 / 不接受本地 Key ────────────────────────────────────
{
	const make = (credentials, settings) => {
		const files = new Map([
			["memory/subscription", JSON.stringify(settings)],
			["/v/state.json", JSON.stringify({ version: 1, accounts: [{ id: "devin-1", authMode: "oauth" }], activeAccountId: "devin-1", settings: {} })]
		]);
		let calls = 0;
		const service = new SubUsageService({ effect() {}, get: name => name === "credentials" ? credentials : undefined, llm: { listProviders: () => [{ id: ID }] } }, {
			io: disk(files), configPath: "memory/subscription", devinStatePath: "/v/state.json",
			fetch: async () => { calls += 1; throw new Error("must not call network"); }
		});
		return { service, calls: () => calls };
	};
	// 没有登录：no-key + 去哪里登录，不发网络请求。
	const absent = make({ readRecord: async () => undefined }, { visibility: { providers: { [ID]: true } } });
	const entry = (await absent.service.refresh({ providerIds: [ID], force: false })).entries[0];
	assert.equal(entry.state, "no-key");
	assert.equal(entry.apiDetected, false);
	assert.ok(entry.error.includes("Devin Provider"));
	assert.equal(absent.calls(), 0);
	absent.service.dispose();
	// 关掉开关：不发任何网络请求。新装默认开启（用户主动要求接入），关掉后连凭据解析都不必出网。
	const off = make({ readRecord: async () => ({ kind: "grant", payload: { key: "k" } }) }, { visibility: { providers: { [ID]: false } } });
	const disabled = (await off.service.refresh({ providerIds: [ID], force: false })).entries[0];
	assert.equal(disabled.state, "disabled");
	assert.equal(off.calls(), 0);
	off.service.dispose();
	// 不接受本地 Key：凭据库记录归 devin 插件所有，任何凭据补丁都被边界拒绝。
	const save = subUsageRemote.descriptors.find(d => d.method === "save");
	for (const patch of [{ keyUpdate: { action: "keep" } }, { keyMode: "manual" }, { cookieUpdate: { action: "keep" } }]) assert.throws(() => save.parameters[0].codec.schema.parse({ providerId: ID, ...patch }), /managed by the provider plugin/);
	// 名字解析：路由 id、插件名与厂商旧名都点到这一条。
	const named = make({ readRecord: async () => undefined }, { visibility: { providers: { [ID]: true } } });
	for (const name of ["devin", "Devin", "devin-provider", "cognition", "Windsurf"]) assert.deepEqual((await named.service.quota({ providerIds: [name] })).providers.map(p => p.providerId), [ID], `${name} → ${ID}`);
	named.service.dispose();
	console.log("PASS Devin 未登录不发请求、开关关闭、拒绝本地 Key、别名解析");
}
