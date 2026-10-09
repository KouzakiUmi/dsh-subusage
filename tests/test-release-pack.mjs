import assert from 'node:assert/strict';
import { validatePack } from '../scripts/prepare-release.mjs';

const files = ['package.json', 'README.md', 'cordis.patch.yml', 'lib/index.js', 'lib/client.js', 'lib/mimo-login.js', 'LICENSE'];
const pack = { name: 'dsh-subusage', version: '0.4.1', filename: 'dsh-subusage-0.4.1.tgz', files: files.map(path => ({ path })) };
assert.equal(validatePack([pack]), pack);
for (const info of [null, [], [pack, pack], [null], [{ ...pack, name: 'wrong' }], [{ ...pack, version: 'not-semver' }], [{ ...pack, filename: '../dsh-subusage-0.4.1.tgz' }], [{ ...pack, filename: 'different.tgz' }], [{ ...pack, files: null }]]) assert.throws(() => validatePack(info));
for (const missing of files) assert.throws(() => validatePack([{ ...pack, files: pack.files.filter(file => file.path !== missing) }]));
const prerelease = { ...pack, version: '0.5.0-rc.1', filename: 'dsh-subusage-0.5.0-rc.1.tgz' };
assert.equal(validatePack([prerelease]), prerelease);
console.log('PASS 发布包唯一性、包名/版本、路径边界和完整文件清单');
