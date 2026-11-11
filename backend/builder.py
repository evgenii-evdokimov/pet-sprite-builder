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


def prepare(path, frame_w, frame_h, consistent=False, scale=1.0, session_box=None, bg=None, rotate=0, crop=None, stretch_x=1.0, stretch_y=1.0):
    bg = bg or {}
    model = bg.get("model") or ""
    alpha = bool(bg.get("alphaMatting"))
    fg = int(bg.get("fgThreshold") or 240)
    bgt = int(bg.get("bgThreshold") or 10)
    erode = int(bg.get("erode") or 10)
    extra = f"{model or 'default'}|{int(alpha)}|{fg}|{bgt}|{erode}"
    cached = cutout_cache_path(path, extra)
    if os.path.exists(cached):
        im = Image.open(cached).convert("RGBA")
    else:
        from rembg import new_session, remove

        session = None
        if session_box is not None:
            sessions = session_box.setdefault("sessions", {})
            skey = model or "__default__"
            if skey not in sessions:
                log(f"Загрузка модели вырезания фона ({model or 'default'})…")
                sessions[skey] = new_session() if not model else new_session(model)
            session = sessions[skey]
        im = remove(
            Image.open(path).convert("RGBA"),
            session=session,
            alpha_matting=alpha,
            alpha_matting_foreground_threshold=fg,
            alpha_matting_background_threshold=bgt,
            alpha_matting_erode_size=erode,
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
            "frameDurationsMs": anim_durations(name, anim_options, frames),
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
    return {"models": names, "default": default}


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


def export_animation(sheet, frame_w, frame_h, anim_name, fmt, out_dir, label, anim_options=None):
    spec = ANIMATIONS.get(anim_name)
    if not spec:
        raise RuntimeError(f"Неизвестная анимация: {anim_name}")
    row, frames = spec["row"], spec["frames"]
    opt = (anim_options or {}).get(anim_name) or {}
    order = list(range(frames))
    if opt.get("pingpong") and frames > 2:
        order = order + list(range(frames - 2, 0, -1))
    durations = scaled_durations(anim_name, anim_options)
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
        imgs[0].save(
            path,
            save_all=True,
            append_images=imgs[1:],
            duration=order_durations,
            loop=0,
            disposal=2,
            optimize=False,
        )
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


def cutout_preview(path, bg):
    bg = bg or {}
    model = bg.get("model") or ""
    alpha = bool(bg.get("alphaMatting"))
    fg = int(bg.get("fgThreshold") or 240)
    bgt = int(bg.get("bgThreshold") or 10)
    erode = int(bg.get("erode") or 10)
    pdir = preview_dir()
    orig = os.path.join(pdir, f"orig-{uuid.uuid4().hex}.png")
    Image.open(path).convert("RGBA").save(orig, "PNG")

    extra = f"{model or 'default'}|{int(alpha)}|{fg}|{bgt}|{erode}"
    cached = cutout_cache_path(path, extra)
    if not os.path.exists(cached):
        from rembg import new_session, remove

        session = new_session() if not model else new_session(model)
        res = remove(
            Image.open(path).convert("RGBA"),
            session=session,
            alpha_matting=alpha,
            alpha_matting_foreground_threshold=fg,
            alpha_matting_background_threshold=bgt,
            alpha_matting_erode_size=erode,
        )
        try:
            res.save(cached, "PNG")
        except Exception:
            pass
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
    idxs = sample_indices(n, COLS)
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

    for name in present:
        row = ANIMATIONS[name]["row"]
        log(f"GIF: {name}…")
        frames, durs = gif_frames(gifs[name], COLS)
        durs = [max(120, d) for d in durs]
        for i, fr in enumerate(frames):
            if remove_bg:
                from rembg import new_session, remove

                model = bg.get("model") or ""
                sessions = session_box["sessions"]
                skey = model or "__default__"
                if skey not in sessions:
                    log(f"Загрузка модели ({model or 'default'})…")
                    sessions[skey] = new_session() if not model else new_session(model)
                fr = remove(
                    fr,
                    session=sessions[skey],
                    alpha_matting=bool(bg.get("alphaMatting")),
                    alpha_matting_foreground_threshold=int(bg.get("fgThreshold") or 240),
                    alpha_matting_background_threshold=int(bg.get("bgThreshold") or 10),
                    alpha_matting_erode_size=int(bg.get("erode") or 10),
                )
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

    log("Сборка спрайт-листа…")
    sheet, animations, default_anim = build_sheet(
        rows, frame_w, frame_h, transforms, consistent, bg, disabled, anim_options
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

    if action == "export-animation":
        anim = payload.get("animation") or default_anim
        fmt = payload.get("format") or "gif"
        if anim not in animations:
            raise RuntimeError(f"Анимация «{anim}» не собрана (нет фото или выключена)")
        path = export_animation(
            sheet, frame_w, frame_h, anim, fmt, out_dir, label, anim_options
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
