#!/usr/bin/env node
// Copy the app + engine into a project folder and (optionally) drop in an image and a scene.json.
//
// node scaffold.mjs <targetDir> [--image photo.jpg] [--morph second.jpg] [--effect fluid-erosion] [--preset id] [--force]
// node scaffold.mjs --list-presets
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from './lib.mjs';

const SKILL = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const a = parseArgs(process.argv.slice(2));
const PRESETS = JSON.parse(fs.readFileSync(path.join(SKILL, 'assets/presets/presets.json'), 'utf8'));
if (a['list-presets']) {
    for (const p of PRESETS) console.log(`${p.id.padEnd(22)} ${p.name}  —  ${p.scene.effect}${p.morphTo ? ' (A→B)' : ''}  [${p.license}]`);
    process.exit(0);
}
const target = path.resolve(a._[0] || 'particle-fx');

if (fs.existsSync(path.join(target, 'index.html')) && !a.force) {
    console.log('目标已存在应用，只更新引擎 fx/（加 --force 覆盖 index.html/app.js）');
} else {
    fs.mkdirSync(target, { recursive: true });
    for (const f of ['index.html', 'app.js']) fs.copyFileSync(path.join(SKILL, 'assets/app', f), path.join(target, f));
}
fs.cpSync(path.join(SKILL, 'assets/fx'), path.join(target, 'fx'), { recursive: true });
fs.cpSync(path.join(SKILL, 'assets/presets'), path.join(target, 'presets'), { recursive: true }); // bundled public-domain / original sample images
fs.mkdirSync(path.join(target, 'media'), { recursive: true });

const copyImg = (src) => {
    const name = path.basename(src).replace(/[^\w.\-]+/g, '_');
    fs.copyFileSync(path.resolve(src), path.join(target, 'media', name));
    return 'media/' + name;
};
const scenePath = path.join(target, 'scene.json');
const presetScene = (id) => {
    const p = PRESETS.find(x => x.id === id);
    if (!p) { console.error('未知预设：' + id + '（node scaffold.mjs --list-presets 查看）'); process.exit(1); }
    return {
        ...p.scene, image: 'presets/' + p.image,
        ...(p.depthMap ? { depthMap: 'presets/' + p.depthMap } : {}),
        ...(p.morphTo ? { morphTo: 'presets/' + p.morphTo } : {}),
        ...(p.morphDepthMap ? { morphDepthMap: 'presets/' + p.morphDepthMap } : {}),
    };
};
let scene = a.preset ? presetScene(a.preset) : fs.existsSync(scenePath) ? JSON.parse(fs.readFileSync(scenePath, 'utf8')) : {
    effect: 'fluid-erosion',
    quality: 'high',
    depth: { mode: 'ai', strength: 0.9 },
    camera: { preset: 'drift' },
    look: {},
    timeline: {
        duration: 12, loop: true,
        keys: [{ t: 0, p: 0 }, { t: 1.5, p: 0 }, { t: 5.5, p: 1, ease: 'cubic' }, { t: 6.5, p: 1 }, { t: 10.5, p: 0, ease: 'cubic' }, { t: 12, p: 0 }],
    },
};
if (!scene.image && !a.image) scene = presetScene(PRESETS[0].id);
if (a.image) scene.image = copyImg(a.image);
if (a.morph) scene.morphTo = copyImg(a.morph);
if (a.effect) scene.effect = a.effect;
fs.writeFileSync(scenePath, JSON.stringify(scene, null, 2));
console.log('完成：', target);
console.log('预览：node', path.join(SKILL, 'scripts/serve.mjs'), target, '  然后打开打印出的地址');
