// main 与 tag 工作流共用：只对明确缺失的版本发布已验证 tarball。
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const registry = 'https://registry.npmjs.org/';
export function publishNpm({ pkg, hasArtifact, oidcAvailable, run, log = console.log, wait = ms => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms) }) {
  if (pkg.name !== 'dsh-subusage' || !/^\d+\.\d+\.\d+(-[\w.]+)?$/.test(pkg.version)) throw new Error('Unexpected package name/version');
  if (!hasArtifact) throw new Error('Missing verified artifact: ./dist/dsh-subusage.tgz');
  const spec = `${pkg.name}@${pkg.version}`;
  const lookup = () => run(['view', spec, 'version', '--json', '--prefer-online', `--registry=${registry}`]);
  const found = lookup();
  let data;
  try { data = JSON.parse(found.stdout); } catch { /* 非 JSON 错误不得视为版本不存在。 */ }
  if (found.status === 0) {
    if (data !== pkg.version) throw new Error('Registry returned an unexpected version');
    log(`npm already has ${spec}; skipping publish.`);
    return 'skipped';
  }
  if (data?.error?.code !== 'E404') throw new Error(`npm version lookup failed (${data?.error?.code || 'unknown error'}); refusing to publish.`);
  if (!oidcAvailable) throw new Error('GitHub OIDC is unavailable; publishing job needs id-token: write and an npm Trusted Publisher matching this workflow.');
  const published = run(['publish', './dist/dsh-subusage.tgz', '--access', 'public', '--ignore-scripts', '--json', `--registry=${registry}`]);
  // npm 的标准发布结果包含包信息/状态，不输出环境或身份令牌。
  if (published.stdout?.trim()) log(published.stdout.trim());
  let duplicate = false;
  if (published.status !== 0) {
    let error;
    try { error = JSON.parse(published.stdout)?.error; } catch {}
    duplicate = error?.code === 'E403' && error.summary?.includes(`You cannot publish over the previously published versions: ${pkg.version}.`);
    if (!duplicate) throw new Error(`npm publish failed (${error?.code || `exit ${published.status ?? 'unknown'}`}); check npm Trusted Publisher workflow, environment and direct publish permission.`);
    log('Registry reports this version already published; verifying visibility instead of republishing.');
  }
  for (let attempt = 0; attempt < 6; attempt++) {
    if (attempt) wait(10000);
    const verified = lookup();
    let version;
    try { version = JSON.parse(verified.stdout); } catch { /* 核对失败不能报告发布成功。 */ }
    if (verified.status === 0 && version === pkg.version) {
      log(`Published and verified ${spec}.`);
      return duplicate ? 'skipped' : 'published';
    }
    if (version?.error?.code !== 'E404') break;
    log(`Waiting for registry visibility (${attempt + 1}/6).`);
  }
  throw new Error(`Publication verification failed for ${spec}; check registry before retrying.`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    publishNpm({
      pkg: JSON.parse(readFileSync('package.json', 'utf8')),
      hasArtifact: existsSync('dist/dsh-subusage.tgz'),
      oidcAvailable: Boolean(process.env.ACTIONS_ID_TOKEN_REQUEST_URL && process.env.ACTIONS_ID_TOKEN_REQUEST_TOKEN),
      run: args => spawnSync('npm', args, { encoding: 'utf8', shell: process.platform === 'win32', timeout: 120000 })
    });
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
