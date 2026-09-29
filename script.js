/* script.js — antarmuka: pratinjau, penyisipan, ekstraksi, dan uji ketahanan. */
'use strict';
const $ = id => document.getElementById(id);
const stageCanvas = $('canvas');
const sctx = stageCanvas.getContext('2d', { willReadFrequently: true });

const METHOD_NAME = { lsbdct: 'LSB-DCT', lsbdwt: 'LSB-DWT', lsbdctdwt: 'LSB-DCT-DWT' };
const METHODS = ['lsbdct', 'lsbdwt', 'lsbdctdwt'];
const state = {
  img: null, name: 'foto', logo: null, wmLogo: null,
  mode: 'single', pos: 8,
  deltas: { lsbdct: 40, lsbdwt: 5, lsbdctdwt: 40 },
  result: null,
  extSource: null, extBits: null,
  imp: [], rows: [],
};

// ---------- utilitas canvas ----------
const makeCanvas = (w, h) => { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; };
const ctx2d = c => c.getContext('2d', { willReadFrequently: true });
function toCanvas(img) {
  const c = makeCanvas(img.width, img.height);
  ctx2d(c).putImageData(new ImageData(new Uint8ClampedArray(img.data), img.width, img.height), 0, 0);
  return c;
}
const fromCanvas = c => ctx2d(c).getImageData(0, 0, c.width, c.height);
const nextFrame = () => new Promise(r => requestAnimationFrame(() => setTimeout(r, 0)));

