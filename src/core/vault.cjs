'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs/promises');
const path = require('node:path');
const { promisify } = require('node:util');

const scrypt = promisify(crypto.scrypt);
const FORMAT = 'local-password-vault';
const VERSION = 1;
const KDF = Object.freeze({ name: 'scrypt', N: 131072, r: 8, p: 1 });
const MAX_BYTES = 16 * 1024 * 1024;
const MAX_ENTRIES = 10000;
const ENTRY_KEYS = ['id', 'title', 'username', 'password', 'url', 'category', 'notes', 'favorite', 'createdAt', 'updatedAt'];
const ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

class VaultError extends Error {}
const fail = (message) => { throw new VaultError(message); };
const isObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);

function exactKeys(value, keys) {
  return isObject(value) && Object.keys(value).length === keys.length && keys.every((key) => Object.hasOwn(value, key));
}

function validateMaster(password) {
  if (typeof password !== 'string' || password.length < 8 || password.length > 1024) {
    fail('主密码需要 8 至 1024 个字符。');
  }
}

function stringField(value, label, max, required = false) {
  if (typeof value !== 'string' || value.length > max || value.includes('\0')) fail(`${label}格式不正确，最多允许 ${max} 个字符。`);
  if (required && !value.trim()) fail(`请填写${label}。`);
  return value;
}

function normalizeUrl(value) {
  const text = stringField(value, '网址', 2048).trim();
  if (!text) return '';
  let parsed;
  try { parsed = new URL(/^[a-z][a-z0-9+.-]*:/i.test(text) ? text : `https://${text}`); }
  catch { fail('请输入有效的网站地址。'); }
  if (!['http:', 'https:'].includes(parsed.protocol) || !parsed.hostname || parsed.username || parsed.password) {
    fail('网址仅支持不含登录信息的 HTTP 或 HTTPS 地址。');
  }
  return stringField(parsed.href, '网址', 2048);
}

function validateRecord(record) {
  if (!exactKeys(record, ENTRY_KEYS) || typeof record.id !== 'string' || !ID_RE.test(record.id)) fail('密码库中的条目格式不正确。');
  stringField(record.title, '标题', 200, true);
  stringField(record.username, '账号', 1024);
  stringField(record.password, '密码', 4096, true);
  normalizeUrl(record.url);
  stringField(record.category, '分类', 80, true);
  stringField(record.notes, '备注', 10000);
  if (typeof record.favorite !== 'boolean') fail('收藏状态格式不正确。');
  for (const key of ['createdAt', 'updatedAt']) {
    if (typeof record[key] !== 'string' || record[key].length !== 24 || !Number.isFinite(Date.parse(record[key])) || new Date(record[key]).toISOString() !== record[key]) {
      fail('密码库中的日期格式不正确。');
    }
  }
  return { ...record };
}

function validatePayload(payload) {
  if (!exactKeys(payload, ['version', 'entries']) || payload.version !== VERSION || !Array.isArray(payload.entries) || payload.entries.length > MAX_ENTRIES) {
    fail('密码库内容无效或条目超过 10000 条。');
  }
  const ids = new Set();
  return payload.entries.map((item) => {
    const record = validateRecord(item);
    if (ids.has(record.id)) fail('密码库包含重复的条目编号。');
    ids.add(record.id);
    return record;
  });
}

function base64(value, bytes, label) {
  if (typeof value !== 'string' || value.length % 4 !== 0 || !/^[A-Za-z0-9+/]*={0,2}$/.test(value)) fail(`${label}格式不正确。`);
  const decoded = Buffer.from(value, 'base64');
  if (!decoded.length || (bytes !== undefined && decoded.length !== bytes) || decoded.toString('base64') !== value) fail(`${label}格式不正确。`);
  return decoded;
}

function parseEnvelope(buffer) {
  if (!Buffer.isBuffer(buffer) || !buffer.length || buffer.length > MAX_BYTES) fail('密码库或备份大小无效，最大支持 16 MB。');
  let envelope;
  try { envelope = JSON.parse(buffer.toString('utf8')); }
  catch { fail('无法读取密码库格式，请选择有效的加密备份。'); }
  if (!exactKeys(envelope, ['format', 'version', 'kdf', 'cipher', 'ciphertext']) || envelope.format !== FORMAT || envelope.version !== VERSION) fail('不支持此密码库格式或版本。');
  if (!exactKeys(envelope.kdf, ['name', 'N', 'r', 'p', 'salt']) || Object.entries(KDF).some(([key, value]) => envelope.kdf[key] !== value)) fail('不支持此备份的加密参数。');
  if (!exactKeys(envelope.cipher, ['name', 'iv', 'tag']) || envelope.cipher.name !== 'aes-256-gcm') fail('不支持此备份的加密算法。');
  base64(envelope.kdf.salt, 32, '加密盐');
  base64(envelope.cipher.iv, 12, '加密随机数');
  base64(envelope.cipher.tag, 16, '认证标签');
  base64(envelope.ciphertext, undefined, '加密内容');
  return envelope;
}

