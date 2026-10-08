// Shared helpers for the Node scripts: static server, Chrome discovery, puppeteer-core loader.
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';

const MIME = {
    '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.mjs': 'text/javascript', '.json': 'application/json',
    '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.gif': 'image/gif',
    '.svg': 'image/svg+xml', '.avif': 'image/avif', '.css': 'text/css', '.wasm': 'application/wasm',
};

export function parseArgs(argv) {
    const out = { _: [] };
    for (let i = 0; i < argv.length; i++) {
        const a = argv[i];
        if (a.startsWith('--')) {
            const k = a.slice(2), n = argv[i + 1];
            if (n === undefined || n.startsWith('--')) out[k] = true; else { out[k] = n; i++; }
        } else out._.push(a);
    }
    return out;
}

/** Serve `root` on 127.0.0.1. Returns { port, url, close }. */
export async function serve(root, port = 0) {
    root = path.resolve(root);
    const server = http.createServer((req, res) => {
        let p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
        if (p.endsWith('/')) p += 'index.html';
        const file = path.join(root, p);
        if (!file.startsWith(root) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404); return res.end('not found'); }
        res.writeHead(200, { 'Content-Type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream', 'Cache-Control': 'no-store' });
        fs.createReadStream(file).pipe(res);
    });
    await new Promise((r, j) => server.listen(port, '127.0.0.1', r).on('error', j));
    const p = server.address().port;
    return { port: p, url: `http://127.0.0.1:${p}`, close: () => server.close() };
}

export function findChrome() {
    if (process.env.CHROME_PATH && fs.existsSync(process.env.CHROME_PATH)) return process.env.CHROME_PATH;
    const c = {
        darwin: ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/Applications/Chromium.app/Contents/MacOS/Chromium',
            '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge', '/Applications/Google Chrome Canary.app/Contents/MacOS/Google Chrome Canary'],
        win32: [`${process.env['PROGRAMFILES']}\\Google\\Chrome\\Application\\chrome.exe`, `${process.env['PROGRAMFILES(X86)']}\\Google\\Chrome\\Application\\chrome.exe`,
            `${process.env['LOCALAPPDATA']}\\Google\\Chrome\\Application\\chrome.exe`, `${process.env['PROGRAMFILES(X86)']}\\Microsoft\\Edge\\Application\\msedge.exe`],
        linux: ['/usr/bin/google-chrome', '/usr/bin/google-chrome-stable', '/usr/bin/chromium', '/usr/bin/chromium-browser', '/snap/bin/chromium'],
    }[process.platform] || [];
    const hit = c.find(p => p && fs.existsSync(p));
    if (!hit) throw new Error('找不到 Chrome/Chromium/Edge。请安装 Chrome，或设置环境变量 CHROME_PATH 指向浏览器可执行文件。');
    return hit;
}

export const CACHE_DIR = path.join(os.homedir(), '.cache', 'image-particle-fx');

/** Load puppeteer-core from the project, or install it once into ~/.cache/image-particle-fx. */
export async function loadPuppeteer() {
    try { return (await import('puppeteer-core')).default; } catch (e) { /* not installed in project */ }
    const pkg = path.join(CACHE_DIR, 'package.json');
    if (!fs.existsSync(path.join(CACHE_DIR, 'node_modules', 'puppeteer-core'))) {
        fs.mkdirSync(CACHE_DIR, { recursive: true });
        if (!fs.existsSync(pkg)) fs.writeFileSync(pkg, '{"name":"image-particle-fx-cache","private":true}');
        console.log('首次运行：安装 puppeteer-core 到', CACHE_DIR);
        execFileSync(process.platform === 'win32' ? 'npm.cmd' : 'npm', ['i', 'puppeteer-core@23', '--no-audit', '--no-fund'], { cwd: CACHE_DIR, stdio: 'inherit' });
    }
    return createRequire(pkg)('puppeteer-core');
}

export function hasFfmpeg() {
    try { execFileSync('ffmpeg', ['-version'], { stdio: 'ignore' }); return true; } catch { return false; }
}

/** Launch headless Chrome with a real GPU and open the app in export mode. */
export async function openApp({ dir, scene = 'scene.json', width = 1920, height = 1080, quiet = false }) {
    const puppeteer = await loadPuppeteer();
    const srv = await serve(dir);
    const browser = await puppeteer.launch({
        executablePath: findChrome(),
        headless: 'new',
        userDataDir: path.join(CACHE_DIR, 'chrome-profile'), // keeps the depth model in the HTTP cache between runs
        args: ['--enable-gpu', '--ignore-gpu-blocklist', '--enable-unsafe-webgpu', ...(process.platform === 'darwin' ? ['--use-angle=metal'] : []),
            `--window-size=${width},${height}`, '--hide-scrollbars', '--mute-audio'],
        defaultViewport: { width, height, deviceScaleFactor: 1 },
        protocolTimeout: 0,
    });
    const page = await browser.newPage();
    const errors = [];
    page.on('console', m => { const t = m.text(); if (m.type() === 'error' && !/favicon|status of 404|onnxruntime/.test(t)) errors.push(t); if (!quiet && !/favicon|404/.test(t)) console.log('[page]', t); });
    page.on('pageerror', e => { errors.push(e.message); console.log('[pageerror]', e.message); });
    await page.goto(`${srv.url}/index.html?export=1&w=${width}&h=${height}&scene=${encodeURIComponent(scene)}`);
    await page.waitForFunction('window.FX && window.FX.ready', { timeout: 120000, polling: 250 });
    const info = await page.evaluate(async () => {
        try { await window.FX.ready; return window.FX.info(); } catch (e) { return { error: String(e && e.stack || e) }; }
    });
    if (info.error) { await browser.close(); srv.close(); throw new Error('场景加载失败：' + info.error); }
    return {
        page, info, errors,
        close: async () => { await browser.close(); srv.close(); },
    };
}
