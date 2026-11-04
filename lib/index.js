// dsh-subusage Host：秘密仅保存在 Host，远端只暴露 provider 补丁和公开设置。
import { RemoteError, TypertRemoteService } from "@deepseek-ai/dsh-typert-protocol";
import { defineTool } from "@deepseek-ai/dsh-tools";
import { credentialKey, credentialRef, isCredentialRefName } from "@deepseek-ai/dsh-credentials";
import { launchEnvironmentOf } from "@deepseek-ai/dsh-launch-environment";
import { chmodSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { createHash, randomUUID } from "node:crypto";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { MimoLogin } from "./mimo-login.js";
import { MimoQrLogin, renewMimoSession } from "./mimo-qr.js";
import { OpenDesignLogin, OPEN_DESIGN_CURRENT_URL, OPEN_DESIGN_SUMMARY_URL, openDesignUsageUrl } from "./opendesign-login.js";
import { GROK_GRPC_CREDITS_URL, GROK_GRPC_EMPTY_FRAME, parseGrokCreditsGrpcWeb } from "./grok-credits.js";
import { parseVolcAgentPlan, parseVolcCodingPlan, parseVolcSeatAfp, parseVolcSeatCoding, parseVolcSeatIds, volcError, volcSignature } from "./volcengine.js";
import { MOBILE_NO_BROWSER_MESSAGE, detectHostRuntime } from "./host-env.js";
import { OFM_CHANNELS, OFM_IDS, OfmReader, normalizeOfm } from "./ofm.js";
import { ConnectUsageReader, normalizeWorkBuddy, accountMetadata, MissingLinkedRequest } from "./connect-usage.js";
import { DesktopUsageReader, normalizeDesktopUsage } from "./desktop-usage.js";
import { EacUsageReader, normalizeEac, EAC_CHANNELS } from "./eac-usage.js";
import { LocalUsageReader, LOCAL_CHANNELS } from "./local-usage.js";
import { traeStorageCandidates, traePoolCandidates, readTraeCredentials } from "./trae-auth.js";
import { summarizeCreditPackages } from "./credit-packages.js";

const name = "dsh-subusage";
const VERSION = "0.24.2";
const inject = ["llm"];
const PROVIDERS = {
 "zai-coding-cn": { label: "Z.ai", envName: "ZAI_CODING_CN_API_KEY" },
 "zai-coding": { label: "Z.ai International", envName: "ZAI_CODING_API_KEY", defaultEnabled: false },
 "synthetic": { label: "Synthetic", envName: "SYNTHETIC_API_KEY", defaultEnabled: false },
 "nanogpt": { label: "NanoGPT", envName: "NANOGPT_API_KEY", defaultEnabled: false },
 "kimi-coding": { label: "Kimi", envName: "KIMI_CODING_API_KEY" },
 "xiaomi-token-plan-cn": { label: "MiMo", envName: "XIAOMI_TOKEN_PLAN_CN_API_KEY" },
 // OpenCode Go 的额度接口只有一把订阅 Key，但**凭据引用名有两种写法**：pi-ai 内置的
 // `opencode-go` 路由默认读 `OPENCODE_API_KEY`（与 OpenCode Zen 余额共用同一变量名）；把 Go 套餐
 // 单列一把 Key 时，路由的 `apiKeyEnv` 写成 `OPENCODE_GO_API_KEY`（DSH Models 页保存的引用名就是它）。
 // 两个引用都认——专属名优先、通用名回退，见 credentialRefNames()。只认其中一个，就会出现
 // 「路由能正常调用、额度却报无凭据」这种自相矛盾的状态。
 "opencode-go": { label: "OpenCode Go", envName: "OPENCODE_GO_API_KEY", envAliases: ["OPENCODE_API_KEY"] },
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
 "xai-oauth": { label: "Grok (X / SuperGrok)", envName: "", managedByPlugin: true },
 // OpenAI Codex / ChatGPT 订阅：路由由 DSH 内置的 openai-codex（或 dsh-codex-connect 等插件）提供，
 // 额度凭据只认 Codex CLI 的 OAuth 登录文件，不提供本地凭据编辑。
 // 默认关闭：Codex 的提供方插件自己就带用量药丸，两个药丸并排只是重复信息（仍可手动开启）。
 "openai-codex": { label: "Codex (ChatGPT)", envName: "", managedByPlugin: true, defaultEnabled: false },
 // 火山方舟：方舟路由由两种方式写入——官方 CLI（arkcli helper，见下）或官方插件
 // @volcengine/ark-plan-api（legacy 段）。**provider id 必须与写入方逐字一致**，
 // 否则选中方舟模型时药丸不会出现。额度读取走管控面 OpenAPI，凭据是 IAM 的 AK/SK 配对
 // （HMAC-SHA256 签名），与这些路由的推理 API Key 是两套：拿推理 Key 去查额度会被上游拒绝
 // （"GetAFPUsage requires Volcengine Ark SSO STS"）。
 // 4 条 volc 路由共用一组 AK/SK（settings.volc）：个人版各自固定一个 Action，
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
 // ── 旧插件 @volcengine/ark-plan-api 的三条路由已全部移除 ──────────────────
 // 国内两条（`ark-coding-plan-cn` / `ark-agent-plan-cn`）与 arkcli 的路由请求 URL 逐字相同（同 Action、
 // 同 host、同 AK/SK、同一份订阅），并列显示只会让人以为买了两个套餐，数字还会因各自缓存而差出几十秒。
 // BytePlus 那条（`ark-coding-plan-byteplus`）走 `ark.ap-southeast-1.byteplusapi.com`：域名与 Action
 // **确实存在**（返回的是业务信封错误 NotFound.BillingType，不是路由不存在），但本机没有 BytePlus 账号
 // 可验证，实现正确性无从确认，因此不再保留——取舍与证据记在 docs/provider-coverage.md。
 // 国内那两个 id 药丸仍认：Client 的 ROUTE_PROVIDER_ALIAS 把它们归并到 arkcli 路由。
 // DeepSeek 官方：余额型（不是订阅窗口），与推理**同一把** API Key，端点与响应见官方文档
 // https://api-docs.deepseek.com/zh-cn/api/get-user-balance
 "deepseek": { label: "DeepSeek API", envName: "DEEPSEEK_API_KEY" },
 "deepseek-account": { label: "DeepSeek 账号", envName: "", managedByPlugin: true },
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
 "litellm": { label: "LiteLLM", envName: "LITELLM_API_KEY", defaultEnabled: false },
 // OpenDesign：Design Plan 订阅额度（5 小时 / 7 天窗）走控制台接口，凭据是
 // **浏览器登录会话 Cookie**（不是 sk- API Key），故继承变量单独命名以免误填模型 Key。
 // 未获默认开启需求，按仓库约定默认关闭。
 "opendesign": { label: "OpenDesign", envName: "OPEN_DESIGN_COOKIE", defaultEnabled: false },
 // GitHub Copilot：路由是 DSH 内置 pi-ai 的 `github-copilot`，登录由 @inventec/dsh-copilot-auth 的设备码流程写入
 // 凭据库记录 `llm-pi-ai/github-copilot`。额度取 GitHub 私有接口 /copilot_internal/user，凭据复用该记录里
 // **长期的 GitHub OAuth token**（`refresh`）；只读、不续期、不写回，不提供本地凭据编辑。
 // 未获默认开启需求，按仓库约定默认关闭。
 "github-copilot": { label: "GitHub Copilot", envName: "", managedByPlugin: true, defaultEnabled: false },
 // ── 中转聚合商 ─────────────────────────────────────────────────────────
 // APIGOTO：`GET /v1/usage` 用推理 Key 的 Bearer 就能读，一次给出订阅窗口（rpm_credits 口径）
 // 与 USD 余额。窗口长度由响应里的 window_sec 决定，不从套餐名反推。
 "apigoto": { label: "APIGOTO", envName: "APIGOTO_API_KEY", usageUrl: "https://api.apigoto.com/v1/usage", defaultEnabled: false }
};
const IDS = Object.keys(PROVIDERS);
/**
 * 某家 provider 的凭据引用名，按优先级排列：`envName` 是主名，`envAliases` 是同一份凭据的
 * 其它写法（目前只有 OpenCode Go：`OPENCODE_GO_API_KEY` → 回退 `OPENCODE_API_KEY`）。
 * 逐个名字走「凭据服务 → 启动环境」，**名字之间不跨源拼接**——主名两边都没有才看下一个名字，
 * 否则通用名里那把 Zen 余额 Key 会被当成 Go 订阅 Key 拿去查额度。
 */
const credentialRefNames = id => PROVIDERS[id].envAliases?.length ? [PROVIDERS[id].envName, ...PROVIDERS[id].envAliases] : [PROVIDERS[id].envName];
// 火山方舟的路由共用同一组 IAM AK/SK，设置页合并成一张卡片；个人版与 Team 分开检测。
// 这些 id 仍各自存在——药丸要靠 provider id 匹配路由，不能合并。
const ARK_IDS = IDS.filter(id => PROVIDERS[id].credentialKind === "volc");
const ARK_TEAM_IDS = ARK_IDS.filter(id => id.endsWith("-team"));
const ARK_PERSONAL_IDS = ARK_IDS.filter(id => !ARK_TEAM_IDS.includes(id));
const ARK_DEFAULT_ON = ARK_PERSONAL_IDS.some(id => PROVIDERS[id].defaultEnabled !== false);
/**
 * 兄弟插件联动 provider：**不进 `PROVIDERS`**。它们没有自己的凭据，额度由提供方插件算好
 * 之后交出来；进了 `PROVIDERS` 就会长出凭据编辑器与「未配置凭据」之类根本不成立的
 * 提示。Antigravity 另用 `visibility.antigravity` 单独控制，仍不占普通 provider 行。
 * 取数通道有两种，区别只在 `via`：
 *  - `agyQuota`：兄弟插件注册的 Cordis 服务（`dsh-antigravity-acp` 的 `agyQuota.read()`）；
 *  - `trae-route`：兄弟插件注册在**本机 web 服务器**上的只读 HTTP 路由
 *    （`dsh-connect-trae` 的 `/plugins/dsh-connect-trae/usage?region=<panel>`，它自己的卡片
 *    也读这条路由）。该插件没有暴露 Cordis 服务，这是它唯一对外的只读口。
 * 联动是**探测式**的：通道不在（未安装 / 未加载 / 版本旧）时静默不出条目。
 */
const ANTIGRAVITY_ID = "antigravity";
const TRAE_PLUGIN_USAGE_ROUTE = "/plugins/dsh-connect-trae/usage";
const LINKED_PROVIDERS = {
	// Antigravity 在本机有两个互不相干的提供方插件，读的是同一份 Google Antigravity 配额：
	//  - `agyQuota`：dsh-antigravity-acp 注册的 Cordis 服务（QuotaSnapshot：分组 + plan + AI Credits）；
	//  - `antigravityAuth`：dsh-tool-antigravity 注册的 Cordis 服务（QuotaStatusView：gemini/non-gemini
	//    两组各带 5h / weekly 窗口）。两个插件可能只装了一个：agyQuota 信息更全故优先，缺席再回落
	//    antigravityAuth；同一份订阅只出一条，绝不并列两行让人误以为买了两个套餐。
	[ANTIGRAVITY_ID]: { label: "Antigravity", via: "agyQuota", channels: ["agyQuota", "antigravityAuth"] },
	// dsh-connect-trae 在本机注册的三个 provider 路由，各自对应它卡片里的一个 tab。
	// id 与它自己的 DSH 路由 id 逐字一致，模型选中对应模型时看到的是同一套命名。
	trae: { label: "Trae", via: "trae-route", panel: "cn" },
	"trae-global": { label: "Trae Global", via: "trae-route", panel: "ai" },
	"trae-enterprise": { label: "Trae 企业版", via: "trae-route", panel: "enterprise" },
	workbuddy: { label: "WorkBuddy", via: "workbuddy-route", panel: "cn" },
	"workbuddy-global": { label: "WorkBuddy Global", via: "workbuddy-route", panel: "global" },
	// Loomy / Raccoon / Qoder 中国版 还有第二个来源：EAC 三渠道（dsh-eac-router）的
	// `/api/eac-router` 只读额度。三处读的是同一批账号，所以**不并列成新条目**：现有来源
	// （独立 connect 插件 → Our Free Model）缺席时才回退到 EAC，`eac` 字段就是回退用的渠道名。
	raccoon: { label: "小浣熊", via: "desktop-route", channel: "raccoon", eac: "raccoon" },
	loomy: { label: "Loomy", via: "desktop-route", channel: "loomy", eac: "loomy" },
	...Object.fromEntries(Object.entries(OFM_CHANNELS).map(([channel, label]) => [`ofm-${channel}`, { label: `${label} · OFM`, via: "ofm", channel }])),
	// Qoder 中国版只经 OFM 报告，故 EAC 作为 ofm-qodercn 的回退。
	"ofm-qodercn": { label: "Qoder CN · OFM", via: "ofm", channel: "qodercn", eac: "qodercn" }
};
const LINKED_IDS = Object.keys(LINKED_PROVIDERS);
// 只在 Host 内用于工具去重；Symbol 不进入公开 RPC/JSON，也不携带凭据引用。
const QUOTA_SOURCE = Symbol("quotaSource");
/** 这几种 via 走兄弟插件注册在本机 web 服务器上的 HTTP 路由：宿主进程取不到（无浏览器凭据），只能由页面代取。 */
const CLIENT_FETCH_VIA = new Set(["trae-route", "workbuddy-route", "desktop-route"]);
/** 由 via 派生的提供商 id 集合：Client 侧必须与它一致（test-contract 断言），不要另写一张表。 */
export const CLIENT_FETCH_LINKED_IDS = Object.keys(LINKED_PROVIDERS).filter(id => CLIENT_FETCH_VIA.has(LINKED_PROVIDERS[id].via));
/** 一条上游响应的稳定键：endpoint + 排序后的 query，页面原样带回即可对应上。 */
function linkedRequestKey(endpoint, query) {
	const pairs = Object.entries(query || {}).filter(([, value]) => typeof value === "string" && value).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
	return [endpoint, ...pairs.map(([key, value]) => `${key}=${value}`)].join("|");
}
/** 兄弟插件的只读路由地址（相对本机 origin）；页面直接 fetch 它。 */
function linkedRouteUrl(meta, endpoint, query) {
	const desktop = meta.via === "desktop-route";
	const plugin = desktop ? meta.channel : meta.via === "trae-route" ? "trae" : "workbuddy";
	const url = new URL(`/plugins/${desktop ? `dsh-${plugin}-connect` : `dsh-connect-${plugin}`}/${endpoint}`, "http://127.0.0.1");
	for (const [key, value] of Object.entries(query || {})) if (["region", "accountId", "detail"].includes(key) && typeof value === "string") url.searchParams.set(key, value);
	return `${url.pathname}${url.search}`;
}
/** 指向本机的 origin（dsh-connect-trae 的 loopback 校验只认 hostname）。 */
function isLoopbackOrigin(origin) {
	try {
		const { hostname } = new URL(origin);
		return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "[::1]" || hostname === "::1";
	} catch { return false; }
}
/**
 * 联动 provider 的别名表：模型手里可能是插件名、缩写 `agy`，也可能是 Trae 的某个 tab。
 * `trae` 与 `zai` 同口径：一个厂商名命中多条路由时**全部返回**，由调用方按各自的 state 挑。
 */
const LINKED_ALIASES = {
	antigravity: ["antigravity"], agy: ["antigravity"], "antigravity-acp": ["antigravity"],
	"antigravity acp": ["antigravity"], "dsh-antigravity-acp": ["antigravity"],
	// dsh-tool-antigravity 的模型路由 id 与包名：它是本机实际安装的 Antigravity 提供方插件。
	"google-antigravity": ["antigravity"], "google antigravity": ["antigravity"],
	"dsh-tool-antigravity": ["antigravity"], "tool-antigravity": ["antigravity"],
	trae: ["trae", "trae-global", "trae-enterprise"], "dsh-connect-trae": ["trae", "trae-global", "trae-enterprise"],
	"trae cn": ["trae"], "trae 国内版": ["trae"],
	"trae ai": ["trae-global"], "trae global": ["trae-global"], "trae 国际版": ["trae-global"],
	"trae enterprise": ["trae-enterprise"], "trae 企业版": ["trae-enterprise"],
	workbuddy: ["workbuddy", "workbuddy-global"], "dsh-connect-workbuddy": ["workbuddy", "workbuddy-global"],
	"workbuddy cn": ["workbuddy"], "workbuddy global": ["workbuddy-global"],
	ofm: OFM_IDS, "our free model": OFM_IDS, "our free models": OFM_IDS, "dsh-our-free-model": OFM_IDS,
	racoon: ["raccoon", "ofm-raccoon"],
	"小浣熊": ["raccoon", "ofm-raccoon"], raccoon: ["raccoon", "ofm-raccoon"], loomy: ["loomy", "ofm-loomy"],
	"dsh-raccoon-connect": ["raccoon"], "dsh-loomy-connect": ["loomy"],
	qoder: ["ofm-qoder", "ofm-qodercn"], qodercn: ["ofm-qodercn"], "qoder 中国版": ["ofm-qodercn"],
	lobsterai: ["ofm-lobsterai"], cline: ["ofm-cline"], zcode: ["ofm-zcode"], gemini: ["ofm-gemini"]
};
/**
 * 某条路由当前是否启用。Ark 个人版与 Team 各有组开关，互不影响；这里必须与 Client
 * 的 `providerEnabled` 同语义，避免界面显示已开启而 Host 返回 disabled。
 */
function providerEnabled(settings, id) {
	if (PROVIDERS[id]?.credentialKind !== "volc") return !!settings?.visibility?.providers?.[id];
	return ARK_TEAM_IDS.includes(id) ? settings?.visibility?.arkTeam === true : settings?.visibility?.ark === true;
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
	supergrok: ["xai-oauth"], grok: ["xai-oauth"], xai: ["xai-oauth"], xsubscription: ["xai-oauth"],
	"deepseek-official": ["deepseek-account"], "deepseek api": ["deepseek"], "deepseek 账号": ["deepseek-account"],
	codex: ["openai-codex"], chatgpt: ["openai-codex"], gpt: ["openai-codex"], openai: ["openai-codex"],
	copilot: ["github-copilot"], ghc: ["github-copilot"], ghcp: ["github-copilot"], "dsh-copilot-auth": ["github-copilot"],
	ark: ARK_IDS, volcengine: ARK_IDS, volc: ARK_IDS, "火山": ARK_IDS, "方舟": ARK_IDS, "火山方舟": ARK_IDS, doubao: ARK_IDS, "豆包": ARK_IDS
};
/** 查表用的键：大小写与分隔符都无关，`Z.AI` / `zai_coding_cn` / `zai-coding-cn` 视为同一个词。 */
function normalizeProviderKey(value) { return String(value ?? "").trim().toLowerCase().replace(/[\s._-]+/g, ""); }
/**
 * 归一化索引：id 与别名都进同一张表，因此「精确 id」只是这张表的一个特例。
 * 一个键可以指向多条路由（`zai` → 中国版 + 国际版，`ark` → 4 条）。
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
/** 联动 provider 的同一个索引：键空间独立，避免与 `PROVIDERS` 中的 id 互相覆盖。 */
const LINKED_LOOKUP = (() => {
	const map = new Map();
	const add = (key, id) => {
		const k = normalizeProviderKey(key);
		if (!k) return;
		const list = map.get(k) ?? [];
		if (!list.includes(id)) list.push(id);
		map.set(k, list);
	};
	for (const id of LINKED_IDS) add(id, id);
	for (const [alias, ids] of Object.entries(LINKED_ALIASES)) for (const id of ids) if (LINKED_IDS.includes(id)) add(alias, id);
	return map;
})();
/**
 * 把调用方给的任意写法收敛成 provider id，**纯名字解析、不查任何外部状态**。
 * 两条硬约定：
 * 1. 认不出的原串**原样返回**而不是丢掉——调用方要能拿到「这个名字不认识，可用的是……」才能
 *    自我纠正；静默过滤只会让它以为本机没有额度。
 * 2. 一个名字命中多条路由时**全部返回**，各自带着真实状态（没启用的会如实标 disabled）。
 *    例如 `zai` 同时是中国版与国际版、`ark` 是 4 条路由：宁可多给几条数据让调用方自己判断，
 *    也不替它猜一条，更不能返回空。
 * @param requested 调用方给的原始名字列表。
 */
function resolveProviderIds(requested) {
	const hit = new Set(), linkedHit = new Set(), unknown = [];
	for (const raw of requested) {
		const name = String(raw ?? "").trim();
		if (!name) continue;
		const key = normalizeProviderKey(name);
		const ids = PROVIDER_LOOKUP.get(key);
		const linkedIds = LINKED_LOOKUP.get(key);
		if (!ids && !linkedIds) { if (!unknown.includes(name)) unknown.push(name); continue; }
		for (const id of ids ?? []) hit.add(id);
		for (const id of linkedIds ?? []) linkedHit.add(id);
	}
	// 按登记顺序返回：命中多条时（例如 `ark`）读起来和设置页一致，而不是跟着调用方的输入顺序抖动。
	// `ids` 只含本插件自己的 provider，`linked` 只含兄弟插件联动项：两者取数路径不同（前者读凭据
	// 直连上游，后者读提供方插件的服务），混在一个数组里调用方会分不清哪条需要凭据。
	return { ids: IDS.filter(id => hit.has(id)), linked: LINKED_IDS.filter(id => linkedHit.has(id)), unknown };
}
/**
 * 点名判定：一个名字只解析到**一条**联动项时才算点名（`antigravity`、`trae-global`…）。
 * 厂商名命中多条（`trae` → 国内版 + 国际版 + 企业版）走的是「一个名字命中多条路由」的既有口径：
 * 全部去读，缺席的不报错——否则只接了国内版的用户，问一句 `trae` 就会顶出两条「没登录」的
 * 错误行，而他并没有请求那两块面板。
 */
function explicitlyNamedLinked(requested) {
	const named = new Set();
	for (const raw of requested) {
		const ids = LINKED_LOOKUP.get(normalizeProviderKey(raw));
		if (ids && ids.length === 1) named.add(ids[0]);
	}
	return named;
}
// 火山方舟额度接口的凭据是 IAM Access Key：AK 与 SK 必须同源配对，跨来源拼接只会得到 401。
// 变量名沿用火山官方 SDK 习惯；与方舟推理 Key（ARK_*_API_KEY）无关。
const VOLC_ACCESS_KEY_ENV = "VOLC_ACCESSKEY";
const VOLC_SECRET_KEY_ENV = "VOLC_SECRETKEY";
// 与 @mars-sea/dsh-commandcode-provider 一致的 CLI 版本标识（其常量 COMMAND_CODE_CLI_VERSION）。
const COMMAND_CODE_CLI_VERSION = "1.73.0";
const COMMAND_CODE_API_BASE = "https://api.commandcode.ai";
// 提供方插件（@mars-sea/dsh-commandcode-provider）注册的 settings namespace：账户列表、当前固定账户
// 与登记任务都在这里。Host 端只读它，不写（切换动作由 Client 走 settings remote）。
const COMMAND_CODE_SETTINGS_NS = "llm-commandcode";
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
// OAuth Bearer（短命轮换）：平时只读；token 过期时借 dsh-grok-kit 的官方会话链（getAuth）经同一
// 把写锁续约并写回同一文件，绝不自行裸 POST 刷新——后者才会顶掉两端的 refresh-token 轮换。
const GROK_API_BASE = "https://cli-chat-proxy.grok.com/v1";
export { parseGrokCreditsGrpcWeb };
// 官方 GrokComConfig.token_header 默认值：必须是该字符串，nginx 鉴权子请求才路由到 OAuth。
const GROK_TOKEN_AUTH = "xai-grok-cli";
const GROK_CLIENT_VERSION = "1.0.13";
const GROK_AUTH_FILE = join(homedir(), ".grok", "auth.json");
// dsh-grok-kit 旧版私存路径（其 resolveXaiOAuthStorePath 的回退分支）。
const XAI_OAUTH_AUTH_FILE = join(homedir(), ".dsh", ".xai-oauth-auth.json");
// dsh-grok-kit 是兄弟插件而非本插件依赖：动态加载，解析不到（未安装 / 开发期 link 布局）即降级。
// 0.2.0 起导出 XaiOAuthSession；其 models.getAuth("xai") 与 grok-kit 聊天/搜索走同一条官方 OAuth
// 刷新链——共享文件 store、写锁内二次检查与 compare-and-write，多个消费者并发也只刷新一次，
// 借它刷新不会顶掉 refresh-token 轮换（自己裸 POST 才会）。只缓存成功解析：失败（未安装、
// 旧版本）下次过期时重试，用户中途安装/升级 grok-kit 后无需重启 DSH。
let grokKitModule;
function loadGrokKit() {
 if (grokKitModule) return Promise.resolve(grokKitModule);
 return import("dsh-grok-kit")
  .then(mod => {
   if (mod && typeof mod.XaiOAuthSession === "function") grokKitModule = mod;
   return grokKitModule;
  })
  .catch(() => undefined);
}
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
// OpenDesign 的额度端点与站点参数都在 ./opendesign-login.js：登录器与额度解析共用同一个 URL。
// dsh-codex-subscription 的活动账号记录是权威来源；只读，不迁移或写回第三方 OAuth。
export async function codexSubscriptionCredentials(credentials) {
 if (!credentials) return undefined;
 const normalize = value => {
  if (value?.type !== "oauth" || typeof value.access !== "string" || !value.access.trim() || typeof value.accountId !== "string" || !value.accountId.trim() || !Number.isFinite(value.expires)) throw failure("subusage/credential", "Codex Subscription 登录凭据格式异常，请在该插件设置页检查登录");
  return { key: value.access, accountId: value.accountId, expiresAt: value.expires, source: "subscription-credentials" };
 };
 const record = await credentials.readRecord?.(credentialKey("codex-subscription", "accounts"));
 if (record !== undefined) {
  const payload = record?.payload;
  if (record?.kind !== "grant" || payload?.version !== 1 || typeof payload.activeId !== "string" || !Array.isArray(payload.accounts)) throw failure("subusage/credential", "Codex Subscription 账号记录格式异常");
  const selected = payload.accounts.filter(account => account?.id === payload.activeId);
  if (selected.length !== 1) throw failure("subusage/credential", "Codex Subscription 活动账号不存在或重复");
  return normalize(selected[0].credential);
 }
 for (const name of ["OPENAI_CODEX_SUBSCRIPTION_OAUTH", "WSL043_OPENAI_CODEX_OAUTH"]) {
  const hit = await credentials.resolve?.(credentialRef(name));
  if (!hit?.value) continue;
  let value;
  try { value = JSON.parse(hit.value); } catch { throw failure("subusage/credential", "Codex Subscription 登录凭据不是有效 JSON"); }
  return normalize(value);
 }
 return undefined;
}
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
// GitHub Copilot 额度：GET https://api.github.com/copilot_internal/user（私有接口，官方客户端同款）。
// 凭据复用 @inventec/dsh-copilot-auth 经 DSH 凭据库写入的 OAuth 记录 `llm-pi-ai/github-copilot`：
// payload.refresh 是**长期的 GitHub OAuth token**（ghu_…），payload.access 是 15 分钟级的 Copilot 会话令牌，
// 额度接口认前者、且必须用 `Authorization: token …`（不是 Bearer）。严格只读：不用 refresh 去铸新会话令牌，
// 不写回记录——续期与登录都属于 Copilot 提供方自己。企业版（GHE.com）按 payload.enterpriseUrl 换 API 主机。
const COPILOT_CREDENTIAL_KEY = "llm-pi-ai/github-copilot";
// 与 dsh-copilot-auth / pi-ai 官方客户端同源的头；接口会按它们识别调用方。
const COPILOT_HEADERS = { "user-agent": "GitHubCopilotChat/0.35.0", "editor-version": "vscode/1.107.0", "editor-plugin-version": "copilot-chat/0.35.0", "copilot-integration-id": "vscode-chat" };
export async function copilotCredentials(credentials) {
 if (!credentials?.readRecord) return undefined;
 const record = await credentials.readRecord(COPILOT_CREDENTIAL_KEY);
 if (record === undefined || record === null) return undefined;
 const payload = record.payload;
 if (!payload || typeof payload !== "object" || Array.isArray(payload)) throw failure("subusage/credential", "GitHub Copilot 登录记录格式异常，请在 Copilot 设置页检查登录");
 const token = typeof payload.refresh === "string" ? payload.refresh.trim() : "";
 if (!token) return undefined;
 let apiHost = "api.github.com";
 const enterprise = typeof payload.enterpriseUrl === "string" ? payload.enterpriseUrl.trim() : "";
 if (enterprise) {
  let host = "";
  try { host = new URL(enterprise.includes("://") ? enterprise : `https://${enterprise}`).hostname; } catch { /* 下面统一按格式异常报 */ }
  // 凭据会被发往这个主机：只接受普通域名，拒绝带端口/凭据/路径之类的怪形。
  if (!/^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/i.test(host)) throw failure("subusage/credential", "GitHub Copilot 企业域名格式异常，请在 Copilot 设置页检查登录");
  apiHost = `api.${host}`;
 }
 return { key: token, apiHost, source: "copilot-oauth" };
}
// Copilot 用量归一。`quota_snapshots` 按 quota_id 给出三个桶：
//  - premium_interactions：付费档的月度主池（entitlement 总量 / remaining 剩余 / percent_remaining 剩余百分比）；
//  - chat / completions：付费档通常是 unlimited（或 -1 哨兵），免费档才是真实计数；
//  - 免费档旧形态：limited_user_quotas（**剩余**）对 monthly_quotas（总量），重置日是 limited_user_reset_date。
// 组织席位（Business / Enterprise 的 token_based_billing）只回 entitlement 为 0 的占位桶：那是合法空状态，
// 如实说明，不画成 0%。百分比一律按**已用**输出（接口给的是剩余）。
// https://pkg.go.dev/github.com/github/copilot-sdk/go/rpc 、https://docs.rs/tokn-provider-copilot/0.2.0-rc.3/src/tokn_provider_copilot/user.rs.html
export function normalizeCopilotUsage(body) {
 if (!body || typeof body !== "object" || Array.isArray(body)) throw failure("subusage/response", "Invalid Copilot usage response");
 const plan = typeof body.copilot_plan === "string" ? body.copilot_plan.trim() : "";
 const stamp = value => typeof value === "string" && Number.isFinite(Date.parse(value)) ? new Date(Date.parse(value)).toISOString() : undefined;
 const reset = stamp(body.quota_reset_date) ?? stamp(body.limited_user_reset_date);
 const count = value => typeof value === "number" && Number.isFinite(value) ? value : undefined;
 const record = value => value && typeof value === "object" && !Array.isArray(value) ? value : undefined;
 const snapshots = record(body.quota_snapshots) ?? {};
 // 返回 undefined = 该桶不可画（缺失 / 占位）；{ unlimited } = 明确不设限。
 const bucket = row => {
  row = record(row);
  if (!row) return undefined;
  const entitlement = count(row.entitlement), remaining = count(row.remaining) ?? count(row.quota_remaining);
  if (row.unlimited === true || entitlement === -1 || remaining === -1) return { unlimited: true };
  if (entitlement === undefined || entitlement <= 0) return undefined;
  const left = count(row.percent_remaining);
  const percent = left !== undefined ? 100 - left : remaining !== undefined ? (entitlement - remaining) / entitlement * 100 : undefined;
  if (percent === undefined) return undefined;
  // 实测（2026-10-23）：remaining 是取整的整数（755）而 quota_remaining 是浮点（755.6），credits_used 与账面一致（744）；有它就用它。
  const used = count(row.credits_used);
  const detail = used !== undefined && used >= 0 ? { used, limit: entitlement, unit: "requests" } : remaining !== undefined ? { used: Math.max(0, entitlement - remaining), limit: entitlement, unit: "requests" } : undefined;
  return { percent: Math.min(100, Math.max(0, percent)), detail };
 };
 const windows = [];
 const extras = [];
 if (plan) extras.push({ kind: "plan", value: plan });
 const premiumRow = record(snapshots.premium_interactions);
 const premium = bucket(premiumRow);
 const push = (label, found) => { if (found?.percent !== undefined) windows.push({ ...windowRow("month", found.percent, reset, undefined, found.detail), groupLabel: label }); };
 push("Premium requests", premium);
 if (premium?.unlimited) extras.push({ kind: "quota-status", value: "unlimited" });
 push("Chat", bucket(snapshots.chat));
 push("Completions", bucket(snapshots.completions));
 // 免费档旧形态：只在没有任何桶可画时才读，避免付费账号残留的 limited_* 字段冒出免费档窗口。
 if (!windows.length && !premium?.unlimited) {
  const remaining = record(body.limited_user_quotas), total = record(body.monthly_quotas);
  for (const [field, label] of [["chat", "Chat"], ["completions", "Completions"]]) {
   const left = count(remaining?.[field]), size = count(total?.[field]);
   if (left === undefined || size === undefined || size <= 0) continue;
   push(label, { percent: Math.min(100, Math.max(0, (size - left) / size * 100)), detail: { used: Math.max(0, size - left), limit: size, unit: "requests" } });
  }
 }
 // 超出月度主池后的额外用量：只有用户启用了额外计费才有意义（占位桶 entitlement 为 0，premium 为 undefined，不会走到这里）。
 const overagePermitted = premium?.percent !== undefined && premiumRow?.overage_permitted === true;
 const overage = count(premiumRow?.overage_count);
 if (overagePermitted && overage > 0) extras.push({ kind: "note", value: `已产生 ${overage} 次超额用量（已启用额外计费）` });
 const exhausted = premium?.percent >= 100;
 if (!windows.length && !premium?.unlimited) extras.push({ kind: "note", value: /business|enterprise|team/i.test(plan) || (premiumRow && !premium && count(premiumRow.entitlement) === 0 && body.token_based_billing === true && !/individual|free|pro/i.test(plan)) ? "该席位由组织计费，GitHub 不返回个人额度" : "未检测到 Copilot 额度窗口" });
 const reported = windows.length > 0 || premium?.unlimited === true;
 return { windows, extras, coverage: reported ? "complete" : "partial", ...(exhausted && overagePermitted ? { availability: "paygo", availabilityReason: "overage-permitted" } : {}) };
}
const CONFIG_PATH = join(homedir(), ".dsh", "dsh-subusage.json");
// 官方 MiMo 会话 Cookie 自签发起 24 小时有效；从凭据写入时刻起计时，手动导入与自动登录同源。
const MIMO_COOKIE_TTL_MS = 24 * 60 * 60 * 1000;
// 扫码登录会额外保存 passToken 续期材料：控制台 Cookie 距到期不足这个余量就静默续期（到期前续，不等失效）。
const MIMO_RENEW_MARGIN_MS = 10 * 60 * 1000;
// 续期失败后的重试间隔：网络类失败 1 分钟、接口形状异常 10 分钟；passToken 被拒（需重新扫码）不重试，
// 直到用户重新登录换了续期材料——对一个已失效的登录态反复请求只会触发小米的风控。
const MIMO_RENEW_NETWORK_RETRY_MS = 60 * 1000;
const MIMO_RENEW_PROTOCOL_RETRY_MS = 10 * 60 * 1000;
const MIMO_RENEW_FAILED_TEXT = "小米登录已失效，自动续期失败，请重新扫码登录";
/**
 * 续期材料（扫码登录时由小米下发）：userId + passToken + deviceId，可选 passToken 的到期时间。
 * 形状不符一律丢弃，保证旧配置 / 手改配置不会让续期读到半份材料。
 */
function normalizeRenewal(value) {
 if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
 const ok = (text) => typeof text === "string" && text.length > 0 && text.length <= 2048 && !/[\x00-\x20\x7f;]/.test(text);
 if (!ok(value.userId) || !ok(value.passToken) || !ok(value.deviceId)) return undefined;
 return { userId: value.userId, passToken: value.passToken, deviceId: value.deviceId, ...(Number.isSafeInteger(value.expiresAt) && value.expiresAt > 0 ? { expiresAt: value.expiresAt } : {}) };
}
const MAX_BYTES = 1024 * 1024;
const TTL = 60000;
const hash = (value) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
/** 计时元数据落库用毫秒、过 RPC 用 ISO：非正值一律视为未记录。 */
const isoStamp = (ms) => Number.isSafeInteger(ms) && ms > 0 ? new Date(ms).toISOString() : null;
function redactSecret(value, cookie) {
 const sensitive = [cookie, ...cookie.split(";").map(part => { const trimmed = part.trim(); return trimmed.slice(trimmed.indexOf("=") + 1).replace(/^\"|\"$/g, ""); }).filter(Boolean)].filter(Boolean);
 // 套餐名是未经结构约束的展示文本；余额/明细已严格限制为数值和货币代码。
 // 不对子串碰巧匹配的日期、自建枚举或单位做替换，避免短 Cookie 破坏语义。
 const sanitize = text => sensitive.reduce((out, secret) => out.split(secret).join("[redacted]"), text);
 return { ...value, ...(Array.isArray(value.extras) ? { extras: value.extras.map(extra => extra.kind === "plan" ? { ...extra, value: sanitize(extra.value) } : extra) } : {}) };
}
function validProviderMappings(value) {
 if (!value || typeof value !== "object" || Array.isArray(value)) return false;
 const routes = [];
 for (const [id, ids] of Object.entries(value)) {
  if (!IDS.includes(id) || !Array.isArray(ids) || ids.some(route => typeof route !== "string" || !route.trim() || route.length > 256)) return false;
  routes.push(...ids);
 }
 return new Set(routes).size === routes.length;
}
/** 每个 provider 最多监控几条自定义凭据引用名：多 Key 是排障/多账号用途，不是凭据保险库。 */
const KEY_REFS_LIMIT = 8;
/**
 * 自定义监控的凭据引用名（`apiKeyEnv` 形式的环境变量名）。只保存引用名，不保存 Key 值：
 * 值仍由 DSH 凭据库或环境变量提供。非法名、空值与重复项读回时丢弃，保证旧/手改配置不会
 * 让解析链抛错；超过上限时截断而不是拒绝整份配置。
 */
function normalizeKeyRefs(value) {
 if (!value || typeof value !== "object" || Array.isArray(value)) return {};
 const out = {};
 for (const [id, refs] of Object.entries(value)) {
  if (!IDS.includes(id) || !Array.isArray(refs)) continue;
  const seen = new Set();
  const list = [];
  for (const ref of refs) {
   if (typeof ref !== "string" || ref.length > 128 || !isCredentialRefName(ref) || seen.has(ref)) continue;
   seen.add(ref); list.push(ref);
   if (list.length >= KEY_REFS_LIMIT) break;
  }
  if (list.length) out[id] = list;
 }
 return out;
}
function defaultSettings() {
 // Ark 逐条值随各自组开关归一化，保证「首次读取 → 保存 → 再读」revision 稳定。
 return { zai: { type: 1, organization: "", project: "" }, volc: { accessKeyId: "", secretAccessKey: "" }, litellm: { baseUrl: "" }, xiaomi: { cookie: "", loginAt: 0, expiresAt: 0 }, keys: {}, keyRefs: {}, keyModes: Object.fromEntries(IDS.map(id => [id, "inherit"])), visibility: { manualMatching: false, providerMappings: {}, hideWithoutApi: true, antigravity: true, ark: ARK_DEFAULT_ON, arkTeam: false, providers: Object.fromEntries(IDS.map(id => [id, PROVIDERS[id].credentialKind === "volc" ? (ARK_TEAM_IDS.includes(id) ? false : ARK_DEFAULT_ON) : PROVIDERS[id].defaultEnabled !== false])) } };
}
function parseStored(value) {
 const s = defaultSettings();
 if (!value || typeof value !== "object" || Array.isArray(value)) throw failure("subusage/config", "设置文件结构无效");
 s.keyRefs = normalizeKeyRefs(value.keyRefs);
 if (value.zai && typeof value.zai === "object") s.zai = { type: value.zai.type === 2 ? 2 : 1, organization: typeof value.zai.organization === "string" ? value.zai.organization : "", project: typeof value.zai.project === "string" ? value.zai.project : "" };
 if (value.volc && typeof value.volc === "object" && !Array.isArray(value.volc)) for (const field of ["accessKeyId", "secretAccessKey"]) if (typeof value.volc[field] === "string") s.volc[field] = value.volc[field];
 if (value.litellm && typeof value.litellm === "object" && !Array.isArray(value.litellm) && typeof value.litellm.baseUrl === "string") s.litellm.baseUrl = value.litellm.baseUrl;
 if (value.xiaomi && typeof value.xiaomi === "object") { if (typeof value.xiaomi.cookie === "string") s.xiaomi.cookie = value.xiaomi.cookie; for (const field of ["loginAt", "expiresAt"]) if (Number.isSafeInteger(value.xiaomi[field]) && value.xiaomi[field] > 0) s.xiaomi[field] = value.xiaomi[field]; const renewal = normalizeRenewal(value.xiaomi.renewal); if (renewal && s.xiaomi.cookie.trim()) s.xiaomi.renewal = renewal; }
 if (typeof value.visibility?.manualMatching === "boolean") s.visibility.manualMatching = value.visibility.manualMatching;
 if (validProviderMappings(value.visibility?.providerMappings)) s.visibility.providerMappings = structuredClone(value.visibility.providerMappings);
 if (typeof value.visibility?.hideWithoutApi === "boolean") s.visibility.hideWithoutApi = value.visibility.hideWithoutApi;
 // Antigravity 是独立于普通 provider 的联动开关；旧配置缺省开启，保持既有行为。
 if (typeof value.visibility?.antigravity === "boolean") s.visibility.antigravity = value.visibility.antigravity;
 // 个人版组开关：旧配置的逐条值只用于迁移，Team 旧值不参与，避免升级后继续全组开启。
 if (typeof value.visibility?.ark === "boolean") s.visibility.ark = value.visibility.ark;
 else if (ARK_PERSONAL_IDS.some(id => value.visibility?.providers?.[id] === true)) s.visibility.ark = true;
 // arkTeam 是新增独立开关；缺省始终关闭，不把旧配置里跟随总开关的 Team true 当成明确选择。
 if (typeof value.visibility?.arkTeam === "boolean") s.visibility.arkTeam = value.visibility.arkTeam;
 for (const id of IDS) {
  if (typeof value.visibility?.providers?.[id] === "boolean") s.visibility.providers[id] = value.visibility.providers[id];
  if (PROVIDERS[id].managedByPlugin) continue;
   if (typeof value.keys?.[id] === "string") s.keys[id] = value.keys[id];
  if (value.keyModes?.[id] === "manual") s.keyModes[id] = "manual";
 }
 // Ark 两个组开关是唯一真源：逐条值只作迁移输入，读回后分别跟随个人版 / Team 开关。
 for (const id of ARK_PERSONAL_IDS) s.visibility.providers[id] = s.visibility.ark;
 for (const id of ARK_TEAM_IDS) s.visibility.providers[id] = s.visibility.arkTeam;
 return s;
}
// 药丸显示映射不会改变查询身份；仍保留其他设置的在途变更检测。
function querySettingsHash(settings) {
 const visibility = { ...settings.visibility };
 delete visibility.manualMatching;
 delete visibility.providerMappings;
 return hash({ ...settings, visibility });
}
function publicSettings(s, now = Date.now()) {
 return { revision: hash(s), zai: { ...s.zai }, volc: { hasAccessKeyId: !!s.volc.accessKeyId?.trim(), hasSecretAccessKey: !!s.volc.secretAccessKey?.trim() }, litellm: { baseUrl: s.litellm.baseUrl }, xiaomi: { hasCookie: !!s.xiaomi.cookie.trim(), loginAt: isoStamp(s.xiaomi.loginAt), expiresAt: isoStamp(s.xiaomi.expiresAt), autoRenew: !!s.xiaomi.renewal && !(s.xiaomi.renewal.expiresAt && s.xiaomi.renewal.expiresAt <= now), renewExpiresAt: isoStamp(s.xiaomi.renewal?.expiresAt) }, hasKeys: Object.fromEntries(IDS.map(id => [id, !!s.keys[id]?.trim()])), keyRefs: Object.fromEntries(IDS.map(id => [id, [...(s.keyRefs[id] ?? [])]])), keyModes: { ...s.keyModes }, visibility: { manualMatching: s.visibility.manualMatching, providerMappings: structuredClone(s.visibility.providerMappings), hideWithoutApi: s.visibility.hideWithoutApi, antigravity: s.visibility.antigravity, ark: s.visibility.ark, arkTeam: s.visibility.arkTeam, providers: { ...s.visibility.providers } } };
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
  if (Object.keys(v).some(k => !["providers", "hideWithoutApi", "antigravity", "ark", "arkTeam", "manualMatching", "providerMappings"].includes(k)) || !Object.keys(v).length) throw invalid("Invalid visibility fields");
  const visibility = {};
  if (v.manualMatching !== undefined) { if (typeof v.manualMatching !== "boolean") throw invalid("Invalid manual matching switch"); visibility.manualMatching = v.manualMatching; }
  if (v.providerMappings !== undefined) { if (!validProviderMappings(v.providerMappings)) throw invalid("Invalid provider mappings"); visibility.providerMappings = structuredClone(v.providerMappings); }
  if (v.hideWithoutApi !== undefined) { if (typeof v.hideWithoutApi !== "boolean") throw invalid("Invalid auto-hide switch"); visibility.hideWithoutApi = v.hideWithoutApi; }
  if (v.antigravity !== undefined) { if (typeof v.antigravity !== "boolean") throw invalid("Invalid Antigravity switch"); visibility.antigravity = v.antigravity; }
  // Ark 个人版 / Team 独立组开关。
  if (v.ark !== undefined) { if (typeof v.ark !== "boolean") throw invalid("Invalid Ark group switch"); visibility.ark = v.ark; }
  if (v.arkTeam !== undefined) { if (typeof v.arkTeam !== "boolean") throw invalid("Invalid Ark Team switch"); visibility.arkTeam = v.arkTeam; }
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
 // 自定义监控的凭据引用名：只允许环境变量名形态（不含秘密值），最多 KEY_REFS_LIMIT 条。
 if (value.keyRefs !== undefined) {
  if (!Array.isArray(value.keyRefs) || value.keyRefs.length > KEY_REFS_LIMIT || value.keyRefs.some(ref => typeof ref !== "string" || ref.length > 128 || !isCredentialRefName(ref))) throw invalid("Invalid key refs");
  out.keyRefs = [...new Set(value.keyRefs)];
 }
 for (const field of ["keyUpdate", "cookieUpdate"]) if (value[field] !== undefined) out[field] = parseUpdate(value[field]);
 // 火山方舟的凭据是 AK/SK 配对，只能走 volc 补丁；单值 keyUpdate 会让 AK 与 SK 失去配对来源。
 if (PROVIDERS[value.providerId]?.credentialKind === "volc" && (value.keyUpdate !== undefined || value.cookieUpdate !== undefined)) throw invalid("Volcengine credentials use the volc patch");
 if (PROVIDERS[value.providerId]?.managedByPlugin && (out.keyMode !== undefined || out.keyUpdate !== undefined || out.cookieUpdate !== undefined)) throw invalid("Credentials are managed by the provider plugin");
 // managed / 火山的凭据来源由所属插件或 AK/SK 配对决定，额外引用名不会生效，直接拒绝免误导。
 if (out.keyRefs !== undefined && (PROVIDERS[value.providerId]?.managedByPlugin || PROVIDERS[value.providerId]?.credentialKind === "volc")) throw invalid("Key refs are managed by the provider plugin");
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
// 与 fetchJson 的 AbortSignal.timeout 同语义的 promise 超时门；ms 非正数视为不限时。
// race 结束即清 timer：未触发的 setTimeout 否则会把测试进程挂到超时才退出；先 settle 的
// 原始 promise 之后才 reject 时，handler 已由 race 注册，不会变成 unhandledRejection。
function withTimeout(promise, ms, makeError) {
 if (!Number.isFinite(ms) || ms <= 0) return promise;
 let timer;
 const work = Promise.resolve(promise);
 work.catch(() => {});
 const gate = new Promise((_, reject) => { timer = setTimeout(() => reject(makeError()), ms); });
 return Promise.race([work, gate]).finally(() => { clearTimeout(timer); });
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
 try { response = await fetcher(url, { method: init.method ?? "GET", ...(init.body !== undefined ? { body: init.body } : {}), headers: { accept: "application/json", "user-agent": `dsh-subusage/${VERSION}`, ...headers }, signal: lifetimeSignal ? AbortSignal.any([AbortSignal.timeout(10000), lifetimeSignal]) : AbortSignal.timeout(10000), redirect: "manual" }); }
 catch { throw failure("subusage/network", "网络请求失败或超时", true); }
 // 3xx（redirect: "manual" 下的域名迁移/跳转）不是鉴权失败，与 401/403 分开映射，
 // 避免用户被误导去重登录；两个条件都加显式括号，不依赖 &&/|| 优先级。
 if ((response.status >= 300 && response.status < 400)) throw failure("subusage/response", "服务端返回了意外的重定向响应（HTTP 3xx）");
 if ((response.status === 401 || response.status === 403)) throw failure("subusage/auth", "登录或凭据已失效");
 if (!response.ok && !(init.notSubscribed404 === true && response.status === 404)) {
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
 if (response.status === 404 && init.notSubscribed404 === true && !/^(NotFound\.BillingType|OperationDenied\.NotSubscribed)$/.test(body?.ResponseMetadata?.Error?.Code ?? "")) throw failure("subusage/http", "HTTP 404");
  if ([401, 403, "401", "403"].includes(body?.code)) throw failure("subusage/auth", "登录或凭据已失效");
 return body;
}
function grokCreditsFallbackable(error) {
	if (!(error instanceof RemoteError)) return false;
	if (error.code === "subusage/network" || error.code === "subusage/rate-limit") return true;
	return error.code === "subusage/http" && error.details?.retryable === true;
}
async function fetchBytes(fetcher, url, headers, lifetimeSignal, init = {}) {
	let response;
	try { response = await fetcher(url, { method: init.method ?? "GET", ...(init.body !== undefined ? { body: init.body } : {}), headers: { "user-agent": `dsh-subusage/${VERSION}`, ...headers }, signal: lifetimeSignal ? AbortSignal.any([AbortSignal.timeout(init.timeoutMs ?? 10000), lifetimeSignal]) : AbortSignal.timeout(init.timeoutMs ?? 10000), redirect: "manual" }); }
	catch { throw failure("subusage/network", "网络请求失败或超时", true); }
	if ((response.status >= 300 && response.status < 400)) throw failure("subusage/response", "服务端返回了意外的重定向响应（HTTP 3xx）");
	if ((response.status === 401 || response.status === 403)) throw failure("subusage/auth", "登录或凭据已失效");
	if (!response.ok) {
		const retry = response.status === 408 || response.status === 429 || response.status >= 500;
		throw failure(response.status === 429 ? "subusage/rate-limit" : "subusage/http", `HTTP ${response.status}`, retry);
	}
	const grpcStatus = response.headers?.get?.("grpc-status");
	if (grpcStatus && grpcStatus !== "0") throw failure("subusage/http", `gRPC ${grpcStatus}`, true);
	if (Number(response.headers?.get?.("content-length")) > MAX_BYTES) throw failure("subusage/response", "响应超过 1MiB");
	let bytes;
	try {
		if (typeof response.arrayBuffer === "function") bytes = Buffer.from(await response.arrayBuffer());
		else throw failure("subusage/response", "响应不是二进制帧");
	} catch (e) { if (e instanceof RemoteError) throw e; throw failure("subusage/network", "读取响应失败", true); }
	if (bytes.length > MAX_BYTES) throw failure("subusage/response", "响应超过 1MiB");
	return bytes;
}
async function fetchGrokCreditsGrpc(fetcher, grokHeaders, lifetimeSignal, now = Date.now, timeoutMs = 10000) {
	const bytes = await fetchBytes(fetcher, GROK_GRPC_CREDITS_URL, {
		...grokHeaders,
		accept: "application/grpc-web+proto",
		"content-type": "application/grpc-web+proto",
		"x-grpc-web": "1",
		origin: "https://grok.com",
		referer: "https://grok.com/?_s=usage"
	}, lifetimeSignal, { method: "POST", body: GROK_GRPC_EMPTY_FRAME, timeoutMs });
	const billing = parseGrokCreditsGrpcWeb(bytes, now());
	if (!billing) throw failure("subusage/response", "Invalid Grok subscription billing response");
	return billing;
}
function numeric(v) { return typeof v === "number" && Number.isFinite(v) && v >= 0; }
function windowRow(kind, raw, resetsAt, status, detail) {
 if (!numeric(raw)) throw failure("subusage/response", "用量百分比缺失或无效");
 const percent = raw < 100 ? Math.min(99.9, Math.round(raw * 10) / 10) : Math.round(raw * 10) / 10;
 return { kind, percent, status: status === "rate-limited" || raw >= 100 ? "rate-limited" : "ok", ...(typeof resetsAt === "string" && Number.isFinite(Date.parse(resetsAt)) ? { resetsAt: new Date(resetsAt).toISOString() } : {}), ...(detail ? { detail } : {}) };
}
const RANK = { month: 0, sub: 0, period: 0, week: 1, "7d": 1, day: 2, "5h": 2, rolling: 2 };
/**
 * 按窗口秒数归一到插件统一的窗口档位；无法判断大小时退回通用 `period`，
 * 不从套餐名或百分比反推档位。APIGOTO 的 `window_sec` 与 OpenDesign 的
 * `durationSeconds` 共用这一套口径。
 */
function windowKindFromSeconds(seconds) {
	if (seconds <= 6 * 3600) return "5h";
	if (seconds <= 36 * 3600) return "day";
	if (seconds <= 8 * 86400) return "week";
	if (seconds <= 32 * 86400) return "month";
	return "period";
}
function cascadeRateLimited(windows) {
 const roots = windows.filter(w => w.status === "rate-limited");
 for (const w of windows) {
  const blockers = roots.filter(root => {
    const sourceScope = root.detail?.scope ?? "all", targetScope = w.detail?.scope ?? "all";
    return (sourceScope === "all" || sourceScope === targetScope) && (RANK[root.kind] ?? 3) < (RANK[w.kind] ?? 3);
   });
  if (blockers.length) { if (w.status !== "rate-limited") w.cascade = true; w.status = "rate-limited"; w.detail = { ...w.detail, blockedBy: [...new Set(blockers.map(root => root.kind))] }; }
 }
 return windows;
}
/**
 * 「窗口 + 附加行」型 provider 的统一返回结构：windows 统一过级联，extras 保持调用方
 * 顺序，coverage 缺省 complete。字段名与默认值只在这里定义一处。
 */
function windowExtrasResult({ windows = [], extras = [], coverage = "complete" } = {}) {
 return { windows: cascadeRateLimited(windows), extras, coverage };
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
 const rawBal = balBody?.data;
 const bal = rawBal && typeof rawBal.balance === "string" && /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)$/.test(rawBal.balance) && Number.isFinite(Number(rawBal.balance)) ? rawBal : undefined;
 const data = usageBody?.data ?? {}; const detail = detailBody?.data ?? {};
 const pick = (group, name) => Array.isArray(group?.items) ? group.items.find(i => i?.name === name) : undefined;
 const pools = [pick(data.usage, "plan_total_token"), pick(data.monthUsage, "month_total_token")].filter(Boolean);
 const pool = pools.find(row => row.limit !== 0) ?? pools[0];
 const groups = ["usage", "monthUsage"].filter(key => Object.hasOwn(data, key)).map(key => data[key]);
 const emptyGroups = groups.length > 0 && groups.every(group => group === null || Array.isArray(group?.items) && group.items.length === 0);
 const detailReadable = detailBody?.data === null || detailBody?.data && typeof detailBody.data === "object" && !Array.isArray(detailBody.data);
 const noSubscription = detailReadable && [undefined, 0].includes(detailBody?.code) && [undefined, 0].includes(usageBody?.code) && !detail.planName && !detail.planCode && (emptyGroups || pools.length > 0 && pools.every(row => row.limit === 0 && row.used === 0 && row.percent === 0));
 const poolDetail = numeric(pool?.used) && numeric(pool?.limit) && pool.limit > 0 ? { used: pool.used, limit: pool.limit, unit: "credits" } : undefined;
 const windows = pool && pool.limit !== 0 && numeric(pool.percent) ? [windowRow("sub", pool.percent * 100, detail.currentPeriodEnd, undefined, poolDetail)] : [];
 const currency = typeof bal?.currency === "string" && /^[A-Z]{3}$/.test(bal.currency) ? bal.currency : "";
 const extras = bal ? [{ kind: "balance", value: `${bal.balance} ${currency}`.trim() }] : [];
 if (!bal && !windows.length) throw failure("subusage/response", "MiMo 没有可读的余额或套餐用量");
 if (!bal) extras.push({ kind: "note", value: "余额暂不可读；套餐用量已更新" });
 const plan = detail.planName || detail.planCode;
 if (typeof plan === "string") extras.push({ kind: "plan", value: plan });
 return { windows, extras, balanceOk: !!bal, ...(windows.length ? { subscribed: true } : noSubscription ? { subscribed: false } : {}), coverage: windows.length || noSubscription && !!bal ? "complete" : "partial" };
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
 const routing = body?.routing;
  const mode = routing?.recommendedMode;
  const availability = mode === "unavailable" ? { availability: "blocked", availabilityReason: "routing-policy" }
   : mode === "subscription" ? { availability: routing.subscriptionQuotaAvailable === true ? "included" : "unknown", availabilityReason: "routing-advice" }
   : mode === "paygo" ? { availability: usd !== undefined && Number.isFinite(Number(usd)) && Number(usd) > 0 && routing.paidSpendPolicyAllowsBalance !== false ? "paygo" : "unknown", availabilityReason: "routing-advice" } : {};
  return { windows: cascadeRateLimited(windows), extras, coverage: (windows.length || usd !== undefined || mode === "unavailable") && !partial ? "complete" : "partial", ...availability };
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
 const unlimited = !windows.length && row.current_interval_status === 3 && row.current_weekly_status === 3;
  return { windows: cascadeRateLimited(windows), extras: unlimited ? [{ kind: "quota-status", value: "unlimited" }] : [], coverage: windows.length || [row.current_interval_status, row.current_weekly_status].includes(3) ? "complete" : "partial" };
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
  const exhausted = windows.some(w => w.status === "rate-limited");
   const purchased = credits.purchasedCredits;
   const availability = exhausted && numeric(purchased) && purchased > 0 ? { availability: "paygo", availabilityReason: "paid-credits" }
    : exhausted ? { availability: "blocked", availabilityReason: "quota-exhausted" } : {};
   return { windows, extras, coverage: hasMonthlyBalance || windows.length || reported.length ? "complete" : "partial", ...availability };
}
// The X Subscription / SuperGrok 统一用量池：GetGrokCreditsConfig 响应（官方 grok CLI 的
// /v1/billing?format=credits）。creditUsagePercent 是“已用”百分比（0-100），剩余由
// client 取补；新形态用 creditUsagePercent + currentPeriod（周/月），旧形态回退
// monthlyLimit/used（美分）+ 月账期。无绝对额度字段时不编造明细。
export function normalizeSuperGrok(body, settingsBody) {
 const config = body?.config && typeof body.config === "object" && !Array.isArray(body.config) ? body.config : {};
 const period = config.currentPeriod && typeof config.currentPeriod === "object" && !Array.isArray(config.currentPeriod) ? config.currentPeriod : undefined;
 // 官方 Cent 是 proto3 消息：{} 明确代表 0；缺失消息与坏 val 则仍是未知。
 const cent = row => row && typeof row === "object" && !Array.isArray(row)
  ? row.val === undefined ? Object.keys(row).length === 0 ? 0 : undefined
   : typeof row.val === "number" && Number.isFinite(row.val) ? row.val : undefined
  : undefined;
 let percent;
 if (numeric(config.creditUsagePercent)) percent = config.creditUsagePercent;
 else {
  // 旧形态按美分绝对值折算比例；{}（proto3 零值）解码为 0，无上限（limit<=0）不折算。
  const limit = cent(config.monthlyLimit), used = cent(config.used) ?? 0;
  if (limit !== undefined && limit > 0) percent = used / limit * 100;
 }
 // 统一计费代理会成功返回周期/余额却省略百分比：不伪造 0%，保留其它已报告数据。
 const periodOnly = config.creditUsagePercent === undefined && period
  && ["USAGE_PERIOD_TYPE_WEEKLY", "USAGE_PERIOD_TYPE_MONTHLY"].includes(period.type)
  && typeof period.end === "string" && Number.isFinite(Date.parse(period.end));
 if (percent === undefined && !periodOnly) throw failure("subusage/response", "Invalid Grok subscription billing response");
 // 周期类型是 proto 枚举名；未知/缺失类型不猜窗口名，按通用订阅池展示；旧形态按月账期。
 const kind = period?.type === "USAGE_PERIOD_TYPE_WEEKLY" ? "week" : period?.type === "USAGE_PERIOD_TYPE_MONTHLY" ? "month" : period ? "sub"
  : config.billingPeriodStart !== undefined || config.billingPeriodEnd !== undefined ? "month" : "sub";
 const windows = percent === undefined ? [] : [windowRow(kind, percent, period?.end ?? config.billingPeriodEnd)];
 const extras = [];
 const plan = typeof settingsBody?.subscription_tier_display === "string" && settingsBody.subscription_tier_display.trim() ? settingsBody.subscription_tier_display.trim()
  : typeof body?.subscription_tier === "string" && body.subscription_tier.trim() ? body.subscription_tier.trim() : "";
 if (plan) extras.push({ kind: "plan", value: plan });
 // prepaidBalance（已购加量余额）以美分计价；只合并真正报告过的值，未报告不冒充 0。
 const prepaid = cent(config.prepaidBalance);
 if (prepaid !== undefined) extras.push({ kind: "balance", value: `${(prepaid / 100).toFixed(2)} USD` });
 return { windows, extras, coverage: percent === undefined ? "partial" : "complete" };
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
// credits 只在真正报告了可用余额时显示：has_credits=false、balance="0" 不画余额；unlimited 单独保留状态，
// 不把「无额度」画成 0。
// https://raw.githubusercontent.com/steipete/CodexBar/main/docs/codex.md
export function normalizeCodexUsage(body) {
	const windows = [];
	const plan = typeof body?.plan_type === "string" ? body.plan_type.trim() : "";
	// 当前 Pro 三档无短窗；未知档位的缺失时长不按主窗口位置猜成 5h。
	const weeklyOnly = ["pro", "prolite", "promax"].includes(plan.toLowerCase());
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
	const positional = !plan || ["plus", "team", "business"].includes(plan.toLowerCase());
	push(limits.primary_window, weeklyOnly ? "week" : positional ? "5h" : "rolling");
	push(limits.secondary_window, weeklyOnly ? "week" : positional ? "7d" : "rolling");
	const extras = [];
	if (plan) extras.push({ kind: "plan", value: plan });
	const credits = body?.credits && typeof body.credits === "object" && !Array.isArray(body.credits) ? body.credits : {};
	const balance = typeof credits.balance === "string" && credits.balance.trim() ? credits.balance.trim() : typeof credits.balance === "number" ? String(credits.balance) : "";
	const creditBalance = balance && /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)$/.test(balance) && Number.isFinite(Number(balance)) ? Number(balance) : undefined;
	if (credits.has_credits === true && credits.unlimited !== true && creditBalance !== undefined) extras.push({ kind: "balance", value: balance });
	if (credits.has_credits === true && credits.unlimited === true) extras.push({ kind: "credit-status", value: "unlimited" });
	const control = body?.spend_control;
	const member = control?.individual_limit;
	const memberLimit = Number(member?.limit), memberUsed = member?.used == null ? NaN : Number(member.used);
	if (member && Number.isFinite(memberLimit) && memberLimit > 0 && Number.isFinite(memberUsed) && memberUsed >= 0) {
		const reset = numeric(member.reset_at) && member.reset_at > 0 ? new Date(member.reset_at * 1000).toISOString() : undefined;
		windows.push({ ...windowRow("period", memberUsed / memberLimit * 100, reset, undefined, { used: memberUsed, limit: memberLimit, unit: "credits", scope: "member-budget" }), groupLabel: "groupMemberBudget" });
	}
	const reached = body?.rate_limit_reached_type?.kind;
	const restricted = control?.reached === true || ["workspace_owner_credits_depleted", "workspace_member_credits_depleted", "workspace_owner_usage_limit_reached", "workspace_member_usage_limit_reached"].includes(reached);
	const exhausted = windows.some(w => w.status === "rate-limited") || limits.limit_reached === true || limits.allowed === false;
	const creditFallback = credits.has_credits === true && (credits.unlimited === true || creditBalance > 0);
	const availability = restricted ? { availability: "blocked", availabilityReason: "spend-control" }
		: exhausted && creditFallback ? { availability: "unknown", availabilityReason: "credit-eligibility" }
		: exhausted ? { availability: "blocked", availabilityReason: "quota-exhausted" } : {};
	if (!windows.length && !extras.some(e => e.kind !== "plan") && !restricted) extras.push({ kind: "note", value: "未检测到订阅额度窗口" });
	const reported = windows.length || extras.some(e => e.kind !== "plan" && e.kind !== "note") || restricted;
	// 额外特性池未按所选模型映射前，不声称已完整覆盖它们。
	const partial = Array.isArray(body?.additional_rate_limits) && body.additional_rate_limits.length > 0;
	return { windows: cascadeRateLimited(windows), extras, coverage: reported && !partial ? "complete" : "partial", ...availability };
}
// DeepSeek 官方余额（余额型）：GET https://api.deepseek.com/user/balance，Bearer 与推理同一把 Key。
// 响应 { is_available, balance_infos: [{ currency, total_balance, granted_balance, topped_up_balance }] }，
// 金额是**字符串十进制**。余额没有上限也就没有百分比：不产出窗口，只产出 extras。
// DSH 账号服务已完成鉴权与余额响应投影；本插件不读取账号 grant/token。
export function normalizeDeepseekAccountBalance(body) {
 const decimal = /^-?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/i;
 if (body?.status !== "ready" || !Array.isArray(body.value)) throw failure("subusage/response", "本机 DeepSeek 账号余额读取失败，请检查 DSH 的账号与余额页面", true);
 const wallets = body.value.filter(row => ["CNY", "USD"].includes(row?.currency) && typeof row.balance === "string" && decimal.test(row.balance));
 if (!wallets.length || wallets.length !== body.value.length) throw failure("subusage/response", "本机 DeepSeek 账号没有有效的充值余额信息");
 const row = wallets.find(row => row.currency === "CNY") ?? wallets[0];
 return { windows: [], extras: [{ kind: "balance", value: `${row.balance} ${row.currency}` }], coverage: "complete" };
}
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
	if (!windows.length && num(data.usage) !== undefined) extras.push({ kind: "spend", value: `${Math.round(data.usage * 100) / 100} USD` });
	if (!windows.length && !extras.length) throw failure("subusage/response", "OpenRouter 响应没有可用的限额、余额或用量");
	return { windows: cascadeRateLimited(windows), extras, coverage: windows.length || extras.some(e => e.kind !== "plan") ? "complete" : "partial" };
}
// ── 余额型聚合商（各家单位与形状都不同，逐个显式换算，不做通用折算）────────────────
/** Novita：金额单位是 1/10000 USD（10000 = $1.00）。 */
export function normalizeNovitaBalance(body) {
	// 官方金额为十进制字符串；不接受空串、指数或十六进制等非金额写法。
	const raw = body?.availableBalance;
	const available = typeof raw === "number" && Number.isFinite(raw) ? raw
		: typeof raw === "string" && /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)$/.test(raw.trim()) && Number.isFinite(Number(raw)) ? Number(raw) : undefined;
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
	return { windows: cascadeRateLimited(windows), extras: [], coverage: "complete" };
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
	for (const [field, kind] of [["quota_5_hour", "5h"], ["quota_7_day", "week"]]) {
		const quota = data[field];
		if (quota === undefined || quota === null) continue;
		if (typeof quota !== "object" || Array.isArray(quota) || num(quota.usage_percentage) === undefined) throw failure("subusage/response", "Invalid ZenMux quota window");
		const detail = num(quota.used_flows) !== undefined && num(quota.max_flows) !== undefined ? { used: quota.used_flows, limit: quota.max_flows, unit: "flows" } : undefined;
		windows.push(windowRow(kind, quota.usage_percentage * 100, typeof quota.resets_at === "string" ? quota.resets_at : undefined, undefined, detail));
	}
	// quota_monthly 只有上限，未报告实时用量；不从短窗拼造月百分比。
	const tier = data.plan && typeof data.plan.tier === "string" ? data.plan.tier.trim() : "";
	if (tier) extras.push({ kind: "plan", value: tier });
	const balance = balanceBody?.data && typeof balanceBody.data === "object" && !Array.isArray(balanceBody.data) ? balanceBody.data : {};
	const total = num(balance.total_credits);
	if (total !== undefined) {
		const currency = typeof balance.currency === "string" && /^[A-Za-z]{3}$/.test(balance.currency) ? balance.currency.toUpperCase() : "";
		extras.push({ kind: "balance", value: `${Math.round(total * 100) / 100} ${currency}`.trim() });
	}
	if (!windows.length && !extras.length) throw failure("subusage/response", "ZenMux 响应没有可用的配额或余额");
	return { windows: cascadeRateLimited(windows), extras, coverage: windows.length || total !== undefined ? "complete" : "partial", ...(["suspended", "banned"].includes(data.account_status) ? { availability: "blocked", availabilityReason: "account-restricted" } : {}) };
}
/**
 * 把接口下发的窗口秒数映射到既有窗口档位。官方对 Design Plan 只承诺 5 小时 / 7 天两种窗口，
 * 且随套餐而变（Go 两个都有，Plus / Pro / Max 只有 7 天窗），所以按**实际时长**判断，
 * 不从套餐名反推窗口集合。
 */
// ── 中转聚合商（契约 2026-10-30 用真实 Key 实测）──────────────────────────
/**
 * APIGOTO：`GET /v1/usage`（推理 Key 的 Bearer）返回
 *   { is_active, isValid, mode, remaining, unit, subscription: {
 *       plan_name, policy_name, expires_at, used, limit, window_sec, unit } ,
 *     points, balance, balance_usd }
 * 窗口长度由 `window_sec` 决定——官方不保证固定周期，按秒数换算成既有档位，
 * 不从套餐名反推。百分比由 used/limit 算出（接口本身不给百分比）。
 * `subscription.expires_at` 是**套餐到期时间**，不是窗口重置时间：当成 resetsAt 写进去，
 * 会让「本周额度重置」显示成一个月后的日期，所以只作为套餐信息文字带出，不产 resetsAt。
 * `remaining` 是套餐内**剩余额度**（unit 给出的货币），`balance_usd` 是另开一个充值钱包：
 * 两者不是一回事。钱包为 0 时绝不能当成「余额耗尽」告警盖掉套餐里还剩下的钱。
 *
 * 显示取舍：`plan` 徽标只放套餐名（标题行一行内放得下）；到期日与剩余天数另起说明行，
 * 因为「还有 29 天」这类结论放进徽标会被挤成一串。`policy_name` 实测只比套餐名多一个厂商
 * 前缀，与套餐名相同时不重复占行。`mode` 只在能翻译成中文时显示；`points` 为 0 时不占行。
 * `now` 可注入，只为让「还有几天」的断言不依赖运行时刻。
 */
export function normalizeApigoto(body, now = Date.now()) {
	if (!body || typeof body !== "object" || Array.isArray(body)) throw failure("subusage/response", "Invalid APIGOTO usage response");
	const num = value => typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : undefined;
	const decimal = value => typeof value === "string" && /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)$/.test(value.trim()) ? Number(value) : num(value);
	const round = value => Math.round(value * 100) / 100;
	const windows = [];
	const extras = [];
	const sub = body.subscription && typeof body.subscription === "object" && !Array.isArray(body.subscription) ? body.subscription : undefined;
	if (sub) {
		const used = num(sub.used), limit = num(sub.limit);
		if (used !== undefined && limit !== undefined && limit > 0) {
			const seconds = num(sub.window_sec);
			const kind = seconds === undefined || seconds <= 0 ? "period" : windowKindFromSeconds(seconds);
			// 窗口单位随套餐而定（实测是 rpm_credits），如实带出去而不是硬写成 requests。
			const unit = typeof sub.unit === "string" && sub.unit.trim() ? sub.unit.trim() : undefined;
			windows.push(windowRow(kind, Math.min(100, used / limit * 100), undefined, undefined, { used: Math.round(used), limit: Math.round(limit), ...(unit ? { unit } : {}) }));
		}
		const plan = typeof sub.plan_name === "string" && sub.plan_name.trim() ? sub.plan_name.trim() : "";
		if (plan) extras.push({ kind: "plan", value: plan });
		// 到期日：这是套餐到期，不是窗口重置。带上剩余天数才看得出「快到期了没有」。
		if (typeof sub.expires_at === "string" && Number.isFinite(Date.parse(sub.expires_at))) {
			const at = Date.parse(sub.expires_at);
			const date = new Date(at).toISOString().slice(0, 10);
			const days = Math.ceil((at - now) / 86400000);
			extras.push({ kind: "note", value: days > 0 ? `套餐到期 ${date}（还有 ${days} 天）` : `套餐已于 ${date} 到期` });
		}
		// 策略名与套餐名实测只差厂商前缀；重复一遍等于同一句话说两次。
		const policy = typeof sub.policy_name === "string" && sub.policy_name.trim() ? sub.policy_name.trim() : "";
		if (policy && policy !== plan) extras.push({ kind: "note", value: `策略 ${policy}` });
	}
	// 计费模式：只认得出订阅制与按量计费两种，其它原样带出，不猜。
	const mode = typeof body.mode === "string" && body.mode.trim() ? body.mode.trim() : "";
	if (mode) {
		// 用 Map 而非对象字面量：`obj[mode]` 会命中 `__proto__` / `constructor` 这类原型属性，
		// 把上游的奇怪取值渲染成 `[object Object]`。
		const MODE_LABEL = new Map([["subscription", "订阅制"], ["paygo", "按量计费"], ["pay-as-you-go", "按量计费"]]);
		extras.push({ kind: "note", value: `计费模式：${MODE_LABEL.get(mode.toLowerCase()) ?? mode}` });
	}
	// 积分：0 是没有信息量的默认值，不占行。
	const points = num(body.points);
	if (points !== undefined && points > 0) extras.push({ kind: "note", value: `积分 ${round(points)}` });
	// 主余额取套餐内的 remaining（单位随 unit，实测 USD）；它缺了才回落到充值钱包 balance_usd。
	const remaining = decimal(body.remaining);
	const wallet = decimal(body.balance_usd);
	const currency = typeof body.unit === "string" && /^[A-Z]{3}$/.test(body.unit.trim()) ? body.unit.trim() : "USD";
	if (remaining !== undefined) {
		extras.push({ kind: "balance", value: `${round(remaining)} ${currency}` });
		// 充值钱包另有余额时才提一句，0 元钱包不是告警，不占一行。
		if (wallet !== undefined && wallet > 0) extras.push({ kind: "note", value: `充值钱包另有 ${round(wallet)} USD` });
	} else if (wallet !== undefined) extras.push({ kind: "balance", value: `${round(wallet)} USD` });
	// is_active=false / isValid=false 是明确的上游状态（套餐失效或 Key 被停用），不是解析问题。
	if (body.is_active === false || body.isValid === false) extras.push({ kind: "note", value: "套餐无效或已停用" });
	// 「有数据」只算窗口、余额或上游明确的停用状态。套餐名 / 到期 / 策略 / 模式 / 积分都是元数据，
	// 只有它们说明这次响应里没有额度可读——不能让一条「计费模式：订阅制」把失败装成成功。
	const hasQuota = windows.length > 0 || extras.some(item => item.kind === "balance" || item.kind === "spend");
	const hasStatus = extras.some(item => item.kind === "note" && item.value === "套餐无效或已停用");
	if (!hasQuota && !hasStatus) throw failure("subusage/response", "APIGOTO 响应没有可用的额度或余额");
	return windowExtrasResult({ windows, extras, coverage: windows.length && extras.some(e => e.kind === "balance") ? "complete" : "partial" });
}
/**
 * OpenDesign（open-design.ai / Powerformer）Coding Plan 订阅额度。
 * 契约是 2026-10-18 用真实账号实测出来的（`GET /api/v1/workspaces/<id>/billing/coding-plan-usage`）：
 * 结构是**扁平的**，没有嵌套的 codingPlan，也没有钱包余额字段。
 *   { workspaceId, generatedAt, eligible: boolean, tier: "go"|"plus"|"pro"|"max"|null,
 *     windows: [{ policyId, durationSeconds, resetMode, usedCredits,
 *                 limitCredits, remainingCredits, windowStart, resetsAt }] }
 * 三个额度字段都是**字符串**（额度最小单位的整数），接口本身不下发百分比：百分比只能由
 * usedCredits / limitCredits 自己算。
 * 官方语义（https://open-design.ai/model-credits/）：7 天与 5 小时窗只约束 Design Plan
 * 额度；plan model credits 不受这两个窗约束、按账期发放与重置，两者共用同一份消费记录。
 *
 * 第二个参数 `summary` 是 `GET /api/v1/billing/summary`（账号级，2026-10-20 实测）的原始响应，
 * 可省略：它带来**另一个池**——套餐模型额度（订阅额度）与钱包余额（订阅 + 充值），
 * 不在上面那个接口里。该接口字段（均为字符串）：
 *   { balanceUsd, creditsPerUsd: 10000, balances: { subscriptionCredits, rechargeCredits,
 *     totalAvailableCredits }, membershipTier, subscriptionCurrentPeriodStart / End, ... }
 */
export function normalizeOpenDesign(body, summary) {
	const root = body && typeof body === "object" && !Array.isArray(body) ? body : undefined;
	if (!root) throw failure("subusage/response", "OpenDesign 响应不是 JSON 对象");
	// 这个端点没有公开文档：一个预期字段都读不到时，说明契约又变了（改名、外面套了信封、
	// 或者直接回了错误壳）。这种情况必须报「无法解析」，不能把「什么都没读到」说成
	// 「该账号没有订阅」——那是一个确定的负面结论，比未知更误导人。
	// 判据只认「额度语义」字段：eligible / tier / windows。**不认 workspaceId**——它在每条
	// 200 响应里都有，单凭它只能说明「是同一个工作区」，不能说明额度读到了；也不认
	// generatedAt 这种通用时间戳。tier 明确为 null 是「确定没有套餐」，算读到了答案。
	const recognized = typeof root.eligible === "boolean" || typeof root.tier === "string" || root.tier === null || Array.isArray(root.windows);
	if (!recognized) throw failure("subusage/response", "OpenDesign 响应没有可用的配额或余额");
	// 非负额度（字符串或数字都收）；取不到合法值就返回 undefined，绝不当作 0。
	const credits = value => {
		if (typeof value === "number") return Number.isFinite(value) && value >= 0 ? value : undefined;
		if (typeof value !== "string" || !/^\d+$/.test(value.trim())) return undefined;
		const parsed = Number(value.trim());
		return Number.isFinite(parsed) ? parsed : undefined;
	};
	const windows = [];
	for (const row of Array.isArray(root.windows) ? root.windows : []) {
		if (!row || typeof row !== "object" || Array.isArray(row)) continue;
		const seconds = typeof row.durationSeconds === "number" && Number.isFinite(row.durationSeconds) && row.durationSeconds > 0 ? row.durationSeconds : undefined;
		const used = credits(row.usedCredits), limit = credits(row.limitCredits);
		// 上限读不到或为 0 时**跳过该窗口**，而不是画成 0%：不同模型的额度消耗倍率本来就不同，
		// 少一行读数好过编造一行。
		if (seconds === undefined || used === undefined || limit === undefined || limit <= 0) continue;
		// remainingCredits 是接口自己报的剩余量，能拿到就照报（它与 limit − used 未必相等：
		// 不同模型的消耗倍率不同），拿不到就只报 used / limit。
		const remaining = credits(row.remainingCredits);
		const detail = remaining === undefined ? { used, limit, unit: "credits" } : { used, remaining, limit, unit: "credits" };
		windows.push(windowRow(windowKindFromSeconds(seconds), Math.min(100, used / limit * 100), typeof row.resetsAt === "string" ? row.resetsAt : undefined, undefined, detail));
	}
	const extras = [];
	const TIER = { go: "Go", plus: "Plus", pro: "Pro", max: "Max" };
	const tier = typeof root.tier === "string" && root.tier.trim() ? TIER[root.tier.trim()] ?? root.tier.trim() : "";
	if (tier) extras.push({ kind: "plan", value: tier });
	// 账号级余额汇总是**另一个池**：Design Plan 的 5 小时 / 7 天窗只约束 Design Plan 额度，
	// 套餐模型额度与钱包余额不在 coding-plan-usage 里。汇总缺失时照常只报窗口。
	const billing = openDesignBilling(summary);
	extras.push(...billing.extras);
	// balanceOk 与 MiMo 共用同一套「登录验证」契约：CookieLogin 只在它为真时才保存 Cookie。
	// 走到这里请求已经成功并解析完毕，因此是 true——「未订阅」也是读到了确定的答案，不是失败。
	// 既没有窗口也没有档位：该账号没有 Design Plan 订阅，用 subscribed:false 让前端收起额度区，
	// 而不是画一张 0% 的空卡片；钱包余额照常保留。
	if (!windows.length && !tier) {
		extras.unshift({ kind: "plan", value: "该账号没有 Design Plan 订阅" });
		return { windows: [], extras, coverage: "complete", subscribed: false, balanceOk: true };
	}
	// 汇总没有本期发放总额；模型等效额度不能作为钱包分母，因此不追加推算的月池窗口。
	// 有档位却读不到窗口，与「有窗口」不同：额度线还没下发，标 partial，别让它看起来是完整读数。
	return { windows: cascadeRateLimited(windows), extras, coverage: windows.length ? "complete" : "partial", balanceOk: true };
}
const openDesignNumber = value => {
	if (typeof value === "number") return Number.isFinite(value) ? value : undefined;
	const raw = typeof value === "string" ? value.trim() : "";
	return /^-?\d+(\.\d+)?$/.test(raw) && Number.isFinite(Number(raw)) ? Number(raw) : undefined;
};
/** 钱包余额与套餐模型额度的剩余量。读不到就什么都不报，绝不补 0。 */
function openDesignBilling(summary) {
	const extras = [];
	if (!summary || typeof summary !== "object" || Array.isArray(summary)) return { extras };
	const perUsd = openDesignNumber(summary.creditsPerUsd);
	const subscription = openDesignNumber(summary.balances?.subscriptionCredits);
	if (perUsd !== undefined && perUsd > 0 && subscription !== undefined && subscription >= 0) {
		extras.push({ kind: "monthly-balance", value: `${Math.round(subscription / perUsd * 100) / 100} USD` });
	}
	// 页面上的「钱包余额」= 订阅额度 + 充值额度（2026-10-20 与控制台悬浮明细逐项对过）。
	const balance = openDesignNumber(summary.balanceUsd) ?? openDesignNumber(summary.totalAvailableCreditsUsd);
	if (balance !== undefined && balance >= 0) extras.push({ kind: "balance", value: `${Math.round(balance * 100) / 100} USD` });
	return { extras };
}

/**
 * 额度接口的路径里必须带真实 workspaceId：`GET .../workspaces/current` 单独请求是 200，
 * 但把 `current` 当路径参数塞进额度 URL 会回 403 `workspace_member_required`（2026-10-18 实测）。
 * 所以先读当前工作区拿到 id，再拼额度 URL。id 只放行裸标识符，避免拼出别的路径。
 */
async function openDesignWorkspace(get, cookie) {
	const current = await get(OPEN_DESIGN_CURRENT_URL, { cookie });
	const id = typeof current?.workspaceId === "string" ? current.workspaceId.trim() : "";
	if (!/^[A-Za-z0-9_-]{1,64}$/.test(id)) throw failure("subusage/response", "OpenDesign 没有返回可用的工作区标识（workspaceId）");
	return { id, type: current.workspaceType };
}
/**
 * 兄弟插件 dsh-antigravity-acp（包名 `dsh-bundle-antigravity-host`）的额度快照 → 本插件的条目。
 * 快照形状取自该包 `src/runtime/quota.ts` 的 `QuotaSnapshot`：
 *   { status: "ok" | "error", updatedAt, plan?, stale?, staleReason?,
 *     groups: [{ name, buckets: [{ name, window?, remainingPct?, remainingFraction?, resetTime?, disabled }] }],
 *     credits?: { status, remainingCredits?, planName? }, error? }
 * 三条换算约定：
 * 1. 它报的是**剩余**（0..1 的 `remainingFraction` 或 `remainingPct`），本插件对外只认
 *    `percent` = **已用**百分比，所以按 `100 − 剩余` 换算；两个字段都缺就跳过该窗口，绝不补 0。
 * 2. `disabled` 的含义是「此窗口对本账号不可用」，**不是**「已达限额」，映射成 rate-limited 会让
 *    调用方以为额度用尽；因此不产出窗口，只在 extras 里留一条说明，其余窗口照常报。
 * 3. 它只给比例、不给绝对值，所以不写 `detail.used/limit`——不编造额度线。
 */
export function normalizeAntigravity(snapshot) {
	const root = snapshot && typeof snapshot === "object" && !Array.isArray(snapshot) ? snapshot : undefined;
	if (!root) throw failure("subusage/response", "Antigravity 额度快照不是对象");
	const groups = Array.isArray(root.groups) ? root.groups : [];
	const windows = [], extras = [];
	let disabled = 0, unreported = 0;
	for (const group of groups) {
		const name = typeof group?.name === "string" ? group.name.trim() : "";
		for (const bucket of Array.isArray(group?.buckets) ? group.buckets : []) {
			if (!bucket || typeof bucket !== "object" || Array.isArray(bucket)) continue;
			if (bucket.disabled === true) { disabled++; continue; }
			const remaining = antigravityRemaining(bucket);
			if (remaining === undefined) { unreported++; continue; }
			// 组名本身就是「这条窗口约束哪批模型」（Gemini Models / Claude and GPT models…），
			// 单组时同样保留：丢了它就看不出这条百分比管的是哪批模型。
			windows.push({ ...windowRow(antigravityWindowKind(bucket), 100 - remaining, bucket.resetTime), ...(name ? { groupLabel: name } : {}) });
		}
	}
	if (disabled) extras.push({ kind: "note", value: `${disabled} 个额度窗口已停用（本账号不可用）` });
	if (unreported) extras.push({ kind: "note", value: `${unreported} 个额度窗口未报告剩余比例` });
	const plan = typeof root.plan === "string" ? root.plan.trim() : "";
	if (plan) extras.push({ kind: "plan", value: plan });
	const credits = root.credits && typeof root.credits === "object" ? root.credits : undefined;
	if (credits?.status === "ok" && Number.isSafeInteger(credits.remainingCredits) && credits.remainingCredits >= 0) extras.push({ kind: "balance", value: `${credits.remainingCredits} credits` });
	else if (!plan && typeof credits?.planName === "string" && credits.planName.trim()) extras.push({ kind: "plan", value: credits.planName.trim() });
	if (root.status !== "ok") {
		const reason = typeof root.error?.message === "string" && root.error.message.trim() ? root.error.message : "Antigravity 额度读取失败";
		return { providerId: ANTIGRAVITY_ID, label: LINKED_PROVIDERS[ANTIGRAVITY_ID].label, state: "error", windows: [], extras, coverage: "partial", freshness: "unknown", error: reason };
	}
	return {
		providerId: ANTIGRAVITY_ID, label: LINKED_PROVIDERS[ANTIGRAVITY_ID].label, state: "ok", windows, extras,
		coverage: windows.length ? "complete" : "partial",
		freshness: root.stale === true ? "stale" : "fresh",
		...(typeof root.updatedAt === "string" && Number.isFinite(Date.parse(root.updatedAt)) ? { lastSuccessAt: new Date(root.updatedAt).toISOString() } : {})
	};
}
/** 剩余比例（0..100）：`remainingPct` 优先，其次 0..1 的 `remainingFraction`；都不合法就返回 undefined。 */
function antigravityRemaining(bucket) {
	const pct = Number.isFinite(bucket.remainingPct) && bucket.remainingPct >= 0 && bucket.remainingPct <= 100 ? bucket.remainingPct : undefined;
	if (pct !== undefined) return pct;
	const fraction = Number.isFinite(bucket.remainingFraction) && bucket.remainingFraction >= 0 && bucket.remainingFraction <= 1 ? bucket.remainingFraction : undefined;
	return fraction === undefined ? undefined : fraction * 100;
}
/** 窗口长度 → 本插件的 kind 词汇；只用官方下发的 `window` / `name` 判断，认不出就按 `period`。 */
function antigravityWindowKind(bucket) {
	const raw = `${typeof bucket.window === "string" ? bucket.window : ""} ${typeof bucket.name === "string" ? bucket.name : ""}`.toLowerCase();
	if (/5\s*h|5\s*小时|five\s*-?\s*hour/.test(raw)) return "5h";
	if (/7\s*d|week|每周|周/.test(raw)) return "week";
	if (/month|每月|月度|月/.test(raw)) return "month";
	if (/day|daily|每日|每天|天/.test(raw)) return "day";
	return "period";
}
/**
 * dsh-tool-antigravity（服务名 `antigravityAuth`，方法 `usage()`）的配额视图 → 本插件条目。
 * 视图形状照抄该包 `lib/types/quota.d.ts` 的 `QuotaStatusView`（v0.5.x，由
 * @cortexkit/antigravity-auth-core 的 retrieveUserQuotaSummary 归一化产出）：
 *   { state: "available" | "unauthenticated" | "forbidden" | "rate-limited"
 *           | "offline" | "timeout" | "protocol-drift",
 *     checkedAt?: ISO,
 *     groups?: [{ group: "gemini" | "non-gemini", modelCount,
 *                 windows: [{ window: "5h" | "weekly", remainingFraction: 0..1, resetTime }] }] }
 * 换算约定与 normalizeAntigravity 一致：
 * 1. 它报的是**剩余**比例，对外 percent = 已用 = `(1 − remainingFraction) × 100`；
 * 2. `gemini` / `non-gemini` 两组分别标注 groupLabel（该组窗口约束哪批模型，徽章口径照抄它
 *    自己的 pet-balance 卡片：Gemini / Claude / GPT）；
 * 3. `unauthenticated` 与 Trae 联动的 signed-out 同口径：返回 null——没登录不是故障，
 *    全量查询里不占行，点名时由 linkedProvider 补一条可执行说明；
 * 4. 其余非 available 状态各给一条可读 error（查询限流 ≠ 额度用尽，绝不画成红色耗尽窗口）。
 */
export function normalizeAntigravityAuthView(view) {
	const root = view && typeof view === "object" && !Array.isArray(view) ? view : undefined;
	if (!root) throw failure("subusage/response", "Antigravity 配额视图不是对象");
	const base = { providerId: ANTIGRAVITY_ID, label: LINKED_PROVIDERS[ANTIGRAVITY_ID].label, windows: [], extras: [], coverage: "partial", freshness: "unknown" };
	const fail = message => ({ ...base, state: "error", error: message });
	switch (root.state) {
		case "unauthenticated": return null;
		case "forbidden": return fail("当前 Antigravity 账号无权查询配额（未完成 Google 授权、企业授权受限，或未开通 Cloud Code Assist）");
		case "rate-limited": return fail("Antigravity 配额查询被限流，请稍后重试");
		case "timeout": return fail("Antigravity 配额查询超时，请稍后重试");
		case "offline": return fail("Antigravity 配额服务暂时不可达（网络或代理问题），请稍后重试");
		case "protocol-drift": return fail("Antigravity 配额响应格式无法识别，提供方插件（dsh-tool-antigravity）可能需要更新");
		case "available": break;
		default: return fail("Antigravity 配额状态无法识别");
	}
	const groupLabels = { gemini: "Gemini 模型", "non-gemini": "Claude 与 GPT 模型" };
	const windowKinds = { "5h": "5h", weekly: "week" };
	const windows = [];
	for (const group of Array.isArray(root.groups) ? root.groups : []) {
		if (!group || typeof group !== "object" || Array.isArray(group)) continue;
		const label = groupLabels[group.group] ?? (typeof group.group === "string" ? group.group : "");
		for (const bucket of Array.isArray(group.windows) ? group.windows : []) {
			if (!bucket || typeof bucket !== "object" || Array.isArray(bucket)) continue;
			const fraction = Number.isFinite(bucket.remainingFraction) && bucket.remainingFraction >= 0 && bucket.remainingFraction <= 1 ? bucket.remainingFraction : undefined;
			// 比例 / 窗口档位缺任一个都不造窗口（与对方 normalizeQuotaResponse 的放行条件一致）。
			if (fraction === undefined || !(bucket.window in windowKinds)) continue;
			windows.push({
				...windowRow(windowKinds[bucket.window], (1 - fraction) * 100, bucket.resetTime),
				...(label ? { groupLabel: label } : {})
			});
		}
	}
	return {
		...base, state: "ok", windows,
		coverage: windows.length ? "complete" : "partial",
		freshness: "fresh",
		...(typeof root.checkedAt === "string" && Number.isFinite(Date.parse(root.checkedAt)) ? { lastSuccessAt: new Date(root.checkedAt).toISOString() } : {})
	};
}
/**
 * dsh-connect-trae 的用量文档（`TraeWebUsage`）→ 本插件的条目。
 * 文档形状取自该包 `lib/index.d.ts` 的 `TraeWebUsage`（v4.3.0）；它由对方挂在
 * `/plugins/dsh-connect-trae/usage?region=<cn|enterprise|ai>` 的路由产出，是它自己卡片读的那份。
 * 三个 tab 的语义不同，因此三种映射：
 *  - `cn`：积分制。`credits.total/consumed/available` 是**积分包的合计上限 / 已用 / 余量**
 *    （绝对值，不是百分比），所以按 `consumed / total` 算已用比例；Work 积分与通用积分两个桶
 *    分别照实报成备注，积分包的到期提醒也照它自己的口径报。
 *  - `ai`：订阅制，没有积分字段；只有 `payStatus`（档位、试用、是否买了套餐）。
 *  - `enterprise`：租户额度**它自己也读不到**（所有租户额度端点 404），照实说「只能在企业控制台看」，
 *    绝不把个人积分挪到企业标题下。
 * `status: "signed-out"` 返回 `null`（该区域没登录，不算故障，也没有数字可报）。
 */
export function normalizeTrae(snapshot, providerId = "trae", now = Date.now()) {
	const meta = LINKED_PROVIDERS[providerId] ?? LINKED_PROVIDERS.trae;
	if (!snapshot || typeof snapshot !== "object" || Array.isArray(snapshot)) throw failure("subusage/response", "Trae 用量响应不是对象");
	if (Array.isArray(snapshot.accountReadings) && snapshot.accountReadings.length) {
		const accounts = snapshot.accountReadings.map(row => {
			const entry = normalizeTrae({ ...snapshot, accountReadings: undefined, status: "signed-in", accountId: row.id, accountName: row.accountName, credits: row.credits, payStatus: row.payStatus, creditsError: undefined, payStatusError: undefined }, providerId, now);
			if (!entry) return null;
			const data = { ...entry, ...accountMetadata(row, snapshot, now), extras: entry.extras.filter(extra => extra.kind !== "account") };
			if (meta.panel !== "enterprise" && (row.error || !row.credits && !row.payStatus)) return { ...data, state: "error", freshness: "unknown", coverage: "partial", windows: [], extras: [], error: "提供方未能读取此账号额度，请检查该账号登录状态" };
			if (meta.panel === "enterprise") return data;
			const checkedAt = Number.isFinite(snapshot.generatedAt) && snapshot.generatedAt > 0 && snapshot.generatedAt <= 8.64e15 ? new Date(snapshot.generatedAt).toISOString() : undefined;
			const fresh = checkedAt && snapshot.generatedAt <= now + 60000 && now - snapshot.generatedAt <= 180000 && !row.refreshFailed;
			return { ...data, freshness: fresh ? "fresh" : "stale", ...(checkedAt && !row.refreshFailed ? { lastSuccessAt: checkedAt } : {}), ...(row.refreshFailed ? { coverage: "partial", error: "提供方刷新失败，保留已有额度" } : {}) };
		}).filter(Boolean);
		if (!accounts.length) return null;
		if (accounts.length === 1) return { ...accounts[0], linkedAccounts: accounts };
		const successful = accounts.filter(account => account.state === "ok");
		return { providerId, label: meta.label, state: successful.length ? "ok" : "error", windows: [], extras: [], coverage: accounts.every(account => account.state === "ok" && account.coverage === "complete") ? "complete" : "partial", freshness: successful.length ? successful.every(account => account.freshness === "fresh") ? "fresh" : "stale" : "unknown", linkedAccounts: accounts, ...(!successful.length ? { error: "提供方未能读取已登录账号的额度" } : {}) };
	}
	if (snapshot.status === "signed-out") return null;
	const base = { providerId, label: meta.label, state: "ok", windows: [], extras: [], coverage: "partial", freshness: "fresh" };
	if (snapshot.status === "error") return { ...base, state: "error", freshness: "unknown", error: typeof snapshot.message === "string" && snapshot.message.trim() ? snapshot.message : "Trae 用量读取失败" };
	if (snapshot.status !== "signed-in") throw failure("subusage/response", `Trae 用量响应的 status 无法识别：${String(snapshot.status)}`);
	const extras = [];
	// 绑定的账号名只在「本机不止一个账号」时才写：单账号时它只是重复标题，多账号时它是
	// 「这份数字属于谁」的唯一线索（对方卡片的账号表就靠它区分）。
	const accounts = Array.isArray(snapshot.accounts) ? snapshot.accounts : [];
	const accountName = typeof snapshot.accountName === "string" ? snapshot.accountName.trim() : "";
	if (accountName && accounts.length > 1) extras.push({ kind: "account", value: `${traeMaskAccount(accountName)}（本机共 ${accounts.length} 个账号）` });
	const windows = [];
	if (meta.panel === "enterprise" && !accounts.some(account => account?.enterprise === true)) return null;
	if (meta.panel === "cn") {
		const credits = snapshot.credits && typeof snapshot.credits === "object" && !Array.isArray(snapshot.credits) ? snapshot.credits : undefined;
		const total = traeNumber(credits?.total), consumed = traeNumber(credits?.consumed), available = traeNumber(credits?.available);
		// 有上限才给百分比；没有上限就只报余量，绝不拿 0 当分母。
		if (total !== undefined && total > 0 && consumed !== undefined) {
			windows.push(windowRow("period", consumed / total * 100, undefined, undefined, {
				used: traeRound(consumed), limit: traeRound(total),
				remaining: traeRound(Math.max(0, available ?? total - consumed)), unit: "credits"
			}));
		}
		if (available !== undefined) extras.push({ kind: "balance", value: `${traeRound(available)} credits` });
		const work = traeNumber(credits?.workAvailable), general = traeNumber(credits?.generalAvailable);
		// 只在真报了值的时候写：缺席就什么都不说，而不是补一个 0（与 traeNumber 的口径一致）。
		const buckets = [];
		if (work !== undefined) buckets.push(`Work 积分 ${traeRound(work)}`);
		if (general !== undefined) buckets.push(`通用积分 ${traeRound(general)}`);
		if (buckets.length) extras.push({ kind: "note", value: buckets.join(" / ") });
		const packageRows = Array.isArray(credits?.accounts) ? credits.accounts.map(pkg => ({
			name: traeText(pkg?.displayDesc, 120) || "积分包", remaining: traeNumber(pkg?.remain), unit: "credits",
			expiresAt: traeNumber(pkg?.expiresAtMs) > 0 ? pkg.expiresAtMs : undefined,
		})) : [];
		if (packageRows.length) extras.push(...summarizeCreditPackages(packageRows, now).extras);
		else extras.push(...traeExpiryNotes(credits?.expiry));
		if (!credits && traeText(snapshot.creditsError)) extras.push({ kind: "note", value: `积分读取失败：${traeText(snapshot.creditsError)}` });
		return { ...base, windows, extras, coverage: credits ? "complete" : "partial" };
	}
	if (meta.panel === "ai") {
		const pay = snapshot.payStatus && typeof snapshot.payStatus === "object" && !Array.isArray(snapshot.payStatus) ? snapshot.payStatus : undefined;
		if (pay) {
			const plan = typeof pay.payIdentityStr === "string" ? pay.payIdentityStr.trim() : "";
			if (plan) extras.push({ kind: "plan", value: plan });
			if (pay.inTrial === true && Number.isFinite(pay.trialEndTimeMs) && pay.trialEndTimeMs > 0) extras.push({ kind: "note", value: `试用至 ${new Date(pay.trialEndTimeMs).toISOString()}` });
			else if (pay.inTrial === true) extras.push({ kind: "note", value: "试用中" });
			if (pay.hasPackage === false) extras.push({ kind: "note", value: "未订阅付费套餐" });
		} else if (traeText(snapshot.payStatusError)) extras.push({ kind: "note", value: `订阅状态读取失败：${traeText(snapshot.payStatusError)}` });
		return { ...base, extras, coverage: pay ? "complete" : "partial" };
	}
	// enterprise：有企业账号但额度不可读——把这个事实说清楚，不留一个空的「额度」。
	extras.push({ kind: "note", value: "企业租户额度只能在企业控制台查看，本插件没有可读的接口（不报个人积分）" });
	return { ...base, extras };
}
/** 非负有限数字（对方的金额都是 number）；不合法就返回 undefined，绝不当作 0。 */
function traeNumber(value) {
	return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : undefined;
}
const traeRound = value => Math.round(value * 100) / 100;
/** 上游文本进模型上下文前截断：对方可能回一整段 HTML/堆栈，原样塞进去只会挤掉真正的数据。 */
function traeText(value, limit = 200) {
	if (typeof value !== "string") return "";
	const text = value.trim();
	return text.length > limit ? `${text.slice(0, limit)}…` : text;
}
/** 账号名掩码：实测是邮箱形态，模型不需要完整地址，能分辨是哪一份即可。 */
function traeMaskAccount(name) {
	const text = name.trim(), at = text.indexOf("@");
	if (at > 0) return `${text.slice(0, 1)}***@${text.slice(at + 1)}`;
	return text.length > 2 ? `${text.slice(0, 1)}***` : text;
}
/** 旧聚合响应没有逐包日期：只保留仍需关注的 24 小时 / 3 天窗口，已过期与 7 天档不展示。 */
function traeExpiryNotes(expiry) {
	if (!expiry || typeof expiry !== "object" || Array.isArray(expiry)) return [];
	const tiers = [["within24h", "24 小时内到期"], ["within3d", "3 天内到期"]];
	const notes = [];
	for (const [key, label] of tiers) {
		const bucket = expiry[key];
		const total = traeNumber(bucket?.total);
		if (total === undefined || total <= 0) continue;
		const earliest = Number.isFinite(bucket?.earliestExpiresAtMs) && bucket.earliestExpiresAtMs > 0 ? `（最早 ${new Date(bucket.earliestExpiresAtMs).toISOString()}）` : "";
		notes.push({ kind: "note", value: `${label}：${traeRound(total)} credits${earliest}` });
	}
	return notes;
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
 * 各预算同时生效，分别保留；**没有上限时不编造百分比**，只如实显示已用金额。
 * 接口不给重置时刻时不显示重置（别把金额渲染成倒计时）。
 * https://docs.litellm.ai/docs/proxy/virtual_keys
 */
export function normalizeLitellm(keyBody, budgetBody) {
	const num = value => typeof value === "number" && Number.isFinite(value) ? value : undefined;
	const pick = value => value && typeof value === "object" && !Array.isArray(value) ? value : undefined;
	// 真实响应是 `{ key, info: {...} }`；也接受直接把字段放在顶层。
	const keyInfo = pick(keyBody?.info) ?? pick(keyBody);
	if (!keyInfo) throw failure("subusage/response", "Invalid LiteLLM key info response");
	const scopes = [["key", keyInfo]];
	for (const body of Array.isArray(budgetBody) ? budgetBody : [budgetBody]) {
		if (pick(body?.team_info)) scopes.push(["team", body.team_info]);
		else if (pick(body?.user_info)) scopes.push(["user", body.user_info]);
		else if (pick(body)) scopes.push(["scope", body]);
	}
	const windows = [], extras = [];
	const round = value => Math.round(value * 100) / 100;
	for (const [scope, row] of scopes) {
		const spend = num(row.spend), maxBudget = num(row.max_budget);
		if (spend === undefined || spend < 0) continue;
		if (maxBudget !== undefined && maxBudget > 0) {
			const resetAt = typeof row.budget_reset_at === "string" ? row.budget_reset_at : undefined;
			windows.push({ ...windowRow("period", spend / maxBudget * 100, resetAt, undefined, { used: round(spend), limit: round(maxBudget), unit: "USD" }), ...(scopes.length > 1 ? { budgetScope: scope } : {}) });
		} else extras.push({ kind: scope === "key" ? "spend" : `${scope}-spend`, value: `${round(spend)} USD` });
	}
	if (!windows.length && !extras.length) throw failure("subusage/response", "LiteLLM 响应没有可用的预算或花费");
	// 各预算同时约束，不用更宽松的上级覆盖 Key。
	return { windows, extras, coverage: "complete" };
}
function availableProviders(ctx) {
 try { return [...new Set(ctx.llm.listProviders().map(p => p.id))]; }
 catch { return []; }
}
function detectConfigured(ctx) {
 try { const ids = new Set(ctx.llm.listProviders().map(p => p.id)); return Object.fromEntries(IDS.map(id => [id, ids.has(id) || id === "deepseek-account" && ids.has("deepseek-official")])); }
 catch { return undefined; }
}
/**
 * 交给 Client 的公开运行环境快照：只说「这台主机能不能自动登录」以及为什么，不暴露路径、
 * 版本细节之外的本机信息。Client 据此把「登录并自动导入」换成「在浏览器登录后粘贴 Cookie」，
 * 并换上手机能照着做的步骤；桌面主机 mobile 为 false，UI 与文案完全照旧。
 */
function publicHostRuntime(runtime) {
 const out = { mobile: !!runtime?.mobile, browserLogin: !runtime?.mobile };
 if (runtime?.bridge) out.bridge = runtime.bridge;
 return out;
}
const codec = (type, parse) => ({ mode: "strict", typeSymbol: `dsh-subusage#${type}`, schema: { parse }, create: () => ({ parse }) });
const resultCodec = codec("SubUsageResult", value => { if (!value || !Array.isArray(value.entries) || !value.settings || !value.configured || typeof value.updatedAt !== "string") throw invalid("Invalid result"); return value; });
/** 联动项（antigravity / trae*）的客户端药丸查询：只接受已登记的联动 id。 */
function parseLinkedQuery(value) {
 if (value === undefined || value === null) return { providerIds: [], force: false };
 if (typeof value !== "object" || Array.isArray(value)) throw invalid("Invalid linked query");
 // providerIds 必须是数组、force 必须是布尔（与 Client 出站校验同契约）；联动 id 之外的过滤丢弃。
 if (!Array.isArray(value.providerIds) || typeof value.force !== "boolean") throw invalid("Invalid linked query");
 const ids = value.providerIds.filter(id => typeof id === "string" && LINKED_IDS.includes(id));
 return { providerIds: [...new Set(ids)], force: value.force };
}
/** 联动结果不带 settings/configured：客户端只合 entries，避免轮询顶掉设置快照。 */
const linkedResultCodec = codec("SubUsageLinkedResult", value => {
 if (!value || !Array.isArray(value.entries) || typeof value.updatedAt !== "string") throw invalid("Invalid linked result");
 return value;
});
/** 页面代取的单步请求：只带 providerId 与"已取到的响应"，响应体原样回传由 Host 归一化。 */
function parseLinkedStep(value) {
	if (!value || typeof value !== "object" || Array.isArray(value)) throw invalid("Invalid linked step");
	if (typeof value.providerId !== "string" || !value.providerId) throw invalid("Invalid linked step provider");
	const raw = Array.isArray(value.responses) ? value.responses : [];
	// 静默丢弃非法行会让同一个 key 被反复索要（页面烧完轮数后表现为「没有数据」），所以直接拒绝。
	if (raw.length > 32) throw invalid("Invalid linked step responses");
	const responses = raw.map(row => {
		if (!row || typeof row.key !== "string" || !row.key || !Number.isFinite(row.status)) throw invalid("Invalid linked step response");
		return { key: row.key, status: row.status, ok: row.ok === true, body: row.body };
	});
	return { providerId: value.providerId, responses, force: value.force === true };
}
const linkedStepResultCodec = codec("SubUsageLinkedStepResult", value => {
	if (!value || typeof value !== "object") throw invalid("Invalid linked step result");
	if (value.missing !== undefined && value.missing !== null) {
		if (typeof value.missing.key !== "string" || typeof value.missing.url !== "string") throw invalid("Invalid linked step request");
		return { missing: { key: value.missing.key, url: value.missing.url } };
	}
	if (value.entry !== undefined && value.entry !== null) return { entry: value.entry };
	return { absent: true };
});
function parseLoginStart(value) { if (!value || typeof value.expectedRevision !== "string" || !value.expectedRevision) throw invalid("Invalid login revision"); return { expectedRevision: value.expectedRevision }; }
function parseLoginCancel(value) { if (!value || typeof value.jobId !== "string" || !value.jobId) throw invalid("Invalid login job"); return { jobId: value.jobId }; }
// 登录状态的**字段白名单**：只放行下面这些键，其余一律拒绝。
// 这不是洁癖：状态会原样经 RPC 回到页面，任何凭据字段（passToken / serviceToken / ssecurity /
// nonce / cookie / lp）一旦被误写进 job.public，就必须在这里被挡住，而不是靠"写的时候小心"。
const LOGIN_STATE_KEYS = new Set(["jobId", "state", "startedAt", "finishedAt", "message", "errorCode", "result", "qr", "qrTip", "expiresInSec", "providerId", "channel"]);
// 明确点名已知敏感字段，命中时给出可读原因，便于排查时立刻看出是哪里漏了。
const LOGIN_SECRET_KEYS = new Set(["passToken", "serviceToken", "ssecurity", "nonce", "cookie", "api-platform_serviceToken", "userId", "location", "lp", "ticket"]);
const loginCodec = codec("SubUsageLoginState", value => {
 if (!value || !(value.jobId === null || typeof value.jobId === "string") || !["idle", "starting", "launching", "waiting", "verifying", "success", "cancelled", "error"].includes(value.state)) throw invalid("Invalid login state");
 for (const key of Object.keys(value)) {
  if (LOGIN_SECRET_KEYS.has(key)) throw invalid(`Login state must not carry credential field: ${key}`);
  if (!LOGIN_STATE_KEYS.has(key)) throw invalid(`Unexpected login state field: ${key}`);
 }
 // 扫码登录额外带二维码与提示；它们只是展示数据。
 if (value.qr !== undefined && typeof value.qr !== "string") throw invalid("Invalid login QR");
 if (value.qrTip !== undefined && value.qrTip !== null && typeof value.qrTip !== "string") throw invalid("Invalid login QR tip");
 if (value.expiresInSec !== undefined && (!Number.isFinite(value.expiresInSec) || value.expiresInSec <= 0)) throw invalid("Invalid login expiry");
 if (value.result) resultCodec.schema.parse(value.result);
 return value;
});
export const subUsageRemote = {
 package: name,
 descriptors: [
  { id: `${name}#subUsage/read`, service: "subUsage", namespace: "subUsage", method: "read", invocation: { kind: "direct" }, parameters: [{ name: "request", wire: "request", source: "json", acceptsUndefined: true, codec: codec("SubUsageQuery", parseQuery) }], result: resultCodec },
  ...[["refresh", "request", "SubUsageQuery", parseQuery], ["save", "settings", "SubUsageSettings", parseSettings]].map(([method, param, type, parse]) => ({ id: `${name}#subUsage/${method}`, service: "subUsage", namespace: "subUsage", method, invocation: { kind: "direct" }, parameters: [{ name: param, wire: param, source: "json", codec: codec(type, parse) }], result: resultCodec })),
  // 联动项（antigravity / trae*）走独立通道：它们没有设置/凭据字段，结果只有 entries。
  { id: `${name}#subUsage/readLinked`, service: "subUsage", namespace: "subUsage", method: "readLinked", invocation: { kind: "direct" }, parameters: [{ name: "request", wire: "request", source: "json", acceptsUndefined: true, codec: codec("SubUsageLinkedQuery", parseLinkedQuery) }], result: linkedResultCodec },
	// 页面代取通道的单步：宿主说「还缺哪个 URL」→ 页面取回 → 宿主归一化。见 linkedStep 的注释。
	{ id: `${name}#subUsage/linkedStep`, service: "subUsage", namespace: "subUsage", method: "linkedStep", invocation: { kind: "direct" }, parameters: [{ name: "request", wire: "request", source: "json", codec: codec("SubUsageLinkedStep", parseLinkedStep) }], result: linkedStepResultCodec },
  { id: `${name}#subUsage/getMimoLoginStatus`, service: "subUsage", namespace: "subUsage", method: "getMimoLoginStatus", invocation: { kind: "direct" }, parameters: [], result: loginCodec },
  ...[["startMimoLogin", "MimoLoginStart", parseLoginStart], ["cancelMimoLogin", "MimoLoginCancel", parseLoginCancel]].map(([method, type, parse]) => ({ id: `${name}#subUsage/${method}`, service: "subUsage", namespace: "subUsage", method, invocation: { kind: "direct" }, parameters: [{ name: "request", wire: "request", source: "json", codec: codec(type, parse) }], result: loginCodec })),
  // 小米扫码登录：与浏览器登录同形（start / status / cancel），额外在状态里带二维码。
  { id: `${name}#subUsage/getMimoQrStatus`, service: "subUsage", namespace: "subUsage", method: "getMimoQrStatus", invocation: { kind: "direct" }, parameters: [], result: loginCodec },
  ...[["startMimoQrLogin", "MimoQrStart", parseLoginStart], ["cancelMimoQrLogin", "MimoQrCancel", parseLoginCancel]].map(([method, type, parse]) => ({ id: `${name}#subUsage/${method}`, service: "subUsage", namespace: "subUsage", method, invocation: { kind: "direct" }, parameters: [{ name: "request", wire: "request", source: "json", codec: codec(type, parse) }], result: loginCodec })),
  { id: `${name}#subUsage/getOpenDesignLoginStatus`, service: "subUsage", namespace: "subUsage", method: "getOpenDesignLoginStatus", invocation: { kind: "direct" }, parameters: [], result: loginCodec },
  ...[["startOpenDesignLogin", "OpenDesignLoginStart", parseLoginStart], ["cancelOpenDesignLogin", "OpenDesignLoginCancel", parseLoginCancel]].map(([method, type, parse]) => ({ id: `${name}#subUsage/${method}`, service: "subUsage", namespace: "subUsage", method, invocation: { kind: "direct" }, parameters: [{ name: "request", wire: "request", source: "json", codec: codec(type, parse) }], result: loginCodec }))
 ]
};

/**
 * 某条 provider 的缓存键。Command Code 是多账户的：额外账户（凭据引用名）各占一份缓存，
 * 否则账户 A 的结果会被账户 B 顶掉——每读一次全部账户就把前面几家的缓存驱逐一遍，
 * 60 秒 TTL 形同虚设。默认账户（""/"default"）与其它 provider 仍按 id 单键。
 */
function providerCacheKey(id, account = "") {
	// 任何 provider 的额外凭据引用名都各占一份缓存：多 Key 监控时互不驱逐。
	return account !== "" && account !== "default" ? `${id}@${account}` : id;
}
/**
 * 把 no-key 文案里的**凭据引用名**（`apiKeyEnv`）换成账户标签。
 * 对外额度视图承诺不返回继承变量名/凭据引用，而错误文案里嵌了引用名（「...无引用 COMMANDCODE_ACCOUNT_WORK」）；
 * Client 通道（read/refresh）**保留**引用名——那是本机界面，用户要靠它定位该往哪个 ref 里写凭据。
 */
function redactAccountRef(message, ref, label) {
	if (typeof message !== "string" || typeof ref !== "string" || ref === "" || !message.includes(ref)) return message;
	return message.split(ref).join(label);
}
// 可注入仅供隔离测试；生产仍由当前 manifest 的 Cordis ctx.plugin 注册。
export class SubUsageService extends TypertRemoteService {
 constructor(ctx, options = {}) {
  super(ctx, "subUsage"); this.ctx = ctx;
  this.io = options.io ?? { readFileSync, mkdirSync, writeFileSync, renameSync, chmodSync };
  this.path = options.configPath ?? CONFIG_PATH; this.fetcher = options.fetch ?? globalThis.fetch;
  this.now = options.now ?? Date.now;
  // 运行环境：dsh-go 手机本机引擎里没有 Chrome，自动登录必然失败，要提前告诉 UI 而不是让它点空。
  // 可注入（options.hostRuntime）以便隔离测试在手机上仍能验证「桌面行为」。
  this.hostRuntime = options.hostRuntime ?? detectHostRuntime(this.io);
  // identity 解析（凭据服务/登录文件读取）与 HTTP 同量级的超时，默认 10s（对齐 fetchJson 的
  // AbortSignal.timeout）；经 options 注入以便测试用极短值，不必真等 10 秒。
  this.identityTimeoutMs = options.identityTimeoutMs ?? 10000;
  this.accountBalanceTimeoutMs = options.accountBalanceTimeoutMs ?? 10000;
  this.deepseekAccount = options.resolveDeepseekAccount ?? (() => ctx.get?.("deepseekAccount"));
  // 解析器按「provider id + 凭据引用名」取数；引用名缺省时用该家的主名（PROVIDERS[id].envName）。
  // 同一家可能有多个引用名（见 credentialRefNames），identity 会逐个名字试。
  this.credentials = options.resolveCredentials ?? (async (id, refName = PROVIDERS[id].envName) => await ctx.get?.("credentials")?.resolve(credentialRef(refName)));
  this.environment = options.resolveEnvironment ?? ((id, refName = PROVIDERS[id].envName) => launchEnvironmentOf(ctx).get(refName));
  // 火山方舟的 AK/SK 不是路由的推理 Key，按固定变量名各自解析，两端都命中才算配对。
  this.credentialByName = options.resolveCredentialByName ?? (async refName => await ctx.get("credentials")?.resolve(credentialRef(refName)));
  this.environmentByName = options.resolveEnvironmentByName ?? (refName => launchEnvironmentOf(ctx).get(refName));
  // 额外账户按凭据引用名（apiKeyEnv）解析，与提供方插件 slots()/resolveRef 同一通道；
  // 默认账户仍走上面的 envName 链（凭据服务 → 启动环境 → ~/.commandcode/auth.json）。
  this.accountCredentials = options.resolveAccountCredentials ?? (async ref => await ctx.get("credentials")?.resolve(credentialRef(ref)));
  this.accountEnvironment = options.resolveAccountEnvironment ?? (ref => launchEnvironmentOf(ctx).get(ref));
  // Command Code 多账户：账户列表与当前固定账户由提供方插件写在它自己的 settings namespace
 // （llm-commandcode）里，Host 端经 settings 服务读取。服务未挂载（提供方插件未运行）时读不到，
 // 工具退回单账户模式；options.settingsService 供隔离测试注入。
 this.settingsService = options.settingsService;
 try { ctx.inject?.(["settings"], (scope) => { if (scope.settings !== undefined) this.settingsService = scope.settings; }); } catch { /* settings 服务不可用：保持单账户模式 */ }
 this.authFile = options.resolveAuthFile ?? (async () => commandCodeAuthFileKey(this.io));
  // SuperGrok 只读共享登录文件（~/.grok/auth.json 等）取 OAuth Bearer；可注入仅供隔离测试。
  this.grokAuth = options.resolveGrokAuth ?? (async () => grokAuthFileCredentials(this.io));
  // 过期时借 dsh-grok-kit 的官方会话链刷新同一登录文件；解析不到兄弟插件时返回 undefined 并降级。
  this.resolveGrokKit = options.resolveGrokKit ?? loadGrokKit;
  // Codex 只读共享登录文件（$CODEX_HOME/auth.json 或 ~/.codex/auth.json）取 OAuth access token。
  this.codexAuth = options.resolveCodexAuth ?? (async () => (await codexSubscriptionCredentials(ctx.get?.("credentials"))) ?? codexAuthFileCredentials(this.io, { CODEX_HOME: (await this.environmentByName("CODEX_HOME"))?.value }));
  // GitHub Copilot 只读 dsh-copilot-auth 写在 DSH 凭据库里的 OAuth 记录（llm-pi-ai/github-copilot）；可注入仅供隔离测试。
  this.copilotAuth = options.resolveCopilotAuth ?? (async () => await copilotCredentials(ctx.get?.("credentials")));
  // 兄弟插件 dsh-antigravity-acp 的额度服务（key `agyQuota`）：弱依赖，服务不在就返回 null、
  // 不产出条目。**不碰凭据、不自己请求上游**——官方 CLI 登录态与取数缓存都由它持有，
  // 这里重复实现只会多一份凭据读取路径，还会与它的缓存打架。可注入仅供隔离测试。
  this.antigravityQuota = options.resolveAntigravityQuota ?? (async force => {
   // 取服务用非严格模式：这是**弱依赖**——提供方插件还在加载（fiber 未 ready）时也要能用它，
   // 真出问题时会在 read() 里报错并折叠成一条可读条目，比「明明装了却当成没装」好。
   const service = ctx.get?.("agyQuota", false);
   if (!service || typeof service.read !== "function") return null;
   return await service.read({ force: force === true });
  });
  // 本机另一个 Antigravity 提供方插件 dsh-tool-antigravity：它把认证服务 provide 成
  // `antigravityAuth`（AntigravityAuthService），usage(signal?, force?) 返回 QuotaStatusView。
  // 同样是弱依赖、只读：登录态与取数缓存都在对方那里，这里不读凭据、不请求上游。
  this.antigravityAuthQuota = options.resolveAntigravityAuthQuota ?? (async force => {
   const service = ctx.get?.("antigravityAuth", false);
   if (!service || typeof service.usage !== "function") return null;
   return await service.usage(undefined, force === true);
  });
  // 兄弟插件 dsh-connect-trae 的用量：它没有 Cordis 服务，唯一只读口是它挂在本机 web 服务器上的
  // `/plugins/dsh-connect-trae/usage?region=<panel>`（它自己的卡片读同一条路由）。**只读、无凭据**：
  // 登录态、设备号与取数缓存都在它那边，这里只把它的答案转成本插件的条目形状。
  // 可注入仅供隔离测试（生产走 fetchTraeUsage → 本机回环 HTTP）。
   this.connect = new ConnectUsageReader({ readJson: (plugin, endpoint, query) => this.fetchConnectUsage(plugin, endpoint, query), now: this.now });
   this.desktopUsage = new DesktopUsageReader({ readJson: (plugin, endpoint, query) => this.fetchConnectUsage(plugin, endpoint, query), now: this.now });
   this.traeRead = options.resolveTraeUsage ?? ((panel, force) => this.connect.readTrae(panel, force));
   this.workBuddyRead = options.resolveWorkBuddyUsage ?? ((region, force) => this.connect.readWorkBuddy(region, force));
   // EAC 三渠道是 Loomy / Raccoon / Qoder 中国版的**回退来源**（现有独立插件与 OFM 缺席时才问它），
   // 走它挂在本机 web 服务器上的 `/api/eac-router` 只读 JSON-RPC；可注入仅供隔离测试。
   this.linkedSteps = new Map();
   this.localMisses = new Map();
   this.traeCredentials = new Map();
   // 直取要读的两处本机数据都可以被注入：账号索引文件与 Trae 的 storage.json 候选路径。
   // 这样隔离测试能完全绕开真实凭据目录，不必依赖「io 桩恰好抛错」这种隐式保证。
   this.localAccountsFile = options.localAccountsFile ?? join(process.env.DSH_HOME || join(homedir(), ".dsh"), "channel-pack", "state.json");
   // 账号池在前：客户端 storage.json 只有「当前登录」，多账号只在池里。
   this.traeStoragePaths = options.traeStoragePaths ?? [...traePoolCandidates(), ...traeStorageCandidates()];
  this.eac = new EacUsageReader({ call: options.resolveEacUsage ?? (channel => this.fetchEacUsage(channel)), now: this.now });
   this.eacRead = (channel, force) => Promise.resolve().then(() => this.eac.read(channel, force));
   // 本机直取：读 DSH 凭据库里的账号凭据，自己调上游只读额度接口。失败即抛，由调用方静默回退。
   this.local = new LocalUsageReader({
    accounts: options.resolveLocalAccounts ?? (channel => this.localAccountRefs(channel)),
    resolve: options.resolveLocalCredential ?? (async ref => {
     if (typeof ref === "string" && ref.startsWith("trae-auth:")) {
      const spec = ref.slice("trae-auth:".length);
      const at = spec.lastIndexOf("#");
      const file = at > 0 ? spec.slice(0, at) : spec;
      const index = at > 0 ? Number(spec.slice(at + 1)) : 0;
      const rows = this.localTraeCredentials(file);
      return rows?.[Number.isInteger(index) && index >= 0 ? index : 0];
     }
     const hit = await this.accountCredentials(ref);
     if (typeof hit?.value !== "string" || !hit.value.trim()) return undefined;
     try { return JSON.parse(hit.value); } catch { return undefined; }
    }),
    now: this.now,
    signal: () => this.requestSignal(),
    ...(options.localFetch ? { fetchImpl: options.localFetch } : {}),
   });
   this.localRead = (channel, force) => Promise.resolve().then(() => this.local.read(channel, force));
   // ConnectUsageReader 按插件与地区负责60秒缓存、在途合并及强制刷新排序。
  this.ofm = new OfmReader(ctx, { inspectCredential: options.inspectLinkedCredential ?? (async refName => {
    const service = ctx.get?.("credentials", false);
    if (!service || typeof service.resolve !== "function") return "unknown";
    const resolved = await service.resolve(credentialRef(refName));
    return typeof resolved?.value === "string" && resolved.value.trim() ? "present" : "missing";
   }) });
  this.ofmRead = options.resolveOfmUsage ?? ((channel, force) => this.ofm.read(channel, force, this.requestSignal()));
  // 联动取数不能把整份报告拖住：官方 CLI / 对方路由都可能要几秒到数十秒，超过这个预算就交
  // 一条可读的超时条目（对方的缓存仍会在后台补上，下次查询即可命中）。
  this.linkedTimeoutMs = options.linkedTimeoutMs ?? 15000;
  this.cache = new Map(); this.inflight = new Map(); this.generations = new Map(); this.fingerprints = new Map(); this.disposed = false; this.controller = new AbortController();
  // MiMo 静默续期：同一时刻只允许一次换票（mimoRenewing）；失败状态只在内存里按续期材料记（mimoRenewState），
  // 重启后允许重新尝试一次；账本记录续期引起的设置变化，refresh 据此不把它当成「读取期间配置被改」。
  this.mimoRenewFetch = options.mimoRenewFetch ?? this.fetcher; this.mimoRenewOptions = options.mimoRenew ?? {};
  this.mimoRenewing = null; this.mimoRenewState = null; this.renewalLedger = [];
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
    return this.result(latest, entry ? [redactSecret(entry, latest.xiaomi.cookie)] : []);
   }
  }, { now: this.now, browserLogin: !this.hostRuntime.mobile, noBrowserMessage: MOBILE_NO_BROWSER_MESSAGE, ...options.mimoLogin });
  // 小米扫码登录：手机上浏览器不让导出 Cookie，于是改用小米账号官方的「扫一扫」授权。
  // 全程不需要浏览器，验证与保存复用同一套回调，落点与手动粘贴 Cookie 完全一致。
  this.mimoQr = new MimoQrLogin({
   error: failure,
   capture: revision => { const s = this.load(); if (revision !== hash(s)) throw failure("subusage/revision-conflict", "设置已被其他窗口修改，请重新读取"); return this.mimoMaterial(s); },
   verify: (cookie, signal) => { parseSettings({ providerId: "xiaomi-token-plan-cn", cookieUpdate: { action: "replace", value: cookie } }); return this.fetchProvider("xiaomi-token-plan-cn", { key: cookie, source: "cookie" }, this.load(), signal); },
   // 扫码任务回传的第 4 个参数是 passToken 的有效期，不是控制台 Cookie 的：它随续期材料（第 5 个参数）
   // 一起落盘，不能拿来给 Cookie 的 24 小时计时封顶。
   commit: (cookie, captured, verified, _passTokenExpiresAt, renewal) => this.commitMimoLogin(cookie, captured, verified, 0, renewal),
   reconcileResult: result => {
    const latest = this.load();
    if (this.disposed || this.mimoMaterial(latest) !== this.loginResultMaterial) return null;
    const entry = this.cache.get("xiaomi-token-plan-cn")?.entry;
    return this.result(latest, entry ? [redactSecret(entry, latest.xiaomi.cookie)] : []);
   }
  }, { now: this.now, ...options.mimoQr });
  // OpenDesign 与 MiMo 共用同一份 CookieLogin 骨架，差别只在站点参数（登录入口、取 Cookie 的 URL、
  // 提取规则）。凭据落到通用的手动 Key 槽并把模式切成 manual，这样身份解析链立刻就能读到它。
  this.openDesignLogin = new OpenDesignLogin({
   error: failure,
   capture: revision => { const s = this.load(); if (revision !== hash(s)) throw failure("subusage/revision-conflict", "设置已被其他窗口修改，请重新读取"); return this.openDesignMaterial(s); },
   verify: (cookie, signal) => { parseSettings({ providerId: "opendesign", keyUpdate: { action: "replace", value: cookie } }); return this.fetchProvider("opendesign", { key: cookie, source: "manual" }, this.load(), signal); },
   commit: (cookie, captured, verified, observedExpiresAt) => this.commitOpenDesignLogin(cookie, captured, verified, observedExpiresAt),
   reconcileResult: result => {
    const latest = this.load();
    if (this.disposed || this.openDesignMaterial(latest) !== this.openDesignLoginResultMaterial) return null;
    // 同一身份也只回放当前缓存，旧额度已失效时不返回旧 entry。
    const entry = this.cache.get("opendesign")?.entry;
    return this.result(latest, entry ? [redactSecret(entry, typeof latest.keys.opendesign === "string" ? latest.keys.opendesign : "")] : []);
   }
  }, { now: this.now, browserLogin: !this.hostRuntime.mobile, noBrowserMessage: MOBILE_NO_BROWSER_MESSAGE, ...options.openDesignLogin });
  ctx.effect?.(() => () => this.dispose());
 }
 load() {
  try { return parseStored(JSON.parse(this.io.readFileSync(this.path, "utf8"))); }
  catch (e) { if (e?.code === "ENOENT") return defaultSettings(); throw failure("subusage/config", "无法读取订阅设置"); }
 }
 result(settings, entries) { return { updatedAt: new Date(this.now()).toISOString(), settings: publicSettings(settings, this.now()), configured: detectConfigured(this.ctx), availableProviders: availableProviders(this.ctx), host: publicHostRuntime(this.hostRuntime), entries }; }
  /**
   * 该订阅对应的模型路由实际声明的凭据引用名（路由 profile 的 `apiKeyEnv`）。
   * DSH 客户端（Models 页）保存自定义 API Key 时，写进凭据库的就是这个引用名；
   * 插件内置 `envName` 只是没有 profile 时的缺省值。用户改过路由的 `apiKeyEnv`
   * 后两者会不一致（例如本机 Kimi 路由写的是 `KIMI_API_KEY`，内置名是
   * `KIMI_CODING_API_KEY`），只认内置名就会读不到客户端刚填的新 Key，继续拿
   * 环境变量里的旧值。读不到目录/设置时返回 undefined，调用方继续用内置名。
   */
  routeCredentialRef(id) {
   try {
    const directory = this.ctx.llm?.listConfigurableProviders?.();
    const entry = Array.isArray(directory) ? directory.find(item => item?.provider === id) : undefined;
    if (!entry || typeof entry.settingsNs !== "string" || !entry.settingsNs || !Array.isArray(entry.settingsPath) || !entry.settingsPath.length) return undefined;
    const rows = this.settingsService?.describe?.({ redactSecrets: true });
    const row = Array.isArray(rows) ? rows.find(item => item?.ns === entry.settingsNs) : undefined;
    let node = row?.value;
    for (const segment of entry.settingsPath) {
     if (!node || typeof node !== "object" || Array.isArray(node)) return undefined;
     node = node[segment];
    }
    const ref = node?.apiKeyEnv;
    return typeof ref === "string" && isCredentialRefName(ref) ? ref : undefined;
   } catch { return undefined; }
  }
  /**
   * 解析凭据时按序尝试的引用名：DSH 路由实际 `apiKeyEnv`（药丸跟随模型实际调用的 Key）
   * → 用户为该 provider 配置的额外监控引用名 → 内置主名 → 内置别名（去重）。
   */
  credentialRefCandidates(id, settings) {
   const names = [this.routeCredentialRef(id), ...(settings?.keyRefs?.[id] ?? []), ...credentialRefNames(id)];
   return names.filter((refName, index) => typeof refName === "string" && refName !== "" && names.indexOf(refName) === index);
  }
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
   // 优先只读 Subscription 活动 OAuth，再回落 CLI；续约由凭据所属插件负责。
   const cred = await this.codexAuth();
   return cred?.key ? { key: cred.key, source: cred.source ?? "auth-file", ...(cred.accountId ? { accountId: cred.accountId } : {}), ...(Number.isFinite(cred.expiresAt) ? { expiresAt: cred.expiresAt } : {}) } : { key: undefined, source: "none" };
  }
  if (id === "github-copilot") {
   // 只读 Copilot 提供方的 OAuth 记录；续期/登录归它所有，这里不铸令牌、不写回。
   const cred = await this.copilotAuth();
   return cred?.key ? { key: cred.key, source: cred.source ?? "copilot-oauth", apiHost: cred.apiHost } : { key: undefined, source: "none" };
  }
  // 指定了凭据引用名（多 Key 监控的额外账户 / Command Code 额外账户）：只用该引用解析。
  if (account && account !== "default") {
   if (!isCredentialRefName(account)) return { key: undefined, source: "none", ref: account };
   const hit = await this.accountCredentials(account);
   if (typeof hit?.value === "string" && hit.value.trim()) return { key: hit.value.trim(), source: "credentials", ref: account };
   const env = await this.accountEnvironment(account);
   if (typeof env?.value === "string" && env.value.trim()) return { key: env.value.trim(), source: "env", ref: account };
   return { key: undefined, source: "none", ref: account };
  }
  // manual 只表示「用保存的手动 Key」，不是「不再看别处」：手动 Key 被删除后
  // keyMode 可能仍是 manual（旧配置、直接清 keys、Host 未重启），此时若短路成
  // none，就连继承的凭据服务/环境变量也一起读不到。有 Key 才用手动，否则继续走继承链。
  if (!PROVIDERS[id].managedByPlugin && s.keyModes[id] === "manual" && s.keys[id]?.trim()) return { key: s.keys[id].trim(), source: "manual" };
  if (id === "deepseek-account") {
    const service = this.deepseekAccount();
    const ready = typeof service?.getState === "function" && typeof service?.getBalance === "function" && (await service.getState())?.status === "credential-stored";
    return { key: undefined, source: ready ? "account-service" : "none" };
   }
   // 逐引用名解析：路由实际声明 apiKeyEnv（客户端 Models 页写 Key 用的就是它）优先，
   // 再回退用户额外配置的引用名与内置主名/别名；每个名字内部先凭据服务、后启动环境。
   for (const refName of this.credentialRefCandidates(id, s)) {
    const hit = await this.credentials(id, refName);
    if (typeof hit?.value === "string" && hit.value.trim()) return { key: hit.value.trim(), source: "credentials", ref: refName };
    const env = await this.environment(id, refName);
    if (typeof env?.value === "string" && env.value.trim()) return { key: env.value.trim(), source: "env", ref: refName };
   }
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
  // 与普通 Key 同理：manual 仅在手上有完整配对时生效，清掉 AK/SK 后要能回落到继承来源。
  if (s.keyModes[id] === "manual" && ak && sk) return { key: ak, secret: sk, source: "manual" };
  const credentialAk = await this.credentialByName(VOLC_ACCESS_KEY_ENV), credentialSk = await this.credentialByName(VOLC_SECRET_KEY_ENV);
  if (typeof credentialAk?.value === "string" && credentialAk.value.trim() && typeof credentialSk?.value === "string" && credentialSk.value.trim()) return { key: credentialAk.value.trim(), secret: credentialSk.value.trim(), source: "credentials" };
  const envAk = await this.environmentByName(VOLC_ACCESS_KEY_ENV), envSk = await this.environmentByName(VOLC_SECRET_KEY_ENV);
  if (typeof envAk?.value === "string" && envAk.value.trim() && typeof envSk?.value === "string" && envSk.value.trim()) return { key: envAk.value.trim(), secret: envSk.value.trim(), source: "env" };
  return ak && sk ? { key: ak, secret: sk, source: "manual" } : { key: undefined, secret: undefined, source: "none" };
 }
 /**
  * Grok 登录文件的 access token 过期时，借 dsh-grok-kit 的官方会话链续约：getAuth("xai")
  * 在共享凭据 store 的写锁内二次检查并刷新，新 token 由官方链写回同一个 ~/.grok/auth.json，
  * 与 grok-kit 聊天/搜索/Grok CLI 是同一套锁协议，不会顶掉 refresh-token 轮换。
  * 不直接信任 getAuth 返回值：无论刷新由本进程还是并发的另一进程完成，一律重读登录文件拿新 token 与新过期时间。
  * 回到 { renewed:true, identity }；兄弟插件不可用时 unavailable:true；刷新尝试失败时带 refreshError。
  */
 async renewGrokIdentity(identity, signal) {
  if (!identity.expiresAt || Date.parse(identity.expiresAt) > this.now()) return { renewed: false, unavailable: true, identity };
  let kit;
  try { kit = await this.resolveGrokKit(); } catch { kit = undefined; }
  if (!kit?.XaiOAuthSession) return { renewed: false, unavailable: true, identity };
  let session;
  let refreshError;
  try {
   session = new kit.XaiOAuthSession();
   // pi-ai 内部有 15s 刷新超时与 2s 文件锁预算；外层再兜 20s 总预算，避免挂死药丸/工具刷新。
   const deadline = AbortSignal.timeout(20000);
   await session.models.getAuth("xai", { signal: signal ? AbortSignal.any([signal, deadline]) : deadline });
  } catch (error) { refreshError = error; }
  finally { try { session?.dispose?.(); } catch { /* 会话只持有进程内模型缓存，dispose 失败无后果 */ } }
  const cred = await this.grokAuth();
  if (cred?.key && cred.key !== identity.key && (!cred.expiresAt || Date.parse(cred.expiresAt) > this.now())) {
   return { renewed: true, identity: { key: cred.key, source: "auth-file", ...(cred.userId ? { userId: cred.userId } : {}), ...(cred.expiresAt ? { expiresAt: cred.expiresAt } : {}) } };
  }
  return { renewed: false, unavailable: false, refreshError, identity };
 }
 async fetchProvider(id, identity, settings, signal = this.controller.signal) {
  const get = (url, headers, init) => fetchJson(this.fetcher, url, headers, signal, init);
  // 火山方舟额度走管控面 OpenAPI：POST 根路径 + Action/Version 在 query，鉴权是 AK/SK 签名。
  if (PROVIDERS[id].credentialKind === "volc") {
   const spec = PROVIDERS[id];
   const call = async (action, payload) => {
    const body = payload === undefined ? "{}" : JSON.stringify(payload);
    const signed = volcSignature({ accessKeyId: identity.key, secretAccessKey: identity.secret, action, host: spec.volcHost, region: spec.volcRegion, body });
    const response = await get(signed.url, signed.headers, { method: "POST", body, notSubscribed404: true });
    const apiError = volcError(response);
    // 「这个账号没有这份套餐」不是故障，是答案：实测没有 BytePlus Coding Plan 的账号会返回
    // HTTP 404 `NotFound.BillingType`（coding plan config is not exist），`OperationDenied.NotSubscribed`
    // 同义。把它当错误抛出去，界面上就多一张红色卡片；正确做法是回报 subscribed:false 让前端收起。
    if (apiError && /^(NotFound\.BillingType|OperationDenied\.NotSubscribed)$/.test(apiError.code)) return { notSubscribed: true };
    if (apiError) throw volcFailure(action, apiError);
    return response;
   };
   // 额度线分组标注（AFP 的日限额只覆盖视觉 / 语音模型与 Harness）由 volcengine.js 的解析器产出，
   // 这里是把它带进 wire 的唯一通道：windowRow 只认五个字段，漏掉 groupLabel 会让前端静默失去分组。
   const toWindows = parsed => cascadeRateLimited(parsed.windows.map(w => ({ ...windowRow(w.kind, w.percent, w.resetsAt, w.percent >= 100 ? "rate-limited" : undefined, w.detail), ...(w.groupLabel ? { groupLabel: w.groupLabel } : {}) })));
   // 企业版/团队版：额度挂在席位上，先取 SeatID 再查该席位。
   if (spec.volcSeat) {
    const seatIds = parseVolcSeatIds(await call("ListSeatInfos", { Filter: {}, Scene: spec.volcScene, PageNum: 1, PageSize: 100 }));
    // 没有可读席位就是「这条团队版订阅用不上」——对用户而言与未订阅同义，如实回报以便前端收起。
    if (!seatIds.length) return { windows: [], extras: [{ kind: "plan", value: "该账号下没有可读的席位（或当前身份无权查看）" }], coverage: "partial", subscribed: false };
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
    return { windows: toWindows(parsed), extras, coverage: parsed.windows.length ? "complete" : "partial", subscribed: parsed.subscribed === true };
   }
   const body = await call(spec.volcAction);
   if (body?.notSubscribed) return { windows: [], extras: [{ kind: "plan", value: "该账号没有订阅这个套餐" }], coverage: "complete", subscribed: false };
   let parsed;
   try { parsed = spec.volcAction === "GetAFPUsage" ? parseVolcAgentPlan(body) : parseVolcCodingPlan(body); }
   catch { throw failure("subusage/response", `火山方舟 ${spec.volcAction} 的额度结构无法解析`); }
   const windows = toWindows(parsed);
   const extras = [];
   if (parsed.plan) extras.push({ kind: "plan", value: parsed.plan });
   // HTTP 200 但窗口为空是「未订阅」，不是 0% 用量：显式说明，不画零额度的假象。
   else if (!windows.length) extras.push({ kind: "plan", value: parsed.subscribed ? "本周期暂无窗口数据" : "未检测到该套餐订阅" });
   // 订阅状态要**结构化**带出去，不能只写进 extras 文案：同一组 AK/SK 能查到名下所有套餐，
   // 界面上若把 4 条路由一律列出来，用户根本分不清哪个是哪个。前端据此收起没订阅的那些。
   return { windows, extras, coverage: windows.length ? "complete" : "partial", subscribed: parsed.subscribed === true };
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
   if (id === "deepseek-account") {
    const service = this.deepseekAccount();
    if (typeof service?.getBalance !== "function") throw failure("subusage/response", "本机 DeepSeek 账号余额服务不可用", true);
    const body = await withTimeout(service.getBalance({ version: VERSION, locale: "zh-CN", timezoneOffsetSeconds: -new Date().getTimezoneOffset() * 60 }), this.accountBalanceTimeoutMs, () => failure("subusage/network", "本机 DeepSeek 账号余额读取超时", true));
    if (body === null) throw failure("subusage/auth", "本机 DeepSeek 账号未登录或登录已失效，请在 DSH 账号与余额页面确认");
    return normalizeDeepseekAccountBalance(body);
   }
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
   const data = normalizeZenmux(subscription, balance);
    if (subscription === undefined) {
     data.coverage = "partial";
     data.extras.push({ kind: "note", value: "余额已读取；套餐状态暂不可确认" });
    }
    return data;
  }
  // OpenDesign 的控制台额度接口是会话 Cookie 鉴权：显式覆盖通用 Bearer。
  if (id === "opendesign") {
   const cookie = typeof identity.key === "string" ? identity.key.trim() : "";
   // 用户通常整段复制 DevTools 里的 Cookie 头；不含 "=" 的值不可能是 Cookie，早点报清楚，
   // 免得「把 sk- 模型 Key 填进来了」被表现成一次莫名的 401。
   if (!cookie.includes("=")) throw failure("subusage/credentials", "OpenDesign 的凭据要填控制台会话 Cookie（形如 name=value; name2=value2）；模型调用用的 sk- API Key 查不到额度");
   const workspace = await openDesignWorkspace(get, cookie);
   const [usage, billing] = await Promise.allSettled([
    get(openDesignUsageUrl(workspace.id), { cookie }),
    workspace.type === "personal" ? get(OPEN_DESIGN_SUMMARY_URL, { cookie }) : Promise.resolve(undefined)
   ]);
   // 两池只对普通取数故障独立降级；认证失败不能被另一池成功结果掩盖。
   // 优先检查两端，防止先遇到的普通错误遮住认证错误，并阻止沿用旧额度。
   for (const result of [usage, billing]) {
    if (result.status === "rejected" && result.reason?.code === "subusage/auth") throw result.reason;
   }
   const summary = billing.status === "fulfilled" ? billing.value : undefined;
   let data;
   try {
    if (usage.status === "rejected") throw usage.reason;
    data = normalizeOpenDesign(usage.value, summary);
   } catch (error) {
    const extras = openDesignBilling(summary).extras;
    if (!extras.some(x => x.kind === "balance")) throw error;
    return { windows: [], extras: [...extras, { kind: "note", value: "钱包余额已读取；Design Plan 额度暂不可确认" }], coverage: "partial", balanceOk: true };
   }
   if (workspace.type !== "personal") data.extras.push({ kind: "note", value: "团队工作区或未知工作区：账号钱包口径未核实，暂不显示" });
   else if (!data.extras.some(x => x.kind === "balance")) {
    data.coverage = "partial";
    data.extras.push({ kind: "note", value: "Design Plan 额度已读取；钱包余额暂不可确认" });
   }
   return data;
  }
  // 中转聚合商：与推理**同一把 Key**，裸 GET + Bearer；端点登记在 PROVIDERS[id].usageUrl。
  if (id === "apigoto") return normalizeApigoto(await get(PROVIDERS[id].usageUrl, headers));
  if (id === "litellm") {
   // 地址是用户自己的 proxy；缺地址算「凭据不完整」，与缺 Key 一样给出可行动的指引。
   const root = litellmRoot(settings.litellm?.baseUrl);
   if (!root) throw failure("subusage/credentials", "未配置 LiteLLM 代理地址：在 设置 → 订阅用量 → LiteLLM 的「连接与凭据」里填写");
   const keyInfo = await get(`${root}/key/info`, headers);
   const own = keyInfo?.info && typeof keyInfo.info === "object" && !Array.isArray(keyInfo.info) ? keyInfo.info : {};
   // 更完整的预算视图在 user/team info；拿不到就退回 key 自身的 info。
   const scopes = [["team", own.team_id], ["user", own.user_id]].filter(([, value]) => typeof value === "string" && value.trim());
   const budgets = await Promise.all(scopes.map(async ([scope, value]) => {
     const body = await get(`${root}/${scope}/info?${scope}_id=${encodeURIComponent(value.trim())}`, headers).catch(() => undefined);
     return body ? body[`${scope}_info`] ? body : { [`${scope}_info`]: body } : undefined;
    }));
   const data = normalizeLitellm(keyInfo, budgets);
    if (budgets.some(body => body === undefined)) data.coverage = "partial";
    return data;
  }
  if (id === "commandcode") {
   // 与提供方插件同一凭据来源，但直连计费接口并行拉取：其 report() 会对每个账户
   // 串行 whoami + 三个端点（60 秒预算），作为药丸刷新来源太慢。仅并行读取余额与套餐/账期；请求头对齐其 accountHeaders。
   const billingHeaders = { ...headers, "accept-encoding": "identity", "x-command-code-version": COMMAND_CODE_CLI_VERSION, "x-cli-environment": "production" };
   const [credits, subscription] = await Promise.all([
    get(`${COMMAND_CODE_API_BASE}/alpha/billing/credits`, billingHeaders),
    get(`${COMMAND_CODE_API_BASE}/alpha/billing/subscriptions`, billingHeaders).catch(() => undefined)
   ]);
   const data = normalizeCommandCode(credits, subscription);
    if (subscription === undefined) data.coverage = "partial";
    return data;
  }
  if (id === "xai-oauth") {
   // 登录文件里的 access token 短命（实测 6 小时量级），而 grok-kit 的自动刷新是懒触发：
   // 只有它自己聊天/搜索遇到过期才刷，没有后台定时器。本插件每分钟读一次用量，是最常发现
   // 过期的一方——若只读不刷，就会出现「Grok Kit 显示已登录、用量卡片显示已过期」的割裂。
   // 过期时借 grok-kit 的官方会话链续约（同一文件、同一把写锁、compare-and-write，不顶轮换）；
   // 兄弟插件不可用或刷新失败时，才退回可行动的手动提示。
   let grok = identity;
   if (grok.expiresAt && Date.parse(grok.expiresAt) <= this.now()) {
    const outcome = await this.renewGrokIdentity(grok, signal);
    if (outcome.renewed) grok = outcome.identity;
    else if (outcome.unavailable) throw failure("subusage/auth", `Grok 登录文件的 access token 已于 ${new Date(identity.expiresAt).toLocaleString("zh-CN")} 过期，但本机未能加载 dsh-grok-kit（≥0.2.0）的自动刷新链。用一次 Grok CLI（登录后发一条消息），或在 设置 → xAI Grok 里重新登录，都会刷新同一个文件（${GROK_AUTH_FILE}）。`);
    else {
     const reason = outcome.refreshError?.message ? String(outcome.refreshError.message).slice(0, 200) : "登录刷新链未返回新凭据";
     throw failure("subusage/auth", `Grok 登录已于 ${new Date(identity.expiresAt).toLocaleString("zh-CN")} 过期，尝试经 dsh-grok-kit 自动刷新失败：${reason}。通常需要重新登录：在 设置 → xAI Grok 重新登录，或运行 grok login（同一登录文件 ${GROK_AUTH_FILE}）。`);
    }
   }
   // 直连官方 Grok CLI 计费代理；X-XAI-Token-Auth 的取值是 token_header 字符串（xai-grok-cli）
   // 而非布尔，x-userid 取登录文件。套餐名走 /v1/settings（subscription_tier_display），
   // 失败不阻塞用量（回退 billing 响应里的 subscription_tier）。
   const grokHeaders = { authorization: `Bearer ${grok.key}`, "x-xai-token-auth": GROK_TOKEN_AUTH, "x-grok-client-version": GROK_CLIENT_VERSION, ...(grok.userId ? { "x-userid": grok.userId } : {}) };
   // REST `?format=credits` 优先；部分 X 订阅迁移账号上该格式会 500（序列化失败），
   // 再用同一 OAuth Bearer 打 grok.com 的 GetGrokCreditsConfig gRPC-web。鉴权失败不回退。
   const [creditsResult, settings] = await Promise.all([
    get(`${GROK_API_BASE}/billing?format=credits`, grokHeaders).then(body => ({ ok: true, body })).catch(error => ({ ok: false, error })),
    get(`${GROK_API_BASE}/settings`, grokHeaders).catch(() => undefined)
   ]);
   let billing;
   let fromGrpc = false;
   if (creditsResult.ok) {
     billing = creditsResult.body;
     const data = normalizeSuperGrok(billing, settings);
     if (data.windows.length) return data;
     // REST 的缺省百分比本身仍是未知；补查 consumer protobuf，确认活跃周期的隐式零。
     // 可选补查限时 6s；失败/周期不匹配保留 REST 的余额、套餐与重置信息。
     try {
      const verified = await fetchGrokCreditsGrpc(this.fetcher, grokHeaders, signal, () => this.now(), 6000);
      const original = billing.config.currentPeriod, current = verified.config.currentPeriod;
      if (numeric(verified.config.creditUsagePercent) && original?.type === current?.type
       && typeof original?.start === "string" && typeof current?.start === "string"
       && Date.parse(original.start) === Date.parse(current.start)
       && Date.parse(original.end) === Date.parse(current.end)) {
       return normalizeSuperGrok({ ...billing, config: { ...billing.config, creditUsagePercent: verified.config.creditUsagePercent } }, settings);
      }
     } catch { return data; } // 可选核验失败不抹掉已读取的 REST 部分数据。
     return data;
    }
   else if (grokCreditsFallbackable(creditsResult.error)) {
    try { billing = await fetchGrokCreditsGrpc(this.fetcher, grokHeaders, signal, () => this.now()); fromGrpc = true; }
    catch { throw creditsResult.error; }
   } else throw creditsResult.error;
   try { return normalizeSuperGrok(billing, settings); }
   catch (error) { if (fromGrpc) throw creditsResult.error; throw error; }
  }
  if (id === "openai-codex") {
   // ChatGPT 后端私有接口：Bearer 是 Codex CLI 的 OAuth access token，不是 OPENAI_API_KEY。
   return normalizeCodexUsage(await get(`${CODEX_API_BASE}/wham/usage`, { ...headers, ...(identity.accountId ? { "ChatGPT-Account-Id": identity.accountId } : {}) }));
  }
  if (id === "github-copilot") {
   // 私有接口：认长期 GitHub OAuth token，scheme 是 `token` 而不是 Bearer。
   return normalizeCopilotUsage(await get(`https://${identity.apiHost ?? "api.github.com"}/copilot_internal/user`, { ...COPILOT_HEADERS, authorization: `token ${identity.key}`, "x-github-api-version": "2025-04-01" }));
  }
  const base = "https://platform.xiaomimimo.com/api/v1";
  const h = { cookie: identity.key, origin: "https://platform.xiaomimimo.com", referer: "https://platform.xiaomimimo.com/#/console/balance", "x-timezone": "UTC+08:00" };
  let usageError;
  const [bal, detail, usage] = await Promise.all([get(`${base}/balance`, h).catch(e => { if (e.code === "subusage/auth") throw e; return undefined; }), get(`${base}/tokenPlan/detail`, h).catch(e => { if (e.code === "subusage/auth") throw e; return undefined; }), get(`${base}/tokenPlan/usage`, h).catch(e => { if (e.code === "subusage/auth") throw e; usageError = e; return undefined; })]);
  // 普通刷新与登录验证都经过这里：服务端字段不可信，缓存前去除 Cookie 回显。
   const data = redactSecret(normalizeMimo(bal, detail, usage), identity.key);
  if (usageError) data.usageError = usageError;
  return data;
 }
 /**
  * Command Code 的多账户清单与当前激活项，读自提供方插件的 settings namespace（llm-commandcode）。
  * id/label 规则与 Client 的 commandCodeAccountList 完全一致：默认账户固定 id "default"（label 用人读
  * 文案），额外账户 id 取其凭据引用名（apiKeyEnv）、label 空白回退 `Account N`；无凭据引用与登记未完成
  * （phase 非 naming）的账户不列。
  * 与提供方插件 slots() 的**唯一差异**：它额外支持 `accounts[].apiKey` 字面 Key 账户（id `account-N`），
  * 本插件**不支持**——那种 Key 只存在提供方自己的配置里，按引用名解析不到（identity() 也没有字面 Key
  * 分支），列出来只会选中即 no-key。Client 侧同样跳过，两端口径因此保持一致。
  * activeAccount 为空、为 "auto" 或指向已消失的账户时都按**自动轮换**处理（与其 preferredId 同义）。
  * 读不到（settings 服务未挂载 / namespace 不存在）返回 null，调用方退回单账户模式。
  */
 commandCodeAccountPlan() {
  try {
   // redactSecrets：本插件只读这几个非秘密字段，但提供方配置里可能存在手写的字面 apiKey
   // （role "secret"）；带上它就只剥离秘密字段（apiKeyEnv 是 credential-ref，不受影响），
   // 字面 Key 不会进到本插件的内存里。
   const rows = this.settingsService?.describe?.({ redactSecrets: true });
   const row = Array.isArray(rows) ? rows.find(item => item?.ns === COMMAND_CODE_SETTINGS_NS) : undefined;
   if (!row) return null;
   const value = row.value && typeof row.value === "object" ? row.value : {};
   const tasks = Array.isArray(value.accountEnrollmentTasks) ? value.accountEnrollmentTasks : [];
   const accounts = [{ id: "default", label: "默认账户" }];
   const seen = new Set(["default"]);
   for (const [index, account] of (Array.isArray(value.accounts) ? value.accounts : []).entries()) {
    const ref = typeof account?.apiKeyEnv === "string" && account.apiKeyEnv.trim() !== "" ? account.apiKeyEnv.trim() : void 0;
    if (ref === void 0) continue;
    // 同一个引用名出现两次（配置被手改过）时只列一次：否则同账户会出两行、还会多打一份计费请求。
    if (seen.has(ref)) continue;
    if (tasks.some(task => task?.ref === ref && task.phase !== "naming")) continue;
    seen.add(ref);
    accounts.push({ id: ref, label: typeof account.label === "string" && account.label.trim() !== "" ? account.label.trim() : `Account ${index + 2}` });
   }
   const raw = typeof value.activeAccount === "string" ? value.activeAccount.trim() : "";
   const activeId = raw !== "" && accounts.some(account => account.id === raw) ? raw : "";
   return { mode: activeId === "" ? "auto" : "fixed", activeId, accounts: accounts.map(account => ({ ...account, active: account.id === activeId })) };
  } catch { return null; }
 }
 /**
  * 自动轮换模式下的**轮换池健康摘要**：UI 通道（read/refresh）默认只回顶层 Key 单账户，
  * 用户看到的是乐观数字，但实际请求会落到池中任意账户——默认账户健康不代表池健康
  * （其余账户可能已全部 5h 限额）。这里复用各账户自己的缓存并行读一遍，把摘要挂到默认
  * 账户 entry 上，Client 仅在 auto 模式渲染。固定模式（activeId 非空）返回 null。
  *
  * 业务口径（不能简单取「池中最紧张账户」）：各账户是**独立配额**，轮换器会避开已限额的
  * 账户，所以单账户限额不是立即失败信号。只有「所有有凭据的账户都限额」才是池耗尽：
  *   healthy  = ok 且没有 rate-limited 窗口
  *   blocked  = ok 但至少一个窗口 rate-limited（容量降级，仍可能成功）
  *   unusable = no-key/no-cookie/disabled/error（读不到或没凭据，不计入有效容量）
  * 池里没有任何有凭据的账户时 exhausted=false（那是「未配置」，由默认 entry 的 no-key 表达）。
  */
 async commandCodePool(settings, force, defaultEntry) {
  const plan = this.commandCodeAccountPlan();
  if (!plan || plan.mode !== "auto") return null;
  // 默认账户那条 entry 已由调用方读过（避免重复一发），其余账户各自命中 provider() 的 TTL/
  // inflight 缓存，因此每分钟的自动刷新不会真的打 N 次计费接口。
  const readOne = async (account) => {
   if (account.id === "default") return defaultEntry;
   try { return await this.provider("commandcode", settings, force, account.id); }
   catch { return { ...this.base("commandcode", "none", settings, account.id), state: "error", errorCode: "subusage/internal", error: "读取用量失败", windows: [], extras: [] }; }
  };
  const entries = await Promise.all(plan.accounts.map(account => readOne(account)));
  const accounts = plan.accounts.map((account, index) => {
   const entry = entries[index];
   const windows = Array.isArray(entry?.windows) ? entry.windows : [];
   const ok = entry?.state === "ok";
   const paid = entry?.availability === "paygo";
   const limited = entry?.availability === "blocked" || windows.some(w => w.status === "rate-limited");
   const known = paid || entry?.coverage !== "partial" && windows.length > 0;
   return {
    id: account.id, label: account.label, active: account.active === true,
    state: entry?.state ?? "error", errorCode: entry?.errorCode, windows,
    // usable：读到了且没有任何限额窗口；blocked：读到了但有窗口限额（容量降级，仍可能成功）。
    usable: ok && (paid || known && !limited),
     ...(ok && !known && !limited ? { availability: "unknown" } : entry?.availability ? { availability: entry.availability } : {}),
    blocked: ok && !paid && limited
   };
  });
  // 「有效容量」= usable + blocked（真的有凭据且读到了额度的账户）；no-key/error/disabled 不算。
  const capable = accounts.filter(a => a.usable || a.blocked);
  const available = accounts.filter(a => a.usable).length;
  const blockedCount = accounts.filter(a => a.blocked).length;
  const unusableCount = accounts.length - available - blockedCount;
  const exhausted = capable.length > 0 && capable.every(a => a.blocked) && !accounts.some(a => a.state === "error" || a.availability === "unknown");
  return { mode: "auto", total: accounts.length, available, blockedCount, unusableCount, exhausted, accounts };
 }
 /** 按 id 失效一家 provider 的**全部账户**缓存：凭据/开关变化不能只影响默认账户那一条。 */
 invalidateProvider(id) {
  const keys = new Set([id]);
  for (const map of [this.cache, this.inflight, this.fingerprints, this.generations]) for (const key of map.keys()) if (key.startsWith(`${id}@`)) keys.add(key);
  for (const key of keys) { this.generations.set(key, (this.generations.get(key) ?? 0) + 1); this.cache.delete(key); this.inflight.delete(key); }
 }
 base(id, source, settings, account = "") {
  // MiMo 会话 Cookie 自签发起 24 小时有效；到期时间随每条 entry 下发，供药丸与设置页倒计时。
  // commandcode 记录本条用量所属账户（default 或额外账户引用名），供弹层标注与测试核对。
  const shown = id === "commandcode" ? { account: account !== "" ? account : "default" } : {};
  return { providerId: id, label: PROVIDERS[id].label, envName: PROVIDERS[id].envName, keySource: source, apiDetected: source === "none" ? null : true, coverage: "partial", freshness: "unknown", lastSuccessAt: null, lastAttemptAt: new Date(this.now()).toISOString(), retryable: false, retainPrevious: false, ...shown, ...(id === "xiaomi-token-plan-cn" ? this.mimoCookieStatus(settings) : {}) };
 }
 async provider(id, settings, force, account = "") {
  // MiMo 扫码登录留有续期材料时，控制台 Cookie 临近到期就在取数前静默续期（用户无感）；
  // 续期失败才把失败原因带到条目里，由界面提示重新扫码。
  let renewFailure;
  if (id === "xiaomi-token-plan-cn" && !account && providerEnabled(settings, id)) { const renewed = await this.mimoRenewIfDue(settings); settings = renewed.settings; renewFailure = renewed.failure; }
  // 缓存/inflight/fingerprint 都按**账户**分键：Command Code 的多账户各占一份，
  // 读取全部账户时不会互相驱逐缓存（见 providerCacheKey）。
  const cacheKey = providerCacheKey(id, account);
  const startedGeneration = this.generations.get(cacheKey) ?? 0;
  let identity;
  // identity 解析依赖凭据服务/登录文件读取，可能像 HTTP 一样永久挂起：套上与 fetchJson 同量级
  // 的超时。超时不等于凭据失效——不清 Cookie、不用 subusage/credentials（client 的
  // /auth|credential/ 判定会把它导去重新登录/凭据编辑入口），而是独立 errorCode 的可读条目。
  // 只让这一家及时返回，不拖死整批 Promise.all；挂起的原始 promise 由 race 持有，之后
  // settle 也被静默丢弃（含其 reject，handler 已注册，不会变成 unhandledRejection）。
  try { identity = await withTimeout(this.identity(id, settings, account), this.identityTimeoutMs, () => failure("subusage/identity-timeout", `凭据解析超时（${Math.round(this.identityTimeoutMs / 1000)} 秒无响应）：凭据服务或登录文件读取未返回，请稍后重试`)); }
  catch (e) {
   const timedOut = e?.code === "subusage/identity-timeout";
   this.cache.delete(cacheKey);
   return { ...this.base(id, "none", settings, account), state: "error", errorCode: timedOut ? "subusage/identity-timeout" : "subusage/credentials", error: timedOut ? e.message : "无法解析凭据" };
  }
  if (this.disposed) throw failure("subusage/disposed", "服务已卸载");
  if (startedGeneration !== (this.generations.get(cacheKey) ?? 0)) return this.provider(id, this.load(), force, account);
  if (!providerEnabled(settings, id)) {
   this.cache.delete(cacheKey); this.inflight.delete(cacheKey);
   return { ...this.base(id, identity.source, settings, account), ...(identity.ref ? { keyRef: identity.ref } : {}), state: "disabled", apiDetected: !!identity.key || identity.source === "account-service", windows: [], extras: [] };
  }
  // fingerprint 计入账户选择：切换账户后同 id 缓存/inflight 不串账（不同账户 key 必不同）；
  // 空串与 "default" 同为默认账户，归一后共享缓存。
  const fingerprint = hash([identity.key ?? "", identity.secret ?? "", identity.source, settings.keyModes[id], id === "zai-coding-cn" ? settings.zai : null, id === "commandcode" ? (account && account !== "default" ? account : "default") : id === "openai-codex" ? identity.accountId ?? null : id === "github-copilot" ? identity.apiHost ?? null : null]);
  if (this.fingerprints.has(cacheKey) && this.fingerprints.get(cacheKey) !== fingerprint) this.generations.set(cacheKey, (this.generations.get(cacheKey) ?? 0) + 1);
  this.fingerprints.set(cacheKey, fingerprint);
  const generation = this.generations.get(cacheKey) ?? 0;
  const cached = this.cache.get(cacheKey);
  if (cached && cached.fingerprint !== fingerprint) this.cache.delete(cacheKey);
  // 账号服务不提供会话指纹，也不读取其 token：每次查询复用其实时余额链，不跨账号复用本插件缓存。
   const previous = identity.source !== "account-service" && cached?.fingerprint === fingerprint ? cached : undefined;
  const active = this.inflight.get(cacheKey);
  if (active?.fingerprint === fingerprint && active.generation === generation) return active.promise;
  const now = this.now();
  const resetDue = previous?.entry.windows?.some(w => Number.isFinite(Date.parse(w.resetsAt)) && Date.parse(w.resetsAt) > previous.at && Date.parse(w.resetsAt) <= now);
  if (previous && (now < previous.retryAt || !resetDue && !force && now - previous.at < TTL)) {
   if (id !== "xiaomi-token-plan-cn") return previous.entry;
   // 额度可以复用，登录状态必须按当前两类凭据判断，不能沿用缓存里的倒计时 / 续期标记。
   const { cookieExpiresAt, cookieRenewable, ...usage } = previous.entry;
   return { ...usage, ...this.mimoCookieStatus(settings) };
  }
  const promise = (async () => {
   let base = { ...this.base(id, identity.source, settings, account), ...(identity.ref ? { keyRef: identity.ref } : {}) }; let entry; let retryAt = 0; let failures = previous?.failures ?? 0;
   if (!identity.key && identity.source !== "account-service") entry = { ...base, apiDetected: false, state: id === "xiaomi-token-plan-cn" ? "no-cookie" : "no-key", error: id === "xiaomi-token-plan-cn" ? "需登录或粘贴 Cookie" : id === "commandcode" ? (account && account !== "default" ? `未检测到账户 ${account} 的 Key：确认提供方插件已保存该账户的凭据（凭据服务或启动环境中无引用 ${account}）` : "未检测到 Key：可在 设置 → Command Code 登录、运行 cmd login，或使用 COMMANDCODE_API_KEY（凭据服务/启动环境）") : account && account !== "default" ? `未检测到引用 ${account} 的 Key：确认凭据库或环境变量里有这个引用，或在设置里删掉该监控项` : id === "deepseek-account" ? "未检测到本机 DeepSeek 账号登录：请在 DSH 设置 → 账号与余额登录；此入口不使用 API Key" : id === "xai-oauth" ? "未检测到 Grok 登录：可在 设置 → Grok Kit（xAI OAuth）登录、运行 grok login（共享登录文件 ~/.grok/auth.json）" : id === "openai-codex" ? "未检测到 Codex 订阅登录：在 Codex Subscription 设置页独立登录，或运行 codex login 完成 ChatGPT 登录（登录文件需为 $CODEX_HOME/auth.json 或 ~/.codex/auth.json，且 auth_mode 为 chatgpt；API Key 模式取不到订阅额度）" : id === "github-copilot" ? "未检测到 GitHub Copilot 登录：在 设置 → GitHub Copilot（dsh-copilot-auth）完成设备码登录；额度读取复用该登录的 OAuth 记录，本插件不保存凭据" : PROVIDERS[id].credentialKind === "volc" ? "未配置火山方舟 AK/SK：额度查询要 IAM Access Key（VOLC_ACCESSKEY / VOLC_SECRETKEY，或在本页填写），不是推理用的方舟 API Key" : "未配置 API Key", errorCode: "subusage/no-key" };
   // 续期失败且控制台 Cookie 已经过期：不再拿过期 Cookie 去请求上游，直接给出续期失败的原因。
   else if (renewFailure && settings.xiaomi.expiresAt > 0 && settings.xiaomi.expiresAt <= this.now()) {
    const network = renewFailure.code !== "auth"; // 网络 / 接口形状异常都会自动重试，只有 passToken 被拒才要求重新扫码
    entry = { ...base, state: "error", errorCode: network ? "subusage/mimo-renew-network" : "subusage/mimo-renew-failed", error: renewFailure.message, retryable: network, retainPrevious: false, ...(network ? {} : { renewFailed: true }) };
    if (network) retryAt = Math.max(renewFailure.until ?? 0, this.now() + 2000);
   }
   else try {
    let data;
    try { data = await this.fetchProvider(id, identity, settings); }
    catch (rejected) {
     // 上游拒绝 Cookie（早于 24 小时被撤销、或本地计时不准）：有续期材料就换一张新的再读一次，只重试这一次。
     if (id !== "xiaomi-token-plan-cn" || account || rejected?.code !== "subusage/auth") throw rejected;
     const renewed = await this.mimoRenewIfDue(settings, "rejected");
     if (!renewed.renewed) throw renewed.failure ? failure(renewed.failure.code !== "auth" ? "subusage/mimo-renew-network" : "subusage/mimo-renew-failed", renewed.failure.message, renewed.failure.code !== "auth") : rejected;
     base = { ...this.base(id, "cookie", renewed.settings, account) };
     data = await this.fetchProvider(id, { key: renewed.settings.xiaomi.cookie.trim(), source: "cookie" }, renewed.settings);
    }
    const usageError = data.usageError; delete data.usageError;
    if (usageError?.details?.retryable && previous?.entry.lastSuccessAt) throw usageError;
    entry = { ...base, ...data, state: "ok", coverage: data.coverage ?? "complete", freshness: "fresh", lastSuccessAt: new Date(this.now()).toISOString() }; failures = 0;
    if (usageError) { entry.errorCode = usageError.code; entry.error = usageError.message; entry.retryable = usageError.details?.retryable === true; if (entry.retryable) retryAt = this.now() + Math.max(2000, usageError.details?.retryAfterMs ?? 0); }
   } catch (e) {
    const temporary = e instanceof RemoteError && e.details?.retryable === true;
    const retain = temporary && !!previous?.entry.lastSuccessAt;
    entry = { ...base, state: "error", error: e instanceof RemoteError ? e.message : "用量响应无效", errorCode: e instanceof RemoteError ? e.code : "subusage/response", retryable: temporary, retainPrevious: retain, ...(e?.code === "subusage/mimo-renew-failed" ? { renewFailed: true } : {}) };
    if (retain) Object.assign(entry, { windows: previous.entry.windows, extras: previous.entry.extras, coverage: previous.entry.coverage, freshness: "stale", lastSuccessAt: previous.entry.lastSuccessAt });
    failures++;
    if (temporary) retryAt = this.now() + Math.max(e.details?.retryAfterMs ?? 0, Math.min(300000, 1000 * 2 ** Math.min(failures, 8)));
   }
   if (!this.disposed && generation === (this.generations.get(cacheKey) ?? 0)) this.cache.set(cacheKey, { fingerprint, entry, at: this.now(), retryAt, failures });
   if (this.disposed || generation !== (this.generations.get(cacheKey) ?? 0)) return { ...this.base(id, "none", settings, account), state: "error", errorCode: "subusage/config-changed", error: "读取期间配置已改变，请刷新" };
   return entry;
  })();
  this.inflight.set(cacheKey, { fingerprint, generation, promise });
  try { return await promise; } finally { if (this.inflight.get(cacheKey)?.promise === promise) this.inflight.delete(cacheKey); }
 }
 /**
  * 多 Key 监控：为配置了额外引用名的 provider 各读一遍，挂到主条目的 `keyAccounts`。
  * 主条目始终是解析链按「路由实际 apiKeyEnv → 额外引用名 → 内置名」选出的那一把 Key
  * （药丸/用量面板只认它）；额外 Key 只用于查看额度，不参与药丸选择。
  */
 async withKeyAccounts(settings, force, entries) {
  const targets = entries.filter(entry => entry && Array.isArray(settings.keyRefs?.[entry.providerId]) && settings.keyRefs[entry.providerId].length);
  if (!targets.length) return entries;
  const pairs = await Promise.all(targets.map(async entry => {
   const id = entry.providerId;
   const accounts = await Promise.all(settings.keyRefs[id].map(ref => this.provider(id, settings, force, ref).catch(() => ({ ...this.base(id, "none", settings, ref), keyRef: ref, state: "error", errorCode: "subusage/internal", error: "读取用量失败", windows: [], extras: [] }))));
   return [id, accounts];
  }));
  const byId = new Map(pairs);
  return entries.map(entry => {
   const accounts = entry && byId.get(entry.providerId);
   if (!accounts) return entry;
   // 与主条命中同一引用名的监控项不重复展示：主条自己就是它的额度。
   const list = accounts.filter(account => !(entry.keyRef && account.keyRef === entry.keyRef));
   if (!list.length) return entry;
   return {
    ...entry,
    keyAccounts: list.map(account => ({
     ref: account.keyRef ?? "",
     state: account.state,
     keySource: account.keySource,
     ...(account.coverage ? { coverage: account.coverage } : {}),
     ...(account.freshness ? { freshness: account.freshness } : {}),
     windows: Array.isArray(account.windows) ? account.windows : [],
     extras: Array.isArray(account.extras) ? account.extras : [],
     active: false,
     ...(account.error ? { error: account.error } : {})
    }))
   };
  });
 }
 /**
  * 兄弟插件联动项取数。三种结果：
  * - `null`：提供方插件没装 / 没加载 / 版本旧 / 该区域未登录，顺带读的全量查询里就不该出现这一行；
  * - 条目：按 `normalizeAntigravity` / `normalizeTrae` 折算好的额度；
  * - error 条目：被点名却没检测到取数通道、超时或抛异常——如实说「这次没读到」并给出下一步，
  *   而不是让整份报告一起失败，也不是回一个空列表。
  */
  async linkedProvider(id, force, explicit = false, quiet = false, allowSourceFallback = false, source) {
  const meta = LINKED_PROVIDERS[id];
  if (!meta) return null;
  // Antigravity 的独立开关同时约束 quota() 与药丸的 readLinked()，关闭时不调用兄弟插件。
  if (id === ANTIGRAVITY_ID && this.load().visibility.antigravity === false) return null;
  const failed = error => {
   const message = typeof error === "string" && error.trim() ? error : error instanceof Error && error.message ? error.message : `${meta.label} 额度读取失败`;
   return { providerId: id, label: meta.label, state: "error", windows: [], extras: [], coverage: "partial", freshness: "unknown", error: message };
  };
  let channeled;
  try {
    channeled = await withTimeout(Promise.resolve(this.linkedSnapshot(id, force, allowSourceFallback, source)), this.linkedTimeoutMs, () => failure("subusage/timeout", `${meta.label} 额度读取超过 ${Math.round(this.linkedTimeoutMs / 1000)} 秒仍未返回（提供方插件首次取数可能更慢），稍后重试`));
  } catch (error) {
   // 页面代取的「还缺一条响应」不是失败：它要一路抛到 linkedStep 去换 URL。
   if (error instanceof MissingLinkedRequest) throw error;
   if (id === ANTIGRAVITY_ID && this.load().visibility.antigravity === false) return null;
   // 默认的全量查询遇到超时不出条目：对方冷启动可能要 45s，一次超时不该在本插件默认报告里
   // 顶出一条 error（对方的缓存随后会被后台填上，下次查询即可命中）。**点名的查询仍如实报**，
   // 否则用户问「Trae 还剩多少」会得到一个看起来像「没登录」的空结果。
   if (quiet && error?.code === "subusage/timeout") return null;
   return failed(error);
  }
   // 关闭后的成功、缺席和失败响应都不能重新带出条目。
   if (id === ANTIGRAVITY_ID && this.load().visibility.antigravity === false) return null;
   if (!channeled) {
   if (!explicit) return null;
     if (meta.via === "ofm") return failed("未检测到 OFM 的只读额度接口：请启用 Our Free Model，并确认宿主支持 Connection 进程内 Fetch 分发。");
    return failed(id === ANTIGRAVITY_ID
    ? "Antigravity 额度来自 Antigravity 提供方插件，但本机没有检测到可用通道：请安装并登录 dsh-tool-antigravity（antigravityAuth 服务）或 dsh-antigravity-acp（agyQuota 服务），重启 DSH 后这条会自动出现。"
     : meta.via === "workbuddy-route" ? "WorkBuddy 额度来自 dsh-connect-workbuddy 的账号查询接口，但未检测到可用入口；请在提供方启用对应区域并完成登录。"
     : meta.via === "desktop-route" ? `${meta.label} 未检测到可用额度入口；请启用 dsh-${meta.channel}-connect${allowSourceFallback ? " 或 Our Free Model" : ""} 并完成登录。`
     : `Trae 额度来自 dsh-connect-trae 插件的只读路由 ${TRAE_PLUGIN_USAGE_ROUTE}，但本机没有这条路由：插件未安装、未启用，或版本较旧。装好并重启 DSH 后这条会自动出现。`);
  }
  const { channel, snapshot } = channeled;
  try {
    if (channel === "desktop-route") return snapshot || (explicit ? failed("独立插件尚未登录，请在提供方完成登录") : null);
    if (channel === "ofm-auto") {
     const entry = normalizeOfm(snapshot, `ofm-${meta.channel}`, this.now());
     if (entry) return { ...entry, providerId: id, ofmAccounts: entry.ofmAccounts?.map(account => ({ ...account, providerId: id })), [QUOTA_SOURCE]: `ofm:${meta.channel}` };
     return explicit ? failed("Our Free Model 此渠道没有可读账号；请在提供方登录并启用账号。") : null;
    }
    const entry = channel === "ofm" ? normalizeOfm(snapshot, id, this.now())
     : channel === "agyQuota" ? normalizeAntigravity(snapshot)
     : channel === "antigravityAuth" ? normalizeAntigravityAuthView(snapshot)
     : channel === "workbuddy-route" ? normalizeWorkBuddy(snapshot, id, this.now())
     : channel === "eac" || channel === "local" ? normalizeEac(snapshot, id, channel === "local" ? LOCAL_CHANNELS[meta.channel ?? id] ?? meta.label : meta.label, this.now())
     : normalizeTrae(snapshot, id, this.now());
    if (entry) return { ...entry, ...(channel === "local" ? { [QUOTA_SOURCE]: `local:${meta.channel ?? id}` } : channel === "ofm" ? { [QUOTA_SOURCE]: `ofm:${meta.channel}` } : channel === "eac" ? { [QUOTA_SOURCE]: `eac:${meta.eac}` } : {}) };
   // 认得出通道、但该区域未登录 / 没有企业账号：顺带查询里不出条目，点名时要说清为什么没有数字。
   if (!explicit) return null;
     if (channel === "eac") return failed(`${meta.label} 的独立插件与 Our Free Model 都没有可读账号，EAC 三渠道里也没有已登录的 ${EAC_CHANNELS[meta.eac] ?? meta.eac} 账号；请在 dsh-eac-router 设置页登录后再查。`);
    if (meta.via === "ofm") return failed("OFM 此渠道没有启用的账号；请在提供方登录并启用账号。");
    if (meta.via === "workbuddy-route") return failed("这个区域还没有登录 WorkBuddy：请在 dsh-connect-workbuddy 设置页登录对应区域。");
   if (id === ANTIGRAVITY_ID) return failed("Antigravity 还没有登录：在 dsh-tool-antigravity 的设置卡片里完成 Google 授权（或运行 /antigravity-auth login）后即可读到额度。");
   return failed(meta.panel === "enterprise"
    ? "本机没有 Trae 企业版账号：企业租户额度只能由企业账号读取（在 设置 → Trae 卡片的企业版 tab 绑定）。"
    : "这个区域还没有登录 Trae：在 设置 → Trae 卡片登录对应区域（或在 Trae 客户端登录）后即可读到额度。");
  } catch (error) { if (error instanceof MissingLinkedRequest) throw error; return failed(error); }
 }
 /**
  * 联动项的原始快照：按通道分发，返回 `{ channel, snapshot }`；所有通道都缺席时返回 null。
  * Antigravity 有两个互不相干的提供方插件（agyQuota 信息更全，优先；antigravityAuth 回退），
  * 它们读的是同一份 Google Antigravity 配额，只取第一个在场通道，绝不并列两条。
  */
  /** 解一个 Trae 凭据文件里的全部账号；解密失败（客户端换了格式）返回 undefined，让直取安静回退。 */
  localTraeCredentials(file) {
   const cached = this.traeCredentials.get(file), time = this.now();
   if (cached && time >= cached.at && time - cached.at < 60000) return cached.value;
   const value = readTraeCredentials(file, { readFile: (path, encoding) => this.io.readFileSync(path, encoding) });
   if (value?.length) this.traeCredentials.set(file, { at: time, value });
   else this.traeCredentials.delete(file);
   return value;
  }
  /**
   * 直取用到的账号索引：`$DSH_HOME/channel-pack/state.json` 的 `accounts[].credentialRef`。
   * 只读文件名与 ref，不读凭据本身（凭据由凭据服务按 ref 解析）。
   * 索引缺失或损坏时返回空数组，让直取安静地让位给其它来源。
   */
  localAccountRefs(channel) {
   // Trae 的登录态在它自己客户端的 storage.json 里，不在 channel-pack 账号索引中。
   // 这里只探测文件存在性；解密与字段解析在 resolve 里做。
   if (channel === "trae") {
    for (const file of this.traeStoragePaths) {
     const rows = this.localTraeCredentials(file);
     // 国际版池没有 CN 账号时不能就此收手：CN 登录可能只在客户端 storage.json 里，继续看下一个来源。
     if (!rows?.some(row => String(row.region ?? "CN").toUpperCase() === "CN")) continue;
     return rows.map((row, index) => ({
      ref: `trae-auth:${file}#${index}`,
      accountId: row.userId ? `trae-${row.userId}` : `trae-${index}`,
      nickname: row.nickname ?? "",
     }));
    }
    return [];
   }
   try {
    const doc = JSON.parse(this.io.readFileSync(this.localAccountsFile, "utf8"));
    const rows = Array.isArray(doc?.accounts) ? doc.accounts : [];
    return rows
     // 不过滤 `enabled`：它只表示 EAC 不自动选号，凭据本身仍然可读（本机 ZCode 就是 enabled:false）。
     .filter(row => row && row.provider === channel && typeof row.credentialRef === "string" && row.credentialRef)
     .map(row => ({ ref: row.credentialRef, accountId: typeof row.id === "string" ? row.id : "", nickname: typeof row.nickname === "string" ? row.nickname : "" }));
   } catch { return []; }
  }
  async linkedSnapshot(id, force, allowSourceFallback = false, source) {
  const meta = LINKED_PROVIDERS[id];
  if (!meta) return null;
   // 直取优先：本机凭据库里有这个渠道的账号时，先自己调上游，完全不经兄弟插件的 HTTP 路由。
   // 判定用 `meta.channel`（OFM 渠道的 provider 名就是它），这样 `raccoon` 与 `ofm-raccoon`
   // 两条联动项共用同一份直取结果。直取失败继续走下面原有的来源链，用户看不到切换痕迹。
   const localChannel = Object.hasOwn(LOCAL_CHANNELS, id) ? id : Object.hasOwn(LOCAL_CHANNELS, meta.channel) ? meta.channel : undefined;
   if (localChannel) {
    // 页面代取的后续轮次（source.continuation）里，首轮刚确认过「直取读不到」：短时间内不再对上游重试，
    // 否则一次刷新会在每一轮都重复请求同一个失败的上游。首轮与普通读取不受影响，重新登录后下一轮立即恢复。
    const missedAt = source?.continuation ? this.localMisses.get(localChannel) : undefined;
    const skip = missedAt !== undefined && this.now() >= missedAt && this.now() - missedAt < 15000;
    const local = skip ? undefined : await this.localRead(localChannel, force && !source?.continuation).catch(() => undefined);
    if (local) { this.localMisses.delete(localChannel); return { channel: "local", snapshot: local }; }
    if (source && !skip) this.localMisses.set(localChannel, this.now());
   }
   // 页面代取：原始响应由渲染进程带浏览器凭据取回，这里只把它当数据源，
   // 后续的归一化、缺席指引与 OFM/EAC 回落与「宿主直取」走**同一条**路径——
   // 否则只要缺一次数据，药丸就会静默消失，而 `linkedProvider` 里那些「该去哪儿登录」的话全都用不上。
   if (source && CLIENT_FETCH_VIA.has(meta.via)) {
    if (meta.via === "desktop-route") {
     const raw = await source(meta.channel, "status", {});
     // 404 = 插件没装（真缺席）：这时才轮到 OFM / EAC 回落，与宿主直取同一套顺序。
     if (raw === undefined) {
      if (allowSourceFallback) {
       const fallback = await this.ofmRead(meta.channel, force);
       if (fallback) return { channel: "ofm-auto", snapshot: fallback };
       if (meta.eac) {
        const eac = await this.eacRead(meta.eac, force);
        if (eac) return { channel: "eac", snapshot: eac };
       }
      }
      return null;
     }
     // 插件在场但未登录：**不换数据来源**（README 承诺的回落只针对「接口缺席」），
     // 归一化返回 null 交给 linkedProvider 报「独立插件尚未登录」。
     return { channel: "desktop-route", snapshot: normalizeDesktopUsage(raw, meta.channel, this.now()) };
    }
    const plugin = meta.via === "trae-route" ? "trae" : "workbuddy";
    const snapshot = await this.connect.readAccounts(plugin, meta.panel, source);
    return snapshot ? { channel: meta.via, snapshot } : null;
   }
   if (meta.via === "desktop-route") {
    const snapshot = await this.desktopUsage.read(meta.channel, force);
    if (snapshot !== undefined) return { channel: "desktop-route", snapshot };
    if (allowSourceFallback) {
     const fallback = await this.ofmRead(meta.channel, force);
     if (fallback) return { channel: "ofm-auto", snapshot: fallback };
     if (meta.eac) {
      const eac = await this.eacRead(meta.eac, force);
      if (eac) return { channel: "eac", snapshot: eac };
     }
    }
    return null;
   }
  if (meta.via === "ofm") {
   const snapshot = await this.ofmRead(meta.channel, force);
   if (snapshot) return { channel: "ofm", snapshot };
   if (meta.eac && allowSourceFallback) {
    const eac = await this.eacRead(meta.eac, force);
    if (eac) return { channel: "eac", snapshot: eac };
   }
   return null;
  }
   if (meta.via === "workbuddy-route") {
    const snapshot = await this.workBuddyRead(meta.panel, force);
    return snapshot ? { channel: "workbuddy-route", snapshot } : null;
   }
  for (const channel of meta.channels ?? [meta.via]) {
   if (channel === "agyQuota") {
    const snapshot = await this.antigravityQuota(force);
    if (snapshot) return { channel, snapshot };
   } else if (channel === "antigravityAuth") {
    const snapshot = await this.antigravityAuthQuota(force);
    if (snapshot) return { channel, snapshot };
   }
  }
  if (meta.via === "trae-route") {
   // undefined 表示对方只读路由根本不存在（插件没装 / web 服务器没绑端口），与「读取失败」区分：
   // 不能包成 { channel, snapshot: undefined }，否则会被当成在场通道进入归一化并顶出错误行。
   const snapshot = await this.traeUsage(meta.panel, force);
   return snapshot ? { channel: "trae-route", snapshot } : null;
  }
  return null;
 }
 /**
  * Trae 面板的用量快照（`TraeWebUsage`），带 60 秒缓存。
  * 对方路由每次都会真去上游取数，所以连问两次不该打两次；`force` 绕过缓存。
  * 返回 `undefined` 表示**通道不存在**（插件没装 / 本机 web 服务器还没绑端口），与「读取失败」区分开。
  */
 async traeUsage(panel, force) {
   return this.traeRead(panel, force);
 }
 /**
  * 生产取数路径：问**本机** web 服务器要 dsh-connect-trae 那条只读路由。
  * 路由自身只校验 loopback（`origin` 缺省或指向本机都放行），所以这里显式带上自己的回环 origin，
  * 既过它的校验，也不依赖「没有 Origin 头」这种默认行为。
  * 404 = 插件没装（通道不存在，返回 undefined）；其它非 2xx 才算一次真实失败。
  */
  async fetchTraeUsage(panel) { return this.fetchConnectUsage("trae", "usage", { region: panel }); }
  async fetchConnectUsage(plugin, endpoint, query) {
   const desktop = ["raccoon", "loomy"].includes(plugin);
   if (!(desktop ? endpoint === "status" : ["trae", "workbuddy"].includes(plugin) && ["usage", "account-status", "account-credits"].includes(endpoint))) throw failure("subusage/response", "不支持的提供方额度接口");
  const origin = this.webServerOrigin();
  if (!origin) return undefined;
   const url = new URL(`/plugins/${desktop ? `dsh-${plugin}-connect` : `dsh-connect-${plugin}`}/${endpoint}`, origin);
   for (const [key, value] of Object.entries(query || {})) if (["region", "accountId", "detail"].includes(key) && typeof value === "string") url.searchParams.set(key, value);
  // 对方的校验只看 Origin 的 hostname 是不是本机。webServer 绑在局域网地址时，带上那个 Origin
  // 反而会被判成 403，所以**只在回环时显式带**；不带 Origin 也能过（对方视缺省为放行）。
  const headers = isLoopbackOrigin(origin) ? { accept: "application/json", origin } : { accept: "application/json" };
  // 与 fetchJson 同口径：请求本身必须可取消。`linkedProvider` 的预算只是「不再等它」，
  // 没有这个 signal 的话，对方路由挂起时连接会一直挂着，`dispose()` 也收不回来。
  const response = await this.fetcher(url, { headers, signal: this.requestSignal() });
  if (response?.status === 404) return undefined;
   if (!response?.ok) throw failure("subusage/transport", `dsh-connect-${plugin} 的用量接口返回 HTTP ${response?.status ?? "?"}`);
  const text = await response.text();
  let body;
   try { body = JSON.parse(text); } catch { throw failure("subusage/response", `dsh-connect-${plugin} 的用量接口没有返回 JSON`); }
   if (body && typeof body === "object" && typeof body.error === "string") throw failure("subusage/transport", `dsh-connect-${plugin} 的用量接口读取失败`);
  return body;
 }
  /**
   * 生产取数路径：问本机 web 服务器要 dsh-eac-router 的 `/api/eac-router`。
   * 该路由是 JSON-RPC 风格的 POST：`{ type:'client-request', rpcId, method:'eac-router', payload:{ method, payload } }`
   * → `{ type:'server-response', rpcId, result:{ ok, value | error } }`。
   * 404 = 插件没装（通道不存在，返回 undefined）；`eac-router/not-ready` 表示它已装但后端没起来，
   * 同样按「本期没有这条通道」处理，不顶一张红卡片；其余错误才算真实失败。
   */
  async fetchEacUsage(channel) {
   if (!Object.hasOwn(EAC_CHANNELS, channel)) throw failure("subusage/response", "不支持的 EAC 渠道");
   // **必须走 Connection 的进程内 Fetch**，不能用本机回环 HTTP：`/api/*` 是宿主的鉴权面，
   // 裸 fetch 没有会话凭据，会被网关直接回 401（三个渠道一起 401 就是这么来的）。
   // 与 ofm.js 同一套分发：自己建 peer（principal owner），再向 `/api` 共享 handler 请求。
   // 通道缺席（Connection 不支持）时返回 undefined，与「读取失败」区分。
   const connection = this.ctx?.get?.("connection", false);
   if (!connection || typeof connection.createPeer !== "function" || typeof connection.createSharedFetchHandler !== "function") return undefined;
   if (this.eacConnection !== connection) {
    const previous = this.eacPeer;
    this.eacConnection = connection;
    this.eacPeer = connection.createPeer({ principal: { kind: "owner" } });
    this.eacHandler = connection.createSharedFetchHandler("/api");
    if (previous) await previous.dispose();
   }
   const rpcId = randomUUID();
   const request = new Request("http://dsh.internal/api/eac-router", {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json" },
    body: JSON.stringify({ type: "client-request", rpcId, method: "eac-router", payload: { method: "credits.balances", payload: { provider: channel } } }),
    signal: this.requestSignal(),
   });
   let response;
   try { response = await this.eacHandler.fetch(request, this.eacPeer); }
   catch { throw failure("subusage/transport", "dsh-eac-router 的额度接口读取失败"); }
   if (response?.status === 404) return undefined;
   if (!response?.ok) throw failure("subusage/transport", `dsh-eac-router 的额度接口返回 HTTP ${response?.status ?? "?"}`);
   let text;
   try { text = await response.text(); } catch { throw failure("subusage/response", "dsh-eac-router 的额度接口读取失败"); }
   let body;
   try { body = JSON.parse(text); } catch { throw failure("subusage/response", "dsh-eac-router 的额度接口没有返回 JSON"); }
   if (body?.type !== "server-response" || body.rpcId !== rpcId) throw failure("subusage/response", "dsh-eac-router 的额度接口返回异常");
   const result = body.result;
   if (result?.ok !== true) {
    // 后端未就绪 = 这条通道这轮不存在（用户在设置页里换了后端模式、尚未加载等），不当作读取失败。
    if (result?.error?.code === "eac-router/not-ready") return undefined;
    throw failure("subusage/transport", typeof result?.error?.message === "string" ? result.error.message : "dsh-eac-router 的额度接口读取失败");
   }
   return result.value;
  }
 /** 联动请求的取消信号：随 `dispose()` abort，并在联动预算用尽时自断。 */
 requestSignal() {
  const timeout = AbortSignal.timeout(this.linkedTimeoutMs);
  if (typeof AbortSignal.any !== "function") return timeout;
  return AbortSignal.any([this.controller.signal, timeout]);
 }
 /** 本机 web 服务器的回环 origin（如 `http://127.0.0.1:3080`）；未绑定或服务缺席时返回 undefined。 */
 webServerOrigin() {
  const web = this.ctx?.get?.("webServer", false);
  if (!web || typeof web.getOrigin !== "function") return undefined;
  try {
   const origin = web.getOrigin();
   return typeof origin === "string" && origin ? origin : undefined;
  } catch { return undefined; }
 }
 // 对外只读额度视图：供其他插件（ctx.get("subUsage").quota(...)）与 subusage_quota 工具使用。
 // **刻意不返回 settings，也不返回 keySource / apiDetected**：第三方消费者只需要额度，
 // 不需要知道本机配了哪些凭据，更不该拿到任何与 Key 相关的字段。
 async quota(request = {}) {
  if (this.disposed) throw failure("subusage/disposed", "服务已卸载");
  const asked = Array.isArray(request?.providerIds) ? request.providerIds.filter(id => typeof id === "string" && id.trim()) : [];
  const { ids: matched, linked, unknown } = asked.length ? resolveProviderIds(asked) : { ids: [...IDS], linked: [], unknown: [] };
  // 一个名字都没认出来，说明调用方手里的是**另一套命名**（最常见的就是 DSH 的 llm 路由名）。
  // 与其只回一句「不认识」，不如把全量数据一并给出：数据先给出去，怎么判断交给调用方。
  // 混合输入（认出一部分 + 认不出一部分）则只补上认出的那些，不额外放大请求量。
  const wanted = matched.length || !unknown.length ? matched : [...IDS];
  // 联动项不点名时顺带读（兄弟插件在场才有条目），点名写法命中时只读它。
  // 「一个名字都没认出来」的全量兜底也要带上，否则兜底结果会少一家。
  const linkedWanted = (!asked.length || (!matched.length && unknown.length > 0) ? [...LINKED_IDS] : linked)
   .filter(id => id !== ANTIGRAVITY_ID || this.load().visibility.antigravity !== false);
  // 联动项「被点名」的判据：名字只指向这一条（`trae-global`、`antigravity`…）。厂商名 `trae`
  // 命中三块面板，属于「厂商名命中多条」的既有口径——那种情况下缺席静默（用户只接了国内版时，
  // 不该顶出两条「国际版/企业版没登录」的错误行）。
  const linkedAsked = explicitlyNamedLinked(asked);
  const settings = this.load();
  const force = request?.force === true;
  // Command Code 是多账户的：一次把**每个账户**都读一遍，并标出当前激活的是哪一个（或自动轮换）。
  // 账户清单来自提供方插件的 settings namespace（llm-commandcode）；读不到时退回单账户模式。
  const plan = wanted.includes("commandcode") ? this.commandCodeAccountPlan() : null;
  // 激活账户排最前：调用方第一眼要看的就是「现在实际在用的是哪一个」。
  const planAccounts = plan ? (plan.mode === "fixed" ? [...plan.accounts].sort((a, b) => Number(b.active) - Number(a.active)) : plan.accounts) : null;
  const read = (id, account = "") => this.provider(id, settings, force, account).catch(() => ({ ...this.base(id, "none", settings, account), state: "error", errorCode: "subusage/internal", error: "读取用量失败" }));
  const tasks = [];
  for (const id of wanted) {
   if (planAccounts && id === "commandcode") tasks.push(...planAccounts.map(account => read(id, account.id)));
   else tasks.push(read(id));
  }
  // 联动项与其它家并行取数：它自己折叠错误、自己带超时，绝不会让整份报告失败。
  for (const id of linkedWanted) tasks.push(this.linkedProvider(id, force, linkedAsked.has(id), !asked.length));
  const results = await withTimeout(Promise.all(tasks), 30000, () => failure("subusage/timeout", "额度查询超过 30 秒仍未完成，请稍后重试或缩小 providers"));
  // 兄弟插件不在场时联动项返回 null，直接丢掉即可——不给「未安装的插件」占一行。
   const entries = [], seenAccounts = new Map();
   for (const result of results.filter(Boolean)) {
    const rows = result.linkedAccounts?.length ? result.linkedAccounts : result.ofmAccounts?.length ? result.ofmAccounts : [result];
    for (const entry of rows) {
     // 同一来源/渠道/账号才算重复；同名、同余额、不同区域或不同来源均不能推断为同一账号。
     const key = result[QUOTA_SOURCE] && entry.accountId ? `${result[QUOTA_SOURCE]}:${entry.accountId}` : null;
     const previous = key ? seenAccounts.get(key) : undefined;
     if (previous !== undefined) {
      // 同批请求包含原生入口与 OFM 别名时优先保留原生标签；点名单个 OFM id 仍原样返回。
      if (entries[previous].providerId.startsWith("ofm-") && !entry.providerId.startsWith("ofm-")) entries[previous] = entry;
      continue;
     }
     if (key) seenAccounts.set(key, entries.length);
     entries.push(entry);
    }
   }
   // 但「问了一家、一个条目都没有」不能是空列表：那会被读成「本机没配任何额度」，真正的原因
  // 往往是「那个区域还没登录」或「插件没在跑」。这种情况补一条说明（点名多条面板时只补一条）。
  if (!entries.length && linkedWanted.length && asked.length) {
   const labels = linkedWanted.map(id => LINKED_PROVIDERS[id].label).join(" / ");
   entries.push({
    providerId: linkedWanted[0], label: labels || LINKED_PROVIDERS[linkedWanted[0]].label, state: "error",
    windows: [], extras: [], coverage: "partial", freshness: "unknown",
      error: `${labels} 没有可报的额度：还没登录，或对应提供方插件（Antigravity、dsh-connect-trae、dsh-connect-workbuddy、dsh-raccoon-connect、dsh-loomy-connect 或 Our Free Model）没有在本机运行。请在对应插件设置里登录后重试。`
   });
  }
  // 认不出的名字要回一条**可读**条目而不是静默丢掉：调用方（尤其是模型）无从知道本插件用的是
  // 路由 id，丢掉之后它只看到空列表，会当成「本机没配任何额度」——真正的原因只是名字没对上。
  // 放在最前面，免得淹没在几十条数据后面。
  const unknownEntries = unknown.map(name => ({
   providerId: name, label: name, state: "error", windows: [], extras: [], coverage: "partial", freshness: "unknown",
   error: `不认识提供商名「${name}」${wanted.length === IDS.length && matched.length === 0 ? "，下面是全部提供商的额度" : ""}。可以传本插件的 provider id（例如 deepseek、zai-coding-cn、kimi-coding、xiaomi-token-plan-cn），或直接传厂商名（zai、kimi、mimo、minimax、commandcode、grok、codex、copilot、ark、deepseek、antigravity、trae …）。省略 providers 也会查询全部 ${IDS.length} 条，另外还会带上本机兄弟插件报告的联动项（antigravity；Trae 的国内版 / 国际版 / 企业版面板）：有通道才出现，没装就不占一行。`
  }));
  return {
   updatedAt: new Date(this.now()).toISOString(),
   providers: [...unknownEntries, ...entries.map(entry => {
    const account = planAccounts && entry.providerId === "commandcode" ? planAccounts.find(item => item.id === (entry.account ?? "default")) : undefined;
     const linkedAccount = LINKED_IDS.includes(entry.providerId);
    const extras = Array.isArray(entry.extras) ? entry.extras : [];
    return {
     providerId: entry.providerId,
     label: entry.label,
     state: entry.state,
     windows: Array.isArray(entry.windows) ? entry.windows : [],
     // 账户标注进 extras：单独读 JSON 也能知道这条数字属于哪个账户（文本层把它并进标题行）。
     extras: account ? [...extras.filter(item => item?.kind !== "account"), { kind: "account", value: account.label }] : extras,
     // 激活状态是「现在实际用哪一个」的唯一答案：固定账户给 accountActive，自动轮换给 accountMode=auto。
     ...(account ? { account: account.label, accountActive: account.active === true, accountMode: plan.mode } : {}),
      ...(linkedAccount && typeof entry.account === "string" ? { account: entry.account } : {}),
      ...(linkedAccount && typeof entry.accountId === "string" ? { accountId: entry.accountId } : {}),
      ...(linkedAccount && typeof entry.accountActive === "boolean" ? { accountActive: entry.accountActive } : {}),
      ...(linkedAccount && ["auto", "fixed"].includes(entry.accountMode) ? { accountMode: entry.accountMode } : {}),
      ...(linkedAccount && typeof entry.accountEnabled === "boolean" ? { accountEnabled: entry.accountEnabled } : {}),
      ...(linkedAccount && ["present", "missing", "expired", "unknown"].includes(entry.authStatus) ? { authStatus: entry.authStatus } : {}),
      ...(linkedAccount && typeof entry.authExpiresAt === "string" ? { authExpiresAt: entry.authExpiresAt } : {}),
     // 只输出真正有值的字段：视图里带 `undefined` 的键会被调用方的 schema 校验判成型别错误
     // （DSH 就会），而且「字段缺席」本来就该表示「这家没报告」，不是「报告了空」。
     ...(typeof entry.coverage === "string" ? { coverage: entry.coverage } : {}),
      ...(typeof entry.availability === "string" ? { availability: entry.availability } : {}),
      ...(typeof entry.availabilityReason === "string" ? { availabilityReason: entry.availabilityReason } : {}),
     ...(typeof entry.freshness === "string" ? { freshness: entry.freshness } : {}),
     ...(typeof entry.lastSuccessAt === "string" ? { lastSuccessAt: entry.lastSuccessAt } : {}),
      // 对外视图里不能出现内部凭据引用名：no-key 文案嵌了它，这里换成账户标签
      // （client 通道仍保留引用名——那是本机排障要用的定位信息）。
      ...(entry.error ? { error: account ? redactAccountRef(entry.error, account.id, account.label) : entry.error } : {})
    };
   })]
  };
 }
 /**
  * 联动项（antigravity / trae*）的客户端药丸取数通道。
  * 与 quota() 的区别：只接受联动 id、不读设置、结果不带 settings/configured（客户端只合 entries）；
  * 与 read/refresh 的区别：联动项不进本插件 provider 表，走兄弟插件自己的服务/路由。
  * 始终按「点名」处理：通道缺席 / 未登录也回一条带原因的条目，由客户端决定隐藏还是展示。
  */
 async readLinked(request) {
  if (this.disposed) throw failure("subusage/disposed", "服务已卸载");
  const query = parseLinkedQuery(request);
   const tasks = query.providerIds.map(id => this.linkedProvider(id, query.force, true, false, true).catch(() => null));
  const entries = (await Promise.all(tasks)).filter(Boolean);
  return { updatedAt: new Date(this.now()).toISOString(), entries };
 }
  /**
   * 页面代取额度的单步：页面把已取到的上游响应带回来，宿主只跑归一化。
   *
   * 存在的理由：DSH 的 `/plugins/*` 路由要求浏览器凭据（`admit()` 的 cookie 认证），
   * 宿主进程发的本机 HTTP 请求没有它，一律 403。渲染进程有 cookie，所以由页面取、
   * 宿主算——归一化仍只有这一份实现，前端不复制业务逻辑。
   *
   * 走的是 linkedProvider 的同一条路径，因此 OFM / EAC 回落、缺席指引、超时预算与
   * 工具报告口径完全一致；这里只负责把 responses 变成数据源。
   */
  async linkedStep(request) {
   if (this.disposed) throw failure("subusage/disposed", "服务已卸载");
   const step = parseLinkedStep(request);
   const id = step.providerId, meta = LINKED_PROVIDERS[id];
   if (!meta || !CLIENT_FETCH_VIA.has(meta.via)) throw failure("subusage/response", "该条目不需要页面代取额度");
   // 60 秒内存命中：页面轮询、切标签页、重挂药丸都会重新发起，而兄弟插件那条路由每次
   // 都会真去上游取数，不拦一下就把对方的额度接口打成了靶子。
   const cached = this.linkedSteps.get(id), time = this.now();
   if (!step.force && cached && time >= cached.at && time - cached.at < 60000) return { entry: structuredClone(cached.entry) };
   const table = new Map(step.responses.map(row => [row.key, row]));
   const source = async (plugin, endpoint, query) => {
    const row = table.get(linkedRequestKey(endpoint, query));
    if (!row) throw new MissingLinkedRequest(endpoint, query);
    // 404 = 兄弟插件没装：这条通道不存在，与「读取失败」分开。
    if (row.status === 404) return undefined;
    // 页面根本没连上本机服务（网络层失败）：这跟「上游拒绝」不是一回事，别报成 HTTP 0。
    if (!row.status) throw failure("subusage/transport", `${meta.label} 的额度接口请求失败：页面无法连接本机服务`);
    if (row.ok !== true) throw failure("subusage/transport", `${meta.label} 的额度接口返回 HTTP ${row.status}`);
    return row.body;
   };
   let entry;
   // 带着已取回响应的后续轮次：直取是否读不到已在首轮判过，见 linkedSnapshot。
   source.continuation = step.responses.length > 0;
   try {
    // explicit = true：缺席、未登录都回一条带原因的条目，而不是让药丸静默消失。
    entry = await this.linkedProvider(id, step.force, true, false, true, source);
   } catch (error) {
    if (error instanceof MissingLinkedRequest) return { missing: { key: linkedRequestKey(error.endpoint, error.query), url: linkedRouteUrl(meta, error.endpoint, error.query) } };
    throw failure("subusage/transport", error instanceof Error && error.message ? error.message : `${meta.label} 额度读取失败`);
   }
   if (!entry) return { absent: true };
   // 只缓存**读到额度**的结果。缺席/未登录/失败都不缓存：用户装好插件或登录后，
   // 药丸该在下一轮就恢复，而不是被一个 60 秒的缓存按住。
   if (entry.state === "ok") this.linkedSteps.set(id, { at: time, entry: structuredClone(entry) });
   return { entry };
  }
 async read(request) { return this.refresh(request && request.providerIds ? request : { providerIds: IDS, force: false }); }
 async refresh(request) {
  if (this.disposed) throw failure("subusage/disposed", "服务已卸载");
  const query = parseQuery(request); const settings = this.load();
  let entries = await Promise.all(query.providerIds.map(id => this.provider(id, settings, query.force, query.commandCodeAccount).catch(() => ({ ...this.base(id, "none", settings, query.commandCodeAccount), state: "error", errorCode: "subusage/internal", error: "读取用量失败" }))));
  // 多 Key 监控：额外引用名的额度挂到主条目上（药丸仍只显示主条目 = DSH 实际调用的 Key）。
  entries = await this.withKeyAccounts(settings, query.force, entries);
  // 客户端请求了本 Host 不认识的 provider（装了新版但还没重启 DSH）：回一条可读原因，
  // 否则它只会显示成「无数据」，用户无从判断是该重启还是该配凭据。
  // 联动项（antigravity / trae*）只走 `quota()`，不进 read/refresh 的 provider 表：第三方若把它们的 id
  // 直接发给 read/refresh，要说清「走错了通道」，而不是误报成「Host 版本旧」。
  const unknownEntries = (query.unknown ?? []).map(id => ({ providerId: id, label: id, state: "error", errorCode: "subusage/unknown-provider", error: LINKED_IDS.includes(id) ? `「${id}」是兄弟插件联动项：只出现在 quota() 视图与 subusage_quota 工具报告里，不参与 read/refresh。用 quota({ providerIds: ["${id}"] }) 查询。` : "本机运行中的 Host 版本较旧，不认识该提供商；重启 DSH 后生效", apiDetected: null, coverage: "partial", freshness: "unknown", keySource: "none", retryable: false, retainPrevious: false, windows: [], extras: [] }));
  const latest = this.load();
  if (!this.settingsStable(settings, latest)) return this.result(latest, [...query.providerIds.map(id => ({ ...this.base(id, "none", latest, query.commandCodeAccount), state: "error", errorCode: "subusage/config-changed", error: "读取期间配置已改变，请刷新" })), ...unknownEntries]);
  // Command Code 自动轮换：把轮换池健康摘要挂到默认账户（顶层 Key）entry 上。
  // 仅当本次查询的就是默认账户（commandCodeAccount 为空）时——查某个额外账户时不挂，
  // 那条 entry 代表的是被点名的账户本身。提供方插件未运行 / 固定账户时 pool 为 null，原样返回。
  if (query.providerIds.includes("commandcode") && (!query.commandCodeAccount || query.commandCodeAccount === "default")) {
   const ccIndex = entries.findIndex(e => e && e.providerId === "commandcode");
   if (ccIndex >= 0) {
    const pool = await this.commandCodePool(latest, query.force, entries[ccIndex]);
    if (pool) entries[ccIndex] = { ...entries[ccIndex], accountPool: pool };
   }
  }
  return this.result(latest, [...entries, ...unknownEntries]);
 }
 startMimoLogin(request) { const parsed = parseLoginStart(request); this.cancelActiveMimoLogin(this.mimoQr); return this.login.start(parsed); } getMimoLoginStatus() { return this.login.status(); }
 cancelMimoLogin(request) { return this.login.cancel(parseLoginCancel(request)); }
 startMimoQrLogin(request) { const parsed = parseLoginStart(request); this.cancelActiveMimoLogin(this.login); return this.mimoQr.start(parsed); } getMimoQrStatus() { return this.mimoQr.status(); }
 cancelMimoQrLogin(request) { return this.mimoQr.cancel(parseLoginCancel(request)); }
 startOpenDesignLogin(request) { return this.openDesignLogin.start(parseLoginStart(request)); } getOpenDesignLoginStatus() { return this.openDesignLogin.status(); }
 cancelOpenDesignLogin(request) { return this.openDesignLogin.cancel(parseLoginCancel(request)); }
 mimoMaterial(s) { const id = "xiaomi-token-plan-cn"; return hash([s.xiaomi.cookie, s.keys[id] ?? "", s.keyModes[id], s.xiaomi.renewal?.passToken ?? ""]); }
 commitMimoLogin(cookie, captured, verified, observedExpiresAt, renewal) {
  const id = "xiaomi-token-plan-cn", s = this.load();
  if (this.disposed) throw failure("subusage/disposed", "服务已卸载");
  if (this.mimoMaterial(s) !== captured) throw failure("subusage/revision-conflict", "MiMo 设置已被修改，拒绝覆盖");
  this.persist({ providerId: id, expectedRevision: hash(s), cookieUpdate: { action: "replace", value: cookie } }, observedExpiresAt, renewal);
  // 新登录换了续期材料：旧材料留下的失败记录不能挡住新材料的第一次续期。
  this.mimoRenewState = null;
  const stored = this.load(); const data = { ...verified }; const usageError = data.usageError; delete data.usageError;
  const entry = { ...this.base(id, "cookie", stored), ...data, state: "ok", coverage: data.coverage ?? "partial", freshness: "fresh", lastSuccessAt: new Date(this.now()).toISOString(), ...(usageError ? { errorCode: usageError.code, error: "额度暂时无法读取", retryable: usageError.details?.retryable === true } : {}) };
  // 响应内容也不得回显本次 Cookie（服务端字段属于不可信输入）。
  const safeEntry = redactSecret(entry, cookie);
  // 指纹段必须与 provider() 的五段顺序逐位对齐：MiMo 没有 secret，第二段固定空串。
  // 少一段会让登录提交后的首次刷新认不出同一份缓存，重复拉取。
  const fingerprint = hash([cookie, "", "cookie", stored.keyModes[id], null, null]);
  this.fingerprints.set(id, fingerprint); this.cache.set(id, { fingerprint, entry: safeEntry, at: this.now(), retryAt: usageError ? this.now() + 15000 : 0, failures: 0 });
  this.loginResultMaterial = this.mimoMaterial(stored);
  return this.result(stored, [safeEntry]);
 }
 openDesignMaterial(s) { const id = "opendesign"; return hash([s.keys[id] ?? "", s.keyModes[id]]); }
 commitOpenDesignLogin(cookie, captured, verified, observedExpiresAt) {
  const id = "opendesign", s = this.load();
  if (this.disposed) throw failure("subusage/disposed", "服务已卸载");
  if (this.openDesignMaterial(s) !== captured) throw failure("subusage/revision-conflict", "OpenDesign 设置已被修改，拒绝覆盖");
  // 与 MiMo 不同，OpenDesign 不需要独立的计时字段：会话 Cookie 直接进通用手动 Key 槽，
  // 凭据模式一并切成 manual，界面上的凭据来源与之后的手动填写完全同一条路径。
  this.persist({ providerId: id, expectedRevision: hash(s), keyUpdate: { action: "replace", value: cookie }, keyMode: "manual" });
  const stored = this.load(); const data = { ...verified }; const usageError = data.usageError; delete data.usageError;
  const entry = { ...this.base(id, "manual", stored), ...data, state: "ok", coverage: data.coverage ?? "partial", freshness: "fresh", lastSuccessAt: new Date(this.now()).toISOString(), ...(usageError ? { errorCode: usageError.code, error: "额度暂时无法读取", retryable: usageError.details?.retryable === true } : {}) };
  // 响应内容同样不得回显本次 Cookie（服务端字段属于不可信输入）。
  const safeEntry = redactSecret(entry, cookie);
  // 指纹段必须与 provider() 的六段顺序逐位对齐（OpenDesign 没有 secret，第二段固定空串；
  // 第三段是 identity.source——这条走通用手动 Key，所以是 "manual"）。少一段会让登录提交后的
  // 首次刷新认不出同一份缓存，重复拉取。
  const fingerprint = hash([cookie, "", "manual", stored.keyModes[id], null, null]);
  this.fingerprints.set(id, fingerprint); this.cache.set(id, { fingerprint, entry: safeEntry, at: this.now(), retryAt: usageError ? this.now() + 15000 : 0, failures: 0 });
  this.openDesignLoginResultMaterial = this.openDesignMaterial(stored);
  return this.result(stored, [safeEntry]);
 }
 /**
  * 浏览器登录与扫码登录是两个独立的 Host 登录器，却写同一份 MiMo 凭据：同时进行时先提交的会让
  * 后提交的撞上「设置已被修改」。开始其中一种时取消另一种进行中的任务（界面本身已互斥，这里兜住多窗口）。
  */
 cancelActiveMimoLogin(other) {
  const job = other?.current;
  if (job && ["starting", "launching", "waiting", "verifying"].includes(job.public.state)) other.cancel({ jobId: job.public.jobId });
 }
 mimoLoginBusy() { return [this.login.current, this.mimoQr.current].some(job => job && ["starting", "launching", "waiting", "verifying"].includes(job.public.state)); }
 /** 续期材料在场且 passToken 自身未到期。 */
 mimoRenewable(settings) { const renewal = settings?.xiaomi?.renewal; return !!renewal && !(renewal.expiresAt && renewal.expiresAt <= this.now()); }
 mimoCookieStatus(settings) {
  const expiresAt = isoStamp(settings?.xiaomi?.expiresAt);
  return { ...(expiresAt ? { cookieExpiresAt: expiresAt } : {}), ...(this.mimoRenewable(settings) ? { cookieRenewable: true } : {}) };
 }
 /** 读取期间设置有没有被「别处」改动：续期引起的变化（账本里有记录）不算。 */
 settingsStable(before, latest) {
  const target = querySettingsHash(latest);
  let current = querySettingsHash(before);
  for (let step = 0; step <= this.renewalLedger.length && current !== target; step++) {
   const next = this.renewalLedger.find(item => item.before === current);
   if (!next) return false;
   current = next.after;
  }
  return current === target;
 }
 /**
  * MiMo 控制台 Cookie 的静默续期。只有扫码登录留下了续期材料（passToken）时才会发生：
  * - `reason: "due"`：Cookie 距到期不足 MIMO_RENEW_MARGIN_MS（或已过期）时在取数前续；
  * - `reason: "rejected"`：上游已拒绝当前 Cookie，不论本地计时如何都续一次。
  * 同一时刻只有一次换票，并发调用共享结果。passToken 被拒不重试（等用户重新扫码换材料），
  * 网络 / 接口形状类失败按间隔重试；失败只在内存里记，重启后允许再试一次。
  * 返回 `{ settings, renewed, failure? }`：settings 永远是最新读到的设置；failure 仅在需要告知用户时才有。
  */
 async mimoRenewIfDue(_settings, reason = "due") {
  const s = this.load(), x = s.xiaomi, now = this.now();
  if (!x.cookie.trim() || !x.renewal) return { settings: s, renewed: false };
  const authFailure = { code: "auth", message: MIMO_RENEW_FAILED_TEXT, until: 0 };
  const lapsed = x.expiresAt > 0 && x.expiresAt <= now;
  // passToken 自己也到期了：没有东西可续，Cookie 失效后按「需要重新扫码」处理。
  if (x.renewal.expiresAt && x.renewal.expiresAt <= now) return { settings: s, renewed: false, ...(lapsed || reason === "rejected" ? { failure: authFailure } : {}) };
  const due = reason === "rejected" || (x.expiresAt > 0 && x.expiresAt - now <= MIMO_RENEW_MARGIN_MS);
  if (!due || this.mimoLoginBusy()) return { settings: s, renewed: false };
  const blocked = this.mimoRenewState;
  if (blocked && blocked.sig === hash(x.renewal.passToken) && (blocked.code === "auth" || blocked.until > now)) return { settings: s, renewed: false, failure: blocked };
  if (!this.mimoRenewing) this.mimoRenewing = this.renewMimoNow(s).finally(() => { this.mimoRenewing = null; });
  return this.mimoRenewing;
 }
 async renewMimoNow(s) {
  const id = "xiaomi-token-plan-cn", renewal = s.xiaomi.renewal, material = this.mimoMaterial(s), sig = hash(renewal.passToken);
  const fail = (code, message) => {
   this.mimoRenewState = { sig, code, message, until: code === "auth" ? 0 : this.now() + (code === "network" ? MIMO_RENEW_NETWORK_RETRY_MS : MIMO_RENEW_PROTOCOL_RETRY_MS) };
   return { settings: this.load(), renewed: false, failure: this.mimoRenewState };
  };
  let result;
  try {
   result = await renewMimoSession({ fetch: this.mimoRenewFetch, userId: renewal.userId, passToken: renewal.passToken, deviceId: renewal.deviceId, signal: this.requestSignal(), now: this.now, makeError: failure, ...this.mimoRenewOptions });
  } catch (error) {
   if (error?.code === "subusage/auth") return fail("auth", MIMO_RENEW_FAILED_TEXT);
   if (error?.code === "subusage/login-protocol") return fail("protocol", "小米登录接口返回异常，自动续期失败，稍后自动重试；仍失败请重新扫码登录");
   return fail("network", "自动续期暂时失败（无法连接小米登录服务），稍后自动重试");
  }
  const latest = this.load();
  // 等待网络期间用户重新登录 / 清除了凭据：这份结果属于旧材料，丢弃。
  if (this.disposed || this.mimoMaterial(latest) !== material) return { settings: latest, renewed: false };
  const before = querySettingsHash(latest);
  const next = { ...renewal, ...(result.passToken ? { passToken: result.passToken, ...(result.passTokenExpiresAt ? { expiresAt: result.passTokenExpiresAt } : {}) } : {}) };
  try { this.persist({ providerId: id, cookieUpdate: { action: "replace", value: result.cookie } }, 0, next, true); }
  catch { return fail("network", "自动续期已换到新会话但无法保存设置，稍后自动重试"); }
  const stored = this.load();
  this.renewalLedger.push({ before, after: querySettingsHash(stored) });
  if (this.renewalLedger.length > 16) this.renewalLedger.shift();
  this.mimoRenewState = null;
  return { settings: stored, renewed: true };
 }
 async save(settings) { return this.persist(settings); }
 persist(settings, cookieCap, renewal, silent = false) {
  if (this.disposed) throw failure("subusage/disposed", "服务已卸载");
  const patch = parseSettings(settings); const stored = this.load();
  // 未知 provider：这是「客户端已更新、Host 还没重启」的版本窗口期，给出可读原因而不是静默写入垃圾配置。
  // 只改可见性的 patch 不带 providerId，不能因此被拒。
  if (patch.providerId !== undefined && !IDS.includes(patch.providerId)) throw failure("subusage/unknown-provider", "本机运行中的 Host 版本较旧，不认识该提供商；重启 DSH 后生效");
  if (patch.expectedRevision !== undefined && patch.expectedRevision !== hash(stored)) throw failure("subusage/revision-conflict", "设置已被其他窗口修改，请重新读取");
  const id = patch.providerId;
  // 火山方舟 4 条路由共用一组 AK/SK：parseSettings 已将 volc 补丁展开为两个 update 字段，
  // 任一字段变化都要让所有 Ark 缓存失效，不能只失效当前标签页。
  const sharedVolc = patch.accessKeyUpdate !== undefined || patch.secretKeyUpdate !== undefined;
  const affected = patch.visibility ? [...Object.keys(patch.visibility.providers ?? {}).filter(key => stored.visibility.providers[key] !== patch.visibility.providers[key]), ...(patch.visibility.ark !== undefined && patch.visibility.ark !== stored.visibility.ark ? ARK_PERSONAL_IDS : []), ...(patch.visibility.arkTeam !== undefined && patch.visibility.arkTeam !== stored.visibility.arkTeam ? ARK_TEAM_IDS : [])] : sharedVolc ? ARK_IDS : [id];
  if (patch.visibility) {
   if (patch.visibility.manualMatching !== undefined) stored.visibility.manualMatching = patch.visibility.manualMatching;
   if (patch.visibility.providerMappings !== undefined) stored.visibility.providerMappings = structuredClone(patch.visibility.providerMappings);
   if (patch.visibility.hideWithoutApi !== undefined) stored.visibility.hideWithoutApi = patch.visibility.hideWithoutApi;
   if (patch.visibility.antigravity !== undefined) stored.visibility.antigravity = patch.visibility.antigravity;
   // 两个组开关分别落到成员，旧逐条字段保持兼容，但不会让个人版开关改到 Team。
   if (patch.visibility.ark !== undefined) { stored.visibility.ark = patch.visibility.ark; for (const key of ARK_PERSONAL_IDS) stored.visibility.providers[key] = patch.visibility.ark; }
   if (patch.visibility.arkTeam !== undefined) { stored.visibility.arkTeam = patch.visibility.arkTeam; for (const key of ARK_TEAM_IDS) stored.visibility.providers[key] = patch.visibility.arkTeam; }
   Object.assign(stored.visibility.providers, patch.visibility.providers);
  }
  if (patch.keyMode !== undefined) stored.keyModes[id] = patch.keyMode;
  // 额外监控的引用名：空列表表示恢复默认（只认路由实际 apiKeyEnv 与内置名）。
  if (patch.keyRefs !== undefined) { if (patch.keyRefs.length) stored.keyRefs[id] = [...patch.keyRefs]; else delete stored.keyRefs[id]; }
  const update = (obj, key, op) => { if (op?.action === "replace") obj[key] = op.value; else if (op?.action === "clear") delete obj[key]; };
  update(stored.keys, id, patch.keyUpdate);
  // 清除手动 Key 后 manual 模式已无内容可用，继续留着它只会让继承的凭据/环境变量
  // 读不到（identity 不再短路，但设置页也不该停留在「手动 Key」）。直接回到继承。
  if (patch.keyUpdate?.action === "clear" && stored.keyModes[id] === "manual") stored.keyModes[id] = "inherit";
  if (patch.cookieUpdate?.action === "clear") { stored.xiaomi.cookie = ""; stored.xiaomi.loginAt = 0; stored.xiaomi.expiresAt = 0; delete stored.xiaomi.renewal; this.mimoRenewState = null; } else if (patch.cookieUpdate?.action === "replace") {
   // 官方会话 Cookie 自签发起 24 小时有效；浏览器报告了更早的过期时间时以更早者为准。
   // 计时只在真正写入新 Cookie 时起算：keep 是“未改动”，不能借保存动作续满倒计时。
   update(stored.xiaomi, "cookie", patch.cookieUpdate);
   const at = this.now();
   stored.xiaomi.loginAt = at;
   stored.xiaomi.expiresAt = Math.min(at + MIMO_COOKIE_TTL_MS, Number.isSafeInteger(cookieCap) && cookieCap > at ? cookieCap : Number.POSITIVE_INFINITY);
   // 续期材料只跟着「它换出来的那份 Cookie」走：手动粘贴 / 浏览器登录写入的 Cookie 可能属于另一个账号，
   // 沿用旧材料续期会把它换成旧账号的会话，所以没有明确传入新材料时一律丢弃。
   const nextRenewal = normalizeRenewal(renewal);
   if (nextRenewal) stored.xiaomi.renewal = nextRenewal; else delete stored.xiaomi.renewal;
  }
  if (patch.zai) stored.zai = patch.zai;
  if (patch.litellm) stored.litellm = patch.litellm;
  // volc 用「置空字符串」而不是 delete：这两个字段在内存里必须始终存在（publicSettings 会读它们），
  // 空串与 parseStored 的默认值同义 = 未配置。
  const updateVolc = (key, op) => { if (op?.action === "replace") stored.volc[key] = op.value; else if (op?.action === "clear") stored.volc[key] = ""; };
  updateVolc("accessKeyId", patch.accessKeyUpdate);
  updateVolc("secretAccessKey", patch.secretKeyUpdate);
  // AK/SK 是 4 条 Ark 路由共用的一对：清掉任一字段后 manual 模式对所有 Ark 路由都不可用，
  // 一并回到继承，避免「删了 AK/SK，环境变量却读不到」。
  if (patch.accessKeyUpdate?.action === "clear" || patch.secretKeyUpdate?.action === "clear") for (const arkId of ARK_IDS) if (stored.keyModes[arkId] === "manual") stored.keyModes[arkId] = "inherit";
  try { this.io.mkdirSync(dirname(this.path), { recursive: true, mode: 0o700 }); this.io.writeFileSync(`${this.path}.tmp`, JSON.stringify(stored, null, 2), { encoding: "utf8", mode: 0o600 }); this.io.chmodSync(`${this.path}.tmp`, 0o600); this.io.renameSync(`${this.path}.tmp`, this.path); }
  catch { throw failure("subusage/config", "无法保存订阅设置"); }
  for (const id of affected) if (!silent) this.invalidateProvider(id);
  return this.result(stored, []);
 }
  dispose() { this.login.dispose(); this.mimoQr.dispose(); this.openDesignLogin.dispose(); this.disposed = true; this.controller.abort(); this.cache.clear(); this.inflight.clear(); this.fingerprints.clear(); this.connect.dispose(); this.desktopUsage.dispose(); this.eac.dispose(); this.local.dispose(); this.linkedSteps.clear(); this.localMisses.clear(); this.traeCredentials.clear(); const eacPeer = this.eacPeer; this.eacPeer = undefined; this.eacConnection = undefined; eacPeer?.dispose?.(); for (const key of [...this.generations.keys(), ...IDS]) this.generations.set(key, (this.generations.get(key) ?? 0) + 1); return this.ofm.dispose(); }
}
function registerRemotes(ctx) {
 ctx.inject(["typert"], scope => { scope.effect(() => scope.typert.register({ package: subUsageRemote.package, face: "host", schemas: [], model: { services: [], events: [], objects: [] }, invocations: subUsageRemote.descriptors })); });
}
function apply(ctx) { registerRemotes(ctx); ctx.plugin(SubUsageService, {}); registerQuotaTool(ctx); ctx.logger.info("dsh-subusage: usage service ready"); }
/**
 * 工具结果的人读文本：一行一个 provider，先给窗口再给余额，异常与未配置直说。
 * 这段文本才是模型真正读到的东西，所以**任何情况下都不返回空**：读不到数据时也要给出
 * 「怎么才能读到」的下一步，否则模型只会回一句「没有额度」，而原因其实是个可以修的动作项。
 * Command Code 有多个账户时按账户各给一行，标题里标出当前激活的是哪一个
 * （`accountActive`）或处于自动轮换（`accountMode === "auto"`）——「还剩多少」与
 * 「现在实际用哪个账户」本来就是同一个问题的两面。
 */
