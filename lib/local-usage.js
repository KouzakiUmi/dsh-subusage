// 本机直取：不经任何兄弟插件，直接拿 DSH 凭据服务里的账号凭据调各家上游的只读额度接口。
//
// 为什么可行：EAC（dsh-eac-router）把这些账号的凭据明文存在 DSH 凭据库里
// （`ctx.credentials.resolve(ref)` → JSON），账号到 ref 的映射在
// `$DSH_HOME/channel-pack/state.json` 的 `accounts[].credentialRef`。
// 直取读的是**同一批账号**，所以输出形状与 EAC 的 `credits.balances` 对齐，
// 直接复用 [eac-usage.js](eac-usage.js) 的 `normalizeEac` 归一化，不再另写一套显示逻辑。
//
// 只读两条铁律：
// 1. 不替用户刷新 token。EAC 会周期性轮换 Raccoon 的 refresh_token，
//    两边同时持有刷新权会把对方的 token 顶掉（实测过的坑）。
// 2. 不碰任何写接口（例如 Loomy 的每日签到 `/points/first-login`）：
//    打开面板不该变成意外签到。
//
// 保密：凭据只在内存里用，不进结果、不进错误文案、不落缓存。

const text = value => typeof value === "string" ? value : "";
const num = value => typeof value === "number" && Number.isFinite(value) ? value : undefined;
const object = value => value && typeof value === "object" && !Array.isArray(value);
const UNIT = "积分";

/** 本模块直接支持的上游渠道；不在这里的渠道交给现有通道处理。 */
export const LOCAL_CHANNELS = Object.freeze({ raccoon: "小浣熊", loomy: "Loomy", qoder: "Qoder", qodercn: "Qoder 中国版", zcode: "ZCode", trae: "Trae" });

const ENDPOINTS = {
	raccoon: {
		url: "https://xiaohuanxiong.com/api/web/points/v1/balance",
		// `X-Org-Code` 是组织/运营商维度；personal 账号该值为空串，客户端总是发这个头。
		headers: credential => ({
			Accept: "application/json",
			"Content-Type": "application/json",
			Authorization: `Bearer ${text(credential.access_token)}`,
			"X-Org-Code": text(credential.office_identity),
			"X-Raccoon-Language": "zh",
			"X-Client-Platform": "desktop-windows",
			"X-Client-Version": "v1.0.35",
			"User-Agent": "Raccoon Work/1.0.35 (Windows)",
		}),
	},
	loomy: {
		url: "https://loomyad.xunfei.cn/api/v1/points/records?pageNo=1&pageSize=1&recordType=all",
		// 讯飞这个接口只认 `token` 头；发 `Authorization: Bearer` 会被判成「缺少 token」。
		headers: credential => ({ Accept: "application/json", token: text(credential.access_token) }),
	},
	// Qoder 国际版 / 中国版同一套协议，只有 base 不同；`security_oauth_token` 优先，空则回退 `access_token`。
	qoder: {
		url: "https://openapi.qoder.sh/sash/api/v2/me/usage",
		headers: credential => ({ Accept: "application/json", Authorization: `Bearer ${text(credential.security_oauth_token) || text(credential.access_token)}`, "Cosy-ClientType": "10", "User-Agent": "Qoder" }),
	},
	qodercn: {
		url: "https://openapi.qoder.com.cn/sash/api/v2/me/usage",
		headers: credential => ({ Accept: "application/json", Authorization: `Bearer ${text(credential.security_oauth_token) || text(credential.access_token)}`, "Cosy-ClientType": "10", "User-Agent": "Qoder" }),
	},
	trae: {
		url: "https://api.trae.cn/trae/api/v2/pay/web_user_ent_usage",
		method: "POST",
		body: () => ({ require_usage: true }),
		// `Cloud-IDE-JWT` 是桌面客户端那一族；CLI 的 JWT 走这个头只会得到 401 / code 1001。
		headers: credential => ({
			Accept: "application/json",
			"Content-Type": "application/json",
			Authorization: `Cloud-IDE-JWT ${text(credential.access_token)}`,
			"User-Agent": "Mozilla/5.0",
			Origin: "https://www.trae.cn",
			Referer: "https://www.trae.cn/",
		}),
	},
	zcode: {
		url: "https://zcode.z.ai/api/v1/zcode-plan/billing/balance",
		// `X-Device-Mid` 缺了会被上游判成参数错误（400 / code 3001），不是可选项。
		headers: credential => ({
			Accept: "application/json",
			Authorization: `Bearer ${text(credential.zcode_jwt)}`,
			"X-Device-Mid": text(credential.device_mid),
			"User-Agent": `ZCode/${text(credential.app_version) || "3.14.3"}`,
			"X-ZCode-App-Version": text(credential.app_version) || "3.14.3",
			"HTTP-Referer": "https://zcode.z.ai",
			"X-Release-Channel": "stable",
			"X-Client-Language": "zh-CN",
			"X-Client-Timezone": "Asia/Shanghai",
			"X-Platform": "win32",
			"X-Os-Category": "windows",
			"anthropic-version": "2023-06-01",
			"Content-Type": "application/json",
		}),
	},
};

