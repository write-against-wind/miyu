'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { VaultStore, generatePassword } = require('../src/core/vault.cjs');

const MASTER = 'correct horse battery staple';
const SECOND_MASTER = 'another strong master password';

async function fixture(t, create = true) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'local-vault-test-'));
  const file = path.join(directory, 'vault.json');
  const store = new VaultStore(file);
  t.after(async () => {
    store.lock();
    // This test owns this exact directory returned by mkdtemp.
    await fs.rm(directory, { recursive: true, force: true });
  });
  if (create) await store.create(MASTER);
  return { directory, file, store };
}

test('8-character master passwords support creation, unlock, rotation and backup restore; 7 are rejected', async (t) => {
  const { store, file } = await fixture(t, false);
  const first = 'Test!234';
  const second = 'Next!567';
  await assert.rejects(store.create('1234567'), /8 至 1024/);
  assert.equal((await store.status()).exists, false);
  await store.create(first);
  const record = await store.saveEntry({ title: '八位主密码测试', password: 'entry-secret' });
  const backup = await store.exportBackup();
  store.lock();
  await assert.rejects(store.unlock('1234567'), /8 至 1024/);
  await store.unlock(first);
  const before = await fs.readFile(file);
  await assert.rejects(store.changePassword(first, '1234567'), /8 至 1024/);
  assert.deepEqual(await fs.readFile(file), before);
  await store.changePassword(first, second);
  store.lock();
  await store.unlock(second);
  await store.deleteEntry(record.id);
  await assert.rejects(store.restoreBackup(backup, '1234567'), /8 至 1024/);
  await store.restoreBackup(backup, first);
  assert.equal((await store.getEntry(record.id)).password, 'entry-secret');
  store.lock();
  await store.unlock(second);
});

test('encrypted storage round-trips CRUD and never persists plaintext', async (t) => {
  const { store, file } = await fixture(t, false);
  assert.deepEqual(await store.status(), { exists: false, locked: true });
  assert.deepEqual(await store.create(MASTER), { exists: true, locked: false });
  const metadata = await store.saveEntry({ title: '私人邮箱', username: 'secret-name@example.com', password: 'Secret-Pa55word-unique', url: 'example.com', notes: 'private note', favorite: true });
  assert.equal(metadata.url, 'https://example.com/');
  assert.equal(Object.hasOwn(metadata, 'password'), false);
  const content = await fs.readFile(file, 'utf8');
  for (const secret of [MASTER, '私人邮箱', 'secret-name@example.com', 'Secret-Pa55word-unique', 'private note']) assert.equal(content.includes(secret), false);
  assert.equal(JSON.parse(content).kdf.N, 131072);
  assert.deepEqual(await store.list(), [metadata]);
  const complete = await store.getEntry(metadata.id);
  assert.equal(complete.password, 'Secret-Pa55word-unique');
  complete.password = 'mutated in caller';
  assert.equal((await store.getEntry(metadata.id)).password, 'Secret-Pa55word-unique');
  await store.saveEntry({ id: metadata.id, title: '新标题' });
  store.lock();
  assert.deepEqual(await store.status(), { exists: true, locked: true });
  await store.unlock(MASTER);
  assert.equal((await store.getEntry(metadata.id)).password, 'Secret-Pa55word-unique');
  assert.equal((await store.list())[0].title, '新标题');
  await store.deleteEntry(metadata.id);
  store.lock();
  await store.unlock(MASTER);
  assert.deepEqual(await store.list(), []);
});

test('wrong passwords and authenticated-ciphertext tampering are rejected', async (t) => {
  const { store, file } = await fixture(t);
  await store.saveEntry({ title: '账户', password: 'Entry-secret-123' });
  const original = await fs.readFile(file);
  store.lock();
  await assert.rejects(store.unlock('incorrect master password'), /主密码不正确/);
  assert.equal((await store.status()).locked, true);
  const altered = JSON.parse(original);
  const cipherBytes = Buffer.from(altered.ciphertext, 'base64');
  cipherBytes[0] ^= 1;
  altered.ciphertext = cipherBytes.toString('base64');
  await fs.writeFile(file, JSON.stringify(altered));
  await assert.rejects(store.unlock(MASTER), /已损坏/);
  await fs.writeFile(file, original);
  await store.unlock(MASTER);
  assert.equal((await store.list()).length, 1);
});

