'use strict';

const ICONS = {
  lock: '<rect x="5" y="10" width="14" height="11" rx="2"/><path d="M8 10V6a4 4 0 0 1 8 0v4M12 14v3"/>',
  'shield-check': '<path d="M12 3 4 6v6c0 5 8 9 8 9s8-4 8-9V6z"/><path d="m8 12 3 3 5-6"/>',
  shield: '<path d="M12 3 4 6v6c0 5 8 9 8 9s8-4 8-9V6z"/><path d="M12 8v5m0 3h.01"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  grid: '<rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/>',
  star: '<path d="m12 3 2.8 5.7 6.2.9-4.5 4.4 1.1 6.2L12 17.3l-5.6 2.9 1.1-6.2L3 9.6l6.2-.9z"/>',
  wand: '<path d="m4 20 12-12 4 4L8 24M3 21l12-12 3 3L6 24" transform="translate(0 -3)"/><path d="M7 3v4M5 5h4M18 2v4M16 4h4M20 17v4m-2-2h4"/>',
  archive: '<rect x="3" y="3" width="18" height="5" rx="1"/><path d="M5 8v12h14V8M10 12h4"/>',
  settings: '<path d="m9 3-.6 2.3-2 .9-2.1-.6-2 3.4 1.5 1.7v2.6L2.3 15l2 3.4 2.1-.6 2 .9L9 21h4l.6-2.3 2-.9 2.1.6 2-3.4-1.5-1.7v-2.6L19.7 9l-2-3.4-2.1.6-2-.9L13 3z"/><circle cx="11" cy="12" r="3"/>',
  search: '<circle cx="10.5" cy="10.5" r="6.5"/><path d="m16 16 5 5"/>',
  eye: '<path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12Z"/><circle cx="12" cy="12" r="3"/>',
  'eye-off': '<path d="m3 3 18 18M10.6 5.1 12 5c6.5 0 10 7 10 7s-1.2 2.4-3.6 4.4M6.3 6.3C3.5 8.3 2 12 2 12s3.5 7 10 7c1.9 0 3.6-.6 5-1.5M10 10a2.8 2.8 0 0 0 4 4"/>',
  copy: '<rect x="8" y="8" width="12" height="13" rx="2"/><path d="M16 8V5a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v10a2 2 0 0 0 2 2h3"/>',
  globe: '<circle cx="12" cy="12" r="9"/><ellipse cx="12" cy="12" rx="4" ry="9"/><path d="M3 12h18"/>',
  note: '<path d="M14 3H5v18h14V8zM14 3v5h5M8 12h8M8 16h6"/>',
  edit: '<path d="m15 4 5 5M4 20l5-1L20 8a3.5 3.5 0 0 0-5-5L4 14z"/>',
  trash: '<path d="M3 6h18M9 6V3h6v3M5 6l1 15h12l1-15M10 10v7m4-7v7"/>',
  close: '<path d="m6 6 12 12M18 6 6 18"/>',
  'arrow-right': '<path d="M4 12h16m-6-6 6 6-6 6"/>',
  refresh: '<path d="M20 7v5h-5M4 17v-5h5M6.1 6.1a8 8 0 0 1 12.8 2.2L20 12M4 12l1.1 3.7a8 8 0 0 0 12.8 2.2"/>',
  download: '<path d="M12 3v12m-5-5 5 5 5-5M4 16v5h16v-5"/>',
  upload: '<path d="M12 16V4m-5 5 5-5 5 5M4 16v5h16v-5"/>',
  folder: '<path d="M3 7V4h6l3 3h9v13H3z"/>',
  check: '<path d="m5 12 4 4L19 6"/>',
};

