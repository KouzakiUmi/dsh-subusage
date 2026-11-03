// 本机直取：读 DSH 凭据库里的账号凭据，自己调各家上游的只读额度接口。
//
// 这条路径的存在理由：兄弟插件的 `/plugins/*` 路由要浏览器凭据（宿主拿不到），
// 而 Qoder / ZCode 在本机根本没有可用来源（EAC 白名单不含它们、OFM 插件未装）。
// 所以这里锁的是四件事：请求形状对得上各家契约、响应字段映射正确、
// 凭据缺失/过期有可读原因、失败不落缓存（否则用户重新登录后要等一轮）。
import assert from 'node:assert/strict';
import { LocalUsageReader, LOCAL_CHANNELS } from '../lib/local-usage.js';

const NOW = 1_800_000_000_000;
const jsonResponse = (body, status = 200) => ({ ok: status >= 200 && status < 300, status, json: async () => body });

function harness({ responses = {}, credentials = {}, rows = [], now = () => NOW } = {}) {
	const calls = [];
	const reader = new LocalUsageReader({
		accounts: () => rows,
		resolve: async ref => credentials[ref],
		now,
		fetchImpl: async (url, init) => {
			calls.push({ url: String(url), headers: init?.headers, body: init?.body });
			const match = answers(url);
			if (match === undefined) throw new Error(`unexpected url ${url}`);
			if (typeof match === 'function') return match();
			return match && typeof match.status === 'number' ? match : jsonResponse(match);
		},
	});
	const answers = key => {
		for (const [fragment, value] of Object.entries(responses)) if (String(key).includes(fragment)) return value;
		return undefined;
	};
	return { reader, calls };
}

const cred = (extra = {}) => ({ access_token: 'tok', ...extra });

// ── [1] 渠道表：支持哪些、不支持的会被拒绝 ────────────────────────────────
{
	assert.deepEqual(Object.keys(LOCAL_CHANNELS).sort(), ['loomy', 'qoder', 'qodercn', 'raccoon', 'trae', 'zcode']);
	const { reader } = harness();
	assert.throws(() => reader.read('nope'), /未知直取渠道/);
	reader.dispose();
}

// ── [2] Raccoon：Bearer + X-Org-Code，available_points 是总量 ───────────────
{
	const { reader, calls } = harness({
		rows: [{ ref: 'RACCOON_ACCOUNT_A', accountId: 'a1', nickname: '账号甲' }],
		credentials: { RACCOON_ACCOUNT_A: cred({ office_identity: 'org-9' }) },
		responses: {
			'/points/v1/balance': { code: 0, data: { available_points: 6600, reward_points: 100, daily_points: 500, monthly_points: 0, topup_points: 6000 } },
		},
	});
	const value = await reader.read('raccoon', true);
	const row = value.accounts[0];
	assert.equal(row.balance.total, 6600);
	assert.deepEqual(row.balance.packages.map(p => [p.name, p.remaining]), [['奖励积分', 100], ['每日积分', 500], ['会员积分', 0], ['充值积分', 6000]]);
	assert.ok(calls[0].url.startsWith('https://xiaohuanxiong.com/api/web/points/v1/balance'), '打的是公开只读余额接口');
	assert.equal(calls[0].headers.Authorization, 'Bearer tok');
	assert.equal(calls[0].headers['X-Org-Code'], 'org-9', '组织码要透传，否则只读到个人池');
	reader.dispose();
}

// ── [3] Loomy：只认 token 头，Bearer 会被判「缺少 token」 ───────────────────
{
	const { reader, calls } = harness({
		rows: [{ ref: 'LOOMY_ACCOUNT_A', accountId: 'l1', nickname: 'Loomy 账号' }],
		credentials: { LOOMY_ACCOUNT_A: cred() },
		responses: { '/points/records': { code: '000000', data: { balance: 25000, dailyBalance: 0, availableBalance: 25000 } } },
	});
	const value = await reader.read('loomy', true);
	assert.equal(value.accounts[0].balance.total, 25000);
	assert.equal(calls[0].headers.token, 'tok');
	assert.equal(calls[0].headers.Authorization, undefined, '不能发 Bearer');
	reader.dispose();
}

