import { CookieLogin } from "./cookie-login.js";

export const OPEN_DESIGN_ORIGIN = "https://open-design.ai";
// 登录入口落控制台的「方案与余额」页：站点首页不触发登录，而这一页正是额度接口的来源。
export const OPEN_DESIGN_LOGIN_URL = `${OPEN_DESIGN_ORIGIN}/cloud/dashboard`;
// 额度接口挂在独立 API 域上，控制台靠跨域带凭据（`access-control-allow-credentials: true`）调用，
// 所以取 Cookie 要按这个 URL 取。
export const OPEN_DESIGN_USAGE_URL = "https://amr-api.open-design.ai/api/v1/workspaces/current/billing/coding-plan-usage";
export const OPEN_DESIGN_API_URLS = [OPEN_DESIGN_USAGE_URL];
/**
 * OpenDesign 的会话 Cookie 提取：**不按名字挑**。
 * 登录态只写在 HttpOnly Cookie 上，前端 bundle 读不到名字，第三方也无从枚举；与其猜一个
 * 随时可能改的名字，不如把 `context.cookies(额度接口 URL)` 返回的、对该接口生效且未过期的
 * Cookie 原样拼起来——这正是浏览器自己会发的那一条。
 * 登录完成前这里也可能拿到 `__cf_bm`、`od_attr` 之类的非认证 Cookie，但那只会在 verify 时
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
