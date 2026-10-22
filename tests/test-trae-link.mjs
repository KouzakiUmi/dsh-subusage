// 兄弟插件联动：dsh-connect-trae（只读用量路由）的额度并入 quota() 视图与 `subusage_quota` 工具报告。
// 该插件不是本仓库的，它**只**把结果挂在本机 web 服务器的
// `/plugins/dsh-connect-trae/usage?region=<cn|enterprise|ai>` 上（它自己的卡片读同一条路由），
// 因此这里钉三件事：
//  1. 文档（TraeWebUsage）→ 本插件条目的换算：积分制 / 订阅制 / 企业版三种语义不能混；
//  2. 生产取数路径：从 webServer 服务拿回环 origin，带上自己的 Origin 头请求那条路由，
//     404 = 插件没装（不算失败），其它非 2xx 才算失败；
//  3. 联动项的既有口径：60 秒缓存、`force` 绕过、缺席静默、点名缺席给可读说明。
import assert from "node:assert/strict";
import { loadHostModule } from "./helpers.mjs";

const { SubUsageService, apply, normalizeTrae } = await loadHostModule();
const BASE = "http://127.0.0.1:4321";
const ROUTE = "/plugins/dsh-connect-trae/usage";

// ── [1] 国内版（积分制）：上限来自积分包合计，所以能给百分比 ────────────────
const CN = {
	status: "signed-in", accountId: "a1", accountName: "me@example.com", tokenExpiresAtMs: 1, region: "cn", enabled: true,
	accounts: [{ id: "a1", accountName: "me@example.com", edition: "cn", enterprise: false, region: "cn", source: "desktop", tokenExpiresAtMs: 1, selected: true }],
	models: [], enabledModelIds: [],
	credits: {
		total: 2050, consumed: 1522.85, available: 527.15, workAvailable: 75, generalAvailable: 452.15,
		accounts: [
			{ displayDesc: "基础额度", remain: 452.15, size: 2000, expiresAtMs: 1793000000000, endpoint: 0 },
			{ displayDesc: "Work 额度", remain: 75, size: 50, expiresAtMs: 1789000000000, endpoint: 1 }
		],
		expiry: {
			within24h: { total: 0, packs: 0 },
			within3d: { total: 0, packs: 0 },
			within7d: { total: 75, packs: 1, earliestExpiresAtMs: 1789000000000 },
			expired: { total: 30, packs: 1, earliestExpiresAtMs: 1780000000000 }
		}
	},
	checkin: { claimed: false }
};
{
	const entry = normalizeTrae(CN, "trae");
	assert.equal(entry.providerId, "trae");
	assert.equal(entry.label, "Trae");
	assert.equal(entry.state, "ok");
	assert.equal(entry.coverage, "complete");
	// 已用 1522.85 / 2050 = 74.29% → 剩 25.7%
	assert.equal(entry.windows.length, 1);
	assert.equal(entry.windows[0].kind, "period");
	assert.equal(entry.windows[0].percent, 74.3);
	assert.equal(entry.windows[0].status, "ok");
	assert.equal(entry.windows[0].detail.used, 1522.85);
	assert.equal(entry.windows[0].detail.limit, 2050);
	assert.equal(entry.windows[0].detail.remaining, 527.15);
	assert.equal(entry.windows[0].detail.unit, "credits");
	// extras：余量、Work/通用两个桶、到期提醒（按对方四档口径逐档列出非零项）。
	const balance = entry.extras.find(x => x.kind === "balance");
	assert.equal(balance.value, "527.15 credits");
	const notes = entry.extras.filter(x => x.kind === "note").map(x => x.value);
	assert.ok(notes.some(x => x.includes("Work 积分 75") && x.includes("通用积分 452.15")), "两个积分桶都要照实报");
	const expiryNote = notes.find(x => x.includes("积分到期提醒"));
	assert.ok(expiryNote.includes("已过期：30 credits") && expiryNote.includes("7 天内：75 credits"), "到期提醒按四档逐项");
	assert.ok(!expiryNote.includes("24 小时内"), "空档不写");
	assert.equal(entry.extras.filter(x => x.kind === "account").length, 0, "只有一个账号时不重复账号名");
}