// ── [4] Qoder：两个额度池 + 资源包；企业版没有数字 ──────────────────────────
{
	const usage = {
		qoderUsage: {
			userQuota: { total: 500, used: 500, remaining: 0, unit: 'credits' },
			addOnQuota: { total: 100, used: 0, remaining: 100, unit: 'credits' },
			dedicatedResourcePackages: [{ name: '资源包 A', remaining: 30, unit: 'credits' }],
		},
	};
	const { reader, calls } = harness({
		rows: [{ ref: 'QODER_ACCOUNT_A', accountId: 'q1', nickname: '胡亦康' }],
		credentials: { QODER_ACCOUNT_A: { security_oauth_token: 'sec', access_token: 'plain' } },
		responses: { '/sash/api/v2/me/usage': usage },
	});
	const value = await reader.read('qoder', true);
	assert.equal(value.accounts[0].balance.total, 130);
	assert.deepEqual(value.accounts[0].balance.packages.map(p => p.name), ['套餐额度', '附加额度', '资源包 A'], '包名对齐已装实现：userQuota 叫套餐额度');
	assert.equal(calls[0].headers.Authorization, 'Bearer sec', 'security_oauth_token 优先于 access_token');
	assert.equal(calls[0].headers['Cosy-ClientType'], '10');
	reader.dispose();
}
{
	const { reader } = harness({
		rows: [{ ref: 'Q', accountId: 'q1' }],
		credentials: { Q: { access_token: 'tok' } },
		responses: { '/sash/api/v2/me/usage': { displayMode: 'enterprise', qoderUsage: { userQuota: { remaining: 0, unit: 'credits' } } } },
	});
	const value = await reader.read('qodercn', true);
	assert.equal(value.accounts[0].balance, null, '企业版不下发数字，不能当成 0');
	assert.match(value.accounts[0].error, /企业版/, '企业版是「按设计没有数字」，要如实说，不能报成读取失败');
	reader.dispose();
}

// ── [5] ZCode：用 zcode_jwt + X-Device-Mid，单位是 token ────────────────────
{
	const { reader, calls } = harness({
		rows: [{ ref: 'ZCODE_ACCOUNT_A', accountId: 'z1', nickname: 'ZCode 账号' }],
		credentials: { ZCODE_ACCOUNT_A: { zcode_jwt: 'jwt-value', device_mid: 'dev-1', app_version: '3.14.3' } },
		responses: { '/billing/balance': { code: 0, data: { balances: [{ show_name: 'GLM-5.3-Flash', unit_type: 'token', total_units: 1000, used_units: 400, remaining_units: 600, available_units: 590 }] } } },
	});
	const value = await reader.read('zcode', true);
	assert.equal(value.accounts[0].balance.total, 590, 'available_units 优先于 remaining_units');
	assert.equal(value.accounts[0].balance.packages[0].unit, 'token');
	assert.equal(calls[0].headers['X-Device-Mid'], 'dev-1', '缺这个头会被上游判成参数错误');
	reader.dispose();
}
{
	const { reader, calls } = harness({
		rows: [{ ref: 'Z', accountId: 'z1' }],
		credentials: { Z: { zcode_jwt: 'jwt-value' } },
		responses: {},
	});
	const value = await reader.read('zcode', true);
	assert.equal(value, undefined, '唯一账号读不到 = 通道缺席，交给调用方回退');
	assert.equal(calls.length, 0, '缺必需字段时不该发请求');
	reader.dispose();
}

// ── [6] 凭据缺失 / 过期：发请求之前就拦下，绝不替用户刷新 ────────────────────
{
	const { reader, calls } = harness({ rows: [{ ref: 'missing', accountId: 'x' }], credentials: {}, responses: {} });
	const value = await reader.read('raccoon', true);
	assert.equal(value, undefined, '没凭据就不该装作有数据');
	assert.equal(calls.length, 0);
	reader.dispose();
}
{
	const { reader, calls } = harness({
		rows: [{ ref: 'expired', accountId: 'x' }],
		credentials: { expired: cred({ expires_at: String(NOW - 1000) }) },
		responses: {},
	});
	const value = await reader.read('raccoon', true);
	assert.equal(value, undefined, '过期就不该打上游，更不能自己刷新');
	assert.equal(calls.length, 0);
	reader.dispose();
}
{
	// Qoder 的过期字段叫 expire_time，不是 expires_at。
	const { reader, calls } = harness({
		rows: [{ ref: 'q', accountId: 'q1' }],
		credentials: { q: { access_token: 'tok', expire_time: NOW - 1 } },
		responses: {},
	});
	const value = await reader.read('qoder', true);
	assert.equal(value, undefined, 'Qoder 的 expire_time 也要被认出来');
	assert.equal(calls.length, 0);
	reader.dispose();
}

