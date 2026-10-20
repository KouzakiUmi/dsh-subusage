import { CookieLogin } from "./cookie-login.js";

export const OPEN_DESIGN_ORIGIN = "https://open-design.ai";
// 登录入口落控制台的「方案与余额」页：站点首页不触发登录，而这一页正是额度接口的来源。
export const OPEN_DESIGN_LOGIN_URL = `${OPEN_DESIGN_ORIGIN}/cloud/dashboard`;
// 控制面 API 挂在独立域上，控制台靠跨域带凭据（`access-control-allow-credentials: true`）调用。
export const OPEN_DESIGN_API_BASE = "https://amr-api.open-design.ai/api";
// 当前工作区。额度接口的路径里必须带**真实的 workspaceId**：把 `current` 当路径参数会回
// 403 `workspace_member_required`（2026-10-18 实测），所以先取这一条，再拼额度 URL。
export const OPEN_DESIGN_CURRENT_URL = `${OPEN_DESIGN_API_BASE}/v1/workspaces/current`;
export const openDesignUsageUrl = workspaceId => `${OPEN_DESIGN_API_BASE}/v1/workspaces/${encodeURIComponent(workspaceId)}/billing/coding-plan-usage`;
// 账号级余额汇总（路径里没有 workspaceId）：订阅额度、充值额度与账期。2026-10-20 用个人工作区
// 实测过；团队工作区下它是否仍是同一口径没有测过，所以 Host 只在个人工作区读它。
export const OPEN_DESIGN_SUMMARY_URL = `${OPEN_DESIGN_API_BASE}/v1/billing/summary`;
// 交给 context.cookies(...) 的 URL：只用来确定「哪些 Cookie 对这个 API 域生效」。
export const OPEN_DESIGN_API_URLS = [OPEN_DESIGN_CURRENT_URL];
/**
 * OpenDesign 的会话 Cookie 提取：**不按名字挑**。
 * 实测登录态就是 better-auth 的 `__Secure-better-auth.session_token`，但它随时可能改名，
 * 第三方也无从枚举；与其猜一个名字，不如把 `context.cookies(额度接口 URL)` 返回的、对该接口
 * 生效且未过期的 Cookie 原样拼起来——这正是浏览器自己会发的那一条。
 * 登录完成前这里也可能拿到 `od_attr`、`__cf_bm` 之类的非认证 Cookie，但那只会在 verify 时
 * 得到 401 并被判成「登录尚未生效」继续等待，不会保存：只有额度接口真的返回 200 才 commit。
 */
export function extractOpenDesignSession(cookies, now = Date.now()) {
	const usable = cookies.filter(c => typeof c.name === "string" && c.name && typeof c.value === "string" && c.value && (c.expires === undefined || c.expires === -1 || c.expires * 1000 > now));
	if (!usable.length) return null;
	const declared = usable.map(c => c.expires).filter(expires => Number.isFinite(expires) && expires > 0);
	return { cookie: usable.map(c => `${c.name}=${c.value}`).join("; "), expiresAt: declared.length ? Math.min(...declared) * 1000 : 0 };
}
export const extractOpenDesignCookie = (cookies, now = Date.now()) => extractOpenDesignSession(cookies, now)?.cookie ?? null;
export const OPEN_DESIGN_SITE = { origin: OPEN_DESIGN_ORIGIN, loginUrl: OPEN_DESIGN_LOGIN_URL, cookieUrls: OPEN_DESIGN_API_URLS, extract: extractOpenDesignSession };
export class OpenDesignLogin extends CookieLogin {
	constructor(callbacks, options = {}) { super(callbacks, { site: OPEN_DESIGN_SITE, ...options }); }
}