/** Raccoon `GET /points/v1/balance`：`code === 0` 才算成功，`available_points` 是可用总量。 */
function raccoonBalance(body) {
	if (!object(body) || body.code !== 0) return undefined;
	const data = object(body.data) ? body.data : undefined;
	const total = num(data?.available_points);
	if (total === undefined) return undefined;
	const packages = [];
	const push = (name, value) => { const remaining = num(value); if (remaining !== undefined) packages.push({ name, remaining, unit: UNIT }); };
	push("奖励积分", data.reward_points);
	push("每日积分", data.daily_points);
	push("会员积分", data.monthly_points);
	push("充值积分", data.topup_points);
	// 上游只给总量时的兜底包：让单位跟着分项走（「积分」），而不是让下游编成 credits。
	if (!packages.length) packages.push({ name: "可用积分", remaining: total, unit: UNIT });
	return { total, packages };
}

/** Loomy `GET /points/records`：成功码是字符串 `"000000"`，业务失败也回 HTTP 200，只能读 body。 */
function loomyBalance(body) {
	if (!object(body) || String(body.code) !== "000000") return undefined;
	const data = object(body.data) ? body.data : undefined;
	const permanent = num(data?.balance), daily = num(data?.dailyBalance) ?? 0;
	const available = num(data?.availableBalance);
	const total = available ?? (permanent === undefined ? undefined : permanent + daily);
	if (total === undefined) return undefined;
	const packages = [];
	if (permanent !== undefined) packages.push({ name: "永久积分", remaining: permanent, unit: UNIT });
	if (daily > 0) packages.push({ name: "每日赠送", remaining: daily, unit: UNIT });
	if (!packages.length) packages.push({ name: "可用积分", remaining: total, unit: UNIT });
	return { total, packages };
}

/**
 * Qoder（国际版与中国版同一套协议）：`userQuota` / `addOnQuota` 各是一个额度池，
 * `dedicatedResourcePackages[]` 是资源包。企业版 `displayMode === "enterprise"` 不下发数字——
 * 必须当成「查不到」而不是 0，否则会给企业账号显示一个假的空额度。
 */