function download(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
function setStatus(id, text, isError = false) {
  const el = $(id); el.textContent = text; el.classList.toggle('error', isError);
}
function loadImage(file, onOk, statusId) {
  if (!file || !file.type.startsWith('image/')) { setStatus(statusId, 'Berkas itu bukan gambar. Pilih JPG, PNG, atau WEBP.', true); return; }
  const url = URL.createObjectURL(file);
  const img = new Image();
  img.onload = () => onOk(img);
  img.onerror = () => setStatus(statusId, 'Gambar tidak bisa dibuka. Coba berkas lain.', true);
  img.src = url;
}
const fmt = (v, d) => (v === Infinity ? '∞' : v.toFixed(d));

// ---------- tab ----------
document.querySelectorAll('[role=tab]').forEach(t => t.onclick = () => {
  document.querySelectorAll('[role=tab]').forEach(x => x.setAttribute('aria-selected', x === t));
  ['embed', 'extract', 'attack'].forEach(n => $('tab-' + n).hidden = n !== t.dataset.tab);
});

// ---------- citra dasar ----------
function baseSize() {
  if (!state.img) return null;
  return $('square').checked ? { w: 512, h: 512 } : { w: state.img.naturalWidth, h: state.img.naturalHeight };
}
function drawBase(ctx, w, h) {
  const img = state.img;
  if ($('square').checked) {
    const s = Math.min(img.naturalWidth, img.naturalHeight);
    ctx.drawImage(img, (img.naturalWidth - s) / 2, (img.naturalHeight - s) / 2, s, s, 0, 0, w, h);
  } else ctx.drawImage(img, 0, 0, w, h);
}

function setPhoto(file) {
  loadImage(file, img => {
    state.img = img;
    state.name = file.name.replace(/\.[^.]+$/, '') || 'foto';
    $('stage').classList.add('has');
    ['applyBtn', 'runBtn'].forEach(id => $(id).disabled = false);
    setStatus('embedStatus', '');
    renderPreview();
  }, 'embedStatus');
}
$('pickBtn').onclick = $('pickBtn2').onclick = () => $('photoFile').click();
$('photoFile').onchange = e => { setPhoto(e.target.files[0]); e.target.value = ''; };
const stage = $('stage');
['dragenter', 'dragover'].forEach(ev => stage.addEventListener(ev, e => { e.preventDefault(); stage.classList.add('drag'); }));
['dragleave', 'drop'].forEach(ev => stage.addEventListener(ev, e => { e.preventDefault(); stage.classList.remove('drag'); }));
stage.addEventListener('drop', e => { if (e.dataTransfer.files[0]) setPhoto(e.dataTransfer.files[0]); });

// ---------- watermark terlihat ----------
const posNames = ['Kiri atas', 'Tengah atas', 'Kanan atas', 'Kiri tengah', 'Tengah', 'Kanan tengah', 'Kiri bawah', 'Tengah bawah', 'Kanan bawah'];
posNames.forEach((n, i) => {
  const b = document.createElement('button');
  b.type = 'button'; b.title = n; b.setAttribute('aria-label', n);
  b.setAttribute('aria-pressed', i === state.pos);
  b.onclick = () => {
    state.pos = i;
    [...$('grid9').children].forEach((c, j) => c.setAttribute('aria-pressed', j === i));
    renderPreview();
  };
  $('grid9').appendChild(b);
});
document.querySelectorAll('[data-mode]').forEach(b => b.onclick = () => {
  state.mode = b.dataset.mode;
  document.querySelectorAll('[data-mode]').forEach(x => x.setAttribute('aria-pressed', x === b));
  $('posWrap').hidden = state.mode !== 'single';
  $('tileWrap').hidden = state.mode !== 'tile';
  renderPreview();
});
$('logoBtn').onclick = () => $('logoFile').click();
$('logoFile').onchange = e => {
  const f = e.target.files[0]; e.target.value = '';
  loadImage(f, img => {
    state.logo = img; $('logoOpts').hidden = false; $('logoClear').hidden = false;
    $('logoBtn').textContent = 'Ganti logo'; renderPreview();
  }, 'embedStatus');
};
$('logoClear').onclick = () => {
  state.logo = null; $('logoOpts').hidden = true; $('logoClear').hidden = true;
  $('logoBtn').textContent = 'Pilih logo'; renderPreview();
};

function stampMetrics(ctx, W) {
  const text = $('text').value;
  const fontPx = Math.max(8, W * (+$('size').value) / 100);
  ctx.font = `700 ${fontPx}px ${$('font').value}`;
  const tw = text ? ctx.measureText(text).width : 0;
  let lw = 0, lh = 0;
  if (state.logo) {
    lw = W * (+$('logoSize').value) / 100;
    lh = lw * state.logo.naturalHeight / state.logo.naturalWidth;
  }
  const gap = (state.logo && text) ? fontPx * 0.4 : 0;
  return { text, fontPx, tw, lw, lh, gap, w: lw + gap + tw, h: Math.max(lh, fontPx) };
}
function drawStamp(ctx, m) {
  const x0 = -m.w / 2;
  if (state.logo) ctx.drawImage(state.logo, x0, -m.lh / 2, m.lw, m.lh);
  if (m.text) {
    ctx.fillStyle = $('color').value;
    ctx.textBaseline = 'middle'; ctx.textAlign = 'left';
    ctx.fillText(m.text, x0 + m.lw + m.gap, 0);
  }
}
function drawVisible(ctx, W, H) {
  const m = stampMetrics(ctx, W);
  if (!m.w) return;
  const rot = (+$('rotate').value) * Math.PI / 180;
  ctx.save();
  ctx.globalAlpha = (+$('opacity').value) / 100;
  if ($('shadow').checked) {
    ctx.shadowColor = 'rgba(0,0,0,.55)';
    ctx.shadowBlur = m.fontPx * 0.15;
    ctx.shadowOffsetX = ctx.shadowOffsetY = m.fontPx * 0.04;
  }
  if (state.mode === 'single') {
    const margin = Math.min(W, H) * (+$('margin').value) / 100;
    const bw = Math.abs(m.w * Math.cos(rot)) + Math.abs(m.h * Math.sin(rot));
    const bh = Math.abs(m.w * Math.sin(rot)) + Math.abs(m.h * Math.cos(rot));
    const col = state.pos % 3, row = Math.floor(state.pos / 3);
    const cx = [margin + bw / 2, W / 2, W - margin - bw / 2][col];
    const cy = [margin + bh / 2, H / 2, H - margin - bh / 2][row];
    ctx.translate(cx, cy); ctx.rotate(rot);
    drawStamp(ctx, m);
  } else {
    const g = +$('gap').value;
    const stepX = m.w + m.fontPx * g, stepY = m.h + m.fontPx * g;
    const diag = Math.hypot(W, H);
    ctx.translate(W / 2, H / 2); ctx.rotate(rot);
    let r = 0;
    for (let y = -diag / 2; y <= diag / 2 + stepY; y += stepY, r++) {
      const off = (r % 2) * stepX / 2;
      for (let x = -diag / 2 - stepX; x <= diag / 2 + stepX; x += stepX) {
        ctx.save(); ctx.translate(x + off, y); drawStamp(ctx, m); ctx.restore();
      }
    }
  }
  ctx.restore();
}

// citra sebelum watermark tersembunyi (foto + watermark terlihat)
function composePre() {
  const { w, h } = baseSize();
  const c = makeCanvas(w, h), ctx = ctx2d(c);
  drawBase(ctx, w, h);
  if ($('visOn').checked) drawVisible(ctx, w, h);
  return fromCanvas(c);
}

function updateOutputs() {
  $('sizeOut').textContent = $('size').value + '%';
  $('opacityOut').textContent = $('opacity').value + '%';
  $('rotateOut').textContent = $('rotate').value + '°';
  $('marginOut').textContent = $('margin').value + '%';
  $('gapOut').textContent = $('gap').value;
  $('logoSizeOut').textContent = $('logoSize').value + '%';
  $('deltaOut').textContent = $('delta').value;
  $('visOpts').hidden = !$('visOn').checked;
}

function clearMetrics() {
  ['mPsnr', 'mSsim', 'mEnt', 'mNc'].forEach(id => $(id).textContent = '–');
}

function renderPreview() {
  updateOutputs();
  if (!state.img) return;
  const { w, h } = baseSize();
  stageCanvas.width = w; stageCanvas.height = h;
  sctx.putImageData(composePre(), 0, 0);
  const n = state.img;
  $('info').textContent = `${n.naturalWidth}×${n.naturalHeight} px` + ($('square').checked ? ', diolah menjadi 512×512 px' : '');
  if (state.result) {
    state.result = null;
    clearMetrics();
    $('saveBtn').disabled = true;
    setStatus('embedStatus', 'Pengaturan berubah. Tekan "Sisipkan dan ukur" lagi.');
  }
}

['text', 'font', 'size', 'opacity', 'rotate', 'color', 'shadow', 'margin', 'gap', 'logoSize', 'visOn', 'square']
  .forEach(id => $(id).addEventListener('input', renderPreview));
if (document.fonts) {
  document.fonts.ready.then(renderPreview);
  $('font').addEventListener('change', () => document.fonts.load(`700 40px ${$('font').value}`).then(renderPreview).catch(() => {}));
}

// ---------- watermark tersembunyi ----------
function wmSize() { return +$('wmSize').value; }
function params(method = $('method').value) {
  return { method, key: $('key').value, delta: state.deltas[method] };
}

function wmBits() {
  const N = wmSize();
  const c = makeCanvas(N, N), ctx = ctx2d(c);
  ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, N, N);
  if (state.wmLogo) {
    const L = state.wmLogo, s = Math.min(N / L.naturalWidth, N / L.naturalHeight);
    const lw = L.naturalWidth * s, lh = L.naturalHeight * s;
    ctx.drawImage(L, (N - lw) / 2, (N - lh) / 2, lw, lh);
  } else {
    const t = $('wmText').value.trim();
    ctx.font = `800 ${N}px sans-serif`;
    const tw = ctx.measureText(t).width || 1;
    const size = Math.min(N * 0.95, N * 0.92 * N / tw);
    ctx.font = `800 ${size}px sans-serif`;
    ctx.fillStyle = '#000'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(t, N / 2, N / 2 + size * 0.05);
  }
  const d = ctx.getImageData(0, 0, N, N).data;
  const bits = new Uint8Array(N * N);
  for (let i = 0; i < N * N; i++) {
    const p = i * 4;
    const lum = (0.299 * d[p] + 0.587 * d[p + 1] + 0.114 * d[p + 2]) * d[p + 3] / 255 + 255 * (1 - d[p + 3] / 255);
    bits[i] = lum < 128 ? 1 : 0;
  }
  return bits;
}
function drawBits(canvas, bits, N) {
  canvas.width = N; canvas.height = N;
  const ctx = ctx2d(canvas), im = ctx.createImageData(N, N);
  for (let i = 0; i < N * N; i++) {
    const v = bits[i] ? 0 : 255, p = i * 4;
    im.data[p] = im.data[p + 1] = im.data[p + 2] = v; im.data[p + 3] = 255;
  }
  ctx.putImageData(im, 0, 0);
}
function refreshWm() {
  drawBits($('wmCanvas'), wmBits(), wmSize());
  renderPreview();
}

