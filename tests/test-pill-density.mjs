// 弹层信息密度核验：把各类提供商形态都渲染一遍，量出「收起状态实际能看到多少内容」。
//
// 这条检查针对的是一类反复出现的问题：某个渠道把十几条说明、多个账号各自一块全部铺开，
// 弹层被撑成一堵墙。只用某一家截图验收不够——形态差异很大（余额型 / 多窗口 / 多账号 /
// 轮换池 / 分池 / 失败），所以这里按形态逐一量化，并断言收起状态的上限。
import assert from 'node:assert/strict';
import { api, renderPill } from './test-client-ofm.mjs';
import { loadHostModule } from './helpers.mjs';
import { READBACK_ENTRIES } from './test-linked-info.mjs';
import { normalizeWorkBuddy } from '../lib/connect-usage.js';
const host = await loadHostModule();

/** 可见文本按行拆：收起状态的 <details> 只计 summary，内容不计。 */
function visibleLines(node, out = []) {
	if (node == null || typeof node === 'boolean') return out;
	if (typeof node === 'string') { for (const line of node.split('\n')) if (line.trim()) out.push(line.trim()); return out; }
	if (Array.isArray(node)) { for (const child of node) visibleLines(child, out); return out; }
	if (typeof node.type === 'function') { visibleLines(node.type({ ...node.props, children: node.children }), out); return out; }
	const kids = node.children || [];
	// 账号切换按钮是单行 flex（名称与金额均 nowrap），图标/名称/余额不能算成三行。
	if (node.type === 'button' && typeof node.props?.['aria-pressed'] === 'boolean' && node.props?.style?.display === 'flex') {
		const row = [];
		for (const child of kids) visibleLines(child, row);
		if (row.length) out.push(row.join(' · '));
		return out;
	}
	if (node.type === 'details' && node.props?.open !== true) {
		for (const child of kids) if (child?.type === 'summary') visibleLines(child, out);
		return out;
	}
	for (const child of kids) visibleLines(child, out);
	return out;
}
function dialogOf(node) {
	if (!node || typeof node !== 'object') return null;
	if (Array.isArray(node)) { for (const child of node) { const hit = dialogOf(child); if (hit) return hit; } return null; }
	if (node.props?.role === 'dialog') return node;
	for (const child of node.children || []) { const hit = dialogOf(child); if (hit) return hit; }
	return null;
}
const dialogText = tree => visibleLines(dialogOf(tree)).join(' ');
/** 只收账号切换按钮行（徽标所在处），排除 <p role=note> 的路由行——路由行合法回报遥测。 */
function accountRowsOf(node, out = []) {
	if (!node || typeof node !== 'object') return out;
	if (Array.isArray(node)) { for (const child of node) accountRowsOf(child, out); return out; }
	if (typeof node.type === 'function') { accountRowsOf(node.type({ ...node.props, children: node.children }), out); return out; }
	if (node.type === 'button' && typeof node.props?.['aria-pressed'] === 'boolean') {
		const row = []; visibleLines(node, row); out.push(row.join(' '));
	}
	for (const child of node.children || []) accountRowsOf(child, out);
	return out;
}

const ISO = '2026-11-27T17:37:48.000Z';
const note = (i) => [
	{ kind: 'note', value: `包${i}：${i * 10} credits` },
	{ kind: 'note', value: `包${i} 到期：${ISO}` }
];
const acct = (id, name, balance, notes = 0) => ({
	accountId: id, account: name, state: 'ok', windows: [], coverage: 'complete', freshness: 'fresh',
	authStatus: 'present', authExpiresAt: '2027-01-01T00:00:00.000Z',
	extras: [{ kind: 'balance', value: `${balance} 积分` }, ...Array.from({ length: notes }, (_, i) => note(i + 1)).flat()]
});
const wbNow = Date.now();
const wbTotals = [3736.92, 3391.86, 3695.93, 4177.31];
const wbRows = wbTotals.map((total, i) => ({ id: `wb-${i + 1}`, accountName: `账号${i + 1}`, credits: i === 3 ? { total, packages: [] } : total }));
const window = (kind, percent, extra = {}) => ({ kind, percent, status: 'ok', ...extra });