// ── [7] 上游拒绝与形状变化分开报 ────────────────────────────────────────────
{
	const { reader } = harness({
		rows: [{ ref: 'r', accountId: 'a1' }],
		credentials: { r: cred() },
		responses: { '/points/v1/balance': { code: 200003, message: 'expired' } },
	});
	const value = await reader.read('raccoon', true);
	assert.equal(value, undefined, '上游拒绝 = 本期没数据，回退给别的来源');
	reader.dispose();
}
{
	const { reader } = harness({
		rows: [{ ref: 'r', accountId: 'a1' }],
		credentials: { r: cred() },
		responses: { '/points/v1/balance': jsonResponse({}, 500) },
	});
	const value = await reader.read('raccoon', true);
	assert.equal(value, undefined, 'HTTP 失败同样算没数据');
	reader.dispose();
}

// ── [8] 全失败算通道缺席（要静默回退），部分成功照实返回 ────────────────────
{
	const { reader } = harness({ rows: [{ ref: 'r', accountId: 'a1' }], credentials: { r: cred() }, responses: { '/points/v1/balance': { code: 200003 } } });
	assert.equal(await reader.read('raccoon', true), undefined, '唯一账号读失败 = 没有数据，回退给别的来源');
	reader.dispose();
}
{
	const { reader } = harness({
		rows: [{ ref: 'good', accountId: 'a1' }, { ref: 'bad', accountId: 'a2' }],
		credentials: { good: cred(), bad: {} },
		responses: { '/points/v1/balance': { code: 0, data: { available_points: 10 } } },
	});
	// bad 没有凭据（resolve 返回 undefined），good 正常。
	const value = await reader.read('raccoon', true);
	assert.equal(value.accounts.length, 2, '部分成功要如实返回两个账号行');
	assert.ok(value.accounts.some(row => row.balance?.total === 10));
	assert.match(value.accounts.find(row => row.error)?.error ?? '', /缺少令牌/, '失败那个账号各自带原因');
	reader.dispose();
}

// ── [14] 通道缺席返回 undefined；缓存 60 秒、force 绕过、失败不缓存 ──────────
{
	const { reader } = harness({ rows: [] });
	assert.equal(await reader.read('raccoon', true), undefined, '没有账号 = 通道缺席，交给调用方回退');
	reader.dispose();
}
{
	let clock = NOW;
	const responses = { '/points/v1/balance': { code: 0, data: { available_points: 6600 } } };
	const { reader, calls } = harness({
		rows: [{ ref: 'r', accountId: 'a1' }],
		credentials: { r: cred() },
		responses,
		now: () => clock,
	});
	await reader.read('raccoon');
	await reader.read('raccoon');
	assert.equal(calls.length, 1, '60 秒内复用，不打第二次上游');
	await reader.read('raccoon', true);
	assert.equal(calls.length, 2, 'force 绕过缓存');
	clock += 61_000;
	await reader.read('raccoon');
	assert.equal(calls.length, 3, '过期后重新取');
	reader.dispose();
}
{
	// 失败结果不缓存：用户重新登录后下一轮就该恢复，而不是等 60 秒。
	const { reader, calls } = harness({
		rows: [{ ref: 'r', accountId: 'a1' }],
		credentials: { r: cred() },
		responses: { '/points/v1/balance': { code: 200003 } },
	});
	await reader.read('raccoon');
	await reader.read('raccoon');
	assert.equal(calls.length, 2, '读失败不落缓存，下一轮重新取——用户重新登录后立即恢复');
	reader.dispose();
}


