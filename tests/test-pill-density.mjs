// 弹层信息密度核验：把各类提供商形态都渲染一遍，量出「收起状态实际能看到多少内容」。
//
// 这条检查针对的是一类反复出现的问题：某个渠道把十几条说明、多个账号各自一块全部铺开，
// 弹层被撑成一堵墙。只用某一家截图验收不够——形态差异很大（余额型 / 多窗口 / 多账号 /
// 轮换池 / 分池 / 失败），所以这里按形态逐一量化，并断言收起状态的上限。
import assert from 'node:assert/strict';
import { api, renderPill } from './test-client-ofm.mjs';
import { loadHostModule } from './helpers.mjs';
import { READBACK_ENTRIES } from './test-linked-info.mjs';
const host = await loadHostModule();

/** 可见文本按行拆：收起状态的 <details> 只计 summary，内容不计。 */
function visibleLines(node, out = []) {
	if (node == null || typeof node === 'boolean') return out;
	if (typeof node === 'string') { for (const line of node.split('\n')) if (line.trim()) out.push(line.trim()); return out; }
	if (Array.isArray(node)) { for (const child of node) visibleLines(child, out); return out; }
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
const window = (kind, percent, extra = {}) => ({ kind, percent, status: 'ok', ...extra });

const CASES = [
	{ name: '余额型单条', entry: { providerId: 'deepseek', state: 'ok', windows: [], extras: [{ kind: 'balance', value: '12.34 CNY' }] } },
	{ name: '双窗口', entry: { providerId: 'kimi-coding', state: 'ok', windows: [window('5h', 40), window('week', 82)], extras: [] } },
	{ name: 'Anthropic 五窗口', entry: { providerId: 'zai-coding-cn', state: 'ok', windows: [window('5h', 10), window('day', 20), window('week', 30), window('month', 40), window('period', 50)], extras: [{ kind: 'plan', value: 'Pro' }] } },
	{ name: 'AFP 分组', entry: { providerId: 'arkcli-agent-plan', state: 'ok', windows: [window('5h', 10, { groupLabel: 'vision' }), window('5h', 20, { groupLabel: 'harness' }), window('week', 30)], extras: [] } },
	{
		name: 'OFM 单账号 8 条说明',
		entry: { providerId: 'ofm-raccoon', label: '小浣熊 · OFM', state: 'ok', windows: [], extras: [], coverage: 'complete', freshness: 'fresh', ofmAccounts: [acct('a1', '账号甲', 6600, 8)] }
	},
	{
		name: 'OFM 三账号 × 8 条说明',
		entry: {
			providerId: 'ofm-raccoon', label: '小浣熊 · OFM', state: 'ok', windows: [], extras: [], coverage: 'complete', freshness: 'fresh',
			ofmAccounts: [acct('a1', '账号甲', 6600, 8), acct('a2', '账号乙', 6300, 8), acct('a3', '账号丙', 6000, 8)]
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
			ofmAccounts: [
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
	{ name: '五账号余额', entry: { providerId: 'loomy', label: 'Loomy', state: 'ok', windows: [], extras: [], coverage: 'complete', freshness: 'fresh', linkedAccounts: [1, 2, 3, 4, 5].map(i => acct(`l${i}`, `账号${i}`, i * 100, 2)) } },
	{ name: '读取失败', entry: { providerId: 'kimi-coding', state: 'error', error: '读不到额度，请检查登录状态后重试。', windows: [], extras: [], coverage: 'partial', freshness: 'unknown' } }
];

// 收起状态的上限：正文只该剩「结论 + 窗口 + 关键金额」。超出说明又有东西被铺开了。
const LIMITS = { lines: 14, chars: 900, folds: 3 };
const report = [];
for (const { name, entry } of CASES) {
	const tree = await renderPill(entry);
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
	assert.ok(lines.length <= LIMITS.lines, `${name}：弹层收起状态可见 ${lines.length} 行，超过上限 ${LIMITS.lines} —— ${JSON.stringify(lines)}`);
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
