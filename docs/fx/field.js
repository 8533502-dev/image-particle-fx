// Divergence-free flow field built from random Fourier modes.
// psi(x) = sum a_i * sin(k_i . x + phi_i + w_i t)  ->  curl(psi) = sum (k_i x a_i) * cos(...)
// Periodic, smooth, analytically divergence-free, and cheap to evaluate on the GPU (no textures).

export const FIELD_MODES = 12;

// Small deterministic PRNG so the same seed always gives the same field (needed for offline export).
export function mulberry32(seed) {
    let a = seed >>> 0;
    return () => {
        a = (a + 0x6D2B79F5) >>> 0;
        let t = a;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

function randUnit(rnd) {
    const z = rnd() * 2 - 1, a = rnd() * Math.PI * 2, r = Math.sqrt(1 - z * z);
    return [r * Math.cos(a), r * Math.sin(a), z];
}

const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];

/**
 * Returns uniform arrays { K: Float32Array(3n), C: Float32Array(3n), P: Float32Array(n), W: Float32Array(n) }.
 * Octaves are spread so the field has both large sweeping currents and smaller eddies.
 */
export function buildField(seed = 7) {
    const rnd = mulberry32(seed);
    const n = FIELD_MODES;
    const K = new Float32Array(n * 3), C = new Float32Array(n * 3), P = new Float32Array(n), W = new Float32Array(n);
    let norm = 0;
    for (let i = 0; i < n; i++) {
        const octave = i % 3;                       // 3 octaves: 2, 3.7, 6.5 (periods shorter than the image, so no net drift)
        const freq = [2.0, 3.7, 6.5][octave] * (0.85 + rnd() * 0.3);
        // keep wave vectors mostly in the image plane: a k along z is constant across the (z≈0) picture
        // and would act as a uniform current dragging everything one way
        let dir = randUnit(rnd);
        dir[2] *= 0.35;
        const dl = Math.hypot(...dir);
        const k = dir.map(v => (v / dl) * freq);
        const a = randUnit(rnd).map(v => v / Math.pow(freq, 0.55)); // gentle falloff: big currents AND visible eddies
        const c = cross(k, a);
        K.set(k, i * 3); C.set(c, i * 3);
        P[i] = rnd() * Math.PI * 2;
        W[i] = (rnd() * 2 - 1) * (0.6 + octave * 0.4);
        norm += c[0] * c[0] + c[1] * c[1] + c[2] * c[2];
    }
    // RMS of a sum of independent cosines = sqrt(sum |c|^2 / 2); normalize to ~1.
    const s = 1 / Math.sqrt(norm / 2);
    for (let i = 0; i < C.length; i++) C[i] *= s;
    return { K, C, P, W };
}
