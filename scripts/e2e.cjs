'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { _electron: electron } = require('playwright');

const root = path.resolve(__dirname, '..');
const results = path.join(root, 'test-results');
const password = 'Test!234';
const nextPassword = 'Next!567';
let application;
let page;
let dataDir;
const errors = [];
const checks = [];
const check = (name) => { checks.push(name); console.log(`PASS ${name}`); };

async function launch() {
  const env = { ...process.env, MIYU_E2E: '1', MIYU_TEST_DATA: dataDir };
  delete env.ELECTRON_RUN_AS_NODE;
  application = await electron.launch({ args: [root], env, timeout: 30000 });
  await application.evaluate(({ powerMonitor, clipboard }) => {
    powerMonitor.getSystemIdleTime = () => 0;
    // Exercise copy/cleanup without replacing the user's actual Windows clipboard.
    globalThis.__testClipboard = '';
    clipboard.readText = () => globalThis.__testClipboard;
    clipboard.writeText = (text) => { globalThis.__testClipboard = text; };
    clipboard.clear = () => { globalThis.__testClipboard = ''; };
  });
  page = await application.firstWindow();
  page.on('pageerror', (error) => errors.push(error.message));
  page.setDefaultTimeout(12000);
  await page.locator('#gate-screen').waitFor({ state: 'visible' });
}

async function api(method, ...args) {
  const result = await page.evaluate(async ({ method, args }) => window.vault[method](...args), { method, args });
  assert.equal(result.ok, true, result.error);
  return result.data;
}

async function unlock(value = password) {
  await page.locator('#master-password').fill(value);
  await page.locator('#gate-submit').click();
  await page.locator('#app-screen').waitFor({ state: 'visible' });
}

async function addEntry(title, secret, category = '工作') {
  await page.locator('#new-entry').click();
  await page.locator('#entry-title').fill(title);
  await page.locator('#entry-url').fill('https://example.com');
  await page.locator('#entry-username').fill('demo@example.com');
  await page.locator('#entry-password').fill(secret);
  await page.locator('#entry-category').selectOption(category);
  await page.locator('#entry-notes').fill('仅供自动测试的虚构账号');
  await page.locator('#save-entry').click();
  await page.locator('#entry-dialog').waitFor({ state: 'hidden' });
  assert.equal(await page.locator('#detail-title').textContent(), title);
}

