// 独立 Connect 插件的只读、多账号额度桥接。readJson 由 Host 注入；不接触凭据与上游。
import { summarizeCreditPackages } from "./credit-packages.js";
const object = value => !!value && typeof value === "object" && !Array.isArray(value);
const number = value => typeof value === "number" && Number.isFinite(value) && value >= 0;
const text = value => typeof value === "string" ? value.replace(/[\x00-\x1f\x7f]/g, " ").trim().slice(0, 160) : "";
const stamp = value => number(value) && value > 0 && value <= 8.64e15 ? new Date(value).toISOString() : undefined;
const mask = value => { const name = text(value), at = name.indexOf("@"); return at > 0 ? `${name[0]}***@${name.slice(at + 1)}` : name; };
const failure = "未能读取此账号额度，请在提供方检查登录状态";
/**
 * 缺一条上游响应时抛它：宿主把「要哪个 URL」交给页面去取，取回来再重跑一遍。
 * 这是绕过本机 HTTP 鉴权的唯一方式——渲染进程带浏览器凭据，宿主进程没有。
 */
export class MissingLinkedRequest extends Error {
 constructor(endpoint, query) { super(`missing ${endpoint}`); this.name = "MissingLinkedRequest"; this.endpoint = endpoint; this.query = { ...(query || {}) }; }
}
/** 归一化里的降级 catch 不能把「还缺一条响应」当成上游失败吞掉。 */
const passThroughMissing = error => { if (error instanceof MissingLinkedRequest) throw error; };
function overviewError(error) {
 let message = "Connect 用量总览读取失败";
 const code = ["subusage/response", "subusage/transport"].includes(error?.code) ? error.code : undefined;
 if (code === "subusage/response" && /\bJSON\b/.test(String(error.message))) message = "Connect 用量接口没有返回 JSON";
 else if (code === "subusage/transport") {
  const status = String(error.message).match(/\bHTTP\s+([1-5]\d{2})\b/);
  if (status) message = `Connect 用量接口返回 HTTP ${status[1]}`;
 }
 return Object.assign(new Error(message), code ? { code } : {});
}
function pick(source, strings = [], numbers = [], booleans = []) {
 const out = {};
 if (!object(source)) return out;
 for (const key of strings) if (text(source[key])) out[key] = text(source[key]);
 for (const key of numbers) if (number(source[key])) out[key] = source[key];
 for (const key of booleans) if (typeof source[key] === "boolean") out[key] = source[key];
 return out;
}
function accountRow(source) {
 if (!object(source) || !text(source.id)) return undefined;
 return { id: text(source.id), accountName: mask(source.accountName), ...pick(source, ["region", "edition"], ["tokenExpiresAtMs"], ["selected", "enterprise"]) };
}
const poolAccountId = row => text(row?.accountId) || text(row?.id);
function workBuddySelectionConflict(snapshot) {
 return snapshot.plugin === "workbuddy" && !!text(snapshot.accountId) && (Array.isArray(snapshot.accounts) ? snapshot.accounts : []).some(row => row?.selected === true && text(row.id) !== snapshot.accountId);
}
function traeCredits(source) {
 if (!object(source)) return undefined;
 const out = pick(source, [], ["total", "consumed", "available", "workAvailable", "generalAvailable"]);
 if (Array.isArray(source.accounts)) out.accounts = source.accounts.filter(object).map(row => pick(row, ["displayDesc", "endpoint"], ["remain", "size", "expiresAtMs"]));
 if (object(source.expiry)) {
  out.expiry = {};
  for (const key of ["expired", "within24h", "within3d", "within7d"]) if (object(source.expiry[key])) out.expiry[key] = pick(source.expiry[key], [], ["total", "packs", "earliestExpiresAtMs"]);
 }
 return ["total", "consumed", "available", "workAvailable", "generalAvailable"].some(key => number(out[key])) ? out : undefined;
}
function wbCredits(source) {
 if (!object(source) || !number(source.total)) return undefined;
 return { ...pick(source, [], ["total", "expiringSoon", "nearestExpiryMs"]), ...(Array.isArray(source.packages) ? { packages: source.packages.filter(object).map(row => pick(row, ["packageName"], ["remain", "size", "cycleRefreshMs", "expiresAtMs"], ["monthly"])) } : {}) };
}
function payStatus(source) {
 if (!object(source)) return undefined;
 const out = pick(source, ["payIdentityStr"], ["trialEndTimeMs"], ["inTrial", "hasPackage"]);
 return Object.keys(out).length ? out : undefined;
}
function quotaFields(source, plugin, region) {
 const out = {};
 if (plugin === "trae" && region === "enterprise") return { creditsUnavailable: "enterprise" };
 if (plugin === "trae" && region === "ai") {
  const pay = payStatus(source?.payStatus);
  if (pay) out.payStatus = pay;
 } else {
  const credits = plugin === "trae" ? traeCredits(source?.credits) : wbCredits(source?.credits);
  if (credits) out.credits = credits;
 }
 if (plugin === "trae" && object(source?.checkin)) out.checkin = pick(source.checkin, [], ["credits", "extraCredits"], ["checkedIn", "didCheckedIn", "enabled"]);
 return out;
}
function overview(source, plugin, region) {
 if (!object(source) || !["signed-in", "signed-out", "error"].includes(source.status)) throw new Error("Connect 额度响应形状不匹配");
 const out = { status: source.status, plugin, region, ...pick(source, ["accountId"], ["tokenExpiresAtMs"], ["selectionExplicit"]), accountName: mask(source.accountName), accounts: [] };
 const seen = new Set();
 for (const raw of Array.isArray(source.accounts) ? source.accounts : []) {
  const row = accountRow(raw);
  if (row && !seen.has(row.id)) { out.accounts.push(row); seen.add(row.id); }
 }
 // 旧版/空索引仍可能携带有效的当前账号读数；按 ID 补齐，不按名称合并。
 if (out.accountId && !seen.has(out.accountId)) out.accounts.push({ id: out.accountId, accountName: out.accountName, ...pick(out, [], ["tokenExpiresAtMs"]) });
 const current = out.accounts.find(row => row.id === out.accountId);
 if (current && !workBuddySelectionConflict(out)) {
  if (!current.accountName) current.accountName = out.accountName;
  if (!number(current.tokenExpiresAtMs) && number(out.tokenExpiresAtMs)) current.tokenExpiresAtMs = out.tokenExpiresAtMs;
 }
 if (object(source.pool)) out.pool = { ...pick(source.pool, [], [], ["enabled"]), accounts: (Array.isArray(source.pool.accounts) ? source.pool.accounts : []).filter(row => object(row) && poolAccountId(row)).map(row => ({ id: poolAccountId(row), ...pick(row, [], [], ["current"]) })) };
 if (source.refreshError) out.refreshFailed = true;
 Object.assign(out, quotaFields(source, plugin, region));
 // 当前账号 ID 与明确选中索引冲突时，完整包归属无法确认；只用逐 ID 总余额。
 if (workBuddySelectionConflict(out)) delete out.credits;
 return out;
}
function hasQuota(row, plugin, region) { return plugin === "trae" && region === "ai" ? !!row.payStatus : object(row.credits) || number(row.credits); }

