const { app, BrowserWindow, ipcMain, dialog, shell, clipboard, net, screen } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');
const crypto = require('crypto');
const { spawn } = require('child_process');

const DEFAULT_UPDATE_URL =
  'https://evgenii-evdokimov.github.io/pet-sprite-builder/latest.json';

function appTempDir() {
  const d = path.join(app.getPath('userData'), 'tmp');
  try {
    fs.mkdirSync(d, { recursive: true });
  } catch (_) {}
  return d;
}

if (process.env.PSB_DEBUG) {
  try {
    fs.writeFileSync(path.join(appTempDir(), 'psb_main_ran.txt'), String(Date.now()));
  } catch (_) {}
}
let win = null;
let allowClose = false;
let projectDirty = false;
let overlayWin = null;

function createWindow() {
  win = new BrowserWindow({
    width: 1000,
    height: 820,
    minWidth: 820,
    minHeight: 640,
    backgroundColor: '#12141a',
    title: 'Pet Sprite Builder',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  win.setMenuBarVisibility(false);
  win.loadFile(path.join(__dirname, 'renderer', 'index.html'));

  win.on('close', async (e) => {
    if (allowClose || !projectDirty) return;
    e.preventDefault();
    const { response } = await dialog.showMessageBox(win, {
      type: 'question',
      title: 'Pet Sprite Builder',
      message: 'Сохранить проект перед закрытием?',
      detail:
        'Черновик сохраняется автоматически, но именованный файл проекта — нет. Можно сохранить и закрыть или выйти без сохранения.',
      buttons: ['Сохранить проект', 'Выйти без сохранения', 'Отмена'],
      defaultId: 0,
      cancelId: 2,
      noLink: true,
    });
    if (response === 0) {
      win.webContents.send('request-save-and-close');
    } else if (response === 1) {
      allowClose = true;
      win.close();
    }
  });

  if (process.env.PET_SMOKE) {
    win.webContents.on('console-message', (_e, level, message) => {
      console.log(`RENDER[${level}]: ${message}`);
    });
    win.webContents.on('did-finish-load', () => {
      console.log('SMOKE_LOADED');
      setTimeout(() => app.quit(), 700);
    });
  }
}

function findPython() {
  if (process.env.PET_PYTHON) return process.env.PET_PYTHON;
  const local = process.env.LOCALAPPDATA;
  if (local) {
    for (const v of ['Python313', 'Python312', 'Python311', 'Python310']) {
      const p = path.join(local, 'Programs', 'Python', v, 'python.exe');
      if (fs.existsSync(p)) return p;
    }
  }
  return 'python';
}

function backendCommand() {
  if (app.isPackaged) {
    const exe = path.join(process.resourcesPath, 'backend', 'builder.exe');
    if (fs.existsSync(exe)) return { cmd: exe, args: [] };
  }
  return { cmd: findPython(), args: [path.join(__dirname, 'backend', 'builder.py')] };
}

ipcMain.handle('select-image', async () => {
  const res = await dialog.showOpenDialog(win, {
    title: 'Выберите фото или видео',
    properties: ['openFile'],
    filters: [
      { name: 'Фото и видео', extensions: ['png', 'webp', 'jpg', 'jpeg', 'bmp', 'gif', 'apng', 'mp4', 'm4v', 'mov', 'webm', 'mkv', 'avi'] },
      { name: 'Видео', extensions: ['mp4', 'm4v', 'mov', 'webm', 'mkv', 'avi'] },
      { name: 'Все файлы', extensions: ['*'] },
    ],
  });
  return res.canceled ? null : importMediaFile(res.filePaths[0]);
});

ipcMain.handle('paste-image', async () => {
  const img = clipboard.readImage();
  if (img.isEmpty()) return null;
  const p = path.join(projectSourcesDir(), `paste-${Date.now()}-${Math.random().toString(36).slice(2)}.png`);
  fs.writeFileSync(p, img.toPNG());
  return p;
});

ipcMain.handle('select-images', async () => {
  const res = await dialog.showOpenDialog(win, {
    title: 'Выберите изображения/GIF/видео',
    properties: ['openFile', 'multiSelections'],
    filters: [{ name: 'Анимации и видео', extensions: ['gif', 'webp', 'png', 'apng', 'mp4', 'm4v', 'mov', 'webm', 'mkv', 'avi'] }],
  });
  return res.canceled ? [] : res.filePaths.map(importMediaFile);
});

ipcMain.handle('zip-folder', async (event, payload) => {
  return runBackend({ ...payload, action: 'zip-folder' }, (line) =>
    event.sender.send('build-log', line)
  );
});

ipcMain.handle('list-bundles', async (_e, payload) => {
  return runBackend({ ...(payload || {}), action: 'list-bundles' });
});

ipcMain.handle('gif-info', async (_e, payload) => {
  return runBackend({ ...payload, action: 'gif-info' });
});

ipcMain.handle('convert-video', async (event, payload) => {
  return runBackend(
    { ...payload, action: 'video-to-gif' },
    (line) => event.sender.send('build-log', line),
    { timeoutMs: 15 * 60 * 1000 }
  );
});

ipcMain.handle('select-dir', async () => {
  const res = await dialog.showOpenDialog(win, {
    title: 'Куда сохранять спрайт',
    properties: ['openDirectory', 'createDirectory'],
  });
  return res.canceled ? null : res.filePaths[0];
});

ipcMain.handle('open-dir', async (_e, dir) => {
  if (!dir) return { ok: false, error: 'Нет пути' };
  if (!fs.existsSync(dir)) return { ok: false, error: 'Папка не найдена' };
  try {
    const err = await shell.openPath(dir);
    return err ? { ok: false, error: err } : { ok: true };
  } catch (e) {
    return { ok: false, error: e.message };
  }
});

function backendLog(msg) {
  try {
    const line = `${new Date().toISOString()} ${msg}\n`;
    fs.appendFileSync(path.join(app.getPath('userData'), 'backend.log'), line, 'utf-8');
  } catch (_) {}
}

const cancellableBuilds = new Set();

function runBackend(payload, onLog, { timeoutMs = 10 * 60 * 1000 } = {}) {
  const action = payload && payload.action;
  return new Promise((resolve) => {
    let done = false;
    let tmp = null;
    let timer = null;
    let child = null;
    const finish = (res) => {
      if (done) return;
      done = true;
      try { if (child) cancellableBuilds.delete(child); } catch (_) {}
      if (timer) clearTimeout(timer);
      try { if (tmp) fs.unlinkSync(tmp); } catch (_) {}
      if (!res.ok) backendLog(`action ${action} failed: ${res.error}`);
      resolve(res);
    };

    try {
      const { cmd, args } = backendCommand();
      tmp = path.join(appTempDir(), `pet-payload-${Date.now()}-${Math.random().toString(36).slice(2)}.json`);
      fs.writeFileSync(tmp, JSON.stringify(payload), 'utf-8');
      backendLog(`action ${action} spawn ${cmd}`);
      child = spawn(cmd, [...args, '--payload', tmp], {
        windowsHide: true,
        env: { ...process.env, PYTHONIOENCODING: 'utf-8' },
      });
      if (action == null || ['build', 'preview', 'export-animation', 'gif-bundle', 'photo-to-gif'].includes(action)) {
        cancellableBuilds.add(child);
      }
    } catch (e) {
      backendLog(`action ${action} spawn error: ${e && e.stack ? e.stack : e}`);
      finish({ ok: false, error: `Не удалось запустить бэкенд: ${e.message}` });
      return;
    }

    timer = setTimeout(() => {
      backendLog(`action ${action} timeout after ${timeoutMs} ms`);
      try { child.kill(); } catch (_) {}
      finish({ ok: false, error: `Бэкенд не ответил за ${Math.round(timeoutMs / 1000)} с (${action}).` });
    }, timeoutMs);

    let out = '';
    let err = '';
    child.stdout.on('data', (d) => {
      out += d.toString('utf-8');
    });
    child.stderr.on('data', (d) => {
      const text = d.toString('utf-8');
      err += text;
      for (const line of text.split(/\r?\n/)) {
        if (line.trim() && onLog) onLog(line);
      }
    });
    child.on('error', (e) => {
      finish({ ok: false, error: `Не удалось запустить бэкенд: ${e.message}` });
    });
    child.on('close', (code) => {
      const marker = out.lastIndexOf('__RESULT__');
      if (marker >= 0) {
        try {
          const result = JSON.parse(out.slice(marker + '__RESULT__'.length).trim());
          if (result && result.error) {
            finish({ ok: false, error: result.error });
          } else {
            finish({ ok: true, result });
          }
          return;
        } catch (_) {}
      }
      finish({ ok: false, error: `Бэкенд завершился с кодом ${code}.\n${(err || out).slice(-2000)}` });
    });
  });
}

ipcMain.handle('cancel-build', async () => {
  let n = 0;
  for (const child of Array.from(cancellableBuilds)) {
    try {
      child.kill();
      n++;
    } catch (_) {}
    cancellableBuilds.delete(child);
  }
  return { ok: true, cancelled: n };
});

ipcMain.handle('build', async (event, payload) => {
  return runBackend(payload, (line) => event.sender.send('build-log', line));
});

ipcMain.handle('list-pets', async () => {
  return runBackend({ action: 'list' }, null, { timeoutMs: 60000 });
});

ipcMain.handle('preview', async (event, payload) => {
  return runBackend({ ...payload, action: 'preview' }, (line) =>
    event.sender.send('build-log', line)
  );
});

ipcMain.handle('estimate', async (event, payload) => {
  return runBackend({ ...payload, action: 'estimate' }, (line) =>
    event.sender.send('build-log', line)
  );
});

ipcMain.handle('export-animation', async (event, payload) => {
  return runBackend({ ...payload, action: 'export-animation' }, (line) =>
    event.sender.send('build-log', line)
  );
});

ipcMain.handle('bg-models', async () => {
  return runBackend({ action: 'bg-models' }, null, { timeoutMs: 120000 });
});

ipcMain.handle('delete-bg-model', async (event, payload) => {
  return runBackend({ ...(payload || {}), action: 'delete-bg-model' }, (line) =>
    event.sender.send('build-log', line)
  );
});

ipcMain.handle('models-info', async () => {
  return runBackend({ action: 'models-info' });
});

ipcMain.handle('download-bg-model', async (event, payload) => {
  return runBackend({ ...(payload || {}), action: 'download-bg-model' }, (line) =>
    event.sender.send('build-log', line)
  , { timeoutMs: 60 * 60 * 1000 });
});

ipcMain.handle('clear-cutouts', async () => {
  return runBackend({ action: 'clear-cutouts' });
});

ipcMain.handle('cache-info', async () => {
  return runBackend({ action: 'cache-info' });
});

ipcMain.handle('media-info', async (_e, payload) => {
  return runBackend({ ...(payload || {}), action: 'media-info' });
});

ipcMain.handle('clear-draft', async () => {
  try {
    if (fs.existsSync(draftPath())) fs.unlinkSync(draftPath());
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e.message };
  }
});

ipcMain.handle('show-overlay', async (_e, data) => {
  try {
    if (overlayWin && !overlayWin.isDestroyed()) {
      overlayWin.close();
      overlayWin = null;
    }
    const frameW = Number(data.frameWidth) || 384;
    const frameH = Number(data.frameHeight) || 416;
    const pet = Number(data.petSize) || frameH;
    const scale = pet / frameH;
    const w = Math.max(40, Math.round(frameW * scale));
    const h = Math.max(40, Math.round(pet));
    overlayWin = new BrowserWindow({
      width: w,
      height: h,
      frame: false,
      transparent: true,
      alwaysOnTop: true,
      skipTaskbar: true,
      resizable: false,
      hasShadow: false,
      focusable: true,
      fullscreenable: false,
      webPreferences: {
        preload: path.join(__dirname, 'preload.js'),
        contextIsolation: true,
        nodeIntegration: false,
      },
    });
    overlayWin.setAlwaysOnTop(true, 'screen-saver');
    try {
      const { workArea } = screen.getPrimaryDisplay();
      overlayWin.setPosition(
        Math.round(workArea.x + workArea.width - w - 24),
        Math.round(workArea.y + workArea.height - h - 24)
      );
    } catch (_) {}
    overlayWin.loadFile(path.join(__dirname, 'renderer', 'overlay.html'));
    overlayWin.webContents.on('did-finish-load', () => {
      if (!overlayWin || overlayWin.isDestroyed()) return;
      overlayWin.webContents.send('overlay-data', {
        ...data,
        frameWidth: frameW,
        frameHeight: frameH,
        petSize: pet,
        scale,
        width: w,
        height: h,
      });
    });
    overlayWin.on('closed', () => {
      overlayWin = null;
    });
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e.message };
  }
});