function syncDelta() {
  const m = $('method').value;
  $('delta').value = state.deltas[m];
  $('deltaHint').textContent = 'Δ lebih besar membuat watermark lebih tahan serangan, tetapi PSNR turun. '
    + 'Nilai Δ disimpan terpisah untuk tiap metode.';
  updateOutputs();
}
$('method').addEventListener('change', () => { syncDelta(); renderPreview(); });
$('delta').addEventListener('input', () => { state.deltas[$('method').value] = +$('delta').value; renderPreview(); });
['wmText', 'wmSize', 'key', 'invOn'].forEach(id => $(id).addEventListener('input', refreshWm));
$('wmLogoBtn').onclick = () => $('wmLogoFile').click();
$('wmLogoFile').onchange = e => {
  const f = e.target.files[0]; e.target.value = '';
  loadImage(f, img => {
    state.wmLogo = img; $('wmLogoClear').hidden = false; $('wmText').disabled = true; refreshWm();
  }, 'embedStatus');
};
$('wmLogoClear').onclick = () => {
  state.wmLogo = null; $('wmLogoClear').hidden = true; $('wmText').disabled = false; refreshWm();
};

function capacityError(w, h, method) {
  const N = wmSize();
  if (WM.capacity(w, h, method) >= N * N) return '';
  const s = WM.minSide(N, method);
  return `Foto ${w}×${h} px terlalu kecil untuk watermark ${N}×${N} bit dengan metode ${METHOD_NAME[method]}. ` +
         `Gunakan foto minimal ${s}×${s} px atau pilih ukuran watermark 16×16.`;
}
function bitsEmpty(bits) { return !bits.some(b => b); }

