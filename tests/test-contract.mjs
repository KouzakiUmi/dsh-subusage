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
assert.deepEqual(JSON.parse(JSON.stringify(mounted.descriptors.map(d => d.method).sort())), ['cancelMimoLogin', 'cancelOpenDesignLogin', 'getMimoLoginStatus', 'getOpenDesignLoginStatus', 'read', 'refresh', 'save', 'startMimoLogin', 'startOpenDesignLogin']);
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
// 未知 provider id 在 parse 层**过滤而不是拒绝**：Host 要重启、Client 刷新即生效，版本窗口期里必然
// 出现客户端带着新 id 过来的情况。整体拒绝会让用户一片空白，这里只把不认识的挑出来（由 refresh
// 回一条可读原因）。形状错误照旧拒绝。
const unknownQuery = refresh.parameters[0].codec.schema.parse({ providerIds: ['not-supported'], force: true });
assert.deepEqual(unknownQuery.providerIds, [], '未知 id 不进 providerIds');
assert.deepEqual(unknownQuery.unknown, ['not-supported'], '未知 id 单独列出，交给 refresh 说明原因');
assert.throws(() => refresh.parameters[0].codec.schema.parse({ providerIds: 'not-an-array', force: true }), 'providerIds 形状错误仍拒绝');
assert.throws(() => refresh.parameters[0].codec.schema.parse({ providerIds: ['kimi-coding'] }), '缺 force 仍拒绝');
const save = host.subUsageRemote.descriptors.find(d => d.method === 'save');
const patch = save.parameters[0].codec.schema.parse({ providerId: 'kimi-coding', keyUpdate: { action: 'keep' } });
assert.equal(patch.providerId, 'kimi-coding');
assert.throws(() => save.parameters[0].codec.schema.parse({ providerId: 'xai-oauth', keyUpdate: { action: 'keep' } }), /managed by the provider plugin/, 'xai-oauth 凭据由提供方插件管理');
// 未知 provider 的 save：parse 只校验形状，真正的拒绝在 persist 里（见 test-host-service），
// 这样用户拿到的是可读原因，而不是网关的 "boundary validation" 通用报错。
assert.equal(save.parameters[0].codec.schema.parse({ providerId: 'not-supported' }).providerId, 'not-supported', '未知 id 的形状合法，交由 persist 拒绝');
assert.throws(() => save.parameters[0].codec.schema.parse({ providerId: '' }), '空 providerId 仍拒绝');
// 火山个人版 / Team 组开关补丁两端 parser 必须保持一致。
for (const contract of [host.subUsageRemote, mounted]) {
	const codec = contract.descriptors.find(d => d.method === 'save').parameters[0].codec.schema;
	assert.equal(codec.parse({ expectedRevision: 'r1', visibility: { ark: false } }).visibility.ark, false, '纯 ark 组开关补丁合法');
	assert.equal(codec.parse({ expectedRevision: 'r1', visibility: { arkTeam: true } }).visibility.arkTeam, true, '纯 arkTeam 独立开关补丁合法');
	assert.equal(codec.parse({ expectedRevision: 'r1', visibility: { hideWithoutApi: false, ark: true, arkTeam: false } }).visibility.ark, true, '混合可见性补丁合法');
	assert.throws(() => codec.parse({ expectedRevision: 'r1', visibility: { ark: 'yes' } }), 'ark 非布尔必须拒绝');
	assert.throws(() => codec.parse({ expectedRevision: 'r1', visibility: { arkTeam: 'yes' } }), 'arkTeam 非布尔必须拒绝');
}
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
// 双端 provider 表必须同源：新增厂商漏改一端不会报错——漏 Host 药丸取不到数，
// 漏 Client 则设置页/药丸缺项。这里以 Host 的 IDS 为单一真源做集合断言。
// Client 工厂不导出内表（生产 bundle 不暴露），用 vm 替换锚点把它物化出来。
const clientInnerSource = readFileSync(new URL('../lib/client.js', import.meta.url), 'utf8');
let clientTables;
vm.runInNewContext(
	clientInnerSource.replace(
		'exports.apply = apply;',
		'exports.__contract = { PROVIDER_META, PROVIDER_ORDER }; exports.apply = apply;'
	),
	{ window: { __ModuleLoader__: { load: (v) => { clientTables = v; } } }, console }
);
const clientFactory = clientTables.factory(() => react);
const clientTable = clientFactory.__contract;
assert.ok(clientTable && clientTable.PROVIDER_META && clientTable.PROVIDER_ORDER, 'Client 内表可物化');
assert.deepEqual([...host.IDS].sort(), [...clientTable.PROVIDER_ORDER].sort(), 'Client PROVIDER_ORDER 与 Host IDS 集合一致（不多不少）');
assert.deepEqual([...host.IDS].sort(), Object.keys(clientTable.PROVIDER_META).sort(), 'Client PROVIDER_META 与 Host IDS 键集合一致');
for (const id of host.IDS) {
	const hostMeta = host.PROVIDERS[id], clientMeta = clientTable.PROVIDER_META[id];
	assert.equal(clientMeta.label !== undefined && clientMeta.short !== undefined, true, `${id} 有 label/short`);
	assert.equal(clientMeta.managedByPlugin === true, hostMeta.managedByPlugin === true, `${id} managedByPlugin 两端一致`);
	assert.equal(clientMeta.defaultEnabled === false, hostMeta.defaultEnabled === false, `${id} 默认开关两端一致`);
	assert.equal(clientMeta.envName, hostMeta.envName, `${id} envName 两端一致`);
	// Client 内表在 vm 里物化，跨 realm 的数组用 deepStrictEqual 会因原型不同而失败，比字符串。
	assert.equal((clientMeta.envAliases ?? []).join(","), (hostMeta.envAliases ?? []).join(","), `${id} 备用凭据引用名两端一致`);
}
console.log('PASS Host/Client 六方法 RPC 描述符、登录参数、Cookie 校验与 provider 表一致性');