ipcMain.handle('close-overlay', async () => {
  if (overlayWin && !overlayWin.isDestroyed()) overlayWin.close();
  overlayWin = null;
  return { ok: true };
});

ipcMain.handle('video-preview', async (event, payload) => {
  return runBackend({ ...(payload || {}), action: 'video-preview' }, (line) =>
    event.sender.send('build-log', line)
  );
});

ipcMain.handle('photo-to-gif', async (event, payload) => {
  return runBackend({ ...(payload || {}), action: 'photo-to-gif' }, (line) =>
    event.sender.send('build-log', line)
  );
});

ipcMain.handle('clear-cache', async (event, payload) => {
  return runBackend({ ...(payload || {}), action: 'clear-cache' }, (line) =>
    event.sender.send('build-log', line)
  );
});

ipcMain.handle('cutout-preview', async (event, payload) => {
  return runBackend({ ...payload, action: 'cutout-preview' }, (line) =>
    event.sender.send('cutout-log', line)
  );
});

ipcMain.handle('gif-bundle', async (event, payload) => {
  return runBackend({ ...payload, action: 'gif-bundle' }, (line) =>
    event.sender.send('build-log', line)
  );
});

function readBundleDir(dir) {
  const manifest = JSON.parse(fs.readFileSync(path.join(dir, 'pet.json'), 'utf-8'));
  let sources = null;
  const sp = path.join(dir, 'sources.json');
  if (fs.existsSync(sp)) sources = JSON.parse(fs.readFileSync(sp, 'utf-8'));
  return { ok: true, manifest, sources, dir };
}