// ── [13] Trae：POST + Cloud-IDE-JWT，剩余 = credits_limit - credits_amount ────
{
	const { reader, calls } = harness({
		rows: [{ ref: 'trae-auth:fake', accountId: 'trae-cn' }],
		credentials: { 'trae-auth:fake': { access_token: 'desk-token', region: 'CN', nickname: '用户甲' } },
		responses: {
			'/web_user_ent_usage': {
				usage_summary: { total_amount: 2600, consumed_amount: 845.72 },
				user_entitlement_pack_list: [
					{ entitlement_base_info: { quota: { credits_limit: 2000 } }, usage: { credits_amount: 345.72 }, display_desc: '福利积分' },
					{ entitlement_base_info: { quota: { credits_limit: 600 } }, usage: { credits_amount: 500 }, display_desc: '签到奖励' },
				],
			},
		},
	});
	const value = await reader.read('trae', true);
	const row = value.accounts[0];
	assert.equal(row.balance.total, 1754.28, '汇总按 total_amount - consumed_amount');
	assert.deepEqual(row.balance.packages.map(p => [p.name, p.remaining]), [['福利积分', 1654.28], ['签到奖励', 100]]);
	assert.equal(row.nickname, '用户甲', '文件型凭据的昵称解密后才有，要覆盖占位值');
	assert.equal(calls[0].headers.Authorization, 'Cloud-IDE-JWT desk-token', '桌面客户端那族凭据');
	assert.equal(calls[0].body, JSON.stringify({ require_usage: true }));
	reader.dispose();
}
{
	// 401 + code 1001 = 凭据不被认（CLI 的 JWT 就是这个下场）。
	const { reader } = harness({
		rows: [{ ref: 'trae-auth:fake', accountId: 'trae-cn' }],
		credentials: { 'trae-auth:fake': { access_token: 'cli-token' } },
		responses: { '/web_user_ent_usage': jsonResponse({ code: 1001, usage_summary: {}, user_entitlement_pack_list: [] }, 401) },
	});
	const value = await reader.read('trae', true);
	assert.equal(value, undefined, '凭据不被认也是没数据，回退给别的来源');
	reader.dispose();
}

// ── [15] Trae 解密：两种头都能解开，自校验与失败路径都不抛给用户 ────────────
{
	const { encryptTraeStorageValue, decryptTraeStorageValue } = await import('../lib/trae-auth.js');
	const payload = JSON.stringify({ token: 'jwt', expiredAt: '2026-11-16T19:50:00Z', userRegion: { region: 'CN' }, account: { username: '用户甲' } });
	for (const type of ['aes', 'aes-private']) {
		const sealed = encryptTraeStorageValue(payload, { type });
		assert.equal(decryptTraeStorageValue(sealed), payload, `${type} 头的往返必须成立`);
		// 改一个 base64 字符就该被自校验挡住，而不是解出乱码。
		const tampered = sealed.slice(0, 40) + (sealed[40] === 'A' ? 'B' : 'A') + sealed.slice(41);
		assert.equal(decryptTraeStorageValue(tampered), undefined, `${type} 头被篡改要判失败`);
	}
}
{
	// 读到的 storage.json 里没有那个键 / 键不是字符串，都算没凭据。
	const { readTraeCredential } = await import('../lib/trae-auth.js');
	const readFile = text => () => text;
	assert.equal(readTraeCredential('x', { readFile: readFile(JSON.stringify({})) }), undefined);
	assert.equal(readTraeCredential('x', { readFile: readFile(JSON.stringify({ 'iCubeAuthInfo://icube.cloudide': 42 })) }), undefined);
	assert.equal(readTraeCredential('x', { readFile: readFile('not json') }), undefined);
}

// ── [16] Trae 解密：读不到 / 解不开都要安静失败，不抛给用户 ────────────────
{
	const { readTraeCredential, decryptTraeStorageValue, traeStorageCandidates } = await import('../lib/trae-auth.js');
	assert.equal(decryptTraeStorageValue('not-base64-ciphertext'), undefined, '太短的密文直接放弃');
	assert.equal(decryptTraeStorageValue(Buffer.from('746305100000' + '00'.repeat(200), 'hex').toString('base64')), undefined, '自校验不过就放弃');
	assert.equal(readTraeCredential('/nonexistent/storage.json'), undefined);
	assert.ok(traeStorageCandidates({ APPDATA: 'C:/Users/x/AppData/Roaming' }).some(path => path.includes('Trae CN')), '候选路径要覆盖 Trae CN 目录');
}

// ── [17] 「可达但无数字」只保留给企业版；形状变化与业务失败必须回退 ─────────
{
	// 上游 200 但结构变了（没有 qoderUsage）：这是「没读到」，不是「按设计没有」。
	const { reader } = harness({
		rows: [{ ref: 'q', accountId: 'q1' }],
		credentials: { q: { access_token: 'tok' } },
		responses: { '/sash/api/v2/me/usage': { success: false } },
	});
	assert.equal(await reader.read('qoder', true), undefined, '结构变化要回退，不能顶掉能读到数的来源');
	reader.dispose();
}
{
	// 小浣熊 code 0 但没有 data：同样属于「没读到」。
	const { reader } = harness({
		rows: [{ ref: 'r', accountId: 'a1' }],
		credentials: { r: cred() },
		responses: { '/points/v1/balance': { code: 0, data: {} } },
	});
	assert.equal(await reader.read('raccoon', true), undefined, '没有 available_points 就是查不到');
	reader.dispose();
}

