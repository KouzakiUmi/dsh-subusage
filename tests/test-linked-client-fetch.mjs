// 页面代取通道：宿主说「还缺哪个 URL」→ 渲染进程取 → 宿主归一化。
//
// 背景：DSH 的 `/plugins/*` 路由要求浏览器凭据（`dsh-client-connection` 的 `admit()`），
// 宿主进程发的本机 HTTP 请求一律 403（7 条联动同时失败）。渲染进程带 cookie，所以由它取。
// 这条测试锁的是三段契约：URL/key 的形状、缺席与失败的区分、归一化仍由宿主完成。
import assert from 'node:assert/strict';
import { loadHostModule } from './helpers.mjs';

const { SubUsageService } = await loadHostModule();

const CN = {
	status: 'signed-in', accountId: 'a1', accountName: 'me@example.com', tokenExpiresAtMs: 1, region: 'cn', enabled: true,
	accounts: [{ id: 'a1', accountName: 'me@example.com', edition: 'cn', enterprise: false, region: 'cn', source: 'desktop', tokenExpiresAtMs: 1, selected: true }],
	models: [], enabledModelIds: [],
	credits: {
		total: 2050, consumed: 1522.85, available: 527.15, workAvailable: 75, generalAvailable: 452.15,
		accounts: [{ displayDesc: '基础额度', remain: 452.15, size: 2000, expiresAtMs: 1793000000000, endpoint: 0 }],
		expiry: { within24h: { total: 0, packs: 0 }, within3d: { total: 0, packs: 0 }, within7d: { total: 0, packs: 0 }, expired: { total: 0, packs: 0 } }
	},
	checkin: { claimed: false }
};
const CN_TWO = { ...CN, accounts: [...CN.accounts, { id: 'a2', accountName: 'other@example.com', edition: 'cn', enterprise: false, region: 'cn', source: 'cli', tokenExpiresAtMs: 1, selected: false }] };
const STATUS_A1 = { id: 'a1', credits: { total: 2050, consumed: 1522.85, available: 527.15, workAvailable: 75, generalAvailable: 452.15, accounts: [] } };
const STATUS_A2 = { id: 'a2', credits: { total: 900, consumed: 100, available: 800, workAvailable: 0, generalAvailable: 800, accounts: [] } };
const RACCOON = { status: 'signed-in', nickname: 'r***@x.com', points: { total: 1234, plan: 'Pro' }, expiresAt: 1893000000000 };

function harness(now) {
	const files = new Map();
	const io = {
		readFileSync(path) { if (!files.has(path)) throw Object.assign(new Error('missing'), { code: 'ENOENT' }); return files.get(path); },
		mkdirSync() {}, writeFileSync(path, value) { files.set(path, value); }, chmodSync() {}, renameSync() {}
	};
	// 宿主侧不再发任何本机 HTTP；fetch 若被调用就说明又走回老路了。
	const calls = [];
	const ctx = { get: () => undefined };
	const service = new SubUsageService(ctx, {
		io, configPath: 'memory/config',
		resolveCredentials: async () => undefined,
		resolveEnvironment: () => undefined,
		linkedTimeoutMs: 50,
		...(now ? { now } : {}),
		fetch: async (url) => { calls.push(String(url)); throw new Error('页面代取通道不得再由宿主发本机 HTTP'); }
	});
	return { service, calls };
}
const row = (key, body, status = 200) => ({ key, status, ok: status >= 200 && status < 300, body });

// ── [1] 缺 usage：给出可直接 fetch 的相对 URL 与稳定 key ────────────────────
{
	const { service, calls } = harness();
	const first = await service.linkedStep({ providerId: 'trae', responses: [] });
	assert.equal(first.missing.key, 'usage|region=cn');
	assert.equal(first.missing.url, '/plugins/dsh-connect-trae/usage?region=cn');
	assert.equal(calls.length, 0, '宿主不得自己发请求');
	// workbuddy 走另一个插件名与 query。
	const wb = await service.linkedStep({ providerId: 'workbuddy-global', responses: [] });
	assert.equal(wb.missing.url, '/plugins/dsh-connect-workbuddy/usage?region=global');
	// Raccoon / Loomy 是独立插件，单条 /status。
	const raccoon = await service.linkedStep({ providerId: 'raccoon', responses: [] });
	assert.equal(raccoon.missing.url, '/plugins/dsh-raccoon-connect/status');
	assert.equal(raccoon.missing.key, 'status');
	service.dispose();
}

