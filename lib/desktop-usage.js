// 独立 Raccoon / Loomy 的公开状态接口：单当前登录，不合成不存在的账号池。
const text = value => typeof value === 'string' ? value.replace(/[\x00-\x1f\x7f]/g, ' ').trim().slice(0, 120) : '';
const numeric = value => typeof value === 'number' && Number.isFinite(value) && value >= 0;
const stamp = value => numeric(value) && value > 0 && value <= 8.64e15 ? new Date(value).toISOString() : undefined;
const labelOf = value => { const name = text(value), at = name.indexOf('@'); return at > 0 ? `${name[0]}***@${name.slice(at + 1)}` : /^\+?\d{7,}$/.test(name) ? `${name.slice(0, 3)}***${name.slice(-2)}` : name; };

export function normalizeDesktopUsage(snapshot, providerId, now = Date.now()) {
 if (!['raccoon', 'loomy'].includes(providerId) || !snapshot || !['signed-in', 'signed-out', 'error'].includes(snapshot.status)) throw new Error('独立插件额度响应形状不匹配');
 if (snapshot.status === 'signed-out') return null;
 const label = providerId === 'raccoon' ? '小浣熊 · 独立插件' : 'Loomy · 独立插件';
 const base = { providerId, label, windows: [], extras: [], coverage: 'partial', freshness: 'unknown' };
 if (snapshot.status === 'error') return { ...base, state: 'error', error: '独立提供方未能读取登录或额度状态，请在其设置页检查' };
 const account = labelOf(providerId === 'loomy' ? snapshot.account : snapshot.nickname) || '当前登录';
 const extras = [], points = snapshot.points;
 let checkedAt;
 if (providerId === 'loomy') {
  if (numeric(points?.permanent)) extras.push({ kind: 'note', value: `永久积分：${points.permanent}` });
  if (numeric(points?.daily)) extras.push({ kind: 'note', value: `每日赠送积分：${points.daily}` });
  if (typeof points?.updatedAt === 'string' && Number.isFinite(Date.parse(points.updatedAt)) && Date.parse(points.updatedAt) <= now + 60000) checkedAt = new Date(points.updatedAt).toISOString();
  extras.push({ kind: 'note', value: '积分来自 Loomy 本地缓存；提供方没有报告缓存对应的账号 ID' });
 } else {
  if (numeric(points?.total)) extras.push({ kind: 'balance', value: `${points.total} 积分` });
  if (text(points?.plan)) extras.push({ kind: 'plan', value: text(points.plan) });
  // points.note / pointsError / probeKey 等原始字段不进入公开结果。
  extras.push({ kind: 'note', value: '提供方未报告积分读数时间' });
 }
 const hasQuota = providerId === 'loomy' ? numeric(points?.permanent) || numeric(points?.daily) : numeric(points?.total);
 if (!hasQuota) extras.push({ kind: 'note', value: '提供方尚未报告可读积分，缺失值未计为零' });
 const expires = providerId === 'raccoon' ? stamp(snapshot.expiresAt) : undefined;
 const row = { ...base, state: 'ok', account, authStatus: expires && Date.parse(expires) <= now ? 'expired' : 'present', ...(expires ? { authExpiresAt: expires } : {}), extras, freshness: providerId === 'loomy' || snapshot.pointsError ? 'stale' : 'unknown', ...(checkedAt && !snapshot.pointsError ? { lastSuccessAt: checkedAt } : {}), ...(snapshot.pointsError ? { error: '提供方积分读取失败，显示已有状态' } : {}) };
 return { ...row, linkedAccounts: [row] };
}

export class DesktopUsageReader {
 constructor({ readJson, now = Date.now }) { this.readJson = readJson; this.now = now; this.cache = new Map(); this.pending = new Map(); this.versions = new Map(); this.disposed = false; }
 async read(provider, force = false) {
  if (this.disposed) throw new Error('独立插件 reader 已卸载');
  if (!['raccoon', 'loomy'].includes(provider)) throw new Error('未知独立额度渠道');
  const cached = this.cache.get(provider);
  if (!force && this.pending.has(provider)) return this.pending.get(provider);
  if (!force && cached && this.now() >= cached.at && this.now() - cached.at < 60000) return structuredClone(cached.value);
  const version = (this.versions.get(provider) || 0) + 1; this.versions.set(provider, version);
  const task = Promise.resolve().then(() => this.readJson(provider, 'status', {})).then(raw => {
   // 先归一化再缓存，Raccoon 的 probeKey 授权秘密不会被留在缓存里。
   const value = raw === undefined ? undefined : normalizeDesktopUsage(raw, provider, this.now());
   if (!this.disposed && this.versions.get(provider) === version) {
    if (value === undefined) this.cache.delete(provider);
    else this.cache.set(provider, { at: this.now(), value: structuredClone(value) });
   }
   return value;
  }).finally(() => { if (this.pending.get(provider) === task) this.pending.delete(provider); });
  this.pending.set(provider, task); return task;
 }
 dispose() { this.disposed = true; this.cache.clear(); this.pending.clear(); this.versions.clear(); }
}
