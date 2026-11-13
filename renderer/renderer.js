const ANIMS = [
  { key: 'idle', row: 0, frames: 6, title: 'Idle', hint: 'обычное состояние', required: true },
  { key: 'running-right', row: 1, frames: 8, title: 'Running right', hint: 'бег вправо' },
  { key: 'running-left', row: 2, frames: 8, title: 'Running left', hint: 'бег влево (зеркалится)' },
  { key: 'waving', row: 3, frames: 4, title: 'Waving', hint: 'машет' },
  { key: 'jumping', row: 4, frames: 5, title: 'Jumping', hint: 'наведение мыши' },
  { key: 'failed', row: 5, frames: 8, title: 'Failed', hint: 'ошибка' },
  { key: 'waiting', row: 6, frames: 6, title: 'Waiting', hint: 'ожидание' },
  { key: 'running', row: 7, frames: 6, title: 'Running', hint: 'работа' },
  { key: 'review', row: 8, frames: 6, title: 'Review', hint: 'проверка' },
];

const CHANGELOG = [
  {
    version: '1.2.5',
    notes: [
      'Видео → GIF: fps, размер, обрезка, бумеранг и живой предпросмотр; стабилизация маски между кадрами',
      'Выбор кадров из GIF/видео и оптимизация GIF: палитра, удаление одинаковых кадров, целевой размер',
      'Скачивание и удаление rembg-моделей, сглаживание края',
      'Прогресс по состояниям, отмена сборки, оценка размера, длительности под FPS Orca',
      'История с подписями, контекстное меню слотов, стрелки/зум/панорама, «до/после», автоанимация',
    ],
  },
  {
    version: '1.2.4',
    notes: [
      'Можно загружать видео (MP4/MOV/WebM/MKV) — оно конвертируется в GIF',
      'Сборка больше не зависает на импорте rembg: numba только для alpha matting',
      'Запуск через нативный launcher: исправлены старт и ошибка временной папки',
    ],
  },
  {
    version: '1.2.3',
    notes: [
      'Electron 45 и обновлённые зависимости',
      'Фото: быстрая модель u2net по умолчанию, сборка в разы быстрее',
      'Логи сравнения вырезания фона и пояснения к порогам',
      'Всегда тёмная тема; убран чекбокс включения состояний',
    ],
  },
  { version: '1.2.2', notes: ['Фото: по умолчанию модель u2net — сборка в разы быстрее', 'bria-rmbg остаётся в списке, если нужно максимальное качество'] },
  { version: '1.2.1', notes: ['Сборка GIF ускорена: один проход по кадрам + кэш кадров', 'Повторная сборка почти мгновенная', 'В журнале видно время по каждому состоянию'] },
  { version: '1.2.0', notes: ['Фото растягивается по ширине/высоте за боковые края и свободно за углы', 'Подсказка, зачем нужны длительности кадров'] },
  { version: '1.1.9', notes: ['Фото можно масштабировать, потянув за края или углы в настройке', 'Привязка (низ/центр/верх) теперь видна в предпросмотре', 'Масштаб и сдвиг работают и для GIF'] },
  { version: '1.1.8', notes: ['Служебные файлы больше не пишутся в системный TEMP (EPERM)', 'Питомцы, модели фона и вставка из буфера снова работают'] },
  { version: '1.1.7', notes: ['Питомцы: таймаут и кнопка «Повторить» вместо вечной загрузки', 'Ошибки бэкенда пишутся в лог и попадают в диагностику'] },
  { version: '1.1.6', notes: ['Питомцы открываются быстро: миниатюры фото кэшируются', 'Список питомцев показывается из кэша сразу', 'Запуск напрямую из ярлыка без PyInstaller-лаунчера'] },
  { version: '1.1.4', notes: ['Инструменты под шестерёнкой', 'Убран URL манифеста из UI', 'Только русские подписи в карточках'] },
  { version: '1.1.3', notes: ['URL автообновления по умолчанию', 'Мелкие правки'] },
  { version: '1.1.2', notes: ['Удалён portable-режим', 'Автообновление и экран «Что нового»', 'Экспорт диагностического лога'] },
  {
    version: '1.1.0',
    notes: [
      'Ручной выбор, порядок и длительность кадров GIF',
      'Обрезка краёв у фото и GIF + авто-обрезка по альфе',
      'Чеклист состояний в сайдбаре',
      'Автообновление и экран «Что нового»',
      'Экспорт диагностического лога',
    ],
  },
  {
    version: '1.0.19',
    notes: ['Покачивание для GIF-слотов', 'Разделение настроек фото и GIF'],
  },
  {
    version: '1.0.10',
    notes: ['GIF прямо в слотах', 'Отключение анимаций', 'Idle больше не обязателен'],
  },
];

const paths = {};
const transforms = {};
const cardByRow = {};
let outDir = null;
let adjustRow = null;
let adjustRotate = 0;
let adjustShowCutout = false;
let apZoom = 1;
let apPanX = 0;
let apPanY = 0;
let adjustCutoutSrc = null;
let adjustDx = 0;
let adjustDy = 0;
let adjustSX = 1;
let adjustSY = 1;
const adjustAnim = { raf: 0, t0: 0, phase: 0 };
let pv = null;
let pvOrcaMode = false;
let petsCache = [];
let draftTimer = null;
let applyingProject = false;
let hoverRow = null;
let lastBundle = null;
let recents = [];
let petSize = 260;
let pendingBgModel = null;
let animOptions = {};
let gifMap = {};
let gifCandidates = [];
let gifSelections = {};
let pendingUpdatePath = null;
let gifPickKey = null;
let gifPickCandidates = [];
let slotClipboard = null;

function updatePasteButtons() {
  document.querySelectorAll('.slot-paste').forEach((b) => {
    b.classList.toggle('hidden', !slotClipboard);
  });
}
const history = { states: [], idx: -1 };

function hasBuildable() {
  return ANIMS.some((a) => paths[a.row]);
}

function hexToRgb(hex) {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex || '');
  if (!m) return { r: 255, g: 255, b: 255 };
  const n = parseInt(m[1], 16);
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
}

function rgbToHex(r, g, b) {
  return '#' + [r, g, b].map((x) => (x || 0).toString(16).padStart(2, '0')).join('');
}

function gatherBg() {
  return {
    model: document.getElementById('bgModel').value || '',
    alphaMatting: document.getElementById('bgAlpha').checked,
    fgThreshold: parseInt(document.getElementById('bgFg').value, 10) || 240,
    bgThreshold: parseInt(document.getElementById('bgBg').value, 10) || 10,
    erode: parseInt(document.getElementById('bgErode').value, 10) || 10,
    feather: parseInt((document.getElementById('bgFeather') || {}).value, 10) || 0,
    chroma: {
      enabled: document.getElementById('chromaOn').checked,
      ...hexToRgb(document.getElementById('chromaColor').value),
      tol: parseInt(document.getElementById('chromaTol').value, 10) || 30,
    },
  };
}

function readOrcaFps() {
  const on = document.getElementById('snapFps');
  if (on && !on.checked) return 0;
  const v = parseInt((document.getElementById('orcaFps') || {}).value, 10);
  return v && v > 0 ? Math.min(60, v) : 8;
}

function showProgress() {
  document.getElementById('progress').classList.remove('hidden');
}
function hideProgress() {
  document.getElementById('progress').classList.add('hidden');
  bpEnd();
}

let bpTotal = 0;
let bpDone = 0;
let bpVisible = false;

function bpStart(total) {
  bpTotal = Math.max(1, total || 0);
  bpDone = 0;
  bpVisible = true;
  const el = document.getElementById('buildProgress');
  if (el) el.classList.remove('hidden');
  bpUpdate('Сборка…', 0);
}

function bpUpdate(label, frac) {
  if (!bpVisible) return;
  const pct = Math.max(0, Math.min(100, Math.round((frac || 0) * 100)));
  const fill = document.getElementById('bpFill');
  const pctEl = document.getElementById('bpPct');
  const text = document.getElementById('bpText');
  if (fill) fill.style.width = pct + '%';
  if (pctEl) pctEl.textContent = pct + '%';
  if (label && text) text.textContent = label;
}

function bpEnd() {
  bpVisible = false;
  const el = document.getElementById('buildProgress');
  if (el) el.classList.add('hidden');
}

function bpFromLog(line) {
  if (!bpVisible) return;
  let m = line.match(/^Обработка (.+)…$/);
  if (m) {
    bpUpdate('Обработка ' + m[1] + '…', bpDone / bpTotal);
    return;
  }
  m = line.match(/^GIF: (.+)…$/);
  if (m) {
    bpUpdate('GIF: ' + m[1] + '…', bpDone / bpTotal);
    return;
  }
  if (/^[\w-]+: (готово|\d+ кадров)/.test(line)) {
    bpDone++;
    bpUpdate('', bpDone / bpTotal);
  }
}

function baseDurations(anim) {
  if (anim.key === 'idle') return [1680, 660, 660, 840, 840, 1920];
  const last = {
    waving: 280,
    jumping: 280,
    failed: 240,
    waiting: 260,
    running: 220,
    review: 280,
    'running-right': 220,
    'running-left': 220,
  };
  const arr = new Array(anim.frames).fill(120);
  arr[arr.length - 1] = last[anim.key] || 220;
  return arr;
}

function isAnimatedPath(p) {
  return /\.(gif|apng)$/i.test(p || '');
}

const VIDEO_RE = /\.(mp4|m4v|mov|webm|mkv|avi|wmv|flv)$/i;

function isVideoPath(p) {
  return VIDEO_RE.test(p || '');
}

const VIDEO_OPTS_KEY = 'psb.videoOpts';

function loadVideoOpts() {
  try {
    const o = JSON.parse(localStorage.getItem(VIDEO_OPTS_KEY) || '{}');
    return {
      fps: Math.min(30, Math.max(1, parseInt(o.fps, 10) || 15)),
      maxSize: Math.min(1024, Math.max(64, parseInt(o.maxSize, 10) || 480)),
      start: Math.max(0, parseFloat(o.start) || 0),
      end: Math.max(0, parseFloat(o.end) || 0),
      boomerang: !!o.boomerang,
    };
  } catch (_) {
    return { fps: 15, maxSize: 480, start: 0, end: 0, boomerang: false };
  }
}

function saveVideoOpts(o) {
  try {
    localStorage.setItem(VIDEO_OPTS_KEY, JSON.stringify(o));
  } catch (_) {}
}

let videoModalResolve = null;
let vidPreviewSrc = null;
let vidPreviewTimer = null;
let vidPreviewSeq = 0;

function askVideoOptions(path) {
  const o = loadVideoOpts();
  document.getElementById('videoName').textContent = String(path).split(/[\/]/).pop();
  document.getElementById('vidFps').value = o.fps;
  document.getElementById('vidSize').value = o.maxSize;
  document.getElementById('vidStart').value = o.start || '';
  document.getElementById('vidEnd').value = o.end || '';
  document.getElementById('vidBoom').checked = !!o.boomerang;
  vidPreviewSrc = path;
  document.getElementById('vidPreviewImg').classList.add('hidden');
  document.getElementById('vidPreviewImg').removeAttribute('src');
  document.getElementById('vidPreviewStatus').textContent = 'Предпросмотр…';
  document.getElementById('videoModal').classList.remove('hidden');
  scheduleVideoPreview();
  return new Promise((resolve) => {
    videoModalResolve = resolve;
  });
}

function scheduleVideoPreview() {
  clearTimeout(vidPreviewTimer);
  vidPreviewTimer = setTimeout(updateVideoPreview, 450);
}

function readVideoOptsRaw() {
  return {
    fps: Math.min(30, Math.max(1, parseInt(document.getElementById('vidFps').value, 10) || 15)),
    maxSize: Math.min(1024, Math.max(64, parseInt(document.getElementById('vidSize').value, 10) || 480)),
    start: Math.max(0, parseFloat(document.getElementById('vidStart').value) || 0),
    end: Math.max(0, parseFloat(document.getElementById('vidEnd').value) || 0),
    boomerang: document.getElementById('vidBoom').checked,
  };
}

async function updateVideoPreview() {
  if (!vidPreviewSrc) return;
  const seq = ++vidPreviewSeq;
  const img = document.getElementById('vidPreviewImg');
  const status = document.getElementById('vidPreviewStatus');
  status.textContent = 'Готовлю предпросмотр…';
  const resp = await window.api.videoPreview({ path: vidPreviewSrc, ...readVideoOptsRaw() });
  if (seq !== vidPreviewSeq) return;
  if (!resp.ok || !resp.result || !resp.result.gif) {
    status.textContent = 'Не удалось построить предпросмотр: ' + ((resp && resp.error) || '');
    return;
  }
  img.src = '';
  img.src = toFileUrl(resp.result.gif);
  img.classList.remove('hidden');
  status.textContent = 'Предпросмотр (первые ~3 с, уменьшенный)';
}

function closeVideoModal(result) {
  clearTimeout(vidPreviewTimer);
  vidPreviewSeq++;
  vidPreviewSrc = null;
  document.getElementById('videoModal').classList.add('hidden');
  const r = videoModalResolve;
  videoModalResolve = null;
  if (r) r(result);
}

function readVideoOptsFromUi() {
  const o = {
    fps: Math.min(30, Math.max(1, parseInt(document.getElementById('vidFps').value, 10) || 15)),
    maxSize: Math.min(1024, Math.max(64, parseInt(document.getElementById('vidSize').value, 10) || 480)),
    start: Math.max(0, parseFloat(document.getElementById('vidStart').value) || 0),
    end: Math.max(0, parseFloat(document.getElementById('vidEnd').value) || 0),
    boomerang: document.getElementById('vidBoom').checked,
  };
  saveVideoOpts(o);
  return o;
}

async function toGifIfVideo(p, opts) {
  if (!p || !isVideoPath(p)) return p;
  const silent = !!(opts && opts.silent);
  const vo = silent ? loadVideoOpts() : await askVideoOptions(p);
  if (!vo) return null;
  toast('Конвертирую видео в GIF…', '');
  const resp = await window.api.convertVideo({ path: p, ...vo });
  const gif = resp && resp.ok && resp.result && resp.result.gif;
  if (!gif) {
    toast('Не удалось конвертировать видео: ' + ((resp && resp.error) || ''), 'err');
    return null;
  }
  toast('Видео конвертировано в GIF', 'ok');
  return (await window.api.importFile(gif)) || gif;
}

function renderAnimOptions() {
  const box = document.getElementById('animOptions');
  if (!box) return;
  box.innerHTML = '';
  for (const anim of ANIMS) {
    const opt = animOptions[anim.key] || {};
    const row = document.createElement('div');
    row.className = 'anim-row';

    const name = document.createElement('span');
    name.className = 'anim-name' + (paths[anim.row] ? ' filled' : '');
    name.textContent = anim.title;
    name.title = 'Клик — выбрать/заменить фото';
    name.addEventListener('click', async () => {
      const raw = await window.api.selectImage();
      const p = await toGifIfVideo(raw);
      if (p) {
        cardByRow[anim.row].setPath(p);
        commitHistory('Фото в слот');
        addRecent(p);
        renderAnimOptions();
      }
    });

    const speed = document.createElement('input');
    speed.type = 'number';
    speed.min = '0.2';
    speed.max = '3';
    speed.step = '0.1';
    speed.value = opt.speed || 1;
    speed.title = 'Скорость (×)';
    speed.addEventListener('input', () => {
      animOptions[anim.key] = {
        ...(animOptions[anim.key] || {}),
        speed: parseFloat(speed.value) || 1,
      };
      scheduleDraft();
    });

    const lbl = document.createElement('label');
    lbl.title = 'Ping-pong (только для GIF/APNG)';
    const cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.checked = !!opt.pingpong;
    cb.addEventListener('change', () => {
      animOptions[anim.key] = {
        ...(animOptions[anim.key] || {}),
        pingpong: cb.checked,
      };
      scheduleDraft();
    });
    const mark = document.createElement('span');
    mark.textContent = '↔';
    lbl.appendChild(cb);
    lbl.appendChild(mark);

    row.appendChild(name);
    row.appendChild(speed);
    row.appendChild(lbl);
    box.appendChild(row);
  }
}

