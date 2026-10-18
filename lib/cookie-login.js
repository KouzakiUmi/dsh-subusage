import { randomUUID } from "node:crypto";

const ACTIVE = new Set(["launching", "waiting", "verifying"]);
/**
 * 带 Cloudflare 防护的站点（OpenDesign 就是）在点「验证」那一刻会查 `navigator.webdriver`，
 * 为 true 就判自动化并直接失败。非 headless 的 `channel: "chrome"` 启动出来它仍是 true，
 * 真正能把它压下去的是下面这条 blink 开关——Playwright 自己的 browser 工具在
 * `validateBrowserConfig` 里也给 chromium 追加同一条。
 * `ignoreDefaultArgs` 那行在 playwright-core 1.63 上是空操作（该版本默认参数里已经没有
 * `--enable-automation`，过滤一个不存在的参数不报错也不生效），保留它只为向前兼容：将来哪个
 * 版本把这条开关加回默认参数时能自动兜住。
 * 这**不是**绕过人机验证：用户仍然要在弹出的窗口里亲自完成 Cloudflare 挑战，只是别让浏览器
 * 还没等人操作就先自报自动化身份。MiMo 没有这层防护，带上也照样能用。
 */
const chromeLaunchOptions = () => ({
	channel: "chrome",
	headless: false,
	ignoreDefaultArgs: ["--enable-automation"],
	args: ["--disable-blink-features=AutomationControlled"]
});
const sleep = (ms, signal) => new Promise(resolve => {
	if (signal.aborted) return resolve();
	const finish = () => { clearTimeout(timer); signal.removeEventListener("abort", finish); resolve(); };
	const timer = setTimeout(finish, ms); signal.addEventListener("abort", finish, { once: true });
});
/**
 * 通用「会话 Cookie 登录器」：开一个独立的临时 Chrome，让用户在官方页面**自己**完成登录，
 * 再从该会话抓取站点 Cookie，经调用方 `verify` 通过后交给 `commit` 保存。
 *
 * 骨架与 MiMo 的那份完全一致（轮询、限频重试、取消、五分钟超时、revision 冲突检测、
 * 终态回放），把站点差异收敛到 `options.site` 的四项：
 *   - `origin`   站点首页，控制台页打不开时的导航兜底；
 *   - `loginUrl` 登录入口，直接落到会触发登录的那一页；
 *   - `cookieUrls` 交给 `context.cookies(...)` 的 URL 列表，决定读哪些域的 Cookie；
 *   - `extract(cookies, now)` 从 Cookie 列表里挑出该站点的会话串，拿不到返回 null。
 *
 * 新增一个 Cookie 型提供商只需再写一份 site 配置，不要再复制这个类的流程。
 */
