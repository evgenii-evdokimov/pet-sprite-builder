import os
import sys
import json
import math
import time
import uuid
import hashlib
import sqlite3
import argparse
import tempfile

from PIL import Image, ImageFilter

# rembg/onnxruntime тяжёлые и нужны только при сборке: импортируем лениво,
# чтобы вкладка «Питомцы» и действия открывались быстро.

COLS = 8
ROWS = 9
MAX_ROT_DEG = 2.0
MAX_ROT = math.radians(MAX_ROT_DEG)
COS, SIN = math.cos(MAX_ROT), math.sin(MAX_ROT)

DEFAULT_DB = r"C:\Users\zheny\AppData\Roaming\orca\profiles\local-default\profile-state.db"
DEFAULT_PET_ROOT = r"C:\Users\zheny\AppData\Roaming\orca\sidekicks\custom"


def dur(frames, frame_ms, final_ms):
    return [frame_ms] * (frames - 1) + [final_ms]


ANIMATIONS = {
    "idle": {"row": 0, "frames": 6, "dur": [1680, 660, 660, 840, 840, 1920]},
    "running-right": {"row": 1, "frames": 8, "dur": dur(8, 120, 220)},
    "running-left": {"row": 2, "frames": 8, "dur": dur(8, 120, 220)},
    "waving": {"row": 3, "frames": 4, "dur": dur(4, 140, 280)},
    "jumping": {"row": 4, "frames": 5, "dur": dur(5, 140, 280)},
    "failed": {"row": 5, "frames": 8, "dur": dur(8, 140, 240)},
    "waiting": {"row": 6, "frames": 6, "dur": dur(6, 150, 260)},
    "running": {"row": 7, "frames": 6, "dur": dur(6, 120, 220)},
    "review": {"row": 8, "frames": 6, "dur": dur(6, 150, 280)},
}


def log(msg):
    try:
        sys.stderr.buffer.write((str(msg) + "\n").encode("utf-8"))
        sys.stderr.buffer.flush()
    except Exception:
        try:
            print(msg, file=sys.stderr, flush=True)
        except Exception:
            pass


def fit_rotated(im, max_w, max_h):
    s = min(
        max_w / (im.width * COS + im.height * SIN),
        max_h / (im.height * COS + im.width * SIN),
    )
    return im.resize(
        (max(1, int(im.width * s)), max(1, int(im.height * s))), Image.LANCZOS
    )


def fit_height(im, max_w, max_h, frac=0.90):
    """Масштаб по высоте, чтобы все позы были одного размера."""
    s = (max_h * frac) / im.height
    w_rot = (im.width * COS + im.height * SIN) * s
    h_rot = (im.height * COS + im.width * SIN) * s
    if w_rot > max_w:
        s *= max_w / w_rot
    if h_rot > max_h:
        s *= max_h / h_rot
    return im.resize(
        (max(1, int(im.width * s)), max(1, int(im.height * s))), Image.LANCZOS
    )


def cutout_cache_path(path, extra=""):
    import hashlib

    st = os.stat(path)
    key = hashlib.sha256(
        f"{os.path.abspath(path)}|{st.st_mtime_ns}|{st.st_size}|{extra}".encode("utf-8")
    ).hexdigest()[:20]
    base = os.environ.get("LOCALAPPDATA") or tempfile.gettempdir()
    d = os.path.join(base, "PetSpriteBuilder", "cutouts")
    os.makedirs(d, exist_ok=True)
    return os.path.join(d, key + ".png")


def ensure_rembg_pkg():
    """Регистрирует пакет rembg без выполнения тяжёлого __init__ (pymatting/numba)."""
    import importlib.util
    import types

    if "rembg" in sys.modules:
        return
    spec = importlib.util.find_spec("rembg")
    pkg = types.ModuleType("rembg")
    pkg.__path__ = list(getattr(spec, "submodule_search_locations", None) or [])
    pkg.__package__ = "rembg"
    sys.modules["rembg"] = pkg


def downloadable_bg_models():
    try:
        ensure_rembg_pkg()
        from rembg.sessions import sessions_class

        out = []
        for cls in sessions_class:
            try:
                if cls.requires_credentials():
                    continue
                name = cls.name()
            except Exception:
                continue
            if name.endswith("_custom") or name == "dis_custom":
                continue
            out.append(name)
        return sorted(set(out))
    except Exception as e:
        log(f"downloadable_bg_models: {e!r}")
        return []


def _repair_permissions(path):
    """Пытается вернуть доступ к папке после прерванной загрузки."""
    import subprocess as _sp

    flags = getattr(_sp, "CREATE_NO_WINDOW", 0)
    user = os.environ.get("USERNAME") or ""
    cmds = [
        ["takeown", "/f", path, "/r", "/d", "y"],
        ["icacls", path, "/reset", "/T", "/C"],
    ]
    if user:
        cmds.append(["icacls", path, "/grant", f"{user}:(OI)(CI)F", "/T", "/C"])
    for cmd in cmds:
        try:
            _sp.run(cmd, capture_output=True, creationflags=flags, timeout=120)
        except Exception:
            pass


def _ensure_writable_dir(path):
    try:
        os.makedirs(path, exist_ok=True)
    except OSError:
        log(f"Папка {path} недоступна, восстанавливаю права…")
        _repair_permissions(path)
        try:
            import shutil as _shutil

            if os.path.isdir(path):
                _shutil.rmtree(path, ignore_errors=True)
        except Exception:
            pass
        time.sleep(0.4)
        os.makedirs(path, exist_ok=True)
    probe = os.path.join(path, ".write-test")
    try:
        with open(probe, "w", encoding="utf-8") as f:
            f.write("ok")
        os.remove(probe)
    except OSError:
        _repair_permissions(path)
        time.sleep(0.4)
        with open(probe, "w", encoding="utf-8") as f:
            f.write("ok")
        os.remove(probe)


def download_bg_model(payload):
    name = (payload.get("model") or "").strip()
    if not name:
        raise RuntimeError("Не указана модель")
    ensure_rembg_pkg()
    from rembg.session_factory import new_session

    base = models_dir()
    target = os.path.join(base, name)

    def prepare():
        os.makedirs(base, exist_ok=True)
        _ensure_writable_dir(target)

    try:
        prepare()
    except Exception as e:
        raise RuntimeError(
            f"Нет доступа к папке модели {target}: {e}. "
            "Закрой программу, удали эту папку и попробуй снова."
        )

    log(f"Скачивание модели «{name}»…")
    try:
        new_session(name)
    except PermissionError:
        # Иногда папка осталась с неверными правами от прерванной загрузки.
        try:
            import shutil as _shutil

            if os.path.isdir(target) and not os.listdir(target):
                _shutil.rmtree(target, ignore_errors=True)
            prepare()
            new_session(name)
        except Exception as e:
            raise RuntimeError(
                f"Не удалось скачать модель «{name}»: {e}. "
                f"Удалите папку {target} и попробуйте снова."
            )
    log(f"Модель «{name}» готова")
    return {"model": name}


def new_rembg_session(model=""):
    """Создаёт сессию rembg без импорта rembg.bg (pymatting → numba).

    Импорт `rembg` целиком тянет pymatting/scipy/numba и в замороженной сборке
    может компилироваться несколько минут. Для обычного вырезания (без alpha
    matting) достаточно session_factory — он лёгкий.
    """
    ensure_rembg_pkg()
    from rembg.session_factory import new_session

    return new_session() if not model else new_session(model)


def remove_bg_fast(im, session, bg):
    """Вырезание фона: быстрый путь без pymatting, alpha matting при включении."""
    bg = bg or {}
    alpha = bool(bg.get("alphaMatting"))
    fg = int(bg.get("fgThreshold") or 240)
    bgt = int(bg.get("bgThreshold") or 10)
    erode = int(bg.get("erode") or 10)
    if alpha:
        from rembg.bg import remove

        return remove(
            im,
            session=session,
            alpha_matting=True,
            alpha_matting_foreground_threshold=fg,
            alpha_matting_background_threshold=bgt,
            alpha_matting_erode_size=erode,
        )
    from PIL import ImageOps

    img = ImageOps.exif_transpose(im).convert("RGBA")
    masks = session.predict(img)
    feather = int(bg.get("feather") or 0)
    cutouts = []
    for mask in masks or []:
        if feather > 0:
            from PIL import ImageFilter

            mask = mask.filter(ImageFilter.GaussianBlur(radius=min(6, feather)))
        empty = Image.new("RGBA", img.size, 0)
        cutouts.append(Image.composite(img, empty, mask))
    if not cutouts:
        return img
    if len(cutouts) == 1:
        return cutouts[0]
    w = max(c.width for c in cutouts)
    h = sum(c.height for c in cutouts)
    res = Image.new("RGBA", (w, h), (0, 0, 0, 0))
    y = 0
    for c in cutouts:
        res.paste(c, (0, y))
        y += c.height
    return res


