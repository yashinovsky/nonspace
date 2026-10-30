// UV edge lines: beamLine ribbons with a crawling noise offset (plan §8.5).
// Colour is a uniform (ultraviolet #8A2BFF), not a palette index.

in vec3 aA;
in vec3 aB;
in vec4 aData; // unused idx, intensity, width px, flags

uniform vec2 uResolution;
uniform float uNear;
uniform float uSigma;
uniform float uDwell;
uniform float uDwellSigma;
uniform float uFogStart;
uniform float uFogDensity;
uniform float uTime;
uniform float uCrawlAmp;
uniform float uCrawlSpeed;
uniform vec3 uUvColor;

flat out vec2 vScreenA;
flat out vec2 vScreenB;
flat out vec3 vRgb;
flat out float vIntensity;
flat out float vHalfWidth;
flat out float vSigma;
flat out float vDwell;
flat out float vDwellSigma;
out float vFragDepth;

const int FLAG_DWELL = 1;
const int FLAG_NO_FOG = 4;

vec2 toScreen(vec4 clip) {
  vec2 ndc = clip.xy / max(clip.w, 1e-6);
  return (ndc * 0.5 + 0.5) * uResolution;
}

// Slow lightning. Matches crawlOffset() in blackIceMath.ts.
vec3 crawlOffset(vec3 p, float t, float amp) {
  if (amp < 1e-6) return vec3(0.0);
  vec3 n = vec3(
    sin(p.y * 5.17 + t * 1.73 + p.z * 0.31),
    cos(p.z * 4.91 - t * 1.31 + p.x * 0.27),
    sin(p.x * 6.13 + t * 0.87 - p.y * 0.19)
  );
  float m = sin(dot(p, vec3(0.37, 0.71, 0.13)) * 4.0 + t * 1.7)
          * cos(dot(p, vec3(0.21, 0.09, 0.83)) * 6.0 - t * 0.9);
  return n * m * amp;
}

void main() {
  float t = uTime * uCrawlSpeed;
  vec3 a = aA + crawlOffset(aA, t, uCrawlAmp);
  vec3 b = aB + crawlOffset(aB, t, uCrawlAmp);

  vec4 viewA = modelViewMatrix * vec4(a, 1.0);
  vec4 viewB = modelViewMatrix * vec4(b, 1.0);

  float da = -viewA.z;
  float db = -viewB.z;
  float near = max(uNear, 1e-4);

  if (da < near && db < near) {
    gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
    vIntensity = 0.0;
    vRgb = vec3(0.0);
    vScreenA = vec2(0.0);
    vScreenB = vec2(0.0);
    vHalfWidth = 0.0;
    vSigma = uSigma;
    vDwell = 0.0;
    vDwellSigma = uDwellSigma;
    vFragDepth = 1.0 + gl_Position.w;
    return;
  }

  if (da < near) {
    float clipT = (near - da) / (db - da);
    viewA = mix(viewA, viewB, clipT);
    da = near;
  }
  if (db < near) {
    float clipT = (near - db) / (da - db);
    viewB = mix(viewB, viewA, clipT);
    db = near;
  }

  vec4 clipA = projectionMatrix * viewA;
  vec4 clipB = projectionMatrix * viewB;
  vec2 screenA = toScreen(clipA);
  vec2 screenB = toScreen(clipB);

  vec2 dir = screenB - screenA;
  float len = length(dir);
  vec2 tang = len > 0.05 ? dir / len : vec2(1.0, 0.0);
  vec2 perp = vec2(-tang.y, tang.x);

  int flags = int(aData.w + 0.5);
  float width = aData.z;
  float conserved = max(width, 1.0);
  float iScale = width <= 0.0 ? 0.0 : width / conserved;

  float intensity = aData.y * iScale;
  float dist = length(mix(viewA.xyz, viewB.xyz, 0.5));
  if ((flags & FLAG_NO_FOG) == 0) {
    intensity *= exp(-uFogDensity * max(dist - uFogStart, 0.0));
  }

  float sigma = max(uSigma, 0.05);
  float dwellSigma = max(uDwellSigma, sigma);
  float extra = 3.0 * ((flags & FLAG_DWELL) != 0 ? max(sigma, dwellSigma) : sigma);
  float halfW = 0.5 * (conserved + 3.0 * sigma);

  float along = position.x;
  float across = position.y;
  vec2 base = mix(screenA, screenB, along);
  base += tang * (along * 2.0 - 1.0) * extra;
  base += perp * across * halfW;

  float w = mix(clipA.w, clipB.w, along);
  float z = mix(clipA.z, clipB.z, along);
  vec2 ndc = (base / max(uResolution, vec2(1.0))) * 2.0 - 1.0;
  gl_Position = vec4(ndc * w, z, w);

  vScreenA = screenA;
  vScreenB = screenB;
  vRgb = uUvColor;
  vIntensity = intensity;
  vHalfWidth = 0.5 * conserved;
  vSigma = sigma;
  vDwell = (flags & FLAG_DWELL) != 0 ? uDwell * aData.y : 0.0;
  vDwellSigma = dwellSigma;
  vFragDepth = 1.0 + gl_Position.w;
}