// ---------- sisipkan ----------
$('applyBtn').onclick = async () => {
  if (!state.img) return;
  const { w, h } = baseSize();
  const pre = composePre();
  stageCanvas.width = w; stageCanvas.height = h;
  clearMetrics();

  if (!$('invOn').checked) {
    sctx.putImageData(pre, 0, 0);
    state.result = { pre, post: pre, bits: null };
    $('saveBtn').disabled = false;
    setStatus('embedStatus', 'Hanya watermark terlihat yang diterapkan.');
    return;
  }
  const p = params();
  const err = capacityError(w, h, p.method);
  if (err) { sctx.putImageData(pre, 0, 0); setStatus('embedStatus', err, true); return; }
  const bits = wmBits();
  if (bitsEmpty(bits)) { setStatus('embedStatus', 'Pola watermark kosong. Isi teks watermark atau pilih logo.', true); return; }

  $('applyBtn').disabled = true;
  setStatus('embedStatus', 'Menyisipkan dan mengukur…');
  await nextFrame();
  try {
    const t0 = performance.now();
    const post = WM.embed(pre, bits, p);
    const ext = WM.extract(post, bits.length, p);
    const r = {
      pre, post, bits, ...p, N: wmSize(),
      psnr: WM.psnr(pre, post), ssim: WM.ssim(pre, post),
      entPre: WM.entropy(pre), entPost: WM.entropy(post),
      nc: WM.nc(bits, ext), ber: WM.ber(bits, ext),
    };
    sctx.putImageData(new ImageData(post.data, w, h), 0, 0);
    state.result = r;
    $('mPsnr').textContent = fmt(r.psnr, 2) + ' dB';
    $('mSsim').textContent = fmt(r.ssim, 4);
    $('mEnt').textContent = fmt(r.entPost, 4);
    $('mNc').textContent = fmt(r.nc, 4);
    $('embedHint').textContent = `Entropi citra asli ${fmt(r.entPre, 4)} bit/piksel, setelah disisipi `
      + `${fmt(r.entPost, 4)} bit/piksel (selisih ${fmt(r.entPost - r.entPre, 4)}). `
      + 'PSNR dan SSIM membandingkan foto sebelum dan sesudah penyisipan; NC diukur dari ekstraksi tanpa serangan.';
    $('extW').value = w; $('extH').value = h;
    $('saveBtn').disabled = false;
    setStatus('embedStatus', `Selesai dengan ${METHOD_NAME[p.method]} dalam ${Math.round(performance.now() - t0)} ms. Simpan sebagai PNG agar watermark tersembunyi tidak rusak.`);
  } catch (e) {
    setStatus('embedStatus', 'Penyisipan gagal: ' + e.message, true);
  } finally {
    $('applyBtn').disabled = false;
  }
};

