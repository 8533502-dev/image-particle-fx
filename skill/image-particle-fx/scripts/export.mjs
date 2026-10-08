#!/usr/bin/env node
// Offline, frame-exact video export. Renders the app in headless Chrome (real GPU) one frame at a time
// and pipes PNG frames straight into ffmpeg — no dropped frames, any resolution/fps.
//
// node export.mjs --dir ./particle-fx [--scene scene.json] [--out out.mp4] [--w 1920 --h 1080] [--fps 60]
//                 [--duration secs] [--start secs] [--crf 16] [--frames-dir ./frames] [--prores]
import path from 'node:path';
import fs from 'node:fs';
import { spawn } from 'node:child_process';
import { parseArgs, openApp, hasFfmpeg } from './lib.mjs';

const a = parseArgs(process.argv.slice(2));
const dir = path.resolve(a.dir || a._[0] || '.');
const W = +(a.w || 1920), H = +(a.h || 1080), FPS = +(a.fps || 60);
const out = path.resolve(a.out || path.join(dir, 'export', `particle-fx_${W}x${H}_${FPS}fps.${a.prores ? 'mov' : 'mp4'}`));
if (!fs.existsSync(path.join(dir, 'index.html'))) { console.error('找不到', path.join(dir, 'index.html'), '（--dir 应指向 particle-fx 应用目录）'); process.exit(1); }
const framesDir = a['frames-dir'] ? path.resolve(a['frames-dir']) : null;
if (!framesDir && !hasFfmpeg()) { console.error('需要 ffmpeg（brew install ffmpeg / apt install ffmpeg），或改用 --frames-dir 只导出 PNG 序列。'); process.exit(1); }

const app = await openApp({ dir, scene: a.scene || 'scene.json', width: W, height: H });
console.log('已加载：', JSON.stringify({ effect: app.info.effect, count: app.info.count, depth: app.info.depthSource, accent: app.info.palette?.accent }));
const duration = +(a.duration || (await app.page.evaluate(() => window.FX.duration())));
const start = +(a.start || 0);
const total = Math.round(duration * FPS);

let ff = null;
if (!framesDir) {
    fs.mkdirSync(path.dirname(out), { recursive: true });
    const enc = a.prores
        ? ['-c:v', 'prores_ks', '-profile:v', '3', '-pix_fmt', 'yuv422p10le']
        : ['-c:v', 'libx264', '-preset', 'slow', '-crf', String(a.crf || 16), '-pix_fmt', 'yuv420p', '-movflags', '+faststart'];
    ff = spawn('ffmpeg', ['-y', '-v', 'error', '-f', 'image2pipe', '-framerate', String(FPS), '-c:v', 'png', '-i', '-', ...enc, out], { stdio: ['pipe', 'inherit', 'inherit'] });
} else fs.mkdirSync(framesDir, { recursive: true });

const t0 = Date.now();
// warm up so trails/feedback have history identical to live playback
for (let i = Math.max(0, -10); i < 0; i++) await app.page.evaluate((t, dt) => window.FX.renderAt(t, dt), start + i / FPS, 1 / FPS);
for (let f = 0; f < total; f++) {
    const t = start + f / FPS;
    await app.page.evaluate((t, dt) => window.FX.renderAt(t, dt), t, 1 / FPS);
    const png = await app.page.screenshot({ type: 'png', omitBackground: false });
    if (ff) { if (!ff.stdin.write(png)) await new Promise(r => ff.stdin.once('drain', r)); }
    else fs.writeFileSync(path.join(framesDir, `f${String(f).padStart(5, '0')}.png`), png);
    if (f % 10 === 0 || f === total - 1) {
        const el = (Date.now() - t0) / 1000;
        process.stdout.write(`\r渲染 ${f + 1}/${total} 帧  ${el.toFixed(0)}s  剩余约 ${((el / (f + 1)) * (total - f - 1)).toFixed(0)}s   `);
    }
}
console.log();
await app.close();
if (ff) { ff.stdin.end(); await new Promise(r => ff.on('close', r)); console.log('完成：', out); }
else console.log('PNG 序列：', framesDir);
if (app.errors.length) console.log('页面报错：\n' + app.errors.join('\n'));