const CASES = [
	{ name: '余额型单条', entry: { providerId: 'deepseek', state: 'ok', windows: [], extras: [{ kind: 'balance', value: '12.34 CNY' }] } },
	{ name: '双窗口', entry: { providerId: 'kimi-coding', state: 'ok', windows: [window('5h', 40), window('week', 82)], extras: [] } },
	{ name: 'Anthropic 五窗口', entry: { providerId: 'zai-coding-cn', state: 'ok', windows: [window('5h', 10), window('day', 20), window('week', 30), window('month', 40), window('period', 50)], extras: [{ kind: 'plan', value: 'Pro' }] } },
	{ name: 'AFP 分组', entry: { providerId: 'arkcli-agent-plan', state: 'ok', windows: [window('5h', 10, { groupLabel: 'vision' }), window('5h', 20, { groupLabel: 'harness' }), window('week', 30)], extras: [] } },
	{
		name: 'OFM 单账号 8 条说明',
		entry: { providerId: 'ofm-raccoon', label: '小浣熊 · OFM', state: 'ok', windows: [], extras: [], coverage: 'complete', freshness: 'fresh', linkedAccounts: [acct('a1', '账号甲', 6600, 8)] }
	},
	{
		name: 'OFM 三账号 × 8 条说明',
		entry: {
			providerId: 'ofm-raccoon', label: '小浣熊 · OFM', state: 'ok', windows: [], extras: [], coverage: 'complete', freshness: 'fresh',
			linkedAccounts: [acct('a1', '账号甲', 6600, 8), acct('a2', '账号乙', 6300, 8), acct('a3', '账号丙', 6000, 8)]
		}
	},
	{
		name: '独立插件多账号',
		entry: {
			providerId: 'workbuddy', label: 'WorkBuddy', state: 'ok', windows: [], coverage: 'complete', freshness: 'fresh',
			linkedAccounts: [
				{ ...acct('w1', '主账号', 5200, 3), accountActive: true, accountMode: 'fixed' },
				{ ...acct('w2', '备用账号', 3200, 3), accountMode: 'fixed' }
			]
		}
	},
	{
		name: 'OFM 两账号窗口',
		entry: {
			providerId: 'ofm-cline', label: 'Cline · OFM', state: 'ok', windows: [], extras: [], coverage: 'partial', freshness: 'fresh',
			linkedAccounts: [
				{ ...acct('c1', '账号甲', 0), windows: [window('5h', 20), window('week', 30)], extras: [] },
				{ ...acct('c2', '账号乙', 0), windows: [window('5h', 40)], extras: [] }
			]
		}
	},
	{
		name: 'Command Code 轮换池',
		entry: {
			providerId: 'commandcode', label: 'Command Code', state: 'ok', coverage: 'partial', freshness: 'fresh',
			windows: [window('5h', 30)],
			extras: [{ kind: 'balance', value: '120 credits' }],
			accountPool: {
				mode: 'auto', total: 4, available: 2, blockedCount: 0, unusableCount: 0, exhausted: false,
				accounts: [1, 2, 3, 4].map(i => ({ id: `acc-${i}`, label: `账户 ${i}`, state: 'ok', usable: i <= 2, windows: [window('5h', i * 20)] }))
			}
		}
	},
	{
		name: 'Antigravity 分池',
		entry: {
			providerId: 'antigravity', label: 'Antigravity', state: 'ok', coverage: 'partial', freshness: 'fresh',
			windows: [
				{ kind: '5h', percent: 20, status: 'ok', groupLabel: 'gemini' },
				{ kind: 'week', percent: 40, status: 'ok', groupLabel: 'gemini' },
				{ kind: '5h', percent: 75, status: 'ok', groupLabel: 'claude-gpt' }
			],
			extras: []
		}
	},
	...READBACK_ENTRIES.map(entry => ({ name: `${entry.label} 实读余额形态`, entry })),
	{ name: 'WorkBuddy 四账号（余额完整、仅当前账号有包明细）', entry: normalizeWorkBuddy({ plugin: 'workbuddy', status: 'signed-in', generatedAt: wbNow, accountReadings: wbRows, pool: { enabled: true, accounts: wbRows.map((row, i) => ({ accountId: row.id, current: i === 3 })) } }, 'workbuddy', wbNow) },
	{ name: '五账号余额', entry: { providerId: 'loomy', label: 'Loomy', state: 'ok', windows: [], extras: [], coverage: 'complete', freshness: 'fresh', linkedAccounts: [1, 2, 3, 4, 5].map(i => acct(`l${i}`, `账号${i}`, i * 100, 2)) } },
	{
		// Magpie 聚合卡：按 provider 分组平铺；组数超预算时非焦点组折叠（summary 仍带组名与数量）。
		name: 'Magpie 三渠道分组',
		entry: {
			providerId: 'magpie', label: 'Magpie', state: 'ok', windows: [], extras: [], coverage: 'complete', freshness: 'fresh',
			linkedAccounts: [
				{ ...acct('m-cursor', 'Cursor · a@x.dev', 0), providerGroup: 'cursor', providerName: 'Cursor', accountActive: true, accountMode: 'auto', windows: [window('5h', 40), window('month', 82)], extras: [{ kind: 'plan', value: 'Pro' }] },
				{ ...acct('m-codex', 'Codex · b@y.dev', 0), providerGroup: 'codex', providerName: 'Codex', windows: [window('week', 10)], extras: [{ kind: 'plan', value: 'Plus' }] },
				{ ...acct('m-trae', 'Trae CN · c@z.dev', 0), providerGroup: 'trae-cn', providerName: 'Trae 国内版', windows: [window('5h', 95)], extras: [] }
			],
			routeContext: { provider: 'codex', providerName: 'Codex', account: 'b@y.dev', model: 'codex/swe-2', req: 'auto/auto-claude-opus-5-5', group: true, at: '2026-11-06T04:59:00Z', cardId: 'm-codex' }
		}
	},
	{
		// 同形态 + 路由记录：焦点组（codex）排最前且平铺，其余组折叠为「组名 · n 张」一行。
		name: 'Magpie 多分组折叠',
		entry: {
			providerId: 'magpie', label: 'Magpie', state: 'ok', windows: [], extras: [], coverage: 'complete', freshness: 'fresh',
			linkedAccounts: ['cursor', 'codex', 'copilot', 'trae-cn', 'devin', 'minimax-code', 'kimi', 'volcengine'].flatMap((g, gi) => [1, 2].map(n => ({
				accountId: `mg-${g}-${n}`, account: `${g} · u${n}@x.dev`, providerGroup: g, providerName: g,
				state: 'ok', windows: [window('5h', gi * 10)], extras: [], coverage: 'complete', freshness: 'fresh'
			}))),
			routeContext: { provider: 'codex', providerName: 'codex', req: 'auto/auto-claude-opus-5-5', group: true }
		}
	},
	{
		// 路由命中 Antigravity 卡 + 模型是 gemini 家族：正文只给 gemini 池两窗（5h/7d），
		// non-gemini 与 gemini-argon 池收窄掉；路由行加「池 Gemini」提示。
		// 窗形照抄 normalizeMagpie 去重后的产出：模型级行带 groupLabel 池词汇。
		name: 'Magpie 反重力池收窄',
		entry: {
			providerId: 'magpie', label: 'Magpie', state: 'ok', windows: [], extras: [], coverage: 'complete', freshness: 'fresh',
			linkedAccounts: [
				{
					accountId: 'm-agy', account: 'Antigravity · u@x.dev', providerGroup: 'antigravity', providerName: 'Antigravity',
					state: 'ok', coverage: 'complete', freshness: 'fresh',
					windows: [
						window('week', 100, { detail: { note: 'Claude & GPT · 7 days' }, groupLabel: 'non-gemini' }),
						window('week', 0, { detail: { note: 'Gemini 4 Argon' }, groupLabel: 'gemini-argon' }),
						window('week', 36, { detail: { note: 'Gemini · 7 days' }, groupLabel: 'gemini' }),
						window('5h', 0, { detail: { note: 'Gemini · 5 hours' }, groupLabel: 'gemini' })
					],
					quotas: [
						{ type: 'window', order: 0, period: 'week', percent: 100, pool: 'non-gemini', poolLabel: 'non-gemini', poolScope: 'independent' },
						{ type: 'window', order: 1, period: 'week', percent: 0, pool: 'gemini-argon', poolLabel: 'gemini-argon', poolScope: 'independent' },
						{ type: 'window', order: 2, period: 'week', percent: 36, pool: 'gemini', poolLabel: 'gemini', poolScope: 'independent' },
						{ type: 'window', order: 3, period: '5h', percent: 0, pool: 'gemini', poolLabel: 'gemini', poolScope: 'independent' }
					],
					extras: [{ kind: 'plan', value: 'Google AI Pro' }]
				},
				{ ...acct('m-codex', 'Codex · b@y.dev', 0), providerGroup: 'codex', providerName: 'Codex', windows: [window('week', 10)], extras: [] }
			],
			routeContext: { provider: 'antigravity', providerName: 'Antigravity', account: 'u@x.dev', model: 'gemini-4-flash', req: 'antigravity/gemini-4-flash', at: '2026-11-06T01:59:00Z', cardId: 'm-agy' }
		}
	},
	{
		// 上次路由是 Devin（已用尽），当前选中 kimi/k3.1-pro：应按模型名前缀切到 kimi 卡，
		// 不要卡在「上次路由」的日已用尽横幅。
		name: 'Magpie 模型前缀归组',
		entry: {
			providerId: 'magpie', label: 'Magpie', state: 'ok', windows: [], extras: [], coverage: 'complete', freshness: 'fresh',
			linkedAccounts: [
				{ accountId: 'm-devin', account: 'Devin · d@x.dev', providerGroup: 'devin', providerName: 'Devin', state: 'ok', coverage: 'complete', freshness: 'fresh', windows: [window('day', 100, { status: 'rate-limited' }), window('week', 50)], extras: [] },
				{ accountId: 'm-kimi', account: 'Kimi · k@x.dev', providerGroup: 'kimi', providerName: 'Kimi', state: 'ok', coverage: 'complete', freshness: 'fresh', windows: [window('week', 20)], extras: [] }
			],
			models: [{ id: 'auto/kimi-k3.1-pro', owned_by: 'kimi' }],
			routeContext: { provider: 'devin', providerName: 'Devin', account: 'd@x.dev', model: 'swe-2', req: 'devin/swe-2', at: '2026-11-06T01:32:00Z', cardId: 'm-devin' }
		}
	},
	{ name: '读取失败', entry: { providerId: 'kimi-coding', state: 'error', error: '读不到额度，请检查登录状态后重试。', windows: [], extras: [], coverage: 'partial', freshness: 'unknown' } }
];