const $ = (id) => document.getElementById(id);
const $$ = (selector) => [...document.querySelectorAll(selector)];
function setIcon(element, name) {
  // Only constant, app-owned SVG paths enter this HTML sink. All user data uses textContent.
  element.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[name] || ICONS.lock}</svg>`;
}
$$('[data-icon]').forEach((element) => setIcon(element, element.dataset.icon));

const bridge = window.vault;
const categories = ['工作', '个人', '财务', '社交', '其他'];
const state = {
  exists: false,
  locked: true,
  epoch: 0,
  entries: [],
  selectedId: null,
  filter: 'all',
  query: '',
  autoLockMinutes: 5,
  dataPath: '',
  editingId: null,
  generatorForEntry: false,
  revealTimer: null,
  revealRequest: 0,
  generateRequest: 0,
  toastTimers: new Set(),
};

async function api(method, ...args) {
  const result = await bridge[method](...args);
  if (!result || result.ok !== true) throw new Error(result?.error || '操作未完成，请重试。');
  return result.data;
}

function readableError(error) { return error instanceof Error ? error.message : '操作未完成，请重试。'; }
function showError(id, error) {
  const element = $(id);
  element.textContent = error ? readableError(error) : '';
  element.classList.toggle('hidden', !error);
}
function toast(message, isError = false) {
  const element = document.createElement('div');
  element.className = `toast${isError ? ' error' : ''}`;
  const icon = document.createElement('span');
  setIcon(icon, isError ? 'shield' : 'check');
  const text = document.createElement('span');
  text.textContent = message;
  element.append(icon, text);
  $('toast-region').replaceChildren(element);
  const timer = setTimeout(() => { element.remove(); state.toastTimers.delete(timer); }, isError ? 5500 : 3600);
  state.toastTimers.add(timer);
}
function clearToasts() {
  state.toastTimers.forEach(clearTimeout);
  state.toastTimers.clear();
  $('toast-region').replaceChildren();
}
function alive(epoch) { return epoch === state.epoch && !state.locked; }
function selectedEntry() { return state.entries.find((entry) => entry.id === state.selectedId); }
function showScreen(name) {
  ['loading', 'gate', 'app'].forEach((screen) => $(`${screen}-screen`).classList.toggle('hidden', screen !== name));
}
function displayDate(value) {
  const date = new Date(value);
  if (Number.isNaN(date.valueOf())) return '—';
  return date.toLocaleDateString('zh-CN', { year: 'numeric', month: '2-digit', day: '2-digit' });
}
function domainLabel(value) {
  if (!value) return '尚未填写网站地址';
  try { return new URL(/^https?:\/\//i.test(value) ? value : `https://${value}`).hostname || value; }
  catch { return value; }
}
function avatarInfo(entry) {
  const title = entry.title || '账号';
  const tone = [...title].reduce((sum, character) => sum + character.codePointAt(0), 0) % 6;
  return { character: [...title][0].toLocaleUpperCase(), tone };
}
function renderAvatar(element, entry, large = false) {
  const { character, tone } = avatarInfo(entry);
  element.className = `site-avatar tone-${tone}${large ? ' large' : ''}`;
  element.textContent = character;
}
function entryInput(entry) {
  return {
    id: entry.id, title: entry.title, username: entry.username, url: entry.url,
    category: entry.category, notes: entry.notes, favorite: entry.favorite,
  };
}