def smooth_masks(masks, alpha=0.55):
    """Временное сглаживание масок: убирает дрожание вырезания между кадрами."""
    import numpy as np

    out = []
    prev = None
    for m in masks:
        cur = np.asarray(m.convert("L"), dtype=np.float32)
        if prev is None:
            merged = cur
        else:
            merged = alpha * cur + (1.0 - alpha) * prev
        prev = merged
        out.append(merged.clip(0, 255).astype("uint8"))
    return out


def composite_mask(img, mask_arr):
    from PIL import Image as _Image

    empty = _Image.new("RGBA", img.size, 0)
    mask = _Image.fromarray(mask_arr, "L")
    return _Image.composite(img, empty, mask)


def snap_to_fps(durs, fps):
    """Округляет длительности кадров до кратных 1000/fps (тики Orca)."""
    try:
        fps = int(fps or 0)
    except (TypeError, ValueError):
        fps = 0
    if fps <= 0:
        return [max(20, int(d)) for d in durs]
    tick = 1000.0 / fps
    out = []
    for d in durs:
        n = max(1, int(round(float(d) / tick)))
        out.append(max(20, int(round(n * tick))))
    return out


def prepare(path, frame_w, frame_h, consistent=False, scale=1.0, session_box=None, bg=None, rotate=0, crop=None, stretch_x=1.0, stretch_y=1.0):
    bg = bg or {}
    model = bg.get("model") or ""
    alpha = bool(bg.get("alphaMatting"))
    fg = int(bg.get("fgThreshold") or 240)
    bgt = int(bg.get("bgThreshold") or 10)
    erode = int(bg.get("erode") or 10)
    feather = int(bg.get("feather") or 0)
    extra = f"{model or 'default'}|{int(alpha)}|{fg}|{bgt}|{erode}|{feather}"
    cached = cutout_cache_path(path, extra)
    if os.path.exists(cached):
        im = Image.open(cached).convert("RGBA")
    else:
        session = None
        if session_box is not None:
            sessions = session_box.setdefault("sessions", {})
            skey = model or "__default__"
            if skey not in sessions:
                log(f"Загрузка модели вырезания фона ({model or 'default'})…")
                sessions[skey] = new_rembg_session(model)
            session = sessions[skey]
        else:
            session = new_rembg_session(model)
        im = remove_bg_fast(
            Image.open(path).convert("RGBA"),
            session,
            bg,
        )
        try:
            im.save(cached, "PNG")
        except Exception as e:
            import traceback
            log(f"cutout cache {path} -> {cached}: {e!r} | {traceback.format_exc()}")
    bbox = im.getbbox()
    if bbox:
        im = im.crop(bbox)
    im = apply_crop(im, crop)
    rotate = int(rotate or 0) % 360
    if rotate:
        im = im.rotate(-rotate, expand=True, resample=Image.BICUBIC)
    if consistent:
        im = fit_height(im, frame_w * 0.92, frame_h * 0.92)
    else:
        im = fit_rotated(im, frame_w * 0.92, frame_h * 0.92)
    if abs(scale - 1.0) > 1e-3:
        im = im.resize(
            (max(1, int(im.width * scale)), max(1, int(im.height * scale))),
            Image.LANCZOS,
        )
    if abs(stretch_x - 1.0) > 1e-3 or abs(stretch_y - 1.0) > 1e-3:
        im = im.resize(
            (max(1, int(im.width * stretch_x)), max(1, int(im.height * stretch_y))),
            Image.LANCZOS,
        )
    r, g, b, a = im.split()
    rgb = Image.merge("RGB", (r, g, b)).filter(
        ImageFilter.UnsharpMask(radius=1.2, percent=60, threshold=2)
    )
    return Image.merge("RGBA", (*rgb.split(), a))


def build_sheet(
    row_to_path,
    frame_w,
    frame_h,
    transforms=None,
    consistent=False,
    bg=None,
    disabled=None,
    anim_options=None,
    snap_fps=0,
):
    transforms = transforms or {}
    disabled = set(disabled or [])
    sheet = Image.new("RGBA", (frame_w * COLS, frame_h * ROWS), (0, 0, 0, 0))
    cache = {}
    session_box = {"sessions": {}}
    animations = {}

    for name, spec in ANIMATIONS.items():
        if name in disabled:
            continue
        row, frames = spec["row"], spec["frames"]
        t = transforms.get(row) or transforms.get(str(row)) or {}
        still = bool(t.get("still"))
        if still:
            frames = 1
        p = row_to_path.get(row) or row_to_path.get(str(row))
        auto_flip = False
        if p is None and name == "running-left":
            p = row_to_path.get(1) or row_to_path.get("1")
            auto_flip = p is not None
        if not p or not os.path.exists(p):
            continue

        flip = bool(t.get("flip")) ^ auto_flip
        log(f"Обработка {name}…")

        animated = load_animated(p)
        if animated:
            gframes, gdurs = animated
            picked = t.get("gifFrames")
            if isinstance(picked, list) and picked:
                gframes, gdurs = gif_frames_at(p, picked[:COLS])
            opt = (anim_options or {}).get(name) or {}
            try:
                gspeed = float(opt.get("speed") or 1)
            except (TypeError, ValueError):
                gspeed = 1
            if gspeed <= 0:
                gspeed = 1
            gdurs = [max(40, int(max(120, d) / gspeed)) for d in gdurs]
            custom_durs = t.get("gifDurs")
            if isinstance(custom_durs, list) and len(custom_durs) == len(gframes):
                gdurs = [max(40, int(x)) for x in custom_durs]
            gdurs = snap_to_fps(gdurs, snap_fps)
            if flip:
                gframes = [f.transpose(Image.FLIP_LEFT_RIGHT) for f in gframes]
            chroma = t.get("chroma") or (bg or {}).get("chroma")
            row_t = time.time()
            anchor = t.get("anchor") or "bottom"
            rock = t.get("rock", True)
            crop = t.get("crop")
            gscale = float(t.get("scale") or 1.0)
            gsx = float(t.get("stretchX") or 1.0)
            gsy = float(t.get("stretchY") or 1.0)
            gtx = float(t.get("dx") or 0.0) * frame_w
            gty = float(t.get("dy") or 0.0) * frame_h
            total = max(1, len(gframes))
            for i, fr in enumerate(gframes):
                fr2 = fit_plain(
                    apply_crop(apply_chroma(fr.convert("RGBA"), chroma), crop),
                    frame_w,
                    frame_h,
                )
                if abs(gscale - 1.0) > 1e-3 or abs(gsx - 1.0) > 1e-3 or abs(gsy - 1.0) > 1e-3:
                    fr2 = fr2.resize(
                        (
                            max(1, int(fr2.width * gscale * gsx)),
                            max(1, int(fr2.height * gscale * gsy)),
                        ),
                        Image.LANCZOS,
                    )
                bob = 0
                if rock:
                    ph = 2 * math.pi * i / total
                    rot = MAX_ROT_DEG * math.sin(ph)
                    bob = round(2.0 * math.sin(ph))
                    if rot:
                        fr2 = fr2.rotate(rot, resample=Image.BICUBIC, expand=True)
                cell = Image.new("RGBA", (frame_w, frame_h), (0, 0, 0, 0))
                px = (frame_w - fr2.width) // 2 + round(gtx)
                if anchor == "center":
                    py = (frame_h - fr2.height) // 2 + bob + round(gty)
                elif anchor == "top":
                    py = 2 + bob + round(gty)
                else:
                    py = frame_h - fr2.height - 2 + bob + round(gty)
                cell.paste(fr2, (px, py), fr2)
                sheet.alpha_composite(cell, (i * frame_w, row * frame_h))
            animations[name] = {
                "row": row,
                "frames": len(gframes),
                "frameDurationsMs": gdurs,
            }
            log(f"{name}: {len(gframes)} кадров, {round(time.time() - row_t, 1)} с")
            continue

        scale = float(t.get("scale") or 1.0)
        stretch_x = float(t.get("stretchX") or 1.0)
        stretch_y = float(t.get("stretchY") or 1.0)
        rotate = int(t.get("rotate") or 0) % 360
        tx = float(t.get("dx") or 0.0) * frame_w
        ty = float(t.get("dy") or 0.0) * frame_h
        manual = (
            abs(scale - 1.0) > 1e-3
            or abs(stretch_x - 1.0) > 1e-3
            or abs(stretch_y - 1.0) > 1e-3
            or abs(tx) > 0.5
            or abs(ty) > 0.5
            or rotate != 0
        )
        anchor = t.get("anchor") or "bottom"
        row_t = time.time()

        crop = t.get("crop")
        key = (
            p,
            flip,
            consistent,
            round(scale, 3),
            round(stretch_x, 3),
            round(stretch_y, 3),
            rotate,
            (bg or {}).get("model"),
            bool((bg or {}).get("alphaMatting")),
            (bg or {}).get("fgThreshold"),
            (bg or {}).get("bgThreshold"),
            (bg or {}).get("erode"),
            str(crop),
        )
        if key not in cache:
            im = prepare(p, frame_w, frame_h, consistent, scale, session_box, bg, rotate, crop, stretch_x, stretch_y)
            if flip:
                im = im.transpose(Image.FLIP_LEFT_RIGHT)
            cache[key] = im
        base = cache[key]

        for i in range(frames):
            ph = 2 * math.pi * i / frames
            rot = MAX_ROT_DEG * math.sin(ph)
            bob = round(2.0 * math.sin(ph))
            im_rot = (
                base.rotate(rot, resample=Image.BICUBIC, expand=True) if rot != 0 else base
            )
            if not manual and (im_rot.width > frame_w or im_rot.height > frame_h):
                k = min(frame_w / im_rot.width, frame_h / im_rot.height)
                im_rot = im_rot.resize(
                    (max(1, int(im_rot.width * k)), max(1, int(im_rot.height * k))),
                    Image.LANCZOS,
                )
            cell = Image.new("RGBA", (frame_w, frame_h), (0, 0, 0, 0))
            px = (frame_w - im_rot.width) // 2 + round(tx)
            if anchor == "center":
                py = (frame_h - im_rot.height) // 2 + bob + round(ty)
            elif anchor == "top":
                py = 2 + bob + round(ty)
            else:
                py = frame_h - im_rot.height - 2 + bob + round(ty)
            if not manual:
                px = max(0, min(px, frame_w - im_rot.width))
                py = max(0, min(py, frame_h - im_rot.height))
            cell.paste(im_rot, (px, py), im_rot)
            sheet.alpha_composite(cell, (i * frame_w, row * frame_h))

        animations[name] = {
            "row": row,
            "frames": frames,
            "frameDurationsMs": snap_to_fps(
                anim_durations(name, anim_options, frames), snap_fps
            ),
        }
        log(f"{name}: готово за {round(time.time() - row_t, 1)} с")

    if not animations:
        raise RuntimeError(
            "Нет подходящих фото: выбери хотя бы одно фото для включённой анимации"
        )
    default = "idle" if "idle" in animations else next(iter(animations))
    return sheet, animations, default