// 收起状态的上限：正文只该剩「结论 + 窗口 + 关键金额」。超出说明又有东西被铺开了。
// 行数上限按窗口条数放宽：每条窗口卡占 3 行（标题 + 大数字 + 说明），这是正文密度
// 的真实下限——「≤14 行」只适用于 ≤4 窗的条目，多窗卡按 8 + 3×窗数算。
const LIMITS = { lines: 14, chars: 900, folds: 3 };
const report = [];
for (const { name, entry } of CASES) {
	const tree = await renderPill(entry);
	const allWindows = (entry.windows || []).length ? entry.windows : (entry.linkedAccounts || []).flatMap(a => a.windows || []);
	const windowCount = allWindows.length;
	const groupLabels = new Set(allWindows.map(w => w.groupLabel).filter(Boolean)).size;
	// 轮换池卡有账户池明细块（池汇总 + 账户行 + 默认账户说明），不在窗口公式里。
	const accountRows = windowCount === 0 ? (entry.linkedAccounts || []).length : 0;
	const lineLimit = name === 'Command Code 轮换池' ? 18
		: accountRows ? 5 + accountRows + 1
		: 9 + 3 * windowCount + groupLabels;
	// 只量弹层本身：药丸按钮那几行不属于「点开之后的信息量」。
	const dialog = (function find(node) {
		if (!node || typeof node !== 'object') return null;
		if (Array.isArray(node)) { for (const child of node) { const hit = find(child); if (hit) return hit; } return null; }
		if (node.props?.role === 'dialog') return node;
		for (const child of node.children || []) { const hit = find(child); if (hit) return hit; }
		return null;
	})(tree);
	assert.ok(dialog, `${name}：弹层必须存在`);
	const lines = visibleLines(dialog);
	const text = lines.join('\n');
	const folds = [];
	(function walk(node) {
		if (!node || typeof node !== 'object') return;
		if (Array.isArray(node)) { node.forEach(walk); return; }
		if (node.type === 'details') folds.push(node);
		(node.children || []).forEach(walk);
	})(tree);
	report.push({ name, lines: lines.length, chars: text.length, folds: folds.length });
	assert.ok(lines.length <= lineLimit, `${name}：弹层收起状态可见 ${lines.length} 行，超过上限 ${lineLimit} —— ${JSON.stringify(lines)}`);
	assert.ok(text.length <= LIMITS.chars, `${name}：收起状态可见 ${text.length} 字符，超过上限 ${LIMITS.chars}`);
	assert.ok(folds.every(node => node.props?.open !== true), `${name}：折叠块默认必须收起`);
	assert.ok(!/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/.test(text), `${name}：可见文本里不得出现裸 ISO 时间`);
	assert.ok(!text.includes('包1：'), `${name}：积分包明细必须在折叠内`);
}