function resetPasswordToggle(inputId, buttonId, label = '密码') {
  $(inputId).type = 'password';
  setIcon($(buttonId), 'eye');
  $(buttonId).setAttribute('aria-label', `显示${label}`);
  $(buttonId).title = `显示${label}`;
}
function togglePassword(inputId, buttonId, label = '密码') {
  const visible = $(inputId).type === 'password';
  $(inputId).type = visible ? 'text' : 'password';
  setIcon($(buttonId), visible ? 'eye-off' : 'eye');
  $(buttonId).setAttribute('aria-label', `${visible ? '隐藏' : '显示'}${label}`);
  $(buttonId).title = `${visible ? '隐藏' : '显示'}${label}`;
}
function renderGate() {
  showScreen('gate');
  $('gate-form').reset();
  $('master-password').value = '';
  $('confirm-password').value = '';
  $('create-only').classList.toggle('hidden', state.exists);
  $('confirm-password').required = !state.exists;
  $('master-password').minLength = state.exists ? 1 : 8;
  $('master-password').autocomplete = state.exists ? 'current-password' : 'new-password';
  $('master-password').placeholder = state.exists ? '输入主密码以解锁' : '至少 8 个字符';
  $('gate-step').textContent = state.exists ? 'WELCOME BACK TO YOUR ISLAND' : 'YOUR PRIVATE SPACE';
  $('gate-title').textContent = state.exists ? '欢迎回到你的密屿' : '创建你的密码库';
  $('gate-description').textContent = state.exists ? '输入主密码，让每一份秘密回到手边。' : '设置一个主密码，开启专属的私密空间。';
  $('gate-submit-text').textContent = state.exists ? '解锁密码库' : '创建密码库';
  $('master-strength-fill').className = '';
  $('master-strength-text').textContent = '推荐使用容易记住的长句，混合数字与符号。';
  resetPasswordToggle('master-password', 'toggle-master', '主密码');
  showError('gate-error', null);
  setTimeout(() => $('master-password').focus(), 50);
}
function applyStatus(status) {
  state.exists = Boolean(status.exists);
  state.locked = Boolean(status.locked);
  state.autoLockMinutes = status.autoLockMinutes || 5;
  state.dataPath = status.dataPath || '';
  $('auto-lock').value = String(state.autoLockMinutes);
  $('auto-lock-label').textContent = `闲置 ${state.autoLockMinutes} 分钟后自动锁定`;
  $('data-path').textContent = state.dataPath || '系统用户数据目录';
}
function hideSecret() {
  clearTimeout(state.revealTimer);
  state.revealTimer = null;
  state.revealRequest += 1;
  $('detail-password').textContent = '••••••••••••';
  $('detail-password').classList.remove('revealed');
  setIcon($('reveal-password'), 'eye');
  $('reveal-password').title = '显示密码';
  $('reveal-password').setAttribute('aria-label', '显示密码');
}
function clearDialog(dialog) {
  if (dialog.id === 'entry-dialog') {
    $('entry-form').reset();
    $('entry-password').value = '';
    state.editingId = null;
    resetPasswordToggle('entry-password', 'toggle-entry-password');
    showError('entry-error', null);
  } else if (dialog.id === 'generator-dialog') {
    $('generated-password').textContent = '';
    state.generateRequest += 1;
    state.generatorForEntry = false;
    showError('generator-error', null);
  } else if (dialog.id === 'settings-dialog') {
    $('change-password-form').reset();
    $('restore-form').reset();
    ['current-password', 'new-master-password', 'confirm-new-password', 'backup-password'].forEach((id) => { $(id).value = ''; });
    showError('change-password-error', null);
    showError('restore-error', null);
  } else if (dialog.id === 'confirm-dialog') {
    $('confirm-description').textContent = '';
    showError('confirm-error', null);
  }
}
function closeDialog(dialog) {
  if (dialog.dataset.busy === 'true') return;
  dialog.close();
  clearDialog(dialog);
}
function handleLocked() {
  state.epoch += 1;
  state.locked = true;
  state.entries = [];
  state.selectedId = null;
  state.filter = 'all';
  state.query = '';
  $('search').value = '';
  hideSecret();
  $$('dialog').forEach((dialog) => { dialog.close(); clearDialog(dialog); });
  $('entry-list').replaceChildren();
  ['detail-title', 'detail-username', 'detail-domain', 'detail-url', 'detail-category', 'detail-notes', 'detail-created', 'detail-updated', 'detail-avatar'].forEach((id) => { $(id).textContent = ''; });
  clearToasts();
  renderGate();
}
async function refreshEntries(epoch = state.epoch, desiredSelection = state.selectedId) {
  const entries = await api('list');
  if (!alive(epoch)) return;
  // Retain only metadata, even if a future backend accidentally includes a secret.
  state.entries = entries.map(({ password: _omitted, ...entry }) => entry).sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt));
  state.selectedId = desiredSelection;
  renderWorkspace();
}
function filteredEntries() {
  const query = state.query.trim().toLocaleLowerCase();
  return state.entries.filter((entry) => {
    if (state.filter === 'favorites' && !entry.favorite) return false;
    if (categories.includes(state.filter) && entry.category !== state.filter) return false;
    return !query || [entry.title, entry.username, entry.url, entry.notes].some((value) => String(value || '').toLocaleLowerCase().includes(query));
  });
}
function renderWorkspace() {
  const visible = filteredEntries();
  if (!visible.some((entry) => entry.id === state.selectedId)) {
    state.selectedId = visible[0]?.id || null;
    hideSecret();
  }
  $('all-count').textContent = state.entries.length;
  $('favorite-count').textContent = state.entries.filter((entry) => entry.favorite).length;
  $$('[data-category-count]').forEach((element) => { element.textContent = state.entries.filter((entry) => entry.category === element.dataset.categoryCount).length; });
  $$('[data-filter]').forEach((element) => {
    const active = element.dataset.filter === state.filter;
    element.classList.toggle('active', active);
    if (active) element.setAttribute('aria-current', 'page'); else element.removeAttribute('aria-current');
  });
  const title = state.filter === 'all' ? '所有账号' : state.filter === 'favorites' ? '我的收藏' : state.filter;
  const count = $('view-count');
  $('view-title').replaceChildren(document.createTextNode(title), count);
  count.textContent = visible.length;
  $('list-caption').textContent = state.query ? `找到 ${visible.length} 个账号` : state.filter === 'all' ? '全部账号' : title;
  $('entry-list').replaceChildren();
  $('entry-list').classList.toggle('hidden', !visible.length);
  $('list-empty').classList.toggle('visible', !visible.length);
  $('list-empty-text').textContent = state.query ? '没有找到匹配的账号' : state.filter === 'favorites' ? '还没有收藏的账号' : state.filter === 'all' ? '还没有保存的账号' : '这个分类还没有账号';
  $('list-empty-help').textContent = state.query ? '试试其他名称、用户名或网站' : state.filter === 'favorites' ? '点击账号右上角的星标即可收藏' : '从添加你的第一个账号开始';
  const fragment = document.createDocumentFragment();
  for (const entry of visible) {
    const item = document.createElement('div');
    item.setAttribute('role', 'listitem');
    const button = document.createElement('button');
    button.type = 'button';
    button.className = `entry-row${entry.id === state.selectedId ? ' selected' : ''}`;
    button.setAttribute('aria-pressed', String(entry.id === state.selectedId));
    button.dataset.entryId = entry.id;
    const avatar = document.createElement('span');
    renderAvatar(avatar, entry);
    avatar.setAttribute('aria-hidden', 'true');
    const info = document.createElement('span');
    info.className = 'entry-row-info';
    const name = document.createElement('span');
    name.className = 'entry-row-title';
    name.textContent = entry.title;
    const username = document.createElement('span');
    username.className = 'entry-row-username';
    username.textContent = entry.username || domainLabel(entry.url);
    info.append(name, username);
    button.append(avatar, info);
    if (entry.favorite) {
      const favorite = document.createElement('span');
      favorite.className = 'entry-row-favorite';
      favorite.setAttribute('aria-label', '已收藏');
      setIcon(favorite, 'star');
      button.append(favorite);
    }
    button.addEventListener('click', () => { hideSecret(); state.selectedId = entry.id; renderWorkspace(); });
    item.append(button);
    fragment.append(item);
  }
  $('entry-list').append(fragment);
  renderDetail();
}
function renderDetail() {
  const entry = selectedEntry();
  $('detail-empty').classList.toggle('hidden', Boolean(entry));
  $('entry-detail').classList.toggle('hidden', !entry);
  if (!entry) {
    const hasEntries = state.entries.length > 0;
    $('empty-title').textContent = hasEntries ? '一份安心，随时在这里。' : '让秘密，井然有序。';
    $('empty-description').replaceChildren(document.createTextNode(hasEntries ? '选择其他分类，或添加一个新账号。' : '保存网站、账号与密码。'), document.createElement('br'), document.createTextNode(hasEntries ? '你的密码库，由你慢慢整理。' : '下次需要时，就在这里。'));
    const addIcon = document.createElement('span'); setIcon(addIcon, 'plus');
    $('empty-add').replaceChildren(addIcon, document.createTextNode(hasEntries ? '添加账号' : '添加第一个账号'));
    return;
  }
  renderAvatar($('detail-avatar'), entry, true);
  $('detail-title').textContent = entry.title;
  $('detail-domain').textContent = domainLabel(entry.url);
  $('detail-category').textContent = entry.category || '其他';
  $('detail-username').textContent = entry.username || '未填写';
  $('copy-username').disabled = !entry.username;
  $('detail-url').textContent = entry.url || '未填写';
  $('detail-notes').textContent = entry.notes || '暂时没有备注';
  $('detail-notes').classList.toggle('empty-note', !entry.notes);
  $('detail-created').textContent = `创建于 ${displayDate(entry.createdAt)}`;
  $('detail-updated').textContent = `最近更新 ${displayDate(entry.updatedAt)}`;
  $('toggle-favorite').classList.toggle('active', entry.favorite);
  $('toggle-favorite').setAttribute('aria-pressed', String(Boolean(entry.favorite)));
  $('toggle-favorite').setAttribute('aria-label', entry.favorite ? '取消收藏' : '收藏账号');
  $('toggle-favorite').title = entry.favorite ? '取消收藏' : '收藏账号';
}