// ── [2] 单账号：一次 usage 就够，归一化在宿主完成 ───────────────────────────
{
	const { service } = harness();
	const step = await service.linkedStep({ providerId: 'trae', responses: [row('usage|region=cn', CN)] });
	assert.ok(step.entry, '拿到 usage 后必须直接算出条目');
	assert.equal(step.entry.providerId, 'trae');
	assert.equal(step.entry.state, 'ok');
	assert.equal(step.entry.extras.find(x => x.kind === 'balance').value, '527.15 credits');
	service.dispose();
}

// ── [3] 多账号：先要 usage，再逐个要 account-status ─────────────────────────
{
	const { service } = harness();
	const second = await service.linkedStep({ providerId: 'trae', responses: [row('usage|region=cn', CN_TWO)] });
	assert.ok(second.missing, '多账号还要补每个账号的明细');
	assert.equal(second.missing.key, 'account-status|accountId=a1|region=cn');
	assert.equal(second.missing.url, '/plugins/dsh-connect-trae/account-status?region=cn&accountId=a1');
	const third = await service.linkedStep({
		providerId: 'trae',
		responses: [
			row('usage|region=cn', CN_TWO),
			row('account-status|accountId=a1|region=cn', STATUS_A1),
			row('account-status|accountId=a2|region=cn', STATUS_A2)
		]
	});
	assert.ok(third.entry, '补齐明细后应算出条目');
	assert.equal(third.entry.linkedAccounts.length, 2, '两个账号都在');
	assert.equal(third.entry.linkedAccounts[1].extras.find(x => x.kind === 'balance').value, '800 credits', '第二个账号用自己的明细');
	service.dispose();
}

// ── [4] 缺席与失败的区分：缺席也要回一条能看懂的条目，不能安静消失 ─────────
{
	const { service } = harness();
	// 插件没装：走 linkedProvider 的缺席指引（药丸据此显示原因，而不是直接隐藏）。
	const missingPlugin = await service.linkedStep({ providerId: 'raccoon', responses: [row('status', undefined, 404)] });
	assert.equal(missingPlugin.entry.state, 'error');
	assert.match(missingPlugin.entry.error, /未检测到可用额度入口/);
	assert.equal(missingPlugin.entry.providerId, 'raccoon');
	// 独立插件在但该区域未登录：给「去哪儿登录」的话，而不是「没有数据」。
	const signedOut = await service.linkedStep({ providerId: 'trae', responses: [row('usage|region=cn', { status: 'signed-out', accounts: [] })] });
	assert.equal(signedOut.entry.state, 'error');
	assert.match(signedOut.entry.error, /还没有登录 Trae/);
	// 独立插件在场但未登录：**不能**回落 OFM（回落只针对接口缺席），要报「尚未登录」。
	const signedOutDesktop = await service.linkedStep({ providerId: 'raccoon', responses: [row('status', { status: 'signed-out' })] });
	assert.equal(signedOutDesktop.entry.state, 'error');
	assert.match(signedOutDesktop.entry.error, /独立插件尚未登录/);
	const ok = await service.linkedStep({ providerId: 'raccoon', responses: [row('status', RACCOON)] });
	assert.equal(ok.entry.state, 'ok');
	assert.equal(ok.entry.extras.find(x => x.kind === 'balance').value, '1234 积分');
	service.dispose();
}

