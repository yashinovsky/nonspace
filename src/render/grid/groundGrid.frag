precision highp float;

// Pristine-grid analytic AA (plan §8.5): three line levels via fwidth, each
// faded by screen-space density before it aliases; checker cells; warp field.
// World position is the y=0 hit of the camera ray through this pixel.

uniform vec3 uPalette[8];
uniform vec4 uWarp[4];
uniform mat4 uViewProjInverse;
uniform vec2 uResolution;
uniform float uNear;
uniform float uMinor;
uniform float uMajor;
uniform float uSuper;
uniform float uMinorWidth;
uniform float uMajorWidth;
uniform float uSuperWidth;
uniform float uMinorI;
uniform float uMajorI;
uniform float uSuperI;
uniform float uChecker;
uniform float uCheckerEnd;
uniform float uFogStart;
uniform float uFogDensity;
uniform float uRadius;
uniform float logDepthBufFC;

out vec4 fragColor;

float densityFade(float deriv) {
  return 1.0 - smoothstep(0.25, 0.75, deriv);
}

float pristineLine(float coord, float widthPx) {
  float deriv = max(fwidth(coord), 1e-8);
  float d = abs(fract(coord - 0.5) - 0.5);
  float halfW = 0.5 * widthPx * deriv;
  float line = 1.0 - smoothstep(halfW, halfW + deriv, d);
  return line * densityFade(deriv);
}

vec2 applyWarp(vec2 p) {
  vec2 w = p;
  for (int i = 0; i < 4; i++) {
    vec4 c = uWarp[i];
    if (abs(c.w) < 1e-6 || c.z <= 1e-6) continue;
    vec2 d = p - c.xy;
    float r = length(d);
    if (r < 1e-4) continue;
    float gauss = exp(-(r * r) / (2.0 * c.z * c.z));
    w += (d / r) * (c.w * c.z * gauss);
  }
  return w;
}

void main() {
  vec2 ndc = (gl_FragCoord.xy / max(uResolution, vec2(1.0))) * 2.0 - 1.0;
  vec4 worldH = uViewProjInverse * vec4(ndc, 1.0, 1.0);
  vec3 worldFar = worldH.xyz / max(worldH.w, 1e-6);
  vec3 dir = worldFar - cameraPosition;
  if (abs(dir.y) < 1e-8) discard;
  float t = -cameraPosition.y / dir.y;
  if (t <= 0.0) discard;
  vec3 hit = cameraPosition + dir * t;

  vec4 viewHit = viewMatrix * vec4(hit, 1.0);
  if (-viewHit.z < uNear) discard;
  // Perspective clip.w == -view.z; Three only injects projectionMatrix in the VS.
  gl_FragDepth = log2(max(1.0 - viewHit.z, 1.0 + 1e-6)) * logDepthBufFC * 0.5;

  vec2 wp = applyWarp(hit.xz);
  float minor = 1.0
    - (1.0 - pristineLine(wp.x / uMinor, uMinorWidth))
      * (1.0 - pristineLine(wp.y / uMinor, uMinorWidth));
  float major = 1.0
    - (1.0 - pristineLine(wp.x / uMajor, uMajorWidth))
      * (1.0 - pristineLine(wp.y / uMajor, uMajorWidth));
  float superL = 1.0
    - (1.0 - pristineLine(wp.x / uSuper, uSuperWidth))
      * (1.0 - pristineLine(wp.y / uSuper, uSuperWidth));

  float lines = uMinorI * minor + uMajorI * major + uSuperI * superL;

  vec2 cell = wp / uMinor;
  float derivC = max(fwidth(cell.x), fwidth(cell.y));
  float dist = length(hit - cameraPosition);
  float nearFade = dist >= uCheckerEnd ? 0.0 : 1.0 - (dist / uCheckerEnd) * (dist / uCheckerEnd);
  float check = mod(floor(cell.x) + floor(cell.y), 2.0);
  float fill = check * uChecker * densityFade(derivC) * nearFade;

  float fog = exp(-uFogDensity * max(dist - uFogStart, 0.0));
  float race = 1.0;
  if (uRadius > 0.0 && uRadius < 1.0e8) {
    float edge = uRadius * 0.82;
    race = 1.0 - smoothstep(edge, uRadius, dist);
  }
  float I = (lines + fill) * fog * race;
  if (I < 0.0004) discard;
  fragColor = vec4(uPalette[0] * I, 1.0);
}
