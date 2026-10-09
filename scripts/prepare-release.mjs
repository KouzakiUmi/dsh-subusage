// 验证 npm pack --json 的产物，再复制为市场需要的固定资产名。
import { copyFileSync, mkdirSync, readFileSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export function validatePack(info) {
  if (!Array.isArray(info) || info.length !== 1) throw new Error('Expected exactly one npm package');
  const pack = info[0];
  if (pack?.name !== 'dsh-subusage' || typeof pack.version !== 'string' || !/^\d+\.\d+\.\d+(-[\w.]+)?$/.test(pack.version)) throw new Error('Unexpected package name/version');
  if (typeof pack.filename !== 'string' || basename(pack.filename) !== pack.filename || pack.filename !== `dsh-subusage-${pack.version}.tgz`) throw new Error('Unexpected tarball filename');
  if (!Array.isArray(pack.files)) throw new Error('Missing package file list');
  const paths = new Set(pack.files.map(file => file.path));
  for (const path of ['package.json', 'README.md', 'cordis.patch.yml', 'lib/index.js', 'lib/client.js', 'lib/mimo-login.js', 'LICENSE']) {
    if (!paths.has(path)) throw new Error(`Missing packaged file: ${path}`);
  }
  return pack;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const manifest = resolve(process.argv[2] || 'pack.json');
  const destination = resolve(process.argv[3] || 'dist');
  const pack = validatePack(JSON.parse(readFileSync(manifest, 'utf8')));
  mkdirSync(destination, { recursive: true });
  const asset = join(destination, 'dsh-subusage.tgz');
  copyFileSync(join(dirname(manifest), pack.filename), asset);
  console.log(`Verified ${pack.name}@${pack.version} -> ${asset}`);
}
