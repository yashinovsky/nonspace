precision highp float;

uniform vec3 uCamPos;
uniform vec3 uCamRight;
uniform vec3 uCamUp;
uniform vec3 uCamForward;
uniform vec3 uSunDir;
uniform vec3 uLindaPos;
uniform vec3 uBoyPos;
uniform vec2 uExit;
uniform float uAspect;
uniform float uTanHalfFov;
uniform float uTime;
uniform float uReveal;
uniform float uStay;
uniform float uMaxSteps;

in vec2 vUv;
out vec4 fragColor;

const float MAX_DIST = 90.0;
const int CAP = 64;

const int MAT_SKY = 0;
const int MAT_SAND = 1;
const int MAT_WATER = 2;
const int MAT_CONCRETE = 3;
const int MAT_LINDA = 4;
const int MAT_BOY = 5;

float hash(vec2 p) {
  return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
}

float noise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  float a = hash(i);
  float b = hash(i + vec2(1.0, 0.0));
  float c = hash(i + vec2(0.0, 1.0));
  float d = hash(i + vec2(1.0, 1.0));
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}

float fbm(vec2 p) {
  float v = 0.0;
  float a = 0.5;
  for (int i = 0; i < 4; i++) {
    v += a * noise(p);
    p = p * 2.03 + vec2(1.7, 9.2);
    a *= 0.5;
  }
  return v;
}

float sdSphere(vec3 p, float r) {
  return length(p) - r;
}

float sdEllipsoid(vec3 p, vec3 r) {
  float k0 = length(p / r);
  float k1 = length(p / (r * r));
  return k0 * (k0 - 1.0) / k1;
}

float sdCapsule(vec3 p, vec3 a, vec3 b, float r) {
  vec3 pa = p - a;
  vec3 ba = b - a;
  float h = clamp(dot(pa, ba) / dot(ba, ba), 0.0, 1.0);
  return length(pa - ba * h) - r;
}

float sdBox(vec3 p, vec3 b) {
  vec3 q = abs(p) - b;
  return length(max(q, 0.0)) + min(max(q.x, max(q.y, q.z)), 0.0);
}

float smin(float a, float b, float k) {
  float h = clamp(0.5 + 0.5 * (b - a) / k, 0.0, 1.0);
  return mix(b, a, h) - k * h * (1.0 - h);
}

float smax(float a, float b, float k) {
  return -smin(-a, -b, k);
}

float sandH(vec2 xz) {
  float shore = smoothstep(-11.0, -1.0, xz.y);
  float n = fbm(xz * 0.11) * 0.42;
  float dune = 0.14 * sin(xz.x * 0.17) * sin(xz.y * 0.11);
  return -0.06 + 0.72 * shore + dune * shore + n * shore * 0.55;
}

float sdSand(vec3 p) {
  return p.y - sandH(p.xz);
}

float sdWater(vec3 p) {
  float w = 0.012 * sin(p.x * 1.6 + uTime * 0.7) + 0.008 * sin(p.z * 1.1 - uTime * 0.55);
  return p.y - (0.08 + w);
}

float sdBunker(vec3 p) {
  vec3 c = vec3(-14.2, 0.0, 16.2);
  vec3 q = p - c;
  float body = sdBox(q - vec3(0.0, 1.15, 0.0), vec3(3.25, 1.15, 2.45));
  float roof = sdBox(q - vec3(0.0, 2.38, -0.55), vec3(3.55, 0.1, 3.05));
  float slab = sdBox(q - vec3(0.0, 0.08, -1.6), vec3(4.2, 0.08, 3.4));
  float door = sdBox(q - vec3(0.0, 0.95, -2.55), vec3(0.72, 0.95, 1.15));
  float d = min(body, roof);
  d = min(d, slab);
  d = smax(d, -door, 0.04);
  return d;
}

