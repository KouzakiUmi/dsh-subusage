import { CookieLogin } from "./cookie-login.js";

export const MIMO_ORIGIN = "https://platform.xiaomimimo.com";
// 登录要落到控制台的套餐管理页：站点首页不触发登录，用户还得自己点进控制台才有登录入口。
// 这一页也正是读取 tokenPlan/detail 与 tokenPlan/usage 的地方。
export const MIMO_LOGIN_URL = `${MIMO_ORIGIN}/console/plan-manage`;
export const MIMO_API_URLS = ["balance", "tokenPlan/detail", "tokenPlan/usage"].map(path => `${MIMO_ORIGIN}/api/v1/${path}`);
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
/**
 * MiMo 的站点参数。抓取与验证的流程骨架在 cookie-login.js 的 `CookieLogin` 里，
 * 与 OpenDesign 等其它 Cookie 型提供商共用同一份实现。
 */
export const MIMO_SITE = { origin: MIMO_ORIGIN, loginUrl: MIMO_LOGIN_URL, cookieUrls: MIMO_API_URLS, extract: extractMimoSession };
export class MimoLogin extends CookieLogin {
	constructor(callbacks, options = {}) { super(callbacks, { site: MIMO_SITE, ...options }); }
}