function qoderBalance(body) {
	if (!object(body)) return undefined;
	if (body.displayMode === "enterprise") return NO_NUMBER;
	const usage = object(body.qoderUsage) ? body.qoderUsage : undefined;
	if (!usage) return undefined;
	const packages = [];
	const push = (quota, name) => {
		if (!object(quota)) return;
		const remaining = num(quota.remaining);
		if (remaining === undefined) return;
		packages.push({ name, remaining: Math.max(0, remaining), unit: text(quota.unit) || "credits" });
	};
	push(usage.userQuota, "套餐额度");
	push(usage.addOnQuota, "附加额度");
	for (const row of Array.isArray(usage.dedicatedResourcePackages) ? usage.dedicatedResourcePackages : []) {
		const remaining = num(row?.remaining);
		if (remaining === undefined) continue;
		packages.push({ name: text(row?.name) || text(row?.id) || "资源包", remaining: Math.max(0, remaining), unit: text(row?.unit) || "credits" });
	}
	if (!packages.length) return undefined;
	return { total: packages.reduce((sum, row) => sum + row.remaining, 0), packages };
}

/**
 * ZCode：单位是 token 不是积分，`available_units` 优先于 `remaining_units`。
 * 企业版同样没有数字，按「查不到」处理。
 */
function zcodeBalance(body) {
	if (!object(body)) return undefined;
	const data = object(body.data) ? body.data : undefined;
	if (!data) return undefined;
	if (data.displayMode === "enterprise") return NO_NUMBER;
	// `balances` 缺失 = 形状变了（回退）；存在但是空数组 = 这个账号 0 个额度桶（合法，总量 0）。
	const balances = Array.isArray(data.balances) ? data.balances : undefined;
	if (balances === undefined) return undefined;
	const packages = [];
	for (const row of balances) {
		const remaining = num(row?.available_units) ?? num(row?.remaining_units);
		if (remaining === undefined) continue;
		packages.push({ name: text(row?.show_name) || "额度", remaining: Math.max(0, remaining), unit: text(row?.unit_type) || "token" });
	}
	return { total: packages.reduce((sum, row) => sum + row.remaining, 0), packages };
}

/**
 * Trae：`usage_summary` 给总量与已用，`user_entitlement_pack_list` 给逐包。
 * 剩余一律按 `credits_limit - credits_amount` 算，不臆造面值；包列表为空时退回汇总。
 */
function traeBalance(body) {
	if (!object(body)) return undefined;
	const summary = object(body.usage_summary) ? body.usage_summary : undefined;
	const packs = Array.isArray(body.user_entitlement_pack_list) ? body.user_entitlement_pack_list : [];
	const packages = [];
	for (const pack of packs) {
		const info = object(pack?.entitlement_base_info) ? pack.entitlement_base_info : undefined;
		// 与 dsh-connect-trae 同序：`product_extra.package_extra` 优先，缺了才退回 `quota`。
		const limit = num(info?.product_extra?.package_extra?.quota?.credits_limit) ?? num(info?.quota?.credits_limit);
		if (limit === undefined) continue;
		const used = num(pack?.usage?.credits_amount) ?? 0;
		// 只认 `display_desc`：`package_name` 是产品名，三个包会同名，反而丢掉真实分项标签。
		const name = text(pack?.display_desc) || text(pack?.group_name) || "额度包";
		packages.push({ name, remaining: Math.max(0, limit - used), unit: "credits" });
	}
	const totalAmount = num(summary?.total_amount), consumed = num(summary?.consumed_amount);
	const total = totalAmount !== undefined && consumed !== undefined ? Math.max(0, totalAmount - consumed) : packages.reduce((sum, row) => sum + row.remaining, 0);
	if (!packages.length && total === undefined) return undefined;
	return { total, packages };
}

/** 上游明确表示「这个账号按设计就没有数字」（企业版）。与「查不到」严格区分。 */
const NO_NUMBER = Object.freeze({ noNumber: true });

const PARSERS = { raccoon: raccoonBalance, loomy: loomyBalance, qoder: qoderBalance, qodercn: qoderBalance, zcode: zcodeBalance, trae: traeBalance };

/** 各家放 token 的字段名不一致：ZCode 用 `zcode_jwt`，其余用 `access_token`。 */
const TOKEN_FIELDS = { zcode: ["zcode_jwt"] };
/** 除 token 外还必需的身份字段：ZCode 缺 `device_mid` 会被上游判成参数错误（400 / code 3001）。 */
const REQUIRED_FIELDS = { zcode: [["device_mid", "设备标识"]] };