// ── [2] 多账号时标出这份数字属于谁；没有百分比字段时不编造窗口 ────────────────
{
	const noTotal = normalizeTrae({ ...CN, credits: { total: 0, consumed: 0, available: 12, workAvailable: 0, generalAvailable: 12, accounts: [] } }, "trae");
	assert.deepEqual(noTotal.windows, [], "没有上限（total=0）就不给百分比");
	assert.equal(noTotal.extras.find(x => x.kind === "balance").value, "12 credits");
	assert.equal(noTotal.coverage, "complete", "积分读到了就是完整数据，只是没有上限");
	// 缺席的桶不补 0：只报它真给了的那个。
	const onlyGeneral = normalizeTrae({ ...CN, credits: { total: 100, consumed: 0, available: 100, generalAvailable: 100, accounts: [] } }, "trae");
	const bucketNote = onlyGeneral.extras.find(x => x.kind === "note" && /积分/.test(x.value));
	assert.equal(bucketNote.value, "通用积分 100", "没有 workAvailable 时不得写出「Work 积分 0」");

	const multi = normalizeTrae({ ...CN, accounts: [...CN.accounts, { id: "a2", accountName: "other@example.com", edition: "cn", enterprise: false, region: "cn", source: "cli", tokenExpiresAtMs: 1, selected: false }] }, "trae");
	const account = multi.extras.find(x => x.kind === "account");
	assert.equal(account.value, "m***@example.com（本机共 2 个账号）", "账号名进工具输出前要掩码（实测是邮箱形态）");

	const noCredits = normalizeTrae({ ...CN, credits: undefined, creditsError: "HTTP 500" }, "trae");
	assert.equal(noCredits.coverage, "partial");
	assert.deepEqual(noCredits.windows, []);
	assert.ok(noCredits.extras.some(x => x.kind === "note" && x.value.includes("HTTP 500")), "读不到就说明原因，不补 0");
}

// ── [3] 国际版：订阅制，没有积分字段，只报档位与试用 ────────────────────────
{
	const entry = normalizeTrae({ status: "signed-in", accountId: "b1", accountName: "intl", tokenExpiresAtMs: 1, region: "ai", accounts: [], models: [], enabledModelIds: [],
		payStatus: { isDollarUsageBilling: true, hasPackage: false, isPayFreshman: true, inTrial: true, trialEndTimeMs: 1793000000000, enableSoloLite: false, enableSoloBuilder: false, enableSoloCoder: false, enableSoloWeb: false, payIdentityStr: "Free" } }, "trae-global");
	assert.equal(entry.label, "Trae Global");
	assert.deepEqual(entry.windows, [], "订阅制没有积分窗口");
	assert.equal(entry.extras.find(x => x.kind === "plan").value, "Free");
	const notes = entry.extras.filter(x => x.kind === "note").map(x => x.value);
	assert.ok(notes.some(x => x.startsWith("试用至 20")), "试用期写到具体时刻");
	assert.ok(notes.some(x => x.includes("未订阅付费套餐")));

	const failed = normalizeTrae({ status: "signed-in", accountId: "b1", accountName: "intl", tokenExpiresAtMs: 1, region: "ai", accounts: [], models: [], enabledModelIds: [], payStatusError: "timeout" }, "trae-global");
	assert.equal(failed.coverage, "partial");
	assert.ok(failed.extras.some(x => x.value.includes("timeout")));
}

// ── [4] 企业版：只在真有企业账号时才算一块面板；额度读不到要照实说 ─────────────
{
	const noEnterprise = normalizeTrae({ ...CN, accounts: [{ ...CN.accounts[0], enterprise: false }] }, "trae-enterprise");
	assert.equal(noEnterprise, null, "没有企业账号：这块面板不出现（不是「未配置凭据」）");
	const enterprise = normalizeTrae({ ...CN, accounts: [{ ...CN.accounts[0], enterprise: true }], creditsUnavailable: "enterprise" }, "trae-enterprise");
	assert.equal(enterprise.label, "Trae 企业版");
	assert.deepEqual(enterprise.windows, []);
	assert.equal(enterprise.coverage, "partial");
	assert.ok(enterprise.extras.some(x => x.kind === "note" && x.value.includes("企业控制台")), "企业额度只能在控制台看，不要把个人积分挪过来");
}

