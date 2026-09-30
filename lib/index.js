// dsh-subusage —— 订阅用量显示（Host 侧）
//
// 为 llm-pi-ai 的三家订阅模型商拉取额度用量，归一成统一契约供 client 药丸/设置页渲染：
//   zai-coding-cn        → open.bigmodel.cn 配额接口（Bearer key，个人套餐 type=1 免 org/project）
//   kimi-coding          → api.kimi.com/coding/v1/usages（Bearer sk-kimi-…）
//   xiaomi-token-plan-cn → platform.xiaomimimo.com 控制台接口（Cookie 会话；无 Cookie 时由
//                          client 侧 webview 桥接管，见 client.js 的 MimoBridge）
//
// Key 解析顺序（继承 llm-pi-ai 的 apiKeyEnv 约定）：设置页手动 key → credentials 服务 →
// 启动环境变量（ZAI_CODING_CN_API_KEY / KIMI_CODING_API_KEY / XIAOMI_TOKEN_PLAN_CN_API_KEY）。
// 配置持久化在 ~/.dsh/dsh-subusage.json（设置页经 subUsage.save 写入）。

import { RemoteError, TypertRemoteService } from "@deepseek-ai/dsh-typert-protocol";
import { credentialRef } from "@deepseek-ai/dsh-credentials";
import { launchEnvironmentOf } from "@deepseek-ai/dsh-launch-environment";
import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

const name = "dsh-subusage";
/** llm 服务用于检测已配置的模型商（listProviders）。 */
const inject = ["llm"];

const PROVIDERS = {
	"zai-coding-cn": { label: "Z.ai", envName: "ZAI_CODING_CN_API_KEY" },
	"kimi-coding": { label: "Kimi", envName: "KIMI_CODING_API_KEY" },
	"xiaomi-token-plan-cn": { label: "MiMo", envName: "XIAOMI_TOKEN_PLAN_CN_API_KEY" },
	"opencode-go": { label: "OpenCode Go", envName: "OPENCODE_API_KEY" }
};
/** OpenCode Go 用量端点（与 dsh-opencode-go 的 DEFAULT_BASE_URL 一致）。 */
const OPENCODE_GO_BASE_URL = "https://opencode.ai/zen/go/v1";

const CONFIG_PATH = join(homedir(), ".dsh", "dsh-subusage.json");
const MAX_BYTES = 1024 * 1024;
const TIMEOUT_MS = 10000;

// ── 设置持久化 ────────────────────────────────────────────────────────────────

function defaultSettings() {
	return { zai: { type: 1, organization: "", project: "" }, xiaomi: { cookie: "" }, keys: {} };
}

function parseSettings(value) {
	if (!value || typeof value !== "object") throw new Error("Invalid dsh-subusage settings");
	const s = defaultSettings();
	if (value.zai && typeof value.zai === "object") {
		const type = value.zai.type === 2 ? 2 : 1;
		s.zai = {
			type,
			organization: typeof value.zai.organization === "string" ? value.zai.organization : "",
			project: typeof value.zai.project === "string" ? value.zai.project : ""
		};
	}
	if (value.xiaomi && typeof value.xiaomi === "object" && typeof value.xiaomi.cookie === "string") {
		s.xiaomi = { cookie: value.xiaomi.cookie };
	}
	if (value.keys && typeof value.keys === "object") {
		for (const id of Object.keys(PROVIDERS)) {
			if (typeof value.keys[id] === "string") s.keys[id] = value.keys[id];
		}
	}
	return s;
}

function loadSettings() {
	try {
		return parseSettings(JSON.parse(readFileSync(CONFIG_PATH, "utf8")));
	} catch {
		return defaultSettings();
	}
}

function saveSettings(settings) {
	const s = parseSettings(settings);
	mkdirSync(dirname(CONFIG_PATH), { recursive: true });
	const tmp = `${CONFIG_PATH}.tmp`;
	writeFileSync(tmp, JSON.stringify(s, null, 2), "utf8");
	renameSync(tmp, CONFIG_PATH);
	return s;
}

