// Draw pass: each particle is an instanced quad stretched along its screen-space velocity
// (true per-particle motion blur), with depth-of-field spreading and energy conservation so
// streaks and defocused particles don't blow out.
import { COMMON } from './common.glsl.js';

export const DRAW_VERT = /* glsl */`
precision highp float;
${COMMON}
attribute vec2 aRef;
uniform sampler2D tPos;
uniform sampler2D tPrev;
uniform sampler2D tColor;    // rgb linear color, a size jitter
uniform sampler2D tColorB;   // morph target color
uniform sampler2D tAttr;
uniform sampler2D tBase;
uniform vec2 uRes;           // drawing buffer size in px
uniform float uSize;
uniform float uStreak;
uniform float uStreakMax;
uniform float uFocus;
uniform float uAperture;
uniform float uGrowth;
uniform float uOpacity;
uniform float uExposure;
uniform float uSaturation;
uniform vec3 uHeatColor;
uniform float uHeatIntensity;
uniform float uTint;
uniform float uFade;
uniform float uBgDim;
uniform float uDust;
uniform float uSparkle;
uniform float uMorph;
uniform float uTime;
varying vec2 vQ;
varying float vHalfSeg;
varying float vRad;
varying vec3 vCol;

void main() {
    vec4 P = texture2D(tPos, aRef);
    vec3 prev = texture2D(tPrev, aRef).xyz;
    vec4 C = texture2D(tColor, aRef);
    vec4 attr = texture2D(tAttr, aRef);
    float seed = texture2D(tBase, aRef).w;
    bool dust = P.w < -0.5;
    float t = max(P.w, 0.0);

    vec4 mv = modelViewMatrix * vec4(P.xyz, 1.0);
    vec4 c0 = projectionMatrix * mv;
    vec4 c1 = projectionMatrix * modelViewMatrix * vec4(prev, 1.0);
    float depth = -mv.z;
    if (depth < 0.02 || c1.w < 0.02) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); return; }

    vec2 s0 = c0.xy / c0.w * 0.5 * uRes;
    vec2 s1 = c1.xy / c1.w * 0.5 * uRes;
    vec2 v = (s0 - s1) * uStreak;
    float L = length(v);
    if (L > uStreakMax * uRes.y / 1000.0) { v *= uStreakMax * uRes.y / 1000.0 / L; L = length(v); }

    float heat = smoothstep(0.0, 0.04, t) * (1.0 - smoothstep(0.06, 0.4, t));
    float base = uSize * C.a * (uRes.y / 1000.0) / depth;
    base *= mix(1.0, uGrowth, smoothstep(0.0, 0.5, t));
    if (dust) base *= 0.9;
    float coc = abs(depth - uFocus) * uAperture * (uRes.y / 1000.0);
    float size = max(sqrt(base * base + coc * coc), 0.9);
    float energy = min(base * base / (size * size), 1.0) * size / (size + L);

    vec2 dir = L > 0.01 ? v / L : vec2(1.0, 0.0);
    vec2 nrm = vec2(-dir.y, dir.x);
    float rad = size * 0.5;
    float ext = rad * 1.7;
    float halfLen = L * 0.5 + ext;
    vec2 off = dir * position.x * halfLen + nrm * position.y * ext - v * 0.5;
    gl_Position = c0;
    gl_Position.xy += off * 2.0 / uRes * c0.w;
    vQ = vec2(position.x * halfLen, position.y * ext);
    vHalfSeg = L * 0.5;
    vRad = rad;

    vec3 col = C.rgb;
    if (uMorph > 0.5) col = mix(col, texture2D(tColorB, aRef).rgb, smoothstep(0.35, 0.95, t));
    float lum = dot(col, vec3(0.2126, 0.7152, 0.0722));
    col = mix(vec3(lum), col, uSaturation) * uExposure;
    // tint/heat scale with the particle's own brightness so black background never lights up as a colored card
    bool isBg = attr.b > 0.5 && attr.b < 1.5;
    col = mix(col, uHeatColor * lum * 1.6, uTint * smoothstep(0.05, 0.7, t));
    // near-black particles never glow (dark backgrounds are often mislabeled as subject by depth)
    col += uHeatColor * heat * uHeatIntensity * (isBg ? lum * 0.45 : 0.06 * smoothstep(0.015, 0.08, lum) + lum * 1.3);

    float alpha = uFade > 0.001 ? pow(max(1.0 - t, 1e-4), uFade) : 1.0;   // pow(0,0) is undefined in GLSL (NaN on Metal)
    if (attr.b > 0.5 && attr.b < 1.5) alpha *= uBgDim;
    if (dust) {
        alpha = uDust * (0.25 + 0.75 * hash11(seed * 51.0));
        col = mix(vec3(lum), col, 0.4) * 0.5 + uHeatColor * 0.04;
    }
    float tw = hash11(seed * 173.0 + floor(uTime * 9.0));
    col *= 1.0 + uSparkle * step(0.992, tw) * 5.0 * (heat + (dust ? 0.6 : 0.08));

    vCol = col * alpha * energy * uOpacity;
}
`;

export const DRAW_FRAG = /* glsl */`
precision highp float;
varying vec2 vQ;
varying float vHalfSeg;
varying float vRad;
varying vec3 vCol;
void main() {
    float dx = max(abs(vQ.x) - vHalfSeg, 0.0);
    float d = length(vec2(dx, vQ.y)) / vRad;
    float a = exp(-d * d * 2.4) * 0.8 + smoothstep(0.6, 0.0, d) * 0.4;
    if (a < 0.003) discard;
    gl_FragColor = vec4(vCol * a, a);
}
`;
