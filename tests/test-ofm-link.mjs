// OFM 的固定只读 RPC、账号隔离和单位语义；全部使用虚构数据。
import assert from 'node:assert/strict';
import { OFM_CHANNELS, OFM_IDS, OfmReader, normalizeOfm } from '../lib/ofm.js';
import { loadHostModule } from './helpers.mjs';
const { SubUsageService, PROVIDERS, subUsageRemote } = await loadHostModule();
const now = Date.parse('2026-11-02T00:00:00Z');
const pack = (name, remaining, unit = '积分', extra = {}) => ({ name, remaining, total: remaining, used: 0, unit, active: true, ...extra });
const row = (accountId, nickname, total, packages) => ({ accountId, nickname, balance: { total, packages } });
const snapshot = (provider, accounts, more = {}) => ({ provider, generatedAt: now, cached: false, accounts, disabledCount: 0, preference: 'auto', ...more });
const sample = snapshot('raccoon', [row('a', '账号甲', 6600, [pack('奖励积分', 6000), pack('每日积分', 600)]), row('b', '账号乙', 6300, [pack('奖励积分', 6000), pack('每日积分', 300)])]);

{
 const result = normalizeOfm(sample, 'ofm-raccoon', now);
 assert.equal(result.state, 'ok');
 assert.deepEqual(result.windows, []);
 assert.deepEqual(result.extras, [], '多账号没有相加后的余额');
 assert.equal(result.ofmAccounts.length, 2);
 assert.deepEqual(result.ofmAccounts.map(a => a.extras[0].value), ['6600 积分', '6300 积分']);
 assert(result.ofmAccounts.every(a => a.windows.length === 0), '余额快照不编造总容量/百分比');
 assert(result.ofmAccounts[0].extras.some(x => x.value.includes('每日积分：600')));
 assert(result.ofmAccounts.every(a => a.extras.every(x => Object.keys(x).sort().join(',') === 'kind,value')), 'extras 遵守工具输出白名单');
 assert.equal(normalizeOfm({ ...sample, generatedAt: now - 300000 }, 'ofm-raccoon', now).freshness, 'stale');
 assert.throws(() => normalizeOfm(sample, 'ofm-loomy', now), /形状/);
 assert.equal(normalizeOfm(snapshot('loomy', []), 'ofm-loomy', now), null);
}
{
 const q = normalizeOfm(snapshot('qodercn', [row('a', '', 453, [pack('资源包', 453, 'Credits', { total: 1200, used: 747, expiredTime: '2026-11-10T00:00:00Z' })])]), 'ofm-qodercn', now);
 assert.equal(q.windows[0].percent, 62.3);
 assert.equal(q.windows[0].detail.limit, 1200);
 assert(!('resetsAt' in q.windows[0]), '包到期时间不是重置时间');
 assert(q.extras.some(x => x.value.includes('到期')));
 const empty = normalizeOfm(snapshot('qoder', [row('a', '', 0, [pack('套餐额度', 0, 'Credits')])]), 'ofm-qoder', now);
 assert.equal(empty.windows.length, 0, '0 总容量不造 100% 剩余或耗尽窗口');
 assert(!('availability' in empty), '额度读数不推断全部模型可用性');
}
{
 for (const provider of ['gemini', 'zcode']) {
  const result = normalizeOfm(snapshot(provider, [row('a', '', 160, [pack('模型 A', 80, '%', { total: 100 }), pack('模型 B', 80, '%', { total: 100 })])]), `ofm-${provider}`, now);
  assert.equal(result.windows.length, 2);
  assert(result.windows.every(w => w.percent === 20));
  assert.equal(result.extras.filter(x => x.kind === 'balance').length, 0, '多个模型池不把百分比相加当余额');
 }
 const mixed = normalizeOfm(snapshot('lobsterai', [row('a', '', 10, [pack('积分', 4, '积分'), pack('余额', 6, 'USD')])]), 'ofm-lobsterai', now);
 assert(!mixed.extras.some(x => x.kind === 'balance'), '不同单位的 total 不作为余额展示');
}
{
 const cline = normalizeOfm(snapshot('cline', [{ accountId: 'a', nickname: '甲', balance: null, error: 'UPSTREAM_SECRET' }], { subscription: { kind: 'windows', accounts: [{ accountId: 'a', ok: true, windows: [{ type: 'weekly', percentUsed: 25, resetsAt: '2026-11-08T00:00:00Z' }] }] } }), 'ofm-cline', now);
 assert.equal(cline.state, 'ok', '余额失败时保留独立成功的订阅窗口');
 assert.equal(cline.coverage, 'partial');
 assert.equal(cline.windows[0].kind, 'week');
 assert.equal(cline.windows[0].percent, 25);
 assert(!JSON.stringify(cline).includes('UPSTREAM_SECRET'));
 const other = normalizeOfm(snapshot('cline', [{ accountId: 'b', balance: null }], { subscription: { kind: 'windows', accounts: [{ accountId: 'a', ok: true, windows: [{ type: 'weekly', percentUsed: 25 }] }] } }), 'ofm-cline', now);
 assert.equal(other.state, 'error', '订阅窗口按 accountId 匹配，不跨账号回落');
 assert(!('lastSuccessAt' in other), '失败快照时间不是上次成功时间');
 const partial = normalizeOfm(snapshot('cline', [row('a', '甲', 1, [pack('余额', 1)]), row('b', '乙', 2, [pack('余额', 2)])], { subscription: { kind: 'windows', accounts: 'malformed' } }), 'ofm-cline', now);
 assert.equal(partial.state, 'ok', '独立订阅窗口漂移不丢掉余额成功数据');
 assert.equal(partial.coverage, 'partial', '多账号摘要保留子项部分覆盖状态');
}

