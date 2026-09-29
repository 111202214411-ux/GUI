/*
 * core.js — algoritma watermark tersembunyi, metrik, dan serangan piksel.
 *
 * Ketiga metode memakai penyisipan LSB pada ranah transformasi: koefisien
 * dikuantisasi dengan langkah δ = Δ/2, lalu bit terakhir (LSB) indeks
 * kuantisasi q = round(c/δ) diganti dengan bit watermark, dipilih indeks
 * terdekat agar distorsi minimum. Karena kisi bit 0 berada pada kelipatan
 * genap δ dan kisi bit 1 pada kelipatan ganjil δ, penyisipan ini setara
 * dengan Quantization Index Modulation berlangkah Δ = 2δ.
 *
 *  - LSB-DCT     : DCT 8x8 langsung pada luminansi (Y) citra. LSB disisipkan
 *                  pada koefisien frekuensi menengah (baris 2, kolom 1).
 *  - LSB-DWT     : Haar DWT level 1 pada Y. Subband LL dibagi blok 8x8; LSB
 *                  disisipkan pada rata-rata tiap blok (setara komponen DC).
 *  - LSB-DCT-DWT : Haar DWT level 1 pada Y, lalu DCT 8x8 pada blok subband LL.
 *                  LSB disisipkan pada koefisien frekuensi menengah (2, 1).
 *
 * Urutan blok diacak dengan kunci (permutasi Fisher–Yates, PRNG mulberry32).
 * Ekstraksi bersifat blind: hanya butuh metode, kunci, ukuran watermark, dan Δ.
 * Perubahan luminansi ΔY ditambahkan sama rata ke R, G, B sehingga Cb dan Cr tetap.
 */
