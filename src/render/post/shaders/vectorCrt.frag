precision highp float;

uniform sampler2D tInput;
uniform float uExposure;
uniform vec2 uResolution;
uniform float uTime;
uniform float uBarrel;
uniform float uJitter;
uniform float uFlicker;
uniform float uVignette;
uniform float uGlass;
uniform float uGrain;

in vec2 vUv;
out vec4 fragColor;

// Must match shaders/tonemap.frag (M1.5). Do not replace.
vec3 tonemapReinhardWhite(vec3 c) {
  c *= uExposure;
  float lum = dot(c, vec3(0.2126, 0.7152, 0.0722));
  vec3 mapped = c / (1.0 + max(lum, 0.0));
  float hot = max(lum - 1.0, 0.0);
  return mix(mapped, vec3(1.0), clamp(hot / 3.0, 0.0, 1.0));
}

float hash12(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}

vec2 barrelUv(vec2 uv, float k) {
  vec2 c = uv * 2.0 - 1.0;
  float r2 = dot(c, c);
  c *= 1.0 + k * r2;
  return c * 0.5 + 0.5;
}

void main() {
  vec2 texel = 1.0 / max(uResolution, vec2(1.0));
  // Whole-beam deflection, not per-pixel hash. ≤ 0.25 px, low-frequency.
  vec2 jitter = vec2(
    sin(uTime * 6.3) * 0.55 + sin(uTime * 2.7 + 1.3) * 0.45,
    cos(uTime * 5.1 + 0.6) * 0.50 + sin(uTime * 3.9) * 0.50
  ) * uJitter * texel;

  vec2 uv = barrelUv(vUv + jitter, uBarrel);
  if (uv.x < 0.0 || uv.x > 1.0 || uv.y < 0.0 || uv.y > 1.0) {
    fragColor = vec4(0.0);
    return;
  }

  vec3 c = texture(tInput, uv).rgb;

  vec2 vc = vUv * 2.0 - 1.0;
  c *= 1.0 - uVignette * dot(vc, vc) * 0.55;

  // ~2.2 Hz pump, amplitude already includes load and Reduce flashing.
  float wave = 0.5 + 0.5 * sin(uTime * 13.8);
  c *= 1.0 - uFlicker * wave;

  // Glass: multiplicative sheen + sparse dust. Empty stays RGB 0.
  float sheen = pow(max(0.0, 1.0 - length(vUv - vec2(0.30, 0.22))), 3.0);
  float dust = hash12(floor(uv * vec2(71.0, 53.0) + 0.5));
  c *= 1.0 + uGlass * sheen * 0.4;
  c *= 1.0 - uGlass * 0.1 * step(0.93, dust);

  vec3 mapped = tonemapReinhardWhite(c);
  float g = hash12(gl_FragCoord.xy + vec2(uTime * 19.0, uTime * 7.0)) - 0.5;
  mapped *= 1.0 + g * uGrain;

  fragColor = vec4(mapped, 1.0);
}