// 具体形态的关键信息必须在正文：折叠不能把唯一的数据一起折掉。
{
	const balance = await renderPill(CASES[0].entry);
	assert.ok(visibleLines(balance).join(' ').includes('12.34 CNY'), '余额型的余额必须在正文');
	const windows = await renderPill(CASES[1].entry);
	assert.ok(visibleLines(windows).join(' ').includes('%'), '窗口型的百分比必须在正文');
	const ofmOne = await renderPill(CASES[4].entry);
	const ofmText = visibleLines(ofmOne).join(' ');
	assert.ok(ofmText.includes('6600 积分'), '单账号时账号余额必须在正文');
	const ofmMany = await renderPill(CASES[5].entry);
	// 账号全部平铺：每个账号的余额与名字都在收起列表可见，而不是把其余账号折成一条「其他账号」。
	const manyText = visibleLines(ofmMany).join(' ');
	assert.ok(manyText.includes('6600 积分') && manyText.includes('6300 积分') && manyText.includes('6000 积分'), '多账号时每个账号的余额都应在收起列表可见');
	assert.ok(manyText.includes('账号甲') && manyText.includes('账号乙') && manyText.includes('账号丙'), '多账号时每个账号都应在收起列表可见');
	assert.ok(!manyText.includes('其他账号'), '多账号时不再把其余账号折叠');
}

