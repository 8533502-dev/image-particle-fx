// Image -> point cloud. Extracts depth, the main subject, edges and the color palette, then
// importance-samples particles so detail (edges, subject) gets density and flat background stays airy.
import { estimateDepth, boxBlur } from './depth.js';
import { mulberry32 } from './field.js';

export const TEX_W = 1024;

export async function loadImageData(src, maxDim = 1024) {
    const img = src instanceof HTMLImageElement || src instanceof ImageBitmap ? src : await new Promise((res, rej) => {
        const im = new Image();
        im.crossOrigin = 'anonymous';
        im.onload = () => res(im);
        im.onerror = () => rej(new Error('无法加载图片: ' + src));
        im.src = src;
    });
    const iw = img.naturalWidth || img.width, ih = img.naturalHeight || img.height;
    const s = Math.min(1, maxDim / Math.max(iw, ih));
    const w = Math.max(8, Math.round(iw * s)), h = Math.max(8, Math.round(ih * s));
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    const ctx = c.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(img, 0, 0, w, h);
    return ctx.getImageData(0, 0, w, h);
}

const srgbToLinear = v => (v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4));
const toHex = c => '#' + c.map(v => Math.round(Math.max(0, Math.min(255, v))).toString(16).padStart(2, '0')).join('');

function otsu(values) {
    const hist = new Float64Array(256);
    for (const v of values) hist[Math.min(255, Math.floor(v * 255))]++;
    let sum = 0, total = values.length;
    for (let i = 0; i < 256; i++) sum += i * hist[i];
    let sumB = 0, wB = 0, best = 0, th = 128;
    for (let i = 0; i < 256; i++) {
        wB += hist[i]; if (!wB) continue;
        const wF = total - wB; if (!wF) break;
        sumB += i * hist[i];
        const mB = sumB / wB, mF = (sum - sumB) / wF;
        const between = wB * wF * (mB - mF) * (mB - mF);
        if (between > best) { best = between; th = i; }
    }
    return th / 255;
}

/** k-means palette in sRGB. Returns { colors:[{hex,rgb,weight}], accent, shadow }. */
export function extractPalette(imageData, k = 6, seed = 3) {
    const { data, width: w, height: h } = imageData;
    const rnd = mulberry32(seed);
    const pts = [];
    for (let i = 0; i < 4000; i++) {
        const p = Math.floor(rnd() * w * h) * 4;
        if (data[p + 3] < 128) continue;
        pts.push([data[p], data[p + 1], data[p + 2]]);
    }
    let cents = Array.from({ length: k }, (_, i) => pts[Math.floor((i + 0.5) / k * pts.length)].slice());
    const assign = new Int32Array(pts.length);
    for (let it = 0; it < 12; it++) {
        pts.forEach((p, i) => {
            let bi = 0, bd = Infinity;
            cents.forEach((c, j) => { const d = (p[0] - c[0]) ** 2 + (p[1] - c[1]) ** 2 + (p[2] - c[2]) ** 2; if (d < bd) { bd = d; bi = j; } });
            assign[i] = bi;
        });
        const acc = cents.map(() => [0, 0, 0, 0]);
        pts.forEach((p, i) => { const a = acc[assign[i]]; a[0] += p[0]; a[1] += p[1]; a[2] += p[2]; a[3]++; });
        cents = acc.map((a, j) => (a[3] ? [a[0] / a[3], a[1] / a[3], a[2] / a[3]] : cents[j]));
    }
    const counts = new Array(k).fill(0);
    assign.forEach(a => counts[a]++);
    const colors = cents.map((c, i) => ({ rgb: c, hex: toHex(c), weight: counts[i] / pts.length }))
        .filter(c => c.weight > 0).sort((a, b) => b.weight - a.weight);
    const sat = c => { const mx = Math.max(...c), mn = Math.min(...c); return mx ? (mx - mn) / mx : 0; };
    const lum = c => (0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]) / 255;
    const score = c => (c.weight > 0.03 ? 1 : 0.4) * (sat(c.rgb) * 0.75 + lum(c.rgb) * 0.25);
    let accent = colors.reduce((a, b) => (score(b) > score(a) ? b : a), colors[0]);
    // a near-gray accent makes a dull dissolve front: fall back to warm white
    if (sat(accent.rgb) < 0.18) accent = { rgb: [255, 236, 214], hex: '#ffecd6', weight: 0 };
    const shadow = colors.reduce((a, b) => (lum(b.rgb) < lum(a.rgb) ? b : a), colors[0]);
    return { colors, accent: accent.hex, shadow: shadow.hex };
}

