# Engine internals, extending & troubleshooting

Read this when you need to add an effect, change shaders, embed the engine, or debug a visual problem.

## Pipeline

```
image ─► sampler.js ──► depth (Depth Anything V2, transformers.js) ─► subject mask (alpha or Otsu on depth)
                      └► Sobel edges, k-means palette, importance sampling (+ density compensation)
       ─► float textures: tBase(xyz rest, seed) tAttr(lum, edge, layer, depth) tColor(rgb linear × weight, size)
SIM pass (sim.glsl.js, one texel per particle) : position = f(rest, progress, time)   ← pure function
   rendered twice per frame: at (p_prev, t_prev) and (p, t)  → velocity for motion blur
DRAW pass (draw.glsl.js, instanced quads) : velocity-aligned capsules, DOF spread, energy conservation, heat front
POST : RenderPass(HalfFloat HDR) → Trail feedback → UnrealBloom (threshold ≈1: only HDR highlights) → OutputPass (ACES) → grade
```

Because positions are a pure function of `progress` and `time`, playback can be scrubbed both ways, and
`renderAt(t)` is frame-exact — that's what the offline exporter relies on. Never introduce per-frame
state (integrating velocity across frames) into the sim; express new motion as a closed-form or
fixed-step path from the rest position.

## Per-particle progress

`d = order value 0..1` → `start = d·(1−softness)` → `t = clamp((P − start)/softness)` → `e = ease(t)`.
`t` drives alpha/heat in the draw pass; `e` drives distance along the path.

## The flow field

`field.js` builds 12 random Fourier modes of a vector potential; the velocity is its analytic curl, so it is
divergence-free (no sinks — particles never clump unnaturally). Two lessons baked into it:
- wave vectors are kept mostly in the image plane and frequencies start at 2 so no mode is constant across the image;
- the engine still measures the mean flow over the image every frame (`_flowBias`) and subtracts it (`uBias`),
  otherwise the whole cloud slides one way. `motion.debias < 1` keeps some sweep (used by `silk`).

## Adding an effect

1. Most new looks are just a preset in `effects.js` (order + flow forces + look). Try that first.
2. A genuinely new motion: add `else if (uMode == 8) { ... }` in `sim.glsl.js` computing `p` from `rest`, `e`,
   `seed`, `rnd`, `uTime`; register `MOTION_MODES.newname = 8`; add any uniforms to `engine.js` (`simMat`
   uniforms + the copy loop in `setEffect`) and to `DEFAULTS.motion`.
3. Verify with `node scripts/check.mjs --dir <app> --effects <id> --p 0.2` and `--p 0,0.25,0.5,0.8`.

## Brightness model (why the formed image looks like the photo)

Additive blending + importance sampling would make detailed areas glow. The sampler multiplies each particle's
color by `meanImportance / importance` (density compensation), and `_calibrate()` renders the formed state once,
measures mean on-screen luminance and sets `uOpacity` so it matches the photo regardless of particle count,
resolution or coverage. If you change sizes or blending, keep calibration in the loop (`look.size` changes are
compensated automatically by `(calibSize/size)²`).

## Troubleshooting

| symptom | cause / fix |
|---|---|
| everything hazy / milky glow | bloom threshold too low or heat area too wide. Keep `bloomThreshold ≈ 1`, lower `heatIntensity`, `growth`, `trail` |
| whole cloud drifts off one way | field bias: raise `curlScale` (≥1.2) or keep `debias: 1` |
| screen filled with big blurry particles | particles flying at the camera: raise `motion.planar`, lower `travel`/`radial` |
| black background shows as a colored card | `bgDim` lower, or `bgDensity` lower; tint/heat already scale with particle luminance |
| formed image too dark/bright, or bright image blooms out | `params.look.brightness` (pre-bloom, e.g. 0.7 for pale/white subjects); `look.exposure` only scales after bloom |
| depth looks flat | `depth.strength` 1.2–1.6; check `info.depthSource` is `ai` (falls back to luminance offline) |
| holes when orbiting | depth cliffs are filled automatically; raise `quality` or reduce `camera.amount` |
| slow on laptops | `quality: "low"`, or `count: 200000`; export is offline so quality there is free |
| `WebGL: float render target` errors | needs WebGL2 + EXT_color_buffer_float (all modern desktop/mobile browsers) |

## Embedding API (`fx/index.js`)

```js
import { ParticleFX, EFFECTS } from './fx/index.js';
const fx = new ParticleFX(containerEl, { interactive: true });   // or pass a <canvas>
const info = await fx.load({ image: '/hero.jpg', effect: 'silk' }); // → { palette, depthSource, count }
fx.start();                       // live loop (timeline playback)
fx.setProgress(0.4);              // manual control (spring-smoothed); fx.play() resumes the timeline
fx.setEffect('ember-ascend', { look: { heatIntensity: 2 } });
fx.setCamera({ preset: 'push' }); fx.setLook({ bloom: 0.6 }); fx.setTimeline({...});
fx.on('frame', ({ time, progress }) => {}); fx.dispose();
```
Bundlers: `npm i three`; the engine imports `three` and `three/examples/jsm/...`. transformers.js is loaded
from the CDN at runtime (ignored by Vite/webpack); pass `depth: { mode: 'luminance' }` to skip AI depth entirely.
Scroll-driven hero: `fx.setProgress(scrollY / sectionHeight)` on scroll — the spring makes it silky.