function evenFrameSet(frames) {
  const set = new Set();
  const n = frames.length;
  if (!n) return set;
  const k = Math.min(8, n);
  if (n <= 8) {
    frames.forEach((f) => set.add(f.index));
    return set;
  }
  for (let i = 0; i < k; i++) {
    set.add(frames[Math.round((i * (n - 1)) / (k - 1))].index);
  }
  return set;
}

async function openGifPicker(key) {
  const path = gifMap[key];
  if (!path) return;
  gifPickKey = key;
  document.getElementById('gpTitle').textContent = 'Кадры: ' + path.split(/[\/]/).pop();
  document.getElementById('gpFrames').innerHTML = '<span class="muted">Загрузка…</span>';
  document.getElementById('gifPickModal').classList.remove('hidden');
  const resp = await window.api.gifInfo({ path });
  if (!resp.ok || (resp.result && resp.result.error)) {
    document.getElementById('gpFrames').innerHTML = '<span class="muted">Не удалось прочитать GIF</span>';
    return;
  }
  const frames = (resp.result && resp.result.frames) || [];
  const sel = gifSelections[key];
  const picked = sel && Array.isArray(sel.frames) ? sel.frames : null;
  const autoPick = evenFrameSet(frames);
  gifPickCandidates = frames.map((f) => ({
    index: f.index,
    thumb: f.thumb,
    duration: sel && sel.durs && picked ? sel.durs[picked.indexOf(f.index)] || f.duration : f.duration,
    checked: picked ? picked.includes(f.index) : autoPick.has(f.index),
  }));
  if (picked) {
    gifPickCandidates.sort((a, b) => picked.indexOf(a.index) - picked.indexOf(b.index));
  }
  renderGifPickFrames();
}

function renderGifPickFrames() {
  const box = document.getElementById('gpFrames');
  if (!box) return;
  box.innerHTML = '';
  gifPickCandidates.forEach((c) => {
    const d = document.createElement('div');
    d.className = 'gframe' + (c.checked ? '' : ' off');
    const chk = document.createElement('input');
    chk.type = 'checkbox';
    chk.className = 'gchk';
    chk.checked = c.checked;
    chk.addEventListener('change', () => {
      c.checked = chk.checked;
      d.classList.toggle('off', !chk.checked);
    });
    const img = document.createElement('img');
    img.src = toFileUrl(c.thumb);
    const dur = document.createElement('input');
    dur.type = 'number';
    dur.min = '20';
    dur.value = c.duration;
    dur.title = 'Длительность кадра, мс';
    dur.addEventListener('input', () => {
      c.duration = parseInt(dur.value, 10) || c.duration;
    });
    d.appendChild(chk);
    d.appendChild(img);
    d.appendChild(dur);
    box.appendChild(d);
  });
}

function saveGifPicker() {
  if (!gifPickKey) return;
  const checked = gifPickCandidates.filter((c) => c.checked);
  if (!checked.length) {
    toast('Выбери хотя бы один кадр', 'err');
    return;
  }
  const truncated = checked.length > 8;
  const selected = checked.slice(0, 8);
  gifSelections[gifPickKey] = {
    frames: selected.map((c) => c.index),
    durs: selected.map((c) => c.duration),
  };
  document.getElementById('gifPickModal').classList.add('hidden');
  renderGifStates();
  toast(truncated ? 'Кадры сохранены (первые 8)' : 'Кадры сохранены', 'ok');
}

function renderGifStates() {
  const box = document.getElementById('gifStates');
  if (!box) return;
  const sel = document.getElementById('gifDefault');
  if (sel && !sel.options.length) {
    for (const a of ANIMS) {
      const o = document.createElement('option');
      o.value = a.key;
      o.textContent = a.hint;
      sel.appendChild(o);
    }
    sel.value = 'idle';
  }
  box.innerHTML = '';
  for (const anim of ANIMS) {
    const row = document.createElement('div');
    row.className = 'gif-row';

    const name = document.createElement('span');
    name.textContent = anim.title;

    const file = document.createElement('span');
    file.className = 'gfile';
    file.textContent = gifMap[anim.key] ? gifMap[anim.key].split(/[\\/]/).pop() : '—';
    file.title = gifMap[anim.key] || '';

    const pick = document.createElement('button');
    pick.className = 'ghost small';
    pick.textContent = 'Выбрать…';
    pick.addEventListener('click', async () => {
      const raw = await window.api.selectImage();
      const p = await toGifIfVideo(raw);
      if (p) {
        delete gifSelections[anim.key];
        gifMap[anim.key] = p;
        renderGifStates();
      }
    });

    const del = document.createElement('button');
    del.className = 'ghost small';
    del.textContent = '×';
    del.addEventListener('click', () => {
      delete gifMap[anim.key];
      delete gifSelections[anim.key];
      renderGifStates();
    });

    const fpick = document.createElement('button');
    fpick.className = 'ghost small';
    fpick.textContent = 'Кадры…';
    if (gifSelections[anim.key]) fpick.classList.add('active');
    fpick.addEventListener('click', () => openGifPicker(anim.key));

    row.appendChild(name);
    row.appendChild(file);
    if (gifMap[anim.key]) row.appendChild(fpick);
    row.appendChild(pick);
    row.appendChild(del);
    box.appendChild(row);
  }
}

async function buildGifBundle() {
  const gifs = {};
  for (const k of Object.keys(gifMap)) gifs[k] = gifMap[k];
  if (!Object.keys(gifs).length) {
    toast('Выбери хотя бы одну GIF', 'err');
    return;
  }
  const status = document.getElementById('gifStatus');
  status.textContent = 'Сборка…';
  status.style.color = '';
  const payload = {
    gifs,
    selections: gifSelections,
    frameWidth: parseInt(document.getElementById('frameW').value, 10) || 384,
    frameHeight: parseInt(document.getElementById('frameH').value, 10) || 416,
    label: document.getElementById('label').value.trim() || 'My Pet',
    outDir: outDir || undefined,
    removeBg: document.getElementById('gifRemoveBg').checked,
    defaultAnimation: document.getElementById('gifDefault').value,
    bg: gatherBg(),
  };
  showProgress();
  const resp = await window.api.gifBundle(payload);
  hideProgress();
  if (!resp.ok || (resp.result && resp.result.error)) {
    status.textContent =
      'Ошибка: ' + (resp.error || (resp.result && resp.result.error) || 'неизвестно');
    status.style.color = 'var(--err)';
    return;
  }
  const r = resp.result;
  status.textContent = 'Готово: ' + r.folder;
  status.style.color = '';
  appendLog('GIF bundle: ' + r.folder);
  if (r.validationErrors && r.validationErrors.length) {
    appendLog('Проверка: ' + r.validationErrors.join('; '));
  }
  lastBundle = r.folder;
  const lb = document.getElementById('lastBundle');
  lb.textContent = r.folder;
  lb.title = r.folder;
  document.getElementById('openBundleBtn').classList.remove('hidden');
  document.getElementById('copyBundleBtn').classList.remove('hidden');
  document.getElementById('zipBtn').classList.remove('hidden');
  toast('GIF bundle готов: ' + r.folder, 'ok');
}

async function applyBundleResult(r) {
  const m = r.manifest || {};
  const frame = m.frame || {};
  if (r.sources) {
    await applyProject({
      version: 1,
      rows: r.sources.rows || {},
      transforms: r.sources.transforms || {},
      frameWidth: r.sources.frameWidth || frame.width || 384,
      frameHeight: r.sources.frameHeight || frame.height || 416,
      label: m.displayName || r.sources.label || 'My Pet',
      petId: '',
      consistentScale: r.sources.consistentScale !== false,
      bg: r.sources.bg || {},
      animOptions: r.sources.animOptions || {},
      webpMode: 'lossless',
      outDir: outDir || '',
    });
    toast('Bundle загружен в редактор', 'ok');
  } else {
    await applyProject({
      version: 1,
      rows: {},
      transforms: {},
      frameWidth: frame.width || 384,
      frameHeight: frame.height || 416,
      label: m.displayName || 'My Pet',
      consistentScale: true,
    });
    toast('В bundle нет sources.json — исходные фото недоступны', 'err');
  }
}

async function importBundleHandler() {
  const r = await window.api.importBundle();
  if (!r.ok) {
    if (!r.canceled) toast('Ошибка: ' + r.error, 'err');
    return;
  }
  await applyBundleResult(r);
}

async function compareCutout(row) {
  const target = row != null && row !== '' ? row : hoverRow;
  if (target == null || !paths[target]) {
    toast('Нет фото для сравнения', 'err');
    return;
  }
  const modal = document.getElementById('cutoutModal');
  const status = document.getElementById('cutoutStatus');
  modal.classList.remove('hidden');
  document.getElementById('cutoutOrig').removeAttribute('src');
  document.getElementById('cutoutRes').removeAttribute('src');
  status.textContent = 'Обработка… (первый раз может занять время)';
  status.style.color = '';
  showProgress();
  const resp = await window.api.cutoutPreview({ path: paths[target], bg: gatherBg() });
  hideProgress();
  if (!resp.ok || (resp.result && resp.result.error)) {
    status.textContent = 'Ошибка: ' + (resp.error || (resp.result && resp.result.error) || 'не удалось вырезать');
    status.style.color = 'var(--err)';
    return;
  }
  status.textContent = 'Готово';
  document.getElementById('cutoutOrig').src = toFileUrl(resp.result.original);
  document.getElementById('cutoutRes').src = toFileUrl(resp.result.cutout);
}

function commitHistory(label) {
  if (applyingProject) return;
  window.api.setDirty(true);
  const snap = currentProject();
  history.states = history.states.slice(0, history.idx + 1);
  history.states.push(snap);
  if (history.states.length > 60) history.states.shift();
  history.idx = history.states.length - 1;
  updateUndoButtons();
  try {
    const h = JSON.parse(localStorage.getItem('psb.history') || '[]');
    if (Array.isArray(h)) {
      h.unshift({ t: Date.now(), label: label || 'Изменение', project: snap });
      localStorage.setItem('psb.history', JSON.stringify(h.slice(0, 30)));
    }
  } catch (_) {}
  renderHistory();
  renderStatesChecklist();
}

function historyReset() {
  history.states = [currentProject()];
  history.idx = 0;
  updateUndoButtons();
}

function updateUndoButtons() {
  const u = document.getElementById('undoBtn');
  const r = document.getElementById('redoBtn');
  if (u) u.disabled = history.idx <= 0;
  if (r) r.disabled = history.idx >= history.states.length - 1;
}

function restoreSnapshot(proj) {
  applyingProject = true;
  for (const anim of ANIMS) cardByRow[anim.row].clearPath();
  const rows = proj.rows || {};
  for (const k of Object.keys(rows)) {
    const row = parseInt(k, 10);
    if (cardByRow[row]) cardByRow[row].setPath(rows[k], { preserve: true });
  }
  for (const k of Object.keys(transforms)) delete transforms[k];
  for (const k of Object.keys(proj.transforms || {})) {
    transforms[parseInt(k, 10)] = proj.transforms[k];
  }
  document.getElementById('frameW').value = proj.frameWidth || 384;
  document.getElementById('frameH').value = proj.frameHeight || 416;
  document.getElementById('label').value = proj.label || 'My Pet';
  document.getElementById('petId').value = proj.petId || '';
  document.getElementById('consistent').checked = proj.consistentScale !== false;
  if (document.getElementById('snapFps')) {
    document.getElementById('snapFps').checked = proj.snapFps !== false;
    document.getElementById('orcaFps').value = proj.orcaFps || 8;
  }
  const bgp = proj.bg || {};
  document.getElementById('bgAlpha').checked = !!bgp.alphaMatting;
  document.getElementById('bgFg').value = bgp.fgThreshold || 240;
  document.getElementById('bgBg').value = bgp.bgThreshold || 10;
  document.getElementById('bgErode').value = bgp.erode || 10;
  if (document.getElementById('bgFeather')) document.getElementById('bgFeather').value = bgp.feather || 0;
  const chroma = bgp.chroma || {};
  document.getElementById('chromaOn').checked = !!chroma.enabled;
  document.getElementById('chromaColor').value = rgbToHex(chroma.r ?? 255, chroma.g ?? 255, chroma.b ?? 255);
  document.getElementById('chromaTol').value = chroma.tol || 30;
  if (bgp.model) {
    const sel = document.getElementById('bgModel');
    if (Array.from(sel.options).some((o) => o.value === bgp.model)) sel.value = bgp.model;
  }
  animOptions = proj.animOptions ? JSON.parse(JSON.stringify(proj.animOptions)) : {};
  renderAnimOptions();
  document.getElementById('webpMode').value = proj.webpMode || 'lossless';
  for (const anim of ANIMS) cardByRow[anim.row].updateTune();
  applyingProject = false;
  window.api.setDirty(false);
  scheduleDraft();
  window.api.setDirty(false);
}

function undo() {
  if (history.idx <= 0) return;
  history.idx--;
  restoreSnapshot(history.states[history.idx]);
  updateUndoButtons();
}

function redo() {
  if (history.idx >= history.states.length - 1) return;
  history.idx++;
  restoreSnapshot(history.states[history.idx]);
  updateUndoButtons();
}

async function loadRecents() {
  const grid = document.getElementById('recentGrid');
  if (!grid) return;
  const list = await window.api.getRecents();
  const exists = await window.api.checkPaths(list);
  recents = list.filter((p) => exists[p]);
  grid.innerHTML = '';
  if (!recents.length) {
    grid.innerHTML = '<div class="muted">Пока пусто</div>';
    return;
  }
  for (const p of recents) {
    const item = document.createElement('div');
    item.className = 'recent-item';
    item.title = p;
    item.draggable = true;
    item.addEventListener('dragstart', (e) => {
      e.dataTransfer.effectAllowed = 'copy';
      e.dataTransfer.setData('application/x-pet-path', p);
    });
    const img = document.createElement('img');
    img.src = toFileUrl(p);
    img.alt = '';
    item.appendChild(img);
    item.addEventListener('click', () => {
      const row = hoverRow == null ? firstEmptyRow() : hoverRow;
      cardByRow[row].setPath(p);
      commitHistory('Недавнее фото');
      toast('Фото вставлено: ' + p.split(/[\\/]/).pop(), 'ok');
    });
    grid.appendChild(item);
  }
}

async function addRecent(p) {
  await window.api.addRecent(p);
  await loadRecents();
}