test('backup restore replaces entries but retains destination master password', async (t) => {
  const source = await fixture(t);
  const record = await source.store.saveEntry({ title: '备份条目', password: 'backup-entry-password', category: '工作' });
  const backup = await source.store.exportBackup();
  const destination = await fixture(t, false);
  await destination.store.create(SECOND_MASTER);
  await destination.store.saveEntry({ title: '原条目', password: 'old-entry-password' });
  const before = await fs.readFile(destination.file);
  await assert.rejects(destination.store.restoreBackup(backup, 'a wrong backup password'), /主密码不正确/);
  assert.deepEqual(await fs.readFile(destination.file), before);
  assert.equal((await destination.store.list())[0].title, '原条目');
  assert.deepEqual(await destination.store.restoreBackup(backup, MASTER), [record]);
  assert.notDeepEqual(await fs.readFile(destination.file), backup);
  destination.store.lock();
  await assert.rejects(destination.store.unlock(MASTER), /主密码不正确/);
  await destination.store.unlock(SECOND_MASTER);
  assert.equal((await destination.store.getEntry(record.id)).password, 'backup-entry-password');
});

test('password rotation preserves entries and leaves older backups using their original password', async (t) => {
  const { store, file } = await fixture(t);
  const record = await store.saveEntry({ title: '邮箱', password: 'account-password-123' });
  const backup = await store.exportBackup();
  await assert.rejects(store.changePassword('wrong current master', SECOND_MASTER), /当前主密码不正确/);
  assert.deepEqual(await fs.readFile(file), backup);
  await assert.rejects(store.changePassword(MASTER, 'short'), /8 至 1024/);
  await store.changePassword(MASTER, SECOND_MASTER);
  const after = JSON.parse(await fs.readFile(file, 'utf8'));
  assert.notEqual(after.kdf.salt, JSON.parse(backup).kdf.salt);
  store.lock();
  await assert.rejects(store.unlock(MASTER), /主密码不正确/);
  await store.unlock(SECOND_MASTER);
  assert.equal((await store.getEntry(record.id)).password, 'account-password-123');
  await store.restoreBackup(backup, MASTER);
  store.lock();
  await store.unlock(SECOND_MASTER);
  assert.equal((await store.list()).length, 1);
});

test('locked vault refuses every sensitive API and recreation cannot overwrite data', async (t) => {
  const { store, file } = await fixture(t);
  const original = await fs.readFile(file);
  await assert.rejects(store.create(SECOND_MASTER), /已经存在/);
  assert.deepEqual(await fs.readFile(file), original);
  store.lock();
  for (const operation of [() => store.list(), () => store.getEntry('id'), () => store.saveEntry({ title: 'test', password: 'secret' }), () => store.deleteEntry('id'), () => store.exportBackup(), () => store.restoreBackup(original, MASTER), () => store.changePassword(MASTER, SECOND_MASTER)]) {
    await assert.rejects(operation(), /锁定/);
  }
});

test('record validation rejects bad fields without changing disk or memory', async (t) => {
  const { store, file } = await fixture(t);
  const original = await fs.readFile(file);
  for (const input of [null, {}, { title: '', password: 'secret' }, { title: 'a'.repeat(201), password: 'secret' }, { title: 'entry' }, { title: 'entry', password: '' }, { title: 'entry', password: 'a'.repeat(4097) }, { title: 'entry', password: 'secret', favorite: 'yes' }, { title: 'entry', password: 'secret', notes: 'a'.repeat(10001) }, { title: 'entry', password: 'secret', url: 'javascript:alert(1)' }, { title: 'entry', password: 'secret', url: 'https://user:password@example.com' }, { title: 'entry', password: 'secret', id: 'unknown' }]) {
    await assert.rejects(store.saveEntry(input));
  }
  assert.deepEqual(await fs.readFile(file), original);
  assert.deepEqual(await store.list(), []);
});