// ── key 解析（继承环境优先，手动填写兜底）────────────────────────────────────

async function resolveKey(ctx, providerId) {
	const meta = PROVIDERS[providerId];
	const credentials = ctx.get("credentials");
	const hit = credentials !== void 0 ? (await credentials.resolve(credentialRef(meta.envName)))?.value : void 0;
	if (hit !== void 0 && hit.length > 0) return { key: hit, source: "env" };
	const env = launchEnvironmentOf(ctx).get(meta.envName)?.value;
	if (env !== void 0 && env.length > 0) return { key: env, source: "env" };
	const manual = loadSettings().keys[providerId];
	if (manual !== void 0 && manual.length > 0) return { key: manual, source: "manual" };
	return { key: void 0, source: "none" };
}

// ── 取数基础设施 ──────────────────────────────────────────────────────────────

async function fetchJson(url, headers) {
	const response = await fetch(url, {
		headers: { accept: "application/json", "user-agent": "dsh-subusage/0.1 (DeepSeek Harness)", ...headers },
		signal: AbortSignal.timeout(TIMEOUT_MS),
		redirect: "manual"
	});
	if (response.status >= 300 && response.status < 400) {
		throw new RemoteError("subusage/login-required", `登录已过期（HTTP ${response.status}）`, {
			retryable: false,
			retainPrevious: true
		});
	}
	if (!response.ok) {
		const temporary = response.status === 408 || response.status === 429 || response.status >= 500;
		throw new RemoteError("subusage/unavailable", `HTTP ${response.status}`, {
			retryable: temporary,
			retainPrevious: temporary
		});
	}
	const text = await response.text();
	if (text.length > MAX_BYTES) throw new RemoteError("subusage/unavailable", "响应超过 1MiB", { retryable: false, retainPrevious: false });
	try {
		return JSON.parse(text);
	} catch {
		throw new RemoteError("subusage/unavailable", "响应不是合法 JSON", { retryable: false, retainPrevious: false });
	}
}

function windowRow(kind, percent, resetsAt, status, detail) {
	const p = Math.max(0, Math.round(Number(percent) || 0));
	return {
		kind,
		percent: p,
		resetsAt: typeof resetsAt === "string" && Number.isFinite(Date.parse(resetsAt)) ? resetsAt : void 0,
		status: status === "rate-limited" || p >= 100 ? "rate-limited" : "ok",
		...(detail && typeof detail === "object" ? { detail } : {})
	};
}

// 限额层级连坐（递归 🔴 判定）：外层窗口（月度/周期/周/7 天）用尽时，
// 内层窗口（5 小时）即便显示 0% 也不可用，逐级向下标记 rate-limited。
const WINDOW_SCOPE_RANK = { month: 0, sub: 0, period: 0, week: 1, "7d": 1, "5h": 2, rolling: 2 };
function cascadeRateLimited(windows) {
	const rankOf = (w) => WINDOW_SCOPE_RANK[w.kind] ?? 3;
	let outerLimited = false;
	for (const w of [...windows].sort((a, b) => rankOf(a) - rankOf(b))) {
		if (outerLimited && w.status !== "rate-limited") {
			w.status = "rate-limited";
			w.cascade = true;
		}
		if (w.status === "rate-limited") outerLimited = true;
	}
	return windows;
}

function entryOk(providerId, windows, extras, keySource) {
	return {
		providerId,
		label: PROVIDERS[providerId].label,
		state: "ok",
		windows,
		extras: extras ?? [],
		keySource,
		envName: PROVIDERS[providerId].envName
	};
}

function entryFail(providerId, state, error, keySource) {
	return { providerId, label: PROVIDERS[providerId].label, state, error, keySource, envName: PROVIDERS[providerId].envName };
}

// ── 三家归一化 ────────────────────────────────────────────────────────────────