function aad(envelope) {
  return Buffer.from(JSON.stringify({
    format: FORMAT,
    version: VERSION,
    kdf: { ...KDF, salt: envelope.kdf.salt },
    cipher: { name: 'aes-256-gcm', iv: envelope.cipher.iv },
  }));
}

async function deriveKey(password, salt) {
  const secret = Buffer.from(password, 'utf8');
  try { return await scrypt(secret, Buffer.from(salt, 'base64'), 32, { N: KDF.N, r: KDF.r, p: KDF.p, maxmem: 256 * 1024 * 1024 }); }
  finally { secret.fill(0); }
}

function decrypt(envelope, key) {
  let plaintext;
  try {
    const decipher = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(envelope.cipher.iv, 'base64'), { authTagLength: 16 });
    decipher.setAAD(aad(envelope));
    decipher.setAuthTag(Buffer.from(envelope.cipher.tag, 'base64'));
    const pending = decipher.update(Buffer.from(envelope.ciphertext, 'base64'));
    try { plaintext = Buffer.concat([pending, decipher.final()]); }
    finally { pending.fill(0); }
  } catch { fail('主密码不正确，或密码库文件已损坏。'); }
  try {
    let payload;
    try { payload = JSON.parse(plaintext.toString('utf8')); }
    catch { fail('密码库内容无法读取。'); }
    return validatePayload(payload);
  } finally { if (plaintext) plaintext.fill(0); }
}

function encrypt(entries, key, salt) {
  const envelope = {
    format: FORMAT,
    version: VERSION,
    kdf: { ...KDF, salt },
    cipher: { name: 'aes-256-gcm', iv: crypto.randomBytes(12).toString('base64'), tag: '' },
    ciphertext: '',
  };
  const plaintext = Buffer.from(JSON.stringify({ version: VERSION, entries }), 'utf8');
  try {
    if (plaintext.length > MAX_BYTES) fail('密码库过大，最大支持 16 MB 的加密文件。');
    const cipher = crypto.createCipheriv('aes-256-gcm', key, Buffer.from(envelope.cipher.iv, 'base64'), { authTagLength: 16 });
    cipher.setAAD(aad(envelope));
    envelope.ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]).toString('base64');
    envelope.cipher.tag = cipher.getAuthTag().toString('base64');
    const encoded = Buffer.from(JSON.stringify(envelope), 'utf8');
    if (encoded.length > MAX_BYTES) fail('密码库过大，最大支持 16 MB 的加密文件。');
    return encoded;
  } finally { plaintext.fill(0); }
}

const metadata = ({ password, ...rest }) => ({ ...rest });

/** Local encrypted store. Call lock() on idle, suspend and window close. */
class VaultStore {
  #filePath;
  #key = null;
  #salt = null;
  #entries = null;
  #epoch = 0;
  #queue = Promise.resolve();

  constructor(filePath) {
    if (typeof filePath !== 'string' || !filePath) throw new Error('请指定密码库文件位置。');
    this.#filePath = path.resolve(filePath);
  }

  #guard(epoch, needsUnlocked = false) {
    if (epoch !== this.#epoch || (needsUnlocked && !this.#key)) fail('密码库已锁定，请重新解锁。');
  }