/** 元数据只描述登录记录有效期，不表示对上游完成实时鉴权验证。 */
export function accountMetadata(account, snapshot = {}, now = Date.now()) {
 const id = text(account?.id ?? account?.accountId), expires = stamp(account?.tokenExpiresAtMs);
 const out = { ...(id ? { accountId: id } : {}), account: mask(account?.accountName) || "账号", authStatus: expires ? account.tokenExpiresAtMs > now ? "present" : "expired" : "unknown", ...(expires ? { authExpiresAt: expires } : {}) };
 if (snapshot.pool?.enabled === true) {
  out.accountMode = "auto";
   const currents = (Array.isArray(snapshot.pool.accounts) ? snapshot.pool.accounts : []).filter(row => row?.current === true && poolAccountId(row));
   if (currents.length === 1 && id) out.accountActive = poolAccountId(currents[0]) === id;
 } else if (snapshot.pool?.enabled === false) {
  if (snapshot.plugin === "workbuddy" && snapshot.selectionExplicit === true) out.accountMode = "fixed";
   if ((snapshot.plugin === "trae" || snapshot.plugin === "workbuddy") && !workBuddySelectionConflict(snapshot) && text(snapshot.accountId) && id) out.accountActive = snapshot.accountId === id;
 }
 return out;
}

