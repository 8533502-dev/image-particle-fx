#!/usr/bin/env node
// Smoke test + visual proof: renders the scene at several dissolve amounts (with motion) and writes a
// contact sheet you can look at. Use it after every change instead of guessing.
//
// node check.mjs --dir ./particle-fx [--scene scene.json] [--out check.png] [--w 1280 --h 720] [--p 0,0.25,0.5,0.8]
import path from 'node:path';
import fs from 'node:fs';
import { execFileSync } from 'node:child_process';
import { parseArgs, openApp, hasFfmpeg } from './lib.mjs';

const a = parseArgs(process.argv.slice(2));
const dir = path.resolve(a.dir || a._[0] || '.');
const W = +(a.w || 1280), H = +(a.h || 720);
const ps = String(a.p || '0,0.25,0.5,0.8').split(',').map(Number);
const out = path.resolve(a.out || path.join(dir, 'check.png'));
const tmp = fs.mkdtempSync(path.join(path.dirname(out), '.check-'));

const app = await openApp({ dir, scene: a.scene || 'scene.json', width: W, height: H, quiet: true });
console.log('info', JSON.stringify({ effect: app.info.effect, count: app.info.count, depth: app.info.depthSource, accent: app.info.palette?.accent, palette: app.info.palette?.colors?.map(c => c.hex) }));
const shots = [];
// --effects all|a,b,c : one tile per effect at a single progress value (default 0.45) — an effect gallery for this image
const effects = a.effects ? (a.effects === 'all' ? await app.page.evaluate(() => Object.keys(window.FX.effects)) : String(a.effects).split(',')) : null;
const jobs = effects ? effects.map(e => ({ effect: e, p: +(a.p || 0.45) })) : ps.map(p => ({ p }));
for (const [i, job] of jobs.entries()) {
    const p = job.p;
    await app.page.evaluate((e, label) => {
        if (e) window.FX.fx.setEffect(e, {});
        let el = document.getElementById('__label');
        if (!el) { el = document.createElement('div'); el.id = '__label'; el.style.cssText = 'position:fixed;left:18px;top:14px;font:600 22px system-ui;color:#fff;text-shadow:0 1px 6px #000;z-index:99'; document.body.appendChild(el); }
        el.textContent = label;
    }, job.effect || null, job.effect ? `${job.effect}  p=${p}` : `p=${p}`);
    const t = 2 + i * 0.37;
    // approach p from slightly lower so the frame has real motion (streaks), like playback would
    for (let k = 6; k >= 0; k--) {
        const pp = Math.max(0, p - k * 0.012), prev = Math.max(0, pp - 0.012);
        await app.page.evaluate((t, pp, prev) => window.FX.renderAt(t, 1 / 60, { progress: pp, prevProgress: prev }), t - k / 60, pp, prev);
    }
    const f = path.join(tmp, `p${i}.png`);
    await app.page.screenshot({ path: f });
    shots.push(f);
}
await app.close();

if (hasFfmpeg() && shots.length > 1) {
    const cols = shots.length <= 2 ? shots.length : shots.length <= 4 ? 2 : shots.length <= 9 ? 3 : 4;
    const rows = Math.ceil(shots.length / cols);
    const inputs = shots.flatMap(s => ['-i', s]);
    const tw = Math.round(W / Math.max(2, cols) / 2) * 2, th = Math.round(tw * H / W / 2) * 2;
    const filt = shots.map((_, i) => `[${i}]scale=${tw}:${th}[s${i}]`).join(';') + ';' +
        shots.map((_, i) => `[s${i}]`).join('') + `xstack=inputs=${shots.length}:layout=` +
        shots.map((_, i) => `${(i % cols) * tw}_${Math.floor(i / cols) * th}`).join('|') + `:fill=black`;
    execFileSync('ffmpeg', ['-y', '-v', 'error', ...inputs, '-filter_complex', filt, out]);
    fs.rmSync(tmp, { recursive: true });
    console.log(`contact sheet (${rows}x${cols}):`, effects ? effects.join(' / ') : `progress ${ps.join(' / ')}`, '->', out);
} else {
    shots.forEach((s, i) => fs.renameSync(s, out.replace(/\.png$/, `_${jobs[i].effect || 'p' + jobs[i].p}.png`)));
    fs.rmSync(tmp, { recursive: true });
    console.log('screenshots:', out.replace(/\.png$/, '_p*.png'));
}
if (app.errors.length) { console.log('PAGE ERRORS:\n' + app.errors.join('\n')); process.exitCode = 1; }
