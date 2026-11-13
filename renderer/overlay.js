let data = null;
let frame = 0;
let timer = null;

function urlFor(p) {
  const norm = String(p).replace(/\\/g, '/');
  return (
    'file:///' +
    norm
      .split('/')
      .map((seg, i) => (i === 0 ? seg : encodeURIComponent(seg)))
      .join('/')
  );
}

function tick() {
  if (!data) return;
  const anim = data.animations[data.animation] || data.animations[data.defaultAnimation];
  if (!anim) return;
  const idx = frame % Math.max(1, anim.frames);
  const scale = data.scale || 1;
  const el = document.getElementById('pet');
  el.style.backgroundImage = 'url("' + urlFor(data.previewPath) + '")';
  el.style.backgroundSize = data.sheetWidth * scale + 'px ' + data.sheetHeight * scale + 'px';
  el.style.backgroundPosition =
    '-' + idx * data.frameWidth * scale + 'px -' + anim.row * data.frameHeight * scale + 'px';
  const delay = (anim.frameDurationsMs && anim.frameDurationsMs[idx]) || 150;
  frame = (frame + 1) % Math.max(1, anim.frames);
  timer = setTimeout(tick, delay);
}

window.api.onOverlayData((d) => {
  data = d;
  data.animation = d.animation || d.defaultAnimation;
  frame = 0;
  if (timer) clearTimeout(timer);
  tick();
});

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') window.api.closeOverlay();
});

document.getElementById('close').addEventListener('click', (e) => {
  e.stopPropagation();
  window.api.closeOverlay();
});
window.focus();
