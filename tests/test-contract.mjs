// Host/Client 私有 RPC 契约对齐；不调用真实服务、网络或用户配置。
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';
import { loadHostModule } from './helpers.mjs';

const host = await loadHostModule();
let spec, mounted;
const react = {
  createElement: () => null, Fragment: Symbol('Fragment'),
  useState: value => [typeof value === 'function' ? value() : value, () => {}],
  useRef: value => ({ current: value }), useEffect() {},
  useCallback: value => value, useMemo: fn => fn(), useSyncExternalStore: () => null
};
const sandbox = {
  window: { __ModuleLoader__: { load: value => { spec = value; } } },
  document: { visibilityState: 'visible', addEventListener() {}, removeEventListener() {} },
  console, setTimeout, clearTimeout, setInterval, clearInterval
};
vm.runInNewContext(readFileSync(new URL('../lib/client.js', import.meta.url), 'utf8'), sandbox);
const client = spec.factory(name => { assert.equal(name, 'react'); return react; });
const ctx = {
  effect() {},
  get() { return undefined; },
  locale: { register: () => () => {}, bind: () => key => key, getLocale: () => ({ active: 'zh' }) },
  remote: { $mount: value => { mounted = value; return Promise.resolve(() => {}); } },
  slots: { inject: (_name, factory) => factory(), register: () => () => {} },
  inject: (_names, callback) => callback(ctx)
};
client.apply(ctx);
assert.ok(mounted, 'Client 必须挂载 RPC 描述符');
function shape(contract) {
  return JSON.parse(JSON.stringify({
    package: contract.package,
    descriptors: contract.descriptors.map(d => ({
      id: d.id, service: d.service, namespace: d.namespace, method: d.method,
      invocation: d.invocation,
      parameters: d.parameters.map(p => ({ name: p.name, wire: p.wire, source: p.source, typeSymbol: p.codec.typeSymbol })),
      result: d.result.typeSymbol
    })).sort((a, b) => a.id.localeCompare(b.id))
  }));
}
assert.deepEqual(shape(mounted), shape(host.subUsageRemote), '两端 method、wire、codec 必须一致');
assert.deepEqual(JSON.parse(JSON.stringify(mounted.descriptors.map(d => d.method).sort())), ['cancelMimoLogin', 'getMimoLoginStatus', 'read', 'refresh', 'save', 'startMimoLogin']);
const start = host.subUsageRemote.descriptors.find(d => d.method === 'startMimoLogin');
const cancel = host.subUsageRemote.descriptors.find(d => d.method === 'cancelMimoLogin');
assert.equal(start.parameters[0].codec.schema.parse({ expectedRevision: 'current-revision' }).expectedRevision, 'current-revision');
assert.throws(() => start.parameters[0].codec.schema.parse({}));
assert.throws(() => start.parameters[0].codec.schema.parse({ expectedRevision: null }));
assert.equal(cancel.parameters[0].codec.schema.parse({ jobId: 'test-job' }).jobId, 'test-job');
assert.throws(() => cancel.parameters[0].codec.schema.parse({ jobId: '' }));
const refresh = host.subUsageRemote.descriptors.find(d => d.method === 'refresh');
const query = refresh.parameters[0].codec.schema.parse({ providerIds: ['kimi-coding'], force: true });
assert.deepEqual(query.providerIds, ['kimi-coding']);
assert.equal(query.force, true);
for (const id of ['zai-coding', 'synthetic', 'nanogpt']) for (const contract of [host.subUsageRemote, mounted]) {
 assert.equal(contract.descriptors.find(d => d.method === 'refresh').parameters[0].codec.schema.parse({ providerIds: [id], force: true }).providerIds[0], id);
 assert.equal(contract.descriptors.find(d => d.method === 'save').parameters[0].codec.schema.parse({ providerId: id, keyUpdate: { action: 'keep' } }).providerId, id);
}
assert.deepEqual(refresh.parameters[0].codec.schema.parse({ providerIds: ['commandcode'], force: false }).providerIds, ['commandcode'], 'commandcode 在刷新契约内');
assert.deepEqual(refresh.parameters[0].codec.schema.parse({ providerIds: ['xai-oauth'], force: false }).providerIds, ['xai-oauth'], 'xai-oauth 在刷新契约内');
assert.throws(() => refresh.parameters[0].codec.schema.parse({ providerIds: ['not-supported'], force: true }));
const save = host.subUsageRemote.descriptors.find(d => d.method === 'save');
const patch = save.parameters[0].codec.schema.parse({ providerId: 'kimi-coding', keyUpdate: { action: 'keep' } });
assert.equal(patch.providerId, 'kimi-coding');
assert.throws(() => save.parameters[0].codec.schema.parse({ providerId: 'xai-oauth', keyUpdate: { action: 'keep' } }), /managed by the provider plugin/, 'xai-oauth 凭据由提供方插件管理');
assert.throws(() => save.parameters[0].codec.schema.parse({ providerId: 'not-supported' }));
// Client 规范化后必须能被 Host 的最终 Cookie Header 校验接受。
const clientSource = readFileSync(new URL('../lib/client.js', import.meta.url), 'utf8');
const cookieFunction = clientSource.match(/function normalizeCookieText\(raw\) \{[\s\S]*?\n\t\t\}/);
assert.ok(cookieFunction);
const normalizeCookieText = new Function(cookieFunction[0] + '; return normalizeCookieText;')();
for (const raw of [
  'api-platform_serviceToken=dummy\nuserId=42',
  'api-platform_serviceToken="dummy=="; userId=42; optional=',
  'Name\tValue\tDomain\tPath\napi-platform_serviceToken\tdummy\t.platform.xiaomimimo.com\t/\nuserId\t42\t.xiaomimimo.com\t/',
  JSON.stringify([{ name: 'api-platform_serviceToken', value: 'dummy', domain: '.xiaomimimo.com' }, { name: 'userId', value: '42', domain: 'platform.xiaomimimo.com' }])
]) {
  const normalized = normalizeCookieText(raw);
  const accepted = save.parameters[0].codec.schema.parse({ providerId: 'xiaomi-token-plan-cn', cookieUpdate: { action: 'replace', value: normalized } });
  assert.equal(accepted.cookieUpdate.value, normalized);
}
console.log('PASS Host/Client 六方法 RPC 描述符、登录参数及 Cookie 校验一致');
