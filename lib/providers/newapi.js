// lib/providers/newapi.js —— 自建 New API / one-api 站点额度。
//
// 契约来源（已按仓库「证据先于结论」核过一手资料）：
// - 官方文档 `GET /api/usage/token`，Bearer 鉴权，成功信封 `code: true`
//   （https://raw.githubusercontent.com/QuantumNous/new-api-docs/main/docs/api/token-usage.md）。
// - 单位按站点标准 `quota_per_unit` 换算，公开 `/api/status` 默认 500000；
//   本入口按该默认值固定换算，不按国家货币换算（见 docs/providers.md 约定）。
// - one-api 系的无限额度令牌自动返回账户额度（无后台开关），与归一化逻辑一致。
//
// 模块只经参数 API 与宿主通信：归一化收 `api`（createWindowApi 产物），
// 取数收 `deps`（{ get, failure }），不直引 DSH 核心包与宿主私有状态。

export const NEWAPI_ID = "newapi";
export const NEWAPI_USAGE_PATH = "/api/usage/token";
export const NEWAPI_QUOTA_PER_CREDIT = 500000;

/**
 * 站点根规范化：去首尾空白与尾部斜杠，去掉末尾一层 `/v1`（OpenAI 兼容地址）
 * 与 `/api`（管理接口前缀），自建子路径保留；只接受 http(s)，拒绝带用户名
 * 密码的 URL。非法一律返回 ""（调用方按「未配置」处理，不发起请求）。
 */
export function newapiRoot(baseUrl) {
	if (typeof baseUrl !== "string") return "";
	let text = baseUrl.trim().replace(/\/+$/, "");
	if (!text) return "";
	let url;
	try { url = new URL(text); } catch { return ""; }
	if (url.protocol !== "http:" && url.protocol !== "https:") return "";
	if (url.username || url.password) return "";
	const parts = url.pathname.split("/").filter(Boolean);
	while (parts.length && (parts[parts.length - 1].toLowerCase() === "v1" || parts[parts.length - 1].toLowerCase() === "api")) parts.pop();
	url.pathname = parts.length ? `/${parts.join("/")}` : "";
	url.search = "";
	url.hash = "";
	return url.toString().replace(/\/+$/, "");
}

const round2 = value => Math.round(value * 100) / 100;

/**
 * New API 响应分类（纯核心，provider 归一化与声明式适配器共用，防止两路实现漂移）：
 * 校验信封（`code: true` / `success: true`；显式 false 是认证拒绝）并提取令牌/账户字段，
 * 返回 `{ mode, granted, used, available, walletAvailable, walletUsed, tokenName, expiresAt }`；
 * mode: unlimited（无限制令牌）/ limited（有限令牌）/ legacy（旧版不报 unlimited_quota）。
 * 读不出任何额度时抛 `subusage/response`。
 */
export function classifyNewApiUsage(body) {
	const fail = (code, message) => { const error = new Error(message); error.code = code; throw error; };
	if (!body || typeof body !== "object" || Array.isArray(body)) fail("subusage/response", "New API 响应形状无效");
	const ok = body.code === true || body.success === true;
	if (!ok) {
		const upstream = typeof body.message === "string" && body.message.trim() ? `：${body.message.trim().slice(0, 120)}` : "";
		fail("subusage/auth", `New API 认证被拒绝${upstream}。额度查询与推理用同一把 sk- Key，不是控制台访问令牌`);
	}
	const data = body.data && typeof body.data === "object" && !Array.isArray(body.data) ? body.data : undefined;
	if (!data) fail("subusage/response", "New API 响应缺少用量数据");
	const num = value => typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : undefined;
	const name = typeof data.name === "string" && data.name.trim() ? data.name.trim() : "";
	const userQuota = data.user_quota && typeof data.user_quota === "object" && !Array.isArray(data.user_quota) ? data.user_quota : undefined;
	const walletAvailable = userQuota ? num(userQuota.total_available) : undefined;
	const walletUsed = userQuota ? num(userQuota.total_used) : undefined;
	const granted = num(data.total_granted);
	const used = num(data.total_used);
	const available = num(data.total_available);
	const hasTokenNumbers = granted !== undefined || used !== undefined || available !== undefined;
	const unlimited = data.unlimited_quota === true;
	if (unlimited) {
		// 无限制令牌自身没有可读额度：主余额必须取账户额度。
		if (walletAvailable === undefined) fail("subusage/response", "无限额度令牌没有返回账户额度（allow_user_quota_query）。到 New API 控制台的令牌设置里开启「允许查询用户额度」后重试");
		return { mode: "unlimited", granted, used, available, walletAvailable, walletUsed, tokenName: name, expiresAt: num(data.expires_at) };
	}
	if (data.unlimited_quota === false || hasTokenNumbers) return { mode: "limited", granted, used, available, walletAvailable, walletUsed, tokenName: name, expiresAt: num(data.expires_at) };
	// 旧版 one-api 不报 unlimited_quota：令牌无数字时账户余额是唯一可读池。
	if (userQuota && walletAvailable !== undefined) return { mode: "legacy", granted, used, available, walletAvailable, walletUsed, tokenName: name, expiresAt: num(data.expires_at) };
	// 只有令牌名/到期等元数据：没有额度可读，判读取失败（不当成 0）。
	fail("subusage/response", "New API 响应没有可用的额度或余额");
}

/**
 * New API 令牌用量归一化。两种成功信封都认（New API 的 `code: true` 与
 * 部分 one-api 系的 `success: true`）；显式 false 是认证拒绝。
 * 单位固定 `NEWAPI_QUOTA_PER_CREDIT quota = 1 Credits`。
 */