def analyze_sheet(sheet, frame_w, frame_h, animations):
    """Предупреждения: фигура касается края кадра (риск обрезки)."""
    warnings = []
    seen = set()
    for name, info in animations.items():
        row, frames = info["row"], info["frames"]
        for i in range(frames):
            box = (i * frame_w, row * frame_h, (i + 1) * frame_w, (row + 1) * frame_h)
            bbox = sheet.crop(box).getbbox()
            if not bbox:
                continue
            l, t, r, b = bbox
            edges = []
            if t <= 1:
                edges.append("верх (голова)")
            if l <= 1:
                edges.append("слева")
            if r >= frame_w - 1:
                edges.append("справа")
            if edges:
                key = (name, tuple(edges))
                if key not in seen:
                    seen.add(key)
                    warnings.append(f"{name}: касается края — {', '.join(edges)}")
    return warnings


def make_entry(pet_id, label, frame_w, frame_h):
    animations = {
        name: {
            "row": spec["row"],
            "frames": spec["frames"],
            "frameDurationsMs": spec["dur"],
        }
        for name, spec in ANIMATIONS.items()
    }
    return {
        "id": pet_id,
        "label": label,
        "fileName": "spritesheet.webp",
        "mimeType": "image/webp",
        "kind": "bundle",
        "sprite": {
            "frameWidth": frame_w,
            "frameHeight": frame_h,
            "columns": COLS,
            "rows": ROWS,
            "sheetWidth": frame_w * COLS,
            "sheetHeight": frame_h * ROWS,
            "fps": 8,
            "defaultAnimation": "idle",
            "animations": animations,
        },
        "spriteFps": 8,
    }


def slugify(label):
    import re

    s = re.sub(r"[^0-9A-Za-z_-]+", "-", (label or "").strip()).strip("-").lower()
    return s or "pet"


def sources_store_dir():
    base = os.environ.get("LOCALAPPDATA") or tempfile.gettempdir()
    d = os.path.join(base, "PetSpriteBuilder", "sources")
    os.makedirs(d, exist_ok=True)
    return d


def scaled_durations(name, anim_options=None):
    base = list(ANIMATIONS[name]["dur"])
    opt = (anim_options or {}).get(name) or {}
    try:
        speed = float(opt.get("speed") or 1)
    except (TypeError, ValueError):
        speed = 1
    if speed <= 0:
        speed = 1
    return [max(20, int(round(d / speed))) for d in base]


def validate_bundle(manifest, sheet_w, sheet_h):
    """Проверки как у импорта Orca, чтобы bundle точно приняли."""
    errs = []
    frame = manifest.get("frame") or {}
    fw = frame.get("width")
    fh = frame.get("height")
    anims = manifest.get("animations") or {}
    if not fw or not fh:
        errs.append("frame не задан")
        return errs
    if sheet_w % fw or sheet_h % fh:
        errs.append(f"sheetFrameMismatch: {sheet_w}×{sheet_h} не кратно {fw}×{fh}")
        return errs
    cols = sheet_w // fw
    rows = sheet_h // fh
    for name, a in anims.items():
        if a.get("row", -1) >= rows:
            errs.append(f"animationRowOutOfRange: {name} строка {a.get('row')}")
        if a.get("frames", 0) > cols:
            errs.append(f"animationTooManyFrames: {name} кадров {a.get('frames')}")
        if len(a.get("frameDurationsMs") or []) != a.get("frames"):
            errs.append(f"animationDurationMismatch: {name}")
    if manifest.get("defaultAnimation") not in anims:
        errs.append("defaultAnimationMissing")
    return errs


