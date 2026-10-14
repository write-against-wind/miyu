'use strict';
// Launch directly so an older system Node can start the installed desktop runtime.
const { spawn } = require('node:child_process');
const { existsSync } = require('node:fs');
const path = require('node:path');
const root = path.join(__dirname, '..');
const developmentExecutable = path.join(root, 'node_modules', 'electron', 'dist', 'electron.exe');
const hasDevelopmentRuntime = existsSync(developmentExecutable);
const executable = hasDevelopmentRuntime
  ? developmentExecutable
  : path.join(root, 'dist', `Miyu-Vault-${require('../package.json').version}-x64.exe`);
const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;
const child = spawn(executable, hasDevelopmentRuntime ? [root] : [], { stdio: 'inherit', env });
child.on('error', () => {
  console.error('无法启动密屿。请将便携版程序放入 dist 文件夹，或使用 Node.js 22.12 及以上版本运行 npm ci。');
  process.exitCode = 1;
});
child.on('exit', (code) => { process.exitCode = code || 0; });
