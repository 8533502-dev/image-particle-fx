// Particle FX app shell: loads scene.json, wires the UI, and exposes window.FX for offline export.
import { ParticleFX, EFFECTS, resolveEffect, exportVideo, dissolveRange, canEncodeMp4 } from './fx/index.js';

const qs = new URLSearchParams(location.search);
const EXPORT = qs.has('export');
const $ = id => document.getElementById(id);

// a bundled preset (presets/presets.json entry) -> scene object
function presetToScene(p) {
    const sc = JSON.parse(JSON.stringify(p.scene));
    sc.image = 'presets/' + p.image;
    if (p.depthMap) sc.depthMap = 'presets/' + p.depthMap;
    if (p.morphTo) sc.morphTo = 'presets/' + p.morphTo;
    if (p.morphDepthMap) sc.morphDepthMap = 'presets/' + p.morphDepthMap;
    return sc;
}

async function loadSceneFile() {
    const url = qs.get('scene') || 'scene.json';
    try { const r = await fetch(url, { cache: 'no-store' }); if (r.ok) return await r.json(); } catch (e) { /* no scene file */ }
    try { // no scene.json: start with the first bundled preset
        const ps = await (await fetch('presets/presets.json')).json();
        return presetToScene(ps[0]);
    } catch (e) { return { image: 'presets/jellyfish.jpg', effect: 'silk' }; }
}

const scene = await loadSceneFile();
if (EXPORT) document.body.classList.add('export');

const fx = new ParticleFX($('stage'), EXPORT
    ? { interactive: false, pixelRatio: 1, width: +qs.get('w') || 1920, height: +qs.get('h') || 1080, preserveDrawingBuffer: true }
    : { interactive: true });
fx.on('status', s => { $('loader-text').textContent = s || ''; $('status').textContent = s || ''; });

let ready;
let onLoaded = () => {};   // set by the live UI
async function loadScene(sc) {
    $('loader').classList.remove('done');
    const info = await fx.load(sc);
    $('loader').classList.add('done');
    onLoaded(info, sc);
    return info;
}

// ---------- export API (used by scripts/export.mjs) ----------
window.FX = {
    ready: (ready = loadScene(scene)),
    duration: () => fx.timeline.duration,
    renderAt: (t, dt, opts) => fx.renderAt(t, dt, opts),
    info: () => ({ palette: fx.palette, depthSource: fx.cloud?.depthSource, depthError: fx.cloud?.depthError, count: fx.cloud?.real, effect: fx.effectName }),
    fx,
    effects: EFFECTS,
};
if (EXPORT) { await ready; fx.renderAt(0); } else initLive();