// 模型 → 池收窄：gemini 路由模型只显示 Gemini 池的两扇窗，其它池不进正文，路由行给池名。
{
	const agy = await renderPill(CASES.find(c => c.name === 'Magpie 反重力池收窄').entry);
	const dialog = (function find(node) {
		if (!node || typeof node !== 'object') return null;
		if (Array.isArray(node)) { for (const child of node) { const hit = find(child); if (hit) return hit; } return null; }
		if (node.props?.role === 'dialog') return node;
		for (const child of node.children || []) { const hit = find(child); if (hit) return hit; }
		return null;
	})(agy);
	const text = visibleLines(dialog).join(' ');
	assert.ok(text.includes('Gemini · 7 天') && text.includes('Gemini · 5 小时'), 'Gemini 路由模型应显示 Gemini 池窗口（zh 下周期翻译）');
	assert.ok(!text.includes('Claude & GPT · 7 days'), '未命中模型的池不应显示');
	assert.ok(!text.includes('Gemini 4 Argon'), '未命中模型的 Argon 池不应显示');
	assert.ok(text.includes('Gemini'), '路由行应给池名');
}

// 模型名归组：上次路由 Devin 已用尽，具体模型前缀与 auto/group 目录归组都应切到 kimi。
{
	const caseEntry = CASES.find(c => c.name === 'Magpie 模型前缀归组').entry;
	const stuckText = dialogText(await renderPill(caseEntry)); // 无 modelId → 仍跟上次路由 Devin
	assert.ok(stuckText.includes('已用尽') || stuckText.includes('日'), '无 modelId 时仍跟上次路由 Devin');
	for (const modelId of ['kimi/k3.1-pro', 'auto/kimi-k3.1-pro', 'group/kimi-k3.1-pro']) {
		const text = dialogText(await renderPill(caseEntry, { modelId }));
		assert.ok(text.includes('Kimi') || text.includes('周'), `${modelId} 应命中 kimi 卡`);
		assert.ok(!text.includes('已用尽'), `${modelId} 不应再显示 Devin 日已用尽横幅`);
	}
	// 旧 Host / 迟到快照可能把 Devin cardId 留在 live:kimi 上；Client 必须校验 card 的分组。
	const staleLive = { ...caseEntry, routeContext: { ...caseEntry.routeContext, live: true, provider: 'kimi', providerName: 'Kimi', cardId: 'm-devin' } };
	const liveText = dialogText(await renderPill(staleLive, { modelId: 'kimi/k3.1-pro' }));
	assert.ok(!liveText.includes('已用尽'), 'live provider 与 cardId 冲突时不得回指旧渠道卡');
}