def export_bundle(
    sheet,
    label,
    frame_w,
    frame_h,
    out_dir,
    rows=None,
    transforms=None,
    consistent=False,
    anim_options=None,
    webp_lossless=True,
    webp_quality=95,
    animations=None,
    default_animation=None,
):
    """Пишет готовый bundle (pet.json + спрайт) для импорта через UI Orca. БД не трогаем."""
    import shutil

    slug = slugify(label)
    folder = os.path.join(out_dir, slug)
    if os.path.isdir(folder):
        shutil.rmtree(folder, ignore_errors=True)
    if os.path.isdir(folder):
        folder = os.path.join(out_dir, f"{slug}-{int(time.time())}")
    os.makedirs(folder, exist_ok=True)

    webp = os.path.join(folder, "spritesheet.webp")
    png = os.path.join(folder, "spritesheet.png")
    if webp_lossless:
        sheet.save(webp, "WEBP", lossless=True, method=6)
    else:
        sheet.save(webp, "WEBP", quality=int(webp_quality), method=6)
    sheet.save(png, "PNG")

    if animations is None:
        animations = {
            name: {
                "row": spec["row"],
                "frames": spec["frames"],
                "frameDurationsMs": scaled_durations(name, anim_options),
            }
            for name, spec in ANIMATIONS.items()
        }
    manifest = {
        "id": slug,
        "displayName": label,
        "description": f"{label} desktop pet",
        "spritesheetPath": "spritesheet.webp",
        "frame": {"width": frame_w, "height": frame_h},
        "fps": 8,
        "defaultAnimation": default_animation
        or ("idle" if "idle" in animations else next(iter(animations))),
        "animations": animations,
    }
    with open(os.path.join(folder, "pet.json"), "w", encoding="utf-8") as f:
        json.dump(manifest, f, ensure_ascii=False, indent=2)

    sources = {
        "label": label,
        "frameWidth": frame_w,
        "frameHeight": frame_h,
        "consistentScale": bool(consistent),
        "rows": {str(k): v for k, v in (rows or {}).items()},
        "transforms": {str(k): v for k, v in (transforms or {}).items()},
        "animOptions": anim_options or {},
    }
    for path in (
        os.path.join(folder, "sources.json"),
        os.path.join(sources_store_dir(), slug + ".json"),
    ):
        try:
            with open(path, "w", encoding="utf-8") as f:
                json.dump(sources, f, ensure_ascii=False, indent=2)
        except Exception as e:
            log(f"sources {path}: {e!r}")

    return {
        "folder": folder,
        "webp": webp,
        "png": png,
        "sizeBytes": os.path.getsize(webp),
        "validationErrors": validate_bundle(manifest, frame_w * COLS, frame_h * ROWS),
    }


def preview_dir():
    base = os.environ.get("LOCALAPPDATA") or tempfile.gettempdir()
    d = os.path.join(base, "PetSpriteBuilder", "previews")
    os.makedirs(d, exist_ok=True)
    return d


def models_dir():
    return os.path.join(os.path.expanduser("~"), ".rembg", "models")


def _tree_size(path):
    total = 0
    for root, _dirs, files in os.walk(path):
        for f in files:
            try:
                total += os.path.getsize(os.path.join(root, f))
            except Exception:
                pass
    return total


def models_info():
    base = models_dir()
    items = []
    total = 0
    if os.path.isdir(base):
        for n in sorted(os.listdir(base)):
            d = os.path.join(base, n)
            if not os.path.isdir(d):
                continue
            size = _tree_size(d)
            items.append({"name": n, "bytes": size})
            total += size
    return {"models": items, "total": total, "path": base}


def delete_bg_model(payload):
    import shutil as _shutil

    name = (payload.get("model") or "").strip()
    if not name or "/" in name or "\\" in name or name in (".", ".."):
        raise RuntimeError("Некорректное имя модели")
    base = os.path.abspath(models_dir())
    target = os.path.abspath(os.path.join(base, name))
    if os.path.dirname(target) != base or not os.path.isdir(target):
        raise RuntimeError("Модель не найдена")
    freed = _tree_size(target)
    _shutil.rmtree(target, ignore_errors=True)
    log(f"Модель удалена: {name}")
    return {"removed": name, "freedBytes": freed}


def list_bg_models():
    base = models_dir()
    names = []
    if os.path.isdir(base):
        for n in os.listdir(base):
            if os.path.isdir(os.path.join(base, n)):
                names.append(n)
    names.sort()
    for fast in ("u2net", "u2netp", "silueta", "isnet-general-use"):
        if fast in names:
            default = fast
            break
    else:
        default = "bria-rmbg" if "bria-rmbg" in names else (names[0] if names else "")
    sizes = {}
    for n in names:
        try:
            sizes[n] = _tree_size(os.path.join(base, n))
        except Exception:
            sizes[n] = 0
    return {
        "models": names,
        "default": default,
        "downloadable": downloadable_bg_models(),
        "sizes": sizes,
    }


def clear_cutouts():
    base = os.environ.get("LOCALAPPDATA") or tempfile.gettempdir()
    d = os.path.join(base, "PetSpriteBuilder", "cutouts")
    n = 0
    if os.path.isdir(d):
        for f in os.listdir(d):
            try:
                os.remove(os.path.join(d, f))
                n += 1
            except Exception:
                pass
    return {"removed": n}


CACHE_DIRS = ("cutouts", "gifcache", "videocache", "previews")


def _cache_root():
    base = os.environ.get("LOCALAPPDATA") or tempfile.gettempdir()
    return os.path.join(base, "PetSpriteBuilder")


def _dir_size(d):
    total = 0
    try:
        for f in os.listdir(d):
            fp = os.path.join(d, f)
            if os.path.isfile(fp):
                try:
                    total += os.path.getsize(fp)
                except Exception:
                    pass
    except Exception:
        pass
    return total


def cache_info():
    root = _cache_root()
    items = {}
    total = 0
    for name in CACHE_DIRS:
        d = os.path.join(root, name)
        size = _dir_size(d) if os.path.isdir(d) else 0
        items[name] = size
        total += size
    return {"items": items, "total": total, "path": root}


def clear_cache(payload):
    root = _cache_root()
    kinds = payload.get("kinds") or list(CACHE_DIRS)
    removed = 0
    for name in kinds:
        if name not in CACHE_DIRS:
            continue
        d = os.path.join(root, name)
        if not os.path.isdir(d):
            continue
        for f in os.listdir(d):
            fp = os.path.join(d, f)
            if os.path.isfile(fp):
                try:
                    os.remove(fp)
                    removed += 1
                except Exception:
                    pass
    return {"removed": removed}


def dedupe_gif_frames(imgs, durs):
    """Убирает подряд идущие одинаковые кадры, суммируя их длительности."""
    out = []
    out_durs = []
    out_raw = []
    for im, d in zip(imgs, durs):
        raw = im.tobytes()
        if out and raw == out_raw[-1]:
            out_durs[-1] += int(d)
            continue
        out.append(im)
        out_raw.append(raw)
        out_durs.append(int(d))
    return out, out_durs


def _save_gif_frames(frames, durs, path, colors=256):
    seq = frames
    if colors and colors < 256:
        opaque = all(
            f.convert("RGBA").getchannel("A").getextrema()[0] == 255 for f in frames
        )
        if opaque:
            seq = [
                f.convert("RGB").convert("P", palette=Image.ADAPTIVE, colors=colors)
                for f in frames
            ]
    seq[0].save(
        path,
        save_all=True,
        append_images=seq[1:],
        duration=durs,
        loop=0,
        disposal=2,
        optimize=False,
    )


def save_gif_optimized(imgs, durs, path, colors=256, max_kb=0):
    frames, durs = dedupe_gif_frames(imgs, durs)
    scales = [1.0]
    if max_kb > 0:
        scales = [1.0, 0.85, 0.7, 0.55, 0.4]
    color_opts = [int(colors or 256)]
    if max_kb > 0 and color_opts[0] >= 256:
        color_opts = [256, 128, 64, 32]
    best = None
    for scale in scales:
        seq = frames
        if scale < 1.0:
            seq = [
                f.resize(
                    (max(1, int(f.width * scale)), max(1, int(f.height * scale))),
                    Image.LANCZOS,
                )
                for f in frames
            ]
        for c in color_opts:
            _save_gif_frames(seq, durs, path, c)
            size = os.path.getsize(path)
            if best is None or size < best[0]:
                best = (size, scale, c)
            if max_kb <= 0 or size <= max_kb * 1024:
                log(
                    f"GIF сохранён: {round(size / 1024)} КБ, "
                    f"кадров {len(seq)}, цветов {c if c < 256 else 'авто'}, "
                    f"масштаб {int(scale * 100)}%"
                )
                return path
    if best is not None:
        # Пересохраняем лучший по размеру вариант, если целевой не достигнут.
        scale = best[1]
        seq = frames
        if scale < 1.0:
            seq = [
                f.resize(
                    (max(1, int(f.width * scale)), max(1, int(f.height * scale))),
                    Image.LANCZOS,
                )
                for f in frames
            ]
        _save_gif_frames(seq, durs, path, best[2])
        log(
            f"GIF сохранён: {round(best[0] / 1024)} КБ "
            f"(цель {max_kb} КБ не достигнута)"
        )
    return path


