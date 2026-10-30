precision highp float;

uniform sampler2D tInput;
uniform float uTonemap;
uniform float uExposure;

in vec2 vUv;
out vec4 fragColor;

void main() {
  vec3 c = texture(tInput, vUv).rgb * uExposure;
  if (uTonemap > 0.5) {
    float lum = dot(c, vec3(0.2126, 0.7152, 0.0722));
    vec3 mapped = c / (1.0 + max(lum, 0.0));
    float hot = max(lum - 1.0, 0.0);
    mapped = mix(mapped, vec3(1.0), clamp(hot / 3.0, 0.0, 1.0));
    c = mapped;
  }
  fragColor = vec4(c, 1.0);
}