async function loadBgModels() {
  const sel = document.getElementById('bgModel');
  const resp = await window.api.bgModels();
  const models = (resp.ok && resp.result && resp.result.models) || [];
  sel.innerHTML = '';
  if (!models.length) {
    const o = document.createElement('option');
    o.value = '';
    o.textContent = 'default';
    sel.appendChild(o);
    return;
  }
  const MODEL_INFO = {
    u2net: 'быстро · универсальная',
    u2netp: 'быстро · лёгкая',
    silueta: 'быстро · универсальная',
    'isnet-general-use': 'средне · универсальная',
    'isnet-anime': 'средне · аниме и персонажи',
    'u2net_human_seg': 'средне · люди',
    'u2net_cloth_seg': 'средне · одежда',
    'bria-rmbg': 'медленно · высокое качество',
    'birefnet-general': 'медленно · высокое качество',
    'birefnet-general-lite': 'средне · качество/скорость',
    'birefnet-general-fp16': 'быстрее · как general',
    'birefnet-portrait': 'медленно · портреты и люди',
    'birefnet-dis': 'медленно · объект/фон',
    'birefnet-hrsod': 'медленно · высокое разрешение',
    'birefnet-cod': 'медленно · скрытые объекты',
    'birefnet-massive': 'очень медленно · максимум качества',
  };
  for (const m of models) {
    const o = document.createElement('option');
    o.value = m;
    o.textContent = m + (MODEL_INFO[m] ? ' — ' + MODEL_INFO[m] : '');
    sel.appendChild(o);
  }
  const def = pendingBgModel || (resp.result && resp.result.default) || models[0];
  sel.value = models.includes(def) ? def : models[0];
  pendingBgModel = null;

  const inst = document.getElementById('bgModelInstalled');
  if (inst) {
    inst.innerHTML = '';
    for (const m of models) {
      const o = document.createElement('option');
      o.value = m;
      o.textContent = m + (MODEL_INFO[m] ? ' — ' + MODEL_INFO[m] : '');
      inst.appendChild(o);
    }
    inst.value = sel.value || models[0];
    updateInstalledModelInfo();
  }

  const dl = document.getElementById('bgModelDownload');
  if (dl) {
    const downloadable = ((resp.result && resp.result.downloadable) || []).filter(
      (m) => !models.includes(m)
    );
    dl.innerHTML = '';
    if (!downloadable.length) {
      const o = document.createElement('option');
      o.value = '';
      o.textContent = 'Все модели уже скачаны';
      dl.appendChild(o);
    } else {
      for (const m of downloadable) {
        const o = document.createElement('option');
        o.value = m;
        o.textContent = m + (MODEL_INFO[m] ? ' — ' + MODEL_INFO[m] : '');
        dl.appendChild(o);
      }
    }
  }
}

function updateInstalledModelInfo() {
  const inst = document.getElementById('bgModelInstalled');
  const el = document.getElementById('bgModelSize');
  if (!inst || !el) return;
  const name = inst.value;
  if (!name) {
    el.textContent = '';
    return;
  }
  window.api.modelsInfo().then((r) => {
    const list = (r && r.ok && r.result && r.result.models) || [];
    const found = list.find((m) => m.name === name);
    el.textContent = found
      ? 'Размер: ' + fmtBytes(found.bytes) + ' · ' + (r.result.path || '')
      : '';
  });
}

async function deleteBgModelFromUi() {
  const inst = document.getElementById('bgModelInstalled');
  const status = document.getElementById('bgModelStatus');
  const name = inst ? inst.value : '';
  if (!name) return;
  if (!confirm('Удалить модель «' + name + '»? Она скачается снова при необходимости.')) return;
  status.textContent = 'Удаление «' + name + '»…';
  const r = await window.api.deleteBgModel({ model: name });
  if (!r.ok || (r.result && r.result.error)) {
    status.textContent = 'Ошибка: ' + ((r && r.error) || (r.result && r.result.error) || '');
    return;
  }
  status.textContent = 'Удалено: ' + name + (r.result ? ' (' + fmtBytes(r.result.freedBytes) + ')' : '');
  await loadBgModels();
}

let bgModelDownloading = false;
async function downloadBgModelFromUi() {
  const sel = document.getElementById('bgModelDownload');
  const status = document.getElementById('bgModelStatus');
  const btn = document.getElementById('bgModelDownloadBtn');
  const name = sel ? sel.value : '';
  if (!name) {
    toast('Выбери модель для скачивания', 'err');
    return;
  }
  if (bgModelDownloading) {
    toast('Модель уже скачивается', '');
    return;
  }
  bgModelDownloading = true;
  if (btn) btn.disabled = true;
  status.textContent = 'Скачивание «' + name + '»…';
  showProgress();
  let r;
  try {
    r = await window.api.downloadBgModel({ model: name });
  } finally {
    hideProgress();
    bgModelDownloading = false;
    if (btn) btn.disabled = false;
  }
  if (!r.ok || (r.result && r.result.error)) {
    status.textContent = 'Ошибка: ' + ((r && r.error) || (r.result && r.result.error) || '');
    toast('Не удалось скачать модель', 'err');
    return;
  }
  status.textContent = 'Модель скачана: ' + name;
  await loadBgModels();
  document.getElementById('bgModel').value = name;
  toast('Модель скачана: ' + name, 'ok');
}

async function saveProject() {
  const r = await window.api.saveProject(currentProject());
  if (r.ok) {
    window.api.setDirty(false);
    toast('Проект сохранён: ' + r.path, 'ok');
  } else if (!r.canceled) {
    toast('Ошибка сохранения: ' + r.error, 'err');
  }
  return !!r.ok;
}

function applyPvBg() {
  const v = document.getElementById('pvBg').value;
  const st = document.getElementById('pvStage');
  st.classList.remove('bg-dark', 'bg-light');
  if (v === 'dark') st.classList.add('bg-dark');
  else if (v === 'light') st.classList.add('bg-light');
}

async function exportAnim(fmt) {
  if (!pv) {
    toast('Сначала открой предпросмотр', 'err');
    return;
  }
  const payload = gatherPayload();
  payload.animation = pv.animName;
  payload.format = fmt;
  bpStart(Object.keys(paths).length);
  appendLog(`Экспорт ${fmt.toUpperCase()}…`);
  const resp = await window.api.exportAnimation(payload);
  if (!resp.ok || (resp.result && resp.result.error)) {
    const err = resp.error || (resp.result && resp.result.error) || 'неизвестная ошибка';
    if (/отмен/i.test(err)) {
      toast('Экспорт отменён', '');
      appendLog('Экспорт отменён');
    } else {
      toast('Ошибка экспорта', 'err');
      appendLog(err);
    }
  } else {
    appendLog('Сохранено: ' + resp.result.path);
    toast('Сохранено: ' + resp.result.path + '. Для Orca: «Загрузить своего…» (одна анимация).', 'ok');
  }
}

async function pasteInto(row) {
  const p = await window.api.pasteImage();
  if (!p) {
    toast('В буфере обмена нет изображения', 'err');
    return;
  }
  if (cardByRow[row]) {
    cardByRow[row].setPath(p);
    commitHistory('Вставка из буфера');
    addRecent(p);
  }
}

function firstEmptyRow() {
  for (const anim of ANIMS) {
    if (!paths[anim.row]) return anim.row;
  }
  return 0;
}

function newPet() {
  if (Object.keys(paths).length) {
    if (!confirm('Очистить все ячейки и начать нового питомца?')) return;
  }
  applyingProject = true;
  for (const anim of ANIMS) cardByRow[anim.row].clearPath();
  for (const k of Object.keys(transforms)) delete transforms[k];
  applyingProject = false;

  document.getElementById('label').value = 'My Pet';
  document.getElementById('petId').value = '';
  document.getElementById('frameW').value = 384;
  document.getElementById('frameH').value = 416;
  document.getElementById('consistent').checked = true;

  scheduleDraft();
  commitHistory('Новый питомец');
  switchTab('builder');
  toast('Новый питомец: все ячейки очищены', 'ok');
}

function scheduleDraft() {
  if (applyingProject) return;
  window.api.setDirty(true);
  clearTimeout(draftTimer);
  draftTimer = setTimeout(() => {
    window.api.saveDraft(currentProject());
  }, 700);
}

function currentProject() {
  return {
    version: 1,
    rows: { ...paths },
    transforms: JSON.parse(JSON.stringify(transforms)),
    frameWidth: parseInt(document.getElementById('frameW').value, 10) || 384,
    frameHeight: parseInt(document.getElementById('frameH').value, 10) || 416,
    label: document.getElementById('label').value,
    petId: document.getElementById('petId').value,
    consistentScale: document.getElementById('consistent').checked,
    bg: gatherBg(),
    animOptions: JSON.parse(JSON.stringify(animOptions)),
    disabled: [],
    webpMode: document.getElementById('webpMode').value,
    snapFps: !document.getElementById('snapFps') || document.getElementById('snapFps').checked,
    orcaFps: parseInt((document.getElementById('orcaFps') || {}).value, 10) || 8,
    outDir: outDir || '',
  };
}

async function applyProject(project, opts) {
  const silent = opts && opts.silent;
  applyingProject = true;
  for (const anim of ANIMS) cardByRow[anim.row].clearPath();

  document.getElementById('frameW').value = project.frameWidth || 384;
  document.getElementById('frameH').value = project.frameHeight || 416;
  document.getElementById('label').value = project.label || 'My Pet';
  document.getElementById('petId').value = project.petId || '';
  document.getElementById('consistent').checked = project.consistentScale !== false;
  if (document.getElementById('snapFps')) {
    document.getElementById('snapFps').checked = project.snapFps !== false;
    document.getElementById('orcaFps').value = project.orcaFps || 8;
  }
  const bgp = project.bg || {};
  document.getElementById('bgAlpha').checked = !!(bgp.alphaMatting || project.bgAlpha);
  document.getElementById('bgFg').value = bgp.fgThreshold || 240;
  document.getElementById('bgBg').value = bgp.bgThreshold || 10;
  document.getElementById('bgErode').value = bgp.erode || 10;
  if (document.getElementById('bgFeather')) document.getElementById('bgFeather').value = bgp.feather || 0;
  const chroma = bgp.chroma || {};
  document.getElementById('chromaOn').checked = !!chroma.enabled;
  document.getElementById('chromaColor').value = rgbToHex(chroma.r ?? 255, chroma.g ?? 255, chroma.b ?? 255);
  document.getElementById('chromaTol').value = chroma.tol || 30;
  const bgModelName = bgp.model || project.bgModel;
  if (bgModelName) {
    const sel = document.getElementById('bgModel');
    const has = (name) => Array.from(sel.options).some((o) => o.value === name);
    if (bgModelName === 'bria-rmbg' && has('u2net')) {
      sel.value = 'u2net';
    } else if (has(bgModelName)) {
      sel.value = bgModelName;
    } else {
      pendingBgModel = bgModelName;
    }
  }
  animOptions = project.animOptions ? JSON.parse(JSON.stringify(project.animOptions)) : {};
  renderAnimOptions();
  document.getElementById('webpMode').value = project.webpMode || 'lossless';
  outDir = project.outDir || null;
  if (outDir) {
    const el = document.getElementById('outPath');
    el.textContent = outDir;
    el.title = outDir;
  }

  const rows = project.rows || {};
  const list = Object.values(rows);
  const exists = list.length ? await window.api.checkPaths(list) : {};

  let applied = 0;
  const missing = [];
  for (const k of Object.keys(rows)) {
    const row = parseInt(k, 10);
    const p = rows[k];
    if (!cardByRow[row]) continue;
    if (exists[p]) {
      const imported = (await window.api.importFile(p)) || p;
      cardByRow[row].setPath(imported, { preserve: true });
      applied++;
    } else {
      missing.push(p.split(/[\\/]/).pop());
    }
  }

  for (const k of Object.keys(transforms)) delete transforms[k];
  for (const k of Object.keys(project.transforms || {})) {
    const row = parseInt(k, 10);
    if (paths[row]) transforms[row] = project.transforms[k];
  }
  for (const anim of ANIMS) cardByRow[anim.row].updateTune();

  applyingProject = false;

  if (!silent) {
    if (missing.length) toast(`Не найдены файлы: ${missing.join(', ')}`, 'err');
    else toast('Проект загружен', 'ok');
  }
}

function toFileUrl(p) {
  const norm = p.replace(/\\/g, '/');
  return (
    'file:///' +
    norm
      .split('/')
      .map((seg, i) => (i === 0 ? seg : encodeURIComponent(seg)))
      .join('/')
  );
}

function toast(msg, kind) {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.className = 'toast ' + (kind || '');
  clearTimeout(toast._t);
  toast._t = setTimeout(() => el.classList.add('hidden'), 6000);
}

function setLog(text) {
  document.getElementById('log').textContent = text;
}

function appendLog(line) {
  bpFromLog(line);
  const el = document.getElementById('log');
  el.textContent += (el.textContent ? '\n' : '') + line;
  el.scrollTop = el.scrollHeight;

  const pm = document.getElementById('previewModal');
  const st = document.getElementById('pvStatus');
  if (pm && !pm.classList.contains('hidden') && st && !st.classList.contains('hidden')) {
    st.textContent = line;
  }
}

function isDefaultTransform(t) {
  if (!t) return true;
  return (
    Math.abs((t.scale || 1) - 1) < 0.005 &&
    Math.abs((t.stretchX || 1) - 1) < 0.005 &&
    Math.abs((t.stretchY || 1) - 1) < 0.005 &&
    Math.abs(t.dx || 0) < 0.005 &&
    Math.abs(t.dy || 0) < 0.005 &&
    ((t.rotate || 0) % 360) === 0 &&
    !t.flip &&
    !t.still &&
    (t.anchor || 'bottom') === 'bottom' &&
    t.rock !== false &&
    !t.crop &&
    !(Array.isArray(t.gifFrames) && t.gifFrames.length) &&
    !(t.chroma && t.chroma.enabled)
  );
}

function updateSlotCount() {
  const el = document.getElementById('slotCount');
  if (el) el.textContent = Object.keys(paths).length + '/' + ANIMS.length;
}

function updateAnimNames() {
  const els = document.querySelectorAll('.anim-name');
  ANIMS.forEach((a, i) => {
    if (els[i]) els[i].classList.toggle('filled', !!paths[a.row]);
  });
}

const mediaInfoCache = new Map();

async function updateSlotMeta(el, path) {
  if (!el) return;
  el.textContent = '';
  try {
    let info = mediaInfoCache.get(path);
    if (!info) {
      const r = await window.api.mediaInfo({ path });
      if (!r.ok || !r.result) return;
      info = r.result;
      mediaInfoCache.set(path, info);
    }
    const fps = info.fps ? Math.round(info.fps * 10) / 10 + ' fps' : '';
    el.textContent =
      info.width +
      '×' +
      info.height +
      ' · ' +
      (info.animated ? 'GIF ' + info.frames + ' кадр. ' + fps : 'фото');
    el.title = el.textContent;
  } catch (_) {}
}

let slotMenuEl = null;

function closeSlotMenu() {
  if (slotMenuEl && slotMenuEl.parentNode) slotMenuEl.parentNode.removeChild(slotMenuEl);
  slotMenuEl = null;
}