export class CookieLogin {
	constructor(callbacks, options = {}) {
		this.callbacks = callbacks; this.options = options; this.now = options.now ?? Date.now;
		this.site = options.site;
		if (!this.site?.origin || !this.site?.loginUrl || typeof this.site.extract !== "function") throw new TypeError("CookieLogin 需要 site.origin / site.loginUrl / site.extract");
		this.current = null; this.disposed = false;
	}
	status() {
		const job = this.current;
		if (job?.public.state === "success" && this.callbacks.reconcileResult) {
			// 终态可被新 UI 反复轮询，但不能回放旧身份或旧 settings revision。
			let result;
			try { result = this.callbacks.reconcileResult(job.public.result); } catch { result = null; }
			if (!result) { this.current = null; return { jobId: null, state: "idle" }; }
			job.public.result = result;
		}
		return this.current ? structuredClone(this.current.public) : { jobId: null, state: "idle" };
	}
	start(request) {
		if (this.disposed) throw this.callbacks.error("subusage/disposed", "服务已卸载");
		if (this.current && ACTIVE.has(this.current.public.state)) return this.status();
		const captured = this.callbacks.capture(request.expectedRevision);
		const job = { public: { jobId: randomUUID(), state: "launching", startedAt: new Date(this.now()).toISOString(), message: "正在打开临时 Chrome 登录窗口" }, controller: new AbortController(), captured, browser: null };
		this.current = job;
		job.timer = setTimeout(() => this.finish(job, "error", "subusage/login-timeout", "登录已超过五分钟，请重新开始"), this.options.timeoutMs ?? 300000);
		// 启动只排队，RPC 不等待浏览器、网络或人工登录。
		void Promise.resolve().then(() => this.run(job));
		return this.status();
	}
	alive(job) { return !job.controller.signal.aborted && !this.disposed && this.current === job; }
	async close(browser) { try { await browser?.close(); } catch {} }
	finish(job, state, errorCode, message, result) {
		if (!this.alive(job)) return;
		Object.assign(job.public, { state, finishedAt: new Date(this.now()).toISOString(), ...(errorCode ? { errorCode } : {}), ...(message ? { message } : {}), ...(result ? { result } : {}) });
		clearTimeout(job.timer); job.controller.abort(); void this.close(job.browser);
	}
	cancel(request) {
		const job = this.current;
		if (job?.public.jobId === request.jobId && ACTIVE.has(job.public.state)) this.finish(job, "cancelled", undefined, "登录已取消，未保存 Cookie");
		return this.status();
	}
	dispose() { if (this.current && ACTIVE.has(this.current.public.state)) this.finish(this.current, "cancelled", undefined, "服务已卸载，登录已取消"); this.disposed = true; }
	async run(job) {
		let phase = "launch";
		try {
			if (!this.alive(job)) return;
			const options = chromeLaunchOptions();
			const launch = this.options.launch ?? (async () => {
				const { chromium } = await import("playwright-core");
				if (!this.alive(job)) return null;
				return chromium.launch(options);
			});
			const browser = await launch(options);
			if (!browser) return;
			job.browser = browser;
			if (!this.alive(job)) { await this.close(browser); return; }
			browser.on?.("disconnected", () => this.finish(job, "cancelled", undefined, "登录窗口已关闭，未保存 Cookie"));
			const context = await browser.newContext();
			if (!this.alive(job)) return;
			const page = await context.newPage();
			page.on?.("close", () => this.finish(job, "cancelled", undefined, "登录窗口已关闭，未保存 Cookie"));
			if (!this.alive(job)) return;
			phase = "navigate";
			// 先落登录入口以直接触发登录；入口打不开时回退到站点首页（历史上出现过控制台 502、
			// 只有首页可用的情况），至少让用户能自己在站内导航，而不是停在一个打不开的页面上。
			try { await page.goto(this.site.loginUrl, { waitUntil: "domcontentloaded", timeout: 30000 }); }
			catch { await page.goto(this.site.origin, { waitUntil: "domcontentloaded", timeout: 30000 }); }
			if (!this.alive(job)) return;
			job.public.state = "waiting"; job.public.message = "请在官方窗口自行完成登录；账户验证通过后保存，额度状态另行显示";
			phase = "verify";
			let nextAttempt = 0, failures = 0;
			while (this.alive(job)) {
				const session = this.site.extract(await context.cookies(this.site.cookieUrls), this.now());
				if (!this.alive(job)) return;
				if (session && this.now() >= nextAttempt) {
					job.public.state = "verifying"; job.public.message = "正在验证登录和订阅额度（尚未保存）";
					try {
						const verified = await this.callbacks.verify(session.cookie, job.controller.signal);
						if (!this.alive(job)) return;
						if (verified.usageError || !verified.balanceOk) {
							// 「登录成功但额度读不全」不算失败：Cookie 是真的，照常保存，只是额度状态另说。
							job.public.state = "waiting"; job.public.message = "已读取账户，但订阅额度尚未完整验证；尚未保存，请确认套餐或继续登录";
							nextAttempt = this.now() + 15000;
						} else {
							// commit 必须同步检查冲突并写入，不能在取消后写入。
							const result = this.callbacks.commit(session.cookie, job.captured, verified, session.expiresAt);
							this.finish(job, "success", undefined, verified.coverage === "complete" && verified.windows?.length ? "登录及订阅额度已验证，Cookie 已保存" : "登录已保存；仅余额可读，订阅额度未知", result); return;
						}
					} catch (e) {
						if (!this.alive(job)) return;
						if (["subusage/revision-conflict", "subusage/invalid-request", "subusage/config"].includes(e?.code)) {
							this.finish(job, "error", e.code, "设置已改变或无法保存，请重新读取后重试"); return;
						}
						failures++;
						const retry = Number(e?.details?.retryAfterMs);
						nextAttempt = this.now() + Math.max(5000, Math.min(60000, 2000 * 2 ** Math.min(failures, 5)), Number.isFinite(retry) ? Math.min(300000, retry) : 0);
						job.public.state = "waiting"; job.public.message = e?.code === "subusage/auth" ? "登录尚未生效，请继续在官方窗口完成登录；未保存" : "额度验证暂未成功，将限频重试；未保存";
					}
				}
				await sleep(this.options.pollMs ?? 1000, job.controller.signal);
			}
		} catch {
			if (this.alive(job)) this.finish(job, "error", phase === "launch" ? "subusage/chrome-unavailable" : "subusage/login-browser", phase === "launch" ? "无法启动 Chrome，请确认已安装 Chrome 和 playwright-core" : "登录窗口无法继续，请重试；未保存 Cookie");
		} finally { if (!this.alive(job)) await this.close(job.browser); }
	}
}
