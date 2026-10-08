---
name: image-particle-fx
description: Turn any image into a cinematic 3D point-cloud particle effect — the picture dissolves into flowing particles (fluid erosion, embers, sand, shatter, galaxy, singularity, data rain, morph A→B…) and reassembles, with AI depth, motion blur, HDR bloom and depth of field. Produces a ready-to-run web page with a DJ-style dissolve fader, frame-exact offline video export (MP4/ProRes, any resolution/fps), and React/Vue components for websites. Use this skill whenever the user gives (or mentions) an image/photo/logo/poster/product shot and wants it as particles, 粒子, 点云, 粒子消散/粒子重组/粒子特效, "像 TouchDesigner 那种粒子效果", dissolve/disintegrate/Thanos-snap/sand/ash/ember effects, a particle hero section, a particle transition between two images, or a particle music/VJ visual — even if they don't say "point cloud" or "three.js".
---

# Image → Particle FX

You turn a still image into a living particle piece. The engine, UI, exporter and components already exist in this
skill — your job is **art direction + configuration + verification**, not rewriting the renderer.
`<skill>` below means the directory containing this SKILL.md.

What the engine already does well (so don't reinvent it): AI depth (Depth Anything V2 in the browser, with a
luminance fallback), subject/background separation, importance sampling with density compensation (the formed
state looks like the photo), divergence-free flow fields with curved advected paths, velocity-aligned motion blur,
DOF, HDR heat fronts, ACES tone mapping, scrubbable deterministic timeline, frame-exact export.

## Workflow

### 1. Scaffold the app next to the user's work

```bash
node <skill>/scripts/scaffold.mjs ./particle-fx --image path/to/image.jpg            # add --morph second.png for A→B
```
Creates `particle-fx/{index.html, app.js, fx/, presets/, media/, scene.json}`. Re-running only refreshes `fx/` and adds images.

No image from the user yet, or they want to see what it can do? Start from a bundled, art-directed preset:
`node <skill>/scripts/scaffold.mjs ./particle-fx --preset great-wave` (`--list-presets` lists all: pink dahlias,
white orchids, Hokusai wave, Starry Night, Earthrise→Blue Marble morph, Fan Kuan landscape, jellyfish, nebula portal). They are
public-domain / CC0 works or original art made for this skill (`assets/presets/CREDITS.md`); the app's 示例图 menu
switches between them. Their `presets.json` entries are good worked examples of art direction to imitate.
Requirements: Node 18+, Chrome/Edge/Chromium (for checks & export), ffmpeg (for MP4), internet for CDNs on first run.

### 2. Look at the image and art-direct it (the part that makes it good)

Open the image yourself and decide, explicitly:
- **Subject & mood** (soft/organic vs hard/man-made; warm vs cold; calm vs energetic) → effect.
- **Direction of motion** that agrees with the picture (wind from the empty side, embers rise, impact point on the object).
- **Palette**: `look.heat: "accent"` uses the image's own accent color; pick a contrasting hot color for monochrome images.
- **Camera** and **timeline** (hold → dissolve → linger → reform, durations that let the image be read).

Use the catalog and recipes in `references/effects.md` (read it — it has the image→effect mapping table).
Write the result into `scene.json` (format: `references/scene-format.md`). Only override what you need;
presets are already tuned. Tell the user in one or two sentences what you chose and why.

### 3. Verify visually — always, before showing anything

```bash
node <skill>/scripts/check.mjs --dir ./particle-fx                       # 4 frames: p = 0, .25, .5, .8
node <skill>/scripts/check.mjs --dir ./particle-fx --effects all --p 0.35  # gallery of every effect on THIS image
```
Read the PNG it writes and judge it like a motion designer:
- p=0 must look like the photo (not hazy, not neon-outlined). If not: `look.exposure`, `bgDensity`, `bgDim`.
- Mid-dissolve should show structure (streams, eddies, shards), not a milky blur or a screen full of big dots.
  Troubleshooting table: `references/engine.md`.
- Iterate on `params` until it's genuinely beautiful; 2–3 rounds is normal. If unsure between effects, show the
  user the gallery and let them pick.

### 4. Deliver what the user asked for

- **Live page** (default): `node <skill>/scripts/serve.mjs ./particle-fx` → open the printed URL. Controls: drag the
  fader, Space play/pause, 1–9 switch effects, H hide UI, drag to orbit, wheel to zoom, drop a new image anywhere.
- **Video, no setup**: the page's 导出视频 button renders the timeline frame by frame in the browser (WebCodecs H.264
  MP4, 720p–4K, 30/60 fps, full loop or just the dissolve) and downloads it. Point users here when they only have the
  hosted page. (Sandboxed embeds block downloads; a standalone tab or GitHub Pages works.)
- **Video, scripted**: `node <skill>/scripts/export.mjs --dir ./particle-fx --w 1920 --h 1080 --fps 60 [--duration 12] [--prores]`
  Frame-exact (no dropped frames, unlike screen recording). 4K works (`--w 3840 --h 2160`), it just takes longer.
  Vertical for social: `--w 1080 --h 1920`. Frames only: `--frames-dir ./frames`.
- **Website component**: copy `<skill>/assets/fx/` into the project (e.g. `src/fx/`), `npm i three`, and use
  `<skill>/assets/components/ParticleImage.jsx` (React) or `ParticleImage.vue` (Vue 3). Bind `progress` to scroll or
  hover for a hero section; omit it to loop the timeline. API details: `references/engine.md`.

## Principles

- **Configure, don't fork.** New looks are usually a preset in `fx/effects.js` or `params` in scene.json. Touch shaders
  only for a genuinely new motion type, and keep the sim a pure function of (progress, time) — scrubbing and export
  depend on it (`references/engine.md` → "Adding an effect").
- **Readable first, spectacular second.** The audience must recognize the image before it breaks apart and while it
  reforms; restraint in bloom/heat/trails is what separates "cinematic" from "fog".
- **Make motion mean something.** The effect should feel caused by the picture (petals in wind, statue to sand,
  logo out of a galaxy) — that's the difference between a template and a piece.
- **Prove it with pixels.** Never claim it looks good without having looked at a `check.mjs` render.
