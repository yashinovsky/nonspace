precision highp float;

// Two hatching sets at slightly different angles → moiré as shells counter-rotate.
// Additive, no hidden-line removal (plan §5.4). Lissajous is drawn as beams.

uniform float logDepthBufFC;
uniform vec3 uColor;
uniform float uIntensity;
uniform float uDensity;
uniform float uAngleA;
uniform float uAngleB;
uniform float uWidth;
uniform float uActiveFace;
uniform float uFlicker;
uniform float uTime;

in vec3 vObj;
in vec3 vN;
in vec2 vUv;
in float vFace;
in float vFragDepth;

out vec4 fragColor;

float hatch(vec3 p, vec3 dir, float density, float width) {
  float s = dot(p, dir) * density;
  float f = abs(fract(s) - 0.5);
  return 1.0 - smoothstep(width, width + 0.045, f);
}

void main() {
  gl_FragDepth = log2(max(vFragDepth, 1.0 + 1e-6)) * logDepthBufFC * 0.5;

  float a = uAngleA;
  float b = uAngleB;
  vec3 dA = normalize(vec3(cos(a), 0.18, sin(a)));
  vec3 dB = normalize(vec3(cos(b), -0.22, sin(b)));
  float hA = hatch(vObj, dA, uDensity, uWidth);
  float hB = hatch(vObj, dB, uDensity * 1.07, uWidth * 0.92);
  float lines = max(hA, hB);
  float moire = hA * hB;
  float cov = max(lines * 0.72, moire);

  float onFace = 1.0 - smoothstep(0.35, 0.85, abs(vFace - uActiveFace));
  float flick = 1.0 + uFlicker * (0.55 + 0.45 * sin(uTime * 12.566));
  float rim = pow(1.0 - abs(dot(normalize(vN), vec3(0.0, 0.0, 1.0))), 2.0);
  cov = cov * mix(0.55, 1.15, onFace) * flick + rim * 0.08 * onFace;

  vec3 col = uColor * uIntensity * cov;
  fragColor = vec4(col, 1.0);
}