function formatQuotaText(value) {
 const providers = Array.isArray(value?.providers) ? value.providers : [];
 const omitted = Number.isFinite(value?.omitted) && value.omitted > 0 ? value.omitted : 0;
 const tail = omitted ? `\n（另有 ${omitted} 家未启用、未配置凭据或没有可读额度，已省略；需要时用 providers 点名查询某一家的状态。）` : "";
 if (!providers.length) return omitted
  ? `没有可显示的额度：${omitted} 家都未启用、未配置凭据或没有可读数据。用 providers 点名查询某一家的状态，或在 dsh-subusage 设置页确认「检测」开关与凭据。`
  : `没有读到任何提供商。请不带 providers 参数再调用一次以查询全部 ${IDS.length} 条；若仍为空，在设置页确认「检测」开关与凭据。`;
 const lines = providers.map((entry, index) => {
  const repeat = providers[index - 1]?.providerId === entry.providerId;
  const head = `${entry.label || entry.providerId} [${entry.state}]${accountSuffix(entry, repeat)}`;
  if (entry.state === "no-key" || entry.state === "no-cookie") return `${head}：未配置凭据`;
  if (entry.state === "disabled") return `${head}：检测已关闭`;
  if (entry.state !== "ok") return `${head}：${entry.error || "读取失败"}`;
  // 同一额度池（预算 / 能力范围 / 分组名）的多个窗口并成**一段**：池名重复两三遍只是噪音
  // （Antigravity 的三个池各带周窗与 5 小时窗、ARK 的「文本/向量」同此），而窗口本身仍各报
  // 各的 kind / 剩余 / 重置。只合并**相邻**同池窗口，跨池的顺序保持上游下发的次序。
  const parts = [], segments = [];
  for (const window of entry.windows || []) {
   const scope = window.budgetScope ? `${window.budgetScope} 预算` : ({ text: "文本/向量", "daily-capabilities": "日额度适用能力", all: "全部能力共享" }[window.detail?.scope] || window.groupLabel);
   const text = `${window.kind} ${window.status === "rate-limited" ? "已达限额" : `${Math.round(Math.max(0, 100 - window.percent) * 10) / 10}% 剩余`}${window.resetsAt ? `（重置 ${window.resetsAt}）` : ""}`;
   const last = segments[segments.length - 1];
   if (scope && last && last.scope === scope) last.windows.push(text);
   else segments.push({ scope, windows: [text] });
  }
  for (const segment of segments) parts.push(`${segment.scope ? segment.scope + " · " : ""}${segment.windows.join(" / ")}`);
  // 账户名已经在标题行里了；再打一遍只会把额度挤出视野。
  // **只对多账户行跳过**（顶层 account 字段 = Command Code 的账户标注）：火山方舟的席位标注
  // 同样用 kind "account"（`席位 seat-xxx（共 N 个席位）`），那是唯一能看出「读的是哪个席位」的
  // 信息，跟着一起丢就等于把额度说成不属于任何席位。
  const skipAccountExtra = typeof entry.account === "string" && entry.account !== "";
  // 说明类（note）逐条拼进一行时能到四十多条：额度包、每条到期时间各占一段，报告本身就被噪声淹没。
  // 这里只报条数，明细留给药丸展开——报告是「还剩多少」的答案，不是账单流水。
  let noteCount = 0, singleNote = "";
  for (const extra of entry.extras || []) {
   if (skipAccountExtra && extra.kind === "account") continue;
   if (extra.kind === "note") { noteCount += 1; if (noteCount === 1) singleNote = extra.value; continue; }
   parts.push(`${extra.kind}: ${extra.value}`);
  }
  if (noteCount === 1) parts.push(`说明: ${singleNote}`);
  else if (noteCount > 1) parts.push(`说明 ${noteCount} 条（明细在药丸里展开）`);
   const auth = { present: "凭据已提供", missing: "缺少凭据", expired: "记录的登录态已到期" }[entry.authStatus];
   if (auth) parts.push(auth);
   if (typeof entry.authExpiresAt === "string") parts.push(`提供方记录到期 ${entry.authExpiresAt}`);
  const advice = { included: "接口仍允许订阅续用（基础额度可能已用尽）", paygo: "包含额度用尽时可按量续用，实际余额与服务端为准", blocked: "账户/预算受限或包含额度已用尽", unknown: "续用条件待确认，不保证可调用" };
   if (advice[entry.availability]) parts.push(advice[entry.availability]);
   if (entry.freshness === "stale") parts.push("缓存数据");
  return `${head}：${parts.length ? parts.join("；") : "暂无额度数据"}`;
 });
 // 一条额度都没读到时，末尾补一句汇总原因：模型据此才能告诉用户下一步做什么。
 if (!providers.some(entry => entry.state === "ok")) {
  const missing = providers.filter(entry => entry.state === "no-key" || entry.state === "no-cookie").length;
  const off = providers.filter(entry => entry.state === "disabled").length;
  // 联动项（antigravity / trae*）的「没登录」「插件没跑」不是读取失败，也不该把用户指去
  // dsh-subusage 的凭据文档——它们的登录入口在兄弟插件自己的设置卡片里。
  const linked = providers.filter(entry => LINKED_IDS.includes(entry.providerId)).length;
  const rest = Math.max(0, providers.length - missing - off - linked);
  const advice = linked && linked === providers.length
     ? "联动项的数据由兄弟插件提供：到 设置 → 对应的 Antigravity / Trae / WorkBuddy / Raccoon / Loomy / OFM 提供方插件卡片里登录或启用后再试"
   : "凭据与开关都在 dsh-subusage 设置页，或参考 docs/credentials.md";
  lines.push(`（这 ${providers.length} 条都没读到额度：未配置凭据 ${missing} 条、检测已关闭 ${off} 条${linked ? `、联动项 ${linked} 条（兄弟插件未运行或对应区域未登录）` : ""}${rest ? `；其余 ${rest} 条为读取失败` : ""}。${advice}。）`);
 }
 return lines.join("\n") + tail;
}
/**
 * 多账户 provider 的账户后缀：账户名 +（当前激活 | 自动轮换 | 轮换候选）。
 * 同一家的后续行不重复模式词——三行都写一遍「自动轮换」只会白占宽度。
 */