ipcMain.handle('import-bundle', async () => {
  const res = await dialog.showOpenDialog(win, {
    title: 'Открыть bundle питомца',
    defaultPath: defaultBundleDir(),
    properties: ['openDirectory'],
  });
  if (res.canceled || !res.filePaths[0]) return { ok: false, canceled: true };
  const dir = res.filePaths[0];
  writeUiPrefs({ bundleDir: path.dirname(dir) });
  try {
    return readBundleDir(dir);
  } catch (e) {
    return { ok: false, error: e.message };
  }
});

ipcMain.handle('open-bundle-path', async (_e, dir) => {
  if (!dir || !fs.existsSync(dir)) return { ok: false, error: 'Папка bundle не найдена' };
  try {
    return readBundleDir(dir);
  } catch (e) {
    return { ok: false, error: e.message };
  }
});

function draftPath() {
  return path.join(app.getPath('userData'), 'draft.json');
}

function uiPrefsPath() {
  return path.join(app.getPath('userData'), 'ui-prefs.json');
}

function readUiPrefs() {
  try {
    return JSON.parse(fs.readFileSync(uiPrefsPath(), 'utf-8')) || {};
  } catch (_) {
    return {};
  }
}

function writeUiPrefs(patch) {
  try {
    const cur = readUiPrefs();
    fs.writeFileSync(uiPrefsPath(), JSON.stringify({ ...cur, ...patch }, null, 2), 'utf-8');
  } catch (_) {}
}

