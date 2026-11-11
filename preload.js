const { contextBridge, ipcRenderer, webUtils } = require('electron');

contextBridge.exposeInMainWorld('api', {
  selectImage: () => ipcRenderer.invoke('select-image'),
  pasteImage: () => ipcRenderer.invoke('paste-image'),
  selectDir: () => ipcRenderer.invoke('select-dir'),
  openDir: (dir) => ipcRenderer.invoke('open-dir', dir),
  build: (payload) => ipcRenderer.invoke('build', payload),
  listPets: () => ipcRenderer.invoke('list-pets'),
  preview: (payload) => ipcRenderer.invoke('preview', payload),
  exportAnimation: (payload) => ipcRenderer.invoke('export-animation', payload),
  bgModels: () => ipcRenderer.invoke('bg-models'),
  clearCutouts: () => ipcRenderer.invoke('clear-cutouts'),
  cutoutPreview: (payload) => ipcRenderer.invoke('cutout-preview', payload),
  importBundle: () => ipcRenderer.invoke('import-bundle'),
  gifBundle: (payload) => ipcRenderer.invoke('gif-bundle', payload),
  copyText: (text) => ipcRenderer.invoke('copy-text', text),
  selectImages: () => ipcRenderer.invoke('select-images'),
  zipFolder: (payload) => ipcRenderer.invoke('zip-folder', payload),
  listBundles: (payload) => ipcRenderer.invoke('list-bundles', payload),
  gifInfo: (payload) => ipcRenderer.invoke('gif-info', payload),
  appInfo: () => ipcRenderer.invoke('app-info'),
  exportLog: (text) => ipcRenderer.invoke('export-log', text),
  getUpdateConfig: () => ipcRenderer.invoke('get-update-config'),
  setUpdateConfig: (cfg) => ipcRenderer.invoke('set-update-config', cfg),
  checkUpdate: () => ipcRenderer.invoke('check-update'),
  downloadUpdate: (url) => ipcRenderer.invoke('download-update', url),
  saveDraft: (data) => ipcRenderer.invoke('save-draft', data),
  loadDraft: () => ipcRenderer.invoke('load-draft'),
  saveProject: (data) => ipcRenderer.invoke('save-project', data),
  openProject: () => ipcRenderer.invoke('open-project'),
  checkPaths: (list) => ipcRenderer.invoke('check-paths', list),
  getRecents: () => ipcRenderer.invoke('get-recents'),
  addRecent: (p) => ipcRenderer.invoke('add-recent', p),
  pathForFile: (file) => {
    try {
      return webUtils.getPathForFile(file);
    } catch (_) {
      return file.path || null;
    }
  },
  onLog: (cb) => ipcRenderer.on('build-log', (_e, line) => cb(line)),
  onCutoutLog: (cb) => ipcRenderer.on('cutout-log', (_e, line) => cb(line)),
});