async function withBusy(dialogId, buttonId, busyLabel, errorId, work) {
  const dialog = $(dialogId);
  if (dialog.dataset.busy === 'true') return;
  const button = $(buttonId);
  const previousLabel = button.textContent;
  const controls = [...dialog.querySelectorAll('button, input, select, textarea')];
  const priorDisabled = controls.map((control) => control.disabled);
  dialog.dataset.busy = 'true';
  dialog.setAttribute('aria-busy', 'true');
  controls.forEach((control) => { control.disabled = true; });
  button.textContent = busyLabel;
  const epoch = state.epoch;
  showError(errorId, null);
  try { await work(epoch); }
  catch (error) { if (epoch === state.epoch) showError(errorId, error); }
  finally {
    delete dialog.dataset.busy;
    dialog.removeAttribute('aria-busy');
    controls.forEach((control, index) => { control.disabled = priorDisabled[index]; });
    button.textContent = previousLabel;
  }
}

function openEntry(entry = null, password = '') {
  if (state.locked) return;
  hideSecret();
  $('entry-form').reset();
  state.editingId = entry?.id || null;
  $('entry-dialog-title').textContent = entry ? '编辑账号' : '添加账号';
  $('entry-title').value = entry?.title || '';
  $('entry-username').value = entry?.username || '';
  $('entry-url').value = entry?.url || '';
  $('entry-category').value = entry?.category || (categories.includes(state.filter) ? state.filter : '个人');
  $('entry-notes').value = entry?.notes || '';
  $('entry-favorite').checked = Boolean(entry?.favorite) || (!entry && state.filter === 'favorites');
  $('entry-password').value = password;
  $('entry-password').required = !entry;
  $('entry-password').placeholder = entry ? '留空则保留原密码' : '输入或生成一个密码';
  $('entry-password-help').textContent = entry ? '只在需要更改密码时填写，留空保留原密码。' : '建议每个账号使用不同的密码。';
  resetPasswordToggle('entry-password', 'toggle-entry-password');
  showError('entry-error', null);
  $('entry-dialog').showModal();
  $('entry-title').focus();
}
function switchSettingsTab(tab) {
  const security = tab === 'security';
  $('security-settings').classList.toggle('hidden', !security);
  $('backup-settings').classList.toggle('hidden', security);
  $('tab-security').classList.toggle('active', security);
  $('tab-backup').classList.toggle('active', !security);
  $('tab-security').setAttribute('aria-selected', String(security));
  $('tab-backup').setAttribute('aria-selected', String(!security));
  $('tab-security').tabIndex = security ? 0 : -1;
  $('tab-backup').tabIndex = security ? -1 : 0;
}
function openSettings(tab = 'security') {
  if (state.locked) return;
  hideSecret();
  switchSettingsTab(tab);
  $('auto-lock').value = String(state.autoLockMinutes);
  $('settings-dialog').showModal();
}

