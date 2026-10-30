precision highp float;

uniform sampler2D tInput;
uniform vec2 uNtscSize;
uniform float uTime;
uniform float uHHold;
uniform float uStatic;
uniform float uTracking;
uniform float uBarrel;
uniform float uScanlines;
uniform float uGrille;
uniform float uVignette;
uniform float uBlackLift;
uniform float uBloom;
uniform float uInterlace;
uniform float uFlicker;
uniform float uReduceFlashing;

in vec2 vUv;
out vec4 fragColor;

vec3 rgbToYiq(vec3 c) {
  return vec3(
    dot(c, vec3(0.299, 0.587, 0.114)),
    dot(c, vec3(0.596, -0.274, -0.322)),
    dot(c, vec3(0.211, -0.523, 0.312))
  );
}

vec3 yiqToRgb(vec3 yiq) {
  return vec3(
    yiq.x + 0.956 * yiq.y + 0.621 * yiq.z,
    yiq.x - 0.272 * yiq.y - 0.647 * yiq.z,
    yiq.x - 1.106 * yiq.y + 1.703 * yiq.z
  );
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
  vec2 uv = barrelUv(vUv, uBarrel);
  bool inTube = uv.x >= 0.0 && uv.x <= 1.0 && uv.y >= 0.0 && uv.y <= 1.0;

  // Horizontal-hold roll: image slips sideways (stronger at the bottom) and
  // slightly vertically, wrapping like a lost analog lock.
  uv.x = fract(uv.x + uHHold * (0.18 + vUv.y * 0.55) + uHHold * uTime * 0.35);
  uv.y = fract(uv.y + uHHold * 0.12);

  // VHS-style tracking: a noisy band of horizontal tearing.
  float trackBand = smoothstep(0.72, 0.9, fract(uv.y * 2.7 + uTime * (0.4 + 2.0 * uTracking)));
  float trackJitter = (hash12(vec2(floor(uv.y * uNtscSize.y), uTime * 60.0)) - 0.5);
  uv.x = fract(uv.x + uTracking * 0.05 * trackJitter * (0.35 + trackBand));

  float flashMul = 1.0 - uReduceFlashing;
  float field = mod(floor(uTime * 59.94), 2.0);
  uv.y += (field - 0.5) * (1.0 / uNtscSize.y) * 0.5 * uInterlace * flashMul;

  if (uHHold < 0.002 && !inTube) {
    fragColor = vec4(vec3(uBlackLift), 1.0);
    return;
  }

  vec2 texel = 1.0 / uNtscSize;
  vec2 ntsc = (floor(uv * uNtscSize) + 0.5) * texel;

  // Y ~1 px, I/Q ~4 px. Weights match rasterCrt.ts gaussianWeights.
  float yW0 = 0.5;
  float yW1 = 0.25;
  vec3 yiqC = rgbToYiq(texture(tInput, ntsc).rgb);
  vec3 yiqL = rgbToYiq(texture(tInput, ntsc - vec2(texel.x, 0.0)).rgb);
  vec3 yiqR = rgbToYiq(texture(tInput, ntsc + vec2(texel.x, 0.0)).rgb);
  float Y = yiqL.x * yW1 + yiqC.x * yW0 + yiqR.x * yW1;

  float iqW[9];
  iqW[0] = 0.0276;
  iqW[1] = 0.0663;
  iqW[2] = 0.1238;
  iqW[3] = 0.1802;
  iqW[4] = 0.2042;
  iqW[5] = 0.1802;
  iqW[6] = 0.1238;
  iqW[7] = 0.0663;
  iqW[8] = 0.0276;
  float I = 0.0;
  float Q = 0.0;
  for (int k = -4; k <= 4; k++) {
    vec3 s = rgbToYiq(texture(tInput, ntsc + vec2(float(k) * texel.x, 0.0)).rgb);
    float w = iqW[k + 4];
    I += s.y * w;
    Q += s.z * w;
  }

  vec3 col = yiqToRgb(vec3(Y, I, Q));

  // Cheap NTSC-neighbour bloom (bright bars halo a little).
  vec3 bloom = vec3(0.0);
  for (int k = -2; k <= 2; k++) {
    vec3 s = yiqToRgb(rgbToYiq(texture(tInput, ntsc + vec2(float(k) * 2.0 * texel.x, 0.0)).rgb));
    bloom += max(s - vec3(0.55), 0.0);
  }
  col += (bloom / 5.0) * uBloom;

  float line = uv.y * uNtscSize.y;
  float tri = abs(fract(line) - 0.5);
  float scan = 1.0 - uScanlines * smoothstep(0.0, 0.48, tri) * 0.62;
  col *= scan;

  float slot = mod(gl_FragCoord.x, 3.0);
  vec3 mask = slot < 1.0
    ? vec3(1.18, 0.82, 0.82)
    : (slot < 2.0 ? vec3(0.82, 1.18, 0.82) : vec3(0.82, 0.82, 1.18));
  col *= mix(vec3(1.0), mask, uGrille);

  vec2 vc = vUv * 2.0 - 1.0;
  float vig = 1.0 - uVignette * dot(vc, vc) * 0.58;
  col *= vig;

  float n = hash12(floor(uv * uNtscSize) + vec2(uTime * 47.0, uTime * 19.0));
  col = mix(col, vec3(n), uStatic * 0.32);

  col *= 1.0 - uFlicker * flashMul;

  // Tracking snow in the tear band, low contrast.
  col = mix(col, col * 0.7 + n * 0.15, uTracking * trackBand * 0.5);

  float lum = dot(col, vec3(0.2126, 0.7152, 0.0722));
  vec3 mapped = col / (1.0 + max(lum, 0.0));
  mapped = mix(mapped, vec3(1.0), clamp((lum - 1.0) / 3.0, 0.0, 1.0));
  mapped = mapped * (1.0 - uBlackLift) + vec3(uBlackLift);

  fragColor = vec4(mapped, 1.0);
}