test('malicious envelope sizes, versions, KDF work factors and malformed base64 fail safely', async (t) => {
  const { store, file } = await fixture(t);
  const original = await fs.readFile(file);
  const envelope = JSON.parse(original);
  const candidates = [
    Buffer.from('not json'),
    Buffer.alloc(16 * 1024 * 1024 + 1),
    Buffer.from(JSON.stringify({ ...envelope, version: 999 })),
    Buffer.from(JSON.stringify({ ...envelope, kdf: { ...envelope.kdf, N: 2 ** 30 } })),
    Buffer.from(JSON.stringify({ ...envelope, cipher: { ...envelope.cipher, tag: 'bad==' } })),
    Buffer.from(JSON.stringify({ ...envelope, ciphertext: '????' })),
  ];
  for (const candidate of candidates) await assert.rejects(store.restoreBackup(candidate, MASTER));
  assert.deepEqual(await fs.readFile(file), original);
  assert.deepEqual(await store.list(), []);
});

test('concurrent writes are serialized, IDs/nonces are unique, and failed operations do not poison queue', async (t) => {
  const { store, file } = await fixture(t);
  const records = await Promise.all(Array.from({ length: 30 }, (_, index) => store.saveEntry({ title: `账户 ${index}`, password: `account-password-${index}` })));
  assert.equal(new Set(records.map((record) => record.id)).size, 30);
  assert.equal((await store.list()).length, 30);
  const firstNonce = JSON.parse(await fs.readFile(file, 'utf8')).cipher.iv;
  await assert.rejects(store.deleteEntry('unknown'));
  await store.saveEntry({ id: records[0].id, title: 'updated' });
  assert.notEqual(JSON.parse(await fs.readFile(file, 'utf8')).cipher.iv, firstNonce);
  store.lock();
  await store.unlock(MASTER);
  assert.equal((await store.list()).length, 30);
});

test('failed atomic rename leaves persisted and in-memory records intact and cleans temporary file', async (t) => {
  const { store, file, directory } = await fixture(t);
  const original = await fs.readFile(file);
  const originalRename = fs.rename;
  fs.rename = async (source, destination) => {
    if (destination === file) throw Object.assign(new Error('simulated disk failure'), { code: 'EACCES' });
    return originalRename(source, destination);
  };
  try { await assert.rejects(store.saveEntry({ title: 'must not appear', password: 'secret' }), /无法读写/); }
  finally { fs.rename = originalRename; }
  assert.deepEqual(await fs.readFile(file), original);
  assert.deepEqual(await store.list(), []);
  assert.deepEqual(await fs.readdir(directory), ['vault.json']);
  await store.saveEntry({ title: 'after recovery', password: 'secret' });
  assert.equal((await store.list()).length, 1);
});

test('locking cancels queued reads and saves without returning plaintext', async (t) => {
  const { store, file } = await fixture(t);
  const record = await store.saveEntry({ title: 'private', password: 'private-secret' });
  const before = await fs.readFile(file);
  const operations = [store.getEntry(record.id), store.list(), store.saveEntry({ title: 'cancelled', password: 'private-secret' })];
  store.lock();
  const results = await Promise.allSettled(operations);
  assert.ok(results.every((result) => result.status === 'rejected' && /锁定/.test(result.reason.message)));
  assert.deepEqual(await fs.readFile(file), before);
  assert.equal((await store.status()).locked, true);
});