// ── [4b] 独立插件缺席时仍回落 OFM / EAC（页面代取不改变这条链） ──────────────
{
	const files = new Map();
	const io = {
		readFileSync(path) { if (!files.has(path)) throw Object.assign(new Error('missing'), { code: 'ENOENT' }); return files.get(path); },
		mkdirSync() {}, writeFileSync(path, value) { files.set(path, value); }, chmodSync() {}, renameSync() {}
	};
	// OFM 的 `usage.badge` 走 Connection 进程内 Fetch，与页面代取互不相干。
	let ofmReads = 0;
	const ctx = { get: name => name === 'connection' ? {
		createPeer: () => ({ dispose() {} }),
		createSharedFetchHandler: () => ({ fetch: async request => {
			const body = JSON.parse(await request.text());
			if (String(request.url).includes('/api/channel-pack')) {
				ofmReads += 1;
				return { ok: true, status: 200, json: async () => ({ type: 'server-response', rpcId: body.rpcId, result: { ok: true, value: { provider: 'raccoon', accounts: [{ accountId: 'ofm-1', nickname: 'ofm 账号', balance: { total: 777, packages: [{ name: '包', active: true, remaining: 777, unit: '积分' }] } }] } } }) };
			}
			return { ok: false, status: 404, json: async () => ({}) };
		} })
	} : undefined };
	const service = new SubUsageService(ctx, { io, configPath: 'memory/config', resolveCredentials: async () => undefined, resolveEnvironment: () => undefined, linkedTimeoutMs: 200 });
	const step = await service.linkedStep({ providerId: 'raccoon', responses: [row('status', undefined, 404)] });
	assert.equal(step.entry.state, 'ok', '独立插件缺席 + OFM 在场时由 OFM 补上');
	assert.equal(step.entry.linkedAccounts?.[0]?.providerId, 'raccoon', '账号仍归到同一条联动项');
	assert.ok(step.entry.extras.some(x => String(x.value).includes('777')), 'OFM 的余额被读出来');
	// 独立插件在场但未登录：即便 OFM 可用也不换数据来源（回落只针对接口缺席）。
	ofmReads = 0;
	const signedOut = await service.linkedStep({ providerId: 'raccoon', responses: [row('status', { status: 'signed-out' })], force: true });
	assert.equal(signedOut.entry.state, 'error', '未登录不换来源');
	assert.match(signedOut.entry.error, /独立插件尚未登录/);
	assert.equal(ofmReads, 0, '在场但未登录时不得去问 OFM');
	service.dispose();
}

// ── [4c] 60 秒缓存：轮询不该反复打上游 ──────────────────────────────────────
{
	let clock = 1_700_000_000_000;
	const { service } = harness(() => clock);
	await service.linkedStep({ providerId: 'raccoon', responses: [row('status', RACCOON)] });
	// 缓存命中时不问响应表：空 responses 也能直接给出条目。
	const cached = await service.linkedStep({ providerId: 'raccoon', responses: [] });
	assert.equal(cached.entry.state, 'ok', '60 秒内命中缓存');
	assert.equal(cached.missing, undefined, '命中缓存不得再索要 URL');
	// force 绕过缓存。
	const forced = await service.linkedStep({ providerId: 'raccoon', responses: [], force: true });
	assert.ok(forced.missing, 'force 必须重新取数');
	clock += 61_000;
	const expired = await service.linkedStep({ providerId: 'raccoon', responses: [] });
	assert.ok(expired.missing, '60 秒后重新取数');
	service.dispose();
}

// ── [4d] 非法响应行直接拒绝，不静默丢弃（丢弃会让同一个 key 被反复索要） ────
{
	const { service } = harness();
	await assert.rejects(() => service.linkedStep({ providerId: 'raccoon', responses: [{ key: '', status: 200 }] }), /Invalid linked step response/);
	await assert.rejects(() => service.linkedStep({ providerId: 'raccoon', responses: Array.from({ length: 33 }, (_, i) => row(`k${i}`, {})) }), /Invalid linked step responses/);
	service.dispose();
}

// ── [5] 真实失败要透出来，并且说清是哪一层 ─────────────────────────────────
{
	const { service } = harness();
	// 上游拒绝：走 linkedProvider 的失败条目，文案保留状态码与渠道名。
	const denied = await service.linkedStep({ providerId: 'raccoon', responses: [row('status', { error: 'nope' }, 403)] });
	assert.equal(denied.entry.state, 'error');
	assert.match(denied.entry.error, /HTTP 403/);
	assert.match(denied.entry.error, /小浣熊/);
	// 页面网络层失败与上游拒绝分开说。
	const offline = await service.linkedStep({ providerId: 'raccoon', responses: [row('status', undefined, 0)] });
	assert.match(offline.entry.error, /无法连接本机服务/);
	// 不在页面代取通道里的条目不该被这条路处理。
	await assert.rejects(() => service.linkedStep({ providerId: 'antigravity', responses: [] }), /不需要页面代取额度/);
	await assert.rejects(() => service.linkedStep({ providerId: 'ofm-raccoon', responses: [] }), /不需要页面代取额度/);
	service.dispose();
}

console.log('PASS 页面代取通道：URL/key 契约、单/多账号分步、缺席与失败区分、归一化留在宿主');
