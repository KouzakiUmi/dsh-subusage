// 直取的**接线**回归（区别于 test-local-usage.mjs 的 reader 单测）。
//
// 这里钉的是 `linkedSnapshot()` 这一层的行为，也就是药丸实际走的路径：
//  1. 直取命中时返回 `channel: "local"`，且**不再**触碰页面代取 / 本机 HTTP / OFM / EAC；
//  2. 直取拿不到数据时安静让位，不把失败行顶成药丸结论；
//  3. 多账号经 `normalizeEac` 归一化后，余额落在各自的账号行上。
import assert from 'node:assert/strict';
import { loadHostModule } from './helpers.mjs';

const { SubUsageService } = await loadHostModule();
const NOW = Date.parse('2026-11-03T00:00:00Z');
const MISSING = Object.assign(new Error('missing'), { code: 'ENOENT' });

function harness({ accounts = [], credentials = {}, upstream, options = {} } = {}) {
	const upstreamCalls = [];
	const io = {
		readFileSync() { throw MISSING; },
		mkdirSync() {}, writeFileSync() {}, renameSync() {}, chmodSync() {},
	};
	const service = new SubUsageService({ get: () => undefined }, {
		io,
		configPath: 'memory/config',
		now: () => NOW,
		resolveCredentials: async () => undefined,
		resolveEnvironment: () => undefined,
		resolveLocalAccounts: () => accounts,
		resolveLocalCredential: async ref => credentials[ref],
		localFetch: async (url, init) => {
			upstreamCalls.push({ url: String(url), init });
			const body = upstream();
			return { ok: true, status: 200, json: async () => body };
		},
		// 兜底：任何走本机 HTTP 的尝试都要在这里炸掉，而不是真发请求。
		fetch: async url => { throw new Error(`不该走本机 HTTP：${url}`); },
		...options,
	});
	return { service, upstreamCalls };
}

// ── [1] 直取命中：返回 local 通道，余额经 normalizeEac 落到 extras ──────────
{
	const { service, upstreamCalls } = harness({
		accounts: [{ ref: 'RACCOON_ACCOUNT_A', accountId: 'a1', nickname: '账号甲' }],
		credentials: { RACCOON_ACCOUNT_A: { access_token: 'tok' } },
		upstream: () => ({ code: 0, data: { available_points: 6600, topup_points: 6600 } }),
	});
	const snapshot = await service.linkedSnapshot('raccoon', true, true, undefined);
	assert.equal(snapshot.channel, 'local', '直取命中就走 local，不再问下游来源');
	assert.equal(snapshot.snapshot.accounts[0].balance.total, 6600);
	assert.equal(upstreamCalls.length, 1);
	assert.ok(upstreamCalls[0].url.startsWith('https://xiaohuanxiong.com/'), '打的是上游而不是本机路由');

	const entry = await service.linkedProvider('raccoon', true, true, false, true);
	assert.equal(entry.state, 'ok');
	assert.equal(entry.extras.find(row => row.kind === 'balance').value, '6600 积分');
	service.dispose();
}

// ── [2] 直取拿不到数据：不让位成药丸结论，继续走原有来源链 ──────────────────
{
	const { service } = harness({
		accounts: [{ ref: 'RACCOON_ACCOUNT_A', accountId: 'a1' }],
		credentials: { RACCOON_ACCOUNT_A: { access_token: 'tok' } },
		upstream: () => ({ code: 200003, message: 'expired' }),
	});
	// 后续链在本测试里没有可用的 OFM / EAC / 兄弟插件，最终会是缺席——关键是**不是** local。
	const snapshot = await service.linkedSnapshot('raccoon', true, true, undefined).catch(() => null);
	assert.notEqual(snapshot?.channel, 'local', '读不到就不该冒充直取成功');
	service.dispose();
}

// ── [3] 多账号：余额落在各自账号行（顶层不重复累加） ────────────────────────
{
	const { service } = harness({
		accounts: [{ ref: 'A', accountId: 'a1', nickname: 'one' }, { ref: 'B', accountId: 'a2', nickname: 'two' }],
		credentials: { A: { access_token: 't1' }, B: { access_token: 't2' } },
		upstream: () => ({ code: 0, data: { available_points: 100 } }),
	});
	const entry = await service.linkedProvider('raccoon', true, true, false, true);
	assert.equal(entry.linkedAccounts.length, 2);
	assert.deepEqual(entry.linkedAccounts.map(row => row.extras[0].value), ['100 积分', '100 积分'], '只有总量时用兜底包，单位跟着分项走而不是编成 credits');
	assert.deepEqual(entry.extras, [], '多账号时顶层不再重复列余额');
	service.dispose();
}