test('locking during async unlock cannot revive the session', async (t) => {
  const { store, file } = await fixture(t);
  store.lock();
  const originalOpen = fs.open;
  let releaseRead;
  let signalRead;
  const readStarted = new Promise((resolve) => { signalRead = resolve; });
  const blockRead = new Promise((resolve) => { releaseRead = resolve; });
  fs.open = async (target, ...args) => {
    if (target === file && args[0] === 'r') { signalRead(); await blockRead; }
    return originalOpen(target, ...args);
  };
  let pending;
  try {
    pending = store.unlock(MASTER);
    await readStarted;
    store.lock();
    releaseRead();
    await assert.rejects(pending, /锁定/);
  } finally { releaseRead(); fs.open = originalOpen; }
  assert.equal((await store.status()).locked, true);
  await assert.rejects(store.list(), /锁定/);
  await store.unlock(MASTER);
  assert.equal((await store.status()).locked, false);
});

test('locking an in-flight write before commit leaves the previous vault on disk', async (t) => {
  const { store, file, directory } = await fixture(t);
  const original = await fs.readFile(file);
  const originalOpen = fs.open;
  let releaseSync;
  let signalSync;
  const syncStarted = new Promise((resolve) => { signalSync = resolve; });
  const blockSync = new Promise((resolve) => { releaseSync = resolve; });
  fs.open = async (target, ...args) => {
    const handle = await originalOpen(target, ...args);
    if (target.startsWith(`${file}.`) && args[0] === 'wx') {
      const sync = handle.sync.bind(handle);
      handle.sync = async () => { await sync(); signalSync(); await blockSync; };
    }
    return handle;
  };
  try {
    const pending = store.saveEntry({ title: 'must remain cancelled', password: 'secret' });
    await syncStarted;
    store.lock();
    releaseSync();
    await assert.rejects(pending, /锁定/);
  } finally { releaseSync(); fs.open = originalOpen; }
  assert.deepEqual(await fs.readFile(file), original);
  assert.deepEqual(await fs.readdir(directory), ['vault.json']);
  await store.unlock(MASTER);
  assert.deepEqual(await store.list(), []);
});

test('failed password rotation keeps the original master key usable', async (t) => {
  const { store, file } = await fixture(t);
  const record = await store.saveEntry({ title: 'unchanged', password: 'secret' });
  const original = await fs.readFile(file);
  const originalRename = fs.rename;
  fs.rename = async (source, destination) => {
    if (destination === file) throw Object.assign(new Error('simulated full disk'), { code: 'ENOSPC' });
    return originalRename(source, destination);
  };
  try { await assert.rejects(store.changePassword(MASTER, SECOND_MASTER), /磁盘空间不足/); }
  finally { fs.rename = originalRename; }
  assert.deepEqual(await fs.readFile(file), original);
  assert.equal((await store.getEntry(record.id)).password, 'secret');
  store.lock();
  await store.unlock(MASTER);
  assert.equal((await store.list()).length, 1);
});

test('authenticated backups still validate decrypted records and duplicate IDs', async (t) => {
  const { store, file } = await fixture(t);
  const record = await store.saveEntry({ title: 'valid', password: 'secret' });
  const fullRecord = await store.getEntry(record.id);
  const original = await fs.readFile(file);
  const envelope = JSON.parse(original);
  const key = crypto.scryptSync(MASTER, Buffer.from(envelope.kdf.salt, 'base64'), 32, { N: 131072, r: 8, p: 1, maxmem: 256 * 1024 * 1024 });
  const forge = (entries) => {
    const next = JSON.parse(original);
    next.cipher.iv = crypto.randomBytes(12).toString('base64');
    const cipher = crypto.createCipheriv('aes-256-gcm', key, Buffer.from(next.cipher.iv, 'base64'));
    cipher.setAAD(Buffer.from(JSON.stringify({ format: next.format, version: next.version, kdf: next.kdf, cipher: { name: next.cipher.name, iv: next.cipher.iv } })));
    next.ciphertext = Buffer.concat([cipher.update(JSON.stringify({ version: 1, entries })), cipher.final()]).toString('base64');
    next.cipher.tag = cipher.getAuthTag().toString('base64');
    return Buffer.from(JSON.stringify(next));
  };
  try {
    await assert.rejects(store.restoreBackup(forge([fullRecord, fullRecord]), MASTER), /重复/);
    await assert.rejects(store.restoreBackup(forge([{ ...fullRecord, favorite: 'yes' }]), MASTER), /收藏状态/);
    await assert.rejects(store.restoreBackup(forge([{ ...fullRecord, createdAt: 'invalid-date' }]), MASTER), /日期/);
  } finally { key.fill(0); }
  assert.deepEqual(await fs.readFile(file), original);
  assert.deepEqual(await store.list(), [record]);
});

