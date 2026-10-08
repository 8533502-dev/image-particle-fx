// Post-processing shaders: motion trails (feedback) and the final film grade.
export const TRAIL_FRAG = /* glsl */`
uniform sampler2D tCur;
uniform sampler2D tOld;
uniform float uDecay;
varying vec2 vUv;
void main() {
    vec4 c = texture2D(tCur, vUv);
    vec4 o = texture2D(tOld, vUv) * uDecay;
    gl_FragColor = max(c, o);
}
`;

export const GRADE_FRAG = /* glsl */`
uniform sampler2D tDiffuse;
uniform vec2 uRes;
uniform float uVignette;
uniform float uGrain;
uniform float uAberration;
uniform float uTime;
uniform vec3 uGlow;
uniform float uGlowAmt;
varying vec2 vUv;
float h(vec2 p) { vec3 p3 = fract(vec3(p.xyx) * 0.1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
void main() {
    vec2 c = vUv - 0.5;
    float r2 = dot(c, c);
    vec2 off = c * uAberration * (0.5 + r2 * 2.0);
    vec3 col;
    col.r = texture2D(tDiffuse, vUv + off).r;
    col.g = texture2D(tDiffuse, vUv).g;
    col.b = texture2D(tDiffuse, vUv - off).b;
    col += uGlow * uGlowAmt * exp(-r2 * 5.0);
    col *= mix(1.0, smoothstep(0.95, 0.15, sqrt(r2) * 1.25), uVignette);
    float g = h(vUv * uRes + fract(uTime * 7.13) * 911.0) - 0.5;
    col += g * uGrain * (0.35 + 0.65 * (1.0 - dot(col, vec3(0.333))));
    gl_FragColor = vec4(max(col, 0.0), 1.0);
}
`;

export const QUAD_VERT = /* glsl */`
varying vec2 vUv;
void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }
`;
