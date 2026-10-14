'use strict';
const { contextBridge, ipcRenderer } = require('electron');

const call = (channel) => (...args) => ipcRenderer.invoke(`vault:${channel}`, ...args);
contextBridge.exposeInMainWorld('vault', Object.freeze({
  status: call('status'), create: call('create'), unlock: call('unlock'), lock: call('lock'),
  list: call('list'), getEntry: call('getEntry'), saveEntry: call('saveEntry'),
  deleteEntry: call('deleteEntry'), copyField: call('copyField'),
  generatePassword: call('generatePassword'), exportBackup: call('exportBackup'),
  restoreBackup: call('restoreBackup'), changePassword: call('changePassword'),
  setAutoLock: call('setAutoLock'), activity: call('activity'),
  onLocked(callback) {
    if (typeof callback !== 'function') return () => {};
    const listener = () => callback();
    ipcRenderer.on('vault:locked', listener);
    return () => ipcRenderer.removeListener('vault:locked', listener);
  },
}));