function connectionFixture(answer = provider => provider === 'raccoon' ? sample : snapshot(provider, [])) {
 const calls = [], peers = [];
 const connection = {
  createPeer(options) { assert.deepEqual(options, { principal: { kind: 'owner' } }); const peer = { disposed: false, dispose() { this.disposed = true; } }; peers.push(peer); return peer; },
  createSharedFetchHandler(path) {
   assert.equal(path, '/api');
   return { async fetch(request, peer) {
    assert(peers.includes(peer));
    assert.equal(request.method, 'POST');
    assert.equal(new URL(request.url).pathname, '/api/channel-pack');
    assert.equal(request.headers.get('content-type'), 'application/json');
    const message = await request.json();
    assert.equal(message.type, 'client-request');
    assert.equal(message.method, 'channel-pack');
    assert.equal(message.payload.method, 'usage.badge', '只允许此只读 RPC，不调用登录/签到/设置');
    calls.push(message.payload.payload);
    const value = await answer(message.payload.payload.provider);
    if (value instanceof Response) return value;
    return Response.json({ type: 'server-response', rpcId: message.rpcId, result: { ok: true, value } });
   } };
  }
 };
 return { connection, calls, peers };
}
{
 const f = connectionFixture();
 const reader = new OfmReader({ get(name) { assert.equal(name, 'connection', '不读取凭据服务'); return f.connection; } });
 await Promise.all([reader.read('raccoon', false), reader.read('raccoon', false), reader.read('loomy', true)]);
 assert.equal(f.peers.length, 1, '全量并发首次读取只创建一个 Peer');
 assert.equal(f.calls.length, 2, '同渠道在途查询合并，不同渠道隔离');
 assert.deepEqual(f.calls.find(c => c.provider === 'loomy'), { provider: 'loomy', force: true });
 await reader.dispose(); assert(f.peers[0].disposed);
 await assert.rejects(reader.read('raccoon', false), /卸载/);
 const absent = new OfmReader({ get: () => undefined });
 assert.equal(await absent.read('raccoon', false), undefined);
 const missing = connectionFixture(() => new Response('', { status: 404 }));
 const missingReader = new OfmReader({ get: () => missing.connection });
 assert.equal(await missingReader.read('raccoon', false), undefined); await missingReader.dispose();
 const broken = connectionFixture(() => { throw new Error('UPSTREAM_SECRET'); });
 const brokenReader = new OfmReader({ get: () => broken.connection });
 await assert.rejects(brokenReader.read('raccoon', false), error => !error.message.includes('UPSTREAM_SECRET'));
 await brokenReader.dispose();
}
{
 const f = connectionFixture();
 const io = { readFileSync() { throw Object.assign(new Error('missing'), { code: 'ENOENT' }); }, mkdirSync() {}, writeFileSync() {}, renameSync() {}, chmodSync() {} };
 const service = new SubUsageService({ get: name => name === 'connection' ? f.connection : undefined }, { io, configPath: 'memory/config', now: () => now, resolveCredentials: async () => undefined, resolveEnvironment: () => undefined, fetch: async () => { throw new Error('No networking'); } });
 const result = await service.quota({ providerIds: ['小浣熊'], force: true });
 assert.deepEqual(result.providers.map(p => p.account), ['账号甲', '账号乙']);
 assert.deepEqual(result.providers.map(p => p.providerId), ['ofm-raccoon', 'ofm-raccoon']);
 assert(result.providers.every(p => !('ofmAccounts' in p) && !('accountActive' in p) && !('accountMode' in p)), '工具不推断当前服务账号或轮换方式');
 const pill = await service.readLinked({ providerIds: ['ofm-raccoon'], force: false });
 assert.equal(pill.entries[0].ofmAccounts.length, 2);
 assert(!('settings' in pill));
 for (const id of OFM_IDS) {
  assert.equal(PROVIDERS[id], undefined, 'OFM 不创建凭据槽');
  const codec = subUsageRemote.descriptors.find(d => d.method === 'readLinked').parameters[0].codec.schema;
  assert.deepEqual(codec.parse({ providerIds: [id], force: false }).providerIds, [id]);
 }
 const all = await service.quota({ providerIds: ['ofm'] });
 assert(all.providers.every(p => p.providerId.startsWith('ofm-')), 'ofm 别名不会查询普通订阅');
 assert.equal(Object.keys(OFM_CHANNELS).length, 10);
 await service.dispose();
}
console.log('PASS OFM：固定只读 RPC、十渠道、并发/force/卸载、缺席降级、账号隔离、分桶单位与独立订阅窗口');