$('master-password').addEventListener('input', () => {
  if (state.exists) return;
  const length = $('master-password').value.length;
  const strength = length >= 24 ? 'four' : length >= 16 ? 'three' : length >= 8 ? 'two' : length ? 'one' : '';
  $('master-strength-fill').className = strength ? `strength-${strength}` : '';
  $('master-strength-text').textContent = length && length < 8 ? '还差一点：请使用至少 8 个字符。' : length >= 24 ? '长度充足，请确保它独一无二且容易记住。' : length >= 8 ? '长度已达要求，更长的独特短句会更好。' : '推荐使用容易记住的长句，混合数字与符号。';
});
$('toggle-master').addEventListener('click', () => togglePassword('master-password', 'toggle-master', '主密码'));
$('toggle-entry-password').addEventListener('click', () => togglePassword('entry-password', 'toggle-entry-password'));
$('gate-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  if ($('gate-submit').disabled) return;
  showError('gate-error', null);
  if (!state.exists && $('master-password').value !== $('confirm-password').value) { showError('gate-error', new Error('两次输入的主密码不一致。')); $('confirm-password').focus(); return; }
  const epoch = state.epoch;
  const wasExisting = state.exists;
  $('gate-submit').disabled = true;
  $('master-password').disabled = true;
  $('confirm-password').disabled = true;
  $('toggle-master').disabled = true;
  $('gate-submit-text').textContent = wasExisting ? '正在解锁…' : '正在创建…';
  try {
    const status = await api(wasExisting ? 'unlock' : 'create', $('master-password').value);
    if (epoch !== state.epoch) return;
    applyStatus(status);
    $('master-password').value = '';
    $('confirm-password').value = '';
    if (state.locked) { renderGate(); return; }
    await refreshEntries(epoch);
    if (!alive(epoch)) return;
    showScreen('app');
    $('search').focus();
    if (!wasExisting) toast('密码库已创建，欢迎来到密屿。');
  } catch (error) {
    if (epoch === state.epoch) { showError('gate-error', error); $('master-password').value = ''; }
  } finally {
    $('gate-submit').disabled = false;
    $('master-password').disabled = false;
    $('confirm-password').disabled = false;
    $('toggle-master').disabled = false;
    $('gate-submit-text').textContent = state.exists ? '解锁密码库' : '创建密码库';
    if (state.locked) $('master-password').focus();
  }
});

