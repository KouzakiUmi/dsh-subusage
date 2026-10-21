// OpenDesign 的「登录并自动导入」：与 MiMo 共用 CookieLogin 骨架，这里验证站点参数与提交行为。
// 所有 browser / cookie / IO / fetch 都是 dummy；绝不启动真实 Chrome。
import assert from "node:assert/strict";
import { extractOpenDesignCookie, extractOpenDesignSession, OPEN_DESIGN_API_URLS, OPEN_DESIGN_LOGIN_URL, OPEN_DESIGN_ORIGIN } from "../lib/opendesign-login.js";
import { loadHostModule } from "./helpers.mjs";

const { SubUsageService } = await loadHostModule();
const OD = "opendesign";
const delay = ms => new Promise(r => setTimeout(r, ms));
const future = Math.floor((Date.now() + 8 * 3600 * 1000) / 1000);
const SESSION = "amr_session=dummy-session; __cf_bm=dummy-cf";
const cookies = [
	{ name: "amr_session", value: "dummy-session", domain: "amr-api.open-design.ai", path: "/", httpOnly: true, secure: true, expires: -1 },
	{ name: "__cf_bm", value: "dummy-cf", domain: ".open-design.ai", path: "/", httpOnly: true, secure: true, expires: future }
];

// 1. Cookie 提取不按名字挑（登录态是 HttpOnly，前端 bundle 读不到名字）：只排除已过期的与空值。
assert.equal(extractOpenDesignCookie(cookies), SESSION);
assert.equal(extractOpenDesignSession(cookies).expiresAt, future * 1000, "取已声明过期时刻里最早的一个");
assert.equal(extractOpenDesignCookie([]), null);
assert.equal(extractOpenDesignCookie([{ ...cookies[0], expires: 1 }]), null, "已过期的 Cookie 不进会话");
assert.equal(extractOpenDesignSession([{ ...cookies[0], value: "" }]), null, "空值 Cookie 不算数");

const BODY = {
	workspaceId: "ws-test-1", generatedAt: "2026-10-18T08:00:00.000Z", eligible: true, tier: "go",
	windows: [{ policyId: "p", durationSeconds: 18000, resetMode: "activity_triggered", usedCredits: "10", limitCredits: "100", remainingCredits: "90", windowStart: "2026-10-18T07:00:00.000Z", resetsAt: "2026-10-18T12:00:00.000Z" }]
};
// 额度接口必须带真实 workspaceId，所以先读当前工作区拿 id（见 openDesignWorkspace）。
// 账号级余额汇总只在个人工作区读，所以夹具默认不带 workspaceType（= 未知，不读汇总）。
const CURRENT = { workspaceId: "ws-test-1" };
const SUMMARY = {
	balanceUsd: "16.0000", creditsPerUsd: 10000,
	balances: { subscriptionCredits: "150000", rechargeCredits: "10000", totalAvailableCredits: "160000" },
	membershipTier: "plus", subscriptionCurrentPeriodEnd: "2026-11-18T17:09:27.000Z"
};
function harness(options = {}) {
	let content = null, writes = 0, launches = 0, closes = 0, calls = 0;
	const urls = [];
	let supplied = options.cookies ?? cookies;
	const events = {};
	const browser = {
		on(event, cb) { events[event] = cb; }, async close() { closes++; },
		async newContext() {
			return {
				cookies: async urls => { assert.deepEqual(urls, OPEN_DESIGN_API_URLS, "按额度接口 URL 取 Cookie"); return supplied; },
				newPage: async () => ({ on(event, cb) { events[`page:${event}`] = cb; }, goto: async url => { assert.equal(url, OPEN_DESIGN_LOGIN_URL, "第一步落到控制台方案与余额页：首页不触发登录"); assert.notEqual(url, OPEN_DESIGN_ORIGIN, "不能只打开首页"); } })
			};
		}
	};
	const io = { readFileSync() { if (content === null) throw Object.assign(new Error(), { code: "ENOENT" }); return content; }, mkdirSync() {}, writeFileSync(_, value) { writes++; content = value; }, chmodSync() {}, renameSync() {} };
	let http = 200;
	const service = new SubUsageService({ effect() {}, get() {}, llm: { listProviders: () => [] } }, {
		io, configPath: "dummy/config", resolveCredentials: async () => undefined, resolveEnvironment: () => undefined,
		fetch: async (url, init) => {
			calls++; urls.push(url);
			assert.equal(init.headers.cookie, SESSION, "以 Cookie 头而不是 Bearer 调额度接口");
			assert(init.signal);
			if (url.endsWith("/v1/workspaces/current")) return { status: 200, ok: true, headers: { get: () => null }, text: async () => JSON.stringify(options.workspaceType ? { ...CURRENT, workspaceType: options.workspaceType } : CURRENT) };
			if (url.endsWith("/v1/billing/summary")) {
				// 余额汇总的临时故障仅让余额读不到；认证失败则必须报告登录失效。
				if (options.summary === "fail" || options.summary === "auth") return { status: options.summary === "auth" ? 401 : 500, ok: false, headers: { get: () => null }, text: async () => "{}" };
				return { status: 200, ok: true, headers: { get: () => null }, text: async () => JSON.stringify(SUMMARY) };
			}
			assert.ok(url.endsWith("/v1/workspaces/ws-test-1/billing/coding-plan-usage"), "额度接口必须带真实 workspaceId，不能是 current");
			const status = options.usageFail ? 500 : http;
			return { status, ok: status === 200, headers: { get: () => null }, text: async () => JSON.stringify(BODY) };
		},
		openDesignLogin: { pollMs: 1, timeoutMs: 1000, ...options.login, launch: async args => { launches++; assert.equal(args.channel, "chrome"); assert.equal(args.headless, false); assert.deepEqual(args.ignoreDefaultArgs, ["--enable-automation"], "向前兼容：1.63 默认参数里没有它，保留以防将来版本加回"); assert.deepEqual(args.args, ["--disable-blink-features=AutomationControlled"], "真正生效的是这条：navigator.webdriver 必须关掉，否则 Cloudflare 在点验证时判负"); return options.launch ? options.launch(browser) : browser; } }
	});
	return { service, browser, events, revision: () => service.result(service.load(), []).settings.revision, get writes() { return writes; }, get launches() { return launches; }, get closes() { return closes; }, get calls() { return calls; }, get urls() { return urls; }, setHttp: v => http = v, setCookies: v => supplied = v };
}
async function until(h, states) { for (let i = 0; i < 200; i++) { const s = h.service.getOpenDesignLoginStatus(); if (states.includes(s.state)) return s; await delay(2); } throw new Error("stub state did not settle"); }