def export_animation(sheet, frame_w, frame_h, anim_name, fmt, out_dir, label, anim_options=None, gif_colors=256, gif_max_kb=0, snap_fps=0):
    spec = ANIMATIONS.get(anim_name)
    if not spec:
        raise RuntimeError(f"Неизвестная анимация: {anim_name}")
    row, frames = spec["row"], spec["frames"]
    opt = (anim_options or {}).get(anim_name) or {}
    order = list(range(frames))
    if opt.get("pingpong") and frames > 2:
        order = order + list(range(frames - 2, 0, -1))
    durations = snap_to_fps(scaled_durations(anim_name, anim_options), snap_fps)
    order_durations = [durations[i] for i in order]
    imgs = [
        sheet.crop(
            (i * frame_w, row * frame_h, (i + 1) * frame_w, (row + 1) * frame_h)
        )
        for i in order
    ]
    os.makedirs(out_dir, exist_ok=True)
    base = os.path.join(out_dir, f"{slugify(label)}-{anim_name}")
    if fmt == "gif":
        path = base + ".gif"
        save_gif_optimized(imgs, order_durations, path, gif_colors, gif_max_kb)
    else:
        path = base + ".png"
        imgs[0].save(
            path,
            format="PNG",
            save_all=True,
            append_images=imgs[1:],
            duration=order_durations,
            loop=0,
        )
    return path


def photo_to_gif(payload):
    """Простая автоанимация из одного фото: покачивание и дыхание."""
    import math as _math

    src = payload.get("path") or ""
    if not src or not os.path.exists(src):
        raise RuntimeError("Фото не найдено")
    frames = max(2, min(24, int(payload.get("frames") or 8)))
    amp = max(0.0, min(12.0, float(payload.get("amplitude") or 3.0)))
    max_side = max(64, min(1024, int(payload.get("maxSize") or 480)))
    im = Image.open(src).convert("RGBA")
    s = min(1.0, max_side / max(im.width, im.height))
    if s < 1.0:
        im = im.resize((max(1, int(im.width * s)), max(1, int(im.height * s))), Image.LANCZOS)
    pad = int(amp * 2 + 4)
    canvas_w = im.width + pad * 2
    canvas_h = im.height + pad * 2
    out_frames = []
    for i in range(frames):
        ph = 2 * _math.pi * i / frames
        rot = 1.5 * _math.sin(ph)
        bob = amp * _math.sin(ph)
        breath = 1.0 + 0.012 * _math.sin(ph + _math.pi / 2)
        fr = im.resize(
            (max(1, int(im.width * breath)), max(1, int(im.height * breath))),
            Image.LANCZOS,
        )
        if rot:
            fr = fr.rotate(rot, resample=Image.BICUBIC, expand=True)
        cell = Image.new("RGBA", (canvas_w, canvas_h), (0, 0, 0, 0))
        px = (canvas_w - fr.width) // 2
        py = canvas_h - fr.height - pad + round(bob)
        cell.alpha_composite(fr, (max(0, px), max(0, py)))
        out_frames.append(cell)
    out_dir = os.path.join(
        os.environ.get("LOCALAPPDATA") or tempfile.gettempdir(),
        "PetSpriteBuilder",
        "videocache",
    )
    os.makedirs(out_dir, exist_ok=True)
    out = os.path.join(out_dir, "auto-" + uuid.uuid4().hex + ".gif")
    dur = max(40, int(payload.get("duration") or 120))
    out_frames[0].save(
        out,
        save_all=True,
        append_images=out_frames[1:],
        duration=[dur] * len(out_frames),
        loop=0,
        disposal=2,
    )
    log(f"Автоанимация: {frames} кадров, {out}")
    return {"gif": out, "frames": len(out_frames)}


def cutout_preview(path, bg):
    t0 = time.time()
    bg = bg or {}
    model = bg.get("model") or ""
    alpha = bool(bg.get("alphaMatting"))
    fg = int(bg.get("fgThreshold") or 240)
    bgt = int(bg.get("bgThreshold") or 10)
    erode = int(bg.get("erode") or 10)
    pdir = preview_dir()
    log(f"Вырезание: {os.path.basename(path)}")
    log(
        f"Модель: {model or 'default'}, alpha matting: {'вкл' if alpha else 'выкл'}, "
        f"порог объекта: {fg}, порог фона: {bgt}, erode: {erode}"
    )
    orig = os.path.join(pdir, f"orig-{uuid.uuid4().hex}.png")
    Image.open(path).convert("RGBA").save(orig, "PNG")
    log(f"Оригинал сохранён за {round(time.time() - t0, 2)} с")

    feather = int(bg.get("feather") or 0)
    extra = f"{model or 'default'}|{int(alpha)}|{fg}|{bgt}|{erode}|{feather}"
    cached = cutout_cache_path(path, extra)
    if os.path.exists(cached):
        log(f"Кэш найден: {os.path.basename(cached)} ({round(time.time() - t0, 2)} с)")
    else:
        log("Кэш не найден — запускаю rembg…")
        ts = time.time()
        session = new_rembg_session(model)
        log(f"Модель загружена за {round(time.time() - ts, 1)} с")
        ts = time.time()
        res = remove_bg_fast(Image.open(path).convert("RGBA"), session, bg)
        log(f"Удаление фона готово за {round(time.time() - ts, 1)} с")
        try:
            res.save(cached, "PNG")
            log(f"Результат сохранён в кэш: {os.path.basename(cached)}")
        except Exception as e:
            log(f"Не удалось сохранить кэш: {e!r}")
    log(f"Сравнение готово за {round(time.time() - t0, 2)} с")
    return {"original": orig, "cutout": cached}


def source_thumb(path, size=180):
    """Кэш маленькой превьюшки исходника: карточки не должны декодировать 76-МБ GIF."""
    try:
        st = os.stat(path)
    except OSError:
        return None
    key = hashlib.sha256(
        f"{os.path.abspath(path)}|{st.st_mtime_ns}|{st.st_size}|{size}".encode("utf-8")
    ).hexdigest()[:24]
    out = os.path.join(preview_dir(), f"thumb-{key}.png")
    if os.path.exists(out):
        return out
    try:
        im = Image.open(path)
        try:
            im.seek(0)
        except Exception:
            pass
        im = im.convert("RGBA")
        im.thumbnail((size, size), Image.LANCZOS)
        im.save(out, "PNG", optimize=True)
        return out
    except Exception as e:
        log(f"thumb {path}: {e!r}")
        return None


def list_pets(payload):
    db_path = payload.get("dbPath") or DEFAULT_DB
    pet_root = payload.get("petRoot") or DEFAULT_PET_ROOT
    row_names = {spec["row"]: name for name, spec in ANIMATIONS.items()}
    pdir = preview_dir()

    # Только чтение: приложение не должно менять состояние профиля Orca
    uri = "file:" + db_path.replace("\\", "/") + "?mode=ro"
    try:
        c = sqlite3.connect(uri, uri=True, timeout=10)
        try:
            row = c.execute(
                "select payload from profile_state_documents where domain='ui'"
            ).fetchone()
        finally:
            c.close()
    except sqlite3.Error:
        # WAL иногда не открывается в режиме ro — читаем обычным соединением
        # (только SELECT, без записи).
        c = sqlite3.connect(db_path, timeout=10)
        try:
            row = c.execute(
                "select payload from profile_state_documents where domain='ui'"
            ).fetchone()
        finally:
            c.close()
    if row is None:
        raise RuntimeError("ui-домен не найден в БД Orca")

    d = json.loads(row[0])
    pets = d.get("customPets") or []
    current = d.get("petId")

    result = []
    for p in pets:
        pid = p.get("id")
        if not pid:
            continue
        folder = os.path.join(pet_root, pid)
        sprite = p.get("sprite") or {}
        fw = sprite.get("frameWidth") or 0
        fh = sprite.get("frameHeight") or 0

        sources = []
        transforms = {}
        consistent = False
        src_path = os.path.join(folder, "sources.json")
        if not os.path.exists(src_path):
            src_path = os.path.join(sources_store_dir(), slugify(p.get("label")) + ".json")
        if os.path.exists(src_path):
            try:
                with open(src_path, "r", encoding="utf-8") as f:
                    src = json.load(f)
                transforms = src.get("transforms") or {}
                consistent = bool(src.get("consistentScale"))
                for k, v in (src.get("rows") or {}).items():
                    try:
                        r = int(k)
                    except ValueError:
                        continue
                    sources.append(
                        {
                            "row": r,
                            "name": row_names.get(r, f"row {r}"),
                            "path": v,
                            "exists": os.path.exists(v),
                            "thumb": source_thumb(v) if os.path.exists(v) else None,
                        }
                    )
                fw = src.get("frameWidth") or fw
                fh = src.get("frameHeight") or fh
            except Exception as e:
                log(f"sources.json {pid}: {e!r}")
        sources.sort(key=lambda x: x["row"])

        preview = None
        sheet_path = os.path.join(folder, p.get("fileName") or "spritesheet.webp")
        if fw and fh and os.path.exists(sheet_path):
            try:
                stamp = int(os.path.getmtime(sheet_path))
                preview = os.path.join(pdir, f"{pid}-{stamp}.png")
                if not os.path.exists(preview):
                    im = Image.open(sheet_path).convert("RGBA").crop((0, 0, fw, fh))
                    im.save(preview, "PNG")
            except Exception as e:
                preview = None
                log(f"preview {pid}: {e!r}")

        result.append(
            {
                "id": pid,
                "label": p.get("label") or pid,
                "active": pid == current,
                "frameWidth": fw,
                "frameHeight": fh,
                "sprite": sheet_path if os.path.exists(sheet_path) else None,
                "preview": preview,
                "sources": sources,
                "transforms": transforms,
                "consistentScale": consistent,
            }
        )

    return {
        "pets": result,
        "current": current,
        "petSize": d.get("petSize"),
        "petVisible": d.get("petVisible"),
    }