$$('[data-filter]').forEach((button) => button.addEventListener('click', () => {
  hideSecret(); state.filter = button.dataset.filter; state.selectedId = null; renderWorkspace();
}));
$('search').addEventListener('input', () => { hideSecret(); state.query = $('search').value; renderWorkspace(); });
$('new-entry').addEventListener('click', () => openEntry());
$('empty-add').addEventListener('click', () => openEntry());
$('edit-entry').addEventListener('click', () => { const entry = selectedEntry(); if (entry) openEntry(entry); });
$$('.dialog-close').forEach((button) => button.addEventListener('click', () => closeDialog(button.closest('dialog'))));
$$('dialog').forEach((dialog) => {
  dialog.addEventListener('cancel', (event) => { if (dialog.dataset.busy === 'true') event.preventDefault(); });
  dialog.addEventListener('close', () => clearDialog(dialog));
});

$('entry-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  const input = {
    title: $('entry-title').value.trim(), username: $('entry-username').value,
    url: $('entry-url').value.trim(), category: $('entry-category').value,
    notes: $('entry-notes').value, favorite: $('entry-favorite').checked,
  };
  if (!input.title) { showError('entry-error', new Error('请填写账号名称。')); $('entry-title').focus(); return; }
  if (state.editingId) input.id = state.editingId;
  if ($('entry-password').value || !state.editingId) input.password = $('entry-password').value;
  await withBusy('entry-dialog', 'save-entry', '正在保存…', 'entry-error', async (epoch) => {
    const entry = await api('saveEntry', input);
    delete input.password;
    if (!alive(epoch)) return;
    state.filter = 'all'; state.query = ''; $('search').value = '';
    await refreshEntries(epoch, entry.id);
    if (!alive(epoch)) return;
    $('entry-dialog').close(); clearDialog($('entry-dialog'));
    toast('账号已加密保存。');
  });
  delete input.password;
});
$('toggle-favorite').addEventListener('click', async () => {
  const entry = selectedEntry();
  if (!entry || $('toggle-favorite').disabled) return;
  const epoch = state.epoch;
  $('toggle-favorite').disabled = true;
  try {
    await api('saveEntry', { ...entryInput(entry), favorite: !entry.favorite });
    if (!alive(epoch)) return;
    await refreshEntries(epoch);
  } catch (error) { if (alive(epoch)) toast(readableError(error), true); }
  finally { $('toggle-favorite').disabled = false; }
});
$('delete-entry').addEventListener('click', () => {
  const entry = selectedEntry();
  if (!entry) return;
  hideSecret();
  $('confirm-description').textContent = `“${entry.title}”的账号信息将从密码库中移除。此操作无法撤销。`;
  $('confirm-dialog').dataset.entryId = entry.id;
  showError('confirm-error', null);
  $('confirm-dialog').showModal();
  $('confirm-dialog').querySelector('.modal-footer .dialog-close').focus();
});
$('confirm-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  const id = $('confirm-dialog').dataset.entryId;
  await withBusy('confirm-dialog', 'confirm-action', '正在删除…', 'confirm-error', async (epoch) => {
    await api('deleteEntry', id);
    if (!alive(epoch)) return;
    hideSecret();
    state.selectedId = null;
    await refreshEntries(epoch);
    if (!alive(epoch)) return;
    $('confirm-dialog').close(); clearDialog($('confirm-dialog'));
    toast('账号已删除。');
  });
});

