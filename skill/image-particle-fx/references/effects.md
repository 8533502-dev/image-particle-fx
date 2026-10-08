# Effect catalog & choosing by image

14 presets, each designed to look distinct. Pick by **what is in the picture and what story the motion should tell**,
then refine with `params`. The live app (keys 1–9 + list) and `scripts/check.mjs --effects all` show them all on the
user's own image — use the gallery when unsure instead of guessing.

| id | 名称 | motion | reads as | strongest for |
|---|---|---|---|---|
| `fluid-erosion` | 流体侵蚀 | noise front → advected turbulent flow, eddies | being washed away by invisible water | default; portraits, sculpture, still life, anything |
| `ember-ascend` | 余烬升腾 | top-down burn, rising + curl, orange HDR front, sparks | burning away, memory, farewell | fire, night, warm portraits, candles |
| `sand-drift` | 风蚀流沙 | windward edge erodes into long sand streams | time passing, erosion | statues, architecture, desert, vintage |
| `singularity` | 奇点吞噬 | outer first, spiral into a flattened accretion disk → point | being swallowed | space/sci-fi, logo outros, "sucked away" transitions |
| `supernova` | 超新星 | center bursts first, shockwave outward, hot white | release of energy | product reveals, music drops, climax |
| `galaxy` | 星系旋臂 | differential rotation into a tilted spiral disk (end state persists) | everything becomes a galaxy | night sky, dreams, abstract — good as a second act |
| `shatter` | 晶格碎裂 | rigid shards tumble and fall from an impact point | breaking | glass, ice, products, sport, "break the limit" |
| `data-rain` | 数据流瀑 | columns fall in quantized steps with glitch slips, green | digitization | cyber, cities at night, UI, tech portraits |
| `ferro` | 磁流体 | spikes grow out of the surface, then pull apart | magnetic, dark, luxurious | black/metal objects, audio-reactive looks |
| `silk` | 丝绸流线 | long ribbons on a large slow field, soft trails | grace | fashion, dance, water, soft portraits |
| `ripple` | 共振涟漪 | wave rings from `center`, crests lift off as turbulent spray | sound, resonance, water | lakes/sea, music, meditation, tech logos (set `order.center` = `motion.center` on the water/focal point) |
| `petal-wind` | 花瓣风 | gust from one side, fluttering, colors stay vivid | a breeze | flowers, plants, spring, weddings |
| `ink-diffuse` | 水墨晕散 | dark areas bloom outward and soften like ink in water | quiet, poetic | Chinese painting, calligraphy, B&W photos |
| `morph` | 重组变形 | A flows along arcs and reassembles as B (or a sphere) | transformation | before/after, product evolution, logo reveal |

## Mapping image → design (do this explicitly, it is what makes the result feel intentional)

1. **Subject & mood** — what is it, is it soft or hard, warm or cold, calm or energetic?
   soft/organic → flow-based (fluid, silk, petal, ink); hard/man-made → shatter, sand, data-rain;
   luminous/night → ember, singularity, supernova, galaxy.
2. **Direction** — make motion agree with the picture: wind from the empty side of the frame, embers rise,
   sand blows away from a sculpture's face, shatter's `center` at the object's most "impactful" point
   (`[x, y, z]` in cloud space, z≈0.3 = in front).
3. **Palette** — `look.heat: "accent"` uses the color extracted from the image (shown in the app's palette chip
   and printed by `check.mjs`). Override with a complementary or hotter color when the image is monochrome
   (e.g. B&W statue + `#ffb46b` warm front).
4. **Background** — busy backgrounds: lower `bgDensity` (0.15–0.25) and `look.bgDim` so the subject leads;
   cut-out PNG with alpha: background is dropped automatically.
5. **Camera** — `drift` (default, safe), `half-orbit` shows off depth, `push` for intimacy, `dolly-zoom` for drama,
   `static` for clean UI/web hero usage.
6. **Timeline** — hold the formed image long enough to be read (≥1.2 s), dissolve 3–5 s, hold the abstract state
   briefly, reform slightly faster than the dissolve. For a web hero, bind `progress` to scroll instead.

## Recipes

```jsonc
// Portrait, emotional: slow erosion with a warm front, subtle orbit
{ "effect": "fluid-erosion", "params": { "look": { "heat": "#ffb27a", "heatIntensity": 1.8 }, "softness": 0.55 },
  "camera": { "preset": "half-orbit", "amount": 0.6 } }

// Sculpture weathering in a crosswind from the left
{ "effect": "sand-drift", "params": { "order": { "dir": [1, 0.15, 0] }, "motion": { "wind": [1.8, 0.1, 0] } } }

// Product shattering toward camera
{ "effect": "shatter", "params": { "order": { "center": [0, 0, 0.3] }, "motion": { "center": [0, 0, 0.4], "wind": [0, 0, 1.0], "cellScale": 12 } } }

// Logo: forms from a galaxy (play timeline in reverse: start at p=1)
{ "effect": "galaxy", "timeline": { "duration": 8, "loop": false, "keys": [ { "t": 0, "p": 1 }, { "t": 5, "p": 0, "ease": "expoOut" }, { "t": 8, "p": 0 } ] } }
```