def fit_plain(im, fw, fh, frac=0.92):
    s = min((fw * frac) / im.width, (fh * frac) / im.height)
    return im.resize(
        (max(1, int(im.width * s)), max(1, int(im.height * s))), Image.LANCZOS
    )


def media_info(payload):
    path = payload.get("path") or ""
    if not path or not os.path.exists(path):
        raise RuntimeError("Файл не найден")
    im = Image.open(path)
    w, h = im.size
    n = getattr(im, "n_frames", 1) or 1
    total = 0
    if n > 1:
        for i in range(n):
            try:
                im.seek(i)
                total += max(20, int(im.info.get("duration") or 40))
            except Exception:
                break
    avg = total / n if n else 0
    try:
        size = os.path.getsize(path)
    except Exception:
        size = 0
    return {
        "width": w,
        "height": h,
        "frames": n,
        "durationMs": total,
        "fps": round(1000.0 / avg, 2) if avg else 0,
        "bytes": size,
        "animated": n > 1,
    }


def sample_indices(n, k):
    if n <= k:
        return list(range(n))
    if k <= 1:
        return [0]
    return sorted(set(round(i * (n - 1) / (k - 1)) for i in range(k)))


def gif_cache_dir():
    base = os.environ.get("LOCALAPPDATA") or tempfile.gettempdir()
    d = os.path.join(base, "PetSpriteBuilder", "gifcache")
    os.makedirs(d, exist_ok=True)
    return d


def video_cache_dir():
    base = os.environ.get("LOCALAPPDATA") or tempfile.gettempdir()
    d = os.path.join(base, "PetSpriteBuilder", "videocache")
    os.makedirs(d, exist_ok=True)
    return d


def find_ffmpeg():
    try:
        import imageio_ffmpeg

        exe = imageio_ffmpeg.get_ffmpeg_exe()
        if exe and os.path.exists(exe):
            return exe
    except Exception:
        pass
    import shutil as _shutil

    return _shutil.which("ffmpeg")


def video_to_gif(payload):
    """Конвертирует видео (mp4/mov/webm/…) в GIF через ffmpeg с палитрой."""
    import subprocess

    src = payload.get("path") or ""
    if not src or not os.path.exists(src):
        raise RuntimeError("Видео не найдено")
    fps = max(1, min(30, int(payload.get("fps") or 15)))
    max_side = max(64, min(1024, int(payload.get("maxSize") or 480)))
    start = max(0.0, float(payload.get("start") or 0))
    end = float(payload.get("end") or 0)
    if end and end <= start:
        end = 0
    boomerang = bool(payload.get("boomerang"))
    preview = bool(payload.get("preview"))
    if preview:
        max_side = min(max_side, 240)
        if not end or end - start > 3:
            end = start + 3
    st = os.stat(src)
    key = hashlib.sha256(
        (
            f"{os.path.abspath(src)}|{st.st_mtime_ns}|{st.st_size}|{fps}|{max_side}"
            f"|{start}|{end}|{int(boomerang)}|{int(preview)}"
        ).encode("utf-8")
    ).hexdigest()[:24]
    out = os.path.join(video_cache_dir(), key + ".gif")
    if os.path.exists(out) and os.path.getsize(out) > 0:
        return {"gif": out, "width": None, "height": None, "cached": True}

    exe = find_ffmpeg()
    if not exe:
        raise RuntimeError("ffmpeg не найден. Установите imageio-ffmpeg.")

    log(
        f"Конвертация видео в GIF: {os.path.basename(src)} ({fps} fps, ≤{max_side}px"
        + (f", {start:g}–{end:g} с" if start or end else "")
        + (", бумеранг" if boomerang else "")
        + ")…"
    )
    chain = []
    if start or end:
        chain.append(
            f"trim=start={start:g}" + (f":end={end:g}" if end else "") + ",setpts=PTS-STARTPTS"
        )
    chain.append(f"fps={fps}")
    chain.append(
        f"scale={max_side}:{max_side}:force_original_aspect_ratio=decrease:flags=lanczos"
    )
    chain = ",".join(chain)
    if boomerang:
        graph = (
            f"[0:v]{chain},split[f][b];[b]reverse[r];[f][r]concat=n=2:v=1:a=0,"
            f"split[s0][s1];[s0]palettegen=stats_mode=diff[p];"
            f"[s1][p]paletteuse=dither=bayer:bayer_scale=5:diff_mode=rectangle[out]"
        )
    else:
        graph = (
            f"[0:v]{chain},split[s0][s1];[s0]palettegen=stats_mode=diff[p];"
            f"[s1][p]paletteuse=dither=bayer:bayer_scale=5:diff_mode=rectangle[out]"
        )
    cmd = [
        exe,
        "-y",
        "-i",
        src,
        "-filter_complex",
        graph,
        "-map",
        "[out]",
        "-loop",
        "0",
        out,
    ]
    try:
        proc = subprocess.run(
            cmd,
            capture_output=True,
            timeout=600,
            creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0),
        )
    except subprocess.TimeoutExpired:
        raise RuntimeError("Конвертация видео заняла слишком много времени")
    if proc.returncode != 0 or not os.path.exists(out):
        tail = (proc.stderr or b"").decode("utf-8", "ignore").strip().splitlines()[-5:]
        raise RuntimeError("ffmpeg ошибка: " + " / ".join(tail))
    log(f"GIF готов: {out}")
    return {"gif": out, "cached": False}


def gif_cache_files(path, idx):
    st = os.stat(path)
    key = hashlib.sha256(
        f"{os.path.abspath(path)}|{st.st_mtime_ns}|{st.st_size}|{idx}".encode("utf-8")
    ).hexdigest()[:24]
    d = gif_cache_dir()
    return os.path.join(d, key + ".png"), os.path.join(d, key + ".json")


def gif_cache_load(path, idx):
    img_p, meta_p = gif_cache_files(path, idx)
    if not (os.path.exists(img_p) and os.path.exists(meta_p)):
        return None
    try:
        with open(meta_p, "r", encoding="utf-8") as f:
            dur = int(json.load(f).get("duration") or 40)
        return Image.open(img_p).convert("RGBA"), max(20, dur)
    except Exception:
        return None


def gif_cache_save(path, idx, im, dur):
    try:
        img_p, meta_p = gif_cache_files(path, idx)
        tmp = img_p + ".tmp"
        im.save(tmp, "PNG")
        os.replace(tmp, img_p)
        with open(meta_p, "w", encoding="utf-8") as f:
            json.dump({"duration": int(dur)}, f)
    except Exception:
        pass


