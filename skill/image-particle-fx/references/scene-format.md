# scene.json format

The app (`index.html`) loads `scene.json` (or `?scene=other.json`). The same object can be passed to
`fx.load(scene)` / the React and Vue components. Every field is optional except `image`.

```jsonc
{
  "image": "media/photo.jpg",          // path relative to the app folder, or any CORS-enabled URL
  "morphTo": "media/second.png",        // optional: second image for the "morph" effect (A → B)
  "depthMap": "media/photo.depth.png",  // optional precomputed grayscale depth (white = near); skips the AI model,
  "morphDepthMap": "media/second.depth.png", //   needed where the model can't load (sandboxed/hosted pages, offline)
  "quality": "high",                    // "low" 150k | "high" 400k (default) | "ultra" 700k particles
  "count": 400000,                      // exact particle count (overrides quality)
  "depth": { "mode": "ai", "strength": 0.9 },   // mode: "ai" (Depth Anything V2; falls back to luminance after ~30-45 s if the model can't load) | "luminance"; strength 0..2 = relief
  "bgDensity": 0.35,                    // 0..1 particle density of the background vs the subject
  "dust": 0.015,                        // fraction of extra ambient dust particles floating in the volume

  "effect": "fluid-erosion",            // preset id, see references/effects.md
  "params": {                           // deep-merged over the preset — only list what you change
    "order":  { "type": "sweep", "dir": [1, 0, 0], "noise": 0.4, "scale": 2, "invert": false, "center": [0, 0, 0] },
    "softness": 0.45,                   // 0.05..1 how long each particle travels (wide = soft, overlapping dissolve)
    "ease": "inQuad",                   // linear | inOutCubic | inQuad | inCubic | outExpo | inOutSine
    "motion": { "travel": 1.4, "curl": 1.0, "curlScale": 1.4, "wind": [0.8, 0.2, 0] },
    "look":   { "heat": "#ff8a3d", "heatIntensity": 2, "size": 5.5, "streak": 0.6, "aperture": 4 }
  },

  "camera": { "preset": "drift", "fov": 35, "speed": 1, "amount": 1, "height": 0, "target": [0, 0, 0] },
  // presets: static | drift | half-orbit | orbit | push | pull | crane | dolly-zoom | handheld
  // "distance" is auto-fitted to the image unless you set it

  "look": {                             // global grade
    "exposure": 1.5, "bloom": 0.45, "bloomRadius": 0.2, "bloomThreshold": 1.0,
    "vignette": 0.45, "grain": 0.03, "aberration": 0.0025, "background": "#040507",
    "glow": 0, "toneMapping": "aces"    // aces (default, bright & punchy) | agx (softer, greyer filmic) | none
  },

  "timeline": {                         // drives playback AND offline export
    "duration": 12, "loop": true,
    "keys": [                           // p: 0 = image formed, 1 = fully dissolved
      { "t": 0, "p": 0 },
      { "t": 1.5, "p": 0 },
      { "t": 5.5, "p": 1, "ease": "cubic" },   // ease shapes the segment ENDING at this key
      { "t": 6.5, "p": 1 },
      { "t": 10.5, "p": 0, "ease": "cubic" },
      { "t": 12, "p": 0 }
    ]
  }
}
```

Timeline easings: `linear sine cubic cubicIn cubicOut expoIn expoOut expo hold`.

## Coordinate space

The cloud is centered at the origin; the longer image side spans −1..1, +y is up, +z points to the camera.
Vectors in `params` (dir, wind, gravity, center, axis) use this space. The subject pops forward (+z),
background recedes (−z) by `depth.strength`.

## All tunable params (defaults in `fx/effects.js` → `DEFAULTS`)

| group | key | meaning |
|---|---|---|
| order | type | `sweep` (along `dir`), `radial` (from `center`), `noise`, `depth` (near first), `luminance` (dark first), `random`, `edge` (edges first) |
| order | noise / scale | blend in fbm noise for an organic, broken front; scale = noise frequency |
| order | invert | reverse who leaves first (e.g. radial: outer first) |
| motion | mode | `flow` (advected field — most presets), `shatter`, `singularity`, `galaxy`, `datarain`, `ripple`, `morph`, `ferro` |
| motion | travel, steps | path length and integration steps (curvature) |
| motion | curl, curlScale, curlSpeed, turbGrow | divergence-free turbulence: strength, size (higher = smaller eddies), evolution speed, growth along the path |
| motion | wind, gravity, radial, vortex(+axis), scatter, flutter | extra forces; `planar` 0..1 damps motion toward the camera; `debias` 0..1 cancels net drift of the field |
| motion | cellScale, spin | shatter: shard size (cells per unit) and tumble |
| motion | swirl, flatten, expand, freq, axis | singularity/galaxy: spin rate, disk flattening, radial growth, arm twist |
| motion | cols, quant, glitch | data rain: columns, step quantization, horizontal slip |
| motion | freq, amp | ripple: ring frequency/height; ferro: spike frequency/length |
| motion | arc | morph: how far paths bow out through the flow |
| look | heat, heatIntensity | color & HDR strength of the dissolving front (`"accent"` = image's accent color) |
| look | tint | how much flying particles shift toward the heat color |
| look | fade, growth | alpha falloff exponent along the path (0 = never fades) / size multiplier in flight |
| look | size, streak, streakMax | particle size, motion-blur length (shutter), max streak px @1000px height |
| look | brightness | particle energy before bloom (use it, not global exposure, to stop bright images from blooming out) |
| look | sparkle, saturation, aperture, bgDim, dust, trail, idle | glints, color saturation, depth-of-field, background brightness, ambient dust, feedback trails (0..0.97), breathing when formed |