function installDir() {
  return app.isPackaged ? path.dirname(app.getPath('exe')) : __dirname;
}

function defaultProjectDir() {
  return installDir();
}

function defaultBundleDir() {
  const prefs = readUiPrefs();
  if (prefs.bundleDir && fs.existsSync(prefs.bundleDir)) return prefs.bundleDir;
  const d = path.join(process.env.LOCALAPPDATA || app.getPath('userData'), 'PetSpriteBuilder', 'bundles');
  return fs.existsSync(d) ? d : app.getPath('documents');
}

function projectSourcesDir() {
  const dir = path.join(defaultProjectDir(), 'sources');
  try {
    fs.mkdirSync(dir, { recursive: true });
  } catch (_) {}
  return dir;
}

function isPathInside(child, parent) {
  const rel = path.relative(path.resolve(parent), path.resolve(child));
  return rel !== '' && !rel.startsWith('..') && !path.isAbsolute(rel);
}

function fileFingerprint(p) {
  const st = fs.statSync(p);
  if (st.size > 50 * 1024 * 1024) return String(st.size);
  return st.size + ':' + crypto.createHash('sha1').update(fs.readFileSync(p)).digest('hex');
}

function importMediaFile(src) {
  if (!src || typeof src !== 'string') return src;
  try {
    if (!fs.existsSync(src) || !fs.statSync(src).isFile()) return src;
    const dir = projectSourcesDir();
    if (isPathInside(src, dir)) return src;
    const ext = path.extname(src);
    const base = path.basename(src, ext);
    const fingerprint = fileFingerprint(src);
    let dest = path.join(dir, base + ext);
    let i = 1;
    while (fs.existsSync(dest)) {
      if (fileFingerprint(dest) === fingerprint) return dest;
      dest = path.join(dir, `${base}-${i++}${ext}`);
    }
    fs.copyFileSync(src, dest);
    return dest;
  } catch (_) {
    return src;
  }
}