function accountSuffix(entry, repeat = false) {
 if (typeof entry?.account !== "string" || entry.account === "") return "";
  if (!["auto", "fixed"].includes(entry.accountMode) && entry.accountActive !== true) return `（账户 ${entry.account}）`;
 if (repeat && entry.accountMode === "auto") return `（账户 ${entry.account}）`;
 const state = entry.accountMode === "auto" ? "自动轮换" : entry.accountActive === true ? "当前激活" : "轮换候选";
 return `（账户 ${entry.account} · ${state}）`;
}
/**
 * 「这条值不值得占一行」（只在调用方**没有点名厂商**时用）。
 * 省略的是「没启用」「没配凭据」与「成功了但确实没有可读额度」三类：本机登记着三十来条路由，
 * 这三类只会把真正的数字淹掉。
 * **读取失败（state=error）刻意保留**：那是一次「没读到」，不是「没配置」——把它一起省略，
 * 一次网络抖动就会被说成「这家还没配凭据」，把排障方向带偏。
 * `plan` 是套餐名、`account` 是账户标注，都不算额度数据——「本月没有可读额度」这种占位说明
 * 正是用户不想看到的空行。但**顶层 account 才是账户标注行**：火山方舟的席位标注也用
 * kind `account`（`席位 seat-xxx（共 N 个席位）`），那是身份信息而不是账户标注，照旧算数据。
 */
