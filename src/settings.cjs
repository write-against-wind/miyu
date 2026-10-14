'use strict';
const fs = require('node:fs/promises');
const path = require('node:path');
const AUTO_LOCK_VALUES = [1, 5, 15, 30];

async function readSettings(file) {
  try {
    const value = JSON.parse(await fs.readFile(file, 'utf8'));
    return { autoLockMinutes: AUTO_LOCK_VALUES.includes(value.autoLockMinutes) ? value.autoLockMinutes : 5 };
  } catch { return { autoLockMinutes: 5 }; }
}

async function saveSettings(file, settings) {
  if (!AUTO_LOCK_VALUES.includes(settings.autoLockMinutes)) throw new Error('请选择有效的自动锁定时间。');
  await fs.mkdir(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp`;
  await fs.writeFile(tmp, JSON.stringify({ autoLockMinutes: settings.autoLockMinutes }), { mode: 0o600 });
  await fs.rename(tmp, file);
}

module.exports = { readSettings, saveSettings, AUTO_LOCK_VALUES };
