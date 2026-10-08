#!/usr/bin/env node
// Zero-dependency static server for the app (ES modules + fetch need http://, not file://).
// node serve.mjs [dir] [--port 5173]
import path from 'node:path';
import { parseArgs, serve } from './lib.mjs';

const a = parseArgs(process.argv.slice(2));
const dir = path.resolve(a._[0] || '.');
const s = await serve(dir, +(a.port || 5173)).catch(async () => serve(dir, 0));
console.log(`Particle FX: ${s.url}/index.html   (Ctrl+C 停止)`);
