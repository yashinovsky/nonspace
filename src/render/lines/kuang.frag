precision highp float;

// Thin-film interference (plan §8.5): rgb = spectrum(f(thickness(view·n, time))).
// The only continuous-spectrum material. Mimic lerps toward T-A emerald.

flat in vec2 vScreenA;
flat in vec2 vScreenB;
flat in vec3 vRgb;
flat in float vIntensity;
flat in float vHalfWidth;
flat in float vSigma;
flat in float vDwell;
flat in float vDwellSigma;
in float vFragDepth;
flat in float vNdotV;
flat in float vThickness;
flat in float vMimic;

uniform float logDepthBufFC;
uniform float uTime;
uniform vec3 uTa;

out vec4 fragColor;

float saturate(float x) {
  return clamp(x, 0.0, 1.0);
}

float smoother(float e0, float e1, float x) {
  float t = saturate((x - e0) / max(e1 - e0, 1e-5));
  return t * t * (3.0 - 2.0 * t);
}

// Must stay in lockstep with spectrumRgb() in kuangMath.ts.
// Magenta → cyan → gold; saturated so bloom does not flatten it to white.
vec3 spectrum(float x) {
  float t = saturate(x);
  vec3 mag = vec3(1.0, 0.04, 0.88);
  vec3 cyn = vec3(0.04, 0.95, 1.0);
  vec3 gld = vec3(1.0, 0.72, 0.06);
  vec3 a = mix(mag, cyn, smoother(0.0, 0.42, t));
  return mix(a, gld, smoother(0.38, 1.0, t));
}

void main() {
  gl_FragDepth = log2(max(vFragDepth, 1.0 + 1e-6)) * logDepthBufFC * 0.5;

  vec2 p = gl_FragCoord.xy;
  vec2 ba = vScreenB - vScreenA;
  float ba2 = dot(ba, ba);
  float h = ba2 > 1e-8 ? clamp(dot(p - vScreenA, ba) / ba2, 0.0, 1.0) : 0.0;
  float dSeg = length(p - vScreenA - ba * h);
  float d = max(dSeg - vHalfWidth, 0.0);

  float sigma = max(vSigma, 0.05);
  float I = vIntensity * exp(-(d * d) / (2.0 * sigma * sigma));

  if (vDwell > 0.0) {
    float dEnd = min(length(p - vScreenA), length(p - vScreenB));
    float sd = max(vDwellSigma, 0.05);
    I += vDwell * exp(-(dEnd * dEnd) / (2.0 * sd * sd));
  }

  if (I < 0.0004) discard;

  float film = fract(2.0 * 1.33 * vThickness * max(vNdotV, 0.08) + uTime * 0.18);
  vec3 spec = spectrum(film);
  vec3 rgb = mix(spec, uTa, clamp(vMimic, 0.0, 1.0));
  fragColor = vec4(rgb * I, 1.0);
}