export class ConnectUsageReader {
 constructor({ readJson, now = Date.now } = {}) {
  if (typeof readJson !== "function" || typeof now !== "function") throw new TypeError("ConnectUsageReader 需要 readJson 与 now 函数");
  this.readJson = readJson; this.now = now; this.cache = new Map(); this.pending = new Map(); this.versions = new Map(); this.disposed = false;
 }
 readTrae(panel, force = false) { return this.read("trae", panel, force); }
 readWorkBuddy(region, force = false) { return this.read("workbuddy", region, force); }
 async read(plugin, region, force) {
  if (this.disposed) throw new Error("Connect reader 已卸载");
  if (!(plugin === "trae" ? ["cn", "ai", "enterprise"] : ["cn", "global"]).includes(region)) throw new Error("未知 Connect 地区");
  const key = `${plugin}:${region}`, cached = this.cache.get(key), time = this.now();
  if (!force && this.pending.has(key)) return this.pending.get(key);
  if (!force && cached && time >= cached.at && time - cached.at < 60000) return structuredClone(cached.value);
  const version = (this.versions.get(key) || 0) + 1; this.versions.set(key, version);
  const task = this.readAccounts(plugin, region).then(value => {
   if (!this.disposed && this.versions.get(key) === version) {
    if (value === undefined) this.cache.delete(key);
    else this.cache.set(key, { at: this.now(), value: structuredClone(value) });
   }
   return value;
  }).finally(() => { if (this.pending.get(key) === task) this.pending.delete(key); });
  this.pending.set(key, task);
  return task;
 }
 /**
  * @param readJson - 数据源。默认打本机路由；页面代取时换成「查表，缺的表项抛 MissingLinkedRequest」。
  */
 async readAccounts(plugin, region, readJson = this.readJson) {
  let raw;
  try { raw = await readJson(plugin, "usage", { region }); } catch (error) { passThroughMissing(error); throw overviewError(error); }
  // undefined 表示插件缺席，与损坏/失败响应分别处理。
  if (raw === undefined) return undefined;
  const snapshot = overview(raw, plugin, region);
  const rows = snapshot.accounts.map(row => ({ ...row }));
  if (snapshot.status !== "signed-in") return { ...snapshot, generatedAt: this.now(), accountReadings: [] };
  if (plugin === "trae" && region === "enterprise") {
   for (const row of rows) row.creditsUnavailable = "enterprise";
  } else if (plugin === "trae" && rows.length > 1) {
   await Promise.all(rows.map(async row => {
    try {
     const status = await readJson(plugin, "account-status", { region, accountId: row.id });
     if (!object(status) || status.id !== row.id) throw new Error("账号不匹配");
     Object.assign(row, quotaFields(status, plugin, region));
    } catch (error) { passThroughMissing(error); row.error = failure; }
    if (!hasQuota(row, plugin, region)) row.error = failure;
   }));
  } else if (plugin === "workbuddy" && rows.length > 1) {
   let credits;
    try { credits = await readJson(plugin, "account-credits", { region }); } catch (error) { passThroughMissing(error); /* 总览所属账号的成功读数仍保留。 */ }
   const byId = new Map((Array.isArray(credits?.accounts) ? credits.accounts : []).filter(row => object(row) && text(row.id)).map(row => [row.id, row]));
   for (const row of rows) {
    if (row.id === snapshot.accountId && snapshot.credits) {
     row.credits = structuredClone(snapshot.credits);
     if (snapshot.refreshFailed) row.refreshFailed = true;
    }
    else if (number(byId.get(row.id)?.credits)) row.credits = byId.get(row.id).credits;
    if (!hasQuota(row, plugin, region)) row.error = failure;
   }
  } else {
   for (const row of rows) {
    if (row.id === snapshot.accountId) {
     Object.assign(row, quotaFields(snapshot, plugin, region));
     if (snapshot.refreshFailed) row.refreshFailed = true;
    }
    if (!hasQuota(row, plugin, region)) row.error = failure;
   }
  }
  return { ...snapshot, generatedAt: this.now(), accountReadings: rows };
 }
 dispose() { this.disposed = true; this.cache.clear(); this.pending.clear(); this.versions.clear(); }
}