ipcMain.handle('import-file', async (_e, src) => importMediaFile(src));

ipcMain.handle('save-draft', async (_e, data) => {
  try {
    fs.writeFileSync(draftPath(), JSON.stringify(data), 'utf-8');
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e.message };
  }
});

ipcMain.handle('set-dirty', async (_e, dirty) => {
  projectDirty = !!dirty;
  return { ok: true };
});

ipcMain.handle('confirm-close', async () => {
  allowClose = true;
  if (win) win.close();
  return { ok: true };
});

ipcMain.handle('load-draft', async () => {
  try {
    if (!fs.existsSync(draftPath())) return null;
    return JSON.parse(fs.readFileSync(draftPath(), 'utf-8'));
  } catch (_) {
    return null;
  }
});

ipcMain.handle('save-project', async (_e, data) => {
  const res = await dialog.showSaveDialog(win, {
    title: 'Сохранить проект',
    defaultPath: path.join(defaultProjectDir(), 'pet-project.json'),
    filters: [{ name: 'Проект питомца', extensions: ['json'] }],
  });
  if (res.canceled || !res.filePath) return { ok: false, canceled: true };
  fs.writeFileSync(res.filePath, JSON.stringify(data, null, 2), 'utf-8');
  writeUiPrefs({ projectDir: path.dirname(res.filePath) });
  return { ok: true, path: res.filePath };
});

ipcMain.handle('open-project', async () => {
  const res = await dialog.showOpenDialog(win, {
    title: 'Открыть проект',
    defaultPath: defaultProjectDir(),
    properties: ['openFile'],
    filters: [{ name: 'Проект питомца', extensions: ['json'] }],
  });
  if (res.canceled || !res.filePaths[0]) return { ok: false, canceled: true };
  writeUiPrefs({ projectDir: path.dirname(res.filePaths[0]) });
  try {
    const data = JSON.parse(fs.readFileSync(res.filePaths[0], 'utf-8'));
    return { ok: true, project: data };
  } catch (e) {
    return { ok: false, error: e.message };
  }
});

ipcMain.handle('copy-text', async (_e, text) => {
  clipboard.writeText(String(text || ''));
  return { ok: true };
});

ipcMain.handle('check-paths', async (_e, list) => {
  const out = {};
  for (const p of list || []) out[p] = fs.existsSync(p);
  return out;
});

function recentsPath() {
  return path.join(app.getPath('userData'), 'recent-photos.json');
}

ipcMain.handle('get-recents', async () => {
  try {
    const arr = JSON.parse(fs.readFileSync(recentsPath(), 'utf-8'));
    return Array.isArray(arr) ? arr : [];
  } catch (_) {
    return [];
  }
});

ipcMain.handle('clear-recents', async () => {
  try {
    fs.writeFileSync(recentsPath(), '[]', 'utf-8');
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e.message };
  }
});

ipcMain.handle('add-recent', async (_e, p) => {
  try {
    if (!p || !fs.existsSync(p)) return [];
    let list = [];
    try {
      list = JSON.parse(fs.readFileSync(recentsPath(), 'utf-8'));
      if (!Array.isArray(list)) list = [];
    } catch (_) {}
    list = [p, ...list.filter((x) => x !== p)].slice(0, 24);
    fs.writeFileSync(recentsPath(), JSON.stringify(list), 'utf-8');
    return list;
  } catch (_) {
    return [];
  }
});

