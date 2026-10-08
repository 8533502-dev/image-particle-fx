// ParticleFX — image → point cloud → GPU particle dissolve with cinematic post.
// Framework-agnostic: works in a plain <script type="module"> page (importmap) or a bundler (npm i three).
import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';
import { Pass, FullScreenQuad } from 'three/examples/jsm/postprocessing/Pass.js';

import { SIM_VERT, SIM_FRAG } from './shaders/sim.glsl.js';
import { DRAW_VERT, DRAW_FRAG } from './shaders/draw.glsl.js';
import { TRAIL_FRAG, GRADE_FRAG, QUAD_VERT } from './shaders/post.glsl.js';
import { buildField } from './field.js';
import { buildCloud, sortCloud } from './sampler.js';
import { resolveEffect, ORDER_TYPES, MOTION_MODES, EASES } from './effects.js';
import { progressAt, timelineTime, defaultTimeline, cameraAt } from './timeline.js';

export const DEFAULT_LOOK = {
    exposure: 1.5, bloom: 0.45, bloomRadius: 0.2, bloomThreshold: 1.0,
    vignette: 0.45, grain: 0.03, aberration: 0.0025, background: '#040507', glow: 0,
    toneMapping: 'aces',
};

const v3 = a => new THREE.Vector3(a[0], a[1], a[2]);
const linColor = hex => new THREE.Color(hex); // THREE.Color parses sRGB hex into linear working space

class TrailPass extends Pass {
    constructor() {
        super();
        this.decay = 0;
        this.rtA = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType });
        this.rtB = this.rtA.clone();
        this.mat = new THREE.ShaderMaterial({
            uniforms: { tCur: { value: null }, tOld: { value: null }, uDecay: { value: 0 } },
            vertexShader: QUAD_VERT, fragmentShader: TRAIL_FRAG,
        });
        this.quad = new FullScreenQuad(this.mat);
    }
    setSize(w, h) { this.rtA.setSize(w, h); this.rtB.setSize(w, h); }
    reset(renderer) { for (const rt of [this.rtA, this.rtB]) { renderer.setRenderTarget(rt); renderer.clear(); } }
    render(renderer, writeBuffer, readBuffer) {
        if (this.decay <= 0) { // passthrough
            this.mat.uniforms.tCur.value = readBuffer.texture; this.mat.uniforms.uDecay.value = 0;
            this.mat.uniforms.tOld.value = readBuffer.texture;
            renderer.setRenderTarget(this.renderToScreen ? null : writeBuffer); this.quad.render(renderer); return;
        }
        this.mat.uniforms.tCur.value = readBuffer.texture;
        this.mat.uniforms.tOld.value = this.rtA.texture;
        this.mat.uniforms.uDecay.value = this.decay;
        renderer.setRenderTarget(this.rtB); this.quad.render(renderer);
        renderer.setRenderTarget(this.renderToScreen ? null : writeBuffer); this.quad.render(renderer);
        [this.rtA, this.rtB] = [this.rtB, this.rtA];
    }
}

export class ParticleFX {
    /**
     * @param {HTMLElement} container element to fill (a canvas is created inside), or an existing <canvas>
     * @param {object} options { pixelRatio, interactive, preserveDrawingBuffer, width, height, fieldSeed, onStatus }
     */
    constructor(container, options = {}) {
        this.opts = { pixelRatio: Math.min(window.devicePixelRatio || 1, 2), interactive: true, preserveDrawingBuffer: false, fieldSeed: 7, ...options };
        const isCanvas = container instanceof HTMLCanvasElement;
        this.container = isCanvas ? container.parentElement : container;
        this.renderer = new THREE.WebGLRenderer({
            canvas: isCanvas ? container : undefined, antialias: false, alpha: false,
            powerPreference: 'high-performance', preserveDrawingBuffer: this.opts.preserveDrawingBuffer,
        });
        if (!isCanvas) container.appendChild(this.renderer.domElement);
        this.canvas = this.renderer.domElement;
        this.canvas.style.display = 'block';
        this.renderer.outputColorSpace = THREE.SRGBColorSpace;

        this.scene = new THREE.Scene();
        this.camera = new THREE.PerspectiveCamera(35, 1, 0.01, 100);
        this.field = buildField(this.opts.fieldSeed);
        this.look = { ...DEFAULT_LOOK };
        this.progress = 0; this.progressTarget = 0; this.progressVel = 0;
        this.time = 0; this.prev = null;
        this.playing = true;           // timeline playback (false = manual progress)
        this.timeline = defaultTimeline();
        this.cameraOpts = { preset: 'drift' };
        this.user = { az: 0, el: 0, zoom: 1, tAz: 0, tEl: 0, tZoom: 1, px: 0, py: 0, tpx: 0, tpy: 0 };
        this.listeners = {};

        this._initPost();
        this.resize();
        this._ro = new ResizeObserver(() => this.resize());
        if (!this.opts.width) this._ro.observe(this.container || this.canvas);
        if (this.opts.interactive) this._initInput();
    }

