// Monocular depth estimation in the browser (Depth Anything V2 via transformers.js),
// with a luminance/center-weighted fallback when the model can't load (offline, blocked CDN...).

export const DEPTH_MODULE_URL = 'https://cdn.jsdelivr.net/npm/@huggingface/transformers@3.8.1';
export const DEPTH_MODEL = 'onnx-community/depth-anything-v2-small';

let pipePromise = null;

async function getPipeline(T, model, onStatus) {
    if (pipePromise) return pipePromise;
    const progress_callback = (e) => {
        if (e.status === 'progress' && e.file?.endsWith('.onnx')) onStatus?.(`下载深度模型 ${Math.round(e.progress || 0)}%`);
    };
    const tryDevice = async (device) => T.pipeline('depth-estimation', model, {
        device, dtype: device === 'webgpu' ? 'fp32' : 'q8', progress_callback,
    });
    pipePromise = (async () => {
        if (typeof navigator !== 'undefined' && navigator.gpu) {
            try {
                const adapter = await navigator.gpu.requestAdapter();
                if (adapter) return await tryDevice('webgpu');
            } catch (e) { /* fall through to wasm */ }
        }
        return tryDevice('wasm');
    })();
    pipePromise.catch(() => { pipePromise = null; });
    return pipePromise;
}

/** Blurred luminance + a soft center bias. Used when AI depth is unavailable. */
export function pseudoDepth(imageData) {
    const { width: w, height: h, data } = imageData;
    const lum = new Float32Array(w * h);
    for (let i = 0; i < w * h; i++) lum[i] = (0.2126 * data[i * 4] + 0.7152 * data[i * 4 + 1] + 0.0722 * data[i * 4 + 2]) / 255;
    const b = boxBlur(lum, w, h, Math.max(2, Math.round(Math.max(w, h) / 80)));
    const out = new Float32Array(w * h);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
        const dx = x / w - 0.5, dy = y / h - 0.5;
        out[y * w + x] = 0.65 * b[y * w + x] + 0.35 * (1 - Math.min(1, (dx * dx + dy * dy) * 3));
    }
    return normalize(out);
}

/**
 * Returns { depth: Float32Array(w*h) in 0..1 (1 = near), source: 'ai' | 'luminance', error? }.
 * opts: { mode: 'ai' | 'luminance', moduleUrl, model, onStatus }
 */
/** Load a precomputed grayscale depth map (white = near) and resample it to the image size. */
export async function loadDepthMap(url, w, h) {
    const img = await new Promise((res, rej) => { const im = new Image(); im.crossOrigin = 'anonymous'; im.onload = () => res(im); im.onerror = () => rej(new Error('depth map: ' + url)); im.src = url; });
    const c = document.createElement('canvas'); c.width = w; c.height = h;
    const ctx = c.getContext('2d', { willReadFrequently: true });
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(img, 0, 0, w, h);
    const d = ctx.getImageData(0, 0, w, h).data, out = new Float32Array(w * h);
    for (let i = 0; i < w * h; i++) out[i] = d[i * 4] / 255;
    return normalize(out);
}

export async function estimateDepth(imageData, opts = {}) {
    if (opts.map) {
        try { return { depth: await loadDepthMap(opts.map, imageData.width, imageData.height), source: 'ai' }; }
        catch (e) { console.warn('[particle-fx] depth map failed, estimating instead:', e); }
    }
    if (opts.mode === 'luminance') return { depth: pseudoDepth(imageData), source: 'luminance' };
    // never let a slow/blocked CDN or model download hang the page: fall back to luminance depth
    const withTimeout = (p, ms, what) => Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error(what + ' timeout')), ms))]);
    try {
        onStatusSafe(opts, '加载深度模型…');
        const T = await withTimeout(import(/* @vite-ignore */ /* webpackIgnore: true */ opts.moduleUrl || DEPTH_MODULE_URL), opts.timeout ?? 30000, 'transformers.js');
        T.env.allowLocalModels = false;
        const pipe = await withTimeout(getPipeline(T, opts.model || DEPTH_MODEL, opts.onStatus), opts.timeout ?? 45000, 'depth model');
        onStatusSafe(opts, '估计深度…');
        const { width: w, height: h } = imageData;
        const img = new T.RawImage(new Uint8ClampedArray(imageData.data), w, h, 4);
        const out = await withTimeout(pipe(img), 30000, 'depth inference');
        const d = out.depth; // RawImage, 1 channel, resized to input size
        const src = d.data, dw = d.width, dh = d.height, ch = d.channels || 1;
        const depth = new Float32Array(w * h);
        for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
            const sx = Math.min(dw - 1, Math.floor((x / w) * dw)), sy = Math.min(dh - 1, Math.floor((y / h) * dh));
            depth[y * w + x] = src[(sy * dw + sx) * ch] / 255;
        }
        return { depth: normalize(depth), source: 'ai' };
    } catch (e) {
        console.warn('[particle-fx] AI depth unavailable, using luminance depth:', e);
        return { depth: pseudoDepth(imageData), source: 'luminance', error: String(e?.message || e) };
    }
}

function onStatusSafe(opts, s) { try { opts.onStatus?.(s); } catch (e) { /* ignore */ } }

export function normalize(a) {
    let lo = Infinity, hi = -Infinity;
    for (const v of a) { if (v < lo) lo = v; if (v > hi) hi = v; }
    const s = hi > lo ? 1 / (hi - lo) : 0;
    for (let i = 0; i < a.length; i++) a[i] = (a[i] - lo) * s;
    return a;
}

export function boxBlur(src, w, h, r) {
    const tmp = new Float32Array(w * h), out = new Float32Array(w * h);
    const n = 2 * r + 1;
    for (let y = 0; y < h; y++) {
        let acc = 0;
        for (let x = -r; x <= r; x++) acc += src[y * w + Math.min(w - 1, Math.max(0, x))];
        for (let x = 0; x < w; x++) {
            tmp[y * w + x] = acc / n;
            acc += src[y * w + Math.min(w - 1, x + r + 1)] - src[y * w + Math.max(0, x - r)];
        }
    }
    for (let x = 0; x < w; x++) {
        let acc = 0;
        for (let y = -r; y <= r; y++) acc += tmp[Math.min(h - 1, Math.max(0, y)) * w + x];
        for (let y = 0; y < h; y++) {
            out[y * w + x] = acc / n;
            acc += tmp[Math.min(h - 1, y + r + 1) * w + x] - tmp[Math.max(0, y - r) * w + x];
        }
    }
    return out;
}
