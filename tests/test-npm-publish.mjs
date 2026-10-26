import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { publishNpm } from '../scripts/publish-npm.mjs';

const ok = { status: 0, stdout: '"0.8.1"' };
const missing = { status: 1, stdout: '{"error":{"code":"E404"}}' };
function scenario(results, overrides = {}) {
  const calls = [];
  const opts = { pkg: { name: 'dsh-subusage', version: '0.8.1' }, hasArtifact: true, oidcAvailable: true, log() {}, wait() {}, run: args => { calls.push(args); assert(results.length); return results.shift(); }, ...overrides };
  return { calls, invoke: () => publishNpm(opts) };
}
let s = scenario([ok], { oidcAvailable: false });
assert.equal(s.invoke(), 'skipped');
assert.equal(s.calls.length, 1);
s = scenario([missing], { oidcAvailable: false });
assert.throws(s.invoke, /OIDC is unavailable/);
assert.equal(s.calls.length, 1);
for (const failure of [{ status: 1, stdout: '{"error":{"code":"E401"}}' }, { status: 1, stdout: '{"error":{"code":"ENOTFOUND"}}' }, { status: 1, stdout: '' }]) {
  s = scenario([failure]);
  assert.throws(s.invoke, /lookup failed/);
  assert.equal(s.calls.length, 1, '认证或网络查询失败不得尝试发布');
}
s = scenario([missing, { status: 0, stdout: '' }, ok]);
assert.equal(s.invoke(), 'published');
assert.equal(s.calls[1][1], './dist/dsh-subusage.tgz', '显式本地路径，不能误解析成 GitHub shorthand');
s = scenario([missing, { status: 0, stdout: '' }, missing, ok]);
assert.equal(s.invoke(), 'published', '允许发布后短暂 E404，查询绕过本地缓存');
assert(s.calls[0].includes('--prefer-online'));
const waits = [], messages = [];
s = scenario([missing, { status: 0, stdout: '' }, ...Array(30).fill(missing), ok], { wait: ms => waits.push(ms), log: message => messages.push(message) });
assert.equal(s.invoke(), 'published', '传播耗时超过旧窗口，直到第 5 分钟仍能自动核验成功');
assert.equal(waits.length, 30);
assert(waits.every(ms => ms === 10000));
assert.equal(waits.reduce((sum, ms) => sum + ms, 0), 300000, '等待窗口为 5 分钟');
assert.equal(s.calls.filter(args => args[0] === 'publish').length, 1, '等待期间只查询，不重复发布');
assert(messages.some(message => message.includes('30/31')));
waits.length = 0; messages.length = 0;
s = scenario([missing, { status: 0, stdout: '' }, ...Array(31).fill(missing)], { wait: ms => waits.push(ms), log: message => messages.push(message) });
assert.throws(s.invoke, /verification failed/, '等待窗口耗尽后仍不得把 npm 返回 0 当作已发布证明');
assert.equal(waits.length, 30, '最后一次查询失败后不追加等待');
assert.equal(s.calls.length, 33, '初始查询、一次发布和 31 次核验');
assert.equal(messages.filter(message => message.includes('retrying in')).length, 30);
for (const failure of [{ status: 1, stdout: '{"error":{"code":"E401"}}' }, { status: 1, stdout: '{"error":{"code":"ENOTFOUND"}}' }]) {
  s = scenario([missing, { status: 0, stdout: '' }, failure], { wait: () => assert.fail('认证或网络错误不应作为传播延迟重试') });
  assert.throws(s.invoke, /verification failed/);
  assert.equal(s.calls.length, 3);
}
s = scenario([missing, { status: 1, stdout: JSON.stringify({error:{code:'E403',summary:'You cannot publish over the previously published versions: 0.8.1.'}}) }, missing, ok]);
assert.equal(s.invoke(), 'skipped', 'registry 读缓存落后时，明确的重复版本拒绝仍须核对版本');
s = scenario([missing, { status: 1, stdout: '{"error":{"code":"E403","summary":"Forbidden"}}' }]);
assert.throws(s.invoke, /publish failed/, '不能将任意权限拒绝视为版本已发布');
s = scenario([missing, { status: 1, stdout: '' }]);
assert.throws(s.invoke, /publish failed/);
s = scenario([missing, { status: 0, stdout: '' }, { status: 0, stdout: '"0.7.0"' }]);
assert.throws(s.invoke, /verification failed/);
s = scenario([], { hasArtifact: false });
assert.throws(s.invoke, /Missing verified artifact/);
assert.equal(s.calls.length, 0);
const workflows = ['ci.yml', 'release.yml'].map(f => readFileSync(new URL(`../.github/workflows/${f}`, import.meta.url), 'utf8'));
for (const workflow of workflows) {
  assert(!/NODE_AUTH_TOKEN|NPM_TOKEN|registry-url/.test(workflow), '发布流程不能依赖 npm secret 或生成空令牌认证配置');
}
assert(!/contents: write|action-gh-release|publish-npm\.mjs|build-\$/.test(workflows[0]), '分支 CI 只检查与上传 artifact，不创建 Release 或 tag');
assert(!workflows[0].includes('  publish:'), '移除 main 自动发布 job');
assert(workflows[0].includes('actions/upload-artifact@v4'), '保留可下载的 CI 构建产物');
assert(workflows[1].includes('group: release-dsh-subusage'), '版本发布串行执行');
assert(!/workflow_dispatch|inputs\.version_tag/.test(workflows[1]), '仅 tag 推送创建发布，不提供分支手动发布入口');
assert(workflows[1].includes('tags: ["v[0-9]*.[0-9]*.[0-9]*"]'));
assert(workflows[1].includes('process.env.RELEASE_TAG !== `v${version}`'), '标签须与实际打包版本一致');
assert(workflows[1].includes('make_latest: legacy'), '版本发布管理 latest');
assert(workflows[1].includes('run: node scripts/publish-npm.mjs'));
assert(workflows[1].includes('id-token: write'));
assert(workflows[1].includes('node-version: 24'));
assert(workflows[1].includes('timeout-minutes: 20'), '发布任务为延长后的传播核验留出时间');
console.log('PASS npm 发布：跳过已发布版本、认证/网络隔离、本地 tarball 路径、发布结果核对及工作流串行');
