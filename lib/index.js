// dsh-subusage Host：秘密仅保存在 Host，远端只暴露 provider 补丁和公开设置。
import { RemoteError, TypertRemoteService } from "@deepseek-ai/dsh-typert-protocol";
import { defineTool } from "@deepseek-ai/dsh-tools";
import { credentialRef, isCredentialRefName } from "@deepseek-ai/dsh-credentials";
import { launchEnvironmentOf } from "@deepseek-ai/dsh-launch-environment";
import { chmodSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { MimoLogin } from "./mimo-login.js";
import { parseVolcAgentPlan, parseVolcCodingPlan, parseVolcSeatAfp, parseVolcSeatCoding, parseVolcSeatIds, volcError, volcSignature } from "./volcengine.js";

const name = "dsh-subusage";
const inject = ["llm"];
const PROVIDERS = {
 "zai-coding-cn": { label: "Z.ai", envName: "ZAI_CODING_CN_API_KEY" },
 "zai-coding": { label: "Z.ai International", envName: "ZAI_CODING_API_KEY", defaultEnabled: false },
 "synthetic": { label: "Synthetic", envName: "SYNTHETIC_API_KEY", defaultEnabled: false },
 "nanogpt": { label: "NanoGPT", envName: "NANOGPT_API_KEY", defaultEnabled: false },
 "kimi-coding": { label: "Kimi", envName: "KIMI_CODING_API_KEY" },
 "xiaomi-token-plan-cn": { label: "MiMo", envName: "XIAOMI_TOKEN_PLAN_CN_API_KEY" },
 "opencode-go": { label: "OpenCode Go", envName: "OPENCODE_API_KEY" },
 // MiniMax 国际版默认关闭（中国版保持默认开启）。
 "minimax": { label: "MiniMax", envName: "MINIMAX_API_KEY", usageUrl: "https://api.minimax.io/v1/token_plan/remains", defaultEnabled: false },
 "minimax-cn": { label: "MiniMax CN", envName: "MINIMAX_CN_API_KEY", usageUrl: "https://api.minimaxi.com/v1/token_plan/remains" },
 // SiliconFlow（硅基流动）：余额型接口，鉴权与推理是**同一把** API Key（Bearer）。
 // 官方 OpenAPI 仓库 siliconflow/siliconcloud 的 openapi.yaml 列出 GET /v1/user/info（bearerAuth）。
 "siliconflow": { label: "SiliconFlow", envName: "SILICONFLOW_API_KEY", defaultEnabled: false },
 // Commandcode 路由由另一个插件（@mars-sea/dsh-commandcode-provider）注册：凭据、多账户与
 // API 地址都在那边管理。本插件不保存其凭据，只沿用同一凭据来源链自取 Key 后直连计费接口。
 "commandcode": { label: "Command Code", envName: "COMMANDCODE_API_KEY", managedByPlugin: true },
 // SuperGrok / X Premium 订阅路由由 dsh-grok-kit（xai-oauth）注册，登录是 OAuth：凭据只认
 // 与 Grok CLI 共享的登录文件，API Key（XAI_API_KEY）路线取不到订阅周池，故不设继承变量。
 "xai-oauth": { label: "SuperGrok", envName: "", managedByPlugin: true },
 // OpenAI Codex / ChatGPT 订阅：路由由 DSH 内置的 openai-codex（或 dsh-codex-connect 等插件）提供，
 // 额度凭据只认 Codex CLI 的 OAuth 登录文件，不提供本地凭据编辑。
 // 默认关闭：Codex 的提供方插件自己就带用量药丸，两个药丸并排只是重复信息（仍可手动开启）。
 "openai-codex": { label: "Codex (ChatGPT)", envName: "", managedByPlugin: true, defaultEnabled: false },
 // 火山方舟：方舟路由由两种方式写入——官方 CLI（arkcli helper，见下）或官方插件
 // @volcengine/ark-plan-api（legacy 段）。**provider id 必须与写入方逐字一致**，
 // 否则选中方舟模型时药丸不会出现。额度读取走管控面 OpenAPI，凭据是 IAM 的 AK/SK 配对
 // （HMAC-SHA256 签名），与这些路由的推理 API Key 是两套：拿推理 Key 去查额度会被上游拒绝
 // （"GetAFPUsage requires Volcengine Ark SSO STS"）。
 // 7 条 volc 路由共用一组 AK/SK（settings.volc）：个人版各自固定一个 Action，
 // 企业版/团队版走 ListSeatInfos → GetSeatAFPUsage / GetSeatInfoUsage 两步。
 // ── arkcli（官方 CLI）安装的路由 ──────────────────────────────────────────
 // 官方 CLI 的 `arkcli helper configure deepseek-harness` 把 provider 写成
 // `arkcli-<planType>`（本机实测：`arkcli-agent-plan`），凭据引用是
 // `ARKCLI_<PLAN>_API_KEY`。这是目前使用人数最多的安装方式，故默认开启
 // （没配 AK/SK 时会被「没有检测到 API 的默认隐藏」收起）。
 // 注意：路由（数据面，模型访问）与额度查询（管控面，需 IAM AK/SK）是两码事。
 "arkcli-agent-plan": { label: "ARK Agent Plan (arkcli)", envName: "ARKCLI_AGENT_PLAN_API_KEY", credentialKind: "volc", volcAction: "GetAFPUsage", volcHost: "open.volcengineapi.com", volcRegion: "cn-beijing" },
 "arkcli-coding-plan": { label: "ARK Coding Plan (arkcli)", envName: "ARKCLI_CODING_PLAN_API_KEY", credentialKind: "volc", volcAction: "GetCodingPlanUsage", volcHost: "open.volcengineapi.com", volcRegion: "cn-beijing" },
 // 企业版/团队版：额度挂在席位上，先 ListSeatInfos 取 SeatID 再查该席位（volcSeat 决定用哪对 Action）。
 "arkcli-agent-plan-team": { label: "ARK Agent Plan Team (arkcli)", envName: "ARKCLI_AGENT_PLAN_TEAM_API_KEY", credentialKind: "volc", volcSeat: "agent", volcScene: "agent_plan_enterprise", volcHost: "open.volcengineapi.com", volcRegion: "cn-beijing", defaultEnabled: false },
 "arkcli-coding-plan-team": { label: "ARK Coding Plan Team (arkcli)", envName: "ARKCLI_CODING_PLAN_TEAM_API_KEY", credentialKind: "volc", volcSeat: "coding", volcScene: "coding_plan_enterprise", volcHost: "open.volcengineapi.com", volcRegion: "cn-beijing", defaultEnabled: false },
 // ── 旧插件 @volcengine/ark-plan-api 注册的路由（保留兼容）─────────────────
 // 两条路线的 provider id 不同，故并存；装旧插件的用户仍会走这几条。
 "ark-coding-plan-cn": { label: "Ark Coding Plan (CN, legacy plugin)", envName: "ARK_CODING_PLAN_CN_API_KEY", credentialKind: "volc", volcAction: "GetCodingPlanUsage", volcHost: "open.volcengineapi.com", volcRegion: "cn-beijing", defaultEnabled: false },
 "ark-agent-plan-cn": { label: "Ark Agent Plan (CN, legacy plugin)", envName: "ARK_AGENT_PLAN_CN_API_KEY", credentialKind: "volc", volcAction: "GetAFPUsage", volcHost: "open.volcengineapi.com", volcRegion: "cn-beijing", defaultEnabled: false },
 // BytePlus（海外）Coding Plan：同一套 AK/SK，但走 BytePlus 管控面与 ap-southeast-1 区域。
 "ark-coding-plan-byteplus": { label: "Ark Coding Plan (BytePlus, legacy plugin)", envName: "ARK_CODING_PLAN_BYTEPLUS_API_KEY", credentialKind: "volc", volcAction: "GetCodingPlanUsage", volcHost: "ark.ap-southeast-1.byteplusapi.com", volcRegion: "ap-southeast-1", defaultEnabled: false },
 // DeepSeek 官方：余额型（不是订阅窗口），与推理**同一把** API Key，端点与响应见官方文档
 // https://api-docs.deepseek.com/zh-cn/api/get-user-balance
 "deepseek": { label: "DeepSeek", envName: "DEEPSEEK_API_KEY" },
 // OpenRouter：key 限额与用量走 /key（任意 key 可用），账户余额走 /credits（**只对
 // management / provisioning key 开放**，普通推理 key 会被拒 → 静默降级为只显示限额）。
 "openrouter": { label: "OpenRouter", envName: "OPENROUTER_API_KEY", defaultEnabled: false },
 // 以下六家都是**余额型**（单体 GET + 一个余额数字），与推理**同一把** Key；默认关闭，
 // 没配 Key 时由「没有检测到 API 的默认隐藏」收起。
 "novita": { label: "Novita AI", envName: "NOVITA_API_KEY", defaultEnabled: false },
 "hyperbolic": { label: "Hyperbolic", envName: "HYPERBOLIC_API_KEY", defaultEnabled: false },
 "deepinfra": { label: "DeepInfra", envName: "DEEPINFRA_API_KEY", defaultEnabled: false },
 "chutes": { label: "Chutes", envName: "CHUTES_API_KEY", defaultEnabled: false },
 // Ollama Cloud 的鉴权是**裸 Authorization**（不加 Bearer），照抄别家实现时必须注意。
 "ollama-cloud": { label: "Ollama Cloud", envName: "OLLAMA_API_KEY", defaultEnabled: false },
 "vercel-ai-gateway": { label: "Vercel AI Gateway", envName: "AI_GATEWAY_API_KEY", defaultEnabled: false },
 // ZenMux 的额度端点只认 Management API Key；变量名单独区分以免误填推理 key。
 "zenmux": { label: "ZenMux", envName: "ZENMUX_MANAGEMENT_API_KEY", defaultEnabled: false },
 // LiteLLM 是自建网关：除虚拟 Key 外还要配自己的 proxy 地址（settings.litellm.baseUrl）。
 "litellm": { label: "LiteLLM", envName: "LITELLM_API_KEY", defaultEnabled: false }
};
const IDS = Object.keys(PROVIDERS);
// 火山方舟的路由共用同一组 IAM AK/SK，而一般用户只持有一个套餐；设置页把它们合并成一张卡片，
// 用一个组级开关控制整组。这些 id 仍各自存在——药丸要靠 provider id 匹配路由，不能合并。
const ARK_IDS = IDS.filter(id => PROVIDERS[id].credentialKind === "volc");
const ARK_DEFAULT_ON = ARK_IDS.some(id => PROVIDERS[id].defaultEnabled !== false);
/**
 * 某条路由当前是否启用。Ark 以**组开关为唯一真源**——7 条路由共用一组 IAM AK/SK、一般用户只
 * 持有一个套餐，所以设置页只给一个开关。这里必须与 Client 的 `providerEnabled` 同语义：
 * 两端口径一旦分叉，界面按组开关显示这条路由，Host 却按逐条值回 `disabled`，
 * 用户拿到的就是一张写着「检测已关闭」的空卡片（这正是 Coding Plan 查不到用量的原因）。
 */
function providerEnabled(settings, id) {
	if (PROVIDERS[id]?.credentialKind === "volc" && typeof settings?.visibility?.ark === "boolean") return settings.visibility.ark;
	return !!settings?.visibility?.providers?.[id];
}
/**
 * 调用方（尤其是模型）手里的「提供商名」通常**不是**本插件的 provider id。模型能看到的往往是
 * DSH 的 llm 路由名或厂商品牌名（`zai`、`grok`、`codex`、`ark`），而这里的 id 是路由 id
 * （`zai-coding-cn`、`xai-oauth`、`openai-codex`…）。只做精确匹配时，`["zai"]` 会被整批过滤掉，
 * 工具返回空列表——看上去像「本机什么都没配」，真正的原因却只是名字没对上。
 * 所以先按别名收敛；一个别名指向多条路由时（`zai` 同时是中国版与国际版）不猜，交给调用方看结果。
 */
const PROVIDER_ALIASES = {
	zai: ["zai-coding-cn", "zai-coding"], "z.ai": ["zai-coding-cn", "zai-coding"], "z-ai": ["zai-coding-cn", "zai-coding"],
	zhipu: ["zai-coding-cn", "zai-coding"], glm: ["zai-coding-cn", "zai-coding"], "智谱": ["zai-coding-cn", "zai-coding"],
	kimi: ["kimi-coding"], moonshot: ["kimi-coding"], "月之暗面": ["kimi-coding"],
	mimo: ["xiaomi-token-plan-cn"], xiaomi: ["xiaomi-token-plan-cn"], "小米": ["xiaomi-token-plan-cn"],
	minimax: ["minimax-cn", "minimax"], "海螺": ["minimax-cn", "minimax"],
	commandcode: ["commandcode"], "command-code": ["commandcode"], "command code": ["commandcode"],
	supergrok: ["xai-oauth"], grok: ["xai-oauth"], xai: ["xai-oauth"],
	codex: ["openai-codex"], chatgpt: ["openai-codex"], gpt: ["openai-codex"], openai: ["openai-codex"],
	ark: ARK_IDS, volcengine: ARK_IDS, volc: ARK_IDS, "火山": ARK_IDS, "方舟": ARK_IDS, "火山方舟": ARK_IDS, doubao: ARK_IDS, "豆包": ARK_IDS
};
/** 查表用的键：大小写与分隔符都无关，`Z.AI` / `zai_coding_cn` / `zai-coding-cn` 视为同一个词。 */
function normalizeProviderKey(value) { return String(value ?? "").trim().toLowerCase().replace(/[\s._-]+/g, ""); }
/**
 * 归一化索引：id 与别名都进同一张表，因此「精确 id」只是这张表的一个特例。
 * 一个键可以指向多条路由（`zai` → 中国版 + 国际版，`ark` → 7 条）。
 */
const PROVIDER_LOOKUP = (() => {
	const map = new Map();
	const add = (key, id) => {
		const k = normalizeProviderKey(key);
		if (!k) return;
		const list = map.get(k) ?? [];
		if (!list.includes(id)) list.push(id);
		map.set(k, list);
	};
	for (const id of IDS) add(id, id);
	for (const [alias, ids] of Object.entries(PROVIDER_ALIASES)) for (const id of ids) if (IDS.includes(id)) add(alias, id);
	return map;
})();
/**
 * 把调用方给的任意写法收敛成 provider id，**纯名字解析、不查任何外部状态**。
 * 两条硬约定：
 * 1. 认不出的原串**原样返回**而不是丢掉——调用方要能拿到「这个名字不认识，可用的是……」才能
 *    自我纠正；静默过滤只会让它以为本机没有额度。
 * 2. 一个名字命中多条路由时**全部返回**，各自带着真实状态（没启用的会如实标 disabled）。
 *    例如 `zai` 同时是中国版与国际版、`ark` 是 7 条路由：宁可多给几条数据让调用方自己判断，
 *    也不替它猜一条，更不能返回空。
 * @param requested 调用方给的原始名字列表。
 */
function resolveProviderIds(requested) {
	const hit = new Set(), unknown = [];
	for (const raw of requested) {
		const name = String(raw ?? "").trim();
		if (!name) continue;
		const ids = PROVIDER_LOOKUP.get(normalizeProviderKey(name));
		if (!ids) { if (!unknown.includes(name)) unknown.push(name); continue; }
		for (const id of ids) hit.add(id);
	}
	// 按登记顺序返回：命中多条时（例如 `ark`）读起来和设置页一致，而不是跟着调用方的输入顺序抖动。
	return { ids: IDS.filter(id => hit.has(id)), unknown };
}
// 火山方舟额度接口的凭据是 IAM Access Key：AK 与 SK 必须同源配对，跨来源拼接只会得到 401。
// 变量名沿用火山官方 SDK 习惯；与方舟推理 Key（ARK_*_API_KEY）无关。
const VOLC_ACCESS_KEY_ENV = "VOLC_ACCESSKEY";
const VOLC_SECRET_KEY_ENV = "VOLC_SECRETKEY";
// 与 @mars-sea/dsh-commandcode-provider 一致的 CLI 版本标识（其常量 COMMAND_CODE_CLI_VERSION）。
const COMMAND_CODE_CLI_VERSION = "1.73.0";
const COMMAND_CODE_API_BASE = "https://api.commandcode.ai";
const COMMAND_CODE_AUTH_FILE = join(homedir(), ".commandcode", "auth.json");
// 月总额快照与提供方插件 KNOWN_SUBSCRIPTION_PLANS 对齐（而非月剩余余额）。
// 来源：https://github.com/Mars-Sea/dsh-commandcode-provider/blob/main/src/capabilities.ts
const COMMAND_CODE_MONTHLY_CAPS = { "individual-go": 10, "individual-go-v1": 10, "individual-goat": 70, "individual-pro": 30, "individual-pro-v1": 80, "individual-provider": 15, "individual-max": 150, "individual-ultra": 300, "teams-pro": 40 };
function commandCodeMonthlyCap(planId) {
 const normalized = planId.toLowerCase().replace(/_/g, "-");
 const prefix = Object.keys(COMMAND_CODE_MONTHLY_CAPS).sort((a, b) => b.length - a.length).find(key => normalized === key || normalized.startsWith(`${key}-`));
 return prefix ? COMMAND_CODE_MONTHLY_CAPS[prefix] : undefined;
}
// 兜底读取官方 CLI 登录文件（cmd login 写入），解析方式对齐提供方插件的 resolveAuthFileApiKey。
function commandCodeAuthFileKey(io) {
 try {
  const parsed = JSON.parse(io.readFileSync(COMMAND_CODE_AUTH_FILE, "utf8"));
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return undefined;
  const str = v => typeof v === "string" && v.trim() ? v.trim() : undefined;
  const fromRecord = v => {
   const r = v && typeof v === "object" && !Array.isArray(v) ? v : undefined;
   if (!r) return undefined;
   if (r.type === "api") return str(r.key);
   if (r.type === "oauth") return str(r.access);
   return str(r.key) ?? str(r.access);
  };
  return str(parsed.apiKey) ?? str(parsed.commandcode) ?? fromRecord(parsed.commandcode) ?? fromRecord(parsed["command-code"]);
 } catch { return undefined; }
}
// SuperGrok / X Premium 订阅（dsh-grok-kit 的 xai-oauth 路由）：用量走官方 Grok CLI 的计费
// 代理（转发后端 GetGrokCreditsConfig）。凭据是 dsh-grok-kit / Grok CLI 共享登录文件里的
// OAuth Bearer（短命轮换），只读不写、不自行刷新，避免与两端的 refresh-token 轮换互相顶掉。
const GROK_API_BASE = "https://cli-chat-proxy.grok.com/v1";
// 官方 GrokComConfig.token_header 默认值：必须是该字符串，nginx 鉴权子请求才路由到 OAuth。
const GROK_TOKEN_AUTH = "xai-grok-cli";
const GROK_CLIENT_VERSION = "1.0.13";
const GROK_AUTH_FILE = join(homedir(), ".grok", "auth.json");
// dsh-grok-kit 旧版私存路径（其 resolveXaiOAuthStorePath 的回退分支）。
const XAI_OAUTH_AUTH_FILE = join(homedir(), ".dsh", ".xai-oauth-auth.json");
// Bearer 的 JWT payload 里有 sub（= user_id）；登录文件缺 user_id 时兜底取它。
function bearerSubject(key) {
 try {
  const payload = key.split(".")[1]?.replace(/-/g, "+").replace(/_/g, "/");
  if (!payload) return undefined;
  const claims = JSON.parse(Buffer.from(payload, "base64").toString("utf8"));
  return typeof claims?.sub === "string" && claims.sub.trim() ? claims.sub.trim() : undefined;
 } catch { return undefined; }
}
// 兼容两种登录文件形态：Grok CLI auth.json（槽位 map，槽位名含签发方）与 dsh 信封
// （{ version, credential: { access, accountId } }）。槽位优先 auth.x.ai，其次旧签发方。
function grokAuthFileCredentials(io) {
 const str = v => typeof v === "string" && v.trim() ? v.trim() : undefined;
 // access token 短命（实测 ~24 小时量级）。登录文件里带着 `expires_at`，必须把它读出来：
 // 不读就只能等上游回 401，界面显示一句「登录或凭据已失效」，而用户那边的 Grok Kit 明明写着「已登录」。
 const expiry = value => {
  if (typeof value === "string" && Number.isFinite(Date.parse(value))) return new Date(value).toISOString();
  if (typeof value === "number" && Number.isFinite(value) && value > 0) {
   const ms = value > 1e12 ? value : value * 1000;
   return Number.isFinite(new Date(ms).getTime()) ? new Date(ms).toISOString() : undefined;
  }
  return undefined;
 };
 const read = path => {
  try {
   const parsed = JSON.parse(io.readFileSync(path, "utf8"));
   if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return undefined;
   const envelope = parsed.credential && typeof parsed.credential === "object" && !Array.isArray(parsed.credential) ? parsed.credential : undefined;
   const pick = (record, userId) => {
    const key = str(record.key) ?? str(record.access) ?? str(record.access_token);
    if (!key) return undefined;
    const expiresAt = expiry(record.expires_at ?? record.expiresAt);
    return { key, userId: str(record.user_id) ?? str(record.principal_id) ?? userId ?? bearerSubject(key), ...(expiresAt ? { expiresAt } : {}) };
   };
   if (envelope) return pick(envelope, str(envelope.accountId));
   const slots = Object.entries(parsed).filter(([, v]) => v && typeof v === "object" && !Array.isArray(v) && (str(v.key) ?? str(v.access) ?? str(v.access_token)));
   const find = test => slots.find(([slotName]) => test(slotName))?.[1];
   return pick(find(slotName => slotName.includes("auth.x.ai")) ?? find(slotName => slotName.includes("accounts.x.ai")) ?? slots[0]?.[1] ?? {});
  } catch { return undefined; }
 };
 return read(GROK_AUTH_FILE) ?? read(XAI_OAUTH_AUTH_FILE);
}
// OpenAI Codex / ChatGPT 订阅额度：走 ChatGPT 后端私有接口，凭据是 Codex CLI 的 OAuth 登录文件
// （`$CODEX_HOME/auth.json`，默认 `~/.codex/auth.json`），**与 OPENAI_API_KEY 是两套**：
// `auth_mode` 不是 `chatgpt` 时（API Key 模式）取不到订阅额度，此时按未配置处理而不是拿 API Key 冒充。
// 与 Grok 一样只读：token 由 Codex CLI 自己轮换，第三端刷新会互相顶掉。
const CODEX_AUTH_DIR = join(homedir(), ".codex");
const CODEX_API_BASE = "https://chatgpt.com/backend-api";
export function codexAuthFileCredentials(io, env) {
	const home = typeof env?.CODEX_HOME === "string" && env.CODEX_HOME.trim() ? env.CODEX_HOME.trim() : CODEX_AUTH_DIR;
	try {
		const parsed = JSON.parse(io.readFileSync(join(home, "auth.json"), "utf8"));
		if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return undefined;
		if (parsed.auth_mode !== "chatgpt") return undefined;
		const tokens = parsed.tokens && typeof parsed.tokens === "object" && !Array.isArray(parsed.tokens) ? parsed.tokens : {};
		const key = typeof tokens.access_token === "string" && tokens.access_token.trim() ? tokens.access_token.trim() : undefined;
		if (!key) return undefined;
		const accountId = typeof tokens.account_id === "string" && tokens.account_id.trim() ? tokens.account_id.trim() : undefined;
		return { key, accountId };
	} catch { return undefined; }
}
const CONFIG_PATH = join(homedir(), ".dsh", "dsh-subusage.json");
// 官方 MiMo 会话 Cookie 自签发起 24 小时有效；从凭据写入时刻起计时，手动导入与自动登录同源。
const MIMO_COOKIE_TTL_MS = 24 * 60 * 60 * 1000;
const MAX_BYTES = 1024 * 1024;
const TTL = 60000;
const hash = (value) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
/** 计时元数据落库用毫秒、过 RPC 用 ISO：非正值一律视为未记录。 */
const isoStamp = (ms) => Number.isSafeInteger(ms) && ms > 0 ? new Date(ms).toISOString() : null;
function redactMimo(value, cookie) {
 const sensitive = [cookie, ...cookie.split(";").map(part => { const trimmed = part.trim(); return trimmed.slice(trimmed.indexOf("=") + 1).replace(/^\"|\"$/g, ""); }).filter(Boolean)].filter(Boolean);
 // 套餐名是未经结构约束的展示文本；余额/明细已严格限制为数值和货币代码。
 // 不对子串碰巧匹配的日期、自建枚举或单位做替换，避免短 Cookie 破坏语义。
 const sanitize = text => sensitive.reduce((out, secret) => out.split(secret).join("[redacted]"), text);
 return { ...value, ...(Array.isArray(value.extras) ? { extras: value.extras.map(extra => extra.kind === "plan" ? { ...extra, value: sanitize(extra.value) } : extra) } : {}) };
}
function defaultSettings() {
 // Ark 的逐条默认值必须直接跟随组开关：`load()` 在配置文件还不存在时走的就是这里，若默认值各行其是，
 // 「首次读到 → 保存 → 再读回」会因为归一化把成员值改成组开关的值而算出不同的 revision。
 return { zai: { type: 1, organization: "", project: "" }, volc: { accessKeyId: "", secretAccessKey: "" }, litellm: { baseUrl: "" }, xiaomi: { cookie: "", loginAt: 0, expiresAt: 0 }, keys: {}, keyModes: Object.fromEntries(IDS.map(id => [id, "inherit"])), visibility: { hideWithoutApi: true, ark: ARK_DEFAULT_ON, providers: Object.fromEntries(IDS.map(id => [id, PROVIDERS[id].credentialKind === "volc" ? ARK_DEFAULT_ON : PROVIDERS[id].defaultEnabled !== false])) } };
}
function parseStored(value) {
 const s = defaultSettings();
 if (!value || typeof value !== "object" || Array.isArray(value)) throw failure("subusage/config", "设置文件结构无效");
 if (value.zai && typeof value.zai === "object") s.zai = { type: value.zai.type === 2 ? 2 : 1, organization: typeof value.zai.organization === "string" ? value.zai.organization : "", project: typeof value.zai.project === "string" ? value.zai.project : "" };
 if (value.volc && typeof value.volc === "object" && !Array.isArray(value.volc)) for (const field of ["accessKeyId", "secretAccessKey"]) if (typeof value.volc[field] === "string") s.volc[field] = value.volc[field];
 if (value.litellm && typeof value.litellm === "object" && !Array.isArray(value.litellm) && typeof value.litellm.baseUrl === "string") s.litellm.baseUrl = value.litellm.baseUrl;
 if (value.xiaomi && typeof value.xiaomi === "object") { if (typeof value.xiaomi.cookie === "string") s.xiaomi.cookie = value.xiaomi.cookie; for (const field of ["loginAt", "expiresAt"]) if (Number.isSafeInteger(value.xiaomi[field]) && value.xiaomi[field] > 0) s.xiaomi[field] = value.xiaomi[field]; }
 if (typeof value.visibility?.hideWithoutApi === "boolean") s.visibility.hideWithoutApi = value.visibility.hideWithoutApi;
 // 组级开关：旧配置里 Ark 的每条路由各存了一份，缺省时按「任一条开着」合并过来，迁移不留痕迹。
 if (typeof value.visibility?.ark === "boolean") s.visibility.ark = value.visibility.ark;
 else if (ARK_IDS.some(id => value.visibility?.providers?.[id] === true)) s.visibility.ark = true;
 for (const id of IDS) {
  if (typeof value.visibility?.providers?.[id] === "boolean") s.visibility.providers[id] = value.visibility.providers[id];
  if (PROVIDERS[id].managedByPlugin) continue;
   if (typeof value.keys?.[id] === "string") s.keys[id] = value.keys[id];
  if (value.keyModes?.[id] === "manual") s.keyModes[id] = "manual";
 }
 // 组开关是 Ark 的**唯一真源**：逐条值只当作迁移输入，读回后一律跟随组开关。
 // 不归一化就会分叉——「迁移时把任一条开着合并成组开关 true、成员值却保留原样」之后，
 // 界面按组开关显示这条路由，Host 却按成员值判定，用户拿到的是一张写着「检测已关闭」的空卡片。
 for (const id of ARK_IDS) s.visibility.providers[id] = s.visibility.ark;
 return s;
}
function publicSettings(s) {
 return { revision: hash(s), zai: { ...s.zai }, volc: { hasAccessKeyId: !!s.volc.accessKeyId?.trim(), hasSecretAccessKey: !!s.volc.secretAccessKey?.trim() }, litellm: { baseUrl: s.litellm.baseUrl }, xiaomi: { hasCookie: !!s.xiaomi.cookie.trim(), loginAt: isoStamp(s.xiaomi.loginAt), expiresAt: isoStamp(s.xiaomi.expiresAt) }, hasKeys: Object.fromEntries(IDS.map(id => [id, !!s.keys[id]?.trim()])), keyModes: { ...s.keyModes }, visibility: { hideWithoutApi: s.visibility.hideWithoutApi, ark: s.visibility.ark, providers: { ...s.visibility.providers } } };
}
function invalid(message) { return new RemoteError("subusage/invalid-request", message, { retryable: false, retainPrevious: false }); }
function parseUpdate(update) {
 if (!update || typeof update !== "object" || !["keep", "replace", "clear"].includes(update.action)) throw invalid("Invalid secret update");
 if (update.action === "replace" && (typeof update.value !== "string" || !update.value.trim())) throw invalid("Replacement must be a nonempty string");
 return { action: update.action, ...(update.action === "replace" ? { value: update.value.trim() } : {}) };
}
function parseSettings(value) {
 if (value?.visibility !== undefined) {
  const v = value.visibility;
  if (!v || typeof v !== "object" || Array.isArray(v) || Object.keys(value).some(k => !["visibility", "expectedRevision"].includes(k)) || typeof value.expectedRevision !== "string" || !value.expectedRevision) throw invalid("Invalid visibility patch");
  if (Object.keys(v).some(k => !["providers", "hideWithoutApi", "ark"].includes(k)) || !Object.keys(v).length) throw invalid("Invalid visibility fields");
  const visibility = {};
  if (v.hideWithoutApi !== undefined) { if (typeof v.hideWithoutApi !== "boolean") throw invalid("Invalid auto-hide switch"); visibility.hideWithoutApi = v.hideWithoutApi; }
  // Ark 组级开关：设置页只呈现这一个，由它统一控制组内全部路由。
  if (v.ark !== undefined) { if (typeof v.ark !== "boolean") throw invalid("Invalid Ark group switch"); visibility.ark = v.ark; }
  if (v.providers !== undefined) {
   if (!v.providers || typeof v.providers !== "object" || Array.isArray(v.providers) || !Object.keys(v.providers).length || Object.entries(v.providers).some(([id, enabled]) => !IDS.includes(id) || typeof enabled !== "boolean")) throw invalid("Invalid provider switches");
   visibility.providers = { ...v.providers };
  }
  return { expectedRevision: value.expectedRevision, visibility };
 }
 // 这里只校验形状：未知 provider（新版 Client + 还没重启的旧 Host）交给 persist 给可读错误，
 // 否则用户只会看到网关的 "boundary validation" 通用报错，无从判断该重启还是该改配置。
 if (!value || typeof value !== "object" || typeof value.providerId !== "string" || !value.providerId) throw invalid("Invalid provider patch");
 const out = { providerId: value.providerId };
 if (value.expectedRevision !== undefined) { if (typeof value.expectedRevision !== "string") throw invalid("Invalid revision"); out.expectedRevision = value.expectedRevision; }
 if (value.keyMode !== undefined) { if (!["inherit", "manual"].includes(value.keyMode)) throw invalid("Invalid key mode"); out.keyMode = value.keyMode; }
 for (const field of ["keyUpdate", "cookieUpdate"]) if (value[field] !== undefined) out[field] = parseUpdate(value[field]);
 // 火山方舟的凭据是 AK/SK 配对，只能走 volc 补丁；单值 keyUpdate 会让 AK 与 SK 失去配对来源。
 if (PROVIDERS[value.providerId]?.credentialKind === "volc" && (value.keyUpdate !== undefined || value.cookieUpdate !== undefined)) throw invalid("Volcengine credentials use the volc patch");
 if (PROVIDERS[value.providerId]?.managedByPlugin && (out.keyMode !== undefined || out.keyUpdate !== undefined || out.cookieUpdate !== undefined)) throw invalid("Credentials are managed by the provider plugin");
 if (out.keyUpdate?.action === "replace" && /[\x00-\x1f\x7f]/.test(value.keyUpdate.value)) throw invalid("Invalid API key");
 if (out.cookieUpdate && out.providerId !== "xiaomi-token-plan-cn") throw invalid("Cookie patch is MiMo-only");
 if (out.cookieUpdate?.action === "replace") {
  const cookie = out.cookieUpdate.value;
  if (/[\x00-\x1f\x7f]/.test(value.cookieUpdate.value)) throw invalid("Invalid Cookie");
  const names = new Map();
  for (const item of cookie.split(";")) {
   const match = item.trim().match(/^([!#$%&'*+.^_`|~0-9A-Za-z-]+)=(\"[\x21\x23-\x2b\x2d-\x3a\x3c-\x5b\x5d-\x7e]*\"|[\x21\x23-\x2b\x2d-\x3a\x3c-\x5b\x5d-\x7e]*)$/);
   if (!match || names.has(match[1])) throw invalid("Invalid Cookie");
   names.set(match[1], match[2].replace(/^\"|\"$/g, ""));
  }
  if (!names.get("api-platform_serviceToken") || !names.get("userId")) throw invalid("Cookie is missing required names");
 }
 if (value.zai !== undefined) {
  if (out.providerId !== "zai-coding-cn" || !value.zai || ![1, 2].includes(value.zai.type) || typeof value.zai.organization !== "string" || typeof value.zai.project !== "string") throw invalid("Invalid Z.ai patch");
  out.zai = { type: value.zai.type, organization: value.zai.organization.trim(), project: value.zai.project.trim() };
 }
 if (value.litellm !== undefined) {
  // 端点地址不是秘密，可以原样回显；这里只做形状校验，真正的合法性在请求前用 URL 解析把关。
  if (out.providerId !== "litellm" || !value.litellm || typeof value.litellm !== "object" || Array.isArray(value.litellm) || typeof value.litellm.baseUrl !== "string" || Object.keys(value.litellm).some(key => key !== "baseUrl")) throw invalid("Invalid LiteLLM patch");
  if (/[\x00-\x1f\x7f]/.test(value.litellm.baseUrl)) throw invalid("Invalid LiteLLM base URL");
  out.litellm = { baseUrl: value.litellm.baseUrl.trim() };
 }
 if (value.volc !== undefined) {
  const volc = value.volc;
  if (PROVIDERS[out.providerId]?.credentialKind !== "volc" || !volc || typeof volc !== "object" || Array.isArray(volc) || !Object.keys(volc).length || Object.keys(volc).some(key => !["accessKeyId", "secretAccessKey"].includes(key))) throw invalid("Invalid Volcengine patch");
  // 每个字段各自 keep/replace/clear：SK 不回显，空串不能当清空，否则只改 AK 会把已存的 SK 一起抹掉。
  for (const [field, target] of [["accessKeyId", "accessKeyUpdate"], ["secretAccessKey", "secretKeyUpdate"]]) {
   if (volc[field] === undefined) continue;
   out[target] = parseUpdate(volc[field]);
   if (out[target].action === "replace" && /[\x00-\x1f\x7f]/.test(volc[field].value)) throw invalid("Invalid Volcengine credential");
  }
 }
 return out;
}
function parseQuery(value) {
 // request 在 wire 层可选（read 描述符声明 acceptsUndefined）：缺参/undefined/null
 // = 全量默认账户查询，兼容旧 client bundle 的无参 read。
 if (value === undefined || value === null) return { providerIds: [...IDS], unknown: [], force: false, commandCodeAccount: "" };
 // 未知 id **过滤而不是整体拒绝**：provider 清单随版本演进，而 Host 需要重启、Client 刷新即生效，
 // 这个版本窗口期里客户端必然带着本 Host 还不认识的 id 过来。整体拒绝会让用户一片空白；
 // 过滤掉未知项并单独回一条可读原因（见 refresh），既保住其它提供商，也说清了为什么。
 if (!value || !Array.isArray(value.providerIds) || typeof value.force !== "boolean") throw invalid("Invalid refresh request");
 // commandCodeAccount 是可选的显示账户选择：空串/缺省 = 默认账户（顶层 Key）；
 // 额外账户 id 即其凭据引用名（apiKeyEnv），由 identity 按引用解析。
 if (value.commandCodeAccount !== undefined && typeof value.commandCodeAccount !== "string") throw invalid("Invalid account selection");
 const requested = [...new Set(value.providerIds)].filter(id => typeof id === "string");
 return { providerIds: requested.filter(id => IDS.includes(id)), unknown: requested.filter(id => !IDS.includes(id)), force: value.force, commandCodeAccount: typeof value.commandCodeAccount === "string" ? value.commandCodeAccount.trim() : "" };
}
function failure(code, message, retryable = false, retryAfterMs) {
 return new RemoteError(code, message, { retryable, retainPrevious: retryable, ...(retryAfterMs !== undefined ? { retryAfterMs } : {}) });
}
// 火山方舟把拒绝原因放在 ResponseMetadata.Error 业务信封里：401 是签名/凭据（服务端不知道你是谁），
// 403 是授权（身份已确认但不能做：IAM 权限不足、套餐未开通、欠费），两者对用户的行动项不同。
function volcFailure(action, error) {
 const detail = error.message ? ` · ${error.message}` : "";
 if (/^(AuthenticationError|SignatureDoesNotMatch|InvalidAccessKey|InvalidSecretToken|InvalidCredential|InvalidAuthorization|MissingRequestInfo|InvalidTimestamp)$/.test(error.code)) return failure("subusage/auth", `火山方舟 ${action}：凭据或签名无效（${error.code}）${detail}。额度查询要 IAM Access Key 的 AK/SK，不是推理用的方舟 API Key`);
 if (/^(AccessDenied|OperationDenied|AccountOverdueError)/.test(error.code)) return failure("subusage/auth", `火山方舟 ${action}：${error.code}${detail}。请确认该 AK/SK 有方舟读权限，且账号已订阅对应套餐`);
 if (error.code === "InvalidActionOrVersion" || error.code === "PathNotFound") return failure("subusage/response", `火山方舟 ${action}：接口不存在（${error.code}），该 Action 可能已变更`);
 if (error.code === "FlowLimitExceeded") return failure("subusage/rate-limit", `火山方舟 ${action}：触发限流`, true);
 if (/InternalError|InternalServiceError/.test(error.code)) return failure("subusage/http", `火山方舟 ${action}：服务端错误（${error.code}）`, true);
 return failure("subusage/response", `火山方舟 ${action}：${error.code}${detail}`);
}
async function fetchJson(fetcher, url, headers, lifetimeSignal, init = {}) {
 let response;
 try { response = await fetcher(url, { method: init.method ?? "GET", ...(init.body !== undefined ? { body: init.body } : {}), headers: { accept: "application/json", "user-agent": "dsh-subusage/0.10.6", ...headers }, signal: lifetimeSignal ? AbortSignal.any([AbortSignal.timeout(10000), lifetimeSignal]) : AbortSignal.timeout(10000), redirect: "manual" }); }
 catch { throw failure("subusage/network", "网络请求失败或超时", true); }
 if (response.status >= 300 && response.status < 400 || response.status === 401 || response.status === 403) throw failure("subusage/auth", "登录或凭据已失效");
 if (!response.ok) {
  const retry = response.status === 408 || response.status === 429 || response.status >= 500;
  const raw = response.headers?.get?.("retry-after");
  const retryAfterMs = raw ? (/^\d+(\.\d+)?$/.test(raw) ? Number(raw) * 1000 : Math.max(0, Date.parse(raw) - Date.now())) : undefined;
  throw failure(response.status === 429 ? "subusage/rate-limit" : "subusage/http", `HTTP ${response.status}`, retry, Number.isFinite(retryAfterMs) ? retryAfterMs : undefined);
 }
 if (Number(response.headers?.get?.("content-length")) > MAX_BYTES) throw failure("subusage/response", "响应超过 1MiB");
 let text = "";
 try {
  if (response.body?.getReader) {
   const reader = response.body.getReader(); const decoder = new TextDecoder(); let size = 0;
   try { for (;;) { const { done, value } = await reader.read(); if (done) break; size += value.byteLength; if (size > MAX_BYTES) { await reader.cancel(); throw failure("subusage/response", "响应超过 1MiB"); } text += decoder.decode(value, { stream: true }); } text += decoder.decode(); } finally { reader.releaseLock(); }
  } else { text = await response.text(); if (Buffer.byteLength(text) > MAX_BYTES) throw failure("subusage/response", "响应超过 1MiB"); }
 } catch (e) { if (e instanceof RemoteError) throw e; throw failure("subusage/network", "读取响应失败", true); }
 let body;
 try { body = JSON.parse(text); } catch { throw failure("subusage/response", "响应不是合法 JSON"); }
 if ([401, 403, "401", "403"].includes(body?.code)) throw failure("subusage/auth", "登录或凭据已失效");
 return body;
}
function numeric(v) { return typeof v === "number" && Number.isFinite(v) && v >= 0; }
function windowRow(kind, raw, resetsAt, status, detail) {
 if (!numeric(raw)) throw failure("subusage/response", "用量百分比缺失或无效");
 const percent = raw < 100 ? Math.min(99.9, Math.round(raw * 10) / 10) : Math.round(raw * 10) / 10;
 return { kind, percent, status: status === "rate-limited" || raw >= 100 ? "rate-limited" : "ok", ...(typeof resetsAt === "string" && Number.isFinite(Date.parse(resetsAt)) ? { resetsAt: new Date(resetsAt).toISOString() } : {}), ...(detail ? { detail } : {}) };
}
const RANK = { month: 0, sub: 0, period: 0, week: 1, "7d": 1, day: 2, "5h": 2, rolling: 2 };
function cascadeRateLimited(windows) {
 const roots = windows.filter(w => w.status === "rate-limited");
 for (const w of windows) {
  const blockers = roots.filter(root => (RANK[root.kind] ?? 3) < (RANK[w.kind] ?? 3));
  if (blockers.length) { if (w.status !== "rate-limited") w.cascade = true; w.status = "rate-limited"; w.detail = { ...w.detail, blockedBy: [...new Set(blockers.map(root => root.kind))] }; }
 }
 return windows;
}
export function normalizeKimi(body) {
 // 上游 /coding/v1/usages 有两代形态：新版 usages 比例池（limit_5h / limit_7d /
 // limit_month_total），旧版顶层 usage + limits[]（绝对 limit / used / remaining）。
 // 只有 300 分钟窗口在所有形态都下发，因此没有哪个窗口名可以当必需字段：现行账户
 // 下发 5h + 月池而省略 limit_7d，旧账户则完全没有 usages。不推断未知字段。
 const pools = [body?.usages, body?.usage, body?.limits].filter(v => v && typeof v === "object" && !Array.isArray(v));
 const windows = [];
 // limit_month_code 是 month_total 的 Code 份额而非独立预算，不作为独立窗口。
 for (const [field, kind] of [["limit_5h", "5h"], ["limit_7d", "7d"], ["limit_month_total", "month"]]) {
  const row = pools.map(pool => pool[field]).find(v => v !== undefined);
  if (row === undefined) continue;
  if (!numeric(row.used_ratio)) throw failure("subusage/response", "Invalid Kimi used_ratio");
  windows.push(windowRow(kind, row.used_ratio * 100, row.reset_time));
 }
 // 无比例池时退回绝对值：limits[] 的 300 分钟项是 5 小时窗口，顶层 usage 是周额度。
 if (!windows.length) {
  const absolute = (row, kind) => {
   const limit = Number(row?.limit), remaining = Number(row?.remaining);
   if (!Number.isFinite(limit) || limit <= 0 || !Number.isFinite(remaining)) return;
   windows.push(windowRow(kind, (limit - remaining) / limit * 100, row.resetTime));
  };
  const burst = (Array.isArray(body?.limits) ? body.limits : []).find(row => row?.window?.duration === 300 && row.window.timeUnit === "TIME_UNIT_MINUTE");
  if (burst) absolute(burst.detail, "5h");
  if (body?.usage && typeof body.usage === "object") absolute(body.usage, "week");
 }
 if (!windows.length) throw failure("subusage/response", "Invalid Kimi usage response");
 return cascadeRateLimited(windows);
}
export function normalizeZai(body) {
 const data = body?.data;
 if (!Array.isArray(data?.limits)) throw failure("subusage/response", "Invalid Z.ai usage response");
 const windows = [];
 for (const l of data.limits) {
  const unit = l?.type === "TOKENS_LIMIT" && l.unit === undefined ? 3 : l?.unit;
  if (!["CREDIT_LIMIT", "TOKENS_LIMIT"].includes(l?.type) || ![3, 6].includes(unit)) continue;
  const reset = l.nextResetTime && Number.isFinite(new Date(l.nextResetTime).getTime()) ? new Date(l.nextResetTime).toISOString() : undefined;
  const detail = numeric(l.currentValue) && numeric(l.usage) ? { used: l.currentValue, limit: l.usage, unit: l.type === "TOKENS_LIMIT" ? "tokens" : "credits" } : undefined;
  windows.push(windowRow(unit === 3 ? "5h" : "week", l.percentage, reset, undefined, detail));
 }
 if (!windows.length) throw failure("subusage/response", "Z.ai response carries no coding-plan windows");
 return { windows: cascadeRateLimited(windows), level: typeof data.level === "string" ? data.level : undefined };
}
export function normalizeMimo(balBody, detailBody, usageBody) {
 const bal = balBody?.data;
 if (!bal || typeof bal.balance !== "string" || !/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)$/.test(bal.balance) || !Number.isFinite(Number(bal.balance))) throw failure("subusage/response", "Invalid MiMo balance response");
 const data = usageBody?.data ?? {}; const detail = detailBody?.data ?? {};
 const pick = (group, name) => Array.isArray(group?.items) ? group.items.find(i => i?.name === name) : undefined;
 const pool = pick(data.usage, "plan_total_token") ?? pick(data.monthUsage, "month_total_token");
 const poolDetail = numeric(pool?.used) && numeric(pool?.limit) ? { used: pool.used, limit: pool.limit, unit: "credits" } : undefined;
 const windows = pool && numeric(pool.percent) ? [windowRow("sub", pool.percent * 100, detail.currentPeriodEnd, undefined, poolDetail)] : [];
 const currency = typeof bal.currency === "string" && /^[A-Z]{3}$/.test(bal.currency) ? bal.currency : "";
 const extras = [{ kind: "balance", value: `${bal.balance} ${currency}`.trim() }];
 const plan = detail.planName || detail.planCode;
 if (typeof plan === "string") extras.push({ kind: "plan", value: plan });
 return { windows, extras, balanceOk: true, coverage: windows.length ? "complete" : "partial" };
}
export function normalizeOpencodeGo(body) {
 const src = body?.usage ?? body;
 if (!src || typeof src !== "object") throw failure("subusage/response", "Invalid OpenCode Go usage response");
 const windows = [];
 for (const [key, kind] of Object.entries({ rolling: "rolling", weekly: "week", monthly: "month" })) if (src[key]) windows.push(windowRow(kind, src[key].percent, src[key].resetsAt, src[key].status));
 if (!windows.length) throw failure("subusage/response", "OpenCode Go response carries no usage windows");
 const plan = src.source ?? body.source;
 return { windows: cascadeRateLimited(windows), extras: typeof plan === "string" ? [{ kind: "plan", value: plan }] : [], coverage: windows.length === 3 ? "complete" : "partial" };
}
// Official quota contracts; never include unrelated search/image pools in the model badge.
// https://dev.synthetic.new/docs/synthetic/quotas
export function normalizeSynthetic(body) {
 const row = body?.subscription;
 if (!numeric(row?.requests) || !numeric(row?.limit) || row.limit <= 0) throw failure("subusage/response", "Invalid Synthetic subscription quota");
 return { windows: [windowRow("rolling", row.requests / row.limit * 100, row.renewsAt, undefined, { used: row.requests, limit: row.limit, unit: "requests" })], extras: [], coverage: "complete" };
}
// https://docs.nano-gpt.com/api-reference/endpoint/subscription-usage
// 第二个参数是 /api/check-balance 的可选余额响应：余额是**增量**，拿不到就不显示，不影响配额。
export function normalizeNanoGpt(body, balanceBody) {
 if (typeof body?.active !== "boolean" || !["active", "grace", "inactive"].includes(body.state)) throw failure("subusage/response", "Invalid NanoGPT subscription response");
 const windows = []; let partial = false;
 if (body.active && body.state !== "inactive") for (const [field, kind, limit] of [["dailyInputTokens", "day", body.limits?.dailyInputTokens], ["weeklyInputTokens", "week", body.limits?.weeklyInputTokens], ["tokens", "period", body.tokenLimits?.total]]) {
  const row = body[field];
  if (row == null && limit == null) continue;
  if (row?.degraded === true || !numeric(row?.percentUsed) || !numeric(limit) || limit <= 0 || !numeric(row?.used)) { partial = true; continue; }
  const reset = numeric(row.resetAt) && Number.isFinite(new Date(row.resetAt).getTime()) ? new Date(row.resetAt).toISOString() : undefined;
  windows.push(windowRow(kind, row.percentUsed * 100, reset, undefined, { used: row.used, limit, unit: "tokens" }));
 }
 const extras = [{ kind: "plan", value: body.state }];
 const usd = typeof balanceBody?.usd_balance === "string" && /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)$/.test(balanceBody.usd_balance.trim()) ? balanceBody.usd_balance.trim() : undefined;
 if (usd) extras.push({ kind: "balance", value: `${usd} USD` });
 return { windows: cascadeRateLimited(windows), extras, coverage: windows.length && !partial ? "complete" : "partial" };
}
// 官方 CLI 的计数消歧规则：有 remaining_percent 时按它校准；旧响应 usage_count 是剩余。
// https://github.com/MiniMax-AI/cli/blob/main/src/utils/quota.ts
export function normalizeMinimax(body) {
 const code = body?.base_resp?.status_code;
 if (code !== 0) {
  if ([1004, 2049].includes(code)) throw failure("subusage/auth", "MiniMax 订阅 Key 无效或已失效");
  if ([1001, 1002].includes(code)) throw failure("subusage/http", "MiniMax 用量接口暂时不可用", true);
  throw failure("subusage/response", "MiniMax 用量接口未返回成功状态");
 }
 if (!Array.isArray(body.model_remains)) throw failure("subusage/response", "Invalid MiniMax usage response");
 // 不能将视频/图像池混到当前编程模型的药丸，也不能累加共享模型池。
 const general = body.model_remains.filter(row => row?.model_name === "general");
 const candidates = general.length ? general : body.model_remains.filter(row => typeof row?.model_name === "string" && /^MiniMax-M/i.test(row.model_name));
 if (candidates.length !== 1) throw failure("subusage/response", "MiniMax response carries no unambiguous coding quota");
 const row = candidates[0], windows = [];
 for (const [prefix, kind, end] of [["current_interval", "5h", "end_time"], ["current_weekly", "week", "weekly_end_time"]]) {
  const status = row[`${prefix}_status`];
  // 无上限或未开通池不画虚假的 0% 用量；零总计也不证明额度耗尽。
  if (status === 3) continue;
  if (status !== undefined && ![1, 2].includes(status)) throw failure("subusage/response", "Invalid MiniMax quota status");
  const total = row[`${prefix}_total_count`], reported = row[`${prefix}_usage_count`], percent = row[`${prefix}_remaining_percent`];
  if (percent !== undefined && !numeric(percent)) throw failure("subusage/response", "Invalid MiniMax remaining percentage");
  let remaining, detail;
  if (numeric(total) && total > 0 && numeric(reported) && reported <= total) {
   remaining = reported;
   if (percent !== undefined) {
    const asRemaining = Math.abs(reported / total * 100 - percent);
    const asUsed = Math.abs((total - reported) / total * 100 - percent);
    if (Math.min(asRemaining, asUsed) > 1) remaining = undefined;
    else if (asUsed < asRemaining) remaining = total - reported;
   }
   if (remaining !== undefined) detail = { used: total - remaining, limit: total, remaining, unit: "quota" };
  }
  if (percent === undefined && remaining === undefined && status !== 2) {
   if ((total === undefined && reported === undefined) || (total === 0 && reported === 0)) continue;
   throw failure("subusage/response", "Invalid MiniMax quota counts");
  }
  const usedPercent = status === 2 ? 100 : Math.max(0, 100 - (percent ?? remaining / total * 100));
  const endTime = row[end];
  const reset = numeric(endTime) && endTime > 0 && Number.isFinite(new Date(endTime).getTime()) ? new Date(endTime).toISOString() : undefined;
  windows.push(windowRow(kind, usedPercent, reset, undefined, detail));
 }
 return { windows: cascadeRateLimited(windows), extras: [], coverage: windows.length === 2 ? "complete" : "partial" };
}
export function normalizeCommandCode(body, subscriptionBody) {
 // 输入是 Command Code 计费接口（/alpha/billing/credits）的原始响应体。
 // absent 窗口 ≠ 零额度：未报告的窗口不画额度行；cap:0 是报告过的无上限，按不受限展示。
 // 已出现的窗口块缺 used/cap 属非法（不当作零用量）；exceeded 缺省视为未超限，resetAt 无值不显示。
 const credits = body?.credits && typeof body.credits === "object" && !Array.isArray(body.credits) ? body.credits : {};
 const limits = body?.windowLimits && typeof body.windowLimits === "object" && !Array.isArray(body.windowLimits) ? body.windowLimits : {};
 if (!Object.keys(credits).length && !Object.keys(limits).length) throw failure("subusage/response", "Invalid Command Code usage response");
 const windows = [];
 for (const [key, kind] of [["fiveHour", "5h"], ["weekly", "week"]]) {
  const w = limits[key];
  if (w === undefined || w === null) continue;
  if (typeof w !== "object" || Array.isArray(w)) throw failure("subusage/response", "Invalid Command Code usage window");
  const cap = w.cap, used = w.used;
  if (!numeric(cap) || !numeric(used)) throw failure("subusage/response", "Invalid Command Code usage window");
  const resetAt = typeof w.resetAt === "number" && w.resetAt > 0 && Number.isFinite(new Date(w.resetAt).getTime()) ? new Date(w.resetAt).toISOString() : undefined;
  windows.push(windowRow(kind, cap > 0 ? used / cap * 100 : 0, resetAt, w.exceeded === true ? "rate-limited" : undefined, cap > 0 ? { used, limit: cap, unit: "credits" } : undefined));
 }
 const extras = [];
 const subscription = subscriptionBody?.data && typeof subscriptionBody.data === "object" && !Array.isArray(subscriptionBody.data) ? subscriptionBody.data : {};
  const plan = typeof subscription.planId === "string" && subscription.planId.trim() ? subscription.planId.trim() : typeof credits.planId === "string" ? credits.planId.trim() : "";
 if (plan) extras.push({ kind: "plan", value: plan });
  const remaining = credits.monthlyCredits;
  const monthlyCap = commandCodeMonthlyCap(plan);
  const hasMonthlyBalance = typeof remaining === "number" && Number.isFinite(remaining);
  if (hasMonthlyBalance) extras.push({ kind: "monthly-balance", value: `${Math.round(remaining * 100) / 100} credits` });
  if (hasMonthlyBalance && monthlyCap !== undefined) {
   const used = Math.max(0, monthlyCap - remaining);
   // 这是套餐月池，不含购买/赠送余额；余额大于快照总额时不显示负用量。
   const end = subscription.currentPeriodEnd;
   const date = typeof end === "string" ? new Date(end) : typeof end === "number" && end > 0 ? new Date(end) : null;
   const resetsAt = date && Number.isFinite(date.getTime()) ? date.toISOString() : undefined;
   windows.push(windowRow("month", used / monthlyCap * 100, resetsAt, undefined, { used: Math.round(used * 1000000) / 1000000, limit: monthlyCap, remaining, unit: "credits", limitSource: "plan-snapshot" }));
  }
 // 余额只合并真正报告过的已购/赠送额度；未报告的字段不冒充 0。
 const reported = ["purchasedCredits", "freeCredits"].map(field => credits[field]).filter(v => typeof v === "number" && Number.isFinite(v));
 if (reported.length) extras.push({ kind: "balance", value: `${Math.round(reported.reduce((sum, v) => sum + Math.max(0, v), 0) * 100) / 100} credits` });
 // 月池耗尽并不证明已购/赠送池或短窗口也不可用；只级联接口的周/5小时限制。
  cascadeRateLimited(windows.filter(w => w.kind !== "month"));
  return { windows, extras, coverage: hasMonthlyBalance && monthlyCap !== undefined ? "complete" : "partial" };
}
// SuperGrok / X Premium 统一用量池：GetGrokCreditsConfig 响应（官方 grok CLI 的
// /v1/billing?format=credits）。creditUsagePercent 是“已用”百分比（0-100），剩余由
// client 取补；新形态用 creditUsagePercent + currentPeriod（周/月），旧形态回退
// monthlyLimit/used（美分）+ 月账期。无绝对额度字段时不编造明细。
export function normalizeSuperGrok(body, settingsBody) {
 const config = body?.config && typeof body.config === "object" && !Array.isArray(body.config) ? body.config : {};
 const period = config.currentPeriod && typeof config.currentPeriod === "object" && !Array.isArray(config.currentPeriod) ? config.currentPeriod : undefined;
 const cent = row => row && typeof row === "object" && typeof row.val === "number" && Number.isFinite(row.val) ? row.val : undefined;
 let percent;
 if (numeric(config.creditUsagePercent)) percent = config.creditUsagePercent;
 else {
  // 旧形态按美分绝对值折算比例；{}（proto3 零值）解码为 0，无上限（limit<=0）不折算。
  const limit = cent(config.monthlyLimit), used = cent(config.used) ?? 0;
  if (limit !== undefined && limit > 0) percent = used / limit * 100;
 }
 if (percent === undefined) throw failure("subusage/response", "Invalid SuperGrok billing response");
 // 周期类型是 proto 枚举名；未知/缺失类型不猜窗口名，按通用订阅池展示；旧形态按月账期。
 const kind = period?.type === "USAGE_PERIOD_TYPE_WEEKLY" ? "week" : period?.type === "USAGE_PERIOD_TYPE_MONTHLY" ? "month" : period ? "sub"
  : config.billingPeriodStart !== undefined || config.billingPeriodEnd !== undefined ? "month" : "sub";
 const windows = [windowRow(kind, percent, period?.end ?? config.billingPeriodEnd)];
 const extras = [];
 const plan = typeof settingsBody?.subscription_tier_display === "string" && settingsBody.subscription_tier_display.trim() ? settingsBody.subscription_tier_display.trim()
  : typeof body?.subscription_tier === "string" && body.subscription_tier.trim() ? body.subscription_tier.trim() : "";
 if (plan) extras.push({ kind: "plan", value: plan });
 // prepaidBalance（已购加量余额）以美分计价；只合并真正报告过的值，未报告不冒充 0。
 const prepaid = cent(config.prepaidBalance);
 if (prepaid !== undefined) extras.push({ kind: "balance", value: `${(prepaid / 100).toFixed(2)} USD` });
 return { windows, extras, coverage: "complete" };
}
// SiliconFlow（硅基流动）：**余额型** provider —— 接口返回账户余额而不是订阅窗口。
// 官方 OpenAPI 仓库 siliconflow/siliconcloud 的 openapi.yaml：GET https://api.siliconflow.cn/v1/user/info
// （bearerAuth，与推理同一把 Key），返回 data.balance / chargeBalance / totalBalance / status。
// 没有上限也就没有百分比：不把余额硬凑成一个窗口，只产出 extras，由客户端的余额兜底文案显示。
export function normalizeSiliconFlow(body) {
 const data = body?.data;
 if (!data || typeof data !== "object" || Array.isArray(data)) throw failure("subusage/response", "Invalid SiliconFlow user info response");
 const amount = value => typeof value === "number" && Number.isFinite(value) && value >= 0 ? Math.round(value * 100) / 100 : undefined;
 const total = amount(data.totalBalance) ?? amount(data.balance);
 if (total === undefined) throw failure("subusage/response", "SiliconFlow 响应没有可用余额");
 // 响应不带货币字段；该平台以人民币计价，所以按 CNY 显示，不猜测成其它货币。
 return { windows: [], extras: [{ kind: "balance", value: `${total} CNY` }], coverage: "complete" };
}
// Codex / ChatGPT 订阅用量：rate_limit.primary_window 与 secondary_window 各含 used_percent 与
// resets_at。免费档的次窗口是 30 天，所以有 window_seconds 时按它判窗口名，缺失时按位置回退 5h / 7d。
// credits 只在真正报告了可用余额时显示：has_credits=false、unlimited=true、balance="0" 都不显示，
// 不把「无额度」画成 0。
// https://raw.githubusercontent.com/steipete/CodexBar/main/docs/codex.md
export function normalizeCodexUsage(body) {
	const windows = [];
	const windowKind = (row, fallback) => {
		const seconds = row?.window_seconds ?? row?.limit_window_seconds;
		if (!Number.isFinite(seconds) || seconds <= 0) return fallback;
		return seconds >= 2592000 ? "month" : seconds >= 604800 ? "week" : seconds >= 86400 ? "day" : "5h";
	};
	const push = (row, fallback) => {
		if (!row || typeof row !== "object" || Array.isArray(row)) return;
		if (!numeric(row.used_percent)) throw failure("subusage/response", "Invalid Codex used_percent");
		// 实测（2026-10-09）：resets_at 是 **Unix 秒数**，不是 ISO 串——两种都要认，否则重置时间会静默丢失。
		const raw = row.resets_at ?? row.reset_at;
		const reset = typeof raw === "string" && Number.isFinite(Date.parse(raw)) ? new Date(Date.parse(raw)).toISOString()
			: numeric(raw) && raw > 0 ? new Date(raw * 1000).toISOString()
			: undefined;
		windows.push(windowRow(windowKind(row, fallback), row.used_percent, reset));
	};
	const limits = body?.rate_limit && typeof body.rate_limit === "object" && !Array.isArray(body.rate_limit) ? body.rate_limit : {};
	push(limits.primary_window, "5h");
	push(limits.secondary_window, "7d");
	// HTTP 200 但没有任何窗口 = 该账号没有可读的订阅额度，不是 0% 用量。
	if (!windows.length) return { windows: [], extras: [{ kind: "plan", value: "未检测到订阅额度窗口" }], coverage: "partial" };
	const extras = [];
	// 实测：plan_type 给套餐档位（如 "plus"），值得显示。
	const plan = typeof body?.plan_type === "string" && body.plan_type.trim() ? body.plan_type.trim() : "";
	if (plan) extras.push({ kind: "plan", value: plan });
	const credits = body?.credits && typeof body.credits === "object" && !Array.isArray(body.credits) ? body.credits : {};
	const balance = typeof credits.balance === "string" && credits.balance.trim() ? credits.balance.trim() : typeof credits.balance === "number" ? String(credits.balance) : "";
	if (credits.has_credits === true && credits.unlimited !== true && balance && balance !== "0") extras.push({ kind: "balance", value: balance });
	return { windows: cascadeRateLimited(windows), extras, coverage: windows.length >= 2 ? "complete" : "partial" };
}
// DeepSeek 官方余额（余额型）：GET https://api.deepseek.com/user/balance，Bearer 与推理同一把 Key。
// 响应 { is_available, balance_infos: [{ currency, total_balance, granted_balance, topped_up_balance }] }，
// 金额是**字符串十进制**。余额没有上限也就没有百分比：不产出窗口，只产出 extras。
export function normalizeDeepseekBalance(body) {
	if (typeof body?.is_available !== "boolean") throw failure("subusage/response", "Invalid DeepSeek balance response");
	const infos = Array.isArray(body.balance_infos) ? body.balance_infos : [];
	const row = infos.find(item => item && typeof item.currency === "string" && typeof item.total_balance === "string" && /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)$/.test(item.total_balance));
	if (!row) throw failure("subusage/response", "DeepSeek 响应没有可用的余额信息");
	const currency = /^[A-Z]{3}$/.test(row.currency) ? row.currency : "";
	const extras = [{ kind: "balance", value: `${row.total_balance} ${currency}`.trim() }];
	// 余额不可用是行动项（去充值），不是 0 元余额的展示问题。
	if (body.is_available === false) extras.push({ kind: "plan", value: "余额不足，请充值" });
	return { windows: [], extras, coverage: "complete" };
}
// OpenRouter：/key 给 key 级限额与日/周/月用量（任意 key 可读），/credits 给账户余额
// （只对 management / provisioning key 开放）。余额拿不到时**静默降级**为只显示限额，
// 不因为余额端点 403 就把整个条目判失败。
// https://openrouter.ai/docs/api/api-reference/api-keys/get-current-key
export function normalizeOpenRouter(keyBody, creditBody) {
	const data = keyBody?.data;
	if (!data || typeof data !== "object" || Array.isArray(data)) throw failure("subusage/response", "Invalid OpenRouter key response");
	const num = value => typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : undefined;
	const windows = [];
	const limit = num(data.limit), remaining = num(data.limit_remaining);
	if (limit !== undefined && limit > 0 && remaining !== undefined) {
		const kind = data.limit_reset === "monthly" ? "month" : data.limit_reset === "weekly" ? "week" : data.limit_reset === "daily" ? "day" : "period";
		windows.push(windowRow(kind, Math.max(0, limit - remaining) / limit * 100, undefined, undefined, { used: Math.round(Math.max(0, limit - remaining) * 100) / 100, limit, unit: "credits" }));
	}
	// 免费档没有 key 限额，但有免费模型的每日请求上限：它同样是一个真实窗口。
	const free = data.free_model_daily_requests;
	const freeLimit = num(free?.limit), freeUsed = num(free?.used);
	if (freeLimit !== undefined && freeLimit > 0 && freeUsed !== undefined) {
		windows.push(windowRow("day", Math.min(100, freeUsed / freeLimit * 100), undefined, undefined, { used: freeUsed, limit: freeLimit, unit: "requests" }));
	}
	const extras = [];
	const credits = creditBody?.data;
	const total = num(credits?.total_credits), spent = num(credits?.total_usage);
	if (total !== undefined && spent !== undefined) extras.push({ kind: "balance", value: `${Math.round(Math.max(0, total - spent) * 100) / 100} USD` });
	if (data.is_free_tier === true) extras.push({ kind: "plan", value: "Free tier" });
	if (!windows.length && !extras.length) throw failure("subusage/response", "OpenRouter 响应没有可用的限额或余额");
	return { windows: cascadeRateLimited(windows), extras, coverage: windows.length ? "complete" : "partial" };
}
// ── 余额型聚合商（各家单位与形状都不同，逐个显式换算，不做通用折算）────────────────
/** Novita：金额单位是 1/10000 USD（10000 = $1.00）。 */
export function normalizeNovitaBalance(body) {
	const num = value => typeof value === "number" && Number.isFinite(value) ? value : undefined;
	const available = num(body?.availableBalance);
	if (available === undefined) throw failure("subusage/response", "Invalid Novita balance response");
	return { windows: [], extras: [{ kind: "balance", value: `${Math.round(available / 100) / 100} USD` }], coverage: "complete" };
}
/** Hyperbolic：balanceCents 是美分。 */
export function normalizeHyperbolicBalance(body) {
	const cents = typeof body?.balanceCents === "number" && Number.isFinite(body.balanceCents) ? body.balanceCents : undefined;
	if (cents === undefined) throw failure("subusage/response", "Invalid Hyperbolic balance response");
	return { windows: [], extras: [{ kind: "balance", value: `${Math.round(cents) / 100} USD` }], coverage: "complete" };
}
/**
 * DeepInfra：预付资金以**负的** stripe_balance 表示，可用金额要取负；正值代表欠款。
 * 欠款是行动项，单独提示而不是显示成负余额。
 */
export function normalizeDeepinfraBalance(body) {
	const raw = typeof body?.stripe_balance === "number" && Number.isFinite(body.stripe_balance) ? body.stripe_balance : undefined;
	if (raw === undefined) throw failure("subusage/response", "Invalid DeepInfra balance response");
	const available = Math.round(-raw * 100) / 100;
	const extras = [{ kind: "balance", value: `${Math.max(0, available)} USD` }];
	if (available < 0) extras.push({ kind: "plan", value: `欠款 ${Math.abs(available)} USD` });
	return { windows: [], extras, coverage: "complete" };
}
/** Chutes：{quota, used} 直接给绝对量；重置时刻接口不给，故不显示（不编造次日 00:00 UTC）。 */
export function normalizeChutesQuota(body) {
	const num = value => typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : undefined;
	const quota = num(body?.quota), used = num(body?.used);
	if (quota === undefined || used === undefined) throw failure("subusage/response", "Invalid Chutes quota response");
	if (quota <= 0) throw failure("subusage/response", "Chutes 配额为 0，无法计算比例");
	return { windows: [windowRow("period", Math.min(100, used / quota * 100), undefined, undefined, { used, limit: quota, unit: "quota" })], extras: [], coverage: "complete" };
}
/** Ollama Cloud：limits.{session,weekly,monthly}.usage 是 **0–1 小数**；任一层缺失就跳过该窗口。 */
export function normalizeOllamaCloudUsage(body) {
	const limits = body?.limits && typeof body.limits === "object" && !Array.isArray(body.limits) ? body.limits : {};
	const windows = [];
	for (const [field, kind] of [["session", "period"], ["weekly", "week"], ["monthly", "month"]]) {
		const usage = limits[field]?.usage;
		if (usage === undefined || usage === null) continue;
		if (typeof usage !== "number" || !Number.isFinite(usage) || usage < 0) throw failure("subusage/response", "Invalid Ollama Cloud usage");
		windows.push(windowRow(kind, Math.min(100, usage * 100)));
	}
	if (!windows.length) throw failure("subusage/response", "Ollama Cloud 响应没有可用的额度窗口");
	return { windows: cascadeRateLimited(windows), extras: [], coverage: windows.length >= 3 ? "complete" : "partial" };
}
/** Vercel AI Gateway：balance / total_used 是十进制字符串；没有限额也没有重置，只显示金额。 */
export function normalizeVercelCredits(body) {
	const decimal = value => typeof value === "string" && /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)$/.test(value.trim()) ? value.trim() : typeof value === "number" && Number.isFinite(value) ? String(value) : undefined;
	const balance = decimal(body?.balance) ?? decimal(body?.data?.balance);
	if (balance === undefined) throw failure("subusage/response", "Invalid Vercel AI Gateway credits response");
	return { windows: [], extras: [{ kind: "balance", value: `${balance} USD` }], coverage: "complete" };
}
// ZenMux：订阅配额走 subscription/detail（`quota_5_hour.usage_percentage` 是 **0–1 小数**），
// PAYG 余额走 payg/balance。两个端点都**只认 Management API Key**（推理 key 不适用），
// 因此继承变量单独命名，避免用户把推理 key 填进来。
// https://docs.zenmux.ai/api/platform/subscription-detail
export function normalizeZenmux(subscriptionBody, balanceBody) {
	const num = value => typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : undefined;
	const windows = [], extras = [];
	const data = subscriptionBody?.data && typeof subscriptionBody.data === "object" && !Array.isArray(subscriptionBody.data) ? subscriptionBody.data : {};
	const quota = data.quota_5_hour && typeof data.quota_5_hour === "object" ? data.quota_5_hour : {};
	const usage = num(quota.usage_percentage);
	if (usage !== undefined) {
		const detail = num(quota.used_flows) !== undefined && num(quota.max_flows) !== undefined ? { used: quota.used_flows, limit: quota.max_flows, unit: "flows" } : undefined;
		windows.push(windowRow("5h", Math.min(100, usage * 100), typeof quota.resets_at === "string" ? quota.resets_at : undefined, undefined, detail));
	}
	const tier = data.plan && typeof data.plan.tier === "string" ? data.plan.tier.trim() : "";
	if (tier) extras.push({ kind: "plan", value: tier });
	const balance = balanceBody?.data && typeof balanceBody.data === "object" && !Array.isArray(balanceBody.data) ? balanceBody.data : {};
	const total = num(balance.total_credits);
	if (total !== undefined) {
		const currency = typeof balance.currency === "string" && /^[A-Za-z]{3}$/.test(balance.currency) ? balance.currency.toUpperCase() : "";
		extras.push({ kind: "balance", value: `${Math.round(total * 100) / 100} ${currency}`.trim() });
	}
	if (!windows.length && !extras.length) throw failure("subusage/response", "ZenMux 响应没有可用的配额或余额");
	return { windows: cascadeRateLimited(windows), extras, coverage: windows.length ? "complete" : "partial" };
}
/**
 * LiteLLM 的管理端点在 **proxy 根**（不是 /v1）：去掉尾部斜杠与常见的 /v1 后缀，
 * 否则会拼成 /v1/key/info 而 404。只接受 http(s)，其它协议一律视为未配置。
 */
export function litellmRoot(baseUrl) {
	const raw = typeof baseUrl === "string" ? baseUrl.trim() : "";
	if (!raw) return "";
	let url;
	try { url = new URL(raw); } catch { return ""; }
	if (url.protocol !== "http:" && url.protocol !== "https:") return "";
	const path = url.pathname.replace(/\/+$/, "").replace(/\/v1$/, "");
	return `${url.origin}${path}`;
}
/**
 * LiteLLM：`/key/info` 给 key 自身的预算与花费，`/user/info`｜`/team/info` 给更完整的视图。
 * 有预算上限才画进度；**没有上限时不编造百分比**，只如实显示已用金额。
 * 接口不给重置时刻时不显示重置（别把金额渲染成倒计时）。
 * https://docs.litellm.ai/docs/proxy/virtual_keys
 */
export function normalizeLitellm(keyBody, budgetBody) {
	const num = value => typeof value === "number" && Number.isFinite(value) ? value : undefined;
	const pick = value => value && typeof value === "object" && !Array.isArray(value) ? value : undefined;
	// 真实响应是 `{ key, info: {...} }`；也接受直接把字段放在顶层。
	const keyInfo = pick(keyBody?.info) ?? pick(keyBody);
	if (!keyInfo) throw failure("subusage/response", "Invalid LiteLLM key info response");
	const scope = pick(budgetBody) ?? {};
	const spend = num(scope.spend) ?? num(keyInfo.spend);
	const maxBudget = num(scope.max_budget) ?? num(keyInfo.max_budget);
	const resetAt = typeof scope.budget_reset_at === "string" ? scope.budget_reset_at : typeof keyInfo.budget_reset_at === "string" ? keyInfo.budget_reset_at : undefined;
	const round = value => Math.round(value * 100) / 100;
	if (spend !== undefined && maxBudget !== undefined && maxBudget > 0) {
		return { windows: [windowRow("period", Math.min(100, spend / maxBudget * 100), resetAt, undefined, { used: round(spend), limit: round(maxBudget), unit: "USD" })], extras: [], coverage: "complete" };
	}
	// 没有预算上限：没有百分比可算，如实给金额。
	if (spend !== undefined) return { windows: [], extras: [{ kind: "spend", value: `${round(spend)} USD` }], coverage: "complete" };
	throw failure("subusage/response", "LiteLLM 响应没有可用的预算或花费");
}
function detectConfigured(ctx) {
 try { const ids = new Set(ctx.llm.listProviders().map(p => p.id)); return Object.fromEntries(IDS.map(id => [id, ids.has(id)])); }
 catch { return undefined; }
}
const codec = (type, parse) => ({ mode: "strict", typeSymbol: `dsh-subusage#${type}`, schema: { parse }, create: () => ({ parse }) });
const resultCodec = codec("SubUsageResult", value => { if (!value || !Array.isArray(value.entries) || !value.settings || !value.configured || typeof value.updatedAt !== "string") throw invalid("Invalid result"); return value; });
function parseLoginStart(value) { if (!value || typeof value.expectedRevision !== "string" || !value.expectedRevision) throw invalid("Invalid login revision"); return { expectedRevision: value.expectedRevision }; }
function parseLoginCancel(value) { if (!value || typeof value.jobId !== "string" || !value.jobId) throw invalid("Invalid login job"); return { jobId: value.jobId }; }
const loginCodec = codec("SubUsageLoginState", value => {
 if (!value || !(value.jobId === null || typeof value.jobId === "string") || !["idle", "launching", "waiting", "verifying", "success", "cancelled", "error"].includes(value.state)) throw invalid("Invalid login state");
 if (value.result) resultCodec.schema.parse(value.result);
 return value;
});
export const subUsageRemote = {
 package: name,
 descriptors: [
  { id: `${name}#subUsage/read`, service: "subUsage", namespace: "subUsage", method: "read", invocation: { kind: "direct" }, parameters: [{ name: "request", wire: "request", source: "json", acceptsUndefined: true, codec: codec("SubUsageQuery", parseQuery) }], result: resultCodec },
  ...[["refresh", "request", "SubUsageQuery", parseQuery], ["save", "settings", "SubUsageSettings", parseSettings]].map(([method, param, type, parse]) => ({ id: `${name}#subUsage/${method}`, service: "subUsage", namespace: "subUsage", method, invocation: { kind: "direct" }, parameters: [{ name: param, wire: param, source: "json", codec: codec(type, parse) }], result: resultCodec })),
  { id: `${name}#subUsage/getMimoLoginStatus`, service: "subUsage", namespace: "subUsage", method: "getMimoLoginStatus", invocation: { kind: "direct" }, parameters: [], result: loginCodec },
  ...[["startMimoLogin", "MimoLoginStart", parseLoginStart], ["cancelMimoLogin", "MimoLoginCancel", parseLoginCancel]].map(([method, type, parse]) => ({ id: `${name}#subUsage/${method}`, service: "subUsage", namespace: "subUsage", method, invocation: { kind: "direct" }, parameters: [{ name: "request", wire: "request", source: "json", codec: codec(type, parse) }], result: loginCodec }))
 ]
};

// 可注入仅供隔离测试；生产仍由当前 manifest 的 Cordis ctx.plugin 注册。
export class SubUsageService extends TypertRemoteService {
 constructor(ctx, options = {}) {
  super(ctx, "subUsage"); this.ctx = ctx;
  this.io = options.io ?? { readFileSync, mkdirSync, writeFileSync, renameSync, chmodSync };
  this.path = options.configPath ?? CONFIG_PATH; this.fetcher = options.fetch ?? globalThis.fetch;
  this.now = options.now ?? Date.now;
  this.credentials = options.resolveCredentials ?? (async id => await ctx.get("credentials")?.resolve(credentialRef(PROVIDERS[id].envName)));
  this.environment = options.resolveEnvironment ?? (id => launchEnvironmentOf(ctx).get(PROVIDERS[id].envName));
  // 火山方舟的 AK/SK 不是路由的推理 Key，按固定变量名各自解析，两端都命中才算配对。
  this.credentialByName = options.resolveCredentialByName ?? (async refName => await ctx.get("credentials")?.resolve(credentialRef(refName)));
  this.environmentByName = options.resolveEnvironmentByName ?? (refName => launchEnvironmentOf(ctx).get(refName));
  // 额外账户按凭据引用名（apiKeyEnv）解析，与提供方插件 slots()/resolveRef 同一通道；
  // 默认账户仍走上面的 envName 链（凭据服务 → 启动环境 → ~/.commandcode/auth.json）。
  this.accountCredentials = options.resolveAccountCredentials ?? (async ref => await ctx.get("credentials")?.resolve(credentialRef(ref)));
  this.accountEnvironment = options.resolveAccountEnvironment ?? (ref => launchEnvironmentOf(ctx).get(ref));
  this.authFile = options.resolveAuthFile ?? (async () => commandCodeAuthFileKey(this.io));
  // SuperGrok 只读共享登录文件（~/.grok/auth.json 等）取 OAuth Bearer；可注入仅供隔离测试。
  this.grokAuth = options.resolveGrokAuth ?? (async () => grokAuthFileCredentials(this.io));
  // Codex 只读共享登录文件（$CODEX_HOME/auth.json 或 ~/.codex/auth.json）取 OAuth access token。
  this.codexAuth = options.resolveCodexAuth ?? (async () => codexAuthFileCredentials(this.io, { CODEX_HOME: (await this.environmentByName("CODEX_HOME"))?.value }));
  this.cache = new Map(); this.inflight = new Map(); this.generations = new Map(); this.fingerprints = new Map(); this.disposed = false; this.controller = new AbortController();
  this.login = new MimoLogin({
   error: failure,
   capture: revision => { const s = this.load(); if (revision !== hash(s)) throw failure("subusage/revision-conflict", "设置已被其他窗口修改，请重新读取"); return this.mimoMaterial(s); },
   verify: (cookie, signal) => { parseSettings({ providerId: "xiaomi-token-plan-cn", cookieUpdate: { action: "replace", value: cookie } }); return this.fetchProvider("xiaomi-token-plan-cn", { key: cookie, source: "cookie" }, this.load(), signal); },
   commit: (cookie, captured, verified, observedExpiresAt) => this.commitMimoLogin(cookie, captured, verified, observedExpiresAt),
   reconcileResult: result => {
    const latest = this.load();
    if (this.disposed || this.mimoMaterial(latest) !== this.loginResultMaterial) return null;
    // 同一身份也只回放当前缓存，旧额度已失效时不返回旧 entry。
    const entry = this.cache.get("xiaomi-token-plan-cn")?.entry;
    return this.result(latest, entry ? [redactMimo(entry, latest.xiaomi.cookie)] : []);
   }
  }, { now: this.now, ...options.mimoLogin });
  ctx.effect?.(() => () => this.dispose());
 }
 load() {
  try { return parseStored(JSON.parse(this.io.readFileSync(this.path, "utf8"))); }
  catch (e) { if (e?.code === "ENOENT") return defaultSettings(); throw failure("subusage/config", "无法读取订阅设置"); }
 }
 result(settings, entries) { return { updatedAt: new Date(this.now()).toISOString(), settings: publicSettings(settings), configured: detectConfigured(this.ctx), entries }; }
 async identity(id, s, account) {
  if (id === "xiaomi-token-plan-cn") return { key: s.xiaomi.cookie.trim(), source: s.xiaomi.cookie.trim() ? "cookie" : "none" };
  if (PROVIDERS[id].credentialKind === "volc") return await this.volcIdentity(id, s);
  if (id === "xai-oauth") {
   // SuperGrok 只认共享登录文件里的 OAuth Bearer：token 短命轮换，凭据服务/环境变量副本
   // 必然过期顶掉新 token，故不走通用 Key 链；user_id 随行给 x-userid 请求头，
   // expiresAt 用来在过期时给出「去刷一次」而不是「凭据已失效」。
   const cred = await this.grokAuth();
   return cred?.key ? { key: cred.key, source: "auth-file", ...(cred.userId ? { userId: cred.userId } : {}), ...(cred.expiresAt ? { expiresAt: cred.expiresAt } : {}) } : { key: undefined, source: "none" };
  }
  if (id === "openai-codex") {
   // 同上：只读 Codex CLI 的 OAuth 登录文件，token 由 Codex CLI 轮换，第三端刷新会互相顶掉。
   const cred = await this.codexAuth();
   return cred?.key ? { key: cred.key, source: "auth-file", ...(cred.accountId ? { accountId: cred.accountId } : {}) } : { key: undefined, source: "none" };
  }
  if (!PROVIDERS[id].managedByPlugin && s.keyModes[id] === "manual") return { key: s.keys[id]?.trim(), source: s.keys[id]?.trim() ? "manual" : "none" };
  if (id === "commandcode" && account && account !== "default") {
   // 额外账户：id 即凭据引用名（apiKeyEnv）。引用名不合法（不可能来自提供方
   // 插件的 slots，但 client 输入不可信）按未配置处理，不让 credentialRef 抛错。
   if (!isCredentialRefName(account)) return { key: undefined, source: "none" };
   const hit = await this.accountCredentials(account);
   if (typeof hit?.value === "string" && hit.value.trim()) return { key: hit.value.trim(), source: "credentials" };
   const env = await this.accountEnvironment(account);
   if (typeof env?.value === "string" && env.value.trim()) return { key: env.value.trim(), source: "env" };
   return { key: undefined, source: "none" };
  }
  const hit = await this.credentials(id);
  if (typeof hit?.value === "string" && hit.value.trim()) return { key: hit.value.trim(), source: "credentials" };
  const env = await this.environment(id);
  if (typeof env?.value === "string" && env.value.trim()) return { key: env.value.trim(), source: "env" };
  // 凭据由提供方插件管理的模型商：与它同一兜底读取官方 CLI 登录文件（cmd login）。
  if (PROVIDERS[id].managedByPlugin) {
   const fileKey = await this.authFile();
   if (typeof fileKey === "string" && fileKey.trim()) return { key: fileKey.trim(), source: "auth-file" };
  }
  return PROVIDERS[id].managedByPlugin ? { key: undefined, source: "none" } : { key: s.keys[id]?.trim(), source: s.keys[id]?.trim() ? "manual" : "none" };
 }
 // 火山方舟额度接口是 IAM Access Key 鉴权：AK 与 SK 必须**同源配对**。跨来源拼接
 // （例如拿路由的推理 Key 去配凭据库里的 SK）只会得到 401，且报错看不出根因。
 async volcIdentity(id, s) {
  const ak = s.volc.accessKeyId.trim(), sk = s.volc.secretAccessKey.trim();
  if (s.keyModes[id] === "manual") return ak && sk ? { key: ak, secret: sk, source: "manual" } : { key: undefined, secret: undefined, source: "none" };
  const credentialAk = await this.credentialByName(VOLC_ACCESS_KEY_ENV), credentialSk = await this.credentialByName(VOLC_SECRET_KEY_ENV);
  if (typeof credentialAk?.value === "string" && credentialAk.value.trim() && typeof credentialSk?.value === "string" && credentialSk.value.trim()) return { key: credentialAk.value.trim(), secret: credentialSk.value.trim(), source: "credentials" };
  const envAk = await this.environmentByName(VOLC_ACCESS_KEY_ENV), envSk = await this.environmentByName(VOLC_SECRET_KEY_ENV);
  if (typeof envAk?.value === "string" && envAk.value.trim() && typeof envSk?.value === "string" && envSk.value.trim()) return { key: envAk.value.trim(), secret: envSk.value.trim(), source: "env" };
  return ak && sk ? { key: ak, secret: sk, source: "manual" } : { key: undefined, secret: undefined, source: "none" };
 }
 async fetchProvider(id, identity, settings, signal = this.controller.signal) {
  const get = (url, headers, init) => fetchJson(this.fetcher, url, headers, signal, init);
  // 火山方舟额度走管控面 OpenAPI：POST 根路径 + Action/Version 在 query，鉴权是 AK/SK 签名。
  if (PROVIDERS[id].credentialKind === "volc") {
   const spec = PROVIDERS[id];
   const call = async (action, payload) => {
    const body = payload === undefined ? "{}" : JSON.stringify(payload);
    const signed = volcSignature({ accessKeyId: identity.key, secretAccessKey: identity.secret, action, host: spec.volcHost, region: spec.volcRegion, body });
    const response = await get(signed.url, signed.headers, { method: "POST", body });
    const apiError = volcError(response);
    if (apiError) throw volcFailure(action, apiError);
    return response;
   };
   // 额度线分组标注（AFP 的日限额只覆盖视觉 / 语音模型与 Harness）由 volcengine.js 的解析器产出，
   // 这里是把它带进 wire 的唯一通道：windowRow 只认五个字段，漏掉 groupLabel 会让前端静默失去分组。
   const toWindows = parsed => cascadeRateLimited(parsed.windows.map(w => ({ ...windowRow(w.kind, w.percent, w.resetsAt, w.percent >= 100 ? "rate-limited" : undefined, w.detail), ...(w.groupLabel ? { groupLabel: w.groupLabel } : {}) })));
   // 企业版/团队版：额度挂在席位上，先取 SeatID 再查该席位。
   if (spec.volcSeat) {
    const seatIds = parseVolcSeatIds(await call("ListSeatInfos", { Filter: {}, Scene: spec.volcScene, PageNum: 1, PageSize: 100 }));
    if (!seatIds.length) return { windows: [], extras: [{ kind: "plan", value: "该账号下没有可读的席位（或当前身份无权查看）" }], coverage: "partial" };
    const seatId = seatIds[0];
    // 多个席位时只看第一个，但如实说明总数，不假装看全了。
    const seatNote = seatIds.length > 1 ? `${seatId}（共 ${seatIds.length} 个席位）` : seatId;
    let parsed;
    try {
     parsed = spec.volcSeat === "agent"
      ? parseVolcSeatAfp(await call("GetSeatAFPUsage", { SeatIDs: [seatId] }))
      // GetSeatInfoUsage **确实有 Scene 参数**（官方契约 + ark-cli 源码一致）：Coding Plan 企业版传空字符串。
      // 传错值（如 "coding_plan"）会**静默返回空 SeatID 而不报错**，所以这里必须精确。
      : parseVolcSeatCoding(await call("GetSeatInfoUsage", { SeatID: seatId, Scene: "" }));
    } catch (error) { if (error instanceof RemoteError) throw error; throw failure("subusage/response", `火山方舟 ${spec.volcSeat === "agent" ? "GetSeatAFPUsage" : "GetSeatInfoUsage"} 的额度结构无法解析`); }
    const extras = [];
    if (parsed.plan) extras.push({ kind: "plan", value: parsed.plan });
    // 与个人版口径一致：没有窗口时说清「本周期没有可读额度」，而不是只给一个 partial 状态。
    extras.push({ kind: "account", value: parsed.windows.length ? `席位 ${seatNote}` : `席位 ${seatNote}（本周期没有可读的额度窗口）` });
    return { windows: toWindows(parsed), extras, coverage: parsed.windows.length ? "complete" : "partial" };
   }
   const body = await call(spec.volcAction);
   let parsed;
   try { parsed = spec.volcAction === "GetAFPUsage" ? parseVolcAgentPlan(body) : parseVolcCodingPlan(body); }
   catch { throw failure("subusage/response", `火山方舟 ${spec.volcAction} 的额度结构无法解析`); }
   const windows = toWindows(parsed);
   const extras = [];
   if (parsed.plan) extras.push({ kind: "plan", value: parsed.plan });
   // HTTP 200 但窗口为空是「未订阅」，不是 0% 用量：显式说明，不画零额度的假象。
   else if (!windows.length) extras.push({ kind: "plan", value: parsed.subscribed ? "本周期暂无窗口数据" : "未检测到该套餐订阅" });
   return { windows, extras, coverage: windows.length ? "complete" : "partial" };
  }
  const headers = { authorization: `Bearer ${identity.key}` };
  if (id === "synthetic") return normalizeSynthetic(await get("https://api.synthetic.new/v2/quotas", headers));
  if (id === "nanogpt") {
   const body = await get(identity.key.startsWith("sk-nano-mgmt-") ? "https://nano-gpt.com/api/management/v1/subscription/usage" : "https://api.nano-gpt.com/api/subscription/v1/usage", headers);
   // 余额走独立端点，且鉴权头是 x-api-key（不是 Bearer）；拿不到就静默降级，不影响配额展示。
   const balance = await get("https://nano-gpt.com/api/check-balance", { "x-api-key": identity.key }, { method: "POST", body: "{}" }).catch(() => undefined);
   return normalizeNanoGpt(body, balance);
  }
  if (id === "zai-coding") {
   const out = normalizeZai(await get("https://api.z.ai/api/monitor/usage/quota/limit", { authorization: identity.key }));
   return { windows: out.windows, extras: out.level ? [{ kind: "plan", value: out.level }] : [] };
  }
  if (id === "zai-coding-cn") {
   if (settings.zai.type === 2) { if (settings.zai.organization) headers["bigmodel-organization"] = settings.zai.organization; if (settings.zai.project) headers["bigmodel-project"] = settings.zai.project; }
   const out = normalizeZai(await get(`https://open.bigmodel.cn/api/monitor/usage/quota/limit?type=${settings.zai.type}`, headers));
   return { windows: out.windows, extras: out.level ? [{ kind: "plan", value: out.level }] : [] };
  }
  if (id === "kimi-coding") {
   const [body, me] = await Promise.all([get("https://api.kimi.com/coding/v1/usages", headers), get("https://api.kimi.com/coding/v1/me", headers).catch(() => undefined)]);
   return { windows: normalizeKimi(body), extras: typeof me?.user_level_name === "string" ? [{ kind: "plan", value: me.user_level_name }] : [] };
  }
  if (id === "opencode-go") return normalizeOpencodeGo(await get("https://opencode.ai/zen/go/v1/usage", headers));
   if (id === "minimax" || id === "minimax-cn") return normalizeMinimax(await get(PROVIDERS[id].usageUrl, headers));
  if (id === "siliconflow") return normalizeSiliconFlow(await get("https://api.siliconflow.cn/v1/user/info", headers));
  if (id === "deepseek") return normalizeDeepseekBalance(await get("https://api.deepseek.com/user/balance", headers));
  if (id === "openrouter") {
   const keyBody = await get("https://openrouter.ai/api/v1/key", headers);
   // 余额端点对普通推理 key 会 403；这一次失败不影响 key 限额与用量的展示。
   const creditBody = await get("https://openrouter.ai/api/v1/credits", headers).catch(() => undefined);
   return normalizeOpenRouter(keyBody, creditBody);
  }
  // 余额型聚合商：单体 GET，单位换算在各 normalize 里显式做。
  if (id === "novita") return normalizeNovitaBalance(await get("https://api.novita.ai/openapi/v1/billing/balance/detail", headers));
  if (id === "hyperbolic") return normalizeHyperbolicBalance(await get("https://api.hyperbolic.ai/v2/customer/balance", headers));
  if (id === "deepinfra") return normalizeDeepinfraBalance(await get("https://api.deepinfra.com/payment/checklist?compute_owed=true", headers));
  if (id === "chutes") return normalizeChutesQuota(await get("https://api.chutes.ai/users/me/quota_usage/me", headers));
  // Ollama Cloud 的鉴权是裸 Authorization：这里显式覆盖掉通用 Bearer。
  if (id === "ollama-cloud") return normalizeOllamaCloudUsage(await get("https://ollama.com/api/usage", { authorization: identity.key }));
  if (id === "vercel-ai-gateway") return normalizeVercelCredits(await get("https://ai-gateway.vercel.sh/v1/credits", headers));
  if (id === "zenmux") {
   // 订阅配额与 PAYG 余额各拿各的：任一失败不影响另一个。
   const [subscription, balance] = await Promise.all([
    get("https://zenmux.ai/api/v1/management/subscription/detail", headers).catch(() => undefined),
    get("https://zenmux.ai/api/v1/management/payg/balance", headers).catch(() => undefined)
   ]);
   return normalizeZenmux(subscription, balance);
  }
  if (id === "litellm") {
   // 地址是用户自己的 proxy；缺地址算「凭据不完整」，与缺 Key 一样给出可行动的指引。
   const root = litellmRoot(settings.litellm?.baseUrl);
   if (!root) throw failure("subusage/credentials", "未配置 LiteLLM 代理地址：在 设置 → 订阅用量 → LiteLLM 的「连接与凭据」里填写");
   const keyInfo = await get(`${root}/key/info`, headers);
   const own = keyInfo?.info && typeof keyInfo.info === "object" && !Array.isArray(keyInfo.info) ? keyInfo.info : {};
   // 更完整的预算视图在 user/team info；拿不到就退回 key 自身的 info。
   const scoped = typeof own.team_id === "string" && own.team_id.trim() ? `/team/info?team_id=${encodeURIComponent(own.team_id.trim())}`
    : typeof own.user_id === "string" && own.user_id.trim() ? `/user/info?user_id=${encodeURIComponent(own.user_id.trim())}` : "";
   const budget = scoped ? await get(`${root}${scoped}`, headers).catch(() => undefined) : undefined;
   return normalizeLitellm(keyInfo, budget);
  }
  if (id === "commandcode") {
   // 与提供方插件同一凭据来源，但直连计费接口并行拉取：其 report() 会对每个账户
   // 串行 whoami + 三个端点（60 秒预算），作为药丸刷新来源太慢。仅并行读取余额与套餐/账期；请求头对齐其 accountHeaders。
   const billingHeaders = { ...headers, "accept-encoding": "identity", "x-command-code-version": COMMAND_CODE_CLI_VERSION, "x-cli-environment": "production" };
   const [credits, subscription] = await Promise.all([
    get(`${COMMAND_CODE_API_BASE}/alpha/billing/credits`, billingHeaders),
    get(`${COMMAND_CODE_API_BASE}/alpha/billing/subscriptions`, billingHeaders).catch(() => undefined)
   ]);
   return normalizeCommandCode(credits, subscription);
  }
  if (id === "xai-oauth") {
   // 登录文件里的 access token 短命（实测 ~24 小时）。本插件**刻意不代刷**——refresh-token 轮换由
   // Grok CLI / dsh-grok-kit 各自的锁协议管理，第三端刷新会把它们的轮换顶掉。但「过期」这件事必须
   // 说清楚：不发这一枪的话，用户看到的是上游 401 转成的「登录或凭据已失效」，而他那边的 Grok Kit
   // 明明写着「已登录」——两边对不上，只会让人以为插件坏了。
   if (identity.expiresAt && Date.parse(identity.expiresAt) <= this.now()) {
    throw failure("subusage/auth", `Grok 登录文件的 access token 已于 ${new Date(identity.expiresAt).toLocaleString("zh-CN", { timeZone: "Asia/Shanghai" })} 过期。用一次 Grok CLI，或在 设置 → xAI Grok 里重新登录，都会刷新同一个文件（${GROK_AUTH_FILE}）；本插件不代刷，以免与它们的 refresh-token 轮换互相顶掉。`);
   }
   // 直连官方 Grok CLI 计费代理；X-XAI-Token-Auth 的取值是 token_header 字符串（xai-grok-cli）
   // 而非布尔，x-userid 取登录文件。套餐名走 /v1/settings（subscription_tier_display），
   // 失败不阻塞用量（回退 billing 响应里的 subscription_tier）。
   const grokHeaders = { ...headers, "x-xai-token-auth": GROK_TOKEN_AUTH, "x-grok-client-version": GROK_CLIENT_VERSION, ...(identity.userId ? { "x-userid": identity.userId } : {}) };
   const [billing, settings] = await Promise.all([
    get(`${GROK_API_BASE}/billing?format=credits`, grokHeaders),
    get(`${GROK_API_BASE}/settings`, grokHeaders).catch(() => undefined)
   ]);
   return normalizeSuperGrok(billing, settings);
  }
  if (id === "openai-codex") {
   // ChatGPT 后端私有接口：Bearer 是 Codex CLI 的 OAuth access token，不是 OPENAI_API_KEY。
   return normalizeCodexUsage(await get(`${CODEX_API_BASE}/wham/usage`, headers));
  }
  const base = "https://platform.xiaomimimo.com/api/v1";
  const h = { cookie: identity.key, origin: "https://platform.xiaomimimo.com", referer: "https://platform.xiaomimimo.com/#/console/balance", "x-timezone": "UTC+08:00" };
  let usageError;
  const [bal, detail, usage] = await Promise.all([get(`${base}/balance`, h), get(`${base}/tokenPlan/detail`, h).catch(e => { if (e.code === "subusage/auth") throw e; return undefined; }), get(`${base}/tokenPlan/usage`, h).catch(e => { if (e.code === "subusage/auth") throw e; usageError = e; return undefined; })]);
  // 普通刷新与登录验证都经过这里：服务端字段不可信，缓存前去除 Cookie 回显。
   const data = redactMimo(normalizeMimo(bal, detail, usage), identity.key);
  if (usageError) data.usageError = usageError;
  return data;
 }
 base(id, source, settings, account = "") {
  // MiMo 会话 Cookie 自签发起 24 小时有效；到期时间随每条 entry 下发，供药丸与设置页倒计时。
  const expiresAt = id === "xiaomi-token-plan-cn" ? isoStamp(settings?.xiaomi?.expiresAt) : null;
  // commandcode 记录本条用量所属账户（default 或额外账户引用名），供弹层标注与测试核对。
  const shown = id === "commandcode" ? { account: account !== "" ? account : "default" } : {};
  return { providerId: id, label: PROVIDERS[id].label, envName: PROVIDERS[id].envName, keySource: source, apiDetected: source === "none" ? null : true, coverage: "partial", freshness: "unknown", lastSuccessAt: null, lastAttemptAt: new Date(this.now()).toISOString(), retryable: false, retainPrevious: false, ...shown, ...(expiresAt ? { cookieExpiresAt: expiresAt } : {}) };
 }
 async provider(id, settings, force, account = "") {
  const startedGeneration = this.generations.get(id) ?? 0;
  let identity;
  try { identity = await this.identity(id, settings, account); }
  catch { this.cache.delete(id); return { ...this.base(id, "none", settings, account), state: "error", errorCode: "subusage/credentials", error: "无法解析凭据" }; }
  if (this.disposed) throw failure("subusage/disposed", "服务已卸载");
  if (startedGeneration !== (this.generations.get(id) ?? 0)) return this.provider(id, this.load(), force, account);
  if (!providerEnabled(settings, id)) {
   this.cache.delete(id); this.inflight.delete(id);
   return { ...this.base(id, identity.source, settings, account), state: "disabled", apiDetected: !!identity.key, windows: [], extras: [] };
  }
  // fingerprint 计入账户选择：切换账户后同 id 缓存/inflight 不串账（不同账户 key 必不同）；
  // 空串与 "default" 同为默认账户，归一后共享缓存。
  const fingerprint = hash([identity.key ?? "", identity.secret ?? "", identity.source, settings.keyModes[id], id === "zai-coding-cn" ? settings.zai : null, id === "commandcode" ? (account && account !== "default" ? account : "default") : null]);
  if (this.fingerprints.has(id) && this.fingerprints.get(id) !== fingerprint) this.generations.set(id, (this.generations.get(id) ?? 0) + 1);
  this.fingerprints.set(id, fingerprint);
  const generation = this.generations.get(id) ?? 0;
  const cached = this.cache.get(id);
  if (cached && cached.fingerprint !== fingerprint) this.cache.delete(id);
  const previous = cached?.fingerprint === fingerprint ? cached : undefined;
  const active = this.inflight.get(id);
  if (active?.fingerprint === fingerprint && active.generation === generation) return active.promise;
  const now = this.now();
  const resetDue = previous?.entry.windows?.some(w => Number.isFinite(Date.parse(w.resetsAt)) && Date.parse(w.resetsAt) > previous.at && Date.parse(w.resetsAt) <= now);
  if (previous && (now < previous.retryAt || !resetDue && !force && now - previous.at < TTL)) return previous.entry;
  const promise = (async () => {
   const base = this.base(id, identity.source, settings, account); let entry; let retryAt = 0; let failures = previous?.failures ?? 0;
   if (!identity.key) entry = { ...base, apiDetected: false, state: id === "xiaomi-token-plan-cn" ? "no-cookie" : "no-key", error: id === "xiaomi-token-plan-cn" ? "需登录或粘贴 Cookie" : id === "commandcode" ? (account && account !== "default" ? `未检测到账户 ${account} 的 Key：确认提供方插件已保存该账户的凭据（凭据服务或启动环境中无引用 ${account}）` : "未检测到 Key：可在 设置 → Command Code 登录、运行 cmd login，或使用 COMMANDCODE_API_KEY（凭据服务/启动环境）") : id === "xai-oauth" ? "未检测到 Grok 登录：可在 设置 → Grok Kit（xAI OAuth）登录、运行 grok login（共享登录文件 ~/.grok/auth.json）" : id === "openai-codex" ? "未检测到 Codex 订阅登录：运行 codex login 完成 ChatGPT 登录（登录文件需为 $CODEX_HOME/auth.json 或 ~/.codex/auth.json，且 auth_mode 为 chatgpt；API Key 模式取不到订阅额度）" : PROVIDERS[id].credentialKind === "volc" ? "未配置火山方舟 AK/SK：额度查询要 IAM Access Key（VOLC_ACCESSKEY / VOLC_SECRETKEY，或在本页填写），不是推理用的方舟 API Key" : "未配置 API Key", errorCode: "subusage/no-key" };
   else try {
    const data = await this.fetchProvider(id, identity, settings);
    const usageError = data.usageError; delete data.usageError;
    if (usageError?.details?.retryable && previous?.entry.lastSuccessAt) throw usageError;
    entry = { ...base, ...data, state: "ok", coverage: data.coverage ?? "complete", freshness: "fresh", lastSuccessAt: new Date(this.now()).toISOString() }; failures = 0;
    if (usageError) { entry.errorCode = usageError.code; entry.error = usageError.message; entry.retryable = usageError.details?.retryable === true; if (entry.retryable) retryAt = this.now() + Math.max(2000, usageError.details?.retryAfterMs ?? 0); }
   } catch (e) {
    const temporary = e instanceof RemoteError && e.details?.retryable === true;
    const retain = temporary && !!previous?.entry.lastSuccessAt;
    entry = { ...base, state: "error", error: e instanceof RemoteError ? e.message : "用量响应无效", errorCode: e instanceof RemoteError ? e.code : "subusage/response", retryable: temporary, retainPrevious: retain };
    if (retain) Object.assign(entry, { windows: previous.entry.windows, extras: previous.entry.extras, coverage: previous.entry.coverage, freshness: "stale", lastSuccessAt: previous.entry.lastSuccessAt });
    failures++;
    if (temporary) retryAt = this.now() + Math.max(e.details?.retryAfterMs ?? 0, Math.min(300000, 1000 * 2 ** Math.min(failures, 8)));
   }
   if (!this.disposed && generation === (this.generations.get(id) ?? 0)) this.cache.set(id, { fingerprint, entry, at: this.now(), retryAt, failures });
   if (this.disposed || generation !== (this.generations.get(id) ?? 0)) return { ...this.base(id, "none", settings, account), state: "error", errorCode: "subusage/config-changed", error: "读取期间配置已改变，请刷新" };
   return entry;
  })();
  this.inflight.set(id, { fingerprint, generation, promise });
  try { return await promise; } finally { if (this.inflight.get(id)?.promise === promise) this.inflight.delete(id); }
 }
 // 对外只读额度视图：供其他插件（ctx.get("subUsage").quota(...)）与 subusage_quota 工具使用。
 // **刻意不返回 settings，也不返回 keySource / apiDetected**：第三方消费者只需要额度，
 // 不需要知道本机配了哪些凭据，更不该拿到任何与 Key 相关的字段。
 async quota(request = {}) {
  if (this.disposed) throw failure("subusage/disposed", "服务已卸载");
  const asked = Array.isArray(request?.providerIds) ? request.providerIds.filter(id => typeof id === "string" && id.trim()) : [];
  const { ids: matched, unknown } = asked.length ? resolveProviderIds(asked) : { ids: [...IDS], unknown: [] };
  // 一个名字都没认出来，说明调用方手里的是**另一套命名**（最常见的就是 DSH 的 llm 路由名）。
  // 与其只回一句「不认识」，不如把全量数据一并给出：数据先给出去，怎么判断交给调用方。
  // 混合输入（认出一部分 + 认不出一部分）则只补上认出的那些，不额外放大请求量。
  const wanted = matched.length || !unknown.length ? matched : [...IDS];
  const settings = this.load();
  const force = request?.force === true;
  const entries = await Promise.all(wanted.map(id => this.provider(id, settings, force).catch(() => ({ providerId: id, label: PROVIDERS[id].label, state: "error", errorCode: "subusage/internal", error: "读取用量失败" }))));
  // 认不出的名字要回一条**可读**条目而不是静默丢掉：调用方（尤其是模型）无从知道本插件用的是
  // 路由 id，丢掉之后它只看到空列表，会当成「本机没配任何额度」——真正的原因只是名字没对上。
  // 放在最前面，免得淹没在几十条数据后面。
  const unknownEntries = unknown.map(name => ({
   providerId: name, label: name, state: "error", windows: [], extras: [], coverage: "partial", freshness: "unknown",
   error: `不认识提供商名「${name}」${wanted.length === IDS.length && matched.length === 0 ? "，下面是全部提供商的额度" : ""}。可以传本插件的 provider id（例如 deepseek、zai-coding-cn、kimi-coding、xiaomi-token-plan-cn），或直接传厂商名（zai、kimi、mimo、minimax、commandcode、grok、codex、ark、deepseek …）。省略 providers 也会查询全部 ${IDS.length} 条。`
  }));
  return {
   updatedAt: new Date(this.now()).toISOString(),
   providers: [...unknownEntries, ...entries.map(entry => ({
    providerId: entry.providerId,
    label: entry.label,
    state: entry.state,
    windows: Array.isArray(entry.windows) ? entry.windows : [],
    extras: Array.isArray(entry.extras) ? entry.extras : [],
    // 只输出真正有值的字段：视图里带 `undefined` 的键会被调用方的 schema 校验判成型别错误
    // （DSH 就会），而且「字段缺席」本来就该表示「这家没报告」，不是「报告了空」。
    ...(typeof entry.coverage === "string" ? { coverage: entry.coverage } : {}),
    ...(typeof entry.freshness === "string" ? { freshness: entry.freshness } : {}),
    ...(typeof entry.lastSuccessAt === "string" ? { lastSuccessAt: entry.lastSuccessAt } : {}),
    ...(entry.error ? { error: entry.error } : {})
   }))]
  };
 }
 async read(request) { return this.refresh(request && request.providerIds ? request : { providerIds: IDS, force: false }); }
 async refresh(request) {
  if (this.disposed) throw failure("subusage/disposed", "服务已卸载");
  const query = parseQuery(request); const settings = this.load();
  const entries = await Promise.all(query.providerIds.map(id => this.provider(id, settings, query.force, query.commandCodeAccount).catch(() => ({ ...this.base(id, "none", settings, query.commandCodeAccount), state: "error", errorCode: "subusage/internal", error: "读取用量失败" }))));
  // 客户端请求了本 Host 不认识的 provider（装了新版但还没重启 DSH）：回一条可读原因，
  // 否则它只会显示成「无数据」，用户无从判断是该重启还是该配凭据。
  const unknownEntries = (query.unknown ?? []).map(id => ({ providerId: id, label: id, state: "error", errorCode: "subusage/unknown-provider", error: "本机运行中的 Host 版本较旧，不认识该提供商；重启 DSH 后生效", apiDetected: null, coverage: "partial", freshness: "unknown", keySource: "none", retryable: false, retainPrevious: false, windows: [], extras: [] }));
  const latest = this.load();
  if (hash(latest) !== hash(settings)) return this.result(latest, [...query.providerIds.map(id => ({ ...this.base(id, "none", latest, query.commandCodeAccount), state: "error", errorCode: "subusage/config-changed", error: "读取期间配置已改变，请刷新" })), ...unknownEntries]);
  return this.result(latest, [...entries, ...unknownEntries]);
 }
 startMimoLogin(request) { return this.login.start(parseLoginStart(request)); } getMimoLoginStatus() { return this.login.status(); }
 cancelMimoLogin(request) { return this.login.cancel(parseLoginCancel(request)); }
 mimoMaterial(s) { const id = "xiaomi-token-plan-cn"; return hash([s.xiaomi.cookie, s.keys[id] ?? "", s.keyModes[id]]); }
 commitMimoLogin(cookie, captured, verified, observedExpiresAt) {
  const id = "xiaomi-token-plan-cn", s = this.load();
  if (this.disposed) throw failure("subusage/disposed", "服务已卸载");
  if (this.mimoMaterial(s) !== captured) throw failure("subusage/revision-conflict", "MiMo 设置已被修改，拒绝覆盖");
  this.persist({ providerId: id, expectedRevision: hash(s), cookieUpdate: { action: "replace", value: cookie } }, observedExpiresAt);
  const stored = this.load(); const data = { ...verified }; const usageError = data.usageError; delete data.usageError;
  const entry = { ...this.base(id, "cookie", stored), ...data, state: "ok", coverage: data.coverage ?? "partial", freshness: "fresh", lastSuccessAt: new Date(this.now()).toISOString(), ...(usageError ? { errorCode: usageError.code, error: "额度暂时无法读取", retryable: usageError.details?.retryable === true } : {}) };
  // 响应内容也不得回显本次 Cookie（服务端字段属于不可信输入）。
  const safeEntry = redactMimo(entry, cookie);
  // 指纹段必须与 provider() 的五段顺序逐位对齐：MiMo 没有 secret，第二段固定空串。
  // 少一段会让登录提交后的首次刷新认不出同一份缓存，重复拉取。
  const fingerprint = hash([cookie, "", "cookie", stored.keyModes[id], null, null]);
  this.fingerprints.set(id, fingerprint); this.cache.set(id, { fingerprint, entry: safeEntry, at: this.now(), retryAt: usageError ? this.now() + 15000 : 0, failures: 0 });
  this.loginResultMaterial = this.mimoMaterial(stored);
  return this.result(stored, [safeEntry]);
 }
 async save(settings) { return this.persist(settings); }
 persist(settings, cookieCap) {
  if (this.disposed) throw failure("subusage/disposed", "服务已卸载");
  const patch = parseSettings(settings); const stored = this.load();
  // 未知 provider：这是「客户端已更新、Host 还没重启」的版本窗口期，给出可读原因而不是静默写入垃圾配置。
  // 只改可见性的 patch 不带 providerId，不能因此被拒。
  if (patch.providerId !== undefined && !IDS.includes(patch.providerId)) throw failure("subusage/unknown-provider", "本机运行中的 Host 版本较旧，不认识该提供商；重启 DSH 后生效");
  if (patch.expectedRevision !== undefined && patch.expectedRevision !== hash(stored)) throw failure("subusage/revision-conflict", "设置已被其他窗口修改，请重新读取");
  const id = patch.providerId;
  // 火山方舟两个 provider 共用一组 AK/SK：改凭据要让所有用它的条目失效，不能只失效当前标签页。
  const sharedVolc = patch.accessKeyUpdate !== undefined || patch.secretKeyUpdate !== undefined;
  const affected = patch.visibility ? [...Object.keys(patch.visibility.providers ?? {}).filter(key => stored.visibility.providers[key] !== patch.visibility.providers[key]), ...(patch.visibility.ark !== undefined && patch.visibility.ark !== stored.visibility.ark ? ARK_IDS : [])] : sharedVolc ? IDS.filter(key => PROVIDERS[key].credentialKind === "volc") : [id];
  if (patch.visibility) {
   if (patch.visibility.hideWithoutApi !== undefined) stored.visibility.hideWithoutApi = patch.visibility.hideWithoutApi;
   // 组开关同时落到组内每一条：这样旧字段（逐条开关）与组开关始终一致，回退版本也不会读到矛盾状态。
   if (patch.visibility.ark !== undefined) { stored.visibility.ark = patch.visibility.ark; for (const key of ARK_IDS) stored.visibility.providers[key] = patch.visibility.ark; }
   Object.assign(stored.visibility.providers, patch.visibility.providers);
  }
  if (patch.keyMode !== undefined) stored.keyModes[id] = patch.keyMode;
  const update = (obj, key, op) => { if (op?.action === "replace") obj[key] = op.value; else if (op?.action === "clear") delete obj[key]; };
  update(stored.keys, id, patch.keyUpdate);
  if (patch.cookieUpdate?.action === "clear") { stored.xiaomi.cookie = ""; stored.xiaomi.loginAt = 0; stored.xiaomi.expiresAt = 0; } else if (patch.cookieUpdate?.action === "replace") {
   // 官方会话 Cookie 自签发起 24 小时有效；浏览器报告了更早的过期时间时以更早者为准。
   // 计时只在真正写入新 Cookie 时起算：keep 是“未改动”，不能借保存动作续满倒计时。
   update(stored.xiaomi, "cookie", patch.cookieUpdate);
   const at = this.now();
   stored.xiaomi.loginAt = at;
   stored.xiaomi.expiresAt = Math.min(at + MIMO_COOKIE_TTL_MS, Number.isSafeInteger(cookieCap) && cookieCap > at ? cookieCap : Number.POSITIVE_INFINITY);
  }
  if (patch.zai) stored.zai = patch.zai;
  if (patch.litellm) stored.litellm = patch.litellm;
  // volc 用「置空字符串」而不是 delete：这两个字段在内存里必须始终存在（publicSettings 会读它们），
  // 空串与 parseStored 的默认值同义 = 未配置。
  const updateVolc = (key, op) => { if (op?.action === "replace") stored.volc[key] = op.value; else if (op?.action === "clear") stored.volc[key] = ""; };
  updateVolc("accessKeyId", patch.accessKeyUpdate);
  updateVolc("secretAccessKey", patch.secretKeyUpdate);
  try { this.io.mkdirSync(dirname(this.path), { recursive: true, mode: 0o700 }); this.io.writeFileSync(`${this.path}.tmp`, JSON.stringify(stored, null, 2), { encoding: "utf8", mode: 0o600 }); this.io.chmodSync(`${this.path}.tmp`, 0o600); this.io.renameSync(`${this.path}.tmp`, this.path); }
  catch { throw failure("subusage/config", "无法保存订阅设置"); }
  for (const key of affected) { this.generations.set(key, (this.generations.get(key) ?? 0) + 1); this.cache.delete(key); this.inflight.delete(key); }
  return this.result(stored, []);
 }
 dispose() { this.login.dispose(); this.disposed = true; this.controller.abort(); this.cache.clear(); this.inflight.clear(); this.fingerprints.clear(); for (const id of IDS) this.generations.set(id, (this.generations.get(id) ?? 0) + 1); }
}
function registerRemotes(ctx) {
 ctx.inject(["typert"], scope => { scope.effect(() => scope.typert.register({ package: subUsageRemote.package, face: "host", schemas: [], model: { services: [], events: [], objects: [] }, invocations: subUsageRemote.descriptors })); });
}
function apply(ctx) { registerRemotes(ctx); ctx.plugin(SubUsageService, {}); registerQuotaTool(ctx); ctx.logger.info("dsh-subusage: usage service ready"); }
/**
 * 工具结果的人读文本：一行一个 provider，先给窗口再给余额，异常与未配置直说。
 * 这段文本才是模型真正读到的东西，所以**任何情况下都不返回空**：读不到数据时也要给出
 * 「怎么才能读到」的下一步，否则模型只会回一句「没有额度」，而原因其实是个可以修的动作项。
 */
function formatQuotaText(value) {
 const providers = Array.isArray(value?.providers) ? value.providers : [];
 if (!providers.length) return `没有读到任何提供商。请不带 providers 参数再调用一次以查询全部 ${IDS.length} 条；若仍为空，在设置页确认「检测」开关与凭据。`;
 const lines = providers.map(entry => {
  const head = `${entry.label || entry.providerId} [${entry.state}]`;
  if (entry.state === "no-key" || entry.state === "no-cookie") return `${head}：未配置凭据`;
  if (entry.state === "disabled") return `${head}：检测已关闭`;
  if (entry.state !== "ok") return `${head}：${entry.error || "读取失败"}`;
  const parts = [];
  for (const window of entry.windows || []) {
   parts.push(`${window.kind} ${window.status === "rate-limited" ? "已达限额" : `${Math.round(Math.max(0, 100 - window.percent) * 10) / 10}% 剩余`}${window.resetsAt ? `（重置 ${window.resetsAt}）` : ""}`);
  }
  for (const extra of entry.extras || []) parts.push(`${extra.kind}: ${extra.value}`);
  if (entry.freshness === "stale") parts.push("缓存数据");
  return `${head}：${parts.length ? parts.join("；") : "暂无额度数据"}`;
 });
 // 一条额度都没读到时，末尾补一句汇总原因：模型据此才能告诉用户下一步做什么。
 if (!providers.some(entry => entry.state === "ok")) {
  const missing = providers.filter(entry => entry.state === "no-key" || entry.state === "no-cookie").length;
  const off = providers.filter(entry => entry.state === "disabled").length;
  lines.push(`（这 ${providers.length} 条都没读到额度：未配置凭据 ${missing} 条、检测已关闭 ${off} 条；其余为读取失败。凭据与开关都在 dsh-subusage 设置页，或参考 docs/credentials.md。）`);
 }
 return lines.join("\n");
}
/**
 * 注册 subusage_quota 工具：模型可以直接问「额度还剩多少」，不必自己逐个厂商请求。
 * 工具只读：不写设置、不碰凭据，数据来自与设置页同一份缓存（TTL 60 秒）。
 */
function registerQuotaTool(ctx) {
 ctx.inject(["tools"], toolCtx => {
  toolCtx.tools.register(defineTool({
   name: "subusage_quota",
   description: "Read the remaining quota and balance of the AI subscriptions configured on this machine (DeepSeek, Z.ai, Kimi, MiMo, OpenCode Go, Command Code, Codex, SuperGrok, MiniMax, Volcengine Ark, OpenRouter, SiliconFlow, ...). Call it with no arguments to read every provider — that is the usual call. `providers` is an optional filter that accepts both this plugin's provider ids and plain vendor names (\"zai\", \"kimi\", \"mimo\", \"minimax\", \"commandcode\", \"grok\", \"codex\", \"ark\", \"deepseek\"); one name can match several routes and every match is returned with its own state, and a name that matches nothing still returns the full data plus an explanation instead of an empty result. Read-only: it never returns credentials and never changes settings. Each entry has state (ok | no-key | no-cookie | error | disabled), windows (percent is the USED percentage; absent resetsAt means the provider does not report one) and extras (plan name, balance). Results may come from a cache up to 60 seconds old; pass refresh=true only when the user explicitly needs up-to-date numbers.",
   parameters: {
    providers: { type: "array", items: { type: "string" }, description: "Optional filter. Either a provider id this tool reports back (\"deepseek\", \"zai-coding-cn\", \"kimi-coding\") or a plain vendor name (\"zai\", \"kimi\", \"mimo\", \"minimax\", \"commandcode\", \"grok\", \"codex\", \"ark\"). Case and separators do not matter; an unmatched name is reported with the full data rather than dropped." },
    refresh: { type: "boolean", description: "Force a fresh fetch instead of the up-to-60s cache. Use only when the user asks for the latest numbers." }
   },
   output: {
    schema: {
     type: "object",
     additionalProperties: false,
     properties: {
      updatedAt: { type: "string", required: true, description: "ISO timestamp of this reading." },
      providers: {
       type: "array",
       required: true,
       description: "One entry per provider.",
       items: {
        type: "object",
        additionalProperties: false,
        properties: {
         providerId: { type: "string", required: true, description: "Provider id (the route id), or the unmatched name that was passed in." },
         label: { type: "string", required: true },
         state: { type: "string", required: true, description: "ok | no-key | no-cookie | error | disabled" },
         windows: {
          type: "array", required: true, description: "Quota windows; percent is the USED percentage (0-100).",
          items: {
           // 这里刻意用 additionalProperties: true：窗口形态随厂商变化（有的给绝对量、有的给额度线标注），
           // 收紧成白名单只会让新增字段在运行时被判违规，而这里声明的字段仍照旧受型别约束。
           type: "object", additionalProperties: true,
           properties: {
            kind: { type: "string", required: true, description: "Window length: 5h | week | month | day | 7d | rolling | sub | period." },
            percent: { type: "number", required: true, description: "USED percentage 0-100; remaining = 100 - percent." },
            status: { type: "string", required: true, description: "ok | rate-limited" },
            resetsAt: { type: "string", description: "ISO reset time; absent when the provider does not report one." },
            groupLabel: { type: "string", description: "Credit line, when the provider has more than one (e.g. Volcengine AFP)." },
            cascade: { type: "boolean", description: "true when this window is only blocked by a wider exhausted window." },
            detail: {
             type: "object", additionalProperties: true, description: "Absolute amounts and scope notes, when the provider reports them.",
             properties: {
              used: { type: "number" }, limit: { type: "number" }, remaining: { type: "number" }, unit: { type: "string" },
              limitSource: { type: "string" }, note: { type: "string" }, blockedBy: { type: "array", items: { type: "string" } }
             }
            }
           }
          }
         },
         extras: {
          type: "array", required: true, description: "Non-window facts: plan name, balance, seat id, ... (kind/value).",
          items: { type: "object", additionalProperties: false, properties: {
           kind: { type: "string", required: true, description: "plan | balance | spend | account | monthly-balance | ..." },
           value: { type: "string", required: true }
          } }
         },
         coverage: { type: "string", description: "complete | partial" },
         freshness: { type: "string", description: "fresh | stale" },
         lastSuccessAt: { type: "string" },
         error: { type: "string", description: "Failure reason when state is error." }
        }
       }
      }
     }
    },
    render: (_args, value) => [{ type: "text", text: formatQuotaText(value) }]
   },
   execute: async (args, exec) => {
    exec?.signal?.throwIfAborted?.();
    const service = toolCtx.get("subUsage");
    if (!service || typeof service.quota !== "function") throw new Error("dsh-subusage 服务尚未就绪：Host 端可能还在启动或刚更新完还没重启。请稍后重试；持续失败就重启 DSH。");
    return await service.quota({ providerIds: args?.providers, force: args?.refresh === true });
   }
  }));
 });
}
export { apply, inject, name };
export default { name, inject, apply };