test('multi-megabyte authenticated backups parse, restore, export and reopen safely', async (t) => {
  const { store } = await fixture(t);
  const record = await store.saveEntry({ title: 'large backup seed', password: 'secret' });
  const seed = await store.getEntry(record.id);
  const envelope = JSON.parse(await store.exportBackup());
  const records = Array.from({ length: 120 }, (_, index) => ({
    ...seed,
    id: crypto.randomUUID(),
    title: `大量数据 ${index}`,
    notes: '大体积备份测试'.repeat(1000),
  }));
  const key = crypto.scryptSync(MASTER, Buffer.from(envelope.kdf.salt, 'base64'), 32, { N: 131072, r: 8, p: 1, maxmem: 256 * 1024 * 1024 });
  let backup;
  try {
    envelope.cipher.iv = crypto.randomBytes(12).toString('base64');
    const cipher = crypto.createCipheriv('aes-256-gcm', key, Buffer.from(envelope.cipher.iv, 'base64'));
    cipher.setAAD(Buffer.from(JSON.stringify({ format: envelope.format, version: envelope.version, kdf: envelope.kdf, cipher: { name: envelope.cipher.name, iv: envelope.cipher.iv } })));
    envelope.ciphertext = Buffer.concat([cipher.update(JSON.stringify({ version: 1, entries: records })), cipher.final()]).toString('base64');
    envelope.cipher.tag = cipher.getAuthTag().toString('base64');
    backup = Buffer.from(JSON.stringify(envelope));
  } finally { key.fill(0); }
  assert.ok(backup.length > 3 * 1024 * 1024);
  const metadata = await store.restoreBackup(backup, MASTER);
  assert.equal(metadata.length, records.length);
  assert.equal(metadata[119].notes, records[119].notes);
  const exported = await store.exportBackup();
  assert.ok(exported.length > 3 * 1024 * 1024);
  store.lock();
  await store.unlock(MASTER);
  assert.equal((await store.list()).length, records.length);
  assert.equal((await store.getEntry(records[119].id)).password, 'secret');
});

test('password generator meets complexity, excludes ambiguous characters and validates options', () => {
  const generated = new Set();
  for (let iteration = 0; iteration < 100; iteration += 1) {
    const password = generatePassword();
    assert.equal(password.length, 20);
    assert.match(password, /[A-Z]/);
    assert.match(password, /[a-z]/);
    assert.match(password, /[2-9]/);
    assert.match(password, /[^A-Za-z0-9]/);
    assert.doesNotMatch(password, /[Il1O0o]/);
    generated.add(password);
  }
  assert.equal(generated.size, 100);
  const flags = ['uppercase', 'lowercase', 'numbers', 'symbols'];
  const checks = [/[A-Z]/, /[a-z]/, /[0-9]/, /[^A-Za-z0-9]/];
  for (let mask = 1; mask < 16; mask += 1) {
    const options = { length: 8 };
    flags.forEach((flag, index) => { options[flag] = Boolean(mask & (1 << index)); });
    const password = generatePassword(options);
    flags.forEach((flag, index) => {
      if (options[flag]) assert.match(password, checks[index]);
      else assert.doesNotMatch(password, checks[index]);
    });
  }
  assert.match(generatePassword({ uppercase: false, lowercase: false, numbers: true, symbols: false, length: 128 }), /^[2-9]{128}$/);
  for (const options of [{ length: 7 }, { length: 129 }, { length: 8.5 }, { uppercase: 'yes' }, { uppercase: false, lowercase: false, numbers: false, symbols: false }, null]) assert.throws(() => generatePassword(options));
});
