// Kuang rib lines (plan §8.5). BeamLine ribbon + thin-film varyings.
// Near-plane clip in view space, then expand to a screen-space ribbon of width w + 3σ.

in vec3 aA;
in vec3 aB;
in vec4 aData; // color idx, intensity, width px, flags

uniform vec2 uResolution;
uniform float uNear;
uniform float uSigma;
uniform float uDwell;
uniform float uDwellSigma;
uniform float uFogStart;
uniform float uFogDensity;
uniform vec3 uPalette[8];
uniform float uTime;
uniform float uMimic;
uniform vec3 uTa;

flat out vec2 vScreenA;
flat out vec2 vScreenB;
flat out vec3 vRgb;
flat out float vIntensity;
flat out float vHalfWidth;
flat out float vSigma;
flat out float vDwell;
flat out float vDwellSigma;
out float vFragDepth;
flat out float vNdotV;
flat out float vThickness;
flat out float vMimic;

const int FLAG_DWELL = 1;
const int FLAG_NO_FOG = 4;

vec2 toScreen(vec4 clip) {
  vec2 ndc = clip.xy / max(clip.w, 1e-6);
  return (ndc * 0.5 + 0.5) * uResolution;
}

void main() {
  vec4 viewA = modelViewMatrix * vec4(aA, 1.0);
  vec4 viewB = modelViewMatrix * vec4(aB, 1.0);

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
    vNdotV = 0.0;
    vThickness = 0.3;
    vMimic = uMimic;
    return;
  }

  if (da < near) {
    float t = (near - da) / (db - da);
    viewA = mix(viewA, viewB, t);
    da = near;
  }
  if (db < near) {
    float t = (near - db) / (da - db);
    viewB = mix(viewB, viewA, t);
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

  vec3 midW = mix(aA, aB, 0.5);
  vec3 viewW = cameraPosition - midW;
  float viewLen = length(viewW);
  vec3 viewDir = viewLen > 1e-5 ? viewW / viewLen : vec3(0.0, 0.0, 1.0);
  vec3 radial = vec3(midW.x, midW.y, 0.0);
  float rl = length(radial);
  if (rl < 1e-4) radial = vec3(0.0, 1.0, 0.0);
  else radial /= rl;
  vNdotV = abs(dot(radial, viewDir));
  // Per-rib phase (flags >> 8) so a ring is one hue; nDotV is a thin-film wobble.
  float ribU = float((flags >> 8) & 255) / 36.0;
  vThickness = ribU + 0.08 * vNdotV;
  vMimic = clamp(uMimic, 0.0, 1.0);

  vScreenA = screenA;
  vScreenB = screenB;
  vRgb = uTa;
  vIntensity = intensity;
  vHalfWidth = 0.5 * conserved;
  vSigma = sigma;
  vDwell = (flags & FLAG_DWELL) != 0 ? uDwell * aData.y : 0.0;
  vDwellSigma = dwellSigma;
  vFragDepth = 1.0 + gl_Position.w;
}