def gif_collect(path, idxs):
    """Один проход по GIF вместо seek() на каждый кадр + кэш кадров на диск."""
    im = Image.open(path)
    n = getattr(im, "n_frames", 1) or 1
    wanted = [max(0, min(n - 1, int(i))) for i in idxs]
    found = {}
    need = []
    for idx in sorted(set(wanted)):
        cached = gif_cache_load(path, idx)
        if cached is not None:
            found[idx] = cached
        else:
            need.append(idx)
    if need:
        target = set(need)
        last = max(need)
        for i in range(last + 1):
            im.seek(i)
            if i in target:
                fr = im.convert("RGBA").copy()
                dur = max(20, int(im.info.get("duration") or 40))
                found[i] = (fr, dur)
                gif_cache_save(path, i, fr, dur)
                target.discard(i)
                if not target:
                    break
    frames = [found[i][0] for i in wanted if i in found]
    durs = [found[i][1] for i in wanted if i in found]
    return frames, durs


def gif_frames_at(path, idxs):
    return gif_collect(path, idxs)


def gif_frames(path, maxn=COLS):
    im = Image.open(path)
    n = getattr(im, "n_frames", 1) or 1
    idxs = sample_indices(n, maxn)
    frames, durs = gif_collect(path, idxs)

    if n > maxn and frames:
        avg = sum(durs) / len(durs)
        per = int((n * avg) / len(idxs))
        per = max(150, min(300, per))
        durs = [per] * len(frames)
    return frames, durs


def apply_crop(im, crop):
    if not crop:
        return im
    try:
        l = float(crop.get("l") or 0)
        t = float(crop.get("t") or 0)
        r = float(crop.get("r") or 0)
        b = float(crop.get("b") or 0)
    except (TypeError, ValueError):
        return im
    l = min(max(l, 0.0), 0.45)
    t = min(max(t, 0.0), 0.45)
    r = min(max(r, 0.0), 0.45)
    b = min(max(b, 0.0), 0.45)
    if not (l or t or r or b):
        return im
    w, h = im.size
    box = (int(w * l), int(h * t), int(w * (1 - r)), int(h * (1 - b)))
    if box[2] - box[0] < 2 or box[3] - box[1] < 2:
        return im
    return im.crop(box)


def gif_info(payload):
    path = payload.get("path") or ""
    if not path or not os.path.exists(path):
        raise RuntimeError("GIF не найден")
    im = Image.open(path)
    n = getattr(im, "n_frames", 1) or 1
    # Для ручного выбора кадров показываем все кадры (до разумного предела).
    idxs = list(range(n)) if n <= 60 else sample_indices(n, 60)
    pdir = preview_dir()
    out = []
    for i in idxs:
        im.seek(i)
        fr = im.convert("RGBA")
        fr.thumbnail((96, 96), Image.LANCZOS)
        thumb = os.path.join(pdir, f"giff-{uuid.uuid4().hex}.png")
        fr.save(thumb, "PNG")
        out.append(
            {
                "index": i,
                "thumb": thumb,
                "duration": max(20, int(im.info.get("duration") or 40)),
            }
        )
    return {"count": n, "frames": out}


def apply_chroma(fr, chroma):
    if not chroma or not chroma.get("enabled"):
        return fr
    try:
        import numpy as np
    except Exception:
        return fr
    r = int(chroma.get("r") or 255)
    g = int(chroma.get("g") or 255)
    b = int(chroma.get("b") or 255)
    tol = int(chroma.get("tol") or 30)
    arr = np.array(fr.convert("RGBA"))
    dr = arr[..., 0].astype(int) - r
    dg = arr[..., 1].astype(int) - g
    db = arr[..., 2].astype(int) - b
    dist = np.sqrt(dr * dr + dg * dg + db * db)
    arr[..., 3][dist <= tol] = 0
    return Image.fromarray(arr, "RGBA")


def anim_durations(name, anim_options, frames=None):
    opt = (anim_options or {}).get(name) or {}
    d = opt.get("durations")
    if isinstance(d, list) and d:
        vals = [max(20, int(x)) for x in d]
        return vals[:frames] if frames else vals
    base = scaled_durations(name, anim_options)
    return base[:frames] if frames else base


def load_animated(path_buf):
    try:
        im = Image.open(path_buf)
        n = getattr(im, "n_frames", 1) or 1
    except Exception:
        return None
    if n > 1:
        return gif_frames(path_buf, COLS)
    return None


def zip_folder(folder):
    if not folder or not os.path.isdir(folder):
        raise RuntimeError("Папка bundle не найдена")
    import zipfile

    zip_path = folder.rstrip("\\/") + ".zip"
    with zipfile.ZipFile(zip_path, "w", zipfile.ZIP_DEFLATED) as z:
        for root, _dirs, files in os.walk(folder):
            for f in files:
                full = os.path.join(root, f)
                rel = os.path.relpath(full, folder)
                z.write(full, rel)
    return {"path": zip_path, "sizeBytes": os.path.getsize(zip_path)}


def default_out_dir():
    base = os.environ.get("LOCALAPPDATA") or tempfile.gettempdir()
    return os.path.join(base, "PetSpriteBuilder", "bundles")


def list_bundles(payload):
    roots = []
    od = payload.get("outDir")
    if od:
        roots.append(od)
    roots.append(default_out_dir())
    roots.append(os.path.join(os.path.expanduser("~"), "PetSpriteBuilder"))
    seen = set()
    result = []
    for base in roots:
        if not base or not os.path.isdir(base):
            continue
        try:
            entries = os.listdir(base)
        except Exception:
            continue
        for name in entries:
            folder = os.path.join(base, name)
            if not os.path.isdir(folder) or folder in seen:
                continue
            pj = os.path.join(folder, "pet.json")
            if not os.path.isfile(pj):
                continue
            seen.add(folder)
            try:
                mtime = os.path.getmtime(pj)
            except Exception:
                mtime = 0
            result.append({"path": folder, "name": name, "mtime": int(mtime)})
    result.sort(key=lambda x: -x["mtime"])
    return {"bundles": result}


def build_gif_pet(payload):
    gifs = payload.get("gifs") or {}
    fw = int(payload.get("frameWidth") or 384)
    fh = int(payload.get("frameHeight") or 416)
    label = (payload.get("label") or "My Pet").strip()
    out_dir = payload.get("outDir") or default_out_dir()
    remove_bg = bool(payload.get("removeBg"))
    bg = payload.get("bg") or {}

    present = [n for n in ANIMATIONS if gifs.get(n)]
    if not present:
        raise RuntimeError("Не выбрано ни одной GIF для состояний")

    sheet = Image.new("RGBA", (fw * COLS, fh * ROWS), (0, 0, 0, 0))
    animations = {}
    session_box = {"sessions": {}}

    selections = payload.get("selections") or {}

    for name in present:
        row = ANIMATIONS[name]["row"]
        log(f"GIF: {name}…")
        sel = selections.get(name) or {}
        picked = sel.get("frames")
        if isinstance(picked, list) and picked:
            frames, durs = gif_frames_at(gifs[name], picked[:COLS])
            custom = sel.get("durs")
            if isinstance(custom, list) and len(custom) == len(frames):
                durs = [max(40, int(x)) for x in custom]
        else:
            frames, durs = gif_frames(gifs[name], COLS)
        durs = snap_to_fps([max(120, d) for d in durs], payload.get("orcaFps"))

        prepared = frames
        if remove_bg:
            model = bg.get("model") or ""
            sessions = session_box["sessions"]
            skey = model or "__default__"
            if skey not in sessions:
                log(f"Загрузка модели ({model or 'default'})…")
                sessions[skey] = new_rembg_session(model)
            session = sessions[skey]
            if bool(bg.get("alphaMatting")):
                prepared = [remove_bg_fast(fr, session, bg) for fr in frames]
            else:
                from PIL import ImageOps

                imgs = [ImageOps.exif_transpose(fr).convert("RGBA") for fr in frames]
                masks = []
                for im in imgs:
                    found = session.predict(im) or []
                    if found:
                        masks.append(found[0])
                if masks and len(masks) == len(imgs):
                    log(f"{name}: стабилизация маски по {len(masks)} кадрам")
                    smooth = smooth_masks(masks)
                    prepared = [composite_mask(im, m) for im, m in zip(imgs, smooth)]
                else:
                    prepared = imgs

        for i, fr in enumerate(prepared):
            fr2 = fit_plain(fr.convert("RGBA"), fw, fh)
            cell = Image.new("RGBA", (fw, fh), (0, 0, 0, 0))
            px = (fw - fr2.width) // 2
            py = fh - fr2.height - 2
            cell.paste(fr2, (px, py), fr2)
            sheet.alpha_composite(cell, (i * fw, row * fh))
        animations[name] = {
            "row": row,
            "frames": len(frames),
            "frameDurationsMs": durs,
        }
        log(f"{name}: готово")

    default = payload.get("defaultAnimation") or ""
    if default not in animations:
        default = "idle" if "idle" in animations else present[0]
    return write_gif_bundle(sheet, label, fw, fh, out_dir, animations, default, gifs, remove_bg)