function showSlotMenu(row, x, y) {
  closeSlotMenu();
  const card = cardByRow[row];
  if (!card) return;
  const menu = document.createElement('div');
  menu.className = 'slot-menu';
  const items = [
    {
      label: 'Заменить…',
      action: async () => {
        const raw = await window.api.selectImage();
        const p = await toGifIfVideo(raw);
        if (p) {
          card.setPath(p);
          commitHistory('Фото в слот');
          addRecent(p);
        }
      },
    },
    {
      label: 'Очистить',
      disabled: !paths[row],
      action: () => {
        card.clearPath();
        commitHistory('Очистка слота');
      },
    },
    {
      label: 'Сбросить настройку',
      disabled: !transforms[row],
      action: () => {
        delete transforms[row];
        if (card.updateTune) card.updateTune();
        scheduleDraft();
        commitHistory('Сброс настройки слота');
      },
    },
    {
      label: 'Сравнить до/после',
      disabled: !paths[row],
      action: () => compareCutout(row),
    },
    {
      label: 'Вписать в безопасную зону',
      disabled: !paths[row],
      action: () => {
        const t = transforms[row] ? JSON.parse(JSON.stringify(transforms[row])) : {};
        t.scale = 1;
        t.stretchX = 1;
        t.stretchY = 1;
        t.dx = 0;
        t.dy = 0;
        delete t.crop;
        if (isDefaultTransform(t)) delete transforms[row];
        else transforms[row] = t;
        if (card.updateTune) card.updateTune();
        scheduleDraft();
        commitHistory('Вписать слот в безопасную зону');
      },
    },
    {
      label: 'Вставить сюда',
      disabled: !slotClipboard,
      action: () => {
        if (!slotClipboard) return;
        card.setPath(slotClipboard.path, { preserve: true });
        if (slotClipboard.transform) {
          transforms[row] = JSON.parse(JSON.stringify(slotClipboard.transform));
        } else {
          delete transforms[row];
        }
        if (card.updateTune) card.updateTune();
        updateSlotCount();
        scheduleDraft();
        commitHistory('Вставка слота');
      },
    },
  ];
  for (const it of items) {
    const b = document.createElement('button');
    b.className = 'slot-menu-item';
    b.textContent = it.label;
    b.disabled = !!it.disabled;
    b.addEventListener('click', () => {
      closeSlotMenu();
      it.action();
    });
    menu.appendChild(b);
  }
  document.body.appendChild(menu);
  slotMenuEl = menu;
  const rect = menu.getBoundingClientRect();
  menu.style.left = Math.min(x, window.innerWidth - rect.width - 8) + 'px';
  menu.style.top = Math.min(y, window.innerHeight - rect.height - 8) + 'px';
}

document.addEventListener('pointerdown', (e) => {
  if (slotMenuEl && !slotMenuEl.contains(e.target)) closeSlotMenu();
});
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') closeSlotMenu();
});
window.addEventListener('blur', closeSlotMenu);

function renderCard(anim) {
  const card = document.createElement('div');
  card.className = 'card' + (anim.required ? ' required' : '');
  card.dataset.row = anim.row;

  card.innerHTML = `
    <div class="card-head">
      <div>
        <div class="card-title">${anim.hint}</div>
      </div>
      <div class="head-right">
        <button class="slot-copy ghost small" title="Скопировать слот">⧉</button>
        <button class="slot-paste ghost small hidden" title="Вставить слот">⎘</button>
        <div class="badge">${anim.frames} кадр.</div>
      </div>
    </div>
    <div class="drop">
      <div class="placeholder">Перетащите фото/видео<br>или нажмите</div>
      <img class="thumb hidden" alt="" />
    </div>
    <div class="card-foot">
      <div class="file-name"></div>
      <div class="file-meta"></div>
      <button class="paste ghost small" title="Вставить фото из буфера обмена">Вставить</button>
      <button class="clear ghost small hidden" title="Очистить слот">×</button>
      <button class="tune ghost small hidden">Настроить</button>
    </div>
  `;

  const drop = card.querySelector('.drop');
  const thumb = card.querySelector('.thumb');
  const placeholder = card.querySelector('.placeholder');
  const nameEl = card.querySelector('.file-name');
  const metaEl = card.querySelector('.file-meta');
  const tuneBtn = card.querySelector('.tune');
  const pasteBtn = card.querySelector('.paste');
  const clearBtn = card.querySelector('.clear');

  const copySlotBtn = card.querySelector('.slot-copy');
  const pasteSlotBtn = card.querySelector('.slot-paste');
  copySlotBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    if (!paths[anim.row]) {
      toast('В слоте нет фото', 'err');
      return;
    }
    slotClipboard = {
      path: paths[anim.row],
      transform: transforms[anim.row] ? JSON.parse(JSON.stringify(transforms[anim.row])) : null,
    };
    updatePasteButtons();
    toast('Слот скопирован', 'ok');
  });
  pasteSlotBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    if (!slotClipboard) return;
    setPath(slotClipboard.path, { preserve: true });
    if (slotClipboard.transform) transforms[anim.row] = JSON.parse(JSON.stringify(slotClipboard.transform));
    else delete transforms[anim.row];
    updateTune();
    updateSlotCount();
    scheduleDraft();
    commitHistory('Вставка слота');
  });

  const updateTune = () => {
    const t = transforms[anim.row];
    if (t && !isDefaultTransform(t)) {
      tuneBtn.textContent = 'Настроено';
      tuneBtn.classList.add('active');
    } else {
      tuneBtn.textContent = 'Настроить';
      tuneBtn.classList.remove('active');
    }
  };
  card.updateTune = updateTune;

  const setPath = (p, opts) => {
    if (!p) return;
    const preserve = opts && opts.preserve;
    paths[anim.row] = p;
    if (!preserve) delete transforms[anim.row];
    card.classList.add('filled');
    card.setAttribute('draggable', 'true');
    thumb.src = toFileUrl(p);
    thumb.classList.remove('hidden');
    placeholder.classList.add('hidden');
    nameEl.textContent = p.split(/[\\/]/).pop();
    nameEl.title = p;
    updateSlotMeta(metaEl, p);
    tuneBtn.classList.remove('hidden');
    clearBtn.classList.remove('hidden');
    updateTune();
    updateSlotCount();
    updateAnimNames();
    scheduleDraft();
  };

  const clearPath = () => {
    delete paths[anim.row];
    delete transforms[anim.row];
    card.classList.remove('filled');
    card.removeAttribute('draggable');
    thumb.removeAttribute('src');
    thumb.classList.add('hidden');
    placeholder.classList.remove('hidden');
    nameEl.textContent = '';
    nameEl.title = '';
    if (metaEl) metaEl.textContent = '';
    tuneBtn.classList.add('hidden');
    clearBtn.classList.add('hidden');
    updateSlotCount();
    updateAnimNames();
    scheduleDraft();
  };

  card.setPath = setPath;
  card.clearPath = clearPath;

  const pick = async () => {
    const raw = await window.api.selectImage();
    const p = await toGifIfVideo(raw);
    if (p) {
      setPath(p);
      commitHistory('Фото в слот');
      addRecent(p);
    }
  };
  drop.addEventListener('click', pick);
  tuneBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    openAdjust(anim.row);
  });
  pasteBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    pasteInto(anim.row);
  });
  clearBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    clearPath();
    commitHistory('Очистка слота');
  });
  card.addEventListener('pointerenter', () => {
    hoverRow = anim.row;
  });

  // Перетаскивание уже загруженного фото на другое место
  card.addEventListener('dragstart', (e) => {
    if (!paths[anim.row]) {
      e.preventDefault();
      return;
    }
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('application/x-pet-row', String(anim.row));
    card.classList.add('dragging');
  });
  card.addEventListener('dragend', () => card.classList.remove('dragging'));

  card.addEventListener('dragover', (e) => {
    e.preventDefault();
    const internal = Array.from(e.dataTransfer.types).includes('application/x-pet-row');
    e.dataTransfer.dropEffect = internal ? 'move' : 'copy';
    card.classList.add('drag');
  });
  card.addEventListener('dragleave', () => card.classList.remove('drag'));
  card.addEventListener('drop', async (e) => {
    e.preventDefault();
    card.classList.remove('drag');

    if (e.dataTransfer.types.includes('application/x-pet-row')) {
      const from = parseInt(e.dataTransfer.getData('application/x-pet-row'), 10);
      if (!Number.isNaN(from) && from !== anim.row) swapRows(from, anim.row);
      return;
    }

    if (e.dataTransfer.types.includes('application/x-pet-path')) {
      const p = e.dataTransfer.getData('application/x-pet-path');
      if (p) {
        const imported = (await window.api.importFile(p)) || p;
        setPath(imported);
        commitHistory('Перетаскивание фото');
        addRecent(imported);
      }
      return;
    }

    const file = e.dataTransfer.files && e.dataTransfer.files[0];
    if (!file) return;
    const raw = window.api.pathForFile(file);
    const imported = raw ? (await window.api.importFile(raw)) || raw : null;
    const p = await toGifIfVideo(imported);
    if (p) {
      setPath(p);
      commitHistory('Фото в слот');
      addRecent(p);
    }
  });

  card.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    showSlotMenu(anim.row, e.clientX, e.clientY);
  });

  return card;
}

function swapRows(a, b) {
  const aPath = paths[a];
  const bPath = paths[b];
  const aT = transforms[a];
  const bT = transforms[b];

  cardByRow[a].clearPath();
  cardByRow[b].clearPath();

  if (bPath) cardByRow[a].setPath(bPath, { preserve: true });
  if (aPath) cardByRow[b].setPath(aPath, { preserve: true });

  if (bT) transforms[a] = bT;
  if (aT) transforms[b] = aT;

  cardByRow[a].updateTune();
  cardByRow[b].updateTune();
  scheduleDraft();
  commitHistory('Обмен слотов');
}

function switchTab(name) {
  for (const b of document.querySelectorAll('.tab')) {
    b.classList.toggle('active', b.dataset.tab === name);
  }
  document.getElementById('panel-builder').classList.toggle('hidden', name !== 'builder');
  document.getElementById('panel-pets').classList.toggle('hidden', name !== 'pets');
  if (name === 'pets') loadPets();
}

