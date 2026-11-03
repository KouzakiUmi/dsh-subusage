import assert from 'node:assert/strict';
import { summarizeCreditPackages } from '../lib/credit-packages.js';

const NOW = Date.parse('2026-11-03T12:00:00Z');
const pkg = (name, remaining, unit = '积分', extra = {}) => ({ name, remaining, unit, ...extra });

const result = summarizeCreditPackages([
	pkg('充值积分', 100),
	pkg('每日赠送', 50, '积分', { expiresAt: NOW + 2 * 3600000 }),
	pkg('奖励 A', 20, '积分', { expiresAt: NOW + 2 * 86400000 }),
	pkg('奖励 B', 30, '积分', { expiresAt: NOW + 10 * 86400000 }),
	pkg('未知临时包', 40),
	pkg('美元包', 5, 'USD'),
	pkg('用尽包', 0),
	pkg('过期包', 30, '积分', { expiresAt: NOW - 1 }),
], NOW);

assert.deepEqual(result.packages.map(row => row.name), ['充值积分', '每日赠送', '奖励 A', '奖励 B', '未知临时包', '美元包'], '用尽与已过期包不再进入后续窗口或说明');
const notes = result.extras.map(row => row.value);
assert.equal(notes.length, 5, '按用途与单位聚合，不逐包罗列');
assert.ok(notes[0].startsWith('今天到期：50 积分（最早 '), '当天到期优先单独分组');
assert.ok(notes[1].startsWith('3 天内到期：20 积分（最早 '), '很快过期的包合并并保留最早时间');
assert.ok(notes.includes('临时额度合计：70 积分'), '较远期与未报告日期的临时包合并');
assert.ok(notes.includes('周期 / 套餐额度：50 积分') === false, '紧急周期包只进到期组，不重复计数');
assert.ok(notes.includes('永久额度：100 积分'));
assert.ok(notes.includes('临时额度合计：5 USD'), '不同单位分开，绝不换算或相加');
assert.ok(!notes.some(value => value.includes('用尽包') || value.includes('过期包') || value.includes('奖励 A') || value.includes('奖励 B')));

const urgent = summarizeCreditPackages([
	pkg('月度套餐', 40, 'credits', { recurring: true }),
	pkg('远期资源包', 60, 'credits', { expiresAt: NOW + 10 * 86400000 }),
	pkg('紧急资源包', 10, 'credits', { expiresAt: NOW + 86400000 }),
], NOW, { urgentOnly: true });
assert.equal(urgent.extras.length, 1, '已有额度窗口的包只保留紧急到期提醒');
assert.ok(urgent.extras[0].value.startsWith('3 天内到期：10 credits'));
assert.equal(urgent.packages.length, 3, 'urgentOnly 只影响说明，不影响有效包过滤结果');

console.log('PASS 积分包归一化：用尽/过期过滤、今日/3 天分组、临时/周期/永久聚合与单位隔离');