function initLive() {
    fx.start();
    onLoaded = (info, sc) => {
        renderPalette(info.palette);
        $('status').textContent = info.depthSource === 'ai' ? '' : '（深度模型不可用，已用亮度深度）';
        markEffect(sc.effect || 'fluid-erosion');
        $('cam').value = sc.camera?.preset || 'drift';
        buildTune();
    };

    // ---------- effect list ----------
    const names = Object.keys(EFFECTS);
    $('fx-list').innerHTML = names.map((k, i) => {
        const e = EFFECTS[k];
        return `<div class="fx-card" data-k="${k}"><kbd>${i < 9 ? i + 1 : ''}</kbd><b>${e.name}</b><i>${e.en}</i><p>${e.desc}</p></div>`;
    }).join('');
    function markEffect(k) { document.querySelectorAll('.fx-card').forEach(c => c.classList.toggle('on', c.dataset.k === k)); }
    function chooseEffect(k) {
        scene.effect = k; scene.params = {};
        if (k === 'morph' && !scene.morphTo) $('status').textContent = '提示：morph 需要第二张图（scene.morphTo），当前重组为球体';
        fx.setEffect(k, {}); markEffect(k); buildTune();
    }
    $('fx-list').addEventListener('click', e => { const c = e.target.closest('.fx-card'); if (c) chooseEffect(c.dataset.k); });

    // ---------- deck ----------
    const fader = $('fader');
    fader.addEventListener('input', () => { fx.setProgress(+fader.value); $('play').textContent = '▶'; });
    $('play').addEventListener('click', togglePlay);
    function togglePlay() {
        if (fx.playing) { fx.pause(); fader.value = fx.progress; } else fx.play();
        $('play').textContent = fx.playing ? '❚❚' : '▶';
    }
    fx.on('frame', ({ progress }) => {
        $('pval').textContent = progress.toFixed(3);
        if (fx.playing) fader.value = progress;
    });

    // ---------- bundled presets ----------
    fetch('presets/presets.json').then(r => r.json()).then(ps => {
        const sel = $('preset');
        sel.innerHTML = '<option value="">示例图…</option>' + ps.map(p => `<option value="${p.id}">${p.name}</option>`).join('');
        sel.addEventListener('change', async () => {
            const p = ps.find(x => x.id === sel.value); if (!p) return;
            for (const k of Object.keys(scene)) delete scene[k];
            Object.assign(scene, presetToScene(p));
            await loadScene(scene);
            fx.play(); $('play').textContent = '❚❚';
        });
    }).catch(() => $('preset').remove());

    // ---------- camera ----------
    $('cam').addEventListener('change', e => { scene.camera = { ...(scene.camera || {}), preset: e.target.value }; fx.setCamera(scene.camera); });

    // ---------- palette ----------
    function renderPalette(p) {
        $('palette').innerHTML = p.colors.slice(0, 6).map(c => `<i style="background:${c.hex}" title="${c.hex}"></i>`).join('') +
            `<i style="background:${p.accent};box-shadow:0 0 10px ${p.accent}" title="accent ${p.accent}"></i>`;
        // UI accent follows the image, unless that color is too dark to read on the dark panels
        const rgb = p.accent.match(/\w\w/g).map(h => parseInt(h, 16) / 255);
        const lum = 0.2126 * rgb[0] + 0.7152 * rgb[1] + 0.0722 * rgb[2];
        document.documentElement.style.setProperty('--accent', lum > 0.35 ? p.accent : '#ffd9a8');
    }

    // ---------- tuning panel ----------
    const TUNE = [
        ['运动', [
            ['motion.travel', '飞散距离', 0, 4, 0.01], ['motion.curl', '湍流强度', 0, 3, 0.01], ['motion.curlScale', '湍流尺度', 0.2, 5, 0.01],
            ['softness', '过渡宽度', 0.05, 1, 0.01], ['order.noise', '边缘噪波', 0, 1, 0.01],
        ]],
        ['质感', [
            ['look.size', '粒子大小', 1, 14, 0.1], ['look.heatIntensity', '热边亮度', 0, 5, 0.01], ['look.streak', '运动模糊', 0, 3, 0.01],
            ['look.growth', '飞散膨胀', 0.5, 4, 0.01], ['look.fade', '渐隐', 0, 4, 0.01], ['look.sparkle', '闪烁', 0, 2, 0.01],
            ['look.aperture', '景深', 0, 20, 0.1], ['look.dust', '空气尘埃', 0, 1.5, 0.01], ['look.trail', '拖尾残影', 0, 0.97, 0.01],
        ]],
        ['画面', [
            ['$exposure', '曝光', 0.2, 3, 0.01], ['$bloom', '辉光', 0, 3, 0.01], ['$vignette', '暗角', 0, 1, 0.01], ['$grain', '颗粒', 0, 0.15, 0.001],
        ]],
    ];
    const getPath = (o, p) => p.split('.').reduce((a, k) => a?.[k], o);
    function setPath(o, p, v) { const ks = p.split('.'); let a = o; ks.slice(0, -1).forEach(k => { a = a[k] ||= {}; }); a[ks.at(-1)] = v; }
    function buildTune() {
        const cur = resolveEffect(scene.effect || 'fluid-erosion', scene.params || {});
        $('tune').innerHTML = TUNE.map(([title, rows]) => `<h4>${title}</h4>` + rows.map(([path, label, min, max, step]) => {
            const v = path[0] === '$' ? fx.look[path.slice(1)] : getPath(cur, path);
            return `<div class="row"><label>${label}<span>${(+v).toFixed(2)}</span></label><input type="range" min="${min}" max="${max}" step="${step}" value="${v}" data-p="${path}"></div>`;
        }).join('')).join('');
    }
    $('tune').addEventListener('input', e => {
        const path = e.target.dataset.p; if (!path) return;
        const v = +e.target.value;
        e.target.previousElementSibling.querySelector('span').textContent = v.toFixed(2);
        if (path[0] === '$') { scene.look = { ...(scene.look || {}), [path.slice(1)]: v }; fx.setLook(scene.look); }
        else { scene.params ||= {}; setPath(scene.params, path, v); fx.setEffect(scene.effect, scene.params); }
    });
    $('tune-btn').addEventListener('click', () => $('tune').classList.toggle('open'));

    // ---------- files ----------
    async function useFile(file) {
        if (!file || !file.type.startsWith('image/')) return;
        scene.image = URL.createObjectURL(file);
        delete scene.depthMap; delete scene.morphTo; delete scene.morphDepthMap;
        scene.imageName = file.name;
        await loadScene(scene);
    }
    $('file').addEventListener('change', e => useFile(e.target.files[0]));
    addEventListener('dragover', e => { e.preventDefault(); document.body.classList.add('dragging'); });
    addEventListener('dragleave', e => { if (e.target === $('drop') || !e.relatedTarget) document.body.classList.remove('dragging'); });
    addEventListener('drop', e => { e.preventDefault(); document.body.classList.remove('dragging'); useFile(e.dataTransfer.files[0]); });

    const embedded = window.top !== window;   // inside a sandboxed frame downloads are blocked: copy instead
    if (embedded) $('save-btn').textContent = '复制配置';
    $('save-btn').addEventListener('click', async () => {
        const out = { ...scene };
        if (out.image?.startsWith('blob:')) out.image = 'media/' + (scene.imageName || 'image.jpg');
        delete out.imageName;
        const json = JSON.stringify(out, null, 2);
        if (embedded) {
            try { await navigator.clipboard.writeText(json); $('status').textContent = '配置已复制，粘贴保存为 scene.json'; }
            catch (e) { $('status').textContent = '复制失败：浏览器不允许访问剪贴板'; }
            return;
        }
        const a = document.createElement('a');
        a.href = URL.createObjectURL(new Blob([json], { type: 'application/json' }));
        a.download = 'scene.json'; a.click();
    });

    // ---------- video export (in the browser) ----------
    let recAbort = null;
    const recEl = $('rec');
    const recUpdateNote = () => {
        const [w, h] = $('rec-size').value.split('x').map(Number), fps = +$('rec-fps').value;
        const tl = fx.timeline, r = $('rec-range').value === 'dissolve' ? dissolveRange(tl) : { start: 0, duration: tl.duration };
        const frames = Math.round(r.duration * fps);
        $('rec-note').textContent = embedded
            ? '当前页面嵌在其他网站里，浏览器不允许下载文件。请在独立页面中打开后再导出。'
            : `${r.duration.toFixed(1)} 秒 · ${frames} 帧 · ${canEncodeMp4() ? 'MP4（H.264）逐帧渲染，不掉帧' : 'WebM 实时录制（这个浏览器不支持逐帧编码）'}`
              + (w * h > 4e6 ? '。4K 渲染较慢，请耐心等待' : '');
        return { w, h, fps, ...r };
    };
    ['rec-size', 'rec-fps', 'rec-range'].forEach(id => $(id).addEventListener('change', recUpdateNote));
    $('rec-btn').addEventListener('click', () => {
        recEl.hidden = false; $('rec-bar').hidden = true; $('rec-status').textContent = '';
        $('rec-go').disabled = embedded; recUpdateNote();
    });
    $('rec-cancel').addEventListener('click', () => { if (recAbort) recAbort.abort(); else recEl.hidden = true; });
    $('rec-go').addEventListener('click', async () => {
        const cfg = recUpdateNote();
        recAbort = new AbortController();
        $('rec-go').disabled = true; $('rec-bar').hidden = false; $('rec-fill').style.width = '0%';
        $('rec-cancel').textContent = '停止';
        const t0 = performance.now();
        try {
            const { blob, ext } = await exportVideo(fx, {
                width: cfg.w, height: cfg.h, fps: cfg.fps, start: cfg.start, duration: cfg.duration, signal: recAbort.signal,
                onProgress: (f, label) => {
                    $('rec-fill').style.width = (f * 100).toFixed(1) + '%';
                    const el = (performance.now() - t0) / 1000, eta = f > 0.02 ? el / f - el : 0;
                    $('rec-status').textContent = label + (eta > 1 ? ` · 约剩 ${Math.ceil(eta)} 秒` : '');
                },
            });
            const name = `particle-fx_${scene.effect || 'fx'}_${cfg.w}x${cfg.h}_${cfg.fps}fps.${ext}`;
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a'); a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove();
            setTimeout(() => URL.revokeObjectURL(url), 60000);
            $('rec-status').textContent = `完成：${name}（${(blob.size / 1048576).toFixed(1)} MB）已开始下载`;
        } catch (e) {
            $('rec-status').textContent = e.name === 'AbortError' ? '已取消' : '导出失败：' + (e.message || e);
        } finally {
            recAbort = null; $('rec-go').disabled = false; $('rec-cancel').textContent = '关闭';
            fx.play(); $('play').textContent = '❚❚';
        }
    });

    // ---------- keys ----------
    addEventListener('keydown', e => {
        if (e.target.tagName === 'INPUT' && e.target.type !== 'range') return;
        if (!recEl.hidden) { if (e.key === 'Escape' && !recAbort) recEl.hidden = true; return; }
        if (e.key === 'h' || e.key === 'H') document.body.classList.toggle('hide-ui');
        else if (e.key === ' ') { e.preventDefault(); togglePlay(); }
        else if (/^[1-9]$/.test(e.key) && names[+e.key - 1]) chooseEffect(names[+e.key - 1]);
        else if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') { const v = Math.max(0, Math.min(1, +fader.value + (e.key === 'ArrowRight' ? 0.05 : -0.05))); fader.value = v; fx.setProgress(v); }
    });
}
