'use strict';
const { app, BrowserWindow, ipcMain, dialog, clipboard, powerMonitor, protocol, net, Menu } = require('electron');
const fs = require('node:fs/promises');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { createHash, randomBytes } = require('node:crypto');
const { VaultStore, generatePassword } = require('./core/vault.cjs');
const { readSettings, saveSettings, AUTO_LOCK_VALUES } = require('./settings.cjs');

app.setName('密屿密码本');
const isTest = !app.isPackaged && process.env.MIYU_E2E === '1';
const dataDir = isTest && process.env.MIYU_TEST_DATA
  ? path.resolve(process.env.MIYU_TEST_DATA)
  : path.join(app.getPath('appData'), 'MiyuVault');
app.setPath('userData', dataDir);
protocol.registerSchemesAsPrivileged([{ scheme: 'miyu', privileges: { standard: true, secure: true, supportFetchAPI: true } }]);

const rendererDir = path.join(__dirname, 'renderer');
const vaultPath = path.join(dataDir, 'passwords.miyu');
const settingsPath = path.join(dataDir, 'settings.json');
const vault = new VaultStore(vaultPath);
let window;
let settings = { autoLockMinutes: 5 };
let settingsQueue = Promise.resolve();
let lastActivity = Date.now();
let sessionEpoch = 0;
let unlocked = false;
let clipboardDigest = null;
let clipboardTimer;
let nextUnlockAt = 0;
let failedUnlocks = 0;

const hash = (text) => createHash('sha256').update(text).digest('hex');
function clearCopiedValue() {
  clearTimeout(clipboardTimer);
  if (clipboardDigest && hash(clipboard.readText()) === clipboardDigest) clipboard.clear();
  clipboardDigest = null;
}

function lockVault() {
  sessionEpoch += 1;
  unlocked = false;
  vault.lock();
  clearCopiedValue();
  if (window && !window.isDestroyed()) window.webContents.send('vault:locked');
}

function checkSender(event) {
  if (!window || event.sender !== window.webContents || event.senderFrame !== window.webContents.mainFrame) {
    throw new Error('不允许的请求来源。');
  }
  const url = new URL(event.senderFrame.url);
  if (url.protocol !== 'miyu:' || url.host !== 'app' || url.pathname !== '/index.html') throw new Error('不允许的请求来源。');
}

function requireUnlocked() {
  if (!unlocked) throw new Error('密码本已锁定，请先解锁。');
}

async function status() {
  return { ...await vault.status(), autoLockMinutes: settings.autoLockMinutes, dataPath: vaultPath };
}

function handle(name, fn, { secret = false } = {}) {
  ipcMain.handle(`vault:${name}`, async (event, ...args) => {
    try {
      checkSender(event);
      const epoch = sessionEpoch;
      if (secret) requireUnlocked();
      const data = await fn(...args);
      if (secret && epoch !== sessionEpoch) throw new Error('密码本已锁定，请先解锁。');
      return { ok: true, data: data === undefined ? null : data };
    } catch (error) {
      // Never log request arguments or decrypted data. File errors do not leak internal traces.
      const message = error && error.code
        ? ({ ENOSPC: '磁盘空间不足，未能保存。', EACCES: '无法访问文件，请检查权限。', EPERM: '文件被占用或没有访问权限。', ENOENT: '找不到所选文件。' }[error.code] || '文件操作失败，请重试。')
        : (error instanceof Error ? error.message : '操作失败，请重试。');
      return { ok: false, error: message };
    }
  });
}

async function writeBackup(file, buffer) {
  if (path.resolve(file).toLowerCase() === vaultPath.toLowerCase()) throw new Error('请选择密码库文件以外的位置保存备份。');
  const tmp = `${file}.${randomBytes(8).toString('hex')}.tmp`;
  let fd;
  try {
    fd = await fs.open(tmp, 'wx', 0o600);
    await fd.writeFile(buffer);
    await fd.sync();
    await fd.close();
    fd = null;
    await fs.rename(tmp, file);
  } finally {
    if (fd) await fd.close().catch(() => {});
    await fs.unlink(tmp).catch(() => {});
  }
}