  #run(operation) {
    const epoch = this.#epoch;
    const result = this.#queue.then(async () => {
      this.#guard(epoch);
      try {
        const value = await operation(epoch);
        this.#guard(epoch);
        return value;
      } catch (error) {
        if (error instanceof VaultError) throw error;
        if (error && error.code === 'ENOSPC') fail('磁盘空间不足，未能保存密码库。');
        fail('无法读写密码库，请检查文件权限和磁盘空间。');
      }
    });
    this.#queue = result.catch(() => {});
    return result;
  }

  async #exists() {
    try { await fs.stat(this.#filePath); return true; }
    catch (error) { if (error.code === 'ENOENT') return false; throw error; }
  }

  async #read() {
    const handle = await fs.open(this.#filePath, 'r');
    try {
      const stat = await handle.stat();
      if (!stat.isFile() || stat.size < 1 || stat.size > MAX_BYTES) fail('密码库文件大小无效，最大支持 16 MB。');
      const bytes = Buffer.alloc(stat.size + 1);
      let total = 0;
      while (total < bytes.length) {
        const { bytesRead } = await handle.read(bytes, total, bytes.length - total, total);
        if (!bytesRead) break;
        total += bytesRead;
      }
      if (total !== stat.size) fail('密码库文件在读取时发生变化，请重试。');
      return bytes.subarray(0, total);
    } finally { await handle.close(); }
  }

  async #write(buffer, epoch, createOnly = false) {
    this.#guard(epoch);
    await fs.mkdir(path.dirname(this.#filePath), { recursive: true });
    const temp = `${this.#filePath}.${crypto.randomBytes(16).toString('hex')}.tmp`;
    let handle;
    try {
      handle = await fs.open(temp, 'wx', 0o600);
      await handle.writeFile(buffer);
      await handle.sync();
      await handle.close();
      handle = null;
      this.#guard(epoch);
      if (createOnly && await this.#exists()) fail('密码库已经存在，请直接解锁。');
      this.#guard(epoch);
      await fs.rename(temp, this.#filePath);
      this.#guard(epoch);
    } finally {
      if (handle) await handle.close().catch(() => {});
      await fs.unlink(temp).catch(() => {});
    }
  }

  async status() {
    try { return { exists: await this.#exists(), locked: !this.#key }; }
    catch { fail('无法读取密码库状态，请检查文件权限。'); }
  }

  create(password) {
    return this.#run(async (epoch) => {
      validateMaster(password);
      if (await this.#exists()) fail('密码库已经存在，请直接解锁。');
      const salt = crypto.randomBytes(32).toString('base64');
      const key = await deriveKey(password, salt);
      try {
        this.#guard(epoch);
        await this.#write(encrypt([], key, salt), epoch, true);
        this.#guard(epoch);
        if (this.#key) this.#key.fill(0);
        this.#key = key;
        this.#salt = salt;
        this.#entries = [];
        return { exists: true, locked: false };
      } finally { if (this.#key !== key) key.fill(0); }
    });
  }

  unlock(password) {
    return this.#run(async (epoch) => {
      validateMaster(password);
      if (!await this.#exists()) fail('尚未创建密码库。');
      const envelope = parseEnvelope(await this.#read());
      const key = await deriveKey(password, envelope.kdf.salt);
      try {
        this.#guard(epoch);
        const entries = decrypt(envelope, key);
        if (this.#key) this.#key.fill(0);
        this.#key = key;
        this.#salt = envelope.kdf.salt;
        this.#entries = entries;
        return { exists: true, locked: false };
      } finally { if (this.#key !== key) key.fill(0); }
    });
  }

  /** Synchronous invalidation also cancels queued/in-flight operations. */
  lock() {
    this.#epoch += 1;
    if (this.#key) this.#key.fill(0);
    this.#key = null;
    this.#salt = null;
    this.#entries = null;
  }

  list() {
    return this.#run((epoch) => {
      this.#guard(epoch, true);
      return this.#entries.map(metadata);
    });
  }

  getEntry(id) {
    return this.#run((epoch) => {
      this.#guard(epoch, true);
      const entry = this.#entries.find((item) => item.id === id);
      if (!entry) fail('没有找到此条目。');
      return { ...entry };
    });
  }

  saveEntry(input) {
    // Copy renderer-provided fields before queueing so callers cannot mutate work in flight.
    const data = isObject(input) ? { ...input } : null;
    return this.#run(async (epoch) => {
      this.#guard(epoch, true);
      if (!data) fail('条目内容格式不正确。');
      const existing = data.id ? this.#entries.find((entry) => entry.id === data.id) : null;
      if (data.id !== undefined && !existing) fail('没有找到要修改的条目。');
      if (!existing && this.#entries.length >= MAX_ENTRIES) fail('最多可以保存 10000 条记录。');
      const fallback = (name, value) => data[name] === undefined ? (existing ? existing[name] : value) : data[name];
      const now = new Date().toISOString();
      const record = validateRecord({
        id: existing ? existing.id : crypto.randomUUID(),
        title: stringField(data.title, '标题', 200, true).trim(),
        username: fallback('username', ''),
        password: fallback('password', undefined),
        url: normalizeUrl(fallback('url', '')),
        category: stringField(fallback('category', '其他'), '分类', 80).trim() || '其他',
        notes: fallback('notes', ''),
        favorite: fallback('favorite', false),
        createdAt: existing ? existing.createdAt : now,
        updatedAt: now,
      });
      const entries = existing ? this.#entries.map((entry) => entry.id === existing.id ? record : entry) : [...this.#entries, record];
      await this.#write(encrypt(entries, this.#key, this.#salt), epoch);
      this.#guard(epoch, true);
      this.#entries = entries;
      return metadata(record);
    });
  }

  deleteEntry(id) {
    return this.#run(async (epoch) => {
      this.#guard(epoch, true);
      if (!this.#entries.some((entry) => entry.id === id)) fail('没有找到要删除的条目。');
      const entries = this.#entries.filter((entry) => entry.id !== id);
      await this.#write(encrypt(entries, this.#key, this.#salt), epoch);
      this.#guard(epoch, true);
      this.#entries = entries;
    });
  }

  /** Backups use the current master password; exports contain no plaintext. */
  exportBackup() {
    return this.#run(async (epoch) => {
      this.#guard(epoch, true);
      const bytes = await this.#read();
      this.#guard(epoch, true);
      // Authenticate the bytes from disk before calling them a valid backup.
      decrypt(parseEnvelope(bytes), this.#key);
      return bytes;
    });
  }

  /** Replaces all entries while retaining the current vault's master password. */
  restoreBackup(buffer, backupPassword) {
    const copy = Buffer.isBuffer(buffer) && buffer.length <= MAX_BYTES ? Buffer.from(buffer) : null;
    return this.#run(async (epoch) => {
      this.#guard(epoch, true);
      validateMaster(backupPassword);
      const envelope = parseEnvelope(copy);
      const importKey = await deriveKey(backupPassword, envelope.kdf.salt);
      let entries;
      try {
        this.#guard(epoch, true);
        entries = decrypt(envelope, importKey);
      } finally { importKey.fill(0); }
      await this.#write(encrypt(entries, this.#key, this.#salt), epoch);
      this.#guard(epoch, true);
      this.#entries = entries;
      return entries.map(metadata);
    });
  }

  changePassword(currentPassword, newPassword) {
    return this.#run(async (epoch) => {
      this.#guard(epoch, true);
      validateMaster(currentPassword);
      validateMaster(newPassword);
      const currentKey = await deriveKey(currentPassword, this.#salt);
      try {
        this.#guard(epoch, true);
        if (!crypto.timingSafeEqual(currentKey, this.#key)) fail('当前主密码不正确。');
      } finally { currentKey.fill(0); }
      const salt = crypto.randomBytes(32).toString('base64');
      const nextKey = await deriveKey(newPassword, salt);
      try {
        this.#guard(epoch, true);
        await this.#write(encrypt(this.#entries, nextKey, salt), epoch);
        this.#guard(epoch, true);
        this.#key.fill(0);
        this.#key = nextKey;
        this.#salt = salt;
        return { exists: true, locked: false };
      } finally { if (this.#key !== nextKey) nextKey.fill(0); }
    });
  }
}

/** Uses randomInt and a secure shuffle; every selected character set is present. */
function generatePassword(options = {}) {
  if (!isObject(options)) fail('密码生成选项格式不正确。');
  const settings = { length: 20, uppercase: true, lowercase: true, numbers: true, symbols: true, excludeAmbiguous: true, ...options };
  if (!Number.isInteger(settings.length) || settings.length < 8 || settings.length > 128) fail('密码长度需要是 8 至 128 的整数。');
  for (const flag of ['uppercase', 'lowercase', 'numbers', 'symbols', 'excludeAmbiguous']) {
    if (typeof settings[flag] !== 'boolean') fail('密码字符类型选项格式不正确。');
  }
  const sets = [];
  for (const [flag, characters] of Object.entries({ uppercase: 'ABCDEFGHIJKLMNOPQRSTUVWXYZ', lowercase: 'abcdefghijklmnopqrstuvwxyz', numbers: '0123456789', symbols: '!@#$%^&*()-_=+[]{};:,.?' })) {
    if (settings[flag]) sets.push(settings.excludeAmbiguous ? characters.replace(/[Il1O0o]/g, '') : characters);
  }
  if (!sets.length) fail('请至少选择一种密码字符类型。');
  const alphabet = sets.join('');
  const output = sets.map((characters) => characters[crypto.randomInt(characters.length)]);
  while (output.length < settings.length) output.push(alphabet[crypto.randomInt(alphabet.length)]);
  for (let i = output.length - 1; i > 0; i -= 1) {
    const j = crypto.randomInt(i + 1);
    [output[i], output[j]] = [output[j], output[i]];
  }
  return output.join('');
}

module.exports = { VaultStore, generatePassword };
