// Our Free Model 2.7.1 / Channel Pack 的只读 usage.badge 契约。
// 复用提供方的额度与账号索引；凭据检查只返回存在性，不导出原值或启动登录/刷新/签到。
import { summarizeCreditPackages } from './credit-packages.js';
export const OFM_CHANNELS = Object.freeze({
 raccoon: "小浣熊", loomy: "Loomy", qoder: "Qoder", qodercn: "Qoder 中国版",
 lobsterai: "LobsterAI", trae: "TRAE", cline: "Cline", minimax: "MiniMax Code", zcode: "ZCode", gemini: "Gemini"
});
export const OFM_IDS = Object.keys(OFM_CHANNELS).map(id => `ofm-${id}`);
const numeric = value => typeof value === "number" && Number.isFinite(value);
const text = value => typeof value === "string" ? value.replace(/[\x00-\x1f\x7f]/g, " ").slice(0, 120) : "";
/** 只归一化已知的同义单位；其它单位原样保留，绝不把 token / 积分 / 美元互相折算。 */
const displayUnit = value => {
 const unit = text(value).trim();
 return /^credits?$/i.test(unit) ? "credits" : /^tokens?$/i.test(unit) ? "token" : unit;
};
const accountLabel = value => { const name = text(value), at = name.indexOf("@"); return at > 0 ? `${name[0]}***@${name.slice(at + 1)}` : /^\+?\d{7,}$/.test(name) ? `${name.slice(0, 3)}***${name.slice(-2)}` : name; };
const stamp = value => numeric(value) && value > 0 && value <= 8.64e15 ? new Date(value).toISOString() : undefined;

/** 使用宿主公开的进程内 Fetch 分发，Request 只带固定的只读 RPC。 */
export class OfmReader {
 constructor(ctx, { inspectCredential } = {}) { this.ctx = ctx; this.inspectCredential = inspectCredential; this.pending = new Map(); this.sequence = 0; this.disposed = false; }
 async read(provider, force, signal) {
  if (this.disposed) throw new Error("OFM reader 已卸载");
  if (!Object.hasOwn(OFM_CHANNELS, provider)) throw new Error("未知 OFM 渠道");
  const connection = this.ctx.get?.("connection", false);
  if (!connection || typeof connection.createPeer !== "function" || typeof connection.createSharedFetchHandler !== "function") return undefined;
  if (this.connection !== connection) {
   const previous = this.peer;
   this.connection = connection;
   this.peer = connection.createPeer({ principal: { kind: "owner" } });
   this.handler = connection.createSharedFetchHandler("/api");
   this.pending.clear();
   if (previous) await previous.dispose();
  }
  if (force !== true && this.pending.has(provider)) return this.pending.get(provider);
  const task = this.readAccounts(provider, force, signal).finally(() => { if (this.pending.get(provider) === task) this.pending.delete(provider); });
  this.pending.set(provider, task);
  return task;
 }
 async readAccounts(provider, force, signal) {
  let metadataFailed = false;
  const [snapshot, index] = await Promise.all([
   this.request(provider, force, signal),
   this.request(provider, false, signal, "account.list").catch(() => { metadataFailed = true; return undefined; })
  ]);
  if (!snapshot) return snapshot;
  if (metadataFailed) return { ...snapshot, accountMetadataFailed: true };
  if (index === undefined) return snapshot;
  if (!Array.isArray(index?.accounts) || index.accounts.some(row => typeof row?.id !== "string" || !row.id || row.provider !== provider)) return { ...snapshot, accountMetadataFailed: true };
  const metadata = [];
  for (const row of index.accounts) {
   let authStatus = "unknown";
   if (this.inspectCredential && typeof row.credentialRef === "string" && /^[A-Za-z_][A-Za-z0-9_]{0,127}$/.test(row.credentialRef)) {
    try { const status = await this.inspectCredential(row.credentialRef); if (["present", "missing"].includes(status)) authStatus = status; } catch { /* 元数据失败不能丢弃独立成功的额度。 */ }
   }
   // account.list 的 ZCode 分支还含 phone 等个人信息；这里只挑选明确允许的字段。
   metadata.push({ id: row.id, nickname: text(row.nickname), enabled: row.enabled !== false, authStatus, ...(stamp(row.expiresAt) ? { authExpiresAt: stamp(row.expiresAt) } : {}) });
  }
  return { ...snapshot, accountMetadata: metadata };
 }
 async request(provider, force, signal, method = "usage.badge") {
  const rpcId = `subusage-ofm-${++this.sequence}`;
  const request = new Request("http://localhost/api/channel-pack", {
   method: "POST", headers: { "content-type": "application/json" }, signal,
   body: JSON.stringify({ type: "client-request", rpcId, method: "channel-pack", payload: { method, payload: method === "usage.badge" ? { provider, force: force === true } : { provider } } })
  });
  let response;
  try { response = await this.handler.fetch(request, this.peer); }
  catch { throw new Error("OFM 额度接口读取失败"); }
  if (response.status === 404) return undefined;
  if (!response.ok) throw new Error(`OFM 额度接口返回 HTTP ${response.status}`);
  let message;
  try { message = await response.json(); } catch { throw new Error("OFM 额度接口未返回 JSON"); }
  if (message?.type !== "server-response" || message.rpcId !== rpcId) throw new Error("OFM 额度响应与请求不匹配");
  if (message.result?.ok !== true) throw new Error("OFM 暂未提供该渠道的只读账号或额度读数；请检查提供方版本和登录状态");
   if (method === "account.list" && message.result.value === undefined) throw new Error("OFM 账号索引响应形状不匹配");
  return message.result.value;
 }
 dispose() {
  this.disposed = true;
  this.pending.clear();
  const peer = this.peer; this.peer = undefined;
  return peer?.dispose();
 }
}