async function copyField(field) {
  const entry = selectedEntry();
  if (!entry) return;
  const epoch = state.epoch;
  const button = $(`copy-${field}`);
  button.disabled = true;
  try { await api('copyField', entry.id, field); if (alive(epoch)) toast(`${field === 'password' ? '密码' : '用户名'}已复制，30 秒后自动清理剪贴板。`); }
  catch (error) { if (alive(epoch)) toast(readableError(error), true); }
  finally { button.disabled = field === 'username' && !selectedEntry()?.username; }
}
$('copy-username').addEventListener('click', () => copyField('username'));
$('copy-password').addEventListener('click', () => copyField('password'));
$('reveal-password').addEventListener('click', async () => {
  if ($('detail-password').classList.contains('revealed')) { hideSecret(); return; }
  const entry = selectedEntry();
  if (!entry) return;
  const epoch = state.epoch;
  const request = ++state.revealRequest;
  $('reveal-password').disabled = true;
  try {
    const fullEntry = await api('getEntry', entry.id);
    if (!alive(epoch) || entry.id !== state.selectedId || request !== state.revealRequest) { delete fullEntry.password; return; }
    $('detail-password').textContent = fullEntry.password;
    delete fullEntry.password;
    $('detail-password').classList.add('revealed');
    setIcon($('reveal-password'), 'eye-off');
    $('reveal-password').title = '隐藏密码（20 秒后自动隐藏）';
    $('reveal-password').setAttribute('aria-label', '隐藏密码');
    state.revealTimer = setTimeout(hideSecret, 20000);
  } catch (error) { if (alive(epoch)) toast(readableError(error), true); }
  finally { $('reveal-password').disabled = false; }
});

async function generatePassword() {
  if (state.locked) return;
  const request = ++state.generateRequest;
  const epoch = state.epoch;
  const options = {
    length: Number($('password-length').value), uppercase: $('gen-uppercase').checked,
    lowercase: $('gen-lowercase').checked, numbers: $('gen-numbers').checked,
    symbols: $('gen-symbols').checked, excludeAmbiguous: $('gen-exclude').checked,
  };
  $('length-value').textContent = options.length;
  $('use-generated').disabled = true;
  $('generated-password').textContent = '';
  showError('generator-error', null);
  if (!options.uppercase && !options.lowercase && !options.numbers && !options.symbols) { showError('generator-error', new Error('请至少选择一类字符。')); return; }
  try {
    const password = await api('generatePassword', options);
    if (!alive(epoch) || request !== state.generateRequest || !$('generator-dialog').open) return;
    $('generated-password').textContent = password;
    $('use-generated').disabled = false;
  } catch (error) { if (alive(epoch) && request === state.generateRequest) showError('generator-error', error); }
}
function openGenerator(forEntry = false) {
  if (state.locked) return;
  hideSecret();
  state.generatorForEntry = forEntry;
  const icon = document.createElement('span'); setIcon(icon, forEntry ? 'check' : 'plus');
  $('use-generated').replaceChildren(icon, document.createTextNode(forEntry ? '使用这个密码' : '用于新账号'));
  $('generator-dialog').showModal();
  generatePassword();
}
$('open-generator').addEventListener('click', () => openGenerator(false));
$('entry-generate').addEventListener('click', () => openGenerator(true));
$('regenerate-password').addEventListener('click', generatePassword);
['password-length', 'gen-uppercase', 'gen-lowercase', 'gen-numbers', 'gen-symbols', 'gen-exclude'].forEach((id) => $(id).addEventListener('input', generatePassword));
$('use-generated').addEventListener('click', () => {
  const password = $('generated-password').textContent;
  if (!password || state.locked) return;
  const forEntry = state.generatorForEntry;
  closeDialog($('generator-dialog'));
  if (forEntry) {
    $('entry-password').value = password;
    resetPasswordToggle('entry-password', 'toggle-entry-password');
    $('entry-password-help').textContent = '已填入生成的密码，保存账号后即可使用。';
    $('entry-password').focus();
  } else openEntry(null, password);
});

