// In-browser video export. Renders the timeline frame by frame (deterministic, like scripts/export.mjs) and
// encodes H.264 MP4 with WebCodecs + mp4-muxer. Falls back to real-time MediaRecorder (WebM) where WebCodecs
// is missing. Note: sandboxed frames (e.g. some embeds) block downloads — the caller decides how to deliver the Blob.

export const MUXER_URL = 'https://cdn.jsdelivr.net/npm/mp4-muxer@5.2.1/build/mp4-muxer.mjs';

export const canEncodeMp4 = () => typeof window !== 'undefined' && 'VideoEncoder' in window && 'VideoFrame' in window;

async function pickCodec(width, height, fps, bitrate) {
    // High profile levels: 4.2 (1080p60), 5.1 (4K30), 5.2 (4K60)
    for (const codec of ['avc1.640034', 'avc1.640033', 'avc1.64002a', 'avc1.4d0034', 'avc1.42003e']) {
        const cfg = { codec, width, height, bitrate, framerate: fps, hardwareAcceleration: 'prefer-hardware', avc: { format: 'avc' } };
        try { const r = await VideoEncoder.isConfigSupported(cfg); if (r.supported) return r.config; } catch (e) { /* try next */ }
        try { const c2 = { ...cfg, hardwareAcceleration: 'no-preference' }; const r = await VideoEncoder.isConfigSupported(c2); if (r.supported) return r.config; } catch (e) { /* try next */ }
    }
    return null;
}

/** Start/end seconds of the dissolve part of a timeline (first rise from formed until fully dissolved, plus a short hold). */
export function dissolveRange(timeline) {
    const k = timeline?.keys || [];
    for (let i = 0; i < k.length - 1; i++) {
        if (k[i + 1].p > k[i].p + 1e-3) {
            const start = Math.max(0, k[i].t - 0.4);
            const j = k.findIndex((x, n) => n > i && x.p >= 0.999);
            const end = j >= 0 ? Math.min(timeline.duration, k[j].t + 0.8) : timeline.duration;
            return { start, duration: Math.max(0.5, end - start) };
        }
    }
    return { start: 0, duration: timeline?.duration || 10 };
}

/**
 * exportVideo(fx, { width, height, fps, start, duration, onProgress(frac, label), signal })
 * -> { blob, mime, ext }
 */
export async function exportVideo(fx, o) {
    const width = Math.round(o.width / 2) * 2, height = Math.round(o.height / 2) * 2;
    const fps = o.fps || 30, start = o.start || 0, duration = o.duration || fx.timeline.duration;
    const total = Math.max(1, Math.round(duration * fps));
    const progress = (f, label) => o.onProgress?.(f, label);
    const aborted = () => o.signal?.aborted;

    fx.stop();
    fx.beginExport(width, height);
    try {
        if (canEncodeMp4()) {
            const bitrate = Math.round(Math.min(80e6, width * height * fps * 0.14));
            const config = await pickCodec(width, height, fps, bitrate);
            if (config) {
                const { Muxer, ArrayBufferTarget } = await import(/* @vite-ignore */ /* webpackIgnore: true */ o.muxerUrl || MUXER_URL);
                const muxer = new Muxer({ target: new ArrayBufferTarget(), video: { codec: 'avc', width, height, frameRate: fps }, fastStart: 'in-memory' });
                let encErr = null;
                const enc = new VideoEncoder({ output: (chunk, meta) => muxer.addVideoChunk(chunk, meta), error: e => { encErr = e; } });
                enc.configure(config);
                // warm up feedback trails so the first frame matches playback
                for (let i = 10; i > 0; i--) fx.renderAt(start - i / fps, 1 / fps);
                for (let f = 0; f < total; f++) {
                    if (aborted()) throw new DOMException('已取消', 'AbortError');
                    if (encErr) throw encErr;
                    fx.renderAt(start + f / fps, 1 / fps);
                    const frame = new VideoFrame(fx.canvas, { timestamp: Math.round((f * 1e6) / fps), duration: Math.round(1e6 / fps) });
                    enc.encode(frame, { keyFrame: f % (fps * 2) === 0 });
                    frame.close();
                    while (enc.encodeQueueSize > 6) await new Promise(r => setTimeout(r, 2));
                    if (f % 3 === 0) { progress(f / total, `渲染 ${f + 1}/${total} 帧`); await new Promise(r => setTimeout(r, 0)); }
                }
                progress(1, '封装 MP4…');
                await enc.flush(); enc.close();
                if (encErr) throw encErr;
                muxer.finalize();
                return { blob: new Blob([muxer.target.buffer], { type: 'video/mp4' }), mime: 'video/mp4', ext: 'mp4' };
            }
        }
        // fallback: real-time capture (no WebCodecs / no H.264 encoder)
        const mime = ['video/mp4;codecs=avc1', 'video/webm;codecs=vp9', 'video/webm'].find(m => window.MediaRecorder && MediaRecorder.isTypeSupported(m));
        if (!mime) throw new Error('这个浏览器不支持视频导出，请使用新版 Chrome / Edge / Safari');
        const stream = fx.canvas.captureStream(fps);
        const rec = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: Math.round(Math.min(40e6, width * height * fps * 0.12)) });
        const chunks = [];
        rec.ondataavailable = e => e.data.size && chunks.push(e.data);
        const done = new Promise(r => { rec.onstop = r; });
        rec.start(250);
        const t0 = performance.now();
        await new Promise((resolve, reject) => {
            const step = () => {
                if (aborted()) { rec.stop(); return reject(new DOMException('已取消', 'AbortError')); }
                const t = (performance.now() - t0) / 1000;
                if (t >= duration) return resolve();
                fx.renderAt(start + t, 1 / fps);
                progress(t / duration, `实时录制 ${t.toFixed(1)}/${duration.toFixed(1)} 秒`);
                requestAnimationFrame(step);
            };
            requestAnimationFrame(step);
        });
        rec.stop(); await done;
        const type = mime.split(';')[0];
        return { blob: new Blob(chunks, { type }), mime: type, ext: type === 'video/mp4' ? 'mp4' : 'webm' };
    } finally {
        fx.endExport();
        fx.start();
    }
}
