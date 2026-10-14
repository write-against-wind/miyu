'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');

async function main() {
  const root = path.join(__dirname, '..');
  const readJson = (name) => JSON.parse(fs.readFileSync(path.join(root, name), 'utf8'));
  const pkg = readJson('package.json');
  const lock = readJson('package-lock.json');
  const version = pkg.version;
  if (!/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(version)) {
    throw new Error('版本号须为主版本.次版本.修订号，例如 1.0.2。');
  }
  if (lock.version !== version || lock.packages?.['']?.version !== version) {
    throw new Error('package.json 与 package-lock.json 版本不一致，请使用 npm version 更新。');
  }
  if (process.env.RELEASE_TAG && process.env.RELEASE_TAG !== 'v' + version) {
    throw new Error('Git 标签必须等于 v + package.json 版本号。');
  }
  const changelog = fs.readFileSync(path.join(root, 'CHANGELOG.md'), 'utf8');
  const sections = changelog.split(/^## /m).slice(1);
  const section = sections.find((value) => value.split(/\r?\n/, 1)[0].trim() === '[' + version + ']');
  const notes = section?.slice(section.indexOf('\n') + 1).trim();
  if (!notes || !/^[-*] /m.test(notes)) {
    throw new Error('请在 CHANGELOG.md 的 ## [' + version + '] 下填写版本改动。');
  }
  if (process.argv.includes('--prepare')) {
    const artifact = 'Miyu-Vault-' + version + '-x64.exe';
    const file = path.join(root, 'dist', artifact);
    const stat = fs.statSync(file);
    if (!stat.isFile() || stat.size < 1) throw new Error('缺少有效的 Windows 构建产物。');
    const hash = createHash('sha256');
    for await (const chunk of fs.createReadStream(file)) hash.update(chunk);
    fs.writeFileSync(path.join(root, 'dist', 'SHA256SUMS.txt'), hash.digest('hex') + '  ' + artifact + '\n');
    fs.writeFileSync(path.join(root, 'dist', 'release-notes.md'),
      '# 密屿 v' + version + '\n\n' + notes + '\n\n适用于 Windows x64，无需安装 Node.js。下载 exe 后直接运行。此构建未配置代码签名。\n');
  }
  console.log('Version verified: v' + version);
}
main().catch((error) => { console.error(error.message); process.exitCode = 1; });