float sdFigure(vec3 p, float s) {
  p /= s;
  float head = sdSphere(p - vec3(0.0, 0.78, 0.05), 0.125);
  float torso = sdEllipsoid(p - vec3(0.0, 0.5, 0.03), vec3(0.155, 0.2, 0.11));
  float hip = sdSphere(p - vec3(0.0, 0.3, 0.02), 0.13);
  float thighL = sdCapsule(p, vec3(-0.08, 0.28, 0.0), vec3(-0.11, 0.16, -0.34), 0.065);
  float thighR = sdCapsule(p, vec3(0.08, 0.28, 0.0), vec3(0.11, 0.16, -0.34), 0.065);
  float shinL = sdCapsule(p, vec3(-0.11, 0.16, -0.34), vec3(-0.1, 0.02, -0.4), 0.05);
  float shinR = sdCapsule(p, vec3(0.11, 0.16, -0.34), vec3(0.1, 0.02, -0.4), 0.05);
  float armL = sdCapsule(p, vec3(-0.17, 0.58, 0.02), vec3(-0.13, 0.3, -0.14), 0.038);
  float armR = sdCapsule(p, vec3(0.17, 0.58, 0.02), vec3(0.13, 0.3, -0.14), 0.038);
  float d = smin(head, torso, 0.04);
  d = smin(d, hip, 0.05);
  d = smin(d, thighL, 0.04);
  d = smin(d, thighR, 0.04);
  d = smin(d, shinL, 0.03);
  d = smin(d, shinR, 0.03);
  d = smin(d, armL, 0.03);
  d = smin(d, armR, 0.03);
  return d * s;
}

int gMat;

float map(vec3 p) {
  float d = sdSand(p);
  gMat = MAT_SAND;
  float w = sdWater(p);
  if (w < d) {
    d = w;
    gMat = MAT_WATER;
  }
  float b = sdBunker(p);
  if (b < d) {
    d = b;
    gMat = MAT_CONCRETE;
  }
  float ld = sdFigure(p - uLindaPos, 1.0);
  if (ld < d) {
    d = ld;
    gMat = MAT_LINDA;
  }
  float bd = sdFigure(p - uBoyPos, 0.62);
  if (bd < d) {
    d = bd;
    gMat = MAT_BOY;
  }
  return d;
}

vec3 calcNormal(vec3 p) {
  const vec2 e = vec2(0.0025, 0.0);
  return normalize(vec3(
    map(p + e.xyy) - map(p - e.xyy),
    map(p + e.yxy) - map(p - e.yxy),
    map(p + e.yyx) - map(p - e.yyx)
  ));
}

float march(vec3 ro, vec3 rd, float tmax, out vec3 p, out int mat) {
  float t = 0.0;
  int steps = int(uMaxSteps);
  for (int i = 0; i < CAP; i++) {
    if (i >= steps) break;
    p = ro + rd * t;
    float d = map(p);
    mat = gMat;
    if (d < 0.0018 * (1.0 + t * 0.4)) return t;
    t += d;
    if (t > tmax) break;
  }
  mat = MAT_SKY;
  return tmax;
}

float hardShadow(vec3 ro, vec3 rd) {
  float t = 0.04;
  for (int i = 0; i < 32; i++) {
    float d = map(ro + rd * t);
    if (d < 0.002) return 0.0;
    t += d;
    if (t > 40.0) break;
  }
  return 1.0;
}

vec3 skyColor(vec3 rd, vec3 sun) {
  float elev = sun.y;
  float day = smoothstep(-0.12, 0.22, elev);
  float dusk = pow(1.0 - abs(clamp(elev, -0.15, 1.0)), 2.2);
  vec3 zenith = mix(vec3(0.035, 0.04, 0.07), vec3(0.34, 0.42, 0.52), day);
  vec3 horizon = mix(vec3(0.08, 0.09, 0.11), vec3(0.62, 0.66, 0.7), day);
  horizon = mix(horizon, vec3(0.78, 0.58, 0.4), dusk * 0.85);
  float h = clamp(rd.y * 0.5 + 0.5, 0.0, 1.0);
  vec3 col = mix(horizon, zenith, pow(h, 0.75));
  float sunD = max(dot(rd, normalize(sun)), 0.0);
  float disc = smoothstep(0.9992, 0.99985, sunD);
  float halo = pow(sunD, 48.0) * (0.25 + 0.55 * dusk);
  vec3 sunCol = mix(vec3(0.95, 0.72, 0.42), vec3(1.0, 0.96, 0.86), day);
  col += sunCol * halo;
  col += sunCol * disc * (6.0 + 10.0 * dusk);
  return col;
}

