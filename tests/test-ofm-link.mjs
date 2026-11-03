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
 assert(result.ofmAccounts[0].extras.some(x => x.value === '周期 / 套餐额度：600 积分'));
 assert(result.ofmAccounts[0].extras.some(x => x.value === '临时额度合计：6000 积分'));
 assert(result.ofmAccounts[0].extras.every(x => !x.value.includes('每日积分：') && !x.value.includes('奖励积分：')), '不再逐包列成长清单');
 assert(result.ofmAccounts.every(a => a.extras.every(x => Object.keys(x).sort().join(',') === 'kind,value')), 'extras 遵守工具输出白名单');
 assert.equal(normalizeOfm({ ...sample, generatedAt: now - 300000 }, 'ofm-raccoon', now).freshness, 'stale');
 assert.throws(() => normalizeOfm(sample, 'ofm-loomy', now), /形状/);
 assert.equal(normalizeOfm(snapshot('loomy', []), 'ofm-loomy', now), null);
}
{
 const metadata = [
  { id: 'a', nickname: '相同昵称', enabled: true, authStatus: 'present', authExpiresAt: '2026-11-10T00:00:00Z' },
  { id: 'b', nickname: '相同昵称', enabled: true, authStatus: 'missing' },
  { id: 'disabled', nickname: '已停用', enabled: false, authStatus: 'unknown' },
  { id: 'new', nickname: '新账号', enabled: true, authStatus: 'unknown' }
 ];
 const result = normalizeOfm({ ...sample, accountMetadata: metadata, preference: 'auto' }, 'ofm-raccoon', now);
 assert.deepEqual(result.ofmAccounts.map(a => a.accountId), ['a', 'b', 'disabled', 'new']);
 assert.deepEqual(result.ofmAccounts.slice(0, 2).map(a => a.account), ['相同昵称', '相同昵称']);
 assert.deepEqual(result.ofmAccounts.slice(0, 2).map(a => a.extras[0].value), ['6600 积分', '6300 积分'], '同名账号仍按ID关联额度');
 assert.equal(result.ofmAccounts[1].authStatus, 'missing');
 assert.equal(result.ofmAccounts[1].freshness, 'stale', '删除凭据后的提供方缓存不当成新鲜鉴权成功');
 assert.equal(result.ofmAccounts[2].state, 'disabled');
 assert.deepEqual(result.ofmAccounts[2].extras, []);
 assert.equal(result.ofmAccounts[3].state, 'error', '新账号未出现在旧徽标里时不借其他账号额度');
 assert(!result.ofmAccounts.some(a => 'accountMode' in a || 'accountActive' in a), '徽标auto不是账号选择模式');
 const removed = normalizeOfm({ ...sample, accountMetadata: [metadata[0]] }, 'ofm-raccoon', now);
 assert.deepEqual(removed.ofmAccounts.map(a => a.accountId), ['a'], '实时索引移除已经删除的缓存账号');
 const hidden = normalizeOfm({ ...sample, accountMetadata: [metadata[2]] }, 'ofm-raccoon', now);
 assert.equal(hidden.state, 'disabled');
 const privateName = normalizeOfm(snapshot('loomy', [row('mail', 'alice@example.com', 1, [pack('积分', 1)])]), 'ofm-loomy', now);
 assert.equal(privateName.account, 'a***@example.com');
 const almost = normalizeOfm(snapshot('qoder', [row('a', '', 0.001, [pack('套餐', 0.001, 'credits', { total: 100 })])]), 'ofm-qoder', now);
 assert.equal(almost.windows[0].status, 'ok', '非零余额四舍五入不能变成耗尽');
 assert.equal(almost.windows[0].percent, 99.9);
}
{
 const q = normalizeOfm(snapshot('qodercn', [row('a', '', 453, [pack('资源包', 453, 'Credits', { total: 1200, used: 747, expiredTime: '2026-11-10T00:00:00Z' })])]), 'ofm-qodercn', now);
 assert.equal(q.windows[0].percent, 62.3);
 assert.equal(q.windows[0].detail.limit, 1200);
 assert(!('resetsAt' in q.windows[0]), '包到期时间不是重置时间');
 assert(!q.extras.some(x => x.value.includes('到期')), '较远的逐包到期日不占说明行');
 const empty = normalizeOfm(snapshot('qoder', [row('a', '', 0, [pack('套餐额度', 0, 'Credits')])]), 'ofm-qoder', now);
 assert.equal(empty.windows.length, 0, '0 总容量不造 100% 剩余或耗尽窗口');
 assert(!('availability' in empty), '额度读数不推断全部模型可用性');
 const expired = normalizeOfm(snapshot('qoder', [row('a', '', 0, [pack('已过期', 20, 'Credits', { total: 100, expiredTime: '2026-11-01T00:00:00Z' }), pack('用尽', 0, 'Credits', { total: 100 })])]), 'ofm-qoder', now);
 assert.equal(expired.windows.length, 0, '已过期与用尽包不生成额度窗口');
 assert(!JSON.stringify(expired.extras).includes('已过期') && !JSON.stringify(expired.extras).includes('用尽'), '已过期与用尽包不占说明行');
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
     assert(['usage.badge', 'account.list'].includes(message.payload.method), '只允许额度和账号枚举，不调用登录/签到/设置');
     calls.push({ method: message.payload.method, ...message.payload.payload });
      let value = await answer(message.payload.payload.provider, message.payload.method, message);
    if (value instanceof Response) return value;
     if (message.payload.method === 'account.list' && value?.provider) value = { accounts: value.accounts.map(row => ({ id: row.accountId, provider: value.provider, nickname: row.nickname, credentialRef: `${value.provider.toUpperCase()}_ACCOUNT_${row.accountId.toUpperCase()}`, enabled: true })) };
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
  assert.equal(f.calls.filter(c => c.method === 'usage.badge').length, 2, '同渠道在途查询合并，不同渠道隔离');
  assert.equal(f.calls.filter(c => c.method === 'account.list').length, 2, '每个渠道独立核对账号索引');
  assert.deepEqual(f.calls.find(c => c.provider === 'loomy' && c.method === 'usage.badge'), { method: 'usage.badge', provider: 'loomy', force: true });
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
 const reader = new OfmReader({ get: () => f.connection });
 await Promise.all([reader.read('raccoon', false), reader.read('raccoon', true)]);
 assert.deepEqual(f.calls.filter(c => c.method === 'usage.badge').map(c => c.force), [false, true], '手动刷新不合并进较早的普通请求');
 await reader.dispose();
}
{
 const inspected = [];
 const f = connectionFixture((provider, method) => method === 'account.list' ? { accounts: [
  { id: 'a', provider, nickname: '甲', enabled: true, credentialRef: 'RACCOON_ACCOUNT_A', expiresAt: now + 86400000, source: { secret: 'DO_NOT_FORWARD' }, phone: 'DO_NOT_FORWARD' },
  { id: 'b', provider, nickname: '乙', enabled: true, credentialRef: 'RACCOON_ACCOUNT_B', access_token: 'DO_NOT_FORWARD' }
 ] } : sample);
 const reader = new OfmReader({ get: () => f.connection }, { inspectCredential: async ref => { inspected.push(ref); return ref.endsWith('_A') ? 'present' : 'missing'; } });
 const read = await reader.read('raccoon', false);
 assert.deepEqual(inspected, ['RACCOON_ACCOUNT_A', 'RACCOON_ACCOUNT_B']);
 assert.deepEqual(read.accountMetadata.map(a => a.authStatus), ['present', 'missing']);
 assert(!JSON.stringify(read).includes('DO_NOT_FORWARD'));
 assert(!JSON.stringify(read).includes('RACCOON_ACCOUNT_'), '只在Host检查引用，不带入额度快照');
 assert(!JSON.stringify(normalizeOfm(read, 'ofm-raccoon', now)).includes('credentialRef'));
 await reader.dispose();
 const fallback = connectionFixture((provider, method) => { if (method === 'account.list') throw new Error('METADATA_SECRET'); return sample; });
 const legacy = new OfmReader({ get: () => fallback.connection });
 const value = normalizeOfm(await legacy.read('raccoon', false), 'ofm-raccoon', now);
 assert.equal(value.state, 'ok', '账号枚举接口不可用仍保留成功额度');
  assert.equal(value.coverage, 'partial', '枚举失败明确标部分数据，不等同于旧版接口缺席');
  assert(value.ofmAccounts.every(a => a.coverage === 'partial' && a.error.includes('账号索引读取失败')));
 assert(value.ofmAccounts.every(a => a.authStatus === 'unknown'));
 assert(!JSON.stringify(value).includes('METADATA_SECRET'));
 await legacy.dispose();
}
{
 const cases = [
  ['接口缺席', () => new Response('', { status: 404 }), 'complete'],
  ['HTTP503', () => new Response('PRIVATE_INDEX_ERROR', { status: 503 }), 'partial'],
  ['损坏JSON', () => new Response('PRIVATE_INDEX_ERROR', { status: 200 }), 'partial'],
  ['RPC失败', message => Response.json({ type: 'server-response', rpcId: message.rpcId, result: { ok: false, error: { message: 'PRIVATE_INDEX_ERROR' } } }), 'partial'],
  ['RPC缺少value', message => Response.json({ type: 'server-response', rpcId: message.rpcId, result: { ok: true } }), 'partial'],
  ['索引形状漂移', () => ({ accounts: [{ id: 'a', provider: 'other', token: 'PRIVATE_INDEX_ERROR' }] }), 'partial']
 ];
 for (const [name, indexResponse, coverage] of cases) {
  const f = connectionFixture((provider, method, message) => method === 'account.list' ? indexResponse(message) : sample);
  const reader = new OfmReader({ get: () => f.connection });
  const result = normalizeOfm(await reader.read('raccoon', false), 'ofm-raccoon', now);
  assert.equal(result.state, 'ok', `${name}不丢弃独立成功额度`);
  assert.equal(result.coverage, coverage, name);
  assert(result.ofmAccounts.every(account => account.coverage === coverage && account.authStatus === 'unknown'), name);
  assert.deepEqual(result.ofmAccounts.map(account => account.extras[0].value), ['6600 积分', '6300 积分'], name);
  assert.equal(result.freshness, 'fresh', '成功额度采样的时效与账号索引覆盖分别表述');
  assert.equal(Boolean(result.error), coverage === 'partial', name);
  assert(!JSON.stringify(result).includes('PRIVATE_INDEX_ERROR'));
  await reader.dispose();
 }
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
