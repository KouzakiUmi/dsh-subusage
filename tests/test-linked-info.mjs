// 使用本次工具实读的脱敏余额回放真实 Client；账号标签为测试别名，未知容量不补造。
import assert from 'node:assert/strict';
import { normalizeEac } from '../lib/eac-usage.js';
import { api, html, renderPill, Hooks, nodes } from './test-client-ofm.mjs';

const t = key => api.zh[key] ?? key;
const options = providerId => ({ providerId, t, getLocale: () => 'zh' });
const entryFor = (id, label, values, unit, sameName = false) => normalizeEac({ accounts: values.map((total, i) => ({
 accountId: `${id}-${i + 1}`, nickname: sameName ? '同名账号' : `账号 ${i + 1}`,
 balance: { total, packages: [{ name: '可用额度', remaining: total, unit }] }
})) }, id, label);

// 2026-11-04 本次 subusage_quota(refresh:true) 返回的余额；只回放数字，不包含凭据/真实账号名。
export const READBACK_ENTRIES = [
 entryFor('loomy', 'Loomy', [24473, 20000], '积分', true),
 entryFor('trae', 'TRAE', [572.8400000000001, 1320.1], 'credits'),
 entryFor('raccoon', 'Raccoon', [6354, 6900], '积分'),
 entryFor('ofm-qoder', 'Qoder', [100], 'credits'),
 entryFor('ofm-qodercn', 'Qoder 中国版', [2644], 'credits'),
];
const expected = ['总 44473 积分', '总 1892.94 credits', '总 13254 积分', '100 credits', '2644 credits'];
for (const [i, entry] of READBACK_ENTRIES.entries()) {
 const status = api.computeStatus(entry.linkedAccounts.length === 1 ? entry.linkedAccounts[0] : entry, options(entry.providerId));
 assert.equal(status.short, expected[i], `${entry.label} 收起时必须显示同单位总积分，单账号保留自身余额`);
 const tree = await renderPill(entry), markup = html(tree);
 assert(markup.includes(expected[i]), `${entry.label} 的实读金额进入药丸`);
 for (const account of entry.linkedAccounts) {
  const raw = account.extras.find(x => x.kind === 'balance').value;
  const rounded = raw.replace('572.8400000000001', '572.84');
  assert(markup.includes(rounded), `${entry.label} 每个账号的余额都能直接看见`);
 }
 assert(!markup.includes('role="progressbar"'), '上游只给剩余额时不伪造容量百分比');
 if (entry.linkedAccounts.length === 1) assert(!markup.includes('aria-label="账号明细"'), '单账号不再重复画一份相同账号卡片');
}
const loomyMarkup = html(await renderPill(READBACK_ENTRIES[0]));
assert(loomyMarkup.includes('同名账号 · 账号 1') && loomyMarkup.includes('同名账号 · 账号 2'), '不同ID的同名账号仍可区分');

// 部分失败/旧缓存不能掩盖已有数字，单位不同分组展示，账号停用不复活旧余额。
const mixed = structuredClone(READBACK_ENTRIES[2]);
mixed.linkedAccounts[1] = { ...mixed.linkedAccounts[1], state: 'error', extras: [], error: '暂时无法读取', coverage: 'partial', freshness: 'unknown' };
const partial = api.computeStatus(mixed, options(mixed.providerId));
assert(partial.short.includes('6354 积分') && partial.short.includes(api.zh.statusPartial));
assert(partial.title.startsWith('已读合计') && partial.sub.includes('1/2'), '部分失败只给已读账号的小计与覆盖数量');
assert.equal(partial.color, '#eab308');
const currency = entryFor('trae', 'TRAE', [10, 20], 'credits');
// quotas 在场即权威：改 balance 必须同步改写结构化元素，否则旧 quotas 会继续生效。
currency.linkedAccounts[1].extras = [{ kind: 'balance', value: '2 USD' }];
currency.linkedAccounts[1].quotas = currency.linkedAccounts[1].quotas.map(el =>
 el?.type === 'amount' && el.role === 'balance' ? { ...el, amount: { value: 2, unit: 'USD', unitId: 'usd' } } : el);
const separate = api.computeStatus(currency, options('trae'));
assert(separate.short.includes('10 credits') && separate.short.includes('2 USD') && !separate.short.includes('12'), '不同单位不能求和或互相比较');
const zero = entryFor('loomy', 'Loomy', [0, 0], '积分');
assert.equal(api.computeStatus(zero, options('loomy')).color, '#ef4444', '所有已确认账号都是0积分时标红');
assert.equal(api.computeStatus(zero.linkedAccounts[0], options('loomy')).color, '#ef4444', '单账号0积分不能继续显示中性正常状态');
const partlyEmpty = entryFor('loomy', 'Loomy', [0, 20000], '积分');
assert.equal(api.computeStatus(partlyEmpty, options('loomy')).tinted, false, '单个账号用尽不把仍有积分的合计标成异常');
assert.equal(api.computeStatus(partlyEmpty, options('loomy')).short, '总 20000 积分');

// 选中账号只在弹层显示其余额，药丸始终显示账号总额；说明只由正文承接一份。
{
 const entry = structuredClone(READBACK_ENTRIES[1]);
 entry.linkedAccounts[0].extras.push({ kind: 'note', value: '测试额度包说明' });
 const hooks = new Hooks(), reader = async () => entry;
 reader.subscribe = () => () => {}; reader.activate = () => () => {};
 const props = { providerId: entry.providerId, label: entry.label, readEntry: reader, t, getLocale: () => 'zh', cc: null };
 let tree = hooks.render(api.UsagePill, props);
 for (let i = 0; i < 20; i++) await Promise.resolve();
 tree = hooks.render(api.UsagePill, props);
 const toggle = () => nodes(tree).find(n => n.type === 'button' && n.props['aria-haspopup'] === 'dialog');
 toggle().props.onClick(); tree = hooks.render(api.UsagePill, props);
 const pick = () => nodes(tree).find(n => n.type === 'button' && n.props['aria-pressed'] !== undefined && n.props['aria-label']?.startsWith('账号 1 ·'));
 pick().props.onClick(); tree = hooks.render(api.UsagePill, props);
 assert(toggle().props.title.includes('1892.94 credits'), '查看某账号不改变药丸的总额口径');
 assert(html(tree).includes('余额 572.84 credits'), '所查看账号的余额进入弹层');
 assert.equal(nodes(tree).filter(n => n.type === 'details').length, 1, '选中账号的明细只渲染一次');
 pick().props.onClick(); tree = hooks.render(api.UsagePill, props);
 assert(toggle().props.title.includes('1892.94 credits'));
 hooks.dispose();
}
console.log('PASS Loomy / TRAE / Raccoon / Qoder 实读余额回放、同单位合计与账号查看、不同单位隔离、零余额和明细去重');