export function normalizeNewApi(body, now = Date.now(), api) {
	if (!api?.windowExtrasResult) throw new TypeError("normalizeNewApi 需要 windowApi");
	const { windowRow, windowExtrasResult } = api;
	const info = classifyNewApiUsage(body);
	const credits = value => `${round2(value / NEWAPI_QUOTA_PER_CREDIT)} Credits`;
	const { mode, tokenName: name } = info;
	const windows = [];
	const extras = [];
	const quotas = [];
	let order = 0;
	// 到期日是令牌到期，不是窗口重置：只作说明行，不写进 resetsAt。
	if (info.expiresAt) {
		const at = info.expiresAt * 1000;
		const date = new Date(at).toISOString().slice(0, 10);
		const days = Math.ceil((at - now) / 86400000);
		extras.push({ kind: "note", value: days > 0 ? `令牌到期 ${date}（还有 ${days} 天）` : `令牌已于 ${date} 到期` });
	}
	if (mode === "unlimited") {
		// 无限制令牌自身没有可读额度：主余额取账户可用额度，累计消费走 spend。
		const walletAvailable = info.walletAvailable;
		extras.push({ kind: "balance", value: credits(walletAvailable) });
		quotas.push({ type: "amount", order: order++, id: "balance", role: "wallet", label: "账户余额", amount: { value: round2(walletAvailable / NEWAPI_QUOTA_PER_CREDIT), unit: "Credits" } });
		if (info.walletUsed !== undefined) extras.push({ kind: "spend", value: credits(info.walletUsed) });
		if (name) extras.push({ kind: "note", value: `无限额度令牌：${name}` });
	} else if (mode === "limited") {
		// 有限令牌：主余额是令牌自身可用额度；有总额时产 period 窗口（无重置时间）。
		const granted = info.granted ?? 0;
		const used = info.used ?? 0;
		const available = info.available ?? 0;
		if (granted > 0) {
			const percent = Math.min(100, used / granted * 100);
			const detail = { used: round2(used / NEWAPI_QUOTA_PER_CREDIT), limit: round2(granted / NEWAPI_QUOTA_PER_CREDIT), remaining: round2(available / NEWAPI_QUOTA_PER_CREDIT), unit: "Credits" };
			windows.push(windowRow("period", percent, undefined, undefined, detail));
			quotas.push({ type: "window", order: order++, id: "token", period: "period", percent: windows[0].percent, used: detail.used, limit: detail.limit, amount: { value: detail.used, unit: "Credits" } });
		}
		extras.push({ kind: "balance", value: credits(available) });
		quotas.push({ type: "amount", order: order++, id: "balance", role: "plan", label: "令牌余额", amount: { value: round2(available / NEWAPI_QUOTA_PER_CREDIT), unit: "Credits" } });
		if (name) extras.push({ kind: "note", value: `令牌：${name}` });
		// 账户钱包只作说明，不并入主余额（两个池，不混报）。
		if (info.walletAvailable !== undefined) {
			const walletAvailable = info.walletAvailable;
			extras.push({ kind: "note", value: walletAvailable > 0 ? `账户余额另有 ${credits(walletAvailable)}` : walletAvailable === 0 ? "账户余额为 0" : `账户余额为负（${round2(walletAvailable / NEWAPI_QUOTA_PER_CREDIT)} Credits）` });
		}
	} else {
		// legacy：只有账户余额可读。
		const walletAvailable = info.walletAvailable;
		extras.push({ kind: "balance", value: credits(walletAvailable) });
		quotas.push({ type: "amount", order: order++, id: "balance", role: "wallet", label: "账户余额", amount: { value: round2(walletAvailable / NEWAPI_QUOTA_PER_CREDIT), unit: "Credits" } });
		if (info.walletUsed !== undefined) extras.push({ kind: "spend", value: credits(info.walletUsed) });
		extras.push({ kind: "note", value: `账户余额 · 令牌：${name || "未知"}` });
	}
	return windowExtrasResult({ windows, extras, quotas, coverage: "complete" });
}

/**
 * 取数：GET {root}/api/usage/token，Bearer 用推理同一把 Key。
 * 文档路径优先；部分部署只认尾斜杠变体（301），此时跟进一次。
 */
export async function fetchNewApi({ root, key, get, failure }) {
	if (!root) throw failure("subusage/credentials", "未配置 New API 站点地址：在 设置 → 订阅用量 → New API 的「连接与凭据」里填写站点根地址");
	const headers = { authorization: `Bearer ${key}` };
	const paths = [NEWAPI_USAGE_PATH, `${NEWAPI_USAGE_PATH}/`];
	let lastError;
	for (const path of paths) {
		try {
			return await get(`${root}${path}`, headers);
		} catch (error) {
			lastError = error;
			// 只有「可能是路径问题」才试第二种拼写：文档路径优先，部分部署只认尾斜杠
			// 变体（301）。认证/余额语义错误直接抛，不拿第二种路径掩盖。
			const retryable = error?.code === "subusage/http" || error?.code === "subusage/network" ||
				(error?.code === "subusage/response" && /重定向/.test(error?.message ?? ""));
			if (!retryable) throw error;
		}
	}
	throw lastError;
}

/** 上游 HTTP 状态到可行动错误的映射（调用方在 get 抛错后喂 status 调用）。 */
export function newapiHttpError(status, failure) {
	if (status === 401 || status === 403) return failure("subusage/auth", "New API 认证失败：额度查询与推理用同一把 sk- Key，不是控制台访问令牌");
	if (status === 404) return failure("subusage/response", "New API 站点缺少 /api/usage/token/ 接口：确认这是 New API / one-api 站点且版本支持令牌用量查询");
	return undefined;
}