    on(evt, fn) { (this.listeners[evt] ||= []).push(fn); return this; }
    _emit(evt, ...a) { (this.listeners[evt] || []).forEach(f => f(...a)); }
    _status(s) { this.opts.onStatus?.(s); this._emit('status', s); }

    _initPost() {
        const r = this.renderer;
        const rt = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType });
        this.composer = new EffectComposer(r, rt);
        this.renderPass = new RenderPass(this.scene, this.camera);
        this.trailPass = new TrailPass();
        this.bloomPass = new UnrealBloomPass(new THREE.Vector2(256, 256), 0.8, 0.5, 0.1);
        this.outputPass = new OutputPass();
        this.gradePass = new ShaderPass({
            uniforms: {
                tDiffuse: { value: null }, uRes: { value: new THREE.Vector2() }, uVignette: { value: 0 }, uGrain: { value: 0 },
                uAberration: { value: 0 }, uTime: { value: 0 }, uGlow: { value: new THREE.Color() }, uGlowAmt: { value: 0 },
            },
            vertexShader: QUAD_VERT, fragmentShader: GRADE_FRAG,
        });
        for (const p of [this.renderPass, this.trailPass, this.bloomPass, this.outputPass, this.gradePass]) this.composer.addPass(p);
    }

    _initInput() {
        const el = this.canvas;
        let drag = null;
        el.addEventListener('pointerdown', e => { drag = { x: e.clientX, y: e.clientY, az: this.user.tAz, el: this.user.tEl }; el.setPointerCapture(e.pointerId); });
        el.addEventListener('pointermove', e => {
            const rect = el.getBoundingClientRect();
            this.user.tpx = ((e.clientX - rect.left) / rect.width - 0.5) * 2;
            this.user.tpy = ((e.clientY - rect.top) / rect.height - 0.5) * 2;
            if (drag) {
                this.user.tAz = drag.az - (e.clientX - drag.x) * 0.005;
                this.user.tEl = Math.max(-1.2, Math.min(1.2, drag.el + (e.clientY - drag.y) * 0.004));
            }
        });
        el.addEventListener('pointerup', () => { drag = null; });
        el.addEventListener('pointerleave', () => { this.user.tpx = 0; this.user.tpy = 0; });
        el.addEventListener('wheel', e => { e.preventDefault(); this.user.tZoom = Math.max(0.35, Math.min(2.5, this.user.tZoom * Math.exp(e.deltaY * 0.001))); }, { passive: false });
        el.addEventListener('dblclick', () => { this.user.tAz = 0; this.user.tEl = 0; this.user.tZoom = 1; });
    }

    resize(width, height, pixelRatio) {
        const w = width || this.opts.width || this.container?.clientWidth || window.innerWidth;
        const h = height || this.opts.height || this.container?.clientHeight || window.innerHeight;
        const pr = pixelRatio || this.opts.pixelRatio;
        this.size = { w, h, pr };
        this.renderer.setPixelRatio(pr);
        this.renderer.setSize(w, h, !this.opts.width);
        this.composer.setPixelRatio(pr);
        this.composer.setSize(w, h);
        this.camera.aspect = w / h;
        this.camera.updateProjectionMatrix();
        const bw = Math.round(w * pr), bh = Math.round(h * pr);
        if (this.drawMat) this.drawMat.uniforms.uRes.value.set(bw, bh);
        this.gradePass.uniforms.uRes.value.set(bw, bh);
        this.trailPass.reset?.(this.renderer);
        if (this.cloud && !this.scene_?.camera?.distance) this._autoDistance();
    }

    /**
     * Load a scene description (see references/scene-format.md) or just an image URL.
     */
    async load(scene) {
        if (typeof scene === 'string') scene = { image: scene };
        this.scene_ = scene;
        const count = scene.count || (scene.quality === 'low' ? 150000 : scene.quality === 'ultra' ? 700000 : 400000);
        const common = { count, depth: scene.depth, bgDensity: scene.bgDensity, dust: scene.dust, onStatus: s => this._status(s) };
        const A = await buildCloud(scene.image, { ...common, depth: { ...(scene.depth || {}), map: scene.depthMap } });
        let B = null;
        const effectName = scene.effect || 'fluid-erosion';
        if (scene.morphTo) {
            B = await buildCloud(scene.morphTo, { ...common, seed: 23, depth: { ...(scene.depth || {}), map: scene.morphDepthMap } });
            sortCloud(A); sortCloud(B);
        }
        this.cloud = A; this.cloudB = B;
        this.palette = A.palette;
        this._buildGPU(A, B);
        this.setLook(scene.look || {});
        this.setEffect(effectName, scene.params || {});
        this.setCamera(scene.camera || {});
        this.setTimeline(scene.timeline || defaultTimeline());
        this.trailPass.reset(this.renderer);
        this._calibrate();
        this.time = 0; this.progress = progressAt(this.timeline.keys, 0); this.progressVel = 0;  // timeline starts when the image is ready
        this._status('');
        this._emit('loaded', { palette: A.palette, depthSource: A.depthSource, count: A.real });
        return { palette: A.palette, depthSource: A.depthSource, depthError: A.depthError, count: A.real };
    }

    _dataTex(arr, w, h) {
        const t = new THREE.DataTexture(arr, w, h, THREE.RGBAFormat, THREE.FloatType);
        t.minFilter = t.magFilter = THREE.NearestFilter;
        t.needsUpdate = true;
        return t;
    }

    _buildGPU(A, B) {
        this._disposeGPU();
        const { texW, texH, all } = A;
        this.tex = {
            base: this._dataTex(A.base, texW, texH), attr: this._dataTex(A.attr, texW, texH), color: this._dataTex(A.color, texW, texH),
        };
        let target = B ? B.base : null, colorB = B ? B.color : null;
        if (!B) { // default morph target: a luminous sphere shell, so 'morph' works with one image
            target = new Float32Array(A.base.length); colorB = A.color;
            const n = A.real, ga = Math.PI * (3 - Math.sqrt(5));
            for (let i = 0; i < A.base.length / 4; i++) {
                if (i >= n) { target.set(A.base.subarray(i * 4, i * 4 + 4), i * 4); continue; }
                const y = 1 - (i / (n - 1)) * 2, r = Math.sqrt(1 - y * y), th = ga * i;
                target.set([Math.cos(th) * r * 0.75, y * 0.75, Math.sin(th) * r * 0.75, 0], i * 4);
            }
        }
        this.tex.target = this._dataTex(target, texW, texH);
        this.tex.colorB = this._dataTex(colorB, texW, texH);

        const rtOpts = { type: THREE.FloatType, format: THREE.RGBAFormat, minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter, depthBuffer: false };
        this.rtCur = new THREE.WebGLRenderTarget(texW, texH, rtOpts);
        this.rtPrev = new THREE.WebGLRenderTarget(texW, texH, rtOpts);

        const fieldU = {
            uFK: { value: Array.from({ length: 12 }, (_, i) => new THREE.Vector3().fromArray(this.field.K, i * 3)) },
            uFC: { value: Array.from({ length: 12 }, (_, i) => new THREE.Vector3().fromArray(this.field.C, i * 3)) },
            uFP: { value: Array.from(this.field.P) },
            uFW: { value: Array.from(this.field.W) },
        };
        const U = (v) => ({ value: v });
        this.simMat = new THREE.ShaderMaterial({
            vertexShader: SIM_VERT, fragmentShader: SIM_FRAG,
            uniforms: {
                ...fieldU,
                tBase: U(this.tex.base), tAttr: U(this.tex.attr), tTarget: U(this.tex.target),
                uP: U(0), uTime: U(0), uRadius: U(A.radius),
                uOrderType: U(2), uOrderDir: U(new THREE.Vector3(0, -1, 0)), uOrderCenter: U(new THREE.Vector3()), uOrderNoise: U(0.3),
                uOrderScale: U(1.6), uOrderInvert: U(0), uSoftness: U(0.45), uEase: U(2),
                uMode: U(0), uTravel: U(1.5), uSteps: U(10), uCurl: U(0.8), uCurlScale: U(1.3), uCurlSpeed: U(0.15), uTurbGrow: U(0.6),
                uWind: U(new THREE.Vector3()), uGravity: U(new THREE.Vector3()), uRadial: U(0), uVortex: U(0), uAxis: U(new THREE.Vector3(0, 1, 0)),
                uCenter: U(new THREE.Vector3()), uScatter: U(0.05), uFlutter: U(0), uCellScale: U(9), uSpin: U(6), uSwirl: U(3), uFlatten: U(0.8),
                uExpand: U(0.3), uCols: U(140), uQuant: U(18), uGlitch: U(0.12), uFreq: U(18), uAmp: U(0.12), uArc: U(0.6), uIdle: U(1), uPlanar: U(0.6), uBias: U(new THREE.Vector3()),
            },
        });
        this.simScene = new THREE.Scene();
        this.simCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
        this.simScene.add(new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.simMat));

        const geo = new THREE.InstancedBufferGeometry();
        geo.setAttribute('position', new THREE.Float32BufferAttribute([-1, -1, 0, 1, -1, 0, 1, 1, 0, -1, 1, 0], 3));
        geo.setIndex([0, 1, 2, 0, 2, 3]);
        const ref = new Float32Array(all * 2);
        for (let i = 0; i < all; i++) { ref[i * 2] = ((i % texW) + 0.5) / texW; ref[i * 2 + 1] = (Math.floor(i / texW) + 0.5) / texH; }
        geo.setAttribute('aRef', new THREE.InstancedBufferAttribute(ref, 2));
        geo.instanceCount = all;
        this.drawMat = new THREE.ShaderMaterial({
            vertexShader: DRAW_VERT, fragmentShader: DRAW_FRAG,
            uniforms: {
                ...fieldU,
                tPos: U(this.rtCur.texture), tPrev: U(this.rtPrev.texture), tColor: U(this.tex.color), tColorB: U(this.tex.colorB),
                tAttr: U(this.tex.attr), tBase: U(this.tex.base),
                uRes: U(new THREE.Vector2(this.size.w * this.size.pr, this.size.h * this.size.pr)),
                uSize: U(5.5), uStreak: U(0.9), uStreakMax: U(60), uFocus: U(2.7), uAperture: U(0), uGrowth: U(1.5), uOpacity: U(1),
                uExposure: U(1), uSaturation: U(1), uHeatColor: U(new THREE.Color(1, 0.8, 0.6)), uHeatIntensity: U(1), uTint: U(0.3),
                uFade: U(1.4), uBgDim: U(0.55), uDust: U(0.35), uSparkle: U(0.3), uMorph: U(0), uTime: U(0),
            },
            transparent: true, depthTest: false, depthWrite: false,
            blending: THREE.CustomBlending, blendSrc: THREE.OneFactor, blendDst: THREE.OneFactor, blendEquation: THREE.AddEquation,
        });
        // sample rest positions used to measure (and cancel) the field's mean drift over the image
        this.biasSamples = [];
        for (let i = 0; i < 160; i++) { const k = Math.floor(((i + 0.5) / 160) * A.real); this.biasSamples.push([A.base[k * 4], A.base[k * 4 + 1], A.base[k * 4 + 2]]); }
        this.points = new THREE.Mesh(geo, this.drawMat);
        this.points.frustumCulled = false;
        this.scene.add(this.points);
        this.gain = 1;
    }

    _disposeGPU() {
        if (!this.points) return;
        this.scene.remove(this.points);
        this.points.geometry.dispose(); this.drawMat.dispose(); this.simMat.dispose();
        this.rtCur.dispose(); this.rtPrev.dispose();
        Object.values(this.tex).forEach(t => t.dispose());
        this.points = null;
    }

    /** Switch effect preset (see EFFECTS) with optional overrides of any field. */
    setEffect(name, overrides = {}) {
        this.effectName = name;
        const fx = this.fx = resolveEffect(name, overrides);
        if (!this.simMat) return fx;
        const s = this.simMat.uniforms, d = this.drawMat.uniforms, o = fx.order, m = fx.motion, l = fx.look;
        s.uOrderType.value = ORDER_TYPES[o.type] ?? 2;
        s.uOrderDir.value.copy(v3(o.dir)); s.uOrderCenter.value.copy(v3(o.center));
        s.uOrderNoise.value = o.noise; s.uOrderScale.value = o.scale; s.uOrderInvert.value = o.invert ? 1 : 0;
        s.uSoftness.value = fx.softness; s.uEase.value = EASES[fx.ease] ?? 2;
        s.uMode.value = MOTION_MODES[m.mode] ?? 0;
        for (const k of ['travel', 'curl', 'curlScale', 'curlSpeed', 'turbGrow', 'radial', 'vortex', 'scatter', 'flutter', 'cellScale', 'spin',
            'swirl', 'flatten', 'expand', 'cols', 'quant', 'glitch', 'freq', 'amp', 'arc'])
            s['u' + k[0].toUpperCase() + k.slice(1)].value = m[k];
        s.uSteps.value = Math.min(16, Math.max(1, Math.round(m.steps)));
        s.uPlanar.value = m.planar;
        s.uWind.value.copy(v3(m.wind)); s.uGravity.value.copy(v3(m.gravity)); s.uAxis.value.copy(v3(m.axis)).normalize(); s.uCenter.value.copy(v3(m.center));
        s.uIdle.value = l.idle;
        d.uHeatColor.value.copy(linColor(l.heat === 'accent' ? (this.palette?.accent || '#ffe6c8') : l.heat));
        d.uHeatIntensity.value = l.heatIntensity; d.uTint.value = l.tint; d.uFade.value = l.fade; d.uGrowth.value = l.growth;
        d.uStreak.value = l.streak; d.uStreakMax.value = l.streakMax; d.uSparkle.value = l.sparkle; d.uSaturation.value = l.saturation;
        d.uSize.value = l.size; d.uExposure.value = l.brightness; d.uAperture.value = l.aperture; d.uBgDim.value = l.bgDim; d.uDust.value = l.dust;
        d.uMorph.value = m.mode === 'morph' ? 1 : 0;
        this.trailPass.decay = l.trail;
        this._applyOpacity();
        this._emit('effect', name, fx);
        return fx;
    }

    setLook(look = {}) {
        this.look = { ...DEFAULT_LOOK, ...look };
        const L = this.look;
        this.renderer.setClearColor(new THREE.Color(L.background), 1);
        this.renderer.toneMapping = L.toneMapping === 'agx' ? THREE.AgXToneMapping : L.toneMapping === 'none' ? THREE.NoToneMapping : THREE.ACESFilmicToneMapping;
        this.renderer.toneMappingExposure = L.exposure;
        this.bloomPass.strength = L.bloom; this.bloomPass.threshold = L.bloomThreshold;
        // Tight, filmic glow: weight the 5 bloom mips with an exponential falloff instead of UnrealBloom's
        // near-flat default (whose largest mips wash the whole frame in haze). bloomRadius 0..1 widens it.
        this.bloomPass.radius = 0;
        const span = 0.6 + L.bloomRadius * 4;
        this.bloomPass.compositeMaterial.uniforms.bloomFactors.value = [0, 1, 2, 3, 4].map(i => Math.exp(-i / span));
        this.bloomPass.enabled = L.bloom > 0;
        const g = this.gradePass.uniforms;
        g.uVignette.value = L.vignette; g.uGrain.value = L.grain; g.uAberration.value = L.aberration; g.uGlowAmt.value = L.glow;
        g.uGlow.value.copy(linColor(this.palette?.accent || '#ffffff')).multiplyScalar(0.5);
    }

    setCamera(opts = {}) { this.cameraOpts = { preset: 'drift', fov: 35, ...opts }; if (this.cloud) this._autoDistance(); }
    setTimeline(tl) { this.timeline = tl; }
    /** Manual progress (0 formed .. 1 dissolved). Pauses timeline playback; live mode eases toward it. */
    setProgress(p, immediate = false) { this.playing = false; this.progressTarget = Math.max(0, Math.min(1, p)); if (immediate) { this.progress = this.progressTarget; this.progressVel = 0; } }
    play() { this.playing = true; }
    pause() { this.playing = false; this.progressTarget = this.progress; }

    _autoDistance() {
        if (this.cameraOpts.distance && !this.cameraOpts._auto) return;
        const fov = (this.cameraOpts.fov || 35) * Math.PI / 180;
        const a = this.cloud.aspect, sa = this.size.w / this.size.h;
        const halfH = a >= 1 ? 1 / a : 1, halfW = a >= 1 ? 1 : a;
        const needH = Math.max(halfH, halfW / sa) * 1.18;
        this.cameraOpts = { ...this.cameraOpts, distance: needH / Math.tan(fov / 2) + 0.15, _auto: true };
    }

    _applyOpacity() {
        if (!this.drawMat) return;
        const size = this.drawMat.uniforms.uSize.value;
        this.drawMat.uniforms.uOpacity.value = this.gain * Math.pow((this.calibSize || size) / size, 2);
    }

    // Measure on-screen brightness of the formed image and scale particle energy so it matches the photo,
    // independent of particle count, image coverage and resolution. The morph target (image B or the default
    // sphere) is measured too and its colors are rescaled so A and B sit at the same exposure.
    _measure(morphEnd) {
        const w = 320, h = Math.max(32, Math.round(320 * this.size.h / this.size.w));
        const rt = new THREE.WebGLRenderTarget(w, h, { type: THREE.FloatType });
        const d = this.drawMat.uniforms, s = this.simMat.uniforms;
        const saved = { res: d.uRes.value.clone(), dust: d.uDust.value, spark: d.uSparkle.value, op: d.uOpacity.value, morph: d.uMorph.value, mode: s.uMode.value, fade: d.uFade.value, expo: d.uExposure.value };
        // measure at neutral brightness so look.brightness stays an intentional offset (calibration must not cancel it)
        d.uRes.value.set(w, h); d.uDust.value = 0; d.uSparkle.value = 0; d.uOpacity.value = 1; d.uExposure.value = 1;
        if (morphEnd) { s.uMode.value = 6; d.uMorph.value = 1; d.uFade.value = 0; }
        this._applyCamera(0);
        this._simulate(morphEnd ? 1 : 0, 0, morphEnd ? 1 : 0, 0);
        const bg = this.renderer.getClearColor(new THREE.Color()), ba = this.renderer.getClearAlpha();
        this.renderer.setClearColor(0x000000, 0);
        this.renderer.setRenderTarget(rt); this.renderer.clear(); this.renderer.render(this.scene, this.camera);
        const px = new Float32Array(w * h * 4);
        this.renderer.readRenderTargetPixels(rt, 0, 0, w, h, px);
        this.renderer.setRenderTarget(null); this.renderer.setClearColor(bg, ba); rt.dispose();
        d.uRes.value.copy(saved.res); d.uDust.value = saved.dust; d.uSparkle.value = saved.spark; d.uOpacity.value = saved.op;
        d.uMorph.value = saved.morph; s.uMode.value = saved.mode; d.uFade.value = saved.fade; d.uExposure.value = saved.expo;
        let sum = 0, n = 0;
        for (let i = 0; i < w * h; i++) if (px[i * 4 + 3] > 0.3) { sum += 0.2126 * px[i * 4] + 0.7152 * px[i * 4 + 1] + 0.0722 * px[i * 4 + 2]; n++; }
        return n ? sum / n : 0;
    }

    _wantLum(color, attr, real) {
        let want = 0, m = 0;
        for (let k = 0; k < real; k += 7) { want += (0.2126 * color[k * 4] + 0.7152 * color[k * 4 + 1] + 0.0722 * color[k * 4 + 2]) * (attr[k * 4 + 2] > 0.5 ? this.fx.look.bgDim : 1); m++; }
        return want / m;
    }

    _calibrate() {
        const measured = this._measure(false);
        const want = this._wantLum(this.cloud.color, this.cloud.attr, this.cloud.real);
        this.gain = measured > 1e-5 ? Math.max(0.02, Math.min(50, (want / measured) * 0.9)) : 1;
        this.calibSize = this.drawMat.uniforms.uSize.value;
        // morph target: bring B to the same exposure as A
        const mB = this._measure(true);
        const B = this.cloudB || this.cloud;
        const wantB = this._wantLum(B.color, B.attr, B.real);
        const gainB = mB > 1e-5 ? Math.max(0.02, Math.min(50, (wantB / mB) * 0.9)) : this.gain;
        const k = gainB / this.gain;
        if (Math.abs(k - 1) > 0.02) {
            const src = this.tex.colorB.image.data;
            const out = src === this.tex.color.image.data ? src.slice() : src;
            for (let i = 0; i < out.length; i += 4) { out[i] *= k; out[i + 1] *= k; out[i + 2] *= k; }
            this.tex.colorB.image.data = out; this.tex.colorB.needsUpdate = true;
        }
        this._applyOpacity();
    }

    _applyCamera(time) {
        const dur = this.timeline?.duration || 12;
        const c = cameraAt(this.cameraOpts, time, dur);
        const u = this.user;
        const pos = new THREE.Vector3(...c.pos), tgt = new THREE.Vector3(...c.target);
        if (u.az || u.el || u.zoom !== 1 || u.px || u.py) {
            const off = pos.clone().sub(tgt);
            const sph = new THREE.Spherical().setFromVector3(off);
            sph.theta += u.az + u.px * 0.06; sph.phi = Math.max(0.15, Math.min(Math.PI - 0.15, sph.phi - u.el + u.py * 0.04)); sph.radius *= u.zoom;
            pos.copy(tgt).add(new THREE.Vector3().setFromSpherical(sph));
        }
        this.camera.position.copy(pos);
        this.camera.lookAt(tgt);
        if (this.camera.fov !== c.fov) { this.camera.fov = c.fov; this.camera.updateProjectionMatrix(); }
        if (this.drawMat) this.drawMat.uniforms.uFocus.value = this.fx?.look?.focus ?? pos.distanceTo(tgt);
    }

    _flowBias(t, out) {
        const f = this.field, s = this.simMat.uniforms, sc = s.uCurlScale.value, tt = t * s.uCurlSpeed.value;
        const amt = this.fx?.motion?.debias ?? 1;
        let x = 0, y = 0, z = 0;
        for (const p of this.biasSamples) {
            for (let i = 0; i < 12; i++) {
                const c = Math.cos(f.K[i * 3] * p[0] * sc + f.K[i * 3 + 1] * p[1] * sc + f.K[i * 3 + 2] * p[2] * sc + f.P[i] + f.W[i] * tt);
                x += f.C[i * 3] * c; y += f.C[i * 3 + 1] * c; z += f.C[i * 3 + 2] * c;
            }
        }
        const n = this.biasSamples.length / amt;
        return out.set(x / n, y / n, z / n);
    }

    _simulate(pPrev, tPrev, p, t) {
        const r = this.renderer, s = this.simMat.uniforms;
        s.uP.value = pPrev; s.uTime.value = tPrev;
        this._flowBias(tPrev, s.uBias.value);
        r.setRenderTarget(this.rtPrev); r.render(this.simScene, this.simCam);
        s.uP.value = p; s.uTime.value = t;
        this._flowBias(t, s.uBias.value);
        r.setRenderTarget(this.rtCur); r.render(this.simScene, this.simCam);
        r.setRenderTarget(null);
    }

    /**
     * Deterministic render of time `t` (seconds). Used by offline export: prev state = t - dt.
     * opts.progress overrides the timeline value.
     */
    renderAt(t, dt = 1 / 60, opts = {}) {
        if (!this.points) return;
        const tl = this.timeline;
        const pAt = (x) => (opts.progress != null ? opts.progress : progressAt(tl.keys, timelineTime(tl, Math.max(0, x))));
        const pPrev = opts.prevProgress != null ? opts.prevProgress : pAt(t - dt);
        this._applyCamera(t);
        this._simulate(pPrev, t - dt, pAt(t), t);
        this.drawMat.uniforms.uTime.value = t;
        this.gradePass.uniforms.uTime.value = t;
        this.progress = pAt(t);
        this.composer.render();
    }

    /** Live loop with timeline playback or eased manual scrubbing. */
    start() {
        if (this._raf) return;
        let last = performance.now();
        const tick = (now) => {
            this._raf = requestAnimationFrame(tick);
            const dt = Math.min(0.05, (now - last) / 1000); last = now;
            if (!this.points) return;
            const u = this.user, k = 1 - Math.exp(-dt * 6);
            u.az += (u.tAz - u.az) * k; u.el += (u.tEl - u.el) * k; u.zoom += (u.tZoom - u.zoom) * k;
            u.px += (u.tpx - u.px) * k * 0.5; u.py += (u.tpy - u.py) * k * 0.5;
            const pPrev = this.progress, tPrev = this.time;
            this.time += dt;
            if (this.playing) {
                this.progress = progressAt(this.timeline.keys, timelineTime(this.timeline, this.time));
                this.progressTarget = this.progress;
            } else { // critically damped spring toward the fader: silky even with a jerky mouse
                const w = 9, x = this.progress - this.progressTarget;
                const a = -w * w * x - 2 * w * this.progressVel;
                this.progressVel += a * dt; this.progress += this.progressVel * dt;
                this.progress = Math.max(0, Math.min(1, this.progress));
            }
            this._applyCamera(this.time);
            this._simulate(pPrev, tPrev, this.progress, this.time);
            this.drawMat.uniforms.uTime.value = this.time;
            this.gradePass.uniforms.uTime.value = this.time;
            this.composer.render();
            this._emit('frame', { time: this.time, progress: this.progress });
        };
        this._raf = requestAnimationFrame(tick);
    }

    stop() { cancelAnimationFrame(this._raf); this._raf = null; }

    /**
     * Switch the drawing buffer to an exact export size (e.g. 1080x1920) without touching the on-screen layout.
     * Pair with endExport(). Used by recorder.js; renderAt() then produces frames at that size.
     */
    beginExport(width, height) {
        if (this._export) return;
        this._export = { w: this.size.w, h: this.size.h, pr: this.size.pr, cam: { ...this.cameraOpts }, px: this.user.px, py: this.user.py };
        this.user.px = this.user.py = this.user.tpx = this.user.tpy = 0;   // no mouse parallax in exports
        this.renderer.setPixelRatio(1);
        this.renderer.setSize(width, height, false);
        this.composer.setPixelRatio(1);
        this.composer.setSize(width, height);
        this.camera.aspect = width / height;
        this.camera.updateProjectionMatrix();
        this.drawMat?.uniforms.uRes.value.set(width, height);
        this.gradePass.uniforms.uRes.value.set(width, height);
        this.size = { w: width, h: height, pr: 1 };
        if (this.cloud) this._autoDistance();            // re-fit the framing for the export aspect ratio
        this.trailPass.reset(this.renderer);
    }

    endExport() {
        const e = this._export; if (!e) return;
        this._export = null;
        this.cameraOpts = e.cam;
        this.resize(e.w, e.h, e.pr);
        this.trailPass.reset(this.renderer);
    }

    dispose() {
        this.stop(); this._ro?.disconnect(); this._disposeGPU();
        this.composer.dispose?.(); this.renderer.dispose();
        if (this.canvas.parentElement === this.container && !(this.opts.keepCanvas)) this.canvas.remove();
    }
}
