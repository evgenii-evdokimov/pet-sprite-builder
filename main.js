const { app, BrowserWindow, ipcMain, dialog, shell, clipboard, net } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');
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
    title: 'Выберите фото',
    properties: ['openFile'],
    filters: [
      { name: 'Изображения', extensions: ['png', 'webp', 'jpg', 'jpeg', 'bmp', 'gif', 'apng'] },
      { name: 'Все файлы', extensions: ['*'] },
    ],
  });
  return res.canceled ? null : res.filePaths[0];
});

ipcMain.handle('paste-image', async () => {
  const img = clipboard.readImage();
  if (img.isEmpty()) return null;
  const p = path.join(appTempDir(), `pet-paste-${Date.now()}-${Math.random().toString(36).slice(2)}.png`);
  fs.writeFileSync(p, img.toPNG());
  return p;
});

ipcMain.handle('select-images', async () => {
  const res = await dialog.showOpenDialog(win, {
    title: 'Выберите изображения/GIF',
    properties: ['openFile', 'multiSelections'],
    filters: [{ name: 'Анимации', extensions: ['gif', 'webp', 'png', 'apng'] }],
  });
  return res.canceled ? [] : res.filePaths;
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

ipcMain.handle('select-dir', async () => {
  const res = await dialog.showOpenDialog(win, {
    title: 'Куда сохранять спрайт',
    properties: ['openDirectory', 'createDirectory'],
  });
  return res.canceled ? null : res.filePaths[0];
});

ipcMain.handle('open-dir', async (_e, dir) => {
  if (dir && fs.existsSync(dir)) await shell.openPath(dir);
});

function backendLog(msg) {
  try {
    const line = `${new Date().toISOString()} ${msg}\n`;
    fs.appendFileSync(path.join(app.getPath('userData'), 'backend.log'), line, 'utf-8');
  } catch (_) {}
}

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

ipcMain.handle('export-animation', async (event, payload) => {
  return runBackend({ ...payload, action: 'export-animation' }, (line) =>
    event.sender.send('build-log', line)
  );
});

ipcMain.handle('bg-models', async () => {
  return runBackend({ action: 'bg-models' });
});

ipcMain.handle('clear-cutouts', async () => {
  return runBackend({ action: 'clear-cutouts' });
});

ipcMain.handle('cutout-preview', async (event, payload) => {
  return runBackend({ ...payload, action: 'cutout-preview' }, (line) =>
    event.sender.send('build-log', line)
  );
});

ipcMain.handle('gif-bundle', async (event, payload) => {
  return runBackend({ ...payload, action: 'gif-bundle' }, (line) =>
    event.sender.send('build-log', line)
  );
});

ipcMain.handle('import-bundle', async () => {
  const res = await dialog.showOpenDialog(win, {
    title: 'Открыть bundle питомца',
    properties: ['openDirectory'],
  });
  if (res.canceled || !res.filePaths[0]) return { ok: false, canceled: true };
  const dir = res.filePaths[0];
  try {
    const manifest = JSON.parse(fs.readFileSync(path.join(dir, 'pet.json'), 'utf-8'));
    let sources = null;
    const sp = path.join(dir, 'sources.json');
    if (fs.existsSync(sp)) sources = JSON.parse(fs.readFileSync(sp, 'utf-8'));
    return { ok: true, manifest, sources, dir };
  } catch (e) {
    return { ok: false, error: e.message };
  }
});

function draftPath() {
  return path.join(app.getPath('userData'), 'draft.json');
}

ipcMain.handle('save-draft', async (_e, data) => {
  try {
    fs.writeFileSync(draftPath(), JSON.stringify(data), 'utf-8');
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e.message };
  }
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
    defaultPath: 'pet-project.json',
    filters: [{ name: 'Проект питомца', extensions: ['json'] }],
  });
  if (res.canceled || !res.filePath) return { ok: false, canceled: true };
  fs.writeFileSync(res.filePath, JSON.stringify(data, null, 2), 'utf-8');
  return { ok: true, path: res.filePath };
});

ipcMain.handle('open-project', async () => {
  const res = await dialog.showOpenDialog(win, {
    title: 'Открыть проект',
    properties: ['openFile'],
    filters: [{ name: 'Проект питомца', extensions: ['json'] }],
  });
  if (res.canceled || !res.filePaths[0]) return { ok: false, canceled: true };
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
    const openErr = await shell.openPath(dest);
    if (openErr) {
      return { ok: false, error: 'Скачано, но не запустилось: ' + openErr, path: dest };
    }
    return { ok: true, path: dest };
  } catch (e) {
    return { ok: false, error: errText(e), path: dest };
  }
});

app.whenReady().then(createWindow);
app.on('window-all-closed', () => app.quit());
app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});