def write_gif_bundle(sheet, label, fw, fh, out_dir, animations, default, gifs, remove_bg):
    import shutil

    slug = slugify(label) + "-gif"
    folder = os.path.join(out_dir, slug)
    if os.path.isdir(folder):
        shutil.rmtree(folder, ignore_errors=True)
    os.makedirs(folder, exist_ok=True)

    webp = os.path.join(folder, "spritesheet.webp")
    png = os.path.join(folder, "spritesheet.png")
    sheet.save(webp, "WEBP", lossless=True, method=6)
    sheet.save(png, "PNG")

    manifest = {
        "id": slug,
        "displayName": label,
        "description": f"{label} (GIF) desktop pet",
        "spritesheetPath": "spritesheet.webp",
        "frame": {"width": fw, "height": fh},
        "fps": 8,
        "defaultAnimation": default,
        "animations": animations,
    }
    with open(os.path.join(folder, "pet.json"), "w", encoding="utf-8") as f:
        json.dump(manifest, f, ensure_ascii=False, indent=2)
    with open(os.path.join(folder, "sources.json"), "w", encoding="utf-8") as f:
        json.dump(
            {
                "label": label,
                "frameWidth": fw,
                "frameHeight": fh,
                "gifs": gifs,
                "removeBg": remove_bg,
            },
            f,
            ensure_ascii=False,
            indent=2,
        )

    return {
        "folder": folder,
        "webp": webp,
        "png": png,
        "sizeBytes": os.path.getsize(webp),
        "validationErrors": validate_bundle(manifest, fw * COLS, fh * ROWS),
    }


def run(payload):
    action = payload.get("action")
    if action == "list":
        return list_pets(payload)
    if action == "bg-models":
        return list_bg_models()
    if action == "download-bg-model":
        return download_bg_model(payload)
    if action == "models-info":
        return models_info()
    if action == "delete-bg-model":
        return delete_bg_model(payload)
    if action == "clear-cutouts":
        return clear_cutouts()
    if action == "cutout-preview":
        path = payload.get("path") or ""
        if not path or not os.path.exists(path):
            raise RuntimeError("Нет файла для сравнения")
        return cutout_preview(path, payload.get("bg") or {})
    if action == "gif-bundle":
        return build_gif_pet(payload)
    if action == "zip-folder":
        return zip_folder(payload.get("folder"))
    if action == "list-bundles":
        return list_bundles(payload)
    if action == "gif-info":
        return gif_info(payload)
    if action == "media-info":
        return media_info(payload)
    if action == "video-to-gif":
        return video_to_gif(payload)
    if action == "video-preview":
        return video_to_gif({**payload, "preview": True})
    if action == "photo-to-gif":
        return photo_to_gif(payload)
    if action == "cache-info":
        return cache_info()
    if action == "clear-cache":
        return clear_cache(payload)

    frame_w = int(payload.get("frameWidth") or 384)
    frame_h = int(payload.get("frameHeight") or 416)
    label = (payload.get("label") or "My Pet").strip()
    out_dir = payload.get("outDir")
    rows = payload.get("rows") or {}
    transforms = payload.get("transforms") or {}
    consistent = bool(payload.get("consistentScale"))
    bg = payload.get("bg") or {}
    anim_options = payload.get("animOptions") or {}
    webp_lossless = bool(payload.get("webpLossless", True))
    webp_quality = int(payload.get("webpQuality") or 95)
    disabled = payload.get("disabled") or []
    snap_fps = int(payload.get("orcaFps") or 0)

    log("Сборка спрайт-листа…")
    sheet, animations, default_anim = build_sheet(
        rows, frame_w, frame_h, transforms, consistent, bg, disabled, anim_options, snap_fps
    )
    warnings = analyze_sheet(sheet, frame_w, frame_h, animations)

    if action == "preview":
        pdir = preview_dir()
        preview = os.path.join(pdir, f"live-{uuid.uuid4().hex}.png")
        sheet.save(preview, "PNG")
        return {
            "previewPath": preview,
            "frameWidth": frame_w,
            "frameHeight": frame_h,
            "sheetWidth": frame_w * COLS,
            "sheetHeight": frame_h * ROWS,
            "animations": animations,
            "defaultAnimation": default_anim,
            "warnings": warnings,
        }

    if not out_dir:
        out_dir = default_out_dir()
    os.makedirs(out_dir, exist_ok=True)

    if action == "estimate":
        import io as _io

        pb = _io.BytesIO()
        sheet.save(pb, "PNG")
        wb = _io.BytesIO()
        if webp_lossless:
            sheet.save(wb, "WEBP", lossless=True, method=4)
        else:
            sheet.save(wb, "WEBP", quality=webp_quality, method=4)
        gif_sizes = {}
        tmp_dir = preview_dir()
        for name, info in animations.items():
            row = info["row"]
            frames = info["frames"]
            durs = info.get("frameDurationsMs") or [120] * frames
            imgs = [
                sheet.crop(
                    (i * frame_w, row * frame_h, (i + 1) * frame_w, (row + 1) * frame_h)
                )
                for i in range(frames)
            ]
            tmp = os.path.join(tmp_dir, f"estimate-{uuid.uuid4().hex}.gif")
            try:
                save_gif_optimized(
                    imgs,
                    durs,
                    tmp,
                    int(payload.get("gifColors") or 256),
                    int(payload.get("gifMaxKb") or 0),
                )
                gif_sizes[name] = os.path.getsize(tmp)
            finally:
                try:
                    os.remove(tmp)
                except Exception:
                    pass
        return {
            "pngBytes": pb.tell(),
            "webpBytes": wb.tell(),
            "gifs": gif_sizes,
            "frameWidth": frame_w,
            "frameHeight": frame_h,
        }

    if action == "export-animation":
        anim = payload.get("animation") or default_anim
        fmt = payload.get("format") or "gif"
        if anim not in animations:
            raise RuntimeError(f"Анимация «{anim}» не собрана (нет фото или выключена)")
        path = export_animation(
            sheet,
            frame_w,
            frame_h,
            anim,
            fmt,
            out_dir,
            label,
            anim_options,
            int(payload.get("gifColors") or 256),
            int(payload.get("gifMaxKb") or 0),
            snap_fps,
        )
        return {"path": path, "warnings": warnings}

    log("Сохранение bundle…")
    bundle = export_bundle(
        sheet,
        label,
        frame_w,
        frame_h,
        out_dir,
        rows,
        transforms,
        consistent,
        anim_options,
        webp_lossless,
        webp_quality,
        animations,
        default_anim,
    )

    return {
        "png": bundle["png"],
        "webp": bundle["webp"],
        "bundle": bundle["folder"],
        "sizeBytes": bundle["sizeBytes"],
        "validationErrors": bundle["validationErrors"],
        "warnings": warnings,
    }


def main():
    try:
        sys.stdout.reconfigure(encoding="utf-8")
        sys.stderr.reconfigure(encoding="utf-8")
    except Exception:
        pass

    parser = argparse.ArgumentParser()
    parser.add_argument("--payload", required=True)
    args = parser.parse_args()

    def emit(obj):
        data = ("__RESULT__" + json.dumps(obj, ensure_ascii=False) + "\n").encode("utf-8")
        try:
            sys.stdout.buffer.write(data)
            sys.stdout.buffer.flush()
        except Exception:
            print("__RESULT__" + json.dumps(obj, ensure_ascii=False), flush=True)

    try:
        with open(args.payload, "r", encoding="utf-8") as f:
            payload = json.load(f)
        result = run(payload)
        emit(result)
    except Exception as e:
        log(f"Ошибка: {e!r}")
        emit({"error": repr(e)})
        sys.exit(1)


if __name__ == "__main__":
    main()