(async () => {
  await fs.mkdir(results, { recursive: true });
  dataDir = await fs.mkdtemp(path.join(results, 'isolated-'));
  try {
    await launch();
    assert.match(await page.locator('#gate-title').textContent(), /创建/);
    await page.screenshot({ path: path.join(results, 'setup.png') });
    const preferences = await application.evaluate(({ BrowserWindow }) => {
      const prefs = BrowserWindow.getAllWindows()[0].webContents.getLastWebPreferences();
      return { sandbox: prefs.sandbox, contextIsolation: prefs.contextIsolation, nodeIntegration: prefs.nodeIntegration };
    });
    assert.deepEqual(preferences, { sandbox: true, contextIsolation: true, nodeIntegration: false });
    assert.equal(await page.evaluate(() => typeof window.require), 'undefined');
    check('sandboxed renderer and first-run screen');

    await page.locator('#master-password').fill(password);
    assert.equal(password.length, 8);
    assert.equal(await page.locator('#master-password').getAttribute('minlength'), '8');
    assert.match(await page.locator('#master-strength-text').textContent(), /长度已达要求/);
    await page.locator('#confirm-password').fill(password);
    await page.locator('#gate-submit').click();
    await page.locator('#app-screen').waitFor({ state: 'visible' });
    assert.equal((await api('list')).length, 0);
    await addEntry('GitHub 演示账号', 'Example-Only!1234');
    const metadata = await api('list');
    assert.equal(metadata.length, 1);
    assert.equal('password' in metadata[0], false);
    const raw = await fs.readFile(path.join(dataDir, 'passwords.miyu'), 'utf8');
    for (const secret of [password, 'Example-Only!1234', 'demo@example.com', 'GitHub 演示账号']) assert.equal(raw.includes(secret), false);
    check('create vault, save account, metadata-only listing and ciphertext on disk');

    assert.equal(await page.locator('#detail-password').textContent(), '••••••••••••');
    await page.locator('#reveal-password').click();
    await page.waitForFunction(() => document.getElementById('detail-password').textContent === 'Example-Only!1234');
    await page.locator('#reveal-password').click();
    await page.locator('#copy-password').click();
    await page.waitForFunction(() => !document.getElementById('copy-password').disabled);
    assert.equal(await application.evaluate(() => globalThis.__testClipboard), 'Example-Only!1234');
    await page.locator('#lock-vault').click();
    await page.locator('#gate-screen').waitFor({ state: 'visible' });
    assert.equal(await application.evaluate(() => globalThis.__testClipboard), '');
    await unlock();
    check('copy password through main process and clear on lock (isolated clipboard)');
    await page.locator('#toggle-favorite').click();
    await page.waitForFunction(() => document.getElementById('favorite-count').textContent === '1');
    await page.locator('[data-filter="favorites"]').click();
    assert.equal(await page.locator('.entry-row').count(), 1);
    await page.locator('#search').fill('没有这个网站');
    assert.equal(await page.locator('.entry-row').count(), 0);
    await page.locator('#search').fill('GitHub');
    assert.equal(await page.locator('.entry-row').count(), 1);
    await page.locator('#search').fill('');
    await page.locator('[data-filter="all"]').click();
    await page.locator('#edit-entry').click();
    assert.equal(await page.locator('#entry-password').inputValue(), '');
    await page.locator('#entry-title').fill('GitHub · 工作');
    await page.locator('#save-entry').click();
    await page.locator('#entry-dialog').waitFor({ state: 'hidden' });
    assert.equal((await api('getEntry', metadata[0].id)).password, 'Example-Only!1234');
    check('search, favorite, reveal/hide, edit without losing password');

    await page.locator('#open-generator').click();
    await page.waitForFunction(() => document.getElementById('generated-password').textContent.length === 20);
    const generated = await page.locator('#generated-password').textContent();
    assert.match(generated, /[A-Z]/); assert.match(generated, /[a-z]/); assert.match(generated, /[2-9]/);
    await page.locator('#use-generated').click();
    assert.equal(await page.locator('#entry-password').inputValue(), generated);
    await page.locator('#entry-title').fill('邮箱 · 个人');
    await page.locator('#entry-username').fill('hello@example.com');
    await page.locator('#save-entry').click();
    await page.locator('#entry-dialog').waitFor({ state: 'hidden' });
    await addEntry('云端笔记', 'Another-Example!2048', '个人');
    await page.locator('.entry-row').filter({ hasText: 'GitHub · 工作' }).click();
    await page.screenshot({ path: path.join(results, 'vault.png') });
    check('secure password generator and three-column account screen');

    const backupPath = path.join(dataDir, 'backup.miyu');
    await application.evaluate(({ dialog }, file) => {
      dialog.showSaveDialog = async () => ({ canceled: false, filePath: file });
      dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [file] });
    }, backupPath);
    await page.locator('#open-backup').click();
    await page.locator('#export-backup').click();
    await page.waitForFunction(() => !document.getElementById('export-backup').disabled);
    assert.ok((await fs.stat(backupPath)).size > 100);
    await page.locator('#settings-dialog .modal-footer .dialog-close').click();
    await page.locator('#delete-entry').click();
    await page.locator('#confirm-action').click();
    await page.locator('#confirm-dialog').waitFor({ state: 'hidden' });
    assert.equal((await api('list')).length, 2);
    await page.locator('#open-backup').click();
    await page.locator('#backup-password').fill('Wrong-Backup!1234');
    await page.locator('#restore-confirm').check();
    await page.locator('#restore-backup').click();
    await page.locator('#restore-error').waitFor({ state: 'visible' });
    assert.equal((await api('list')).length, 2);
    await page.locator('#backup-password').fill(password);
    await page.locator('#restore-backup').click();
    await page.waitForFunction(() => !document.getElementById('restore-backup').disabled);
    assert.equal((await api('list')).length, 3);
    check('delete, encrypted export, failed restore preserves data, successful restore');

    await page.locator('#tab-security').click();
    await page.locator('#auto-lock').selectOption('1');
    await page.waitForFunction(() => !document.getElementById('auto-lock').disabled);
    assert.equal((await api('status')).autoLockMinutes, 1);
    await page.locator('#current-password').fill(password);
    await page.locator('#new-master-password').fill(nextPassword);
    assert.equal(nextPassword.length, 8);
    assert.equal(await page.locator('#new-master-password').getAttribute('minlength'), '8');
    await page.locator('#confirm-new-password').fill(nextPassword);
    await page.locator('#change-password-submit').click();
    await page.waitForFunction(() => !document.getElementById('change-password-submit').disabled);
    assert.equal(await page.locator('#current-password').inputValue(), '');
    await page.locator('#settings-dialog .modal-footer .dialog-close').click();
    await page.locator('#lock-vault').click();
    await page.locator('#gate-screen').waitFor({ state: 'visible' });
    assert.equal(await page.locator('.entry-row').count(), 0);
    const lockedList = await page.evaluate(() => window.vault.list());
    assert.equal(lockedList.ok, false);
    await page.locator('#master-password').fill(password);
    await page.locator('#gate-submit').click();
    await page.locator('#gate-error').waitFor({ state: 'visible' });
    await new Promise(resolve => setTimeout(resolve, 1000));
    await unlock(nextPassword);
    check('settings, master password rotation, lock cleanup and old password rejection');

    await application.evaluate(({ powerMonitor }) => powerMonitor.emit('lock-screen'));
    await page.locator('#gate-screen').waitFor({ state: 'visible' });
    await new Promise(resolve => setTimeout(resolve, 800));
    await unlock(nextPassword);
    await application.evaluate(({ powerMonitor }) => { powerMonitor.getSystemIdleTime = () => 61; });
    await page.locator('#gate-screen').waitFor({ state: 'visible' });
    check('system screen-lock and idle timeout');
    await application.close(); application = null;
    await launch();
    await unlock(nextPassword);
    assert.equal((await api('list')).length, 3);
    assert.equal((await api('status')).autoLockMinutes, 1);
    check('restart persistence of encrypted accounts and settings');
    assert.deepEqual(errors, []);
    await fs.writeFile(path.join(results, 'e2e-report.json'), JSON.stringify({ passed: true, checks, rendererErrors: errors }, null, 2));
  } catch (error) {
    if (page && !page.isClosed()) {
      await page.screenshot({ path: path.join(results, 'failure.png') }).catch(() => {});
      console.error('UI diagnostic:', await page.evaluate(() => ({ gateError: document.getElementById('gate-error').textContent, gateTitle: document.getElementById('gate-title').textContent })).catch(() => null));
    }
    throw error;
  } finally {
    if (application) await application.close().catch(() => {});
    // This directory is created by mkdtemp above, contains synthetic test data only.
    if (dataDir && path.dirname(dataDir) === results && path.basename(dataDir).startsWith('isolated-')) await fs.rm(dataDir, { recursive: true, force: true });
  }
})().catch((error) => { console.error(error); process.exitCode = 1; });
