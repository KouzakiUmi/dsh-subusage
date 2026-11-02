// Our Free Model 2.7.1 / Channel Pack 的只读 usage.badge 契约。
// 只消费提供方返回的额度，不解析其凭据或启动其登录、刷新、签到流程。
export const OFM_CHANNELS = Object.freeze({
 raccoon: "小浣熊", loomy: "Loomy", qoder: "Qoder", qodercn: "Qoder 中国版",
 lobsterai: "LobsterAI", trae: "TRAE", cline: "Cline", minimax: "MiniMax Code", zcode: "ZCode", gemini: "Gemini"
});
export const OFM_IDS = Object.keys(OFM_CHANNELS).map(id => `ofm-${id}`);
const numeric = value => typeof value === "number" && Number.isFinite(value);
const text = value => typeof value === "string" ? value.replace(/[\x00-\x1f\x7f]/g, " ").slice(0, 120) : "";
const stamp = value => numeric(value) && value > 0 && value <= 8.64e15 ? new Date(value).toISOString() : undefined;

/** 使用宿主公开的进程内 Fetch 分发，Request 只带固定的只读 RPC。 */
export class OfmReader {
 constructor(ctx) { this.ctx = ctx; this.pending = new Map(); this.sequence = 0; this.disposed = false; }
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
  if (this.pending.has(provider)) return this.pending.get(provider);
  const task = this.request(provider, force, signal).finally(() => { if (this.pending.get(provider) === task) this.pending.delete(provider); });
  this.pending.set(provider, task);
  return task;
 }
 async request(provider, force, signal) {
  const rpcId = `subusage-ofm-${++this.sequence}`;
  const request = new Request("http://localhost/api/channel-pack", {
   method: "POST", headers: { "content-type": "application/json" }, signal,
   body: JSON.stringify({ type: "client-request", rpcId, method: "channel-pack", payload: { method: "usage.badge", payload: { provider, force: force === true } } })
  });
  let response;
  try { response = await this.handler.fetch(request, this.peer); }
  catch { throw new Error("OFM 额度接口读取失败"); }
  if (response.status === 404) return undefined;
  if (!response.ok) throw new Error(`OFM 额度接口返回 HTTP ${response.status}`);
  let message;
  try { message = await response.json(); } catch { throw new Error("OFM 额度接口未返回 JSON"); }
  if (message?.type !== "server-response" || message.rpcId !== rpcId) throw new Error("OFM 额度响应与请求不匹配");
  if (message.result?.ok !== true) throw new Error("OFM 暂未提供该渠道的 usage.badge 读数；请检查提供方版本和登录状态");
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
 if (!snapshot.accounts.length) return null;
 const checkedAt = stamp(snapshot.generatedAt);
 const fresh = !!checkedAt && snapshot.generatedAt <= now + 60000 && now - snapshot.generatedAt <= 180000;
 const accounts = snapshot.accounts.map((row, index) => {
  const account = text(row?.nickname) || `账号 ${index + 1}`;
   const base = { providerId, label: `${label} · OFM`, account, windows: [], extras: [], coverage: "complete", freshness: fresh ? "fresh" : "stale" };
  const balance = row?.balance;
  const hasBalance = !!balance && numeric(balance.total) && Array.isArray(balance.packages);
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
  const packages = hasBalance ? balance.packages.filter(pkg => pkg?.active === true && numeric(pkg.remaining)) : [];
  const units = [...new Set(packages.map(pkg => text(pkg.unit)).filter(Boolean))];
  const extras = [];
  // Gemini 的 total 是百分比相加，ZCode 的 total 可能含多个模型池；两者只展示分桶。
  if (hasBalance && !["gemini", "zcode"].includes(provider) && units.length === 1) extras.push({ kind: "balance", value: `${balance.total} ${units[0]}` });
  for (const pkg of packages) {
   const name = text(pkg.name) || "额度", unit = text(pkg.unit);
   const hasCapacity = ["qoder", "qodercn", "zcode", "gemini"].includes(provider) && numeric(pkg.total) && pkg.total > 0 && pkg.remaining >= 0 && pkg.remaining <= pkg.total;
   if (hasCapacity) {
    const percent = Math.round((1 - pkg.remaining / pkg.total) * 1000) / 10;
     windows.push({ kind: "period", percent, status: percent >= 100 ? "rate-limited" : "ok", groupLabel: name, detail: { used: Math.max(0, pkg.total - pkg.remaining), limit: pkg.total, unit } });
   } else extras.push({ kind: "note", value: `${name}：${pkg.remaining} ${unit}`.trim() });
   if (typeof pkg.expiredTime === "string" && pkg.expiredTime) extras.push({ kind: "note", value: `${name} 到期：${text(pkg.expiredTime)}` });
  }
  if (numeric(balance?.expiredTotal) && balance.expiredTotal > 0) extras.push({ kind: "note", value: `已过期额度：${balance.expiredTotal}${units.length === 1 ? " " + units[0] : ""}` });
   return { ...base, state: "ok", windows, extras, ...(checkedAt ? { lastSuccessAt: checkedAt } : {}), ...(!hasBalance || row.error || expectsQuota && (!quota || quota.ok !== true) ? { coverage: "partial", error: "OFM 返回了部分额度数据" } : {}) };
 });
 const successful = accounts.filter(a => a.state === "ok");
 if (accounts.length === 1) return { ...accounts[0], ofmAccounts: accounts };
 return {
  providerId, label: `${label} · OFM`, state: successful.length ? "ok" : "error", windows: [], extras: [],
   coverage: accounts.every(a => a.state === "ok" && a.coverage === "complete") ? "complete" : "partial", freshness: successful.length ? fresh ? "fresh" : "stale" : "unknown",
   ...(successful.length && checkedAt ? { lastSuccessAt: checkedAt } : {}), ofmAccounts: accounts,
  ...(!successful.length ? { error: "OFM 未能读取已启用账号的额度" } : {})
 };
}