function updateConfigPath() {
  return path.join(app.getPath('userData'), 'update-config.json');
}

function readUpdateConfig() {
  try {
    const cfg = JSON.parse(fs.readFileSync(updateConfigPath(), 'utf-8'));
    if (!cfg.url) cfg.url = DEFAULT_UPDATE_URL;
    return cfg;
  } catch (_) {
    return { url: DEFAULT_UPDATE_URL, auto: true };
  }
}

function fetchJson(url) {
  return new Promise((resolve, reject) => {
    const mod = url.startsWith('https') ? require('https') : require('http');
    mod
      .get(url, { headers: { 'User-Agent': 'PetSpriteBuilder' } }, (r) => {
        if (r.statusCode >= 300 && r.statusCode < 400 && r.headers.location) {
          r.resume();
          resolve(fetchJson(r.headers.location));
          return;
        }
        let data = '';
        r.on('data', (c) => (data += c));
        r.on('end', () => {
          try {
            resolve(JSON.parse(data));
          } catch (e) {
            reject(e);
          }
        });
      })
      .on('error', reject);
  });
}

function downloadFile(url, dest) {
  return new Promise((resolve, reject) => {
    const mod = url.startsWith('https') ? require('https') : require('http');
    mod
      .get(url, { headers: { 'User-Agent': 'PetSpriteBuilder' } }, (r) => {
        if (r.statusCode >= 300 && r.statusCode < 400 && r.headers.location) {
          r.resume();
          resolve(downloadFile(r.headers.location, dest));
          return;
        }
        const out = fs.createWriteStream(dest);
        r.pipe(out);
        out.on('finish', () => out.close(() => resolve(dest)));
        out.on('error', reject);
      })
      .on('error', reject);
  });
}

function errText(e) {
  if (!e) return 'неизвестная ошибка';
  if (e.code && e.message) return e.code + ': ' + e.message;
  if (e.message) return e.message;
  return String(e);
}

// Скачивание через Chromium-сеть Electron: уважает системный прокси и хранилище сертификатов.
function downloadFileElectron(url, dest) {
  return new Promise((resolve, reject) => {
    let finished = false;
    const fail = (e) => {
      if (!finished) {
        finished = true;
        reject(e);
      }
    };
    try {
      const req = net.request({
        url,
        method: 'GET',
        redirect: 'follow',
        headers: { 'User-Agent': 'PetSpriteBuilder' },
      });
      req.on('response', (resp) => {
        if (resp.statusCode >= 400) {
          fail(new Error('HTTP ' + resp.statusCode));
          return;
        }
        const out = fs.createWriteStream(dest);
        resp.on('data', (chunk) => out.write(chunk));
        resp.on('end', () => out.end());
        out.on('finish', () => {
          out.close(() => {
            if (!finished) {
              finished = true;
              resolve(dest);
            }
          });
        });
        out.on('error', fail);
        resp.on('error', fail);
      });
      req.on('error', fail);
      req.end();
    } catch (e) {
      fail(e);
    }
  });
}

function cmpVersion(a, b) {
  const pa = String(a).split('.').map((n) => parseInt(n, 10) || 0);
  const pb = String(b).split('.').map((n) => parseInt(n, 10) || 0);
  for (let i = 0; i < 3; i++) {
    if ((pa[i] || 0) !== (pb[i] || 0)) return (pa[i] || 0) - (pb[i] || 0);
  }
  return 0;
}

ipcMain.handle('app-info', async () => {
  const backend = path.join(process.resourcesPath || path.join(__dirname, 'backend'), 'backend', 'builder.exe');
  const orcaDb = path.join(process.env.APPDATA || '', 'orca', 'profiles', 'local-default', 'profile-state.db');
  return {
    version: app.getVersion(),
    electron: process.versions.electron,
    chrome: process.versions.chrome,
    node: process.versions.node,
    platform: process.platform,
    arch: process.arch,
    exe: process.execPath,
    userData: app.getPath('userData'),
    resources: process.resourcesPath,
    backendExists: fs.existsSync(backend) || fs.existsSync(path.join(__dirname, 'backend', 'builder.py')),
    orcaDbExists: fs.existsSync(orcaDb),
  };
});