/** WorkBuddy：完整包仅属于 usage.accountId，其余账号仅展示独立查询的余额。 */
export function normalizeWorkBuddy(snapshot, providerId = "workbuddy", now = Date.now()) {
 if (!object(snapshot)) throw new Error("WorkBuddy 额度响应形状不匹配");
 if (snapshot.status === "signed-out") return null;
 if (!Array.isArray(snapshot.accountReadings)) {
  const safe = overview(snapshot, "workbuddy", snapshot.region === "global" || providerId === "workbuddy-global" ? "global" : "cn");
  if (snapshot.refreshFailed === true) safe.refreshFailed = true;
  safe.accountReadings = safe.accounts.map(row => row.id === safe.accountId && safe.credits
   ? { ...row, credits: structuredClone(safe.credits), ...(safe.refreshFailed ? { refreshFailed: true } : {}) }
   : { ...row, error: failure });
  snapshot = { ...safe, generatedAt: snapshot.generatedAt };
 }
 const label = providerId === "workbuddy-global" ? "WorkBuddy 国际版" : "WorkBuddy";
 const checkedAt = stamp(snapshot.generatedAt);
 const fresh = !!checkedAt && snapshot.generatedAt <= now + 60000 && now - snapshot.generatedAt <= 180000;
 const accounts = (Array.isArray(snapshot.accountReadings) ? snapshot.accountReadings : []).map(row => {
  const base = { providerId, label, ...accountMetadata(row, snapshot, now), windows: [], extras: [], coverage: "partial", freshness: "unknown" };
  const credits = object(row.credits) ? wbCredits(row.credits) : number(row.credits) ? row.credits : undefined;
  if (credits === undefined) return { ...base, state: "error", error: failure };
   const extras = [{ kind: "balance", value: `${typeof credits === "number" ? credits : credits.total} credits` }], windows = [];
   // account-credits 只提供该账号总余额：余额本身完整可读，积分包明细未提供另作说明。
   if (typeof credits === "number") extras.push({ kind: "note", value: "仅有账号总余额，未提供积分包明细" });
  if (object(credits)) {
			// 先隐藏用尽/已过期包，再按到期紧急度与额度性质聚合；不为每个包造说明行。
			const prepared = (credits.packages || []).map(pkg => ({
				...pkg, name: text(pkg.packageName) || "积分包", remaining: pkg.remain, unit: "credits",
				recurring: pkg.monthly === true, expiresAt: stamp(pkg.expiresAtMs) ? Date.parse(stamp(pkg.expiresAtMs)) : undefined,
			}));
			const packages = summarizeCreditPackages(prepared, now).packages;
			const packs = [], monthlyPacks = [];
			for (const pkg of packages) {
				if (pkg.monthly === true && number(pkg.size) && pkg.size > 0 && pkg.remaining <= pkg.size) {
					const percent = Math.min(99.9, Math.round((1 - pkg.remaining / pkg.size) * 1000) / 10);
					const resetsAt = stamp(pkg.cycleRefreshMs);
					windows.push({ kind: "month", percent, status: "ok", groupLabel: pkg.name, detail: { used: pkg.size - pkg.remaining, limit: pkg.size, remaining: pkg.remaining, unit: "credits" }, ...(resetsAt ? { resetsAt } : {}) });
					monthlyPacks.push(pkg);
				} else packs.push(pkg);
			}
			extras.push(...summarizeCreditPackages(packs, now).extras, ...summarizeCreditPackages(monthlyPacks, now, { urgentOnly: true }).extras);
			// 上游只给聚合提醒、没有逐包日期时保留它；已经有分组提醒则不重复。
			if (!extras.some(row => /今天到期|3 天内到期/.test(row.value)) && number(credits.expiringSoon) && credits.expiringSoon > 0) extras.push({ kind: "note", value: `即将到期：${credits.expiringSoon} credits` });
  }
   // coverage 描述可用额度是否完整，而非可选的积分包明细是否存在。
   const complete = (typeof credits === "number" || object(credits) && Array.isArray(credits.packages)) && !row.refreshFailed && !row.error;
  return { ...base, state: "ok", windows, extras, coverage: complete ? "complete" : "partial", freshness: fresh && !row.refreshFailed ? "fresh" : "stale", ...(checkedAt && !row.refreshFailed ? { lastSuccessAt: checkedAt } : {}), ...(row.error ? { error: failure } : row.refreshFailed ? { error: "提供方刷新失败，保留已有额度" } : {}) };
 });
 if (accounts.length === 1) return { ...accounts[0], linkedAccounts: accounts };
 const successful = accounts.filter(row => row.state === "ok");
  return { providerId, label, state: successful.length ? "ok" : "error", windows: [], extras: [], coverage: accounts.every(row => row.state === "ok" && row.coverage === "complete") ? "complete" : "partial", freshness: successful.length ? successful.every(row => row.freshness === "fresh") ? "fresh" : "stale" : "unknown", ...(successful.some(row => row.lastSuccessAt) && checkedAt ? { lastSuccessAt: checkedAt } : {}), linkedAccounts: accounts, ...(!successful.length ? { error: failure } : {}) };
}