// Hilbert index so morph sources and targets are matched by spatial neighborhood.
function hilbert(n, x, y) {
    let d = 0;
    for (let s = n >> 1; s > 0; s >>= 1) {
        const rx = (x & s) > 0 ? 1 : 0, ry = (y & s) > 0 ? 1 : 0;
        d += s * s * ((3 * rx) ^ ry);
        if (ry === 0) { if (rx === 1) { x = s - 1 - x; y = s - 1 - y; } const t = x; x = y; y = t; }
    }
    return d;
}

/**
 * Build the particle cloud for one image.
 * opts: { count, depth: { mode, strength, moduleUrl }, bgDensity, dust, seed, onStatus }
 */
export async function buildCloud(src, opts = {}) {
    const defined = Object.fromEntries(Object.entries(opts).filter(([, v]) => v !== undefined));
    const o = { count: 400000, bgDensity: 0.35, dust: 0.015, seed: 11, ...defined };
    const depthOpts = { mode: 'ai', strength: 0.9, ...(opts.depth || {}) };
    o.onStatus?.('读取图片…');
    const im = await loadImageData(src, 1024);
    const { width: w, height: h, data } = im;
    const N = w * h;

    let hasAlpha = 0;
    for (let i = 0; i < N; i++) if (data[i * 4 + 3] < 250) hasAlpha++;
    hasAlpha = hasAlpha > N * 0.02;

    const lum = new Float32Array(N), alpha = new Float32Array(N);
    for (let i = 0; i < N; i++) {
        lum[i] = (0.2126 * data[i * 4] + 0.7152 * data[i * 4 + 1] + 0.0722 * data[i * 4 + 2]) / 255;
        alpha[i] = data[i * 4 + 3] / 255;
    }

    const { depth, source: depthSource, error: depthError } = await estimateDepth(im, { ...depthOpts, onStatus: o.onStatus });
    o.onStatus?.('提取主体与边缘…');

    // subject mask: alpha if the image is a cut-out, otherwise a soft Otsu split of the depth map
    let subj;
    if (hasAlpha) subj = alpha.slice();
    else {
        const th = otsu(depth);
        subj = new Float32Array(N);
        for (let i = 0; i < N; i++) subj[i] = Math.min(1, Math.max(0, (depth[i] - th) / 0.12 + 0.5));
        subj = boxBlur(subj, w, h, Math.max(1, Math.round(Math.max(w, h) / 200)));
    }

    // edges (Sobel on luminance), normalized by the 98th percentile
    const edge = new Float32Array(N);
    for (let y = 1; y < h - 1; y++) for (let x = 1; x < w - 1; x++) {
        const i = y * w + x, L = (dx, dy) => lum[i + dy * w + dx];
        const gx = -L(-1, -1) - 2 * L(-1, 0) - L(-1, 1) + L(1, -1) + 2 * L(1, 0) + L(1, 1);
        const gy = -L(-1, -1) - 2 * L(0, -1) - L(1, -1) + L(-1, 1) + 2 * L(0, 1) + L(1, 1);
        edge[i] = Math.sqrt(gx * gx + gy * gy);
    }
    const sorted = Float32Array.from(edge).sort();
    const e98 = sorted[Math.floor(N * 0.98)] || 1;
    for (let i = 0; i < N; i++) edge[i] = Math.min(1, edge[i] / e98);

    // z map: subject pops forward, background recedes; min-filter map fills depth cliffs so side views have no holes
    const S = depthOpts.strength;
    let meanD = 0, cnt = 0;
    for (let i = 0; i < N; i++) if (subj[i] > 0.5) { meanD += depth[i]; cnt++; }
    meanD = cnt ? meanD / cnt : 0.5;
    const zmap = new Float32Array(N);
    for (let i = 0; i < N; i++) zmap[i] = (depth[i] - meanD) * 0.55 * S - (1 - subj[i]) * 0.3 * S;
    const zmin = new Float32Array(N);
    const R = 2;
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
        let m = Infinity;
        for (let dy = -R; dy <= R; dy++) for (let dx = -R; dx <= R; dx++) {
            const xx = Math.min(w - 1, Math.max(0, x + dx)), yy = Math.min(h - 1, Math.max(0, y + dy));
            const v = zmap[yy * w + xx]; if (v < m) m = v;
        }
        zmin[y * w + x] = m;
    }

    // importance
    const imp = new Float64Array(N), impv = new Float32Array(N);
    let total = 0;
    for (let i = 0; i < N; i++) {
        let v = (o.bgDensity + (1 - o.bgDensity) * subj[i]) * (0.5 + 1.5 * edge[i]) * (0.12 + 0.88 * Math.sqrt(lum[i]));
        if (hasAlpha) v *= alpha[i] > 0.1 ? alpha[i] : 0;
        impv[i] = v; total += v; imp[i] = total;
    }
    // density compensation: dense (detailed) areas get more but dimmer particles, so the formed image
    // reproduces the photo's tones while edges keep extra resolution
    let meanSubj = 0, nS = 0;
    for (let i = 0; i < N; i += 3) if (impv[i] > 0) { meanSubj += impv[i] * subj[i]; nS += subj[i]; }
    meanSubj = nS ? meanSubj / nS : total / N;

    o.onStatus?.('采样粒子…');
    const rnd = mulberry32(o.seed);
    const real = o.count, nDust = Math.round(o.count * o.dust);
    const all = real + nDust;
    const texH = Math.ceil(all / TEX_W);
    const size = TEX_W * texH;
    const base = new Float32Array(size * 4), attr = new Float32Array(size * 4), color = new Float32Array(size * 4);
    const scale = 2 / Math.max(w, h);
    const keys = new Float64Array(real);

    for (let k = 0; k < real; k++) {
        const u = ((k + rnd()) / real) * total;
        let lo = 0, hi = N - 1;
        while (lo < hi) { const mid = (lo + hi) >> 1; if (imp[mid] < u) lo = mid + 1; else hi = mid; }
        const i = lo, px = i % w, py = (i / w) | 0;
        const fx = px + rnd(), fy = py + rnd();
        const fill = rnd();
        const z = zmap[i] + (zmin[i] - zmap[i]) * fill * fill + (rnd() - 0.5) * 0.008;
        base.set([(fx - w / 2) * scale, -(fy - h / 2) * scale, z, rnd()], k * 4);
        attr.set([lum[i], edge[i], subj[i] > 0.5 ? 0 : 1, depth[i]], k * 4);
        const wgt = Math.min(2.5, Math.max(0.35, meanSubj / Math.max(impv[i], 1e-6)));
        color.set([srgbToLinear(data[i * 4] / 255) * wgt, srgbToLinear(data[i * 4 + 1] / 255) * wgt, srgbToLinear(data[i * 4 + 2] / 255) * wgt, 0.75 + rnd() * 0.5], k * 4);
        keys[k] = hilbert(1024, Math.min(1023, (fx / w * 1024) | 0), Math.min(1023, (fy / h * 1024) | 0));
    }

    // ambient dust in a volume around the image (deterministic so A/B morph clouds share it)
    const drnd = mulberry32(o.seed + 99);
    const ax = w >= h ? 1 : w / h, ay = h >= w ? 1 : h / w;
    for (let k = real; k < all; k++) {
        base.set([(drnd() - 0.5) * 3.4 * Math.max(ax, 0.8), (drnd() - 0.5) * 2.4 * Math.max(ay, 0.8), -1.2 + drnd() * 2.0, drnd()], k * 4);
        attr.set([0.5, 0, 2, 0], k * 4);
        color.set([0.6, 0.6, 0.65, 0.6 + drnd() * 0.6], k * 4);
    }
    // padding texels: parked far away with zero color
    for (let k = all; k < size; k++) { base.set([0, 0, -50, 0], k * 4); attr.set([0, 0, 2, 0], k * 4); }

    let radius = 0;
    for (let k = 0; k < real; k++) {
        const x = base[k * 4], y = base[k * 4 + 1], z = base[k * 4 + 2];
        radius = Math.max(radius, Math.hypot(x, y, z));
    }

    return {
        width: w, height: h, aspect: w / h, real, all, texW: TEX_W, texH, base, attr, color, keys,
        radius, palette: extractPalette(im), depthSource, depthError, hasAlpha,
    };
}

/** Reorder the real particles of a cloud by Hilbert key (in place) so two clouds can be paired for morphing. */
export function sortCloud(cloud) {
    const idx = Array.from({ length: cloud.real }, (_, i) => i).sort((a, b) => cloud.keys[a] - cloud.keys[b]);
    for (const name of ['base', 'attr', 'color']) {
        const src = cloud[name], dst = src.slice();
        idx.forEach((from, to) => dst.set(src.subarray(from * 4, from * 4 + 4), to * 4));
        cloud[name] = dst;
    }
    return cloud;
}