// 切会话：magpie 的路由遥测是整机全局的（不分会话，DSH 也不发 X-Magpie-Session）。
// 另一个对话正在跑的请求不能当成本会话的命中卡——否则收窄到别的渠道，或本会话模型
// 归不出组时一起退回聚合总览。
{
	const caseEntry = CASES.find(c => c.name === 'Magpie 模型前缀归组').entry;
	// 本会话模型 kimi/k3.1-pro，但遥测报的是另一个对话的 devin/swe-2：按本会话模型归组。
	const foreignLive = { ...caseEntry, routeContext: { live: true, provider: 'devin', providerName: 'Devin', account: 'd@x.dev', model: 'swe-2', req: 'devin/swe-2', cardId: 'm-devin' } };
	const foreignText = dialogText(await renderPill(foreignLive, { modelId: 'kimi/k3.1-pro' }));
	assert.ok(foreignText.includes('Kimi'), '本会话模型归组应命中 kimi 卡');
	assert.ok(!foreignText.includes('已用尽'), '别的对话渠道的用尽横幅不得画进本会话');
	// 路由行仍然如实回报遥测（Devin），但明确标出它属于别的对话。
	assert.ok(foreignText.includes('Devin') && foreignText.includes('其他对话的请求'), '路由行要标出这条记录属于别的对话');
	// 账号行的徽标同样走归属过滤：别的对话在途请求带的 cardId 不得挂「正在服务/上次命中」。
	// 路由行是 <p role=note>，账号按钮在 dialogOf 之外单独收集比对。
	const foreignRows = accountRowsOf(await renderPill(foreignLive, { modelId: 'kimi/k3.1-pro' }));
	assert.ok(foreignRows.length >= 2, '聚合卡应平铺账号行');
	assert.ok(foreignRows.every(row => !row.includes('正在服务') && !row.includes('上次命中')), '别的对话的 cardId 不得标成正在服务或上次命中');
	// 模型归不出组时也不能拿别人的渠道顶替：如实退回聚合总览（两张卡都平铺）。
	const unknownText = dialogText(await renderPill(foreignLive, { modelId: 'unknownvendor/some-model' }));
	assert.ok(unknownText.includes('Devin') && unknownText.includes('Kimi'), '认不出模型时退回聚合总览，逐卡平铺');
	// 同一次请求（req 与本会话模型一致）时 live 仍压过模型前缀——截图里 devin/swe-2 由 kimi 承接就是这一形态。
	const ownLive = { ...caseEntry, routeContext: { live: true, provider: 'kimi', providerName: 'Kimi', model: 'k3.1-pro', req: 'devin/swe-2', cardId: 'm-kimi' } };
	const ownText = dialogText(await renderPill(ownLive, { modelId: 'devin/swe-2' }));
	assert.ok(ownText.includes('Kimi') && !ownText.includes('已用尽'), '本会话在途请求仍按 live 命中实际承接的卡');
	assert.ok(!ownText.includes('其他对话的请求'), '属于本会话的请求不该标成别的对话');
	// 遥测没报请求模型时无法证伪：维持原行为（认它），不误判成别的对话。
	const noReq = { ...caseEntry, routeContext: { live: true, provider: 'kimi', providerName: 'Kimi', model: 'k3.1-pro', cardId: 'm-kimi' } };
	const noReqText = dialogText(await renderPill(noReq, { modelId: 'devin/swe-2' }));
	assert.ok(noReqText.includes('Kimi') && !noReqText.includes('其他对话的请求'), 'req 缺席时不得把在途记录误判成别的对话');
}