$('saveBtn').onclick = () => {
  const r = state.result;
  if (!r) return;
  const f = $('format').value;
  let c = toCanvas(r.post);
  if (f === 'jpg') {
    const j = makeCanvas(c.width, c.height), jc = ctx2d(j);
    jc.fillStyle = '#fff'; jc.fillRect(0, 0, j.width, j.height); jc.drawImage(c, 0, 0);
    c = j;
  }
  const tag = r.bits ? `-${r.method}` : '';
  c.toBlob(b => {
    download(b, `${state.name}-watermark${tag}.${f}`);
    setStatus('embedStatus', f === 'jpg'
      ? 'Foto tersimpan sebagai JPG. Kompresi JPG bisa merusak watermark tersembunyi, terutama LSB.'
      : 'Foto tersimpan.');
  }, f === 'jpg' ? 'image/jpeg' : 'image/png', 0.92);
};

// ---------- ekstraksi ----------
async function runExtract() {
  const src = state.extSource;
  if (!src) return;
  const W = +$('extW').value, H = +$('extH').value;
  if (!W || !H) { setStatus('extStatus', 'Isi ukuran foto saat disisipkan.', true); return; }
  const p = params();
  const err = capacityError(W, H, p.method);
  if (err) { setStatus('extStatus', err, true); return; }
  const c = makeCanvas(W, H), ctx = ctx2d(c);
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(src, 0, 0, W, H);
  const bits = wmBits(), N = wmSize();
  const ext = WM.extract(fromCanvas(c), bits.length, p);
  state.extBits = { ext, N };
  drawBits($('extOrig'), bits, N);
  drawBits($('extOut'), ext, N);
  $('eNc').textContent = fmt(WM.nc(bits, ext), 4);
  $('eEnt').textContent = fmt(WM.bitEntropy(ext), 4);
  $('extSave').disabled = false;
  $('extRunBtn').disabled = false;
  setStatus('extStatus', `Diekstraksi dengan ${METHOD_NAME[p.method]}, Δ = ${p.delta}. `
    + `Entropi watermark asli ${fmt(WM.bitEntropy(bits), 4)} bit; makin jauh dari nilai itu, makin rusak hasilnya.`);
}
$('extFileBtn').onclick = () => $('extFile').click();
$('extFile').onchange = e => {
  const f = e.target.files[0]; e.target.value = '';
  loadImage(f, img => {
    state.extSource = img;
    if (!$('extW').value) { $('extW').value = img.naturalWidth; $('extH').value = img.naturalHeight; }
    runExtract();
  }, 'extStatus');
};
$('extUseBtn').onclick = () => {
  if (!state.result || !state.result.bits) {
    setStatus('extStatus', 'Belum ada hasil sisipan. Sisipkan watermark tersembunyi dulu di tab Sisipkan.', true);
    return;
  }
  state.extSource = toCanvas(state.result.post);
  $('extW').value = state.result.post.width; $('extH').value = state.result.post.height;
  runExtract();
};
$('extRunBtn').onclick = runExtract;
$('extSave').onclick = () => {
  if (!state.extBits) return;
  const { ext, N } = state.extBits;
  const small = makeCanvas(N, N); drawBits(small, ext, N);
  const big = makeCanvas(N * 8, N * 8), bc = ctx2d(big);
  bc.imageSmoothingEnabled = false; bc.drawImage(small, 0, 0, N * 8, N * 8);
  big.toBlob(b => download(b, `ekstraksi-${$('method').value}.png`), 'image/png');
};

