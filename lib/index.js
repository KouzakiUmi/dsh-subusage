// dsh-subusage Host：秘密仅保存在 Host，远端只暴露 provider 补丁和公开设置。
import { RemoteError, TypertRemoteService } from "@deepseek-ai/dsh-typert-protocol";
import { credentialRef } from "@deepseek-ai/dsh-credentials";
import { launchEnvironmentOf } from "@deepseek-ai/dsh-launch-environment";
import { chmodSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { MimoLogin } from "./mimo-login.js";

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
 "minimax": { label: "MiniMax", envName: "MINIMAX_API_KEY", usageUrl: "https://api.minimax.io/v1/token_plan/remains" },
 "minimax-cn": { label: "MiniMax CN", envName: "MINIMAX_CN_API_KEY", usageUrl: "https://api.minimaxi.com/v1/token_plan/remains" },
 // Commandcode 路由由另一个插件（@mars-sea/dsh-commandcode-provider）注册：凭据、多账户与
 // API 地址都在那边管理。本插件不保存其凭据，只沿用同一凭据来源链自取 Key 后直连计费接口。
 "commandcode": { label: "Command Code", envName: "COMMANDCODE_API_KEY", managedByPlugin: true }
};
const IDS = Object.keys(PROVIDERS);
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
 return { zai: { type: 1, organization: "", project: "" }, xiaomi: { cookie: "", loginAt: 0, expiresAt: 0 }, keys: {}, keyModes: Object.fromEntries(IDS.map(id => [id, "inherit"])), visibility: { hideWithoutApi: true, providers: Object.fromEntries(IDS.map(id => [id, PROVIDERS[id].defaultEnabled !== false])) } };
}
function parseStored(value) {
 const s = defaultSettings();
 if (!value || typeof value !== "object" || Array.isArray(value)) throw failure("subusage/config", "设置文件结构无效");
 if (value.zai && typeof value.zai === "object") s.zai = { type: value.zai.type === 2 ? 2 : 1, organization: typeof value.zai.organization === "string" ? value.zai.organization : "", project: typeof value.zai.project === "string" ? value.zai.project : "" };
 if (value.xiaomi && typeof value.xiaomi === "object") { if (typeof value.xiaomi.cookie === "string") s.xiaomi.cookie = value.xiaomi.cookie; for (const field of ["loginAt", "expiresAt"]) if (Number.isSafeInteger(value.xiaomi[field]) && value.xiaomi[field] > 0) s.xiaomi[field] = value.xiaomi[field]; }
 if (typeof value.visibility?.hideWithoutApi === "boolean") s.visibility.hideWithoutApi = value.visibility.hideWithoutApi;
 for (const id of IDS) {
  if (typeof value.visibility?.providers?.[id] === "boolean") s.visibility.providers[id] = value.visibility.providers[id];
  if (PROVIDERS[id].managedByPlugin) continue;
   if (typeof value.keys?.[id] === "string") s.keys[id] = value.keys[id];
  if (value.keyModes?.[id] === "manual") s.keyModes[id] = "manual";
 }
 return s;
}
function publicSettings(s) {
 return { revision: hash(s), zai: { ...s.zai }, xiaomi: { hasCookie: !!s.xiaomi.cookie.trim(), loginAt: isoStamp(s.xiaomi.loginAt), expiresAt: isoStamp(s.xiaomi.expiresAt) }, hasKeys: Object.fromEntries(IDS.map(id => [id, !!s.keys[id]?.trim()])), keyModes: { ...s.keyModes }, visibility: { hideWithoutApi: s.visibility.hideWithoutApi, providers: { ...s.visibility.providers } } };
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
  if (Object.keys(v).some(k => !["providers", "hideWithoutApi"].includes(k)) || !Object.keys(v).length) throw invalid("Invalid visibility fields");
  const visibility = {};
  if (v.hideWithoutApi !== undefined) { if (typeof v.hideWithoutApi !== "boolean") throw invalid("Invalid auto-hide switch"); visibility.hideWithoutApi = v.hideWithoutApi; }
  if (v.providers !== undefined) {
   if (!v.providers || typeof v.providers !== "object" || Array.isArray(v.providers) || !Object.keys(v.providers).length || Object.entries(v.providers).some(([id, enabled]) => !IDS.includes(id) || typeof enabled !== "boolean")) throw invalid("Invalid provider switches");
   visibility.providers = { ...v.providers };
  }
  return { expectedRevision: value.expectedRevision, visibility };
 }
 if (!value || typeof value !== "object" || !IDS.includes(value.providerId)) throw invalid("Invalid provider patch");
 const out = { providerId: value.providerId };
 if (value.expectedRevision !== undefined) { if (typeof value.expectedRevision !== "string") throw invalid("Invalid revision"); out.expectedRevision = value.expectedRevision; }
 if (value.keyMode !== undefined) { if (!["inherit", "manual"].includes(value.keyMode)) throw invalid("Invalid key mode"); out.keyMode = value.keyMode; }
 for (const field of ["keyUpdate", "cookieUpdate"]) if (value[field] !== undefined) out[field] = parseUpdate(value[field]);
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
 return out;
}
function parseQuery(value) {
 if (!value || !Array.isArray(value.providerIds) || value.providerIds.some(id => !IDS.includes(id)) || typeof value.force !== "boolean") throw invalid("Invalid refresh request");
 return { providerIds: [...new Set(value.providerIds)], force: value.force };
}
function failure(code, message, retryable = false, retryAfterMs) {
 return new RemoteError(code, message, { retryable, retainPrevious: retryable, ...(retryAfterMs !== undefined ? { retryAfterMs } : {}) });
}
async function fetchJson(fetcher, url, headers, lifetimeSignal) {
 let response;
 try { response = await fetcher(url, { headers: { accept: "application/json", "user-agent": "dsh-subusage/0.8.1", ...headers }, signal: lifetimeSignal ? AbortSignal.any([AbortSignal.timeout(10000), lifetimeSignal]) : AbortSignal.timeout(10000), redirect: "manual" }); }
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
 // 已知旧版 usages 和新版 usage/limits 的显式命名窗口；不推断未知字段。
 const u = body?.usages ?? body?.usage ?? body?.limits;
 if (!u || !u.limit_5h || !u.limit_7d) throw failure("subusage/response", "Invalid Kimi usage response");
 return cascadeRateLimited(["5h", "7d"].map(kind => { const row = u[`limit_${kind}`]; if (!numeric(row.used_ratio)) throw failure("subusage/response", "Invalid Kimi used_ratio"); return windowRow(kind, row.used_ratio * 100, row.reset_time); }));
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
export function normalizeNanoGpt(body) {
 if (typeof body?.active !== "boolean" || !["active", "grace", "inactive"].includes(body.state)) throw failure("subusage/response", "Invalid NanoGPT subscription response");
 const windows = []; let partial = false;
 if (body.active && body.state !== "inactive") for (const [field, kind, limit] of [["dailyInputTokens", "day", body.limits?.dailyInputTokens], ["weeklyInputTokens", "week", body.limits?.weeklyInputTokens], ["tokens", "period", body.tokenLimits?.total]]) {
  const row = body[field];
  if (row == null && limit == null) continue;
  if (row?.degraded === true || !numeric(row?.percentUsed) || !numeric(limit) || limit <= 0 || !numeric(row?.used)) { partial = true; continue; }
  const reset = numeric(row.resetAt) && Number.isFinite(new Date(row.resetAt).getTime()) ? new Date(row.resetAt).toISOString() : undefined;
  windows.push(windowRow(kind, row.percentUsed * 100, reset, undefined, { used: row.used, limit, unit: "tokens" }));
 }
 return { windows: cascadeRateLimited(windows), extras: [{ kind: "plan", value: body.state }], coverage: windows.length && !partial ? "complete" : "partial" };
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
function detectConfigured(ctx) {
 try { const ids = new Set(ctx.llm.listProviders().map(p => p.id)); return Object.fromEntries(IDS.map(id => [id, ids.has(id)])); }
 catch { return Object.fromEntries(IDS.map(id => [id, false])); }
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
  { id: `${name}#subUsage/read`, service: "subUsage", namespace: "subUsage", method: "read", invocation: { kind: "direct" }, parameters: [], result: resultCodec },
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
  this.authFile = options.resolveAuthFile ?? (async () => commandCodeAuthFileKey(this.io));
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
 async identity(id, s) {
  if (id === "xiaomi-token-plan-cn") return { key: s.xiaomi.cookie.trim(), source: s.xiaomi.cookie.trim() ? "cookie" : "none" };
  if (!PROVIDERS[id].managedByPlugin && s.keyModes[id] === "manual") return { key: s.keys[id]?.trim(), source: s.keys[id]?.trim() ? "manual" : "none" };
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
 async fetchProvider(id, identity, settings, signal = this.controller.signal) {
  const get = (url, headers) => fetchJson(this.fetcher, url, headers, signal);
  const headers = { authorization: `Bearer ${identity.key}` };
  if (id === "synthetic") return normalizeSynthetic(await get("https://api.synthetic.new/v2/quotas", headers));
  if (id === "nanogpt") return normalizeNanoGpt(await get(identity.key.startsWith("sk-nano-mgmt-") ? "https://nano-gpt.com/api/management/v1/subscription/usage" : "https://api.nano-gpt.com/api/subscription/v1/usage", headers));
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
  const base = "https://platform.xiaomimimo.com/api/v1";
  const h = { cookie: identity.key, origin: "https://platform.xiaomimimo.com", referer: "https://platform.xiaomimimo.com/#/console/balance", "x-timezone": "UTC+08:00" };
  let usageError;
  const [bal, detail, usage] = await Promise.all([get(`${base}/balance`, h), get(`${base}/tokenPlan/detail`, h).catch(e => { if (e.code === "subusage/auth") throw e; return undefined; }), get(`${base}/tokenPlan/usage`, h).catch(e => { if (e.code === "subusage/auth") throw e; usageError = e; return undefined; })]);
  // 普通刷新与登录验证都经过这里：服务端字段不可信，缓存前去除 Cookie 回显。
   const data = redactMimo(normalizeMimo(bal, detail, usage), identity.key);
  if (usageError) data.usageError = usageError;
  return data;
 }
 base(id, source, settings) {
  // MiMo 会话 Cookie 自签发起 24 小时有效；到期时间随每条 entry 下发，供药丸与设置页倒计时。
  const expiresAt = id === "xiaomi-token-plan-cn" ? isoStamp(settings?.xiaomi?.expiresAt) : null;
  return { providerId: id, label: PROVIDERS[id].label, envName: PROVIDERS[id].envName, keySource: source, apiDetected: source === "none" ? null : true, coverage: "partial", freshness: "unknown", lastSuccessAt: null, lastAttemptAt: new Date(this.now()).toISOString(), retryable: false, retainPrevious: false, ...(expiresAt ? { cookieExpiresAt: expiresAt } : {}) };
 }
 async provider(id, settings, force) {
  const startedGeneration = this.generations.get(id) ?? 0;
  let identity;
  try { identity = await this.identity(id, settings); }
  catch { this.cache.delete(id); return { ...this.base(id, "none", settings), state: "error", errorCode: "subusage/credentials", error: "无法解析凭据" }; }
  if (this.disposed) throw failure("subusage/disposed", "服务已卸载");
  if (startedGeneration !== (this.generations.get(id) ?? 0)) return this.provider(id, this.load(), force);
  if (!settings.visibility.providers[id]) {
   this.cache.delete(id); this.inflight.delete(id);
   return { ...this.base(id, identity.source, settings), state: "disabled", apiDetected: !!identity.key, windows: [], extras: [] };
  }
  const fingerprint = hash([identity.key ?? "", identity.source, settings.keyModes[id], id === "zai-coding-cn" ? settings.zai : null]);
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
   const base = this.base(id, identity.source, settings); let entry; let retryAt = 0; let failures = previous?.failures ?? 0;
   if (!identity.key) entry = { ...base, apiDetected: false, state: id === "xiaomi-token-plan-cn" ? "no-cookie" : "no-key", error: id === "xiaomi-token-plan-cn" ? "需登录或粘贴 Cookie" : id === "commandcode" ? "未检测到 Key：可在 设置 → Command Code 登录、运行 cmd login，或使用 COMMANDCODE_API_KEY（凭据服务/启动环境）" : "未配置 API Key", errorCode: "subusage/no-key" };
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
   if (this.disposed || generation !== (this.generations.get(id) ?? 0)) return { ...this.base(id, "none", settings), state: "error", errorCode: "subusage/config-changed", error: "读取期间配置已改变，请刷新" };
   return entry;
  })();
  this.inflight.set(id, { fingerprint, generation, promise });
  try { return await promise; } finally { if (this.inflight.get(id)?.promise === promise) this.inflight.delete(id); }
 }
 async read() { return this.refresh({ providerIds: IDS, force: false }); }
 async refresh(request) {
  if (this.disposed) throw failure("subusage/disposed", "服务已卸载");
  const query = parseQuery(request); const settings = this.load();
  const entries = await Promise.all(query.providerIds.map(id => this.provider(id, settings, query.force).catch(() => ({ ...this.base(id, "none", settings), state: "error", errorCode: "subusage/internal", error: "读取用量失败" }))));
  const latest = this.load();
  if (hash(latest) !== hash(settings)) return this.result(latest, query.providerIds.map(id => ({ ...this.base(id, "none", latest), state: "error", errorCode: "subusage/config-changed", error: "读取期间配置已改变，请刷新" })));
  return this.result(latest, entries);
 }
 startMimoLogin(request) { return this.login.start(parseLoginStart(request)); }
 getMimoLoginStatus() { return this.login.status(); }
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
  const fingerprint = hash([cookie, "cookie", stored.keyModes[id], null]);
  this.fingerprints.set(id, fingerprint); this.cache.set(id, { fingerprint, entry: safeEntry, at: this.now(), retryAt: usageError ? this.now() + 15000 : 0, failures: 0 });
  this.loginResultMaterial = this.mimoMaterial(stored);
  return this.result(stored, [safeEntry]);
 }
 async save(settings) { return this.persist(settings); }
 persist(settings, cookieCap) {
  if (this.disposed) throw failure("subusage/disposed", "服务已卸载");
  const patch = parseSettings(settings); const stored = this.load();
  if (patch.expectedRevision !== undefined && patch.expectedRevision !== hash(stored)) throw failure("subusage/revision-conflict", "设置已被其他窗口修改，请重新读取");
  const id = patch.providerId;
  const affected = patch.visibility ? Object.keys(patch.visibility.providers ?? {}).filter(key => stored.visibility.providers[key] !== patch.visibility.providers[key]) : [id];
  if (patch.visibility) {
   if (patch.visibility.hideWithoutApi !== undefined) stored.visibility.hideWithoutApi = patch.visibility.hideWithoutApi;
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
function apply(ctx) { registerRemotes(ctx); ctx.plugin(SubUsageService, {}); ctx.logger.info("dsh-subusage: usage service ready"); }
export { apply, inject, name };
export default { name, inject, apply };