function escapeHtml(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

const PETS_CACHE_KEY = 'psb.petsCacheV1';

function readPetsCache() {
  try {
    const arr = JSON.parse(localStorage.getItem(PETS_CACHE_KEY) || '[]');
    return Array.isArray(arr) ? arr : [];
  } catch (_) {
    return [];
  }
}

function writePetsCache(list) {
  try {
    localStorage.setItem(PETS_CACHE_KEY, JSON.stringify(list.slice(0, 100)));
  } catch (_) {}
}

function showPetsError(text) {
  const grid = document.getElementById('petsGrid');
  grid.innerHTML = `<div class="no-sources">Не удалось загрузить питомцев: ${escapeHtml(text)}<br><br><button class="ghost small" id="retryPets">Повторить</button></div>`;
  const btn = document.getElementById('retryPets');
  if (btn) btn.addEventListener('click', () => loadPets());
}

async function loadPets() {
  const grid = document.getElementById('petsGrid');
  const empty = document.getElementById('petsEmpty');
  empty.classList.add('hidden');

  if (!petsCache.length) {
    const stored = readPetsCache();
    if (stored.length) {
      petsCache = stored;
      renderPetsFiltered();
    } else {
      grid.innerHTML = '<div class="no-sources">Загрузка…</div>';
    }
  }

  let resp;
  try {
    resp = await window.api.listPets();
  } catch (e) {
    if (!petsCache.length) showPetsError(e && e.message ? e.message : String(e));
    return;
  }
  grid.innerHTML = '';

  if (!resp || !resp.ok) {
    if (!petsCache.length) showPetsError((resp && resp.error) || 'не удалось получить список');
    return;
  }
  const res = resp.result || {};
  petsCache = res.pets || [];
  writePetsCache(petsCache);
  renderPetsFiltered();
}

function renderPetsFiltered() {
  const grid = document.getElementById('petsGrid');
  const empty = document.getElementById('petsEmpty');
  const q = document.getElementById('petsSearch').value.trim().toLowerCase();

  const list = petsCache.filter(
    (p) =>
      !q ||
      String(p.label || '').toLowerCase().includes(q) ||
      String(p.id || '').toLowerCase().includes(q)
  );

  grid.innerHTML = '';
  if (!list.length) {
    empty.textContent = petsCache.length ? 'Ничего не найдено.' : 'Питомцев пока нет.';
    empty.classList.remove('hidden');
    return;
  }
  empty.classList.add('hidden');
  for (const pet of list) grid.appendChild(renderPetCard(pet));
}

function renderPetCard(pet) {
  const card = document.createElement('div');
  card.className = 'pet-card' + (pet.active ? ' active' : '');

  const preview = pet.preview ? toFileUrl(pet.preview) : null;
  const size = pet.frameWidth && pet.frameHeight ? `${pet.frameWidth}×${pet.frameHeight}` : '—';

  const sourcesHtml = pet.sources.length
    ? pet.sources
        .map((s) => {
          const src = s.exists ? toFileUrl(s.thumb || s.path) : '';
          return `
            <div class="source ${s.exists ? '' : 'missing'}" title="${escapeHtml(s.path)}">
              ${src ? `<img src="${src}" alt="" loading="lazy" decoding="async" />` : '<img alt="" />'}
              <div class="s-name">${escapeHtml(s.name)}</div>
            </div>`;
        })
        .join('')
    : '<div class="no-sources">Исходные фото не сохранены</div>';

  card.innerHTML = `
    <div class="pet-card-top">
      ${preview ? `<img class="pet-preview" src="${preview}" alt="" loading="lazy" decoding="async" />` : '<div class="pet-preview"></div>'}
      <div>
        <div class="pet-label">
          ${escapeHtml(pet.label)}
          ${pet.active ? '<span class="pill">активен</span>' : ''}
        </div>
        <div class="pet-sub">${size} · ${escapeHtml(pet.id || '')}</div>
      </div>
    </div>
    <div class="sources">${sourcesHtml}</div>
    <div class="pet-actions">
      <button class="reuse ghost small">В редактор</button>
      <button class="clone ghost small">Клонировать</button>
    </div>
  `;

  const reuse = card.querySelector('.reuse');
  const clone = card.querySelector('.clone');
  if (!pet.sources.length) {
    reuse.disabled = true;
    reuse.title = 'Нет сохранённых фото';
    clone.disabled = true;
    clone.title = 'Нет сохранённых фото';
  } else {
    reuse.addEventListener('click', () => reusePet(pet));
    clone.addEventListener('click', () => {
      reusePet(pet);
      document.getElementById('label').value = (pet.label || 'Pet') + ' копия';
      document.getElementById('petId').value = '';
      scheduleDraft();
      commitHistory('Клонирование питомца');
    });
  }

  return card;
}

function reusePet(pet) {
  let applied = 0;
  const missing = [];

  for (const s of pet.sources) {
    const card = cardByRow[s.row];
    if (!card) continue;
    if (s.exists) {
      card.setPath(s.path, { preserve: true });
      if (pet.transforms && pet.transforms[s.row]) transforms[s.row] = pet.transforms[s.row];
      else if (pet.transforms && pet.transforms[String(s.row)]) transforms[s.row] = pet.transforms[String(s.row)];
      else delete transforms[s.row];
      card.updateTune();
      applied++;
    } else {
      missing.push(s.name);
    }
  }

  document.getElementById('frameW').value = pet.frameWidth || 384;
  document.getElementById('frameH').value = pet.frameHeight || 416;
  document.getElementById('label').value = pet.label || 'My Pet';
  document.getElementById('petId').value = pet.id || '';
  document.getElementById('consistent').checked = !!pet.consistentScale;

  switchTab('builder');
  commitHistory('Загрузка питомца');

  if (!applied) {
    toast('Не удалось загрузить: файлы фото не найдены', 'err');
    return;
  }
  let msg = `Загружено фото: ${applied}`;
  if (missing.length) msg += `. Нет файлов: ${missing.join(', ')}`;
  toast(msg, missing.length ? 'err' : 'ok');
}

// ---------- Настройка фото ----------

function animKeyForRow(row) {
  const a = ANIMS.find((x) => x.row === row);
  return a ? a.key : null;
}

function setCropInputs(crop) {
  const c = crop || {};
  document.getElementById('apCropL').value = Math.round((c.l || 0) * 100);
  document.getElementById('apCropT').value = Math.round((c.t || 0) * 100);
  document.getElementById('apCropR').value = Math.round((c.r || 0) * 100);
  document.getElementById('apCropB').value = Math.round((c.b || 0) * 100);
}

function readCrop() {
  const l = parseInt(document.getElementById('apCropL').value, 10) || 0;
  const t = parseInt(document.getElementById('apCropT').value, 10) || 0;
  const r = parseInt(document.getElementById('apCropR').value, 10) || 0;
  const b = parseInt(document.getElementById('apCropB').value, 10) || 0;
  if (!l && !t && !r && !b) return null;
  return { l: l / 100, t: t / 100, r: r / 100, b: b / 100 };
}

function renderGifFramesEditor() {
  const box = document.getElementById('apGifFrames');
  if (!box) return;
  if (!gifCandidates.length) {
    box.innerHTML = '<span class="muted">Нажми «Загрузить кадры»</span>';
    return;
  }
  box.innerHTML = '';
  gifCandidates.forEach((c, idx) => {
    const d = document.createElement('div');
    d.className = 'gframe' + (c.checked ? '' : ' off');
    d.draggable = true;

    const chk = document.createElement('input');
    chk.type = 'checkbox';
    chk.className = 'gchk';
    chk.checked = c.checked;
    chk.addEventListener('change', () => {
      c.checked = chk.checked;
      d.classList.toggle('off', !c.checked);
    });

    const img = document.createElement('img');
    img.src = toFileUrl(c.thumb);

    const dur = document.createElement('input');
    dur.type = 'number';
    dur.min = '20';
    dur.value = c.duration;
    dur.title = 'Длительность кадра, мс';
    dur.addEventListener('input', () => {
      c.duration = parseInt(dur.value, 10) || c.duration;
    });

    d.appendChild(chk);
    d.appendChild(img);
    d.appendChild(dur);

    d.addEventListener('dragstart', (e) => {
      e.dataTransfer.setData('text/plain', String(idx));
      d.classList.add('drag');
    });
    d.addEventListener('dragend', () => d.classList.remove('drag'));
    d.addEventListener('dragover', (e) => e.preventDefault());
    d.addEventListener('drop', (e) => {
      e.preventDefault();
      const from = parseInt(e.dataTransfer.getData('text/plain'), 10);
      if (Number.isNaN(from) || from === idx) return;
      const [m] = gifCandidates.splice(from, 1);
      gifCandidates.splice(idx, 0, m);
      renderGifFramesEditor();
    });

    box.appendChild(d);
  });
}

async function loadGifFramesForRow(row) {
  const path = paths[row];
  if (!path) return;
  const box = document.getElementById('apGifFrames');
  box.innerHTML = '<span class="muted">Загрузка…</span>';
  const resp = await window.api.gifInfo({ path });
  if (!resp.ok || (resp.result && resp.result.error)) {
    box.innerHTML = '<span class="muted">Не удалось прочитать GIF</span>';
    return;
  }
  const frames = (resp.result && resp.result.frames) || [];
  const t = transforms[row] || {};
  const picked = Array.isArray(t.gifFrames) ? t.gifFrames : null;
  const autoPick = evenFrameSet(frames);
  gifCandidates = frames.map((f) => ({
    index: f.index,
    thumb: f.thumb,
    duration: f.duration,
    checked: picked ? picked.includes(f.index) : autoPick.has(f.index),
  }));
  if (picked) {
    gifCandidates.sort((a, b) => picked.indexOf(a.index) - picked.indexOf(b.index));
    if (Array.isArray(t.gifDurs) && t.gifDurs.length === picked.length) {
      const map = {};
      picked.forEach((pi, k) => (map[pi] = t.gifDurs[k]));
      gifCandidates.forEach((c) => {
        if (map[c.index]) c.duration = map[c.index];
      });
    }
  }
  renderGifFramesEditor();
}

function renderStatesChecklist() {
  const el = document.getElementById('statesList');
  if (!el) return;
  el.innerHTML = '';
  for (const a of ANIMS) {
    const p = paths[a.row];
    const opt = animOptions[a.key] || {};
    const type = !p ? '—' : isAnimatedPath(p) ? 'GIF' : 'фото';
    let info = '';
    if (p) info = (opt.speed && opt.speed !== 1 ? opt.speed + '×' : '1×');
    if (p && !isAnimatedPath(p) && Array.isArray(opt.durations)) info += ' · свои кадры';
    const row = document.createElement('div');
    row.className = 'states-row';
    const name = document.createElement('span');
    name.textContent = a.hint;
    const t1 = document.createElement('span');
    t1.textContent = type;
    const t2 = document.createElement('span');
    t2.textContent = info || '';
    row.appendChild(name);
    row.appendChild(t1);
    row.appendChild(t2);
    el.appendChild(row);
  }
}

function renderDurations(anim, row) {
  const box = document.getElementById('apDurations');
  if (!box) return;
  box.innerHTML = '';
  if (!anim) return;
  if (/\.gif$/i.test(paths[row] || '')) {
    box.innerHTML = '<span class="muted">Для GIF длительности берутся из файла</span>';
    return;
  }
  const opt = animOptions[anim.key] || {};
  const durs =
    Array.isArray(opt.durations) && opt.durations.length === anim.frames
      ? opt.durations
      : baseDurations(anim);
  durs.forEach((d, i) => {
    const inp = document.createElement('input');
    inp.type = 'number';
    inp.min = '20';
    inp.value = d;
    inp.title = 'Кадр ' + (i + 1);
    box.appendChild(inp);
  });
}

function openAdjust(row) {
  if (!paths[row]) return;
  adjustRow = row;
  adjustShowCutout = false;
  adjustCutoutSrc = null;
  apZoom = 1;
  apPanX = 0;
  apPanY = 0;
  updateApView();
  const baBtn = document.getElementById('apBeforeAfter');
  if (baBtn) baBtn.textContent = 'Показать «после»';
  const t = transforms[row] || {};
  document.getElementById('apImg').src = toFileUrl(paths[row]);
  document.getElementById('apScale').value = Math.round((t.scale || 1) * 100);
  document.getElementById('apFlip').checked = !!t.flip;
  adjustDx = t.dx || 0;
  adjustDy = t.dy || 0;
  adjustSX = t.stretchX || 1;
  adjustSY = t.stretchY || 1;
  adjustRotate = ((t.rotate || 0) % 360 + 360) % 360;
  document.getElementById('apRotateVal').textContent = adjustRotate + '°';

  const anim = ANIMS.find((a) => a.row === row);
  const opt = (anim && animOptions[anim.key]) || {};
  const animated = isAnimatedPath(paths[row]);
  document.getElementById('apAnimTitle').textContent =
    (animated ? 'GIF: ' : 'Фото: ') + (anim ? anim.hint : '');
  document.getElementById('apStaticBlock').classList.toggle('hidden', animated);
  document.getElementById('apGifBlock').classList.toggle('hidden', !animated);
  setCropInputs(t.crop);
  if (animated) {
    gifCandidates = [];
    loadGifFramesForRow(row);
    document.getElementById('apGifRock').checked = t.rock !== false;
    const ch = t.chroma || gatherBg().chroma || {};
    document.getElementById('apChroma').checked = !!ch.enabled;
    document.getElementById('apChromaColor').value = rgbToHex(
      ch.r ?? 255,
      ch.g ?? 255,
      ch.b ?? 255
    );
    document.getElementById('apChromaTol').value = ch.tol || 30;
  }
  document.getElementById('apSpeed').value = opt.speed || 1;
  document.getElementById('apSpeedVal').textContent = (opt.speed || 1) + '×';
  document.getElementById('apPingpong').checked = !!opt.pingpong;
  document.getElementById('apStill').checked = !t.still;
  document.getElementById('apAnchor').value = t.anchor || 'bottom';
  document.getElementById('apSafeZone').classList.toggle(
    'hidden',
    !document.getElementById('apSafe').checked
  );
  renderDurations(anim, row);

  document.getElementById('adjustModal').classList.remove('hidden');
  startAdjustAnim();
}

function startAdjustAnim() {
  stopAdjustAnim();
  adjustAnim.t0 = performance.now();
  const step = (now) => {
    const anim = ANIMS.find((a) => a.row === adjustRow);
    const frames = anim ? anim.frames : 6;
    const key = animKeyForRow(adjustRow);
    const speed = (key && animOptions[key] && parseFloat(animOptions[key].speed)) || 1;
    const period = Math.max(200, (frames * 180) / speed);
    adjustAnim.phase = (((now - adjustAnim.t0) % period) / period) * 2 * Math.PI;
    updateAdjustPreview();
    adjustAnim.raf = requestAnimationFrame(step);
  };
  adjustAnim.raf = requestAnimationFrame(step);
}

function stopAdjustAnim() {
  if (adjustAnim.raf) {
    cancelAnimationFrame(adjustAnim.raf);
    adjustAnim.raf = 0;
  }
}

function updateApView() {
  const v = document.getElementById('apViewport');
  if (v) v.style.transform = `translate(${apPanX}px, ${apPanY}px) scale(${apZoom})`;
}

function updateAdjustPreview() {
  const scale = parseInt(document.getElementById('apScale').value, 10) / 100;
  document.getElementById('apScaleVal').textContent = Math.round(scale * 100) + '%';

  const frame = document.getElementById('apFrame');
  const img = document.getElementById('apImg');
  const W = frame.clientWidth;
  const H = frame.clientHeight;

  const animated = adjustRow != null && isAnimatedPath(paths[adjustRow]);
  const rockOn = animated
    ? document.getElementById('apGifRock').checked
    : document.getElementById('apStill').checked;
  const ph = rockOn ? adjustAnim.phase || 0 : 0;
  const rot = 2.0 * Math.sin(ph);
  const bob = 2.0 * Math.sin(ph) * (H / 416);

  const anchor = document.getElementById('apAnchor').value;
  const shift = adjustDy * H + bob;
  const sx = scale * adjustSX;
  const sy = scale * adjustSY;
  const flip = document.getElementById('apFlip').checked ? 'scaleX(-1)' : '';
  img.style.left = `calc(50% + ${adjustDx * W}px)`;
  if (anchor === 'top') {
    img.style.bottom = 'auto';
    img.style.top = '4%';
    img.style.transformOrigin = 'top center';
    img.style.transform = `translateX(-50%) translateY(${shift}px) rotate(${rot}deg) rotate(${adjustRotate}deg) scale(${sx}, ${sy}) ${flip}`;
  } else if (anchor === 'center') {
    img.style.bottom = 'auto';
    img.style.top = '50%';
    img.style.transformOrigin = 'center center';
    img.style.transform = `translateX(-50%) translateY(calc(-50% + ${shift}px)) rotate(${rot}deg) rotate(${adjustRotate}deg) scale(${sx}, ${sy}) ${flip}`;
  } else {
    img.style.top = 'auto';
    img.style.bottom = '4%';
    img.style.transformOrigin = 'bottom center';
    img.style.transform = `translateX(-50%) translateY(${shift}px) rotate(${rot}deg) rotate(${adjustRotate}deg) scale(${sx}, ${sy}) ${flip}`;
  }
}

function saveAdjust() {
  if (adjustRow == null) return;
  const key = animKeyForRow(adjustRow);
  if (key) {
    const speed = parseFloat(document.getElementById('apSpeed').value) || 1;
    const pp = document.getElementById('apPingpong').checked;
    if (Math.abs(speed - 1) < 0.001 && !pp) delete animOptions[key];
    else animOptions[key] = { ...(animOptions[key] || {}), speed, pingpong: pp };

    const animObj = ANIMS.find((a) => a.row === adjustRow);
    const box = document.getElementById('apDurations');
    const inputs = box ? Array.from(box.querySelectorAll('input')) : [];
    if (animObj && inputs.length) {
      const vals = inputs.map((i) => parseInt(i.value, 10) || 120);
      const base = baseDurations(animObj);
      const differs = vals.some((v, i) => v !== base[i]);
      const cur = animOptions[key] || {};
      if (differs) animOptions[key] = { ...cur, durations: vals };
      else {
        delete cur.durations;
        if (Object.keys(cur).length) animOptions[key] = cur;
        else delete animOptions[key];
      }
    }
  }
  const t = {
    scale: parseInt(document.getElementById('apScale').value, 10) / 100,
    dx: adjustDx,
    dy: adjustDy,
    stretchX: adjustSX,
    stretchY: adjustSY,
    rotate: adjustRotate,
    flip: document.getElementById('apFlip').checked,
    still: !document.getElementById('apStill').checked,
    anchor: document.getElementById('apAnchor').value,
  };
  const crop = readCrop();
  if (crop) t.crop = crop;
  if (isAnimatedPath(paths[adjustRow])) {
    t.rock = document.getElementById('apGifRock').checked;
    t.chroma = {
      enabled: document.getElementById('apChroma').checked,
      ...hexToRgb(document.getElementById('apChromaColor').value),
      tol: parseInt(document.getElementById('apChromaTol').value, 10) || 30,
    };
    if (gifCandidates.length) {
      const checked = gifCandidates.filter((c) => c.checked);
      if (!checked.length) {
        toast('Выбери хотя бы один кадр GIF', 'err');
        return;
      }
      const truncated = checked.length > 8;
      const selected = checked.slice(0, 8);
      const selIdx = selected.map((c) => c.index);
      const allIdx = gifCandidates.map((c) => c.index);
      const isDefaultSel =
        selIdx.length === allIdx.length && selIdx.every((v, i) => v === allIdx[i]);
      if (!isDefaultSel) {
        t.gifFrames = selIdx;
        t.gifDurs = selected.map((c) => c.duration);
      }
      if (truncated) toast('Взяты первые 8 кадров', '');
    }
  }
  if (isDefaultTransform(t)) delete transforms[adjustRow];
  else transforms[adjustRow] = t;
  cardByRow[adjustRow].updateTune();
  stopAdjustAnim();
  document.getElementById('adjustModal').classList.add('hidden');
  adjustRow = null;
  scheduleDraft();
  commitHistory('Настройка слота');
}

// ---------- Живой предпросмотр ----------

function gatherPayload() {
  const rows = {};
  for (const anim of ANIMS) {
    if (paths[anim.row]) rows[anim.row] = paths[anim.row];
  }
  const tr = {};
  for (const k of Object.keys(transforms)) {
    if (!isDefaultTransform(transforms[k])) tr[k] = transforms[k];
  }
  return {
    rows,
    transforms: tr,
    frameWidth: parseInt(document.getElementById('frameW').value, 10),
    frameHeight: parseInt(document.getElementById('frameH').value, 10),
    label: document.getElementById('label').value.trim() || 'My Pet',
    petId: document.getElementById('petId').value.trim(),
    consistentScale: document.getElementById('consistent').checked,
    bg: gatherBg(),
    animOptions: JSON.parse(JSON.stringify(animOptions)),
    disabled: [],
    webpLossless: document.getElementById('webpMode').value === 'lossless',
    webpQuality:
      document.getElementById('webpMode').value === 'lossless'
        ? 95
        : parseInt(document.getElementById('webpMode').value, 10),
    outDir: outDir || undefined,
    orcaFps: readOrcaFps(),
    gifColors: parseInt(document.getElementById('gifColors').value, 10) || 256,
    gifMaxKb: parseInt(document.getElementById('gifMaxKb').value, 10) || 0,
  };
}

async function openPreview() {
  const metaErr = validatePetMeta();
  if (metaErr) {
    toast(metaErr, 'err');
    return;
  }
  if (!hasBuildable()) {
    toast('Добавь фото хотя бы для одной включённой анимации', 'err');
    return;
  }
  const payload = gatherPayload();
  if (!payload.frameWidth || !payload.frameHeight) {
    toast('Некорректный размер кадра', 'err');
    return;
  }

  pvStop();
  pv = null;
  const modal = document.getElementById('previewModal');
  const status = document.getElementById('pvStatus');
  const sprite = document.getElementById('pvSprite');
  modal.classList.remove('hidden');
  status.classList.remove('hidden');
  status.textContent = 'Сборка…';
  pvOrcaMode = false;
  const orcaBtn = document.getElementById('pvOrca');
  if (orcaBtn) orcaBtn.classList.remove('active');
  const stageEl = document.getElementById('pvStage');
  if (stageEl) stageEl.classList.remove('orca-mode');
  sprite.style.backgroundImage = '';
  document.getElementById('pvAnim').innerHTML = '';
  document.getElementById('pvWarnings').classList.add('hidden');

  bpStart(Object.keys(paths).length);
  showProgress();
  const resp = await window.api.preview(payload);
  hideProgress();
  if (!resp.ok || (resp.result && resp.result.error)) {
    const err = resp.error || resp.result.error;
    status.textContent = /отмен/i.test(err) ? 'Отменено' : 'Ошибка: ' + err;
    return;
  }

  const meta = resp.result;
  pv = {
    meta,
    animName: meta.defaultAnimation || 'idle',
    frameIndex: 0,
    playing: true,
    timer: null,
  };
  status.classList.add('hidden');
  document.getElementById('pvScaleInfo').textContent =
    `Orca: ${petSize}px · кадр ${meta.frameWidth}×${meta.frameHeight}`;
  applyPvBg();

  const sel = document.getElementById('pvAnim');
  for (const name of Object.keys(meta.animations)) {
    const opt = document.createElement('option');
    opt.value = name;
    opt.textContent = name;
    sel.appendChild(opt);
  }
  sel.value = pv.animName;
  document.getElementById('pvPlay').textContent = 'Пауза';

  const wr = meta.warnings || [];
  const wEl = document.getElementById('pvWarnings');
  if (wr.length) {
    wEl.textContent = 'Возможные проблемы:\n' + wr.join('\n');
    wEl.classList.remove('hidden');
  } else {
    wEl.classList.add('hidden');
  }

  pvTick();
}

function pvRenderFrame() {
  const m = pv.meta;
  const anim = m.animations[pv.animName];
  const idx = pv.frameIndex % anim.frames;
  const displayH = pvOrcaMode ? petSize || 260 : Math.min(280, petSize || 260);
  const s = displayH / m.frameHeight;
  const el = document.getElementById('pvSprite');
  el.style.width = m.frameWidth * s + 'px';
  el.style.height = m.frameHeight * s + 'px';
  el.style.backgroundImage = `url("${toFileUrl(m.previewPath)}")`;
  el.style.backgroundSize = `${m.sheetWidth * s}px ${m.sheetHeight * s}px`;
  el.style.backgroundPosition = `-${idx * m.frameWidth * s}px -${anim.row * m.frameHeight * s}px`;

  const line = document.getElementById('pvFrameLine');
  line.style.width = el.style.width;
  line.style.height = el.style.height;
  line.style.left = el.offsetLeft + 'px';
  line.style.top = el.offsetTop + 'px';
  line.classList.toggle('show', document.getElementById('pvGrid').checked);
}

function pvTick() {
  if (!pv || !pv.playing) return;
  const anim = pv.meta.animations[pv.animName];
  pvRenderFrame();
  const delay = anim.frameDurationsMs[pv.frameIndex % anim.frames] || 150;
  pv.frameIndex = (pv.frameIndex + 1) % anim.frames;
  pv.timer = setTimeout(pvTick, delay);
}

function pvStop() {
  if (pv && pv.timer) clearTimeout(pv.timer);
  if (pv) pv.timer = null;
}

function closePreview() {
  pvStop();
  pv = null;
  document.getElementById('previewModal').classList.add('hidden');
}

// ---------- Сборка ----------

function assignGifsByPaths(paths) {
  const keys = ANIMS.map((a) => a.key);
  for (const p of paths || []) {
    const base = p
      .split(/[\\/]/)
      .pop()
      .replace(/\.[^.]+$/, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '');
    const key =
      keys.find((k) => base === k) ||
      keys.find((k) => base.includes(k) || k.includes(base));
    if (key) gifMap[key] = p;
  }
}

async function prepareMediaPaths(list) {
  const out = [];
  for (const raw of list || []) {
    const p = await toGifIfVideo(raw, { silent: true });
    if (p) out.push(p);
  }
  return out;
}

function fillFromIdle() {
  const src = paths[0] || Object.values(paths)[0];
  if (!src) {
    toast('Нет фото для копирования', 'err');
    return;
  }
  let n = 0;
  for (const a of ANIMS) {
    if (!paths[a.row]) {
      cardByRow[a.row].setPath(src);
      n++;
    }
  }
  if (n) {
    commitHistory('Заполнить из Idle');
    toast('Заполнено слотов: ' + n, 'ok');
  } else {
    toast('Пустых слотов нет', '');
  }
}

async function zipBundle() {
  if (!lastBundle) {
    toast('Сначала собери bundle', 'err');
    return;
  }
  showProgress();
  try {
    const r = await window.api.zipFolder({ folder: lastBundle });
    if (r.ok && r.result && !r.result.error) {
      appendLog('ZIP: ' + r.result.path);
      toast('ZIP: ' + r.result.path, 'ok');
    } else {
      toast('Ошибка ZIP: ' + (r.error || (r.result && r.result.error) || ''), 'err');
    }
  } finally {
    hideProgress();
  }
}

async function loadBundles() {
  const el = document.getElementById('bundleList');
  if (!el) return;
  el.innerHTML = '<div class="muted">Загрузка…</div>';
  const r = await window.api.listBundles({ outDir: outDir || undefined });
  if (!r.ok) {
    el.innerHTML = '<div class="muted">Ошибка</div>';
    return;
  }
  const list = (r.result && r.result.bundles) || [];
  if (!list.length) {
    el.innerHTML = '<div class="muted">Не найдено</div>';
    return;
  }
  el.innerHTML = '';
  for (const b of list) {
    const row = document.createElement('div');
    row.className = 'queue-item';
    const s = document.createElement('span');
    s.textContent = b.name;
    s.title = b.path;
    const edit = document.createElement('button');
    edit.className = 'ghost small';
    edit.textContent = 'В редактор';
    edit.addEventListener('click', async () => {
      const r = await window.api.openBundlePath(b.path);
      if (!r.ok) {
        toast('Не удалось открыть bundle: ' + (r.error || ''), 'err');
        return;
      }
      await applyBundleResult(r);
      document.getElementById('toolsModal').classList.add('hidden');
    });
    const open = document.createElement('button');
    open.className = 'ghost small';
    open.textContent = 'Открыть';
    open.addEventListener('click', async () => {
      const chk = await window.api.checkPaths([b.path]);
      if (!chk[b.path]) {
        toast('Папка не найдена — обнови список', 'err');
        return;
      }
      const r = await window.api.openDir(b.path);
      if (r && !r.ok) toast('Не удалось открыть: ' + (r.error || ''), 'err');
    });
    const cp = document.createElement('button');
    cp.className = 'ghost small';
    cp.textContent = '⧉';
    cp.title = 'Копировать путь';
    cp.addEventListener('click', async () => {
      await window.api.copyText(b.path);
      toast('Путь скопирован', 'ok');
    });
    row.appendChild(s);
    row.appendChild(edit);
    row.appendChild(open);
    row.appendChild(cp);
    el.appendChild(row);
  }
}

function renderHistory() {
  const el = document.getElementById('historyList');
  if (!el) return;
  let hist = [];
  try {
    hist = JSON.parse(localStorage.getItem('psb.history') || '[]');
  } catch (_) {}
  if (!Array.isArray(hist) || !hist.length) {
    el.innerHTML = '<div class="muted">Пока пусто</div>';
    return;
  }
  el.innerHTML = '';
  hist.slice(0, 5).forEach((h) => {
    const row = document.createElement('div');
    row.className = 'queue-item history-item';
    const img = document.createElement('img');
    img.className = 'history-thumb';
    img.alt = '';
    const rows = h.project && h.project.rows ? Object.values(h.project.rows) : [];
    const first = rows.find(Boolean);
    if (first) img.src = toFileUrl(first);
    else img.style.display = 'none';
    const s = document.createElement('span');
    const d = new Date(h.t || Date.now());
    const label = h.label || 'Изменение';
    const name = h.project && h.project.label ? h.project.label : '';
    s.textContent =
      label + ' · ' + d.toLocaleTimeString() + (name ? ' · ' + name : '');
    s.title = s.textContent;
    const btn = document.createElement('button');
    btn.className = 'ghost small';
    btn.textContent = 'Восстановить';
    btn.addEventListener('click', () => applyProject(h.project));
    row.appendChild(img);
    row.appendChild(s);
    row.appendChild(btn);
    el.appendChild(row);
  });
}

function showWhatsNew(extraNotes) {
  const body = document.getElementById('whatsNewBody');
  if (!body) return;
  let html = '';
  for (const entry of CHANGELOG.slice(0, 4)) {
    html += `<h4>${escapeHtml(entry.version)}</h4><ul>${entry.notes
      .map((n) => `<li>${escapeHtml(n)}</li>`)
      .join('')}</ul>`;
  }
  if (Array.isArray(extraNotes) && extraNotes.length) {
    html += `<h4>Новое в обновлении</h4><ul>${extraNotes
      .map((n) => `<li>${escapeHtml(n)}</li>`)
      .join('')}</ul>`;
  }
  body.innerHTML = html;
  document.getElementById('whatsNewModal').classList.remove('hidden');
}

async function exportDiagnosticLog() {
  const text = document.getElementById('log').textContent || '(журнал пуст)';
  const r = await window.api.exportLog(text);
  if (r.ok) toast('Лог сохранён: ' + r.path, 'ok');
  else if (!r.canceled) toast('Ошибка сохранения лога: ' + r.error, 'err');
}

async function downloadUpdateQuiet(url) {
  const status = document.getElementById('updateStatus');
  const dl = document.getElementById('downloadUpdateBtn');
  const inst = document.getElementById('installUpdateBtn');
  status.textContent = 'Скачивается обновление…';
  const r = await window.api.downloadUpdate(url);
  if (r && r.ok) {
    pendingUpdatePath = r.path;
    status.textContent = 'Обновление скачано — можно перезапустить';
    dl.classList.add('hidden');
    inst.classList.remove('hidden');
    toast('Обновление скачано', 'ok');
  } else {
    status.textContent = 'Не удалось скачать обновление: ' + ((r && r.error) || '');
    dl.classList.remove('hidden');
  }
}

async function checkUpdates(silent) {
  const status = document.getElementById('updateStatus');
  const dl = document.getElementById('downloadUpdateBtn');
  const inst = document.getElementById('installUpdateBtn');
  status.textContent = 'Проверка…';
  inst.classList.add('hidden');
  const r = await window.api.checkUpdate();
  if (!r.configured) {
    status.textContent = 'URL манифеста не задан';
    if (!silent) toast('Укажи URL манифеста обновлений', 'err');
    return;
  }
  if (r.error) {
    status.textContent = 'Ошибка: ' + r.error;
    return;
  }
  if (r.newer) {
    status.textContent = `Доступна версия ${r.latest} (у тебя ${r.current})`;
    if (r.url) {
      dl.classList.remove('hidden');
      dl.dataset.url = r.url;
      if (silent && document.getElementById('updateAuto').checked) {
        downloadUpdateQuiet(r.url);
      }
    }
    if (!silent) toast('Доступно обновление ' + r.latest, 'ok');
  } else {
    status.textContent = `Актуальная версия (${r.current})`;
    dl.classList.add('hidden');
  }
}

async function initUpdates() {
  const cfg = await window.api.getUpdateConfig();
  document.getElementById('updateAuto').checked = cfg.auto !== false;
  if (cfg.auto !== false && cfg.url) checkUpdates(true);
}

function fmtBytes(n) {
  const v = Number(n) || 0;
  if (v < 1024) return v + ' Б';
  if (v < 1024 * 1024) return (v / 1024).toFixed(1) + ' КБ';
  if (v < 1024 * 1024 * 1024) return (v / (1024 * 1024)).toFixed(1) + ' МБ';
  return (v / (1024 * 1024 * 1024)).toFixed(2) + ' ГБ';
}

async function refreshCacheInfo() {
  const el = document.getElementById('cacheInfo');
  if (!el) return;
  const r = await window.api.cacheInfo();
  if (!r.ok || !r.result) {
    el.textContent = 'Не удалось получить размер кэша';
    return;
  }
  const it = r.result.items || {};
  const names = {
    cutouts: 'вырезание',
    gifcache: 'кадры GIF',
    videocache: 'видео',
    previews: 'превью',
  };
  const parts = Object.keys(names)
    .map((k) => names[k] + ': ' + fmtBytes(it[k] || 0))
    .join(' · ');
  el.textContent = 'Всего ' + fmtBytes(r.result.total) + ' — ' + parts;
}

const PRESETS_KEY = 'psb.presets';

function loadPresets() {
  try {
    return JSON.parse(localStorage.getItem(PRESETS_KEY) || '{}') || {};
  } catch (_) {
    return {};
  }
}

function savePresets(all) {
  try {
    localStorage.setItem(PRESETS_KEY, JSON.stringify(all));
  } catch (_) {}
}

function renderPresetList(selected) {
  const sel = document.getElementById('presetList');
  if (!sel) return;
  const all = loadPresets();
  const names = Object.keys(all).sort((a, b) => a.localeCompare(b));
  sel.innerHTML = '';
  if (!names.length) {
    const o = document.createElement('option');
    o.value = '';
    o.textContent = 'Пока нет';
    sel.appendChild(o);
    return;
  }
  for (const n of names) {
    const o = document.createElement('option');
    o.value = n;
    o.textContent = n;
    sel.appendChild(o);
  }
  if (selected && names.includes(selected)) sel.value = selected;
}

function applyBgToUi(bg) {
  bg = bg || {};
  document.getElementById('bgAlpha').checked = !!bg.alphaMatting;
  document.getElementById('bgFg').value = bg.fgThreshold || 240;
  document.getElementById('bgBg').value = bg.bgThreshold || 10;
  document.getElementById('bgErode').value = bg.erode || 10;
  if (document.getElementById('bgFeather')) document.getElementById('bgFeather').value = bg.feather || 0;
  const ch = bg.chroma || {};
  document.getElementById('chromaOn').checked = !!ch.enabled;
  document.getElementById('chromaColor').value = rgbToHex(ch.r ?? 255, ch.g ?? 255, ch.b ?? 255);
  document.getElementById('chromaTol').value = ch.tol || 30;
  const sel = document.getElementById('bgModel');
  const name = bg.model || '';
  if (name) {
    if (Array.from(sel.options).some((o) => o.value === name)) sel.value = name;
    else pendingBgModel = name;
  }
}

function savePresetFromUi() {
  const name = (document.getElementById('presetName').value || '').trim();
  if (!name) {
    toast('Введи название пресета', 'err');
    return;
  }
  const all = loadPresets();
  all[name] = {
    bg: gatherBg(),
    frameWidth: parseInt(document.getElementById('frameW').value, 10) || 384,
    frameHeight: parseInt(document.getElementById('frameH').value, 10) || 416,
    consistentScale: document.getElementById('consistent').checked,
    webpMode: document.getElementById('webpMode').value,
  };
  savePresets(all);
  renderPresetList(name);
  toast('Пресет сохранён: ' + name, 'ok');
}

function applyPresetFromUi() {
  const name = document.getElementById('presetList').value;
  const p = loadPresets()[name];
  if (!p) {
    toast('Выбери пресет', 'err');
    return;
  }
  applyBgToUi(p.bg);
  if (p.frameWidth) document.getElementById('frameW').value = p.frameWidth;
  if (p.frameHeight) document.getElementById('frameH').value = p.frameHeight;
  document.getElementById('consistent').checked = p.consistentScale !== false;
  if (p.webpMode) document.getElementById('webpMode').value = p.webpMode;
  scheduleDraft();
  toast('Применён пресет: ' + name, 'ok');
}

function deletePresetFromUi() {
  const name = document.getElementById('presetList').value;
  if (!name) return;
  const all = loadPresets();
  delete all[name];
  savePresets(all);
  renderPresetList();
  toast('Пресет удалён: ' + name, 'ok');
}

function init() {
  const grid = document.getElementById('grid');
  for (const anim of ANIMS) {
    const card = renderCard(anim);
    cardByRow[anim.row] = card;
    grid.appendChild(card);
  }

  for (const b of document.querySelectorAll('.tab')) {
    b.addEventListener('click', () => switchTab(b.dataset.tab));
  }
  // Пресеты размера кадра
  const presetSel = document.getElementById('framePreset');
  const fwEl = document.getElementById('frameW');
  const fhEl = document.getElementById('frameH');
  const syncPreset = () => {
    const key = `${fwEl.value}x${fhEl.value}`;
    presetSel.value = Array.from(presetSel.options).some((o) => o.value === key) ? key : 'custom';
  };
  presetSel.addEventListener('change', () => {
    if (presetSel.value === 'custom') return;
    const [w, h] = presetSel.value.split('x').map(Number);
    fwEl.value = w;
    fhEl.value = h;
    scheduleDraft();
  });
  fwEl.addEventListener('input', syncPreset);
  fhEl.addEventListener('input', syncPreset);
  syncPreset();

  updateSlotCount();

  document.getElementById('refreshPets').addEventListener('click', loadPets);
  document.getElementById('petsOpenBundle').addEventListener('click', importBundleHandler);
  document.getElementById('petsSearch').addEventListener('input', renderPetsFiltered);

  document.getElementById('saveProjectBtn').addEventListener('click', saveProject);
  document.getElementById('bgModelDownloadBtn').addEventListener('click', downloadBgModelFromUi);
  document.getElementById('bgModelInstalled').addEventListener('change', updateInstalledModelInfo);
  document.getElementById('bgModelDeleteBtn').addEventListener('click', deleteBgModelFromUi);
  document.getElementById('bgClearCache').addEventListener('click', async () => {
    const r = await window.api.clearCutouts();
    if (r.ok) toast('Кэш вырезаний очищен: ' + ((r.result && r.result.removed) || 0), 'ok');
    else toast('Ошибка очистки кэша', 'err');
  });
  document.getElementById('bgCompareBtn').addEventListener('click', () => compareCutout(hoverRow));
  document.getElementById('cutoutClose').addEventListener('click', () =>
    document.getElementById('cutoutModal').classList.add('hidden')
  );
  document.getElementById('fillIdleBtn').addEventListener('click', fillFromIdle);
  document.getElementById('recentsClear').addEventListener('click', async () => {
    if (!recents.length) {
      toast('Недавних фото нет', '');
      return;
    }
    if (!confirm('Очистить список недавних фото?')) return;
    const r = await window.api.clearRecents();
    if (r.ok) {
      toast('Недавние фото очищены', 'ok');
      await loadRecents();
    } else {
      toast('Не удалось очистить: ' + (r.error || ''), 'err');
    }
  });
  document.getElementById('fitAllBtn').addEventListener('click', () => {
    let n = 0;
    for (const anim of ANIMS) {
      if (!paths[anim.row]) continue;
      const t = transforms[anim.row] ? JSON.parse(JSON.stringify(transforms[anim.row])) : {};
      t.scale = 1;
      t.stretchX = 1;
      t.stretchY = 1;
      t.dx = 0;
      t.dy = 0;
      delete t.crop;
      if (isDefaultTransform(t)) delete transforms[anim.row];
      else transforms[anim.row] = t;
      if (cardByRow[anim.row] && cardByRow[anim.row].updateTune) {
        cardByRow[anim.row].updateTune();
      }
      n++;
    }
    if (!n) {
      toast('Нет слотов для выравнивания', 'err');
      return;
    }
    scheduleDraft();
    commitHistory('Вписать в безопасную зону');
    toast('Вписано в безопасную зону: ' + n, 'ok');
  });
  document.getElementById('zipBtn').addEventListener('click', zipBundle);
  document.getElementById('toolsBtn').addEventListener('click', () => {
    document.getElementById('toolsModal').classList.remove('hidden');
    refreshCacheInfo();
    renderPresetList();
  });
  document.getElementById('toolsClose').addEventListener('click', () => document.getElementById('toolsModal').classList.add('hidden'));
  document.getElementById('cacheRefresh').addEventListener('click', refreshCacheInfo);
  document.getElementById('cacheClear').addEventListener('click', async () => {
    const r = await window.api.clearCache({});
    if (r.ok && r.result) toast('Очищено файлов: ' + (r.result.removed || 0), 'ok');
    else toast('Не удалось очистить кэш: ' + ((r && r.error) || ''), 'err');
    refreshCacheInfo();
  });
  document.getElementById('presetSave').addEventListener('click', savePresetFromUi);
  document.getElementById('presetApply').addEventListener('click', applyPresetFromUi);
  document.getElementById('presetDelete').addEventListener('click', deletePresetFromUi);
  document.getElementById('exportLogBtn').addEventListener('click', exportDiagnosticLog);
  document.getElementById('checkUpdateBtn').addEventListener('click', () => checkUpdates(false));
  document.getElementById('whatsNewBtn').addEventListener('click', () => showWhatsNew());
  document.getElementById('whatsNewClose').addEventListener('click', () =>
    document.getElementById('whatsNewModal').classList.add('hidden')
  );
  document.getElementById('apAutoAnim').addEventListener('click', async () => {
    if (adjustRow == null || !paths[adjustRow]) return;
    showProgress();
    const resp = await window.api.photoToGif({
      path: paths[adjustRow],
      frames: 10,
      amplitude: 3,
      maxSize: Math.max(
        parseInt(document.getElementById('frameW').value, 10) || 384,
        parseInt(document.getElementById('frameH').value, 10) || 416
      ),
    });
    hideProgress();
    if (!resp.ok || !resp.result || !resp.result.gif) {
      toast('Не удалось создать анимацию: ' + ((resp && resp.error) || ''), 'err');
      return;
    }
    const row = adjustRow;
    delete transforms[row];
    const gif = (await window.api.importFile(resp.result.gif)) || resp.result.gif;
    cardByRow[row].setPath(gif, { preserve: true });
    document.getElementById('adjustModal').classList.add('hidden');
    adjustRow = null;
    updateSlotCount();
    scheduleDraft();
    commitHistory('Автоанимация');
    toast('Автоанимация готова', 'ok');
  });
  document.getElementById('bpCancel').addEventListener('click', async () => {
    bpUpdate('Отмена…', 0);
    await window.api.cancelBuild();
  });
  for (const id of ['vidFps', 'vidSize', 'vidStart', 'vidEnd', 'vidBoom']) {
    const el = document.getElementById(id);
    el.addEventListener('input', scheduleVideoPreview);
    el.addEventListener('change', scheduleVideoPreview);
  }
  document.getElementById('vidCancel').addEventListener('click', () => closeVideoModal(null));
  document.getElementById('vidOk').addEventListener('click', () => closeVideoModal(readVideoOptsFromUi()));
  document.getElementById('downloadUpdateBtn').addEventListener('click', async (e) => {
    const url = e.currentTarget.dataset.url;
    if (!url) return;
    showProgress();
    const r = await window.api.downloadUpdate(url);
    hideProgress();
    if (!r.ok) {
      toast('Ошибка загрузки: ' + r.error, 'err');
      return;
    }
    pendingUpdatePath = r.path;
    const inst = await window.api.installUpdate(r.path);
    if (!inst.ok) toast('Не удалось запустить установщик: ' + inst.error, 'err');
  });
  document.getElementById('installUpdateBtn').addEventListener('click', async () => {
    if (!pendingUpdatePath) return;
    const r = await window.api.installUpdate(pendingUpdatePath);
    if (!r.ok) toast('Не удалось запустить установщик: ' + r.error, 'err');
  });
  const saveUpdateCfg = () =>
    window.api.setUpdateConfig({
      url: '',
      auto: document.getElementById('updateAuto').checked,
    });
  document.getElementById('updateAuto').addEventListener('change', saveUpdateCfg);
  renderAnimOptions();
  document.getElementById('resetSettingsBtn').addEventListener('click', async () => {
    if (!confirm('Сбросить настройки приложения (пресеты, историю, настройки видео) и черновик?')) return;
    try {
      localStorage.removeItem('psb.presets');
      localStorage.removeItem('psb.history');
      localStorage.removeItem('psb.videoOpts');
    } catch (_) {}
    await window.api.clearDraft();
    document.getElementById('frameW').value = 384;
    document.getElementById('frameH').value = 416;
    document.getElementById('label').value = 'My Pet';
    document.getElementById('petId').value = '';
    document.getElementById('consistent').checked = true;
    document.getElementById('snapFps').checked = true;
    document.getElementById('orcaFps').value = 8;
    document.getElementById('bgAlpha').checked = false;
    document.getElementById('bgFg').value = 240;
    document.getElementById('bgBg').value = 10;
    document.getElementById('bgErode').value = 10;
    document.getElementById('bgFeather').value = 0;
    document.getElementById('chromaOn').checked = false;
    document.getElementById('webpMode').value = 'lossless';
    document.getElementById('gifColors').value = '256';
    document.getElementById('gifMaxKb').value = 0;
    renderPresetList();
    renderHistory();
    scheduleDraft();
    toast('Настройки сброшены', 'ok');
  });
  document.getElementById('openProjectBtn').addEventListener('click', async () => {
    const r = await window.api.openProject();
    if (r.ok) await applyProject(r.project);
    else if (!r.canceled) toast('Ошибка открытия: ' + r.error, 'err');
  });

  for (const id of [
    'frameW', 'frameH', 'label', 'petId', 'consistent',
    'bgFg', 'bgBg', 'bgErode', 'bgFeather', 'chromaOn', 'chromaColor', 'chromaTol', 'webpMode',
    'gifColors', 'gifMaxKb', 'snapFps', 'orcaFps',
  ]) {
    document.getElementById(id).addEventListener('input', scheduleDraft);
    document.getElementById(id).addEventListener('change', scheduleDraft);
  }

  document.getElementById('outBtn').addEventListener('click', async () => {
    const dir = await window.api.selectDir();
    if (dir) {
      outDir = dir;
      const el = document.getElementById('outPath');
      el.textContent = dir;
      el.title = dir;
    }
  });

  window.api.onRequestSaveClose(async () => {
    const ok = await saveProject();
    if (ok) await window.api.confirmClose();
  });
  window.api.onLog(appendLog);
  window.api.onCutoutLog((line) => {
    appendLog(line);
    const modal = document.getElementById('cutoutModal');
    if (modal && !modal.classList.contains('hidden')) {
      const st = document.getElementById('cutoutStatus');
      if (st) st.textContent = line;
    }
  });

  document.getElementById('buildBtn').addEventListener('click', build);
  document.getElementById('previewBtn').addEventListener('click', openPreview);
  document.getElementById('newPetBtn').addEventListener('click', newPet);
  document.getElementById('openBundleBtn').addEventListener('click', () => {
    if (lastBundle) window.api.openDir(lastBundle);
  });
  document.getElementById('copyBundleBtn').addEventListener('click', async () => {
    if (lastBundle) {
      await window.api.copyText(lastBundle);
      toast('Путь скопирован: ' + lastBundle, 'ok');
    }
  });
  document.getElementById('undoBtn').addEventListener('click', undo);
  document.getElementById('redoBtn').addEventListener('click', redo);

  window.addEventListener('keydown', (e) => {
    const tag = (e.target && e.target.tagName ? e.target.tagName : '').toLowerCase();
    const typing = tag === 'input' || tag === 'textarea' || tag === 'select';
    if ((e.ctrlKey || e.metaKey) && (e.key === 'v' || e.key === 'V')) {
      if (typing) return;
      e.preventDefault();
      pasteInto(hoverRow == null ? firstEmptyRow() : hoverRow);
    } else if ((e.ctrlKey || e.metaKey) && (e.key === 'z' || e.key === 'Z')) {
      if (typing) return;
      e.preventDefault();
      if (e.shiftKey) redo();
      else undo();
    } else if ((e.ctrlKey || e.metaKey) && (e.key === 'y' || e.key === 'Y')) {
      if (typing) return;
      e.preventDefault();
      redo();
    } else if ((e.ctrlKey || e.metaKey) && (e.key === 'n' || e.key === 'N')) {
      e.preventDefault();
      newPet();
    } else if ((e.ctrlKey || e.metaKey) && (e.key === 's' || e.key === 'S')) {
      e.preventDefault();
      saveProject();
    } else if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
      e.preventDefault();
      build();
    }
  });

  // Модалка настройки
  for (const id of ['apScale', 'apFlip']) {
    document.getElementById(id).addEventListener('input', updateAdjustPreview);
  }
  document.getElementById('apSave').addEventListener('click', saveAdjust);
  const closeAdjust = () => {
    stopAdjustAnim();
    document.getElementById('adjustModal').classList.add('hidden');
    adjustRow = null;
  };
  document.getElementById('apCancel').addEventListener('click', closeAdjust);
  document.getElementById('apBeforeAfter').addEventListener('click', async () => {
    if (adjustRow == null || !paths[adjustRow]) return;
    const btn = document.getElementById('apBeforeAfter');
    if (adjustShowCutout) {
      document.getElementById('apImg').src = toFileUrl(paths[adjustRow]);
      adjustShowCutout = false;
      btn.textContent = 'Показать «после»';
      return;
    }
    showProgress();
    const resp = await window.api.cutoutPreview({
      path: paths[adjustRow],
      bg: gatherBg(),
    });
    hideProgress();
    if (!resp.ok || !resp.result) {
      toast('Не удалось вырезать фон: ' + ((resp && resp.error) || ''), 'err');
      return;
    }
    adjustCutoutSrc = resp.result.cutout;
    document.getElementById('apImg').src = toFileUrl(adjustCutoutSrc);
    adjustShowCutout = true;
    btn.textContent = 'Показать оригинал';
    if (isAnimatedPath(paths[adjustRow])) toast('Для GIF показан первый кадр', '');
  });
  document.getElementById('apCloseX').addEventListener('click', closeAdjust);
  document.getElementById('apReset').addEventListener('click', () => {
    document.getElementById('apScale').value = 100;
    adjustDx = 0;
    adjustDy = 0;
    adjustSX = 1;
    adjustSY = 1;
    document.getElementById('apFlip').checked = false;
    adjustRotate = 0;
    document.getElementById('apRotateVal').textContent = '0°';
    document.getElementById('apSpeed').value = 1;
    document.getElementById('apSpeedVal').textContent = '1×';
    document.getElementById('apPingpong').checked = false;
    document.getElementById('apStill').checked = true;
    document.getElementById('apGifRock').checked = true;
    setCropInputs(null);
    gifCandidates = [];
    renderGifFramesEditor();
    const key = animKeyForRow(adjustRow);
    if (key) {
      delete animOptions[key];
    }
    updateAdjustPreview();
  });
  document.getElementById('apSpeed').addEventListener('input', () => {
    const v = parseFloat(document.getElementById('apSpeed').value) || 1;
    document.getElementById('apSpeedVal').textContent = v + '×';
    const key = animKeyForRow(adjustRow);
    if (key) {
      animOptions[key] = { ...(animOptions[key] || {}), speed: v };
      scheduleDraft();
    }
    adjustAnim.t0 = performance.now();
  });
  document.getElementById('apPingpong').addEventListener('change', () => {
    const key = animKeyForRow(adjustRow);
    if (key) {
      animOptions[key] = {
        ...(animOptions[key] || {}),
        pingpong: document.getElementById('apPingpong').checked,
      };
      scheduleDraft();
    }
  });
  document.getElementById('apStill').addEventListener('change', () => {
    updateAdjustPreview();
    scheduleDraft();
  });
  document.getElementById('apGifRock').addEventListener('change', updateAdjustPreview);
  document.getElementById('apGifLoad').addEventListener('click', () => {
    if (adjustRow != null) loadGifFramesForRow(adjustRow);
  });
  document.getElementById('apSafe').addEventListener('change', () => {
    document.getElementById('apSafeZone').classList.toggle(
      'hidden',
      !document.getElementById('apSafe').checked
    );
  });
  for (const id of ['apGifRock', 'apChroma', 'apChromaColor', 'apChromaTol']) {
    document.getElementById(id).addEventListener('input', scheduleDraft);
    document.getElementById(id).addEventListener('change', scheduleDraft);
  }

  // Перетаскивание и изменение размера фото внутри кадра
  const apFrame = document.getElementById('apFrame');
  const apScaleEl = document.getElementById('apScale');
  const RESIZE_EDGE = 14;
  let apDrag = null;

  function resizeEdgesAt(e) {
    const img = document.getElementById('apImg');
    const r = img.getBoundingClientRect();
    if (!r.width || !r.height) return null;
    const l = Math.abs(e.clientX - r.left) <= RESIZE_EDGE;
    const rr = Math.abs(e.clientX - r.right) <= RESIZE_EDGE;
    const t = Math.abs(e.clientY - r.top) <= RESIZE_EDGE;
    const b = Math.abs(e.clientY - r.bottom) <= RESIZE_EDGE;
    if (!(l || rr || t || b)) return null;
    if (e.clientX < r.left - RESIZE_EDGE || e.clientX > r.right + RESIZE_EDGE) return null;
    if (e.clientY < r.top - RESIZE_EDGE || e.clientY > r.bottom + RESIZE_EDGE) return null;
    return { l, r: rr, t, b };
  }

  function resizeCursor(m) {
    const horiz = m.l || m.r;
    const vert = m.t || m.b;
    if (horiz && vert) return (m.l && m.t) || (m.r && m.b) ? 'nwse-resize' : 'nesw-resize';
    if (horiz) return 'ew-resize';
    return 'ns-resize';
  }

  apFrame.addEventListener(
    'wheel',
    (e) => {
      if (adjustRow == null) return;
      e.preventDefault();
      const f = e.deltaY < 0 ? 1.12 : 1 / 1.12;
      apZoom = Math.min(5, Math.max(1, apZoom * f));
      updateApView();
    },
    { passive: false }
  );

  window.addEventListener(
    'keydown',
    (e) => {
      const modal = document.getElementById('adjustModal');
      if (!modal || modal.classList.contains('hidden') || adjustRow == null) return;
      if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(e.key)) return;
      e.preventDefault();
      e.stopPropagation();
    const W = apFrame.clientWidth || 1;
    const H = apFrame.clientHeight || 1;
    const step = e.shiftKey ? 10 : 1;
    if (e.key === 'ArrowLeft') adjustDx -= step / W;
    else if (e.key === 'ArrowRight') adjustDx += step / W;
    else if (e.key === 'ArrowUp') adjustDy -= step / H;
    else if (e.key === 'ArrowDown') adjustDy += step / H;
      updateAdjustPreview();
      scheduleDraft();
    },
    true
  );

  apFrame.addEventListener('pointerdown', (e) => {
    if (!adjustRow && adjustRow !== 0) return;
    e.preventDefault();
    try {
      apFrame.setPointerCapture(e.pointerId);
    } catch (_) {}
    if (e.button === 1) {
      apDrag = { mode: 'pan', x: e.clientX, y: e.clientY, px: apPanX, py: apPanY };
      apFrame.classList.add('dragging');
      return;
    }
    const edges = resizeEdgesAt(e);
    if (edges) {
      const img = document.getElementById('apImg');
      const r = img.getBoundingClientRect();
      apDrag = {
        mode: 'resize',
        edges,
        x: e.clientX,
        y: e.clientY,
        w0: Math.max(8, r.width),
        h0: Math.max(8, r.height),
        sx0: adjustSX,
        sy0: adjustSY,
      };
      apFrame.style.cursor = resizeCursor(edges);
    } else {
      apDrag = { mode: 'move', x: e.clientX, y: e.clientY, dx: adjustDx, dy: adjustDy };
      apFrame.classList.add('dragging');
    }
  });

  apFrame.addEventListener('pointermove', (e) => {
    if (!apDrag) {
      const edges = resizeEdgesAt(e);
      apFrame.style.cursor = edges ? resizeCursor(edges) : 'grab';
      return;
    }
    if (apDrag.mode === 'pan') {
      apPanX = apDrag.px + (e.clientX - apDrag.x);
      apPanY = apDrag.py + (e.clientY - apDrag.y);
      updateApView();
      return;
    }
    if (apDrag.mode === 'resize') {
      const dx = e.clientX - apDrag.x;
      const dy = e.clientY - apDrag.y;
      const dxEff = apDrag.edges.r ? dx : apDrag.edges.l ? -dx : dx;
      const dyEff = apDrag.edges.b ? dy : apDrag.edges.t ? -dy : dy;
      const canX = apDrag.edges.l || apDrag.edges.r;
      const canY = apDrag.edges.t || apDrag.edges.b;
      if (canX) {
        const fx = 1 + (2 * dxEff) / apDrag.w0;
        adjustSX = Math.min(5, Math.max(0.1, apDrag.sx0 * fx));
      }
      if (canY) {
        const fy = 1 + dyEff / apDrag.h0;
        adjustSY = Math.min(5, Math.max(0.1, apDrag.sy0 * fy));
      }
      updateAdjustPreview();
      return;
    }
    const W = apFrame.clientWidth;
    const H = apFrame.clientHeight;
    adjustDx = apDrag.dx + (e.clientX - apDrag.x) / W;
    adjustDy = apDrag.dy + (e.clientY - apDrag.y) / H;
    updateAdjustPreview();
  });

  apFrame.addEventListener('pointerleave', () => {
    if (!apDrag) apFrame.style.cursor = 'grab';
  });

  const apEndDrag = () => {
    if (!apDrag) return;
    apDrag = null;
    apFrame.classList.remove('dragging');
    apFrame.style.cursor = 'grab';
  };
  apFrame.addEventListener('pointerup', apEndDrag);
  apFrame.addEventListener('pointercancel', apEndDrag);
  document.getElementById('apAnchor').addEventListener('change', () => {
    updateAdjustPreview();
    scheduleDraft();
  });
  document.getElementById('apRotate').addEventListener('click', () => {
    adjustRotate = (adjustRotate + 90) % 360;
    document.getElementById('apRotateVal').textContent = adjustRotate + '°';
    updateAdjustPreview();
  });

  // Модалка предпросмотра
  document.getElementById('pvClose').addEventListener('click', closePreview);
  document.getElementById('pvPlay').addEventListener('click', () => {
    if (!pv) return;
    pv.playing = !pv.playing;
    document.getElementById('pvPlay').textContent = pv.playing ? 'Пауза' : 'Продолжить';
    if (pv.playing) pvTick();
    else pvStop();
  });
  document.getElementById('pvAnim').addEventListener('change', (e) => {
    if (!pv) return;
    pvStop();
    pv.animName = e.target.value;
    pv.frameIndex = 0;
    pv.playing = true;
    document.getElementById('pvPlay').textContent = 'Пауза';
    pvTick();
  });
  document.getElementById('pvBg').addEventListener('change', applyPvBg);
  document.getElementById('pvGrid').addEventListener('change', () => {
    document
      .getElementById('pvFrameLine')
      .classList.toggle('show', document.getElementById('pvGrid').checked);
  });
  document.getElementById('pvOrca').addEventListener('click', () => {
    pvOrcaMode = !pvOrcaMode;
    document.getElementById('pvOrca').classList.toggle('active', pvOrcaMode);
    document.getElementById('pvStage').classList.toggle('orca-mode', pvOrcaMode);
    if (pv) pvRenderFrame();
  });
  document.getElementById('pvOverlay').addEventListener('click', async () => {
    if (!pv) {
      toast('Сначала открой предпросмотр', 'err');
      return;
    }
    const m = pv.meta;
    const r = await window.api.showOverlay({
      previewPath: m.previewPath,
      frameWidth: m.frameWidth,
      frameHeight: m.frameHeight,
      sheetWidth: m.sheetWidth,
      sheetHeight: m.sheetHeight,
      animations: m.animations,
      animation: pv.animName,
      defaultAnimation: m.defaultAnimation,
      petSize: petSize || m.frameHeight,
    });
    if (!r.ok) toast('Не удалось открыть оверлей: ' + (r.error || ''), 'err');
    else toast('Оверлей открыт (крестик в углу — закрыть)', 'ok');
  });
  document.getElementById('pvEstimate').addEventListener('click', async () => {
    if (!pv) {
      toast('Сначала открой предпросмотр', 'err');
      return;
    }
    const el = document.getElementById('pvSizes');
    el.textContent = 'Считаю размер…';
    bpStart(Object.keys(paths).length);
    showProgress();
    const r = await window.api.estimate(gatherPayload());
    hideProgress();
    if (!r.ok || !r.result) {
      el.textContent = 'Не удалось оценить: ' + ((r && r.error) || '');
      return;
    }
    const res = r.result;
    const gifParts = Object.keys(res.gifs || {})
      .map((k) => k + ': ' + fmtBytes(res.gifs[k]))
      .join(', ');
    el.textContent =
      'WebP ~' + fmtBytes(res.webpBytes) +
      ' · PNG ~' + fmtBytes(res.pngBytes) +
      (gifParts ? ' · GIF: ' + gifParts : '');
  });
  document.getElementById('pvGif').addEventListener('click', () => exportAnim('gif'));
  document.getElementById('pvApng').addEventListener('click', () => exportAnim('apng'));

  loadRecents();
  updatePasteButtons();
  renderHistory();
  renderStatesChecklist();
  initUpdates();
  (async () => {
    const info = await window.api.appInfo();
    if (info && info.version) {
      const seen = localStorage.getItem('psb.seenVersion');
      if (seen !== info.version) {
        showWhatsNew();
        localStorage.setItem('psb.seenVersion', info.version);
      }
    }
  })();
  (async () => {
    const r = await window.api.listPets();
    if (r.ok && r.result && typeof r.result.petSize === 'number') petSize = r.result.petSize;
  })();

  // Модели + черновик
  (async () => {
    await loadBgModels();
    const d = await window.api.loadDraft();
    if (d && d.rows && Object.keys(d.rows).length) {
      await applyProject(d, { silent: true });
      toast('Восстановлен несохранённый черновик', 'ok');
    }
    window.api.setDirty(false);
    historyReset();
  })();
}

