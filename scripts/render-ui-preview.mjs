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
code = code.replace('exports.apply = apply;', 'exports.__preview = { SubusageSection, UsagePill, createCommandCodeAccounts, zh, en }; exports.apply = apply;');
if (openCredentials) code = code.replace('const [editorOpen, setEditorOpen] = react.useState(false);', 'const [editorOpen, setEditorOpen] = react.useState(true);');
vm.runInNewContext(code, context);
const { SubusageSection, UsagePill, createCommandCodeAccounts, zh } = moduleSpec.factory(name => {
  if (name !== 'react') throw new Error('Unexpected module'); return react;
}).__preview;
const ids = ['zai-coding-cn', 'kimi-coding', 'xiaomi-token-plan-cn', 'opencode-go', 'commandcode', 'minimax', 'minimax-cn'];
// MiMo 会话 Cookie 24 小时有效期：预览用固定时钟，落在“临近到期”档位以展示提醒样式。
const mimoLoggedInAt = clock - 22.3 * 3600000;
const mimoExpiresAt = clock + 95 * 60000;
const entry = (providerId, percent, kind = 'sub') => ({ providerId, state: 'ok', apiDetected: true, keySource: providerId === 'xiaomi-token-plan-cn' ? 'cookie' : 'env', freshness: 'fresh', coverage: 'complete', lastSuccessAt: new PreviewDate(clock).toISOString(), lastAttemptAt: new PreviewDate(clock).toISOString(), ...(providerId === 'xiaomi-token-plan-cn' ? { cookieExpiresAt: new PreviewDate(mimoExpiresAt).toISOString() } : {}), windows: [{ kind, percent, status: percent >= 100 ? 'rate-limited' : 'ok' }], extras: [] });
const result = {
  updatedAt: new PreviewDate(clock).toISOString(), configured: Object.fromEntries(ids.map(id => [id, true])),
  settings: { revision: 'offline-preview', visibility: { hideWithoutApi: true, providers: Object.fromEntries(ids.map(id => [id, true])) }, zai: { type: 1, organization: '', project: '' }, xiaomi: { hasCookie: true, loginAt: new PreviewDate(mimoLoggedInAt).toISOString(), expiresAt: new PreviewDate(mimoExpiresAt).toISOString() }, hasKeys: {}, keyModes: Object.fromEntries(ids.map(id => [id, 'inherit'])) },
  entries: [
    { ...entry(ids[0], 37), extras: [{ kind: 'plan', value: 'Lite' }], windows: [
      { kind: '5h', percent: 37, status: 'ok', resetsAt: new PreviewDate(clock + 390000).toISOString(), detail: { used: 743, limit: 2000, unit: 'credits' } },
      { kind: 'week', percent: 40, status: 'ok', resetsAt: new PreviewDate(clock + 23 * 3600000).toISOString(), detail: { used: 4100, limit: 10000, unit: 'credits' } }
    ] },
    entry(ids[1], 100, '7d'), entry(ids[2], 47.4), entry(ids[3], 80, 'week'),
    { ...entry(ids[4], 20.2, 'month'), windows: [{ kind: 'month', percent: 20.2, status: 'ok', detail: { used: 14.14, limit: 70, remaining: 55.86, unit: 'credits', limitSource: 'plan-snapshot' } }], extras: [{ kind: 'plan', value: 'individual-goat' }, { kind: 'monthly-balance', value: '55.86 credits' }] },
    entry(ids[5], 20, '5h'), entry(ids[6], 40, 'week')
  ]
};
const previewQuota = { ...entry(providerId, 25, 'day'), windows: [{ kind: 'day', percent: 25, status: 'ok', detail: { used: 250000, limit: 1000000, unit: 'tokens' } }, { kind: 'week', percent: 40, status: 'ok' }] };
if (pillPreview) previewStates = [{ entry: previewQuota, updatedAt: clock }, null, undefined, false, true];
// Command Code 药丸弹层的账户切换区：虚构两个额外账户，固定项高亮；不发起任何网络请求。
let cc;
if (pillPreview && providerId === 'commandcode') {
  const row = { ns: 'llm-commandcode', revision: 3, value: { accounts: [{ label: '工作号', apiKeyEnv: 'COMMANDCODE_ACCOUNT_WORK' }, { label: '备用号', apiKeyEnv: 'COMMANDCODE_ACCOUNT_SPARE' }], activeAccount: 'COMMANDCODE_ACCOUNT_WORK' } };
  cc = createCommandCodeAccounts({
    describe: async () => ({ ok: true, value: { writable: true, namespaces: [row] } }),
    mutate: async () => ({ ok: false, error: { message: 'offline preview' } })
  });
  await cc.load();
}
const pillLabel = providerId === 'commandcode' ? 'Command Code' : 'NanoGPT';
const tree = pillPreview ? UsagePill({ providerId, label: pillLabel, readEntry: () => {}, t: key => zh[key] || key, getLocale: () => 'zh-CN', cc }) : SubusageSection({ usageStore: { subscribe: () => () => {}, getSnapshot: () => result }, t: key => zh[key] || key, getLocale: () => 'zh-CN' });
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
const outputHtml = pillPreview ? html.replace('<article>', '<article style="display:flex;justify-content:flex-end;align-items:flex-end;height:460px;max-width:100%">') : html;
mkdirSync(resolve('debug/ui-preview'), { recursive: true });
const suffix = process.argv[3] ? `-${providerId}-${theme}${openCredentials ? '-credentials' : pillPreview ? '-pill' : ''}` : '';
const output = resolve(`debug/ui-preview/settings-${width}${suffix}.html`);
writeFileSync(output, outputHtml, 'utf8');
console.log(output);
