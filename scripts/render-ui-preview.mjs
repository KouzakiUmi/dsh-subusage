// 离线视觉验收：执行当前 Client 的真实组件，使用虚构数据和 Hook 桩。
// 不连接 DSH、不读取凭据、不执行 effect；不能替代安装后的真实交互验收。
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import vm from 'node:vm';
import { resolve } from 'node:path';

const width = Number(process.argv[2]) || 530;
const providerId = process.argv[3] || 'zai-coding-cn';
const theme = process.argv[4] === 'light' ? 'light' : 'dark';
const openCredentials = process.argv[5] === 'credentials';
const pillPreview = process.argv[5] === 'pill';
let previewStates, previewStateIndex = 0;
let moduleSpec;
const fragment = Symbol('Fragment');
const react = {
  Fragment: fragment,
  createElement: (type, props, ...children) => ({ type, props: props || {}, children }),
  useSyncExternalStore: (_subscribe, getSnapshot) => getSnapshot(),
  useState: initial => [previewStates ? previewStates[previewStateIndex++] : typeof initial === 'function' ? initial() : initial, () => {}],
  useRef: initial => ({ current: initial }), useEffect() {},
  useCallback: value => value, useMemo: fn => fn()
};
const clock = Date.parse('2026-10-01T18:21:32+08:00');
class PreviewDate extends Date { static now() { return clock; } }
const context = {
  window: { localStorage: { getItem: () => providerId }, __ModuleLoader__: { load: spec => { moduleSpec = spec; } } },
  document: {}, console, Date: PreviewDate
};
let code = readFileSync(new URL('../lib/client.js', import.meta.url), 'utf8');
code = code.replace('exports.apply = apply;', 'exports.__preview = { SubusageSection, UsagePill, createCommandCodeAccounts, PROVIDER_META, zh, en }; exports.apply = apply;');
if (openCredentials) code = code.replace('const [editorOpen, setEditorOpen] = react.useState(false);', 'const [editorOpen, setEditorOpen] = react.useState(true);');
vm.runInNewContext(code, context);
const { SubusageSection, UsagePill, createCommandCodeAccounts, PROVIDER_META, zh } = moduleSpec.factory(name => {
  if (name !== 'react') throw new Error('Unexpected module'); return react;
}).__preview;
const ids = ['zai-coding-cn', 'kimi-coding', 'xiaomi-token-plan-cn', 'opencode-go', 'commandcode', 'minimax', 'minimax-cn', 'xai-oauth'];
// MiMo 会话 Cookie 24 小时有效期：预览用固定时钟，落在“临近到期”档位以展示提醒样式。
const mimoLoggedInAt = clock - 22.3 * 3600000;
const mimoExpiresAt = clock + 95 * 60000;
const entry = (providerId, percent, kind = 'sub') => ({ providerId, state: 'ok', apiDetected: true, keySource: providerId === 'xiaomi-token-plan-cn' ? 'cookie' : 'env', freshness: 'fresh', coverage: 'complete', lastSuccessAt: new PreviewDate(clock).toISOString(), lastAttemptAt: new PreviewDate(clock).toISOString(), ...(providerId === 'xiaomi-token-plan-cn' ? { cookieExpiresAt: new PreviewDate(mimoExpiresAt).toISOString() } : {}), windows: [{ kind, percent, status: percent >= 100 ? 'rate-limited' : 'ok' }], extras: [] });
// 本机实际只有 arkcli-agent-plan 这一条 Ark 路由。其余 Ark 路由必须显式标成「未安装」：
// 客户端对拿不到路由表的 id 按「未知」放行；不显式标记会让订阅未知的 Ark 路由混入预览。
const ARK_NOT_INSTALLED = ['arkcli-coding-plan', 'arkcli-agent-plan-team', 'arkcli-coding-plan-team', 'ark-cli-legacy-removed'];
const result = {
  updatedAt: new PreviewDate(clock).toISOString(), configured: { ...Object.fromEntries(ids.map(id => [id, true])), ...Object.fromEntries(ARK_NOT_INSTALLED.map(id => [id, false])) },
  settings: { revision: 'offline-preview', visibility: { hideWithoutApi: true, providers: Object.fromEntries(ids.map(id => [id, true])) }, zai: { type: 1, organization: '', project: '' }, xiaomi: { hasCookie: true, loginAt: new PreviewDate(mimoLoggedInAt).toISOString(), expiresAt: new PreviewDate(mimoExpiresAt).toISOString() }, hasKeys: {}, keyModes: Object.fromEntries(ids.map(id => [id, 'inherit'])) },
  entries: [
    { ...entry(ids[0], 37), extras: [{ kind: 'plan', value: 'Lite' }], windows: [
      { kind: '5h', percent: 37, status: 'ok', resetsAt: new PreviewDate(clock + 390000).toISOString(), detail: { used: 743, limit: 2000, unit: 'credits' } },
      { kind: 'week', percent: 40, status: 'ok', resetsAt: new PreviewDate(clock + 23 * 3600000).toISOString(), detail: { used: 4100, limit: 10000, unit: 'credits' } }
    ] },
    entry(ids[1], 100, '7d'), entry(ids[2], 47.4), entry(ids[3], 80, 'week'),
    { ...entry(ids[4], 20.2, 'month'), windows: [{ kind: 'month', percent: 20.2, status: 'ok', detail: { used: 14.14, limit: 70, remaining: 55.86, unit: 'credits', limitSource: 'plan-snapshot' } }], extras: [{ kind: 'plan', value: 'individual-goat' }, { kind: 'monthly-balance', value: '55.86 credits' }] },
    entry(ids[5], 20, '5h'), entry(ids[6], 40, 'week'),
    // SuperGrok：统一周池（已用 %），套餐名与已购加量余额走 extras。
    { ...entry(ids[7], 35, 'week'), keySource: 'auth-file', extras: [{ kind: 'plan', value: 'SuperGrok' }, { kind: 'balance', value: '5.00 USD' }] }
  ]
};
const previewQuota = { ...entry(providerId, 25, 'day'), windows: [{ kind: 'day', percent: 25, status: 'ok', detail: { used: 250000, limit: 1000000, unit: 'tokens' } }, { kind: 'week', percent: 40, status: 'ok' }] };
// Agent Plan 的 AFP 是**两条额度线**：5 小时 / 周 / 月走文本 / 向量模型，日限额只覆盖视觉 /
// 语音模型与 Harness。日配额比周配额高是官方口径而不是算错，所以这条预览要按真实形态出——
// 分组标题、适用范围与明细拆行都在这里可见。
const afpQuota = { ...entry('arkcli-agent-plan', 2.6, '5h'), extras: [{ kind: 'plan', value: 'medium' }], windows: [
  { kind: '5h', percent: 2.6, status: 'ok', resetsAt: new PreviewDate(clock + 2 * 3600000).toISOString(), groupLabel: '文本 / 向量模型', detail: { used: 0.2587, limit: 10000, unit: 'AFP' } },
  { kind: 'week', percent: 0.7, status: 'ok', resetsAt: new PreviewDate(clock + 2 * 86400000).toISOString(), groupLabel: '文本 / 向量模型', detail: { used: 0.2587, limit: 35000, unit: 'AFP' } },
  { kind: 'month', percent: 0.3, status: 'ok', resetsAt: new PreviewDate(clock + 31 * 86400000).toISOString(), groupLabel: '文本 / 向量模型', detail: { used: 0.2587, limit: 100000, unit: 'AFP' } },
  { kind: 'day', percent: 0, status: 'ok', resetsAt: new PreviewDate(clock + 8 * 60000).toISOString(), groupLabel: '视觉 / 语音模型与 Harness', detail: { used: 0, limit: 50000, unit: 'AFP' } }
] };
let quota = providerId === 'arkcli-agent-plan' ? afpQuota : previewQuota;
// 业务语义离线验收：执行真实组件，不使用替代UI实现或真实计费接口。
const scenario = process.argv[6] || '';
if (scenario === 'paygo') quota = { ...entry(providerId, 100, 'week'), availability: 'paygo', availabilityReason: 'paid-credits', extras: [{ kind: 'balance', value: '50 credits' }] };
if (scenario === 'pro') quota = { ...entry(providerId, 10, 'week'), extras: [{ kind: 'plan', value: 'prolite' }] };
if (scenario === 'budgets') quota = { ...entry(providerId, 100, 'period'), windows: [['key', 100, 10, 10], ['team', 1, 1, 100], ['user', 20, 20, 100]].map(([budgetScope, percent, used, limit]) => ({ kind: 'period', budgetScope, percent, status: percent >= 100 ? 'rate-limited' : 'ok', detail: { used, limit, unit: 'USD' } })) };
if (scenario === 'scope') quota = { ...afpQuota, windows: afpQuota.windows.map(w => ({ ...w, detail: { ...w.detail, used: Math.round((w.kind === 'day' ? 100 : w.percent) / 100 * w.detail.limit * 1e6) / 1e6, scope: w.kind === 'month' ? 'all' : w.kind === 'day' ? 'daily-capabilities' : 'text' }, ...(w.kind === 'day' ? { percent: 100, status: 'rate-limited' } : {}) })) };
if (scenario === 'pool') quota = { ...entry(providerId, 100, '5h'), accountPool: { mode: 'auto', total: 2, available: 1, blockedCount: 1, unusableCount: 0, exhausted: false, accounts: [{ id: 'default', state: 'ok', usable: false, blocked: true, windows: [{ kind: '5h', percent: 100, status: 'rate-limited' }] }, { id: 'COMMANDCODE_ACCOUNT_WORK', label: '工作号', state: 'ok', usable: true, blocked: false, windows: [{ kind: '5h', percent: 10, status: 'ok' }] }] } };
if (scenario === 'pool-many') quota = { ...entry(providerId, 93.7, 'month'), accountPool: { mode: 'auto', total: 40, available: 1, blockedCount: 39, unusableCount: 0, exhausted: false, accounts: Array.from({ length: 40 }, (_, i) => ({ id: i ? `COMMANDCODE_ACCOUNT_${i}` : 'default', label: `示例账户 ${i}`, state: 'ok', usable: !i, blocked: !!i, windows: [{ kind: i % 2 ? 'week' : 'month', percent: i ? 100 : 93.7, status: i ? 'rate-limited' : 'ok' }] })) } };
if (scenario === 'balance-precision') {
  quota = { ...entry(providerId, 0), keySource: 'account-service', windows: [], extras: [{ kind: 'balance', value: '49.998903980000000 CNY' }] };
  result.entries = [quota];
  result.settings.visibility.providers = Object.fromEntries(Object.keys(PROVIDER_META).map(id => [id, id === providerId]));
  result.configured[providerId] = true;
}
if (pillPreview) previewStates = [{ entry: quota, updatedAt: clock }, null, undefined, false, true];
// Command Code 药丸弹层的账户切换区：虚构两个额外账户，固定项高亮；不发起任何网络请求。
let cc;
if (pillPreview && providerId === 'commandcode') {
  const row = { ns: 'llm-commandcode', revision: 3, value: { accounts: scenario === 'pool-many' ? quota.accountPool.accounts.slice(1).map(a => ({ label: a.label, apiKeyEnv: a.id })) : [{ label: '工作号', apiKeyEnv: 'COMMANDCODE_ACCOUNT_WORK' }, { label: '备用号', apiKeyEnv: 'COMMANDCODE_ACCOUNT_SPARE' }], activeAccount: ['pool', 'pool-many'].includes(scenario) ? '' : 'COMMANDCODE_ACCOUNT_WORK' } };
  cc = createCommandCodeAccounts({
    describe: async () => ({ ok: true, value: { writable: true, namespaces: [row] } }),
    mutate: async () => ({ ok: false, error: { message: 'offline preview' } })
  });
  await cc.load();
}
const pillLabel = providerId === 'commandcode' ? 'Command Code' : PROVIDER_META[providerId]?.label || providerId;
let tree = pillPreview ? UsagePill({ providerId, label: pillLabel, readEntry: () => {}, t: key => zh[key] || key, getLocale: () => 'zh-CN', cc }) : SubusageSection({ usageStore: { subscribe: () => () => {}, getSnapshot: () => result }, t: key => zh[key] || key, getLocale: () => 'zh-CN' });
if (scenario === 'balance-gallery') {
  const samples = [
    ['account', 'DeepSeek 账号 · 本机余额', 'deepseek-account', '49.998903980000000 CNY', []],
    ['api-low', 'DeepSeek API · 人民币偏低', 'deepseek', '0.50 CNY', []],
    ['cny-warn', '人民币 · 预警档', 'siliconflow', '3.00 CNY', []],
    ['usd-low', '美元 · 偏低档', 'novita', '0.10 USD', []],
    ['usd-warn', '美元 · 预警档', 'openrouter', '0.50 USD', []],
    ['credits', 'credits · 不跨厂商折算', 'commandcode', '0.1 credits', []],
    ['credits-zero', 'credits · 已无余额', 'commandcode', '0 credits', []],
    ['mimo-balance', 'MiMo · 已确认无套餐', 'xiaomi-token-plan-cn', '0.50 CNY', []],
    ['mimo-plan', 'MiMo · 有套餐，负余额不盖过套餐', 'xiaomi-token-plan-cn', '-1.19 CNY', [{ kind: 'sub', percent: 10, status: 'ok' }]],
    ['mimo-full', 'MiMo · 套餐耗尽，钱包不能掩盖', 'xiaomi-token-plan-cn', '49.99 CNY', [{ kind: 'sub', percent: 100, status: 'rate-limited' }]],
    ['mimo-unknown', 'MiMo · 套餐读取失败，不能说未订阅', 'xiaomi-token-plan-cn', '12.00 CNY', [], 'partial']
  ];
  tree = react.createElement('div', { id: 'balance-gallery', style: { display: 'grid', gap: 12 } },
    react.createElement('h2', { style: { margin: '0 0 4px', fontSize: 17 } }, '余额与套餐药丸 · 离线验收'),
    ...samples.map(([id, caption, provider, value, windows, coverage = 'complete']) => {
      const sample = { ...entry(provider, 0), windows, coverage, cookieExpiresAt: undefined, extras: [{ kind: 'balance', value }], ...(provider === 'deepseek-account' ? { keySource: 'account-service' } : {}) };
      previewStateIndex = 0;
      previewStates = [{ entry: sample, updatedAt: clock }, null, undefined, false, false];
      const pill = UsagePill({ providerId: provider, label: PROVIDER_META[provider]?.label || provider, readEntry: () => {}, t: key => zh[key] || key, getLocale: () => 'zh-CN' });
      return react.createElement('section', { 'data-balance-case': id, style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, padding: '10px 0', borderBottom: '1px solid rgba(128,128,128,.2)' } },
        react.createElement('span', { style: { fontSize: 12, minWidth: 0 } }, caption), pill);
    }));
}
const escape = value => String(value).replace(/[&<>\"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const unitless = new Set(['opacity', 'zIndex', 'fontWeight', 'lineHeight', 'flex', 'flexGrow', 'flexShrink', 'order', 'gridColumn']);
function render(node) {
  if (node == null || node === false || node === true) return '';
  if (Array.isArray(node)) return node.map(render).join('');
  if (typeof node !== 'object') return escape(node);
  if (node.type === fragment) return node.children.map(render).join('');
  if (typeof node.type === 'function') return render(node.type({ ...node.props, children: node.children }));
  if (node.type === 'select' && node.props.value !== undefined) {
    for (const option of node.children.flat(Infinity)) if (option?.type === 'option') option.props.selected = String(option.props.value) === String(node.props.value);
  }
  if (openCredentials && node.type === 'details' && node.props.id === 'subusage-provider-management') node.props.open = true;
  const attrs = Object.entries(node.props).filter(([key, value]) => !['key', 'ref', 'children'].includes(key) && !key.startsWith('on') && value !== undefined && (value !== false || key.startsWith('aria-'))).map(([key, value]) => {
    if (key === 'style') value = Object.entries(value || {}).filter(([, val]) => val !== undefined && val !== null).map(([name, val]) => `${name.replace(/[A-Z]/g, c => '-' + c.toLowerCase())}:${typeof val === 'number' && val !== 0 && !unitless.has(name) ? val + 'px' : val}`).join(';');
    const name = key === 'className' ? 'class' : key === 'tabIndex' ? 'tabindex' : key.toLowerCase();
    return value === true && !key.startsWith('aria-') ? name : `${name}="${escape(value)}"`;
  }).join(' ');
  const start = `<${node.type}${attrs ? ' ' + attrs : ''}>`;
  return ['input', 'br', 'hr', 'img', 'meta', 'link'].includes(node.type) ? start : start + node.children.map(render).join('') + `</${node.type}>`;
}
const sidebar = !pillPreview && width >= 400 ? `<aside><b>设置</b>${['账号与余额', '通用设置', '模型', '内置插件', 'xAI Grok', 'Agent 预设', '订阅用量', '插件市场'].map(x => `<div${x === '订阅用量' ? ' class="active"' : ''}>${x}</div>`).join('')}</aside>` : '';
const html = `<!doctype html><html lang="zh-CN"><meta charset="UTF-8"><title>订阅用量离线布局预览</title><style>*{box-sizing:border-box}body{margin:0;background:${theme === 'light' ? '#fafafa' : '#292929'};color:${theme === 'light' ? '#202124' : '#eee'};color-scheme:${theme};font-family:Arial,"Microsoft YaHei",sans-serif;font-size:13px}main{display:flex;padding:14px 12px;gap:12px}aside{width:180px;flex-shrink:0;padding:0 8px}aside b{display:block;margin:4px 0 24px;font-size:16px}aside div{padding:12px 10px;border-radius:8px;margin:4px 0}.active{background:#414141}article{width:${width + 32}px;min-width:0}button,select,input,textarea{font-family:inherit}details{padding-top:8px;border-top:1px solid #454545}progress{display:block}a{color:${theme === 'light' ? '#1a73e8' : '#82b1ff'}}footer{font-size:11px;opacity:.55;padding:8px 28px}</style><main>${sidebar}<article>${render(tree)}</article></main><footer>离线组件布局预览 · 虚构用量数据 · 非运行中的 DSH 截图</footer></html>`;
// 固定高度模拟「弹层从页面角落浮出」，check-pool-details.mjs 的点击展开断言依赖这个定位上下文；
// 要紧凑截图的市场脚本另行在页面里解除它，不改这里的布局语义。
const outputHtml = pillPreview && scenario !== 'balance-gallery' ? html.replace('<article>', '<article style="display:flex;justify-content:flex-end;align-items:flex-end;height:920px;max-width:100%">') : html;
mkdirSync(resolve('debug/ui-preview'), { recursive: true });
const suffix = process.argv[3] ? `-${providerId}-${theme}${openCredentials ? '-credentials' : pillPreview ? '-pill' : ''}` : '';
const output = resolve(`debug/ui-preview/settings-${width}${suffix}${scenario ? '-' + scenario.replace(/[^a-z0-9-]/gi, '') : ''}.html`);
writeFileSync(output, outputHtml, 'utf8');
console.log(output);