// ── [18] 时间字段可能是秒：按秒换算，别把未过期判成过期 ────────────────────
{
	const seconds = Math.floor(NOW / 1000) + 3600;
	const { reader, calls } = harness({
		rows: [{ ref: 'r', accountId: 'a1' }],
		credentials: { r: cred({ expires_at: seconds }) },
		responses: { '/points/v1/balance': { code: 0, data: { available_points: 5 } } },
	});
	const value = await reader.read('raccoon', true);
	assert.equal(calls.length, 1, '秒级时间戳若当毫秒读会被判成早就过期，这里必须发请求');
	assert.equal(value.accounts[0].balance.total, 5);
	reader.dispose();
}

// ── [19] ZCode 空 balances 是「0 个桶」的合法形态，不是查不到 ───────────────
{
	const { reader } = harness({
		rows: [{ ref: 'ZCODE_ACCOUNT_A', accountId: 'z1' }],
		credentials: { ZCODE_ACCOUNT_A: { zcode_jwt: 'jwt', device_mid: 'dev' } },
		responses: { '/billing/balance': { code: 0, data: { balances: [], plans: [] } } },
	});
	const value = await reader.read('zcode', true);
	assert.equal(value.accounts[0].balance.total, 0, '真实 0 不能报成「查不到」');
	reader.dispose();
	// 但 balances 字段整体缺失仍是形状变化 → 回退。
	const { reader: other } = harness({
		rows: [{ ref: 'ZCODE_ACCOUNT_A', accountId: 'z1' }],
		credentials: { ZCODE_ACCOUNT_A: { zcode_jwt: 'jwt', device_mid: 'dev' } },
		responses: { '/billing/balance': { code: 0, data: {} } },
	});
	assert.equal(await other.read('zcode', true), undefined);
	other.dispose();
}

// ── [20] 成功码可能是字符串（ZCode 文档化下发字符串码） ────────────────────
{
	const { reader } = harness({
		rows: [{ ref: 'ZCODE_ACCOUNT_A', accountId: 'z1' }],
		credentials: { ZCODE_ACCOUNT_A: { zcode_jwt: 'jwt', device_mid: 'dev' } },
		responses: { '/billing/balance': { code: '0', data: { balances: [{ show_name: 'GLM', unit_type: 'token', available_units: 7 }] } } },
	});
	const value = await reader.read('zcode', true);
	assert.equal(value?.accounts[0].balance.total, 7, '字符串 "0" 是成功码，不是拒绝');
	reader.dispose();
}

// ── [21] Trae：非中国版账号不该被发到 CN 网关 ─────────────────────────────
{
	const { reader, calls } = harness({
		rows: [{ ref: 'trae-auth:x', accountId: 'trae-cn' }],
		credentials: { 'trae-auth:x': { access_token: 'tok', region: 'AI' } },
		responses: {},
	});
	assert.equal(await reader.read('trae', true), undefined);
	assert.equal(calls.length, 0, '区域不匹配就别发请求');
	reader.dispose();
}

// ── [22] Trae 账号池：一个文件里的多个账号都要列出来 ──────────────────────
{
	const { readTraeCredentials } = await import('../lib/trae-auth.js');
	const pool = { version: 2, credentials: [
		{ accessToken: 't1', refreshToken: 'r1', userId: '111', accountName: '甲', userRegion: { region: 'CN' }, expiresAtMs: NOW + 1000 },
		{ accessToken: 't2', refreshToken: 'r2', userId: '222', accountName: '乙', userRegion: { region: 'CN' }, expiresAtMs: NOW + 1000 },
		{ accessToken: '', userId: '333', accountName: '无令牌' },
	] };
	const rows = readTraeCredentials('pool', { readFile: () => JSON.stringify(pool) });
	assert.equal(rows.length, 2, '没有令牌的条目要跳过');
	assert.deepEqual(rows.map(row => row.nickname), ['甲', '乙']);
	assert.deepEqual(rows.map(row => row.userId), ['111', '222']);
	assert.equal(rows[0].region, 'CN');
	assert.equal(readTraeCredentials('pool', { readFile: () => JSON.stringify({ version: 2, credentials: [] }) }), undefined);
}
console.log('PASS 本机直取：Raccoon / Loomy / Qoder / QoderCN / ZCode / Trae 的请求形状、字段映射、凭据拦截与缓存');
