// Host 真实接线：两家独立插件、各地区与多账号；不访问网络或本机凭据。
import assert from 'node:assert/strict';
import { loadHostModule } from './helpers.mjs';
const { SubUsageService, normalizeTrae } = await loadHostModule();
const now = Date.parse('2026-11-02T12:00:00Z');
const io = { readFileSync() { throw Object.assign(new Error('missing'), { code: 'ENOENT' }); }, mkdirSync() {}, writeFileSync() {}, renameSync() {}, chmodSync() {} };
const account = (id, selected = false) => ({ id, accountName: `${id}@example.test`, selected, tokenExpiresAtMs: now + 3600000 });
const cn = { status: 'signed-in', accountId: 'a', accountName: 'a@example.test', accounts: [account('a', true), account('b'), account('c')], credits: { available: 9999 }, pool: { enabled: true, accounts: [{ accountId: 'a', current: false }, { accountId: 'b', current: true }] } };
function harness(reply, options = {}) {
 const calls = [];
 const service = new SubUsageService({ get: name => name === 'webServer' ? { getOrigin: () => 'http://127.0.0.1:4321' } : undefined }, {
  io, configPath: 'memory/config', now: () => now, resolveCredentials: async () => undefined, resolveEnvironment: () => undefined,
  fetch: async (url, init) => {
   const u = new URL(url); calls.push({ url: u, init });
   const value = await reply(u);
   if (value === undefined) return { ok: false, status: 404, text: async () => '' };
   return { ok: true, status: 200, text: async () => JSON.stringify(value) };
  }, ...options
 });
 return { service, calls };
}
{
 const { service, calls } = harness(url => {
  assert(url.pathname.startsWith('/plugins/dsh-connect-trae/'));
  assert.equal(url.searchParams.get('region'), 'cn');
  if (url.pathname.endsWith('/usage')) return cn;
  assert(url.pathname.endsWith('/account-status'));
  const id = url.searchParams.get('accountId');
  return id === 'a' ? { id, credits: { total: 100, consumed: 80, available: 20 } } : id === 'b' ? { id, credits: { total: 200, consumed: 50, available: 150 } } : { id };
 });
 const result = await service.quota({ providerIds: ['trae cn'] });
 assert.deepEqual(result.providers.map(row => row.accountId), ['a', 'b', 'c']);
 assert.deepEqual(result.providers.slice(0, 2).map(row => row.extras.find(x => x.kind === 'balance').value), ['20 credits', '150 credits']);
 assert.equal(result.providers[0].accountActive, false);
 assert.equal(result.providers[1].accountActive, true);
 assert.equal(result.providers[1].accountMode, 'auto');
 assert.equal(result.providers[2].state, 'error');
 assert.deepEqual(result.providers[2].windows, []);
 assert(!JSON.stringify(result).includes('9999'));
 assert(!JSON.stringify(result).includes('a@example.test'));
 assert(calls.every(call => call.init.headers.origin === 'http://127.0.0.1:4321' && call.init.signal));
 const first = calls.length;
 const pill = await service.readLinked({ providerIds: ['trae'], force: false });
 assert.equal(calls.length, first, '工具与药丸复用同一多账号快照');
 assert.equal(pill.entries[0].linkedAccounts.length, 3);
 assert(!('settings' in pill));
 await service.readLinked({ providerIds: ['trae'], force: true });
 assert.equal(calls.length, first * 2);
 await service.dispose();
 assert.equal(service.connect.disposed, true);
}
{
 let ready = false;
 const { service, calls } = harness(url => ready && url.pathname.endsWith('/usage') ? { ...cn, accounts: [account('a', true)], credits: { available: 30 } } : undefined);
 assert.equal((await service.readLinked({ providerIds: ['trae'], force: false })).entries[0].state, 'error');
 ready = true;
 const next = await service.readLinked({ providerIds: ['trae'], force: false });
 assert.equal(next.entries[0].state, 'ok', 'Host不能把插件缺席再缓存60秒，挡住内层恢复');
 assert.equal(calls.length, 2);
 await service.dispose();
}
{
 const { service, calls } = harness(url => {
  assert(url.pathname.startsWith('/plugins/dsh-connect-workbuddy/'));
  if (url.searchParams.get('region') === 'global') return { status: 'signed-out', accounts: [] };
  if (url.pathname.endsWith('/usage')) return { ...cn, selectionExplicit: true, pool: { enabled: false, accounts: [] }, credits: { total: 100, packages: [] } };
  return { accounts: [{ id: 'a', credits: 100 }, { id: 'b', credits: 200 }, { id: 'c' }] };
 });
 const value = await service.quota({ providerIds: ['workbuddy'] });
 assert.deepEqual(value.providers.map(row => row.providerId), ['workbuddy', 'workbuddy', 'workbuddy']);
 assert.deepEqual(value.providers.slice(0, 2).map(row => row.extras[0].value), ['100 credits', '200 credits']);
 assert.equal(value.providers[0].accountMode, 'fixed');
  assert.equal(value.providers[1].coverage, 'complete', '批量总余额可用，缺积分包明细不误报部分额度');
  assert(value.providers[1].extras.some(row => row.kind === 'note' && row.value.includes('未提供积分包明细')));
 assert.equal(value.providers[2].state, 'error');
 const signedOut = await service.readLinked({ providerIds: ['workbuddy-global'], force: false });
 assert(signedOut.entries[0].error.includes('WorkBuddy') && !signedOut.entries[0].error.includes('Trae'));
 assert(calls.some(call => call.url.searchParams.get('region') === 'global'));
 assert(calls.every(call => !/transfer|refresh|checkin|select/.test(call.url.pathname)), '只用提供方额度GET，不调用秘密导出或账号操作');
 await service.dispose();
}
{
 const entry = normalizeTrae({ ...cn, region: 'cn', generatedAt: now, accountReadings: [{ id: 'a', accountName: '甲', credits: { available: 30 } }, { id: 'b', accountName: '乙', error: 'PRIVATE_TOKEN' }] }, 'trae', now);
 assert.equal(entry.linkedAccounts[1].state, 'error');
 assert(!JSON.stringify(entry).includes('PRIVATE_TOKEN'));
 assert(!entry.linkedAccounts[1].extras.some(x => x.kind === 'balance'));
 const enterprise = normalizeTrae({ ...cn, accounts: cn.accounts.map(row => ({ ...row, enterprise: true })), accountReadings: [{ id: 'a', creditsUnavailable: 'enterprise' }, { id: 'b', creditsUnavailable: 'enterprise' }] }, 'trae-enterprise', now);
 assert(enterprise.linkedAccounts.every(row => row.windows.length === 0 && !row.extras.some(x => x.kind === 'balance')));
}
{
 let ofmReads = 0;
 const ofm = { provider: 'raccoon', generatedAt: now, accounts: ['a', 'b'].map(id => ({ accountId: id, nickname: id, balance: { total: 10, packages: [{ name: '积分', active: true, remaining: 10, total: 10, unit: '积分' }] } })) };
 const { service, calls } = harness(() => undefined, { resolveOfmUsage: async channel => { assert.equal(channel, 'raccoon'); ofmReads++; return ofm; } });
 const linked = await service.readLinked({ providerIds: ['raccoon'], force: false });
 assert.equal(linked.entries[0].providerId, 'raccoon');
 assert.equal(linked.entries[0].linkedAccounts.length, 2);
 assert(linked.entries[0].label.includes('OFM'));
 assert(calls[0].url.pathname === '/plugins/dsh-raccoon-connect/status');
 const report = await service.quota({ providerIds: ['小浣熊'] });
 assert.deepEqual(report.providers.map(row => row.providerId), ['ofm-raccoon', 'ofm-raccoon'], '全量/厂商查询不把药丸回落结果重复报告为独立来源');
 assert.equal(ofmReads, 2);
 await service.dispose();
}
{
 let ofmReads = 0;
 const { service, calls } = harness(url => { assert(url.pathname === '/plugins/dsh-loomy-connect/status'); assert(!url.searchParams.has('refresh')); return { status: 'signed-in', account: '脱敏账号', points: { permanent: 10, daily: 5, updatedAt: '2026-11-01T00:00:00Z' }, probeKey: 'SECRET' }; }, { resolveOfmUsage: async () => { ofmReads++; return undefined; } });
 const value = await service.readLinked({ providerIds: ['loomy'], force: true });
 assert(value.entries[0].label.includes('独立插件'));
 assert.equal(value.entries[0].linkedAccounts.length, 1);
 assert.equal(ofmReads, 0, '独立入口在场时不混入OFM账号');
 assert(!JSON.stringify(value).includes('SECRET'));
 assert.equal(calls.length, 1);
 await service.dispose();
}
{
 let ofmReads = 0;
 const { service } = harness(() => ({ status: 'signed-out' }), { resolveOfmUsage: async () => { ofmReads++; return undefined; } });
 const value = await service.readLinked({ providerIds: ['raccoon'], force: false });
 assert.equal(value.entries[0].state, 'error');
 assert.equal(ofmReads, 0, '独立入口在场但未登录时不换数据来源');
 await service.dispose();
}
console.log('PASS 独立插件Host接线：逐账号鉴权/区域/失败隔离、缓存恢复、OFM药丸回落与来源去重');