$('open-settings').addEventListener('click', () => openSettings('security'));
$('open-backup').addEventListener('click', () => openSettings('backup'));
$('tab-security').addEventListener('click', () => switchSettingsTab('security'));
$('tab-backup').addEventListener('click', () => switchSettingsTab('backup'));
[$('tab-security'), $('tab-backup')].forEach((tab) => tab.addEventListener('keydown', (event) => {
  if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
    event.preventDefault();
    const target = tab.id === 'tab-security' ? 'backup' : 'security';
    switchSettingsTab(target);
    $(`tab-${target}`).focus();
  }
}));
$('auto-lock').addEventListener('change', async () => {
  const minutes = Number($('auto-lock').value);
  const epoch = state.epoch;
  $('auto-lock').disabled = true;
  try {
    await api('setAutoLock', minutes);
    if (!alive(epoch)) return;
    state.autoLockMinutes = minutes;
    $('auto-lock-label').textContent = `闲置 ${minutes} 分钟后自动锁定`;
    toast('自动锁定时间已更新。');
  } catch (error) { if (alive(epoch)) { $('auto-lock').value = String(state.autoLockMinutes); toast(readableError(error), true); } }
  finally { $('auto-lock').disabled = false; }
});
$('change-password-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  if ($('new-master-password').value !== $('confirm-new-password').value) { showError('change-password-error', new Error('两次输入的新主密码不一致。')); return; }
  await withBusy('settings-dialog', 'change-password-submit', '正在更新…', 'change-password-error', async (epoch) => {
    await api('changePassword', $('current-password').value, $('new-master-password').value);
    if (!alive(epoch)) return;
    $('change-password-form').reset();
    toast('主密码已更新。请牢记新的主密码。');
  });
});
$('export-backup').addEventListener('click', async () => {
  await withBusy('settings-dialog', 'export-backup', '正在导出…', 'restore-error', async (epoch) => {
    const result = await api('exportBackup');
    if (alive(epoch) && !result.canceled) toast('加密备份已导出，请妥善保管。');
  });
});
$('restore-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  if (!$('restore-confirm').checked) { showError('restore-error', new Error('请先确认替换当前密码库。')); return; }
  await withBusy('settings-dialog', 'restore-backup', '正在恢复…', 'restore-error', async (epoch) => {
    try {
      const result = await api('restoreBackup', $('backup-password').value);
      if (!alive(epoch) || result.canceled) return;
      hideSecret();
      state.filter = 'all'; state.query = ''; state.selectedId = null; $('search').value = '';
      await refreshEntries(epoch);
      if (!alive(epoch)) return;
      $('restore-form').reset();
      toast('备份已恢复，当前主密码保持不变。');
    } finally { $('backup-password').value = ''; }
  });
});

async function lockVault() {
  if (state.locked) return;
  const epoch = state.epoch;
  // The main process always emits onLocked. Applying it again after the IPC
  // response can clear a newly typed password when delivery order differs.
  try { await api('lock'); }
  catch (error) { if (epoch === state.epoch) toast(readableError(error), true); }
}
$('lock-vault').addEventListener('click', lockVault);
document.addEventListener('keydown', (event) => {
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'l' && !state.locked) { event.preventDefault(); lockVault(); }
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k' && !state.locked && !document.querySelector('dialog[open]')) { event.preventDefault(); $('search').focus(); $('search').select(); }
});
let lastActivity = 0;
function reportActivity(event) {
  if (!bridge || state.locked || !event.isTrusted) return;
  const now = Date.now();
  if (now - lastActivity < 10000) return;
  lastActivity = now;
  Promise.resolve(bridge.activity()).catch(() => {});
}
['keydown', 'pointerdown', 'pointermove', 'wheel'].forEach((name) => document.addEventListener(name, reportActivity, { passive: true }));
document.addEventListener('visibilitychange', () => { if (document.hidden) hideSecret(); });
window.addEventListener('blur', hideSecret);

async function initialize() {
  if (!bridge) {
    renderGate();
    $('gate-title').textContent = '请从桌面应用打开密屿';
    $('gate-description').textContent = '密码库需要桌面应用提供本地加密与安全存储。';
    $('gate-form').classList.add('hidden');
    document.querySelector('.gate-security').textContent = '在项目目录运行 npm start，启动 Windows 应用。';
    return;
  }
  bridge.onLocked(handleLocked);
  try {
    const status = await api('status');
    applyStatus(status);
    if (!state.exists || state.locked) renderGate();
    else { await refreshEntries(); if (!state.locked) showScreen('app'); }
  } catch (error) {
    renderGate();
    showError('gate-error', error);
    $('gate-submit').disabled = true;
  }
}
initialize();