// ── [5] 未登录 / 失败 / 形状不认识 ──────────────────────────────────────────
{
	assert.equal(normalizeTrae({ status: "signed-out", accounts: [] }, "trae"), null, "该区域没登录：不报条目");
	const failed = normalizeTrae({ status: "error", message: "token 已过期" }, "trae");
	assert.equal(failed.state, "error");
	assert.equal(failed.error, "token 已过期");
	assert.throws(() => normalizeTrae({ status: "weird" }, "trae"), /status/);
	assert.throws(() => normalizeTrae(null, "trae"), /不是对象/);
}

// ── [6] 生产取数路径：回环 origin + region 参数 + Origin 头 + 404 语义 ────────
function jsonResponse(body, status = 200) {
	return { ok: status >= 200 && status < 300, status, text: async () => JSON.stringify(body) };
}
function harness({ webServer, replies = {}, now } = {}) {
	const files = new Map();
	const io = {
		readFileSync(path) { if (!files.has(path)) throw Object.assign(new Error("missing"), { code: "ENOENT" }); return files.get(path); },
		mkdirSync() {}, writeFileSync(path, value) { files.set(path, value); }, chmodSync() {}, renameSync() {}
	};
	const calls = [];
	const ctx = { get: name => name === "webServer" ? webServer : undefined };
	const service = new SubUsageService(ctx, {
		io, configPath: "memory/config",
		resolveCredentials: async () => undefined,
		resolveEnvironment: () => undefined,
		linkedTimeoutMs: 50,
		...(now ? { now } : {}),
		fetch: async (url, init) => {
			calls.push({ url: String(url), headers: init?.headers, signal: init?.signal });
			const region = new URL(String(url)).searchParams.get("region");
			const reply = replies[region];
			if (reply === undefined) return jsonResponse({ error: "not found" }, 404);
			if (typeof reply === "function") return reply();
			return jsonResponse(reply);
		}
	});
	return { service, calls };
}
{
	const { service, calls } = harness({ webServer: { getOrigin: () => BASE }, replies: { cn: CN } });
	const view = await service.quota({ providerIds: ["trae"] });
	assert.deepEqual(view.providers.map(p => p.providerId), ["trae"], "厂商名命中三块面板，但只有国内版登录了");
	assert.equal(calls.length, 3, "三块面板各问一次");
	const cnCall = calls.find(c => c.url.includes("region=cn"));
	assert.equal(cnCall.url, `${BASE}${ROUTE}?region=cn`, "打的是对方插件的只读路由");
	assert.equal(cnCall.headers.origin, BASE, "带上自己的回环 Origin（对方只校验 loopback）");
	assert.equal(cnCall.headers.accept, "application/json");
	assert.ok(cnCall.signal instanceof AbortSignal || typeof cnCall.signal?.aborted === "boolean", "请求必须可取消（随 dispose 与联动预算自断）");
	assert.ok(calls.some(c => c.url.endsWith("region=enterprise")));
	assert.ok(calls.some(c => c.url.endsWith("region=ai")));
	// 60 秒缓存：连问两次不该把对方的额度接口打成靶子。
	await service.quota({ providerIds: ["trae"] });
	assert.equal(calls.length, 3, "缓存期内不再请求");
	service.dispose();
}
{
	let clock = 1_000_000;
	const { service, calls } = harness({ webServer: { getOrigin: () => BASE }, replies: { cn: CN }, now: () => clock });
	await service.quota({ providerIds: ["trae"] });
	const first = calls.length;
	clock += 61_000;
	await service.quota({ providerIds: ["trae"] });
	assert.equal(calls.length, first + 3, "过了 60 秒重新取数");
	await service.quota({ providerIds: ["trae"], force: true });
	assert.equal(calls.length, first + 6, "force 绕过缓存");
	service.dispose();
}
// 插件没装（路由 404）/ 本机没有 webServer：静默缺席；点名时给可执行说明。
{
	const { service } = harness({ webServer: { getOrigin: () => BASE } });
	const all = await service.quota();
	assert.equal(all.providers.length, 29, "没有 Trae 通道就只有本插件登记的 29 家");
	assert.ok(!all.providers.some(p => p.providerId.startsWith("trae")));
	const named = await service.quota({ providerIds: ["trae-global"] });
	const row = named.providers.find(p => p.providerId === "trae-global");
	assert.equal(row.state, "error");
	assert.ok(row.error.includes(ROUTE), "点名缺席要写清找的是哪条路由");
	service.dispose();
}
{
	const { service } = harness({ webServer: undefined });
	const row = (await service.quota({ providerIds: ["trae"] })).providers[0];
	assert.equal(row.state, "error", "没有 webServer 时也要给一条能读的说明");
	assert.ok(row.error.includes("dsh-connect-trae"));
	service.dispose();
}
// 非点名的超时静默：对方冷启动慢不该在默认报告里顶出一条 error；点名时仍要给说明。
{
	const { service } = harness({ webServer: { getOrigin: () => BASE }, replies: { cn: () => new Promise(() => {}) } }, { });
	service.linkedTimeoutMs = 20;
	const all = await service.quota();
	assert.ok(!all.providers.some(p => p.providerId === "trae"), "非点名的超时不出条目（缓存随后会补上）");
	assert.equal(all.providers.length, 29);
	service.dispose();
}