// 2. 成功路径：验证通过才落盘，Cookie 进通用手动 Key 槽并把模式切成 manual，结果里不回显 Cookie。
const h = harness();
assert.deepEqual(h.service.getOpenDesignLoginStatus(), { jobId: null, state: "idle" });
assert.throws(() => h.service.startOpenDesignLogin({}));
assert.throws(() => h.service.startOpenDesignLogin({ expectedRevision: "stale" }), e => e.code === "subusage/revision-conflict");
const start = h.service.startOpenDesignLogin({ expectedRevision: h.revision() });
assert.equal(start.state, "launching"); assert.equal(h.launches, 0, "启动只排队，RPC 不等浏览器");
const success = await until(h, ["success"]);
assert.equal(h.writes, 1); assert.equal(h.launches, 1); assert.equal(success.result.entries[0].coverage, "complete");
assert.equal(h.service.load().keys[OD], SESSION, "会话 Cookie 保存进手动 Key 槽");
assert.equal(h.service.load().keyModes[OD], "manual", "凭据模式切到 manual，身份解析链立刻可读");
assert(!JSON.stringify(success).includes("dummy-session"), "结果不得回显 Cookie");
assert(h.closes >= 1);
h.service.dispose();

// 3. 登录尚未生效（401）时不保存，继续等待用户在官方窗口完成登录。
const auth = harness();
auth.setHttp(401);
auth.service.startOpenDesignLogin({ expectedRevision: auth.revision() });
await until(auth, ["waiting"]);
await delay(10);
assert.equal(auth.writes, 0, "未通过验证绝不落盘");
auth.service.dispose();

// 3b. 个人工作区双端点：即使另一端成功，任一认证失败都不能提交 Cookie。
for (const endpoint of ["usage", "summary"]) {
	const mixed = harness({ workspaceType: "personal", ...(endpoint === "summary" ? { summary: "auth" } : {}) });
	if (endpoint === "usage") mixed.setHttp(401);
	try {
		mixed.service.startOpenDesignLogin({ expectedRevision: mixed.revision() });
		await until(mixed, ["waiting"]);
		await delay(10);
		assert.equal(mixed.writes, 0, `${endpoint} 401：另一端成功也不能保存 Cookie`);
		assert.equal(mixed.service.getOpenDesignLoginStatus().state, "waiting");
	} finally { mixed.service.dispose(); }
}

// 4. 登录完成前只有非认证 Cookie：同样不保存。
const anonymous = harness({ cookies: [{ name: "__cf_bm", value: "dummy-cf", domain: ".open-design.ai", path: "/", expires: future }] });
anonymous.setHttp(401);
anonymous.service.startOpenDesignLogin({ expectedRevision: anonymous.revision() });
await until(anonymous, ["waiting"]);
await delay(10);
assert.equal(anonymous.writes, 0);
anonymous.service.dispose();