// Kimi：usages.limit_5h / limit_7d 为 0–1 浮点 used_ratio + ISO reset_time。
export function normalizeKimi(body) {
	const u = body && typeof body === "object" ? body.usages : void 0;
	if (!u || typeof u !== "object" || !u.limit_5h || !u.limit_7d) throw new Error("Invalid Kimi usage response");
	const windows = [
		windowRow("5h", (Number(u.limit_5h.used_ratio) || 0) * 100, u.limit_5h.reset_time),
		windowRow("7d", (Number(u.limit_7d.used_ratio) || 0) * 100, u.limit_7d.reset_time)
	];
	return cascadeRateLimited(windows);
}

// Z.ai：data.limits[]，CREDIT_LIMIT 且 unit 3 number 5 = 5h 窗、unit 6 = 周窗；
// percentage 即已用百分比，nextResetTime 为 epoch ms。data.level 为套餐档。
export function normalizeZai(body) {
	const data = body && typeof body === "object" ? body.data : void 0;
	if (!data || !Array.isArray(data.limits)) throw new Error("Invalid Z.ai usage response");
	const windows = [];
	for (const l of data.limits) {
		if (!l || l.type !== "CREDIT_LIMIT") continue;
		const detail = typeof l.currentValue === "number" && typeof l.usage === "number" ? { used: l.currentValue, limit: l.usage } : void 0;
		if (l.unit === 3) windows.push(windowRow("5h", l.percentage, l.nextResetTime ? new Date(l.nextResetTime).toISOString() : void 0, void 0, detail));
		else if (l.unit === 6) windows.push(windowRow("week", l.percentage, l.nextResetTime ? new Date(l.nextResetTime).toISOString() : void 0, void 0, detail));
	}
	if (windows.length === 0) throw new Error("Z.ai response carries no coding-plan windows");
	windows.sort((a, b) => (a.kind === "5h" ? -1 : 1));
	cascadeRateLimited(windows);
	return { windows, level: typeof data.level === "string" ? data.level : void 0 };
}

// 小米：balance + tokenPlan/detail + tokenPlan/usage 三份响应合成。
// 注意：usage/monthUsage 的 percent 是 0–1 小数（0.4744 = 47.44%），需 ×100。
// period 窗 = 订阅周期（plan_total_token，重置于 currentPeriodEnd）；month 窗 = 当月。
function pct100(v) {
	return Math.max(0, Math.round((Number(v) || 0) * 100));
}
export function normalizeMimo(balBody, detailBody, usageBody) {
	const bal = balBody && balBody.data;
	if (!bal || typeof bal.balance !== "string") throw new Error("Invalid MiMo balance response");
	const data = usageBody && usageBody.data ? usageBody.data : {};
	const pick = (group, name) => group && Array.isArray(group.items)
		? (group.items.find((i) => i && i.name === name) ?? group.items[0])
		: void 0;
	const planItem = pick(data.usage, "plan_total_token");
	const monthItem = pick(data.monthUsage, "month_total_token");
	const detail = detailBody && detailBody.data ? detailBody.data : {};
	// 小米是月度额度池：周期一个月，重置于下月（detail.currentPeriodEnd）。
	// 只出一个「订阅用量」窗口 + 已用/总计 Credits 明细。
	const resetAt = typeof detail.currentPeriodEnd === "string" ? detail.currentPeriodEnd : void 0;
	const pool = planItem ?? monthItem;
	const windows = pool ? [windowRow("sub", pct100(pool.percent), resetAt, void 0, { used: pool.used, limit: pool.limit })] : [];
	const extras = [{ kind: "balance", value: `${bal.balance} ${bal.currency}` }];
	const planName = typeof detail.planName === "string" && detail.planName.length > 0
		? detail.planName
		: (typeof detail.planCode === "string" ? detail.planCode : void 0);
	if (planName) extras.push({ kind: "plan", value: planName });
	return { windows: cascadeRateLimited(windows), extras, balanceOk: true };
}

// ── 各 provider 读取 ─────────────────────────────────────────────────────────

