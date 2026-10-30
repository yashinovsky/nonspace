uniform float uTime;
uniform vec2 uResolution;
uniform float uMinSize;
uniform float uMaxSize;
uniform float uRefDistance;
uniform float uFogDensity;
uniform vec3 uPalette[8];

attribute float aColor;
attribute float aIntensity;
attribute float aSize;
attribute float aTwinkle;
attribute float aPhase;

varying vec2 vUv;
varying vec3 vColor;
varying float vIntensity;

#ifdef USE_LOGARITHMIC_DEPTH_BUFFER
varying float vFragDepth;
varying float vIsPerspective;
#endif

void emitPoint(vec3 worldPos) {
  vec4 mvPosition = modelViewMatrix * vec4(worldPos, 1.0);
  float dist = length(mvPosition.xyz);

  if (mvPosition.z > -0.45 || dist < 1e-4) {
    gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
    vUv = vec2(0.0);
    vColor = vec3(0.0);
    vIntensity = 0.0;
#ifdef USE_LOGARITHMIC_DEPTH_BUFFER
    vFragDepth = 1.0;
    vIsPerspective = 1.0;
#endif
    return;
  }

  float projected = aSize * uRefDistance / dist;
  float px = projected;
  float energy = 1.0;
  if (projected < uMinSize) {
    px = uMinSize;
    float r = projected / uMinSize;
    energy = r * r;
  } else if (projected > uMaxSize) {
    px = uMaxSize;
  }

  float tw = 1.0;
  if (aTwinkle > 0.001) {
    float n = sin(uTime * (1.7 + aTwinkle * 3.1) + aPhase * 41.2);
    tw = mix(1.0, 0.55 + 0.45 * n * n, clamp(aTwinkle, 0.0, 1.0));
  }

  float fog = exp(-uFogDensity * dist);
  int idx = int(clamp(aColor + 0.5, 0.0, 7.0));
  vColor = uPalette[idx];
  vIntensity = aIntensity * energy * tw * fog;
  vUv = uv * 2.0 - 1.0;

  vec4 clip = projectionMatrix * mvPosition;
  vec2 ndc = clip.xy / clip.w;
  vec2 halfNdc = vec2(px) / max(uResolution, vec2(1.0));
  ndc += vUv * halfNdc;
  gl_Position = vec4(ndc * clip.w, clip.z, clip.w);

#ifdef USE_LOGARITHMIC_DEPTH_BUFFER
  vFragDepth = 1.0 + gl_Position.w;
  vIsPerspective = isOrthographic ? 0.0 : 1.0;
#endif
}
