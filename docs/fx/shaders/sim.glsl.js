// Simulation pass: one texel per particle. Position is a pure function of (rest position, progress, time),
// so the effect can be scrubbed backwards/forwards and rendered frame-exactly offline.
import { COMMON } from './common.glsl.js';

export const SIM_VERT = /* glsl */`
varying vec2 vUv;
void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }
`;

export const SIM_FRAG = /* glsl */`
precision highp float;
${COMMON}
varying vec2 vUv;
uniform sampler2D tBase;    // xyz rest position, w seed
uniform sampler2D tAttr;    // r luminance, g edge, b layer (0 subject, 1 background, 2 dust), a depth01 (1 = near)
uniform sampler2D tTarget;  // morph target xyz
uniform float uP;           // 0 = formed, 1 = fully dissolved
uniform float uTime;
uniform float uRadius;      // bounding radius of the cloud

// order (who leaves first)
uniform int uOrderType;     // 0 sweep, 1 radial, 2 noise, 3 depth, 4 luminance, 5 random, 6 edge
uniform vec3 uOrderDir;
uniform vec3 uOrderCenter;
uniform float uOrderNoise;
uniform float uOrderScale;
uniform float uOrderInvert;
uniform float uSoftness;    // fraction of the timeline each particle spends travelling
uniform int uEase;          // 0 linear, 1 inOutCubic, 2 inQuad, 3 inCubic, 4 outExpo, 5 inOutSine

// motion
uniform int uMode;          // 0 flow, 1 shatter, 2 singularity, 3 galaxy, 4 data rain, 5 ripple, 6 morph, 7 ferro
uniform float uTravel;
uniform int uSteps;
uniform float uCurl;
uniform float uCurlScale;
uniform float uCurlSpeed;
uniform float uTurbGrow;
uniform vec3 uWind;
uniform vec3 uGravity;
uniform float uRadial;
uniform float uVortex;
uniform vec3 uAxis;
uniform vec3 uCenter;
uniform float uScatter;
uniform float uFlutter;
uniform float uCellScale;
uniform float uSpin;
uniform float uSwirl;
uniform float uFlatten;
uniform float uExpand;
uniform float uCols;
uniform float uQuant;
uniform float uGlitch;
uniform float uFreq;
uniform float uAmp;
uniform float uArc;
uniform float uIdle;
uniform float uPlanar;
uniform vec3 uBias;         // mean flow over the image (CPU-computed) — subtracted so the cloud doesn't drift as a whole      // 0..1: damp motion along the view axis so flows stay readable on screen

vec3 planarV(vec3 v) { v.z *= 1.0 - uPlanar; return v; }

float ease(float t) {
    if (uEase == 1) return t < 0.5 ? 4.0 * t * t * t : 1.0 - pow(-2.0 * t + 2.0, 3.0) * 0.5;
    if (uEase == 2) return t * t;
    if (uEase == 3) return t * t * t;
    if (uEase == 4) return t >= 1.0 ? 1.0 : 1.0 - pow(2.0, -10.0 * t);
    if (uEase == 5) return -(cos(3.14159265 * t) - 1.0) * 0.5;
    return t;
}

float orderValue(vec3 p, vec4 attr, float seed) {
    float d;
    if (uOrderType == 0) d = dot(p, normalize(uOrderDir)) / uRadius * 0.5 + 0.5;
    else if (uOrderType == 1) d = length(p - uOrderCenter) / (uRadius * 1.15);
    else if (uOrderType == 2) d = fbm(p * uOrderScale) / 1.2 + 0.5;
    else if (uOrderType == 3) d = 1.0 - attr.a;
    else if (uOrderType == 4) d = attr.r;
    else if (uOrderType == 5) d = seed;
    else d = 1.0 - attr.g;
    float n = fbm(p * uOrderScale + 17.3) / 1.2 + 0.5;
    d = mix(d, n, uOrderNoise);
    d = mix(d, 1.0 - d, uOrderInvert);
    return clamp(d, 0.0, 1.0);
}

vec3 flowAt(vec3 p, float k, float seed, vec3 rnd) {
    vec3 f = uWind + uGravity * k;
    f += uCurl * (curlField(p * uCurlScale, uTime * uCurlSpeed) - uBias) * (1.0 + uTurbGrow * k);
    vec3 d = p - uCenter;
    float r = length(d) + 1e-3;
    f += uRadial * d / r;
    f += uVortex * cross(normalize(uAxis), d) / (r + 0.15);
    f += uScatter * (rnd - 0.5) * 2.0;
    f += uFlutter * vec3(sin(seed * 61.0 + k * 9.3), 0.5 * cos(seed * 37.0 + k * 7.1), sin(seed * 17.0 + k * 8.7));
    f.z *= 1.0 - uPlanar;
    return f;
}

void main() {
    vec4 base = texture2D(tBase, vUv);
    vec4 attr = texture2D(tAttr, vUv);
    vec3 rest = base.xyz;
    float seed = base.w;
    vec3 rnd = hash33(vec3(seed * 91.7, seed * 13.3, seed * 57.1));

    // ambient dust: never dissolves, drifts slowly
    if (attr.b > 1.5) {
        vec3 p = rest + curlField(rest * 0.6, uTime * 0.05) * 0.08;
        p.y += sin(uTime * 0.13 + seed * 6.28) * 0.03;
        gl_FragColor = vec4(p, -1.0);
        return;
    }

    vec3 cell = (floor(rest * uCellScale) + 0.5) / uCellScale;
    float d = orderValue(uMode == 1 ? cell : rest, attr, uMode == 1 ? hash13(cell * 7.7) : seed);
    float w = clamp(uSoftness, 0.02, 1.0);
    float start = d * (1.0 - w);
    float t = clamp((uP - start) / w, 0.0, 1.0);
    float e = ease(t);
    float travel = uTravel * mix(0.7, 1.3, rnd.x);
    vec3 p = rest;

    if (uMode == 0) {
        // advect along the flow: curved, coherent streams instead of straight lines
        float h = e * travel / float(uSteps);
        for (int i = 0; i < 16; i++) {
            if (i >= uSteps) break;
            float k = float(i) / float(uSteps);
            p += flowAt(p, k, seed, rnd) * h;
        }
    } else if (uMode == 1) {
        // shatter: rigid shards fly and tumble
        vec3 cr = hash33(cell * 13.1 + 0.7);
        vec3 dir = normalize(cell - uCenter + (cr - 0.5) * 0.8 + 1e-4);
        vec3 v = dir * travel * (0.5 + cr.x) + uWind;
        vec3 ax = normalize(cr * 2.0 - 1.0 + 1e-4);
        p = cell + rotAxis(ax, e * uSpin * (cr.y * 2.0 - 1.0)) * (rest - cell) + v * e + 0.5 * uGravity * e * e;
        p += planarV(uCurl * curlField(cell * uCurlScale, uTime * uCurlSpeed)) * e * e * 0.3;
    } else if (uMode == 2) {
        // singularity: spiral into a point, flattening into an accretion disk on the way
        vec3 ax = normalize(uAxis);
        vec3 dd = rest - uCenter;
        float r0 = length(dd) + 1e-4;
        float r = r0 * pow(1.0 - e, 1.3);
        vec3 da = dot(dd, ax) * ax;
        vec3 dp = dd - da + da * (1.0 - uFlatten * e);
        dp = rotAxis(ax, e * uSwirl / (r + 0.12)) * dp;
        p = uCenter + dp * (r / r0);
        p += planarV(uCurl * curlField(rest * uCurlScale, uTime * uCurlSpeed)) * e * (1.0 - e) * 0.25;
    } else if (uMode == 3) {
        // galaxy: differential rotation into a flattened spiral disk
        vec3 ax = normalize(uAxis);
        vec3 dd = rest - uCenter;
        vec3 da = dot(dd, ax) * ax;
        vec3 dp = dd - da;
        float r = length(dp) + 1e-3;
        float ang = e * uSwirl / (sqrt(r) + 0.25) + e * uFreq * log(r + 0.05);
        vec3 q = rotAxis(ax, ang) * (dp * (1.0 + uExpand * e)) + da * (1.0 - uFlatten * e);
        q += ax * (rnd.z - 0.5) * 0.04 * e;
        p = uCenter + q + planarV(uCurl * curlField(rest * uCurlScale, uTime * uCurlSpeed)) * e * 0.08;
    } else if (uMode == 4) {
        // data rain: columns fall in quantized steps with horizontal glitch slips
        float col = floor((rest.x / uRadius * 0.5 + 0.5) * uCols);
        float rc = hash11(col * 1.73 + 3.1);
        float fall = e * travel * (0.35 + 1.3 * rc);
        fall = mix(fall, floor(fall * uQuant) / uQuant, 0.8);
        p = rest - vec3(0.0, fall, 0.0);
        p.x += (hash11(col + floor(uTime * 12.0) * 7.0) - 0.5) * uGlitch * e;
        p.z += e * 0.25 * (rc - 0.5);
    } else if (uMode == 5) {
        // resonance ripple: standing wave rings + outward drift
        vec3 dd = rest - uCenter;
        float r = length(dd.xy) + 1e-3;
        float wave = sin(r * uFreq - uTime * 3.0 - e * 6.0);
        p.z += uAmp * wave * sin(3.14159 * min(e * 1.5, 1.0));
        // a little outward push, mostly spray lifted off the wave by turbulence (a big radial push just reads as a zoom)
        p.xy += dd.xy / r * e * e * travel * 0.25;
        p += planarV(uCurl * curlField(rest * uCurlScale, uTime * uCurlSpeed) + vec3(0.0, 0.6, 0.0)) * e * e * travel;
    } else if (uMode == 6) {
        // morph: arc from image A to image B through the flow field
        vec3 q = texture2D(tTarget, vUv).xyz;
        vec3 mid = (rest + q) * 0.5;
        mid += curlField(mid * uCurlScale, uTime * uCurlSpeed) * uArc + (rnd - 0.5) * uScatter;
        float u = e;
        p = (1.0 - u) * (1.0 - u) * rest + 2.0 * (1.0 - u) * u * mid + u * u * q;
    } else if (uMode == 7) {
        // ferrofluid: noise-driven spikes grow out of the surface
        vec3 n = normalize(rest - uCenter + vec3(0.0, 0.0, 0.6));
        float s = max(snoise(rest * uFreq + vec3(0.0, 0.0, uTime * 0.15)), 0.0);
        s = pow(s, 2.5) * (0.6 + 0.8 * rnd.y);
        p = rest + n * s * uAmp * e + n * e * e * travel * 0.3;
        p += planarV(uCurl * curlField(rest * uCurlScale, uTime * uCurlSpeed)) * e * e * 0.3;
    }

    // subtle breathing so a formed image never looks frozen
    float idle = uIdle * (1.0 - t) * 0.006;
    p += curlField(rest * 1.7, uTime * 0.25) * idle;

    gl_FragColor = vec4(p, t);
}
`;