/** 凭据过期时间：优先显式 `expires_at`，其次解 JWT 的 `exp`。只读本地字段，不联网。 */
function expiryOf(credential) {
	// 各家字段名不一致：raccoon/lobsterai 用 `expires_at`，qoder 用 `expire_time`，minimax 用 `expiresAtMs`。
	const raw = credential.expire_time ?? credential.expires_at ?? credential.expiresAtMs;
	const explicit = num(typeof raw === "string" ? Number(raw) : raw);
	// 秒级时间戳按秒处理：直接当毫秒会把「还没过期」判成「早就过期」并静默丢掉整条渠道。
	if (explicit !== undefined && explicit > 0) return explicit < 1e12 ? explicit * 1000 : explicit;
	const token = text(credential.access_token);
	const parts = token.split(".");
	if (parts.length !== 3) return undefined;
	try {
		const payload = JSON.parse(Buffer.from(parts[1], "base64url").toString("utf8"));
		const exp = num(payload?.exp);
		return exp === undefined ? undefined : exp * 1000;
	} catch { return undefined; }
}

/**
 * 直取读取器。`accounts(channel)` 返回 `[{ ref, accountId, nickname }]`（由 Host 从账号索引读），
 * `resolve(ref)` 取凭据对象。两者都注入，便于隔离测试。
 *
 * 通道缺席（没有账号、凭据库为空）返回 `undefined`；单个账号读失败只让该账号带 error，
 * 这样部分成功仍能显示，且调用方可以据此决定要不要回退到别的来源。
 */
