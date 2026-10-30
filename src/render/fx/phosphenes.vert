// Screen-space phosphene sprites (plan §5.9 / §8.5). Curl-noise flow from
// the frame edges inward. Position is NDC; no depth. `aSeed` in [0,1].

in float aSeed;

uniform float uTime;
uniform float uAmount;
uniform float uAmp;
uniform vec2 uResolution;

out float vI;

float hash(float n) {
  return fract(sin(n * 127.1) * 43758.5453);
}

float valueNoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = p - i;
  vec2 u = f * f * (3.0 - 2.0 * f);
  float a = hash(i.x + i.y * 19.0);
  float b = hash(i.x + 1.0 + i.y * 19.0);
  float c = hash(i.x + (i.y + 1.0) * 19.0);
  float d = hash(i.x + 1.0 + (i.y + 1.0) * 19.0);
  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}

vec2 curl2(vec2 p) {
  float e = 0.18;
  float n1 = valueNoise(p + vec2(0.0, e));
  float n2 = valueNoise(p - vec2(0.0, e));
  float n3 = valueNoise(p + vec2(e, 0.0));
  float n4 = valueNoise(p - vec2(e, 0.0));
  return vec2(n1 - n2, n4 - n3);
}

vec2 perimeter(float t) {
  float u = fract(t) * 4.0;
  if (u < 1.0) return vec2(mix(-1.0, 1.0, u), 1.0);
  if (u < 2.0) return vec2(1.0, mix(1.0, -1.0, u - 1.0));
  if (u < 3.0) return vec2(mix(1.0, -1.0, u - 2.0), -1.0);
  return vec2(-1.0, mix(-1.0, 1.0, u - 3.0));
}

void main() {
  float seed = aSeed;
  vec2 start = perimeter(hash(seed * 3.17));
  float travel = uAmount * (0.22 + 0.72 * hash(seed * 11.9));
  vec2 curl = curl2(vec2(seed * 4.0, uTime * 0.31 + seed));
  vec2 ndc = mix(start, vec2(0.0), travel) + curl * 0.1 * uAmount;
  ndc = clamp(ndc, vec2(-1.05), vec2(1.05));
  gl_Position = vec4(ndc, 0.0, 1.0);
  float px = mix(2.2, 5.4, hash(seed * 5.3));
  gl_PointSize = px * (0.55 + 0.45 * uAmount);
  float fall = 1.0 - travel * 0.55;
  vI = uAmp * uAmount * (0.28 + 0.18 * hash(seed * 9.1)) * fall;
}
