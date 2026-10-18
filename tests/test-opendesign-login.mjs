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
// 额度接口必须带真实 workspaceId，所以先读当前工作区拿 id（见 openDesignWorkspaceId）。
const CURRENT = { workspaceId: "ws-test-1" };
function harness(options = {}) {
	let content = null, writes = 0, launches = 0, closes = 0, calls = 0;
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
			calls++;
			assert.equal(init.headers.cookie, SESSION, "以 Cookie 头而不是 Bearer 调额度接口");
			assert(init.signal);
			if (url.endsWith("/v1/workspaces/current")) return { status: 200, ok: true, headers: { get: () => null }, text: async () => JSON.stringify(CURRENT) };
			assert.ok(url.endsWith("/v1/workspaces/ws-test-1/billing/coding-plan-usage"), "额度接口必须带真实 workspaceId，不能是 current");
			return { status: http, ok: http === 200, headers: { get: () => null }, text: async () => JSON.stringify(BODY) };
		},
		openDesignLogin: { pollMs: 1, timeoutMs: 1000, ...options.login, launch: async args => { launches++; assert.equal(args.channel, "chrome"); assert.equal(args.headless, false); assert.deepEqual(args.ignoreDefaultArgs, ["--enable-automation"], "向前兼容：1.63 默认参数里没有它，保留以防将来版本加回"); assert.deepEqual(args.args, ["--disable-blink-features=AutomationControlled"], "真正生效的是这条：navigator.webdriver 必须关掉，否则 Cloudflare 在点验证时判负"); return options.launch ? options.launch(browser) : browser; } }
	});
	return { service, browser, events, revision: () => service.result(service.load(), []).settings.revision, get writes() { return writes; }, get launches() { return launches; }, get closes() { return closes; }, get calls() { return calls; }, setHttp: v => http = v, setCookies: v => supplied = v };
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

console.log("test-opendesign-login 全部通过 ✅");
