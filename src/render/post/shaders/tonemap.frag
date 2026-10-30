precision highp float;

uniform sampler2D tInput;
uniform float uExposure;

in vec2 vUv;
out vec4 fragColor;

// Reinhard on luminance + desaturate-to-white above 1.0 (plan §5.3, §8.5).
// Hot beams (intensity 4) pull toward white the way phosphor saturates.
vec3 tonemapReinhardWhite(vec3 c) {
  c *= uExposure;
  float lum = dot(c, vec3(0.2126, 0.7152, 0.0722));
  vec3 mapped = c / (1.0 + max(lum, 0.0));
  float hot = max(lum - 1.0, 0.0);
  return mix(mapped, vec3(1.0), clamp(hot / 3.0, 0.0, 1.0));
}

void main() {
  vec3 c = texture(tInput, vUv).rgb;
  fragColor = vec4(tonemapReinhardWhite(c), 1.0);
}