// ---------- serangan berbasis canvas ----------
async function atkJpeg(img, q) {
  const blob = await new Promise(r => toCanvas(img).toBlob(r, 'image/jpeg', q));
  const bmp = await createImageBitmap(blob);
  const o = makeCanvas(img.width, img.height);
  ctx2d(o).drawImage(bmp, 0, 0);
  return fromCanvas(o);
}
function atkScale(img, s) {
  const src = toCanvas(img);
  const m = makeCanvas(Math.max(1, Math.round(img.width * s)), Math.max(1, Math.round(img.height * s)));
  const mc = ctx2d(m); mc.imageSmoothingQuality = 'high'; mc.drawImage(src, 0, 0, m.width, m.height);
  const o = makeCanvas(img.width, img.height);
  const oc = ctx2d(o); oc.imageSmoothingQuality = 'high'; oc.drawImage(m, 0, 0, img.width, img.height);
  return fromCanvas(o);
}
function atkRotate(img, deg) {
  const once = (src, a) => {
    const o = makeCanvas(img.width, img.height), c = ctx2d(o);
    c.fillStyle = '#000'; c.fillRect(0, 0, o.width, o.height);
    c.translate(o.width / 2, o.height / 2); c.rotate(a);
    c.drawImage(src, -o.width / 2, -o.height / 2);
    return o;
  };
  const r = deg * Math.PI / 180;
  return fromCanvas(once(once(toCanvas(img), r), -r));
}

const A = WM.attacks;
const ATTACKS = [
  { name: 'Tanpa serangan', param: '–', run: d => d },
  { name: 'Kompresi JPEG', param: 'Q = 90', run: d => atkJpeg(d, 0.9) },
  { name: 'Kompresi JPEG', param: 'Q = 70', run: d => atkJpeg(d, 0.7) },
  { name: 'Kompresi JPEG', param: 'Q = 50', run: d => atkJpeg(d, 0.5) },
  { name: 'Noise Gaussian', param: 'σ = 5', run: d => A.noise(d, 5) },
  { name: 'Salt & pepper', param: '1%', run: d => A.saltPepper(d, 0.01) },
  { name: 'Salt & pepper', param: '5%', run: d => A.saltPepper(d, 0.05) },
  { name: 'Filter rata-rata', param: '3×3', run: d => A.filter3(d, 'mean') },
  { name: 'Filter median', param: '3×3', run: d => A.filter3(d, 'median') },
  { name: 'Penskalaan', param: '0,5× lalu kembali', run: d => atkScale(d, 0.5) },
  { name: 'Cropping', param: '25% luas', run: d => A.crop(d, 0.25) },
  { name: 'Rotasi', param: '5° lalu kembali', run: d => atkRotate(d, 5) },
  { name: 'Kontras', param: '1,2×', run: d => A.contrast(d, 1.2) },
  { name: 'Koreksi gamma', param: 'γ = 0,8', run: d => A.gamma(d, 0.8) },
];

// ---------- uji ketahanan ----------
$('runBtn').onclick = async () => {
  if (!state.img) return;
  const { w, h } = baseSize();
  const methods = $('allMethods').checked ? METHODS.slice() : [$('method').value];
  const bits = wmBits(), N = wmSize();
  if (bitsEmpty(bits)) { setStatus('attStatus', 'Pola watermark kosong. Isi teks watermark atau pilih logo.', true); return; }
  const usable = methods.filter(m => !capacityError(w, h, m));
  if (!usable.length) { setStatus('attStatus', capacityError(w, h, methods[0]), true); return; }

  $('runBtn').disabled = true; $('csvBtn').disabled = true;
  const prog = $('prog');
  prog.hidden = false; prog.max = usable.length * ATTACKS.length; prog.value = 0;
  setStatus('attStatus', 'Menjalankan pengujian…');
  await nextFrame();

  const pre = composePre();
  const imp = [], rows = [];
  try {
    for (const m of usable) {
      const p = params(m);
      const post = WM.embed(pre, bits, p);
      imp.push({ method: m, delta: p.delta, psnr: WM.psnr(pre, post), ssim: WM.ssim(pre, post), ent: WM.entropy(post) });
      for (const a of ATTACKS) {
        setStatus('attStatus', `${METHOD_NAME[m]}: ${a.name} ${a.param === '–' ? '' : a.param}`);
        const attacked = await a.run(post);
        const ext = WM.extract(attacked, bits.length, p);
        rows.push({ method: m, attack: a.name, param: a.param, nc: WM.nc(bits, ext), ent: WM.bitEntropy(ext), ext });
        prog.value++;
        await nextFrame();
      }
    }
    state.imp = imp; state.rows = rows; state.testN = N; state.testMethods = usable;
    state.entPre = WM.entropy(pre); state.entWm = WM.bitEntropy(bits);
    renderTables(bits);
    const skipped = methods.filter(m => !usable.includes(m));
    setStatus('attStatus', `Selesai: ${rows.length} pengujian pada foto ${w}×${h} px, watermark ${N}×${N} bit.` +
      (skipped.length ? ` ${skipped.map(m => METHOD_NAME[m]).join(', ')} dilewati karena foto terlalu kecil.` : ''));
    $('csvBtn').disabled = false;
  } catch (e) {
    setStatus('attStatus', 'Pengujian gagal: ' + e.message, true);
  } finally {
    $('runBtn').disabled = false; prog.hidden = true;
  }
};

