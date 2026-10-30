// Instanced segment quads (plan §8.5). Per-instance a, b, color, intensity, width, flags.
// Near-plane clip in view space, then expand to a screen-space ribbon of width w + 3σ.

// `position` is declared by Three's ShaderMaterial prefix.
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
uniform float uSoften;
uniform float uSoftenTime;

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
    return;
  }

  // Plan §8.5: t = (near - za)/(zb - za) in positive-depth form.
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

  int flags = int(aData.w + 0.5);
  float width = aData.z;
  float conserved = max(width, 1.0);
  float iScale = width <= 0.0 ? 0.0 : width / conserved;

  int idx = int(clamp(aData.x + 0.5, 0.0, 7.0));
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

  vec4 clipA = projectionMatrix * viewA;
  vec4 clipB = projectionMatrix * viewB;
  vec2 screenA;
  vec2 screenB;
  vec2 base;
  float w;
  float z;

  if (uSoften > 0.001) {
    vec3 seg = viewB.xyz - viewA.xyz;
    float slen = length(seg);
    vec3 tng = slen > 1e-4 ? seg / slen : vec3(0.0, 0.0, -1.0);
    vec3 up = abs(tng.y) > 0.92 ? vec3(1.0, 0.0, 0.0) : vec3(0.0, 1.0, 0.0);
    vec3 side = normalize(cross(tng, up));
    float wave = sin(dot(mix(viewA.xyz, viewB.xyz, 0.5), vec3(0.11, 0.07, 0.09)) + uSoftenTime * 0.55);
    float amp = uSoften * (2.4 + 0.9 * wave);
    vec4 viewP = mix(viewA, viewB, along);
    viewP.xyz += side * sin(along * 3.14159265) * amp;
    float t1 = clamp(along + 0.04, 0.0, 1.0);
    float t0 = clamp(along - 0.04, 0.0, 1.0);
    vec4 viewQ = mix(viewA, viewB, t1);
    vec4 viewR = mix(viewA, viewB, t0);
    viewQ.xyz += side * sin(t1 * 3.14159265) * amp;
    viewR.xyz += side * sin(t0 * 3.14159265) * amp;
    vec4 clipP = projectionMatrix * viewP;
    vec2 screenP = toScreen(clipP);
    vec2 screenQ = toScreen(projectionMatrix * viewQ);
    vec2 screenR = toScreen(projectionMatrix * viewR);
    vec2 sdir = along < 0.5 ? screenQ - screenP : screenP - screenR;
    float sl = length(sdir);
    vec2 stang = sl > 0.05 ? sdir / sl : vec2(1.0, 0.0);
    vec2 sperp = vec2(-stang.y, stang.x);
    screenA = toScreen(clipA);
    screenB = toScreen(clipB);
    base = screenP;
    base += stang * (along * 2.0 - 1.0) * extra * 0.15;
    base += sperp * across * halfW;
    w = clipP.w;
    z = clipP.z;
  } else {
    screenA = toScreen(clipA);
    screenB = toScreen(clipB);
    vec2 dir = screenB - screenA;
    float len = length(dir);
    vec2 tang = len > 0.05 ? dir / len : vec2(1.0, 0.0);
    vec2 perp = vec2(-tang.y, tang.x);
    base = mix(screenA, screenB, along);
    base += tang * (along * 2.0 - 1.0) * extra;
    base += perp * across * halfW;
    w = mix(clipA.w, clipB.w, along);
    z = mix(clipA.z, clipB.z, along);
  }

  vec2 ndc = (base / max(uResolution, vec2(1.0))) * 2.0 - 1.0;
  gl_Position = vec4(ndc * w, z, w);

  vScreenA = screenA;
  vScreenB = screenB;
  vRgb = uPalette[idx];
  vIntensity = intensity;
  vHalfWidth = 0.5 * conserved;
  vSigma = sigma;
  vDwell = (flags & FLAG_DWELL) != 0 ? uDwell * aData.y : 0.0;
  vDwellSigma = dwellSigma;
  vFragDepth = 1.0 + gl_Position.w;
}