/** 每个账号独立归一化，余额不跨账号累加，包到期日不冒充窗口重置。 */
export function normalizeOfm(snapshot, providerId, now = Date.now()) {
 const provider = providerId.slice(4), label = OFM_CHANNELS[provider];
 if (!label || !snapshot || snapshot.provider !== provider || !Array.isArray(snapshot.accounts)) throw new Error("OFM 额度响应形状不匹配");
 const metadata = Array.isArray(snapshot.accountMetadata) ? snapshot.accountMetadata : undefined;
 const metaById = new Map((metadata || []).map(row => [row.id, row]));
 const quotaById = new Map(snapshot.accounts.filter(row => typeof row?.accountId === "string").map(row => [row.accountId, row]));
 // 新索引优先，避免缓存徽标让已删除/停用账号继续显示有效额度；新账号没有旧额度可借用。
 const rows = metadata ? metadata.map(meta => ({ ...quotaById.get(meta.id), accountId: meta.id, nickname: meta.nickname || quotaById.get(meta.id)?.nickname })) : snapshot.accounts;
 if (!rows.length) return null;
 const checkedAt = stamp(snapshot.generatedAt);
 const fresh = !!checkedAt && snapshot.generatedAt <= now + 60000 && now - snapshot.generatedAt <= 180000;
 const seen = new Set();
 const accounts = rows.filter(row => {
  if (typeof row?.accountId !== "string" || !row.accountId) return true;
  if (seen.has(row.accountId)) return false;
  seen.add(row.accountId); return true;
 }).map((row, index) => {
  const meta = metaById.get(row?.accountId);
   const account = accountLabel(row?.nickname) || `账号 ${index + 1}`;
   const base = { providerId, label: `${label} · OFM`, account, ...(typeof row?.accountId === "string" && row.accountId ? { accountId: row.accountId } : {}), ...(meta ? { accountEnabled: meta.enabled, authStatus: ["present", "missing"].includes(meta.authStatus) ? meta.authStatus : "unknown", ...(typeof meta.authExpiresAt === "string" ? { authExpiresAt: meta.authExpiresAt } : {}) } : { authStatus: "unknown" }), windows: [], extras: [], coverage: "complete", freshness: fresh ? "fresh" : "stale" };
  if (meta?.enabled === false) return { ...base, state: "disabled", freshness: "unknown" };
  const balance = row?.balance;
  // Gemini / ZCode 的 total 可能跨模型池，必须仍有分桶才算可展示额度。
  const hasBalance = !!balance && numeric(balance.total) && (!["gemini", "zcode"].includes(provider) || Array.isArray(balance.packages));
  const balancePackages = Array.isArray(balance?.packages) ? balance.packages : [];
   const expectsQuota = snapshot.subscription?.kind === "windows";
   const quota = expectsQuota && typeof row?.accountId === "string" && Array.isArray(snapshot.subscription.accounts)
    ? snapshot.subscription.accounts.find(item => item?.accountId === row.accountId) : undefined;
  const windows = [];
  if (quota?.ok === true && Array.isArray(quota.windows)) for (const window of quota.windows) {
   if (!numeric(window?.percentUsed) || window.percentUsed < 0 || window.percentUsed > 100 || !text(window.type)) continue;
   const kind = ({ "5h": "5h", daily: "day", day: "day", weekly: "week", week: "week", monthly: "month", month: "month" })[window.type] ?? "period";
   const resetsAt = typeof window.resetsAt === "string" && window.resetsAt.trim() && Number.isFinite(Date.parse(window.resetsAt)) ? new Date(window.resetsAt).toISOString() : undefined;
   windows.push({ kind, percent: window.percentUsed, status: window.percentUsed >= 100 ? "rate-limited" : "ok", groupLabel: text(window.type), ...(resetsAt ? { resetsAt } : {}) });
  }
  if (!hasBalance && !windows.length) return { ...base, state: "error", coverage: "partial", freshness: "unknown", error: "OFM 未能读取此账号额度，请在提供方检查登录状态" };
  const packageRows = hasBalance ? balancePackages.filter(pkg => pkg?.active === true && numeric(pkg.remaining)).map(pkg => ({
   ...pkg,
   unit: displayUnit(pkg.unit),
   expiresAt: typeof pkg.expiredTime === 'string' && Number.isFinite(Date.parse(pkg.expiredTime)) ? Date.parse(pkg.expiredTime) : undefined,
  })) : [];
  const packages = summarizeCreditPackages(packageRows, now).packages;
  // credit / credits 是同一单位，不能因此把可用的 total 隐藏。有效包没写单位时才参考完整包列表；
  // 一个单位也没有时仍如实显示 total 数字，不编造 credits。
  const activeUnits = packageRows.map(pkg => pkg.unit).filter(Boolean);
  const allUnits = hasBalance ? balancePackages.map(pkg => displayUnit(pkg?.unit)).filter(Boolean) : [];
  const units = [...new Set(activeUnits.length ? activeUnits : allUnits)];
  const extras = [];
  // Gemini 的 total 是百分比相加，ZCode 的 total 可能含多个模型池；两者只展示分桶。
  if (hasBalance && !["gemini", "zcode"].includes(provider) && units.length <= 1) extras.push({ kind: "balance", value: units.length ? `${balance.total} ${units[0]}` : `${balance.total}` });
  if (hasBalance && balance?.packages === undefined) extras.push({ kind: "note", value: "提供方未报告积分包明细" });
  const notePackages = [], windowPackages = [];
  for (const pkg of packages) {
   const name = text(pkg.name) || "额度", unit = text(pkg.unit);
   const hasCapacity = ["qoder", "qodercn", "zcode", "gemini"].includes(provider) && numeric(pkg.total) && pkg.total > 0 && pkg.remaining >= 0 && pkg.remaining <= pkg.total;
   if (hasCapacity) {
     const percent = pkg.remaining === 0 ? 100 : Math.min(99.9, Math.round((1 - pkg.remaining / pkg.total) * 1000) / 10);
     windows.push({ kind: "period", percent, status: percent >= 100 ? "rate-limited" : "ok", groupLabel: name, detail: { used: Math.max(0, pkg.total - pkg.remaining), limit: pkg.total, unit } });
     windowPackages.push(pkg);
   } else notePackages.push(pkg);
  }
  extras.push(...summarizeCreditPackages(notePackages, now).extras);
  // 已有余量窗口的包只补紧急到期提醒；较远的到期日不再单占一行。
  extras.push(...summarizeCreditPackages(windowPackages, now, { urgentOnly: true }).extras);
  const partial = !hasBalance || balance?.packages !== undefined && !Array.isArray(balance.packages) || row.error || expectsQuota && (!quota || quota.ok !== true);
  return { ...base, state: "ok", windows, extras, ...(checkedAt ? { lastSuccessAt: checkedAt } : {}), ...(partial ? { coverage: "partial", error: "OFM 返回了部分额度数据" } : {}), ...(snapshot.accountMetadataFailed ? { coverage: "partial", error: "OFM 账号索引读取失败，保留已读额度；账号状态待确认" } : {}), ...(meta?.authStatus === "missing" ? { freshness: "stale", coverage: "partial", error: "账号缺少凭据，显示提供方已有读数" } : {}) };
 });
 const enabled = accounts.filter(a => a.state !== "disabled");
 const successful = enabled.filter(a => a.state === "ok");
 if (accounts.length === 1) return { ...accounts[0], ofmAccounts: accounts };
 return {
  providerId, label: `${label} · OFM`, state: !enabled.length ? "disabled" : successful.length ? "ok" : "error", windows: [], extras: [],
   coverage: enabled.every(a => a.state === "ok" && a.coverage === "complete") ? "complete" : "partial", freshness: successful.length ? successful.every(a => a.freshness === "fresh") ? "fresh" : "stale" : "unknown",
   ...(successful.length && checkedAt ? { lastSuccessAt: checkedAt } : {}), ofmAccounts: accounts,
   ...(enabled.length && !successful.length ? { error: "OFM 未能读取已启用账号的额度" } : snapshot.accountMetadataFailed ? { error: "OFM 账号索引读取失败，保留已读额度；账号状态待确认" } : {})
 };
}