async function readZai(ctx) {
	const id = "zai-coding-cn";
	const { key, source } = await resolveKey(ctx, id);
	if (key === void 0) return entryFail(id, "no-key", "未配置 API Key", "none");
	try {
		const settings = loadSettings();
		const headers = { authorization: `Bearer ${key}` };
		if (settings.zai.type === 2) {
			if (settings.zai.organization) headers["bigmodel-organization"] = settings.zai.organization;
			if (settings.zai.project) headers["bigmodel-project"] = settings.zai.project;
		}
		const body = await fetchJson(`https://open.bigmodel.cn/api/monitor/usage/quota/limit?type=${settings.zai.type}`, headers);
		const { windows, level } = normalizeZai(body);
		const extras = level ? [{ kind: "plan", value: level }] : [];
		return entryOk(id, windows, extras, source);
	} catch (error) {
		return entryFail(id, "error", error instanceof Error ? error.message : String(error), source);
	}
}

async function readKimi(ctx) {
	const id = "kimi-coding";
	const { key, source } = await resolveKey(ctx, id);
	if (key === void 0) return entryFail(id, "no-key", "未配置 API Key", "none");
	try {
		const headers = { authorization: `Bearer ${key}` };
		const [body, me] = await Promise.all([
			fetchJson("https://api.kimi.com/coding/v1/usages", headers),
			fetchJson("https://api.kimi.com/coding/v1/me", headers).catch(() => void 0)
		]);
		// /me 的 user_level_name 为套餐档名（Andante / Moderato / Allegretto / Allegro）
		const plan = me && typeof me.user_level_name === "string" && me.user_level_name.length > 0 ? me.user_level_name : void 0;
		const extras = plan ? [{ kind: "plan", value: plan }] : [];
		return entryOk(id, normalizeKimi(body), extras, source);
	} catch (error) {
		return entryFail(id, "error", error instanceof Error ? error.message : String(error), source);
	}
}

// 小米：仅当手动 Cookie 存在时由 Host 直连；否则返回 no-cookie，由 client 的 webview 桥填充。
async function readMimo(ctx) {
	const id = "xiaomi-token-plan-cn";
	const settings = loadSettings();
	const cookie = settings.xiaomi.cookie.trim();
	if (cookie.length === 0) return entryFail(id, "no-cookie", "需登录或粘贴 Cookie", "cookie");
	try {
		const base = "https://platform.xiaomimimo.com/api/v1";
		const headers = {
			cookie,
			origin: "https://platform.xiaomimimo.com",
			referer: "https://platform.xiaomimimo.com/#/console/balance",
			"accept-language": "zh-CN,zh;q=0.9",
			"x-timezone": "UTC+08:00"
		};
		const [bal, detail, usage] = await Promise.all([
			fetchJson(`${base}/balance`, headers),
			fetchJson(`${base}/tokenPlan/detail`, headers).catch(() => void 0),
			fetchJson(`${base}/tokenPlan/usage`, headers).catch(() => void 0)
		]);
		const { windows, extras } = normalizeMimo(bal, detail ?? {}, usage ?? {});
		return entryOk(id, windows, extras, "cookie");
	} catch (error) {
		return entryFail(id, "error", error instanceof Error ? error.message : String(error), "cookie");
	}
}

// OpenCode Go：GET {base}/usage（Bearer OPENCODE_API_KEY）。
// 响应为 { usage: { rolling, weekly, monthly } }（percent 为 0–100，resetsAt 为 ISO 串）；
// 兼容三窗直接在顶层的形态。source 可选（套餐来源）。
export function normalizeOpencodeGo(body) {
	if (!body || typeof body !== "object") throw new Error("Invalid OpenCode Go usage response");
	const src = body.usage && typeof body.usage === "object" ? body.usage : body;
	const MAP = { rolling: "rolling", weekly: "week", monthly: "month" };
	const windows = [];
	for (const [key, kind] of Object.entries(MAP)) {
		const row = src[key];
		if (!row || typeof row.percent !== "number") continue;
		windows.push(windowRow(kind, row.percent, row.resetsAt, row.status === "rate-limited" ? "rate-limited" : void 0));
	}
	if (windows.length === 0) throw new Error("OpenCode Go response carries no usage windows");
	cascadeRateLimited(windows);
	const extras = typeof src.source === "string" && src.source.length > 0
		? [{ kind: "plan", value: src.source }]
		: (typeof body.source === "string" && body.source.length > 0 ? [{ kind: "plan", value: body.source }] : []);
	return { windows, extras };
}