export class LocalUsageReader {
	constructor({ accounts, resolve, fetchImpl, now = Date.now, timeoutMs = 12000, signal } = {}) {
		if (typeof accounts !== "function" || typeof resolve !== "function") throw new TypeError("LocalUsageReader 需要 accounts 与 resolve 函数");
		this.accounts = accounts; this.resolve = resolve;
		this.fetchImpl = fetchImpl; this.now = now; this.timeoutMs = timeoutMs; this.signal = signal;
		this.cache = new Map(); this.pending = new Map(); this.versions = new Map(); this.disposed = false;
	}
	read(channel, force = false) {
		if (this.disposed) throw new Error("直取读取器已卸载");
		if (!Object.hasOwn(LOCAL_CHANNELS, channel)) throw new Error("未知直取渠道");
		// 在途请求本身就是刚发出去的：force 绕过缓存，但不该再发一份重复的上游请求。
		if (this.pending.has(channel)) return this.pending.get(channel);
		const cached = this.cache.get(channel), time = this.now();
		if (!force && cached && time >= cached.at && time - cached.at < 60000) return structuredClone(cached.value);
		const version = (this.versions.get(channel) ?? 0) + 1; this.versions.set(channel, version);
		const task = Promise.resolve().then(() => this.load(channel)).then(value => {
			if (!this.disposed && this.versions.get(channel) === version) {
				if (value === undefined) this.cache.delete(channel);
				else this.cache.set(channel, { at: this.now(), value: structuredClone(value) });
			}
			return value;
		}).finally(() => { if (this.pending.get(channel) === task) this.pending.delete(channel); });
		this.pending.set(channel, task);
		return task;
	}
	async load(channel) {
		let rows;
		try { rows = await this.accounts(channel); } catch { rows = undefined; }
		if (!Array.isArray(rows) || !rows.length) return undefined;
		const accounts = await Promise.all(rows.map(row => this.account(channel, row)));
		// 一个账号都没读到就当成「这条通道本期没有数据」，让调用方静默回退到别的来源。
		// 但「上游应答成功、只是没有数字」（企业版账号）算可达，要如实显示原因而不是装作缺席。
		if (!accounts.some(row => row.balance || row.reachable)) return undefined;
		return { accounts };
	}
	async account(channel, row) {
		const base = { accountId: text(row?.accountId), nickname: text(row?.nickname) };
		try {
			const credential = await this.resolve(row?.ref);
			if (!object(credential)) return { ...base, balance: null, error: "账号凭据缺失，请在提供方重新登录" };
			const tokenFields = TOKEN_FIELDS[channel] ?? ["access_token"];
			if (!tokenFields.some(field => text(credential[field]))) return { ...base, balance: null, error: "账号凭据缺少令牌，请在提供方重新登录" };
			// Trae 的额度接口只有中国版网关；非 CN 账号发过去只会得到无效请求。
			if (channel === "trae" && text(credential.region).toUpperCase() !== "CN") return { ...base, balance: null, error: "只支持 Trae 中国版账号" };
			for (const [field, label] of REQUIRED_FIELDS[channel] ?? []) {
				if (!text(credential[field])) return { ...base, balance: null, error: `账号凭据缺少${label}，请在提供方重新登录` };
			}
			// 过期就照实说，绝不在这里刷新：刷新权属于提供方，抢过来会让对方 token 失效。
			const expiresAt = expiryOf(credential);
			if (expiresAt !== undefined && expiresAt <= this.now()) return { ...base, balance: null, error: "登录态已过期，请在提供方重新登录（本插件不会替你续期）" };
			if (text(credential.nickname)) base.nickname = text(credential.nickname);
			const balance = await this.request(channel, credential);
			// 企业版是「按设计没有数字」，要如实说；形状变化/业务失败是「这次没读到」，交给别的来源。
			if (balance === NO_NUMBER) return { ...base, balance: null, reachable: true, error: "该账号为企业版，上游不下发额度数字" };
			if (balance === undefined) return { ...base, balance: null, error: "额度接口没有返回可读数字" };
			return { ...base, balance };
		} catch (error) {
			return { ...base, balance: null, error: error instanceof Error && error.message ? error.message : "额度读取失败" };
		}
	}
	async request(channel, credential) {
		const endpoint = ENDPOINTS[channel];
		const fetchImpl = this.fetchImpl ?? globalThis.fetch;
		if (typeof fetchImpl !== "function") throw new Error("当前环境没有可用的 fetch");
		// 与插件的其它读取器同口径：卸载/超时都能取消，别让一个已经没人等的请求继续挂着。
		const timeout = AbortSignal.timeout(this.timeoutMs);
		const cancel = typeof this.signal === "function" ? this.signal() : undefined;
		const signal = cancel ? AbortSignal.any([timeout, cancel]) : timeout;
		const init = { method: endpoint.method ?? "GET", headers: endpoint.headers(credential), signal };
		if (typeof endpoint.body === "function") init.body = JSON.stringify(endpoint.body(credential));
		const response = await fetchImpl(endpoint.url, init);
		if (!response.ok) throw new Error(`${LOCAL_CHANNELS[channel]} 额度接口返回 HTTP ${response.status}`);
		const body = await response.json();
		const balance = PARSERS[channel](body);
		if (balance === NO_NUMBER) return NO_NUMBER;
		// 401/业务码失败与「返回了但没有数字」要分开：前者说明凭据失效，后者说明上游形状变了。
		// 各家成功码都是 0，但类型不同（数值 0 / 字符串 "0" / 讯飞的 "000000"）：统一按数值归一，
		// 否则字符串码会被当成拒绝，整条渠道静默回退。
		const code = body?.code;
		const failed = code !== undefined && code !== null && Number(code) !== 0;
		if (balance === undefined && object(body) && failed) throw new Error(`${LOCAL_CHANNELS[channel]} 拒绝查询（code ${code}），请检查登录状态`);
		return balance;
	}
	dispose() { this.disposed = true; this.cache.clear(); this.pending.clear(); this.versions.clear(); }
}