// ── [4] ofm-* 与独立通道共用同一份直取结果 ──────────────────────────────────
{
	const { service, upstreamCalls } = harness({
		accounts: [{ ref: 'QODER_ACCOUNT_A', accountId: 'q1', nickname: '胡亦康' }],
		credentials: { QODER_ACCOUNT_A: { access_token: 'tok' } },
		upstream: () => ({ qoderUsage: { userQuota: { remaining: 0, unit: 'credits' }, addOnQuota: { remaining: 100, unit: 'credits' } } }),
	});
	const entry = await service.linkedProvider('ofm-qoder', true, true, false, true);
	assert.equal(entry.state, 'ok');
	assert.equal(entry.extras.find(row => row.kind === 'balance').value, '100 credits');
	assert.ok(upstreamCalls[0].url.startsWith('https://openapi.qoder.sh/'), 'OFM 条目也走直取，而不是 OFM 的 usage.badge');
	service.dispose();
}


// ── [5] 账号索引解析（Host 层新增逻辑，此前被注入参数绕开） ─────────────────
{
	const index = { accounts: [
		{ id: 'raccoon-a', provider: 'raccoon', nickname: '甲', enabled: true, credentialRef: 'RACCOON_ACCOUNT_A' },
		{ id: 'raccoon-b', provider: 'raccoon', nickname: '乙', enabled: false, credentialRef: 'RACCOON_ACCOUNT_B' },
		{ id: 'loomy-a', provider: 'loomy', nickname: '丙', enabled: true, credentialRef: 'LOOMY_ACCOUNT_A' },
	] };
	const io = {
		readFileSync(path) {
			if (path === 'memory/state.json') return JSON.stringify(index);
			throw MISSING;
		},
		mkdirSync() {}, writeFileSync() {}, renameSync() {}, chmodSync() {},
	};
	const service = new SubUsageService({ get: () => undefined }, {
		io,
		configPath: 'memory/config',
		now: () => NOW,
		resolveCredentials: async () => undefined,
		resolveEnvironment: () => undefined,
		localAccountsFile: 'memory/state.json',
		traeStoragePaths: [],
		resolveLocalCredential: async () => undefined,
		localFetch: async url => { throw new Error(`不该发请求：${url}`); },
		fetch: async url => { throw new Error(`不该走本机 HTTP：${url}`); },
	});
	// 只取该渠道、并且**不**因为 enabled:false 就丢弃（它只影响 EAC 自动选号）。
	const raccoon = service.localAccountRefs('raccoon');
	assert.deepEqual(raccoon.map(row => row.ref), ['RACCOON_ACCOUNT_A', 'RACCOON_ACCOUNT_B'], 'enabled:false 的账号凭据仍然可读');
	assert.deepEqual(raccoon.map(row => row.accountId), ['raccoon-a', 'raccoon-b']);
	assert.equal(raccoon[0].nickname, '甲');
	assert.equal(service.localAccountRefs('loomy').length, 1);
	assert.deepEqual(service.localAccountRefs('trae'), [], '没有候选路径时 Trae 不产生账号');
	service.dispose();
}

