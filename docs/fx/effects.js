// Effect presets. Each preset = who leaves first (order) + how they move (motion) + how they look (look).
// Every field can be overridden per scene via scene.params. See references/effects.md for the art notes.

export const ORDER_TYPES = { sweep: 0, radial: 1, noise: 2, depth: 3, luminance: 4, random: 5, edge: 6 };
export const MOTION_MODES = { flow: 0, shatter: 1, singularity: 2, galaxy: 3, datarain: 4, ripple: 5, morph: 6, ferro: 7 };
export const EASES = { linear: 0, inOutCubic: 1, inQuad: 2, inCubic: 3, outExpo: 4, inOutSine: 5 };

export const DEFAULTS = {
    order: { type: 'noise', dir: [0, -1, 0], center: [0, 0, 0], noise: 0.3, scale: 1.6, invert: false },
    softness: 0.45,
    ease: 'inQuad',
    motion: {
        mode: 'flow', travel: 1.5, steps: 10, curl: 0.8, curlScale: 1.3, curlSpeed: 0.15, turbGrow: 0.6,
        wind: [0, 0, 0], gravity: [0, 0, 0], radial: 0, vortex: 0, axis: [0, 1, 0], center: [0, 0, 0],
        scatter: 0.05, flutter: 0, cellScale: 9, spin: 6, swirl: 3, flatten: 0.8, expand: 0.3,
        cols: 140, quant: 18, glitch: 0.12, freq: 18, amp: 0.12, arc: 0.6, planar: 0.6, debias: 1,
    },
    look: {
        heat: 'accent', heatIntensity: 1.2, tint: 0.3, fade: 1.4, growth: 1.1, streak: 0.55, streakMax: 32,
        sparkle: 0.3, saturation: 1.05, brightness: 1, size: 5.5, aperture: 0, bgDim: 0.55, dust: 0.35, trail: 0, idle: 1,
    },
};

