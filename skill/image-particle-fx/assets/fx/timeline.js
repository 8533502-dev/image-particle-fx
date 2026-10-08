// Deterministic timeline + camera rigs. Everything is a pure function of time so live playback
// and offline frame-by-frame export produce identical images.

export const EASING = {
    linear: t => t,
    sine: t => -(Math.cos(Math.PI * t) - 1) / 2,
    cubic: t => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2),
    cubicIn: t => t * t * t,
    cubicOut: t => 1 - Math.pow(1 - t, 3),
    expoIn: t => (t === 0 ? 0 : Math.pow(2, 10 * t - 10)),
    expoOut: t => (t === 1 ? 1 : 1 - Math.pow(2, -10 * t)),
    expo: t => (t === 0 ? 0 : t === 1 ? 1 : t < 0.5 ? Math.pow(2, 20 * t - 10) / 2 : (2 - Math.pow(2, -20 * t + 10)) / 2),
    hold: t => (t < 1 ? 0 : 1),
};

/**
 * Progress keyframes: [{ t: seconds, p: 0..1 (0 = formed, 1 = dissolved), ease: 'cubic' }].
 * `ease` on a key shapes the segment that ENDS at that key.
 */
export function progressAt(keys, time) {
    if (!keys || !keys.length) return 0;
    if (time <= keys[0].t) return keys[0].p;
    for (let i = 1; i < keys.length; i++) {
        const a = keys[i - 1], b = keys[i];
        if (time <= b.t) {
            const u = (time - a.t) / Math.max(b.t - a.t, 1e-6);
            return a.p + (b.p - a.p) * (EASING[b.ease] || EASING.cubic)(u);
        }
    }
    return keys[keys.length - 1].p;
}

export function timelineTime(timeline, t) {
    if (!timeline) return t;
    return timeline.loop ? t % timeline.duration : Math.min(t, timeline.duration);
}

// A default narrative: hold → dissolve → drift → reform → hold.
export function defaultTimeline(duration = 12) {
    const d = duration;
    return {
        duration: d, loop: true,
        keys: [
            { t: 0, p: 0 }, { t: d * 0.12, p: 0 },
            { t: d * 0.45, p: 1, ease: 'cubic' },
            { t: d * 0.55, p: 1 },
            { t: d * 0.9, p: 0, ease: 'cubic' }, { t: d, p: 0 },
        ],
    };
}

const smooth = t => t * t * (3 - 2 * t);

/**
 * Camera rigs. Returns { pos:[x,y,z], target:[x,y,z], fov }.
 * opts: { preset, distance, fov, speed, target, height, amount }
 */
export function cameraAt(opts, time, duration = 12) {
    const o = { preset: 'drift', distance: 2.7, fov: 35, speed: 1, target: [0, 0, 0], height: 0, amount: 1, ...opts };
    const [tx, ty, tz] = o.target;
    const t = time * o.speed;
    const D = o.distance, A = o.amount;
    let az = 0, el = o.height, dist = D, fov = o.fov;
    switch (o.preset) {
        case 'static': break;
        case 'orbit': az = t * 0.25 * A; el += 0.12; break;
        case 'half-orbit': az = Math.sin(t * 0.18) * 0.7 * A; el += 0.08 + Math.sin(t * 0.11) * 0.06; break;
        case 'push': dist = D * (1.12 - 0.3 * A * smooth(Math.min(time / duration, 1))); az = Math.sin(t * 0.15) * 0.12; break;
        case 'pull': dist = D * (0.85 + 0.35 * A * smooth(Math.min(time / duration, 1))); az = Math.sin(t * 0.15) * 0.12; break;
        case 'crane': el += (-0.25 + 0.55 * smooth(Math.min(time / duration, 1))) * A; az = Math.sin(t * 0.12) * 0.2; break;
        case 'dolly-zoom': {
            const k = 0.5 - 0.5 * Math.cos(t * 0.35);
            fov = o.fov + 25 * k * A;
            dist = D * Math.tan((o.fov * Math.PI) / 360) / Math.tan((fov * Math.PI) / 360);
            break;
        }
        case 'handheld':
            az = Math.sin(t * 0.7) * 0.04 + Math.sin(t * 1.9) * 0.015;
            el += Math.sin(t * 0.9 + 1) * 0.03 + Math.sin(t * 2.3) * 0.01;
            dist = D * (1 + Math.sin(t * 0.5) * 0.02);
            break;
        case 'drift':
        default:
            az = Math.sin(t * 0.21) * 0.22 * A;
            el += Math.sin(t * 0.17 + 1.3) * 0.08 * A;
            dist = D * (1 + Math.sin(t * 0.13) * 0.04 * A);
    }
    const ce = Math.cos(el);
    return {
        pos: [tx + dist * ce * Math.sin(az), ty + dist * Math.sin(el), tz + dist * ce * Math.cos(az)],
        target: [tx, ty, tz],
        fov,
    };
}