// 中文额度名按真实 Magpie 形态覆盖；英文环境保留原名，未知名称不硬翻。
{
	const zh = key => api.zh[key] ?? key, en = key => api.en[key] ?? key;
	for (const [raw, expected] of [['Chat requests', '聊天请求'], ['1 day', '1 天'], ['Token Plan', 'Token 套餐'], ['Add-on credits', '附赠积分'], ['Unlimited', '不限量']])
		assert.equal(api.displayQuotaName(raw, zh, () => 'zh-CN'), expected);
	assert.equal(api.displayQuotaName('Grok Bot', zh, () => 'zh-CN'), 'Grok Bot');
	assert.equal(api.displayQuotaName('Chat requests', en, () => 'en-US'), 'Chat requests');
	assert.equal(api.displayQuotaName('1 day', en, () => 'en-US'), '1 day');
}

// 工具报告同一类问题：说明逐条拼接时一行能到四十多段。这里量「报告里该家占几行」。
{
	const notes = Array.from({ length: 40 }, (_, i) => ({ kind: 'note', value: `包${i + 1}：${i * 3} credits` }));
	const value = {
		providers: [
			{ providerId: 'ofm-buddy', label: 'CodeBuddy · OFM', state: 'ok', windows: [], coverage: 'complete', freshness: 'fresh', extras: [{ kind: 'balance', value: '3683.98 credits' }, ...notes] },
			{ providerId: 'kimi-coding', label: 'Kimi', state: 'ok', windows: [window('5h', 40), window('week', 82)], extras: [] }
		]
	};
	const text = host.formatQuotaText(value);
	const buddyLine = text.split(String.fromCharCode(10)).find(line => line.startsWith('CodeBuddy')) ?? '';
	assert.ok(buddyLine.includes('bal' + 'ance: 3683.98 credits'), '余额仍要报出来');
	assert.ok(buddyLine.includes('说明 40 条'), '四十条说明收敛成一句计数');
	assert.ok(!buddyLine.includes('包40'), '报告里不逐条列积分包');
	assert.ok(buddyLine.length <= 220, `单家报告一行不应超过 220 字符（实际 ${buddyLine.length}）`);
	assert.ok(text.split(String.fromCharCode(10)).length <= 12, '两家报告不超过 12 行');
}

console.log('弹层密度核验：' + report.map(row => `${row.name} ${row.lines}行/${row.chars}字/${row.folds}折`).join(' · '));
console.log(`PASS 弹层信息密度：${CASES.length}种形态收起状态均在上限内，关键金额与窗口保持可见`);