function registerHandlers() {
  handle('status', status);
  handle('create', async (password) => {
    const epoch = sessionEpoch;
    await vault.create(password);
    if (epoch !== sessionEpoch) { vault.lock(); throw new Error('操作已取消，请重新解锁。'); }
    unlocked = true;
    lastActivity = Date.now();
    return status();
  });
  handle('unlock', async (password) => {
    if (Date.now() < nextUnlockAt) throw new Error('请稍候几秒再尝试解锁。');
    nextUnlockAt = Date.now() + 750;
    const epoch = sessionEpoch;
    try {
      await vault.unlock(password);
      if (epoch !== sessionEpoch) { vault.lock(); throw new Error('操作已取消，请重新解锁。'); }
      unlocked = true;
      lastActivity = Date.now();
      failedUnlocks = 0;
      return status();
    } catch (error) {
      failedUnlocks += 1;
      nextUnlockAt = Date.now() + Math.min(failedUnlocks * 750, 30000);
      throw error;
    }
  });
  handle('lock', () => lockVault());
  handle('list', () => vault.list(), { secret: true });
  handle('getEntry', (id) => vault.getEntry(id), { secret: true });
  handle('saveEntry', (input) => vault.saveEntry(input), { secret: true });
  handle('deleteEntry', (id) => vault.deleteEntry(id), { secret: true });
  handle('generatePassword', (options) => generatePassword(options), { secret: true });
  handle('copyField', async (id, field) => {
    if (!['username', 'password'].includes(field)) throw new Error('不支持复制此字段。');
    const epoch = sessionEpoch;
    const entry = await vault.getEntry(id);
    if (epoch !== sessionEpoch || !unlocked) throw new Error('密码本已锁定，请先解锁。');
    clearCopiedValue();
    clipboard.writeText(entry[field]);
    clipboardDigest = hash(entry[field]);
    clipboardTimer = setTimeout(clearCopiedValue, 30000);
  }, { secret: true });
  handle('exportBackup', async () => {
    const epoch = sessionEpoch;
    const choice = await dialog.showSaveDialog(window, {
      title: '导出加密备份', defaultPath: `密屿备份-${new Date().toISOString().slice(0, 10)}.miyu`,
      filters: [{ name: '密屿加密备份', extensions: ['miyu'] }],
    });
    if (choice.canceled || !choice.filePath) return { canceled: true };
    if (epoch !== sessionEpoch) throw new Error('密码本已锁定，请重新解锁后导出。');
    const data = await vault.exportBackup();
    await writeBackup(choice.filePath, data);
    return { canceled: false, path: choice.filePath };
  }, { secret: true });
  handle('restoreBackup', async (password) => {
    const epoch = sessionEpoch;
    const choice = await dialog.showOpenDialog(window, {
      title: '选择密屿加密备份', properties: ['openFile'],
      filters: [{ name: '密屿加密备份', extensions: ['miyu'] }],
    });
    if (choice.canceled || !choice.filePaths[0]) return { canceled: true };
    if (epoch !== sessionEpoch) throw new Error('密码本已锁定，请重新解锁后恢复。');
    const file = await fs.open(choice.filePaths[0], 'r');
    let buffer;
    try {
      const stat = await file.stat();
      if (!stat.isFile() || stat.size < 1 || stat.size > 16 * 1024 * 1024) throw new Error('备份文件大小无效，最多支持 16 MB。');
      buffer = Buffer.alloc(stat.size + 1);
      let total = 0;
      while (total < buffer.length) {
        const { bytesRead } = await file.read(buffer, total, buffer.length - total, total);
        if (!bytesRead) break;
        total += bytesRead;
      }
      if (total !== stat.size) throw new Error('备份文件在读取时发生变化，请重试。');
      buffer = buffer.subarray(0, total);
    } finally { await file.close(); }
    if (epoch !== sessionEpoch) throw new Error('密码本已锁定，请重新解锁后恢复。');
    const entries = await vault.restoreBackup(buffer, password);
    return { canceled: false, entries };
  }, { secret: true });
  handle('changePassword', async (current, next) => {
    await vault.changePassword(current, next);
    clearCopiedValue();
  }, { secret: true });
  handle('setAutoLock', async (minutes) => {
    if (!AUTO_LOCK_VALUES.includes(minutes)) throw new Error('请选择有效的自动锁定时间。');
    const next = { autoLockMinutes: minutes };
    const write = settingsQueue.then(() => saveSettings(settingsPath, next)).then(() => { settings = next; });
    settingsQueue = write.catch(() => {});
    await write;
    lastActivity = Date.now();
  }, { secret: true });
  handle('activity', () => { if (unlocked) lastActivity = Date.now(); });
}

