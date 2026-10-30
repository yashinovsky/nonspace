precision highp float;

// After bloom: eat HDR+bloom where the mask is set, then re-add a crawling
// ultraviolet silhouette so the edge survives subtraction. Grip tendrils
// grow inward from the screen edges (plan §5.5, §8.4, §8.5).

uniform sampler2D tInput;
uniform sampler2D tBloom;
uniform sampler2D tMask;
uniform float uHasBloom;
uniform float uHasMask;
uniform float uStrength;
uniform float uEdgeIntensity;
uniform float uTime;
uniform float uGrip;
uniform float uReduceMotion;
uniform vec3 uUvColor;

in vec2 vUv;
out vec4 fragColor;

float tendrilCoverage(vec2 uv, float t, float grip) {
  if (grip < 1e-4) return 0.0;
  float g = clamp(grip, 0.0, 1.0);
  float reach = mix(0.02, 0.38, g);
  float edge = min(min(uv.x, 1.0 - uv.x), min(uv.y, 1.0 - uv.y));
  vec2 w = uv;
  w.x += 0.045 * sin(uv.y * 22.0 + t * 0.7) + 0.02 * sin(uv.y * 51.0 - t * 1.1);
  w.y += 0.045 * sin(uv.x * 19.0 - t * 0.55) + 0.02 * sin(uv.x * 47.0 + t * 0.9);
  float veins = 0.0;
  for (int i = 0; i < 5; i++) {
    float y0 = (float(i) + 0.5) / 5.0 + 0.08 * sin(float(i) * 3.7 + t * 0.4);
    float profile = 1.0 - smoothstep(0.0, 0.018, abs(w.y - y0));
    float fromL = 1.0 - smoothstep(0.0, reach, uv.x);
    float fromR = 1.0 - smoothstep(0.0, reach, 1.0 - uv.x);
    veins = max(veins, profile * max(fromL, fromR));
  }
  for (int i = 0; i < 4; i++) {
    float x0 = (float(i) + 0.5) / 4.0 + 0.08 * sin(float(i) * 2.9 - t * 0.35);
    float profile = 1.0 - smoothstep(0.0, 0.016, abs(w.x - x0));
    float fromB = 1.0 - smoothstep(0.0, reach, uv.y);
    float fromT = 1.0 - smoothstep(0.0, reach, 1.0 - uv.y);
    veins = max(veins, profile * max(fromB, fromT));
  }
  float matte = 1.0 - smoothstep(0.0, reach, edge);
  veins *= mix(0.35, 1.0, matte);
  return clamp(veins * g, 0.0, 1.0);
}

void main() {
  vec3 col = texture(tInput, vUv).rgb;
  if (uHasBloom > 0.5) col += texture(tBloom, vUv).rgb;

  float mask = uHasMask > 0.5 ? texture(tMask, vUv).r : 0.0;
  col *= 1.0 - mask * uStrength;

  float t = uReduceMotion > 0.5 ? 0.0 : uTime;
  float tend = tendrilCoverage(vUv, t, uGrip);
  col *= 1.0 - tend;

  // Silhouette glow — the UV edge that must survive bloom-eat.
  float edge = fwidth(mask) * 6.0;
  float crawl = 0.55 + 0.45 * sin(vUv.x * 70.0 + vUv.y * 48.0 + t * 1.65);
  col += uUvColor * clamp(edge, 0.0, 1.0) * uEdgeIntensity * crawl;

  float tEdge = fwidth(tend) * 8.0;
  col += uUvColor * clamp(tEdge, 0.0, 1.0) * 0.55 * uGrip;

  fragColor = vec4(col, 1.0);
}