export const EFFECTS = {
    'fluid-erosion': {
        name: '流体侵蚀', en: 'Fluid Erosion',
        desc: '噪波边缘蚕食画面，粒子沿弯曲的流线被卷走，像被看不见的水流冲刷。万能首选。',
        bestFor: '人像、雕塑、静物、任何不确定时的默认选择',
        order: { type: 'noise', scale: 1.6, noise: 0 }, softness: 0.45, ease: 'inQuad',
        motion: { mode: 'flow', travel: 1.3, steps: 12, curl: 1.0, curlScale: 1.4, turbGrow: 0.8, radial: 0.35, scatter: 0.1, planar: 0.7 },
        look: { heat: 'accent', heatIntensity: 1.6, tint: 0.25, fade: 1.4, growth: 1.1, streak: 0.6, sparkle: 0.3 },
    },
    'ember-ascend': {
        name: '余烬升腾', en: 'Ember Ascend',
        desc: '从顶部开始燃尽，炽热的余烬向上翻卷飘散，边缘闪烁火星。',
        bestFor: '火焰、夜景、篝火、情绪浓烈的人像、纪念/告别主题',
        order: { type: 'sweep', dir: [0, -1, 0], noise: 0.35, scale: 2.2 }, softness: 0.4, ease: 'inQuad',
        motion: { mode: 'flow', wind: [0, 1.1, 0], curl: 0.7, curlScale: 1.8, curlSpeed: 0.3, turbGrow: 1.2, flutter: 0.15, travel: 1.4, scatter: 0.08 },
        look: { heat: '#ff6a1f', heatIntensity: 2.4, tint: 0.6, fade: 1.8, growth: 1.15, streak: 0.55, sparkle: 0.9 },
    },
    'sand-drift': {
        name: '风蚀流沙', en: 'Sand Drift',
        desc: '迎风面先被侵蚀成细沙，被横风吹成长长的沙流，带一点下坠。',
        bestFor: '雕塑、建筑、沙漠、复古质感、"时间流逝"叙事',
        order: { type: 'sweep', dir: [1, 0, 0], noise: 0.45, scale: 3.0 }, softness: 0.35, ease: 'inQuad',
        motion: { mode: 'flow', wind: [1.6, 0.12, 0], gravity: [0, -0.25, 0], curl: 0.45, curlScale: 2.6, curlSpeed: 0.2, turbGrow: 1.5, travel: 1.8, scatter: 0.12 },
        look: { heat: '#e8c48a', heatIntensity: 0.6, tint: 0.55, fade: 1.2, growth: 0.9, streak: 0.8, sparkle: 0.2, saturation: 0.85 },
    },
    'singularity': {
        name: '奇点吞噬', en: 'Singularity',
        desc: '外围先被引力捕获，螺旋压扁成吸积盘，最后坠入中心奇点。',
        bestFor: '宇宙/科幻、Logo 收尾、转场"吸走"画面',
        order: { type: 'radial', center: [0, 0, 0], invert: true, noise: 0.25, scale: 2.0 }, softness: 0.5, ease: 'inCubic',
        motion: { mode: 'singularity', swirl: 3.2, flatten: 0.85, axis: [0.15, 1, 0.25], curl: 0.4 },
        look: { heat: '#7fb4ff', heatIntensity: 2.2, tint: 0.5, fade: 2.5, growth: 0.85, streak: 0.7, sparkle: 0.4 },
    },
    'supernova': {
        name: '超新星', en: 'Supernova',
        desc: '中心先爆开，冲击波向外推，粒子带着炽白高光高速飞散。',
        bestFor: '产品发布、高潮瞬间、音乐节拍点、能量感强的画面',
        order: { type: 'radial', center: [0, 0, 0], noise: 0.3, scale: 2.0 }, softness: 0.28, ease: 'outExpo',
        motion: { mode: 'flow', radial: 1.2, curl: 0.45, turbGrow: 0.6, travel: 0.5, steps: 8, scatter: 0.15, planar: 0.85 },
        look: { heat: '#ffd0a0', heatIntensity: 3.0, tint: 0.3, fade: 2.2, growth: 1.1, streak: 0.6, sparkle: 0.8 },
    },
    'galaxy': {
        name: '星系旋臂', en: 'Galaxy',
        desc: '画面被差速旋转卷成一个倾斜的螺旋星系（终态不消失，可作为第二幕）。',
        bestFor: '星空、梦境、抽象艺术、"万物归一"叙事',
        order: { type: 'radial', noise: 0.3, scale: 1.5 }, softness: 0.7, ease: 'inOutCubic',
        motion: { mode: 'galaxy', axis: [0, 0.8, 0.6], swirl: 4.0, flatten: 0.9, expand: 0.35, freq: 1.5, curl: 0.3 },
        look: { heat: 'accent', heatIntensity: 0.9, tint: 0.35, fade: 0, growth: 1.0, streak: 0.5, sparkle: 0.6 },
    },
    'shatter': {
        name: '晶格碎裂', en: 'Shatter',
        desc: '从冲击点碎成一块块刚性晶片，翻滚着飞出并下坠，边缘闪光。',
        bestFor: '玻璃、冰、产品、运动、"打破"叙事',
        order: { type: 'radial', center: [0.2, 0.1, 0.3], noise: 0.15, scale: 2.0 }, softness: 0.3, ease: 'inCubic',
        motion: { mode: 'shatter', cellScale: 9, spin: 6, travel: 1.4, gravity: [0, -1.2, 0], center: [0, 0, 0.4], wind: [0, 0, 0.6], curl: 0.3 },
        look: { heat: '#cfe8ff', heatIntensity: 1.6, tint: 0.15, fade: 1.0, growth: 1.0, streak: 0.6, sparkle: 1.2 },
    },
    'data-rain': {
        name: '数据流瀑', en: 'Data Rain',
        desc: '画面按列解码成数据流，阶梯式坠落并带横向故障错位。',
        bestFor: '城市夜景、科技/赛博、UI 截图、人像数字化',
        order: { type: 'sweep', dir: [0, -1, 0], noise: 0.6, scale: 4.0 }, softness: 0.35, ease: 'inQuad',
        motion: { mode: 'datarain', cols: 140, quant: 18, glitch: 0.12, travel: 2.2 },
        look: { heat: '#39ffb0', heatIntensity: 1.6, tint: 0.7, fade: 1.2, growth: 0.9, streak: 1.0, sparkle: 0.7, saturation: 0.6 },
    },
    'ferro': {
        name: '磁流体', en: 'Ferrofluid',
        desc: '表面长出金属质感的尖刺，在磁场里起伏，再被拉散。',
        bestFor: '黑色/金属物体、音乐可视化、暗黑高级感',
        order: { type: 'noise', scale: 2.5, noise: 0 }, softness: 0.6, ease: 'inOutCubic',
        motion: { mode: 'ferro', freq: 3.2, amp: 0.45, travel: 0.6, curl: 0.3 },
        look: { heat: '#9fb8ff', heatIntensity: 1.2, tint: 0.4, fade: 0.8, growth: 0.9, streak: 0.4, sparkle: 1.0, saturation: 0.5 },
    },
    'silk': {
        name: '丝绸流线', en: 'Silk Streams',
        desc: '粒子被拉成长长的丝带，沿大尺度流场缓慢优雅地飘走，带柔和拖尾。',
        bestFor: '时尚、人像、舞蹈、水、柔美主题',
        order: { type: 'sweep', dir: [1, -0.3, 0], noise: 0.3, scale: 1.5 }, softness: 0.55, ease: 'inOutSine',
        motion: { mode: 'flow', curl: 1.0, curlScale: 0.6, curlSpeed: 0.08, steps: 16, travel: 1.3, turbGrow: 0.3, vortex: 0.35, axis: [0, 1, 0], debias: 0.6 },
        look: { heat: 'accent', heatIntensity: 1.0, tint: 0.3, fade: 1.0, growth: 1.0, streak: 0.7, sparkle: 0.2, trail: 0.6 },
    },
    'ripple': {
        name: '共振涟漪', en: 'Resonance',
        desc: '从中心荡开一圈圈立体波纹，波峰隆起，化作浪花被湍流卷走。',
        bestFor: '水面、声音/音乐、冥想、科技感 Logo',
        order: { type: 'radial', noise: 0.1, scale: 2.0 }, softness: 0.5, ease: 'inOutCubic',
        motion: { mode: 'ripple', freq: 18, amp: 0.12, travel: 0.9, curl: 0.8, curlScale: 2.0 },
        look: { heat: 'accent', heatIntensity: 1.4, tint: 0.2, fade: 1.6, growth: 1.0, streak: 0.5, sparkle: 0.6 },
    },
    'petal-wind': {
        name: '花瓣风', en: 'Petal Wind',
        desc: '像一阵风吹散花瓣，粒子打着旋、上下翻飞，颜色保持鲜艳。',
        bestFor: '花、植物、春天、婚礼、少女感/治愈系画面',
        order: { type: 'sweep', dir: [1, 0, 0], noise: 0.5, scale: 2.0 }, softness: 0.45, ease: 'inQuad',
        motion: { mode: 'flow', wind: [1.2, 0.35, 0.3], gravity: [0, -0.2, 0], curl: 0.55, curlScale: 1.5, flutter: 0.9, turbGrow: 0.5, travel: 2.0 },
        look: { heat: 'accent', heatIntensity: 0.8, tint: 0.1, fade: 1.2, growth: 1.1, streak: 0.5, sparkle: 0.3, saturation: 1.15 },
    },
    'ink-diffuse': {
        name: '水墨晕散', en: 'Ink Diffuse',
        desc: '暗部先化开，像墨滴入水一样缓慢膨胀、柔化、褪色。',
        bestFor: '中国风、山水、书法、黑白摄影、安静的叙事',
        order: { type: 'luminance', noise: 0.4, scale: 1.5 }, softness: 0.6, ease: 'inOutSine',
        motion: { mode: 'flow', curl: 0.8, curlScale: 0.9, curlSpeed: 0.05, radial: 0.25, turbGrow: 0.2, travel: 1.2, steps: 12, scatter: 0.02 },
        look: { heat: '#7d8796', heatIntensity: 0.15, tint: 0.45, fade: 1.7, growth: 1.7, streak: 0.25, sparkle: 0, saturation: 0.25 },
    },
    'morph': {
        name: '重组变形', en: 'Morph A→B',
        desc: '图 A 散成流动的粒子，沿弧线飞行，重组为图 B（需要第二张图）。',
        bestFor: '前后对比、产品迭代、logo 揭示、故事转场',
        order: { type: 'noise', scale: 1.4, noise: 0 }, softness: 0.6, ease: 'inOutCubic',
        motion: { mode: 'morph', arc: 0.6, curlScale: 1.2, scatter: 0.1 },
        look: { heat: 'accent', heatIntensity: 1.2, tint: 0, fade: 0, growth: 1.0, streak: 0.6, sparkle: 0.4 },
    },
};

const isObj = v => v && typeof v === 'object' && !Array.isArray(v);
export function deepMerge(a, b) {
    const out = { ...a };
    for (const k in b || {}) out[k] = isObj(a?.[k]) && isObj(b[k]) ? deepMerge(a[k], b[k]) : b[k];
    return out;
}

/** Resolve a preset name + overrides into a full parameter set. */
export function resolveEffect(name, overrides = {}) {
    const preset = EFFECTS[name] || EFFECTS['fluid-erosion'];
    return deepMerge(deepMerge(DEFAULTS, preset), overrides);
}