function el(tag, text, cls) {
  const e = document.createElement(tag);
  if (text != null) e.textContent = text;
  if (cls) e.className = cls;
  return e;
}

function renderTables(bits) {
  const imp = $('impTable'); imp.innerHTML = '';
  imp.appendChild(el('caption', 'Kualitas citra (imperceptibility)'));
  const ih = imp.createTHead().insertRow();
  ['Metode', 'Δ', 'PSNR (dB)', 'SSIM', 'Entropi', 'ΔEntropi'].forEach(t => ih.appendChild(el('th', t)));
  const ib = imp.createTBody();
  state.imp.forEach(r => {
    const tr = ib.insertRow();
    [METHOD_NAME[r.method], r.delta ?? '–', fmt(r.psnr, 2), fmt(r.ssim, 4),
     fmt(r.ent, 4), fmt(r.ent - state.entPre, 4)].forEach(v => tr.appendChild(el('td', String(v))));
  });

  const t = $('attTable'); t.innerHTML = '';
  t.appendChild(el('caption', 'Ketahanan terhadap serangan (robustness)'));
  const head = t.createTHead();
  const h1 = head.insertRow(), h2 = head.insertRow();
  const th1 = el('th', 'Serangan'); th1.rowSpan = 2; h1.appendChild(th1);
  const th2 = el('th', 'Parameter'); th2.rowSpan = 2; h1.appendChild(th2);
  state.testMethods.forEach(m => {
    const th = el('th', METHOD_NAME[m]); th.colSpan = 3; h1.appendChild(th);
    h2.appendChild(el('th', 'NC', 'sep')); h2.appendChild(el('th', 'Entropi')); h2.appendChild(el('th', 'Hasil'));
  });
  const body = t.createTBody();
  ATTACKS.forEach((a, ai) => {
    const tr = body.insertRow();
    tr.appendChild(el('td', a.name)); tr.appendChild(el('td', a.param));
    state.testMethods.forEach((m, mi) => {
      const r = state.rows[mi * ATTACKS.length + ai];
      tr.appendChild(el('td', fmt(r.nc, 4), 'sep' + (r.nc < 0.8 ? ' low' : '')));
      tr.appendChild(el('td', fmt(r.ent, 4)));
      const td = el('td'); const c = document.createElement('canvas');
      drawBits(c, r.ext, state.testN); td.appendChild(c); tr.appendChild(td);
    });
  });
  const note = el('p', `NC di bawah 0,8 ditandai merah sebagai watermark yang sulit dikenali. `
    + `Entropi citra asli ${fmt(state.entPre, 4)} bit/piksel; entropi watermark asli ${fmt(state.entWm, 4)} bit.`, 'hint');
  t.parentElement.querySelector('p')?.remove();
  t.parentElement.appendChild(note);
}

$('csvBtn').onclick = () => {
  const lines = ['metode,delta,psnr_db,ssim,entropi_citra,delta_entropi,serangan,parameter,nc,entropi_wm'];
  const q = s => `"${String(s).replace(/"/g, '""')}"`;
  state.rows.forEach(r => {
    const i = state.imp.find(x => x.method === r.method);
    lines.push([METHOD_NAME[r.method], i.delta ?? '', fmt(i.psnr, 4), i.ssim.toFixed(6),
      i.ent.toFixed(6), (i.ent - state.entPre).toFixed(6),
      q(r.attack), q(r.param), r.nc.toFixed(6), r.ent.toFixed(6)].join(','));
  });
  download(new Blob(['\ufeff' + lines.join('\n')], { type: 'text/csv' }), `hasil-uji-${state.name}.csv`);
};

// ---------- mulai ----------
syncDelta();
refreshWm();