function hasQuotaData(entry) {
 if (!entry) return false;
 if (entry.state === "error") return true;
 if (entry.state !== "ok") return false;
 if (typeof entry.availability === "string") return true;
  if (Array.isArray(entry.windows) && entry.windows.length) return true;
 const metadata = typeof entry.account === "string" && entry.account !== "" ? ["account", "plan"] : ["plan"];
 return (Array.isArray(entry.extras) ? entry.extras : []).some(item => !metadata.includes(item?.kind));
}
/**
 * 注册 subusage_quota 工具：模型可以直接问「额度还剩多少」，不必自己逐个厂商请求。
  * 工具只读：不写设置、不碰凭据，普通订阅缓存 60 秒，联动项沿用各来源策略。
 */
function registerQuotaTool(ctx) {
 ctx.inject(["tools"], toolCtx => {
  toolCtx.tools.register(defineTool({
   name: "subusage_quota",
   description: "Read the quota, balance or spend of the AI subscriptions configured on this machine. Call it with no arguments to read every provider - that is the usual call; the result is a full readable report, so there is no need to ask for a subset first. `providers` optionally filters by provider id or plain vendor name (e.g. zai, kimi, mimo, minimax, commandcode, grok, codex, copilot, ark, deepseek, trae, antigravity, ofm); one name may match several routes, and an unrecognized name returns the full data plus an explanation instead of nothing. Linked providers (antigravity, trae, ofm-*) use their sibling plugin's read-only service and appear only while it runs. OFM can return independent accounts. Read-only: it never returns credentials and never changes settings. Cache duration depends on the source; pass refresh=true only when the user asks for the latest numbers.",
   parameters: {
    providers: { type: "array", items: { type: "string" }, description: "Optional provider ids or vendor names; omit to read everything." },
    refresh: { type: "boolean", description: "Request a fresh fetch from the provider. Use only when the user asks for the latest numbers." }
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
       description: "One entry per provider/account.",
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
         coverage: { type: "string", description: "complete | partial — completeness of applicable reported quota facts, not a count of windows." },
          availability: { type: "string", description: "Optional advisory: included | paygo | blocked | unknown. Window exhaustion alone need not block paid usage; absent means no separate billing-route evidence." },
          availabilityReason: { type: "string", description: "Machine-readable basis for availability; no credentials or raw upstream objects." },
         freshness: { type: "string", description: "fresh | stale" },
         lastSuccessAt: { type: "string" },
           account: { type: "string", description: "Account label this entry reports." },
          accountId: { type: "string", description: "Non-secret account identity, scoped to this provider and region." },
          accountActive: { type: "boolean", description: "Provider-reported selected account; absent when unknown." },
          accountMode: { type: "string", description: "fixed | auto; only when explicitly reported by the provider." },
          accountEnabled: { type: "boolean", description: "Whether the provider enables this account." },
          authStatus: { type: "string", description: "present | missing | expired | unknown; credential metadata, not proof of a successful authentication." },
          authExpiresAt: { type: "string", description: "Expiry time recorded by the provider; it may be a cached estimate." },
         error: { type: "string", description: "Failure reason when state is error." }
        }
       }
      },
      omitted: { type: "number", description: "How many distinct providers were left out of `providers` (counted by provider id) because detection is off, no credentials are configured, or they reported no quota data. Entries that failed to fetch, and the explanation row for an unrecognized name, are never left out. Only set when nothing was named or no name was recognized." }
     }
    },
    render: (_args, value) => [{ type: "text", text: formatQuotaText(value) }]
   },
   execute: async (args, exec) => {
    exec?.signal?.throwIfAborted?.();
    const service = toolCtx.get("subUsage");
    if (!service || typeof service.quota !== "function") throw new Error("dsh-subusage 服务尚未就绪：Host 端可能还在启动或刚更新完还没重启。请稍后重试；持续失败就重启 DSH。");
    const asked = Array.isArray(args?.providers) ? args.providers.filter(name => typeof name === "string" && name.trim() !== "") : [];
    const value = await service.quota({ providerIds: args?.providers, force: args?.refresh === true });
    if (!Array.isArray(value?.providers)) return value;
    // 点名的家原样保留（用户问的正是它，包括「为什么没数据」）；但**一个名字都没认出来**时，quota()
    // 会兜底把全量数据一并给出——那次全量仍然要过滤，否则模型拼错一个名字，换来的正是三十条
    // 未启用条目（本工具最该避免的输出）。认不出的名字自己的说明行照旧保留。
    const resolution = asked.length ? resolveProviderIds(asked) : { ids: [], linked: [] };
    const named = new Set([...resolution.ids, ...resolution.linked]);
    // 联动项（antigravity）也按「有没有数据」收起：独立开关只决定是否探测，不能让它像
    // 普通 provider 一样永远占一行。认不出的名字（不在两张表里）仍保留自己的说明行。
    const kept = value.providers.filter(entry => named.has(entry.providerId) || !IDS.includes(entry.providerId) && !LINKED_IDS.includes(entry.providerId) || hasQuotaData(entry));
    // 省略计数按**家**（providerId）去重：多账户的 Command Code 有 N 个未配置账户时报「另有 N 家」是错的。
    const omitted = new Set(value.providers.filter(entry => !kept.includes(entry)).map(entry => entry.providerId)).size;
    return omitted ? { ...value, providers: kept, omitted } : { ...value, providers: kept };
   }
  }));
 });
}
// IDS / PROVIDERS 仅供双端契约测试（test-contract.mjs）核对 Client 的 PROVIDER_META/PROVIDER_ORDER，
// 防止新增厂商只改一端：漏改 Host 药丸取不到数、漏改 Client 则设置页与药丸缺项，且都不会报错。
export { apply, inject, name, IDS, PROVIDERS, formatQuotaText, LINKED_PROVIDERS, CLIENT_FETCH_VIA };
export default { name, inject, apply };