// ── [6] Trae 账号池：池里几个账号就要出几行，且各自用自己那份凭据 ──────────
{
	const pool = { version: 2, credentials: [
		{ accessToken: 'token-a', userId: '111', accountName: '甲', userRegion: { region: 'CN' }, expiresAtMs: NOW + 3600000 },
		{ accessToken: 'token-b', userId: '222', accountName: '乙', userRegion: { region: 'CN' }, expiresAtMs: NOW + 3600000 },
	] };
	const io = {
		readFileSync(path) {
			if (path === 'memory/pool.json') return JSON.stringify(pool);
			if (path === 'memory/state.json') return JSON.stringify({ accounts: [] });
			throw MISSING;
		},
		mkdirSync() {}, writeFileSync() {}, renameSync() {}, chmodSync() {},
	};
	const seen = [];
	const service = new SubUsageService({ get: () => undefined }, {
		io,
		configPath: 'memory/config',
		now: () => NOW,
		resolveCredentials: async () => undefined,
		resolveEnvironment: () => undefined,
		localAccountsFile: 'memory/state.json',
		traeStoragePaths: ['memory/pool.json'],
		localFetch: async (url, init) => {
			seen.push(init.headers.Authorization);
			return { ok: true, status: 200, json: async () => ({ usage_summary: { total_amount: 100, consumed_amount: 40 }, user_entitlement_pack_list: [] }) };
		},
		fetch: async url => { throw new Error(`不该走本机 HTTP：${url}`); },
	});
	const refs = service.localAccountRefs('trae');
	assert.equal(refs.length, 2, '客户端当前登录只有 1 个账号，多账号只在池里');
	assert.deepEqual(refs.map(row => row.nickname), ['甲', '乙']);

	const entry = await service.linkedProvider('trae', true, true, false, true);
	assert.equal(entry.linkedAccounts.length, 2);
	assert.deepEqual(seen.sort(), ['Cloud-IDE-JWT token-a', 'Cloud-IDE-JWT token-b'], '每个账号用自己那份令牌');
	assert.deepEqual(entry.linkedAccounts.map(row => row.extras[0].value), ['60 credits', '60 credits']);
	service.dispose();
}
// ── [7] 直取缓存命中（非 force）：同一渠道的独立条目与 ofm-* 条目都不得抛错 ──
{
	const { service, upstreamCalls } = harness({
		accounts: [{ ref: 'R', accountId: 'a1', nickname: '甲' }],
		credentials: { R: { access_token: 'tok' } },
		upstream: () => ({ code: 0, data: { available_points: 6600, topup_points: 6600 } }),
	});
	const first = await service.linkedProvider('raccoon', false, true, false, true);
	assert.equal(first.state, 'ok');
	const second = await service.linkedProvider('raccoon', false, true, false, true);
	assert.equal(second.state, 'ok', '60 秒内的缓存命中仍返回额度，而不是 localRead(...).catch 的 TypeError');
	const sibling = await service.linkedProvider('ofm-raccoon', false, true, false, true);
	assert.equal(sibling.state, 'ok', 'ofm-raccoon 共用缓存的直取结果');
	assert.equal(upstreamCalls.length, 1, '缓存命中不重复请求上游');
	service.dispose();
}
// ── [8] Trae：国际版池没有 CN 账号时继续看客户端 storage.json 里的 CN 登录 ──
{
	const files = {
		'memory/ai-pool.json': JSON.stringify({ version: 2, credentials: [{ accessToken: 'global-token', userId: '1', accountName: 'g', userRegion: { region: 'AI' }, expiresAtMs: NOW + 3600000 }] }),
		'memory/storage.json': JSON.stringify({ 'iCubeAuthInfo://icube.cloudide': JSON.stringify({ token: 'cn-token', userId: '9', userRegion: 'CN', account: { username: 'cn-user' } }) }),
		'memory/state.json': JSON.stringify({ accounts: [] }),
	};
	const io = {
		readFileSync(path) { if (path in files) return files[path]; throw MISSING; },
		mkdirSync() {}, writeFileSync() {}, renameSync() {}, chmodSync() {},
	};
	const service = new SubUsageService({ get: () => undefined }, {
		io, configPath: 'memory/config', now: () => NOW,
		resolveCredentials: async () => undefined, resolveEnvironment: () => undefined,
		localAccountsFile: 'memory/state.json',
		traeStoragePaths: ['memory/ai-pool.json', 'memory/storage.json'],
		localFetch: async () => { throw new Error('不该发请求'); },
		fetch: async url => { throw new Error(`不该走本机 HTTP：${url}`); },
	});
	const refs = service.localAccountRefs('trae');
	assert.equal(refs.length, 1);
	assert.equal(refs[0].nickname, 'cn-user', '取到的是 storage.json 里的 CN 账号，而不是只有国际版的池');
	assert.ok(refs[0].ref.startsWith('trae-auth:memory/storage.json'));
	service.dispose();
}

// ── [9] 页面代取多轮：直取读不到只在首轮请求上游，后续轮次不再重复 ─────────
{
	const { service, upstreamCalls } = harness({
		accounts: [{ ref: 'R', accountId: 'a1' }],
		credentials: { R: { access_token: 'tok' } },
		upstream: () => ({ code: 200003, message: 'expired' }),
	});
	const first = await service.linkedStep({ providerId: 'raccoon', responses: [], force: true });
	assert.ok(first.missing, '直取读不到 → 宿主让页面去取独立插件的 status');
	assert.equal(upstreamCalls.length, 1, '首轮请求一次上游');
	const second = await service.linkedStep({ providerId: 'raccoon', responses: [{ key: first.missing.key, status: 200, ok: true, body: { status: 'signed-out' } }], force: true });
	assert.equal(second.entry.state, 'error');
	assert.equal(upstreamCalls.length, 1, '后续轮次不再重复请求同一个失败的上游');
	// 下一次刷新从首轮重新开始：重新登录后立即恢复，不被上一次的失败记忆按住。
	const third = await service.linkedStep({ providerId: 'raccoon', responses: [], force: true });
	assert.ok(third.missing);
	assert.equal(upstreamCalls.length, 2, '新一轮刷新的首轮照常重试上游');
	service.dispose();
}
console.log('PASS 直取接线：local 通道命中、失败让位、多账号归一化、ofm-* 共用同一份结果、缓存命中、Trae 多来源与多轮不重复请求');