// 5xx / 非 JSON / 对方错误信封：算真实失败；网络异常不许把整份报告带崩。
{
	const { service } = harness({ webServer: { getOrigin: () => BASE }, replies: { cn: () => jsonResponse({ error: "boom" }, 500) } });
	const view = await service.quota({ providerIds: ["trae"] });
	assert.equal(view.providers.find(p => p.providerId === "trae").state, "error");
	service.dispose();
}
{
	const { service } = harness({ webServer: { getOrigin: () => BASE }, replies: { cn: () => ({ ok: true, status: 200, text: async () => "not json" }) } });
	const view = await service.quota({ providerIds: ["trae"] });
	assert.ok(view.providers.find(p => p.providerId === "trae").error.includes("JSON"));
	service.dispose();
}
{
	const { service } = harness({ webServer: { getOrigin: () => BASE }, replies: { cn: () => new Promise(() => {}) } });
	const view = await service.quota({ providerIds: ["trae"] });
	const row = view.providers.find(p => p.providerId === "trae");
	assert.equal(row.state, "error");
	assert.ok(row.error.includes("超过"), "超时给出可读原因");
	service.dispose();
}

// ── [7] 工具报告：Trae 条目出现在 subusage_quota 的输出与文本里 ─────────────
{
	const tools = [];
	const { service } = harness({ webServer: { getOrigin: () => BASE }, replies: { cn: CN } });
	const scope = {
		effect(fn) { const r = fn(); return typeof r === "function" ? r : () => {}; },
		typert: { register: () => () => {} },
		tools: { register: tool => { tools.push(tool); return () => {}; } },
		get: name => name === "subUsage" ? service : undefined,
		inject: (names, cb) => cb(scope),
		logger: { info() {}, warn() {}, error() {} }
	};
	apply({ get: name => name === "subUsage" ? service : undefined, inject: (names, cb) => cb(scope), plugin: () => {}, logger: scope.logger });
	const tool = tools.find(t => t.name === "subusage_quota");
	assert.ok(tool.description.includes("dsh-connect-trae"), "描述里要交代这块联动数据从哪来");
	assert.ok(tool.parameters.providers.description.includes("trae"), "参数说明要能点名 trae");
	const asked = await tool.execute({ providers: ["trae-global"] }, {});
	assert.equal(asked.providers.length, 1, "点名国际版只回它自己");
	const auto = await tool.execute({}, {});
	assert.ok(auto.providers.some(p => p.providerId === "trae"), "不点名时带上已登录的 Trae 面板");
	const text = tool.output.render({}, auto)[0].text;
	assert.ok(text.includes("Trae [ok]"), "文本里要有一行能读的 Trae");
	assert.ok(text.includes("25.7% 剩余"), "文本按剩余口径展示（条目里存的是已用 74.3%）");
	assert.ok(text.includes("balance: 527.15 credits"));
	service.dispose();
}

// 走错通道：read/refresh 收到联动 id 时要说「用 quota()」，不能误报「Host 版本旧」。
{
	const { service } = harness({ webServer: { getOrigin: () => BASE }, replies: { cn: CN } });
	const view = await service.refresh({ providerIds: ["trae"], force: false });
	const row = view.entries.find(entry => entry.providerId === "trae");
	assert.ok(row && /联动项/.test(row.error) && /quota\(/.test(row.error), "read/refresh 里要指回 quota()");
	service.dispose();
}

console.log("PASS 兄弟插件联动（Trae）：三种面板语义、回环路由取数、缓存/force、缺席与失败降级、工具报告");