vec3 checkerAlbedo(vec2 xz) {
  float c = mod(floor(xz.x / 1.6) + floor(xz.y / 1.6), 2.0);
  return mix(vec3(0.16, 0.13, 0.1), vec3(0.86, 0.8, 0.68), c);
}

vec3 shade(vec3 p, vec3 n, vec3 rd, int mat, vec3 sun) {
  vec3 L = normalize(sun);
  float ndl = max(dot(n, L), 0.0);
  float sh = 1.0;
  if (ndl > 0.0 && sun.y > -0.02) {
    sh = hardShadow(p + n * 0.03, L);
  }
  float day = smoothstep(-0.1, 0.25, sun.y);
  vec3 skyAmb = skyColor(n, sun) * (0.18 + 0.22 * day);
  vec3 albedo = vec3(0.5);
  float specK = 0.0;
  float specP = 24.0;

  if (mat == MAT_SAND) {
    albedo = vec3(0.62, 0.54, 0.42);
    float wet = 1.0 - smoothstep(-8.0, -2.0, p.z);
    albedo = mix(albedo, vec3(0.42, 0.4, 0.34), wet * 0.55);
    vec3 chk = checkerAlbedo(p.xz);
    float reveal = uReveal;
    reveal += (1.0 - smoothstep(6.0, 18.0, length(p.xz - uExit))) * 0.4;
    albedo = mix(albedo, chk, clamp(reveal, 0.0, 1.0));
    specK = 0.08 + 0.2 * wet;
    specP = 18.0;
  } else if (mat == MAT_WATER) {
    albedo = vec3(0.18, 0.24, 0.26);
    specK = 0.85;
    specP = 80.0;
  } else if (mat == MAT_CONCRETE) {
    albedo = vec3(0.48, 0.49, 0.47);
    specK = 0.06;
  } else if (mat == MAT_LINDA) {
    albedo = vec3(0.78, 0.6, 0.5);
    specK = 0.35;
    specP = 40.0;
  } else if (mat == MAT_BOY) {
    albedo = vec3(0.72, 0.58, 0.48);
    specK = 0.32;
    specP = 36.0;
  }

  vec3 diff = albedo * (skyAmb + ndl * sh * mix(vec3(0.35, 0.32, 0.28), vec3(1.05, 0.98, 0.88), day));
  vec3 h = normalize(L - rd);
  float spec = pow(max(dot(n, h), 0.0), specP) * specK * sh;
  vec3 sunCol = mix(vec3(0.9, 0.55, 0.3), vec3(1.0, 0.96, 0.9), day);
  return diff + spec * sunCol;
}

void main() {
  vec2 uv = vUv * 2.0 - 1.0;
  uv.x *= uAspect;
  vec3 ro = uCamPos;
  vec3 rd = normalize(uCamForward + uv.x * uCamRight * uTanHalfFov + uv.y * uCamUp * uTanHalfFov);
  vec3 sun = uSunDir;

  vec3 p;
  int mat;
  float t = march(ro, rd, MAX_DIST, p, mat);
  vec3 col;
  if (mat == MAT_SKY) {
    col = skyColor(rd, sun);
  } else {
    vec3 n = calcNormal(p);
    col = shade(p, n, rd, mat, sun);
    if (mat == MAT_WATER || (mat == MAT_SAND && uReveal > 0.45 && p.z < -6.0)) {
      vec3 rdir = reflect(rd, n);
      vec3 rp;
      int rmat;
      float rt = march(p + n * 0.03, rdir, 40.0, rp, rmat);
      vec3 rcol = rmat == MAT_SKY ? skyColor(rdir, sun) : shade(rp, calcNormal(rp), rdir, rmat, sun);
      float fres = mix(0.08, 1.0, pow(1.0 - max(dot(n, -rd), 0.0), 5.0));
      if (mat == MAT_WATER) col = mix(col, rcol, 0.22 + 0.7 * fres);
      else col = mix(col, rcol, 0.18 * fres * uReveal);
    }
    float fog = 1.0 - exp(-0.012 * t * t * 0.02 - 0.018 * t);
    col = mix(col, skyColor(rd, sun), clamp(fog, 0.0, 1.0));
  }

  col *= mix(1.0, 0.92, uStay);
  fragColor = vec4(col, 1.0);
}