async function createWindow() {
  window = new BrowserWindow({
    width: 1320, height: 860, minWidth: 1040, minHeight: 720,
    title: '密屿密码本', backgroundColor: '#f5f5ef', show: false,
    icon: path.join(__dirname, '..', 'assets', 'icon.png'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'), sandbox: true, contextIsolation: true,
      nodeIntegration: false, webSecurity: true, spellcheck: false,
      partition: 'miyu-ephemeral', devTools: !app.isPackaged,
    },
  });
  Menu.setApplicationMenu(null);
  const ses = window.webContents.session;
  ses.setPermissionRequestHandler((_wc, _permission, callback) => callback(false));
  ses.setPermissionCheckHandler(() => false);
  ses.on('will-download', (event) => event.preventDefault());
  ses.webRequest.onBeforeRequest((details, callback) => {
    callback({ cancel: !details.url.startsWith('miyu://app/') });
  });
  await ses.protocol.handle('miyu', async (request) => {
    const url = new URL(request.url);
    if (url.host !== 'app' || request.method !== 'GET') return new Response('Forbidden', { status: 403 });
    let decoded;
    try { decoded = decodeURIComponent(url.pathname); } catch { return new Response('Bad request', { status: 400 }); }
    const file = path.resolve(rendererDir, `.${decoded}`);
    if (!file.startsWith(`${rendererDir}${path.sep}`)) return new Response('Forbidden', { status: 403 });
    return net.fetch(pathToFileURL(file).href);
  });
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  window.webContents.on('will-navigate', (event) => event.preventDefault());
  window.webContents.on('will-attach-webview', (event) => event.preventDefault());
  window.webContents.on('render-process-gone', lockVault);
  window.on('minimize', lockVault);
  window.on('closed', () => { lockVault(); window = null; });
  window.once('ready-to-show', () => { if (!isTest) window.show(); });
  await window.loadURL('miyu://app/index.html');
}

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (window) { if (window.isMinimized()) window.restore(); window.focus(); }
  });
  app.whenReady().then(async () => {
    app.setAppUserModelId('local.miyu.vault');
    settings = await readSettings(settingsPath);
    registerHandlers();
    powerMonitor.on('suspend', lockVault);
    powerMonitor.on('lock-screen', lockVault);
    setInterval(() => {
      if (unlocked && (Date.now() - lastActivity >= settings.autoLockMinutes * 60000 || powerMonitor.getSystemIdleTime() >= settings.autoLockMinutes * 60)) lockVault();
    }, 1000).unref();
    await createWindow();
  }).catch(() => {
    dialog.showErrorBox('密屿无法启动', '无法加载密码本，请检查应用文件和数据目录权限后重试。');
    app.quit();
  });
  app.on('before-quit', lockVault);
  app.on('window-all-closed', () => app.quit());
}