async function readOpencodeGo(ctx) {
	const id = "opencode-go";
	const { key, source } = await resolveKey(ctx, id);
	if (key === void 0) return entryFail(id, "no-key", "未配置 API Key", "none");
	try {
		const body = await fetchJson(`${OPENCODE_GO_BASE_URL}/usage`, { authorization: `Bearer ${key}` });
		const { windows, extras } = normalizeOpencodeGo(body);
		return entryOk(id, windows, extras, source);
	} catch (error) {
		return entryFail(id, "error", error instanceof Error ? error.message : String(error), source);
	}
}

// ── Remote 契约 ──────────────────────────────────────────────────────────────

function parseEntry(value) {
	if (!value || typeof value !== "object" || typeof value.providerId !== "string" || typeof value.state !== "string") {
		throw new Error("Invalid dsh-subusage entry");
	}
	return value;
}

function parseResult(value) {
	if (!value || typeof value !== "object" || !Array.isArray(value.entries)) throw new Error("Invalid dsh-subusage result");
	for (const e of value.entries) parseEntry(e);
	return value;
}

const resultCodec = {
	mode: "strict",
	typeSymbol: "dsh-subusage#SubUsageResult",
	schema: { parse: parseResult },
	create: () => ({ parse: parseResult })
};

const settingsCodec = {
	mode: "strict",
	typeSymbol: "dsh-subusage#SubUsageSettings",
	schema: { parse: parseSettings },
	create: () => ({ parse: parseSettings })
};

export const subUsageRemote = {
	package: "dsh-subusage",
	descriptors: [
		{
			id: "dsh-subusage#subUsage/read",
			service: "subUsage",
			namespace: "subUsage",
			method: "read",
			invocation: { kind: "direct" },
			parameters: [],
			result: resultCodec
		},
		{
			id: "dsh-subusage#subUsage/save",
			service: "subUsage",
			namespace: "subUsage",
			method: "save",
			invocation: { kind: "direct" },
			parameters: [{
				name: "settings",
				wire: "settings",
				source: "json",
				codec: settingsCodec
			}],
			result: resultCodec
		}
	]
};

/** 检测 llm 侧已注册的 provider（即 llm-pi-ai 配置了路由的模型商），用于设置页自动勾选。 */
function detectConfigured(ctx) {
	try {
		const ids = new Set(ctx.llm.listProviders().map((p) => p.id));
		return Object.fromEntries(Object.keys(PROVIDERS).map((id) => [id, ids.has(id)]));
	} catch {
		return Object.fromEntries(Object.keys(PROVIDERS).map((id) => [id, false]));
	}
}

class SubUsageService extends TypertRemoteService {
	constructor(ctx) {
		super(ctx, "subUsage");
		this.ctx = ctx;
	}
	async read() {
		const entries = await Promise.all([readZai(this.ctx), readKimi(this.ctx), readMimo(this.ctx), readOpencodeGo(this.ctx)]);
		return { updatedAt: new Date().toISOString(), settings: loadSettings(), configured: detectConfigured(this.ctx), entries };
	}
	async save(settings) {
		saveSettings(settings);
		return this.read();
	}
}

function registerRemotes(ctx) {
	ctx.inject(["typert"], (scope) => {
		scope.effect(() => scope.typert.register({
			package: subUsageRemote.package,
			face: "host",
			schemas: [],
			model: { services: [], events: [], objects: [] },
			invocations: subUsageRemote.descriptors
		}));
	});
}

function apply(ctx) {
	registerRemotes(ctx);
	ctx.plugin(SubUsageService, {});
	ctx.logger.info("dsh-subusage: providers zai-coding-cn / kimi-coding / xiaomi-token-plan-cn usage service ready");
}

export { apply, inject, name };
export default { name, inject, apply };