// 5. 登录提交后的指纹必须与身份解析对齐：立刻刷新命中缓存、不重复打接口。这里**先打开检测开关**——
//    opendesign 默认关闭，provider() 会直接返回 disabled；不打开的话「没新增请求」会假通过。
const cached = harness();
await cached.service.save({ visibility: { providers: { [OD]: true } }, expectedRevision: cached.revision() });
cached.service.startOpenDesignLogin({ expectedRevision: cached.revision() });
await until(cached, ["success"]);
const beforeRefresh = cached.calls;
await cached.service.refresh({ providerIds: [OD], force: false });
assert.equal(cached.calls, beforeRefresh, "登录后立刻刷新应命中缓存，不再请求");
await cached.service.refresh({ providerIds: [OD], force: true });
assert.equal(cached.calls, beforeRefresh + 2, "force 才真的重新请求一次（一次查询＝先取 workspaceId 再读额度，共两次 fetch；同时证明开关已生效，上一条不是被 disabled 空过）");
cached.service.dispose();

// 6. dispose 必须同时收掉 OpenDesign 登录器。抽取 CookieLogin 时只接了 MiMo，漏掉它就会留一个
//    Chrome 窗口 + 轮询循环，直到五分钟超时才自己退出。
const leaking = harness({ launch: async b => b });
leaking.setHttp(401);
leaking.service.startOpenDesignLogin({ expectedRevision: leaking.revision() });
await until(leaking, ["waiting"]);
leaking.service.dispose();
assert.equal(leaking.service.openDesignLogin.disposed, true, "dispose 必须收掉 OpenDesign 登录器");
await delay(20);
assert.equal(leaking.service.getOpenDesignLoginStatus().state, "cancelled", "dispose 后任务转入终态，不再等五分钟超时");

// 7. 两个池的取数：个人工作区同时读额度与账号级汇总；团队工作区不读汇总；汇总失败不拖垮窗口。
//    直接把 Cookie 填进手动 Key 槽走 refresh，不经登录流程，只验证取数层。
async function refreshed(options) {
	const h = harness(options);
	const rev = h.revision();
	await h.service.save({ providerId: OD, expectedRevision: rev, keyUpdate: { action: "replace", value: SESSION }, keyMode: "manual" });
	await h.service.save({ visibility: { providers: { [OD]: true } }, expectedRevision: h.revision() });
	const out = await h.service.refresh({ providerIds: [OD], force: true });
	h.service.dispose();
	return { entry: out.entries.find(e => e.providerId === OD), urls: h.urls };
}
const personal = await refreshed({ workspaceType: "personal" });
assert.equal(personal.entry.state, "ok");
assert.ok(personal.urls.some(u => u.endsWith("/v1/billing/summary")), "个人工作区读账号级汇总");
assert.ok(personal.urls.some(u => u.endsWith("/billing/coding-plan-usage")), "额度窗口照常读");
// BODY 的 tier 是 go：Go 没有套餐模型月总额快照，所以不画月池条，但剩余量与钱包余额照常显示。
assert.ok(personal.entry.extras.some(e => e.kind === "balance" && e.value === "16 USD"), "钱包余额 = 接口直报的 balanceUsd");
assert.ok(personal.entry.extras.some(e => e.kind === "monthly-balance" && e.value === "15 USD"), "套餐模型额度剩余 = 订阅额度 ÷ 换算率");
assert.equal(personal.entry.coverage, "complete");

const team = await refreshed({ workspaceType: "team" });
assert.ok(!team.urls.some(u => u.endsWith("/v1/billing/summary")), "团队工作区不读汇总：口径没有实测过，不拿它冒充团队余额");
assert.ok(team.entry.extras.some(e => e.kind === "note" && e.value.includes("团队工作区")), "明说不显示，而不是静默缺一块");
assert.ok(!team.entry.extras.some(e => e.kind === "balance"));
assert.equal(team.entry.windows.length, 1, "Design Plan 窗口不受影响");

const unknownType = await refreshed({});
assert.ok(!unknownType.urls.some(u => u.endsWith("/v1/billing/summary")), "工作区类型读不出来时按保守处理，不读汇总");

// 汇总失败：窗口照常、标 partial、给出原因，且不伪造 0 余额。
const failed = await refreshed({ workspaceType: "personal", summary: "fail" });
assert.equal(failed.entry.state, "ok", "汇总失败不让整家失败");
assert.equal(failed.entry.windows.length, 1, "Design Plan 窗口不受影响");
assert.equal(failed.entry.coverage, "partial");
assert.ok(!failed.entry.extras.some(e => e.kind === "balance" || e.kind === "monthly-balance"), "读不到就不报，绝不补 0");
assert.ok(failed.entry.extras.some(e => e.kind === "note" && e.value.includes("暂不可确认")));

const usageFailed = await refreshed({ workspaceType: "personal", usageFail: true });
assert.equal(usageFailed.entry.state, "ok", "Design Plan 失败仍保留钱包");
assert.equal(usageFailed.entry.coverage, "partial");
assert.equal(usageFailed.entry.windows.length, 0);
assert.ok(usageFailed.entry.extras.some(e => e.kind === "balance" && e.value === "16 USD"));
const bothFailed = await refreshed({ workspaceType: "personal", usageFail: true, summary: "fail" });
assert.equal(bothFailed.entry.state, "error", "两个端点都失败不能冒充成功");

console.log("test-opendesign-login 全部通过 ✅");