function validatePetMeta() {
  const label = (document.getElementById('label').value || '').trim();
  if (!label) return 'Укажи имя питомца';
  if (label.length > 60) return 'Имя слишком длинное (максимум 60 символов)';
  if (/[<>:"/\|?* -]/.test(label)) {
    return 'Имя содержит недопустимые символы: < > : " / \ | ? *';
  }
  const id = (document.getElementById('petId').value || '').trim();
  if (id) {
    if (!/^[0-9a-fA-F-]{8,64}$/.test(id)) {
      return 'ID должен содержать только латиницу, цифры и дефис (UUID)';
    }
  }
  return null;
}

async function build() {
  const metaErr = validatePetMeta();
  if (metaErr) {
    toast(metaErr, 'err');
    appendLog('Проверка имени/ID: ' + metaErr);
    return;
  }
  if (!hasBuildable()) {
    toast('Добавь фото хотя бы для одной включённой анимации', 'err');
    return;
  }

  const payload = gatherPayload();
  if (!payload.frameWidth || !payload.frameHeight || payload.frameWidth < 16 || payload.frameHeight < 16) {
    toast('Некорректный размер кадра', 'err');
    return;
  }

  const btn = document.getElementById('buildBtn');
  btn.disabled = true;
  btn.textContent = 'Собираю…';
  bpStart(Object.keys(paths).length);
  showProgress();
  setLog('Запуск бэкенда…');

  try {
    const resp = await window.api.build(payload);
    if (!resp.ok) {
      if (/отмен/i.test(resp.error || '')) {
        toast('Сборка отменена', '');
        appendLog('Сборка отменена');
      } else {
        toast('Ошибка сборки', 'err');
        appendLog(resp.error || 'неизвестная ошибка');
      }
    } else if (resp.result && resp.result.error) {
      toast('Ошибка сборки', 'err');
      appendLog(resp.result.error);
    } else {
      const r = resp.result || {};
      appendLog('Готово: ' + (r.bundle || r.png || ''));
      if (r.bundle) {
        lastBundle = r.bundle;
        const lb = document.getElementById('lastBundle');
        lb.textContent = r.bundle;
        lb.title = r.bundle;
        document.getElementById('openBundleBtn').classList.remove('hidden');
        document.getElementById('copyBundleBtn').classList.remove('hidden');
        document.getElementById('zipBtn').classList.remove('hidden');
  document.getElementById('zipBtn').classList.remove('hidden');
      }
      const warns = r.warnings || [];
      if (warns.length) appendLog('Предупреждения:\n' + warns.join('\n'));
      if (r.sizeBytes) appendLog('WebP: ' + (r.sizeBytes / 1024 / 1024).toFixed(2) + ' МБ');
      if (r.validationErrors && r.validationErrors.length) {
        appendLog('Проверка bundle:\n' + r.validationErrors.join('\n'));
        toast('Bundle не прошёл проверку Orca (см. журнал)', 'err');
      }
      const msg = r.bundle
        ? `Bundle: ${r.bundle}\nИмпортируй папку в Orca (Import custom pet).`
        : 'Готово: спрайт сохранён';
      toast(warns.length ? msg + '\nЕсть предупреждения (см. журнал).' : msg, warns.length ? 'err' : 'ok');
    }
  } catch (e) {
    toast('Ошибка', 'err');
    appendLog(String(e));
  } finally {
    hideProgress();
    btn.disabled = false;
    btn.textContent = 'Собрать';
  }
}

window.addEventListener('DOMContentLoaded', init);
