import { randomUUID } from "node:crypto";

export const MIMO_ORIGIN = "https://platform.xiaomimimo.com";
// 登录要落到控制台的套餐管理页：站点首页不触发登录，用户还得自己点进控制台才有登录入口。
// 这一页也正是读取 tokenPlan/detail 与 tokenPlan/usage 的地方。
export const MIMO_LOGIN_URL = `${MIMO_ORIGIN}/console/plan-manage`;
export const MIMO_API_URLS = ["balance", "tokenPlan/detail", "tokenPlan/usage"].map(path => `${MIMO_ORIGIN}/api/v1/${path}`);
const ACTIVE = new Set(["launching", "waiting", "verifying"]);
const REQUIRED = ["api-platform_serviceToken", "userId"];
// Playwright 已按 URL 过滤；再防御性校验每一个必需 Cookie 对全部验证 URL 有效。
// 除 Cookie 串外一并给出平台声明的过期时刻（毫秒）；会话 Cookie 无 expires，返回 0 由 24 小时上限兜底。
export function extractMimoSession(cookies, now = Date.now()) {
 const selected = REQUIRED.map(name => cookies.filter(c => c.name === name && typeof c.value === "string" && c.value && (c.expires === undefined || c.expires === -1 || c.expires * 1000 > now) && MIMO_API_URLS.every(raw => {
  const u = new URL(raw); const domain = (c.domain ?? "").replace(/^\./, "").toLowerCase();
  const allowed = ["platform.xiaomimimo.com", "xiaomimimo.com"].includes(domain);
  const domainOK = allowed && (c.domain?.startsWith(".") ? u.hostname === domain || u.hostname.endsWith(`.${domain}`) : u.hostname === domain);
  const path = c.path || "/";
  return domainOK && (u.pathname === path || u.pathname.startsWith(path.endsWith("/") ? path : `${path}/`));
 })));
 if (selected.some(rows => rows.length !== 1)) return null;
  const declared = selected.map(rows => rows[0].expires).filter(expires => Number.isFinite(expires) && expires > 0);
  return { cookie: selected.map(rows => `${rows[0].name}=${rows[0].value}`).join("; "), expiresAt: declared.length ? Math.min(...declared) * 1000 : 0 };
}
export const extractMimoCookie = (cookies, now = Date.now()) => extractMimoSession(cookies, now)?.cookie ?? null;
const sleep = (ms, signal) => new Promise(resolve => {
 if (signal.aborted) return resolve();
 const finish = () => { clearTimeout(timer); signal.removeEventListener("abort", finish); resolve(); };
 const timer = setTimeout(finish, ms); signal.addEventListener("abort", finish, { once: true });
});
export class MimoLogin {
 constructor(callbacks, options = {}) {
  this.callbacks = callbacks; this.options = options; this.now = options.now ?? Date.now;
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
   const launch = this.options.launch ?? (async () => {
    const { chromium } = await import("playwright-core");
    if (!this.alive(job)) return null;
    return chromium.launch({ channel: "chrome", headless: false });
   });
   const browser = await launch({ channel: "chrome", headless: false });
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
   // 先落控制台套餐页以直接触发登录；控制台历史上出现过 502（仅有首页可用），
   // 那时回退到首页，至少让用户能自己在站内导航，而不是停在一个打不开的页面上。
   try { await page.goto(MIMO_LOGIN_URL, { waitUntil: "domcontentloaded", timeout: 30000 }); }
   catch { await page.goto(MIMO_ORIGIN, { waitUntil: "domcontentloaded", timeout: 30000 }); }
   if (!this.alive(job)) return;
   job.public.state = "waiting"; job.public.message = "请在官方窗口自行完成登录；账户验证通过后保存，额度状态另行显示";
   phase = "verify";
   let nextAttempt = 0, failures = 0;
   while (this.alive(job)) {
    const session = extractMimoSession(await context.cookies(MIMO_API_URLS), this.now());
    if (!this.alive(job)) return;
    if (session && this.now() >= nextAttempt) {
     job.public.state = "verifying"; job.public.message = "正在验证登录和订阅额度（尚未保存）";
     try {
      const verified = await this.callbacks.verify(session.cookie, job.controller.signal);
      if (!this.alive(job)) return;
      if (verified.usageError || !verified.balanceOk) {
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