ipcMain.handle('export-log', async (_e, logText) => {
  const res = await dialog.showSaveDialog(win, {
    title: 'Сохранить диагностический лог',
    defaultPath: `pet-builder-diagnostic-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')}.txt`,
    filters: [{ name: 'Текст', extensions: ['txt'] }],
  });
  if (res.canceled || !res.filePath) return { ok: false, canceled: true };
  const info = {
    version: app.getVersion(),
    electron: process.versions.electron,
    chrome: process.versions.chrome,
    node: process.versions.node,
    platform: process.platform,
    arch: process.arch,
    exe: process.execPath,
    userData: app.getPath('userData'),
    resources: process.resourcesPath,
  };
  const body =
    '=== Pet Sprite Builder diagnostic ===\n' +
    JSON.stringify(info, null, 2) +
    '\n\n=== Log ===\n' +
    (logText || '') +
    '\n\n=== Backend ===\n' +
    (() => {
      try {
        return fs.readFileSync(path.join(app.getPath('userData'), 'backend.log'), 'utf-8').slice(-20000);
      } catch (_) {
        return '(нет)';
      }
    })() +
    '\n';
  fs.writeFileSync(res.filePath, body, 'utf-8');
  return { ok: true, path: res.filePath };
});

ipcMain.handle('get-update-config', async () => readUpdateConfig());

ipcMain.handle('set-update-config', async (_e, cfg) => {
  try {
    fs.writeFileSync(
      updateConfigPath(),
      JSON.stringify({ url: cfg.url || '', auto: cfg.auto !== false }, null, 2),
      'utf-8'
    );
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e.message };
  }
});

ipcMain.handle('check-update', async () => {
  const cfg = readUpdateConfig();
  if (!cfg.url) return { configured: false };
  try {
    const data = await fetchJson(cfg.url);
    const current = app.getVersion();
    const latest = String(data.version || data.latest || '').trim();
    if (!latest) return { configured: true, error: 'В манифесте нет поля version' };
    return {
      configured: true,
      current,
      latest,
      newer: cmpVersion(latest, current) > 0,
      url: data.url || data.download || '',
      notes: data.notes || '',
    };
  } catch (e) {
    return { configured: true, error: e.message };
  }
});

ipcMain.handle('download-update', async (_e, url) => {
  if (!url) return { ok: false, error: 'Нет ссылки' };
  const ext = /\.exe$/i.test(url) ? '.exe' : '.bin';
  const dest = path.join(appTempDir(), `PetSpriteBuilder-update-${Date.now()}${ext}`);

  let lastErr = null;
  try {
    await downloadFileElectron(url, dest);
  } catch (e) {
    lastErr = e;
    try {
      await downloadFile(url, dest);
      lastErr = null;
    } catch (e2) {
      lastErr = e2;
    }
  }

  if (lastErr) {
    try {
      await shell.openExternal(url);
    } catch (_) {}
    return {
      ok: false,
      error:
        'Не удалось скачать (' +
        errText(lastErr) +
        '). Открыл ссылку в браузере — скачай установщик и запусти вручную.',
    };
  }

  try {
    const size = fs.statSync(dest).size;
    if (size < 1000000) {
      throw new Error('Файл слишком маленький (' + size + ' байт), похоже на ошибку');
    }
    return { ok: true, path: dest, size };
  } catch (e) {
    return { ok: false, error: errText(e), path: dest };
  }
});

ipcMain.handle('install-update', async (_e, installerPath) => {
  if (!installerPath || !fs.existsSync(installerPath)) {
    return { ok: false, error: 'Установщик не найден' };
  }
  try {
    const child = spawn(installerPath, ['/S'], {
      detached: true,
      stdio: 'ignore',
      windowsHide: true,
      env: { ...process.env, PSB_RELAUNCH: '1' },
    });
    child.unref();
    allowClose = true;
    setTimeout(() => app.quit(), 900);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: errText(e) };
  }
});

app.whenReady().then(createWindow);
app.on('window-all-closed', () => app.quit());
app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});