(function (root) {
  'use strict';

  const BLOCK = 8;
  const DCT_U = 2, DCT_V = 1; // posisi koefisien yang dipakai (baris, kolom)

  // ---------- PRNG dan pengacakan berbasis kunci ----------
  function hashKey(str) {
    let h = 2166136261 >>> 0;
    for (const ch of String(str)) {
      h ^= ch.codePointAt(0);
      h = Math.imul(h, 16777619) >>> 0;
    }
    return h;
  }
  function mulberry32(a) {
    return function () {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  function permutation(n, key) {
    const p = new Uint32Array(n);
    for (let i = 0; i < n; i++) p[i] = i;
    const r = mulberry32(hashKey(key));
    for (let i = n - 1; i > 0; i--) {
      const j = Math.floor(r() * (i + 1));
      const t = p[i]; p[i] = p[j]; p[j] = t;
    }
    return p;
  }
  // ---------- Penyisipan LSB pada indeks kuantisasi ----------
  // Kisi bit 0 = kelipatan genap δ (= kelipatan Δ), kisi bit 1 = kelipatan
  // ganjil δ (= kelipatan Δ digeser Δ/2), dengan δ = Δ/2.
  function lsbEmbed(x, bit, D) {
    const o = bit ? D / 2 : 0;
    return D * Math.round((x - o) / D) + o;
  }
  function lsbExtract(x, D) {
    return Math.abs(x - lsbEmbed(x, 1, D)) < Math.abs(x - lsbEmbed(x, 0, D)) ? 1 : 0;
  }

  // ---------- Basis DCT 8x8 ortonormal untuk satu koefisien ----------
  const BASIS = new Float64Array(BLOCK * BLOCK);
  (function () {
    const a = u => (u === 0 ? Math.sqrt(1 / BLOCK) : Math.sqrt(2 / BLOCK));
    for (let y = 0; y < BLOCK; y++)
      for (let x = 0; x < BLOCK; x++)
        BASIS[y * BLOCK + x] =
          a(DCT_U) * Math.cos(((2 * y + 1) * DCT_U * Math.PI) / (2 * BLOCK)) *
          a(DCT_V) * Math.cos(((2 * x + 1) * DCT_V * Math.PI) / (2 * BLOCK));
  })();

  // ---------- Geometri dan kapasitas ----------
  // LSB-DCT memblok citra langsung; dua metode lain memblok subband LL
  // yang berukuran setengah citra.
  const shrink = method => (method === 'lsbdct' ? 1 : 2);
  function layout(w, h, method) {
    const s = shrink(method);
    const cols = Math.floor(Math.floor(w / s) / BLOCK);
    const rows = Math.floor(Math.floor(h / s) / BLOCK);
    return { cols, rows, count: cols * rows };
  }
  function capacity(w, h, method) {
    return layout(w, h, method).count;
  }
  // sisi minimum (persegi) agar watermark N×N muat
  function minSide(N, method) { return shrink(method) * BLOCK * N; }

  function copyImage(img) {
    return { data: new Uint8ClampedArray(img.data), width: img.width, height: img.height };
  }

  const luma = (d, p) => 0.299 * d[p] + 0.587 * d[p + 1] + 0.114 * d[p + 2];

  // koefisien LL Haar ortonormal pada koordinat LL (i = baris, j = kolom)
  function llAt(d, w, i, j) {
    const r0 = (2 * i) * w, r1 = (2 * i + 1) * w, c0 = 2 * j, c1 = 2 * j + 1;
    return (luma(d, (r0 + c0) * 4) + luma(d, (r0 + c1) * 4) +
            luma(d, (r1 + c0) * 4) + luma(d, (r1 + c1) * 4)) / 2;
  }

  // nilai sel (i, j) pada bidang kerja: piksel Y untuk LSB-DCT, koefisien LL
  // untuk dua metode lain
  function cellAt(d, w, method, i, j) {
    return method === 'lsbdct' ? luma(d, (i * w + j) * 4) : llAt(d, w, i, j);
  }

  function blockFeature(d, w, bx, by, method) {
    let s = 0;
    for (let y = 0; y < BLOCK; y++)
      for (let x = 0; x < BLOCK; x++) {
        const v = cellAt(d, w, method, by * BLOCK + y, bx * BLOCK + x);
        s += method === 'lsbdwt' ? v : v * BASIS[y * BLOCK + x];
      }
    return method === 'lsbdwt' ? s / (BLOCK * BLOCK) : s;
  }

  // tambahkan perubahan df pada fitur blok -> perubahan piksel
  function applyDelta(d, w, bx, by, method, df) {
    for (let y = 0; y < BLOCK; y++)
      for (let x = 0; x < BLOCK; x++) {
        const dc = method === 'lsbdwt' ? df : df * BASIS[y * BLOCK + x];
        const i = by * BLOCK + y, j = bx * BLOCK + x;
        if (method === 'lsbdct') {
          // Uint8Clamped: dibulatkan dan dibatasi 0–255
          const p = (i * w + j) * 4;
          d[p] += dc; d[p + 1] += dc; d[p + 2] += dc;
        } else {
          const dY = dc / 2; // invers Haar: tiap piksel 2x2 menerima dLL/2
          for (let a = 0; a < 2; a++)
            for (let b = 0; b < 2; b++) {
              const p = ((2 * i + a) * w + (2 * j + b)) * 4;
              d[p] += dY; d[p + 1] += dY; d[p + 2] += dY;
            }
        }
      }
  }

  function embed(img, bits, opt) {
    const out = copyImage(img);
    const d = out.data, w = out.width, h = out.height, n = bits.length;
    if (capacity(w, h, opt.method) < n) throw new Error('capacity');

    const L = layout(w, h, opt.method);
    const perm = permutation(L.count, opt.key);
    const D = opt.delta;
    for (let k = 0; k < n; k++) {
      const bi = perm[k], bx = bi % L.cols, by = Math.floor(bi / L.cols);
      // beberapa putaran koreksi untuk mengimbangi pembulatan dan clipping
      for (let it = 0; it < 4; it++) {
        const f = blockFeature(d, w, bx, by, opt.method);
        const target = lsbEmbed(f, bits[k], D);
        if (Math.abs(target - f) < 0.05 * D) break;
        applyDelta(d, w, bx, by, opt.method, target - f);
      }
    }
    return out;
  }

  function extract(img, n, opt) {
    const d = img.data, w = img.width, h = img.height;
    const bits = new Uint8Array(n);
    if (capacity(w, h, opt.method) < n) throw new Error('capacity');
    const L = layout(w, h, opt.method);
    const perm = permutation(L.count, opt.key);
    for (let k = 0; k < n; k++) {
      const bi = perm[k];
      bits[k] = lsbExtract(blockFeature(d, w, bi % L.cols, Math.floor(bi / L.cols), opt.method), opt.delta);
    }
    return bits;
  }

  // ---------- Metrik ----------
  // PSNR pada kanal R, G, B (alpha diabaikan)
  function psnr(a, b) {
    const x = a.data, y = b.data;
    let s = 0, n = 0;
    for (let p = 0; p < x.length; p += 4)
      for (let c = 0; c < 3; c++) { const e = x[p + c] - y[p + c]; s += e * e; n++; }
    const mse = s / n;
    return mse === 0 ? Infinity : 10 * Math.log10((255 * 255) / mse);
  }

  // SSIM pada luminansi, jendela 8x8 dengan langkah 4 (rata-rata semua jendela)
  function ssim(a, b) {
    const w = a.width, h = a.height;
    const Ya = new Float64Array(w * h), Yb = new Float64Array(w * h);
    for (let i = 0; i < w * h; i++) { Ya[i] = luma(a.data, i * 4); Yb[i] = luma(b.data, i * 4); }
    const C1 = (0.01 * 255) ** 2, C2 = (0.03 * 255) ** 2;
    const W = 8, S = 4, N = W * W;
    let total = 0, count = 0;
    for (let y = 0; y + W <= h; y += S)
      for (let x = 0; x + W <= w; x += S) {
        let ma = 0, mb = 0, va = 0, vb = 0, cov = 0;
        for (let j = 0; j < W; j++) {
          const r = (y + j) * w + x;
          for (let i = 0; i < W; i++) { ma += Ya[r + i]; mb += Yb[r + i]; }
        }
        ma /= N; mb /= N;
        for (let j = 0; j < W; j++) {
          const r = (y + j) * w + x;
          for (let i = 0; i < W; i++) {
            const da = Ya[r + i] - ma, db = Yb[r + i] - mb;
            va += da * da; vb += db * db; cov += da * db;
          }
        }
        va /= N - 1; vb /= N - 1; cov /= N - 1;
        total += ((2 * ma * mb + C1) * (2 * cov + C2)) / ((ma * ma + mb * mb + C1) * (va + vb + C2));
        count++;
      }
    return count ? total / count : 1;
  }

  // NC = Σ W·W' / √(ΣW² · ΣW'²), W ∈ {0,1}
  function nc(w1, w2) {
    let s = 0, a = 0, b = 0;
    for (let i = 0; i < w1.length; i++) { s += w1[i] * w2[i]; a += w1[i] * w1[i]; b += w2[i] * w2[i]; }
    return a && b ? s / Math.sqrt(a * b) : 0;
  }
  function ber(w1, w2) {
    let e = 0;
    for (let i = 0; i < w1.length; i++) if (w1[i] !== w2[i]) e++;
    return e / w1.length;
  }

  // Entropi Shannon citra (bit/piksel) dari histogram luminansi 8 bit:
  // H = −Σ p(i)·log2 p(i). Maksimum 8 bit/piksel bila histogram rata.
  function entropy(img) {
    const d = img.data, n = d.length / 4, hist = new Float64Array(256);
    for (let p = 0; p < d.length; p += 4) {
      let v = Math.round(luma(d, p));
      hist[v < 0 ? 0 : v > 255 ? 255 : v]++;
    }
    let h = 0;
    for (let i = 0; i < 256; i++) {
      const q = hist[i] / n;
      if (q > 0) h -= q * Math.log2(q);
    }
    return h;
  }

  // Entropi Shannon deretan bit watermark (bit/bit): H = −p·log2 p − (1−p)·log2(1−p)
  // dengan p = proporsi bit 1. Bernilai 1 bila bit tersebar acak 50:50.
  function bitEntropy(bits) {
    let ones = 0;
    for (let i = 0; i < bits.length; i++) ones += bits[i];
    const p = ones / bits.length;
    return (p === 0 || p === 1) ? 0 : -(p * Math.log2(p) + (1 - p) * Math.log2(1 - p));
  }

  // ---------- Serangan berbasis piksel ----------
  function gaussian(r) {
    let u = 0, v = 0;
    while (u === 0) u = r();
    while (v === 0) v = r();
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  }
  const attacks = {
    noise(img, sigma, seed = 1) {
      const o = copyImage(img), d = o.data, r = mulberry32(seed);
      for (let p = 0; p < d.length; p += 4)
        for (let c = 0; c < 3; c++) d[p + c] = d[p + c] + sigma * gaussian(r);
      return o;
    },
    saltPepper(img, density, seed = 2) {
      const o = copyImage(img), d = o.data, r = mulberry32(seed);
      for (let p = 0; p < d.length; p += 4) {
        const t = r();
        if (t < density) { const v = t < density / 2 ? 0 : 255; d[p] = d[p + 1] = d[p + 2] = v; }
      }
      return o;
    },
    filter3(img, kind) {
      const o = copyImage(img), s = img.data, d = o.data, w = img.width, h = img.height;
      const win = new Array(9);
      for (let y = 0; y < h; y++)
        for (let x = 0; x < w; x++)
          for (let c = 0; c < 3; c++) {
            let k = 0;
            for (let j = -1; j <= 1; j++)
              for (let i = -1; i <= 1; i++) {
                const yy = Math.min(h - 1, Math.max(0, y + j));
                const xx = Math.min(w - 1, Math.max(0, x + i));
                win[k++] = s[(yy * w + xx) * 4 + c];
              }
            if (kind === 'median') { win.sort((a, b) => a - b); d[(y * w + x) * 4 + c] = win[4]; }
            else { let t = 0; for (const v of win) t += v; d[(y * w + x) * 4 + c] = t / 9; }
          }
      return o;
    },
    // menghitamkan area kiri-atas sebesar `fraction` dari luas citra
    crop(img, fraction) {
      const o = copyImage(img), d = o.data, w = img.width;
      const side = Math.sqrt(fraction);
      const cw = Math.round(w * side), ch = Math.round(img.height * side);
      for (let y = 0; y < ch; y++)
        for (let x = 0; x < cw; x++) { const p = (y * w + x) * 4; d[p] = d[p + 1] = d[p + 2] = 0; }
      return o;
    },
    // kontras: v' = (v − 128)·k + 128
    contrast(img, k) {
      const o = copyImage(img), d = o.data;
      for (let p = 0; p < d.length; p += 4)
        for (let c = 0; c < 3; c++) d[p + c] = (d[p + c] - 128) * k + 128;
      return o;
    },
    // gamma: v' = 255·(v/255)^g
    gamma(img, g) {
      const o = copyImage(img), d = o.data, lut = new Uint8ClampedArray(256);
      for (let v = 0; v < 256; v++) lut[v] = 255 * Math.pow(v / 255, g);
      for (let p = 0; p < d.length; p += 4)
        for (let c = 0; c < 3; c++) d[p + c] = lut[d[p + c]];
      return o;
    },
    brightness(img, offset) {
      const o = copyImage(img), d = o.data;
      for (let p = 0; p < d.length; p += 4) { d[p] += offset; d[p + 1] += offset; d[p + 2] += offset; }
      return o;
    },
  };

  const WM = { embed, extract, capacity, minSide, psnr, ssim, nc, ber, entropy, bitEntropy, attacks, copyImage };
  if (typeof module !== 'undefined' && module.exports) module.exports = WM;
  else root.WM = WM;
})(typeof window !== 'undefined' ? window : globalThis);
