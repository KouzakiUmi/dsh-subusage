import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { publishNpm } from '../scripts/publish-npm.mjs';

const ok = { status: 0, stdout: '"0.8.1"' };
const missing = { status: 1, stdout: '{"error":{"code":"E404"}}' };
function scenario(results, overrides = {}) {
  const calls = [];
  const opts = { pkg: { name: 'dsh-subusage', version: '0.8.1' }, hasArtifact: true, oidcAvailable: true, log() {}, run: args => { calls.push(args); assert(results.length); return results.shift(); }, ...overrides };
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
s = scenario([missing, { status: 1, stdout: '' }]);
assert.throws(s.invoke, /publish failed/);
s = scenario([missing, { status: 0, stdout: '' }, { status: 0, stdout: '"0.7.0"' }]);
assert.throws(s.invoke, /verification failed/);
s = scenario([], { hasArtifact: false });
assert.throws(s.invoke, /Missing verified artifact/);
assert.equal(s.calls.length, 0);
const workflows = ['ci.yml', 'release.yml'].map(f => readFileSync(new URL(`../.github/workflows/${f}`, import.meta.url), 'utf8'));
for (const workflow of workflows) {
  assert(workflow.includes('group: release-dsh-subusage'), 'main 和 tag 发布必须共用串行组');
  assert(!/NODE_AUTH_TOKEN|NPM_TOKEN|registry-url/.test(workflow), '发布流程不能依赖 npm secret 或生成空令牌认证配置');
}
assert(!workflows[0].includes('run: node scripts/publish-npm.mjs'), '未受信任的 ci.yml 只构建 GitHub Release');
assert(workflows[1].includes('run: node scripts/publish-npm.mjs'));
assert(workflows[1].includes('id-token: write'));
assert(workflows[1].includes('node-version: 24'));
console.log('PASS npm 发布：跳过已发布版本、认证/网络隔离、本地 tarball 路径、发布结果核对及工作流串行');
