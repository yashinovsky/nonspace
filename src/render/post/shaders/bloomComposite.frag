precision highp float;

uniform sampler2D tBloom;
uniform sampler2D tHalation;
uniform vec2 uBloomTexel;
uniform vec2 uHalationTexel;
uniform float uSampleScale;
uniform float uIntensity;
uniform float uHalationWeight;
uniform vec3 uWarmTint;

in vec2 vUv;
out vec4 fragColor;

vec3 tent(sampler2D tex, vec2 uv, vec2 texel, float scale) {
  vec2 d = texel * scale;
  vec3 s = vec3(0.0);
  s += texture(tex, uv + vec2(-d.x, -d.y)).rgb;
  s += texture(tex, uv + vec2(0.0, -d.y)).rgb * 2.0;
  s += texture(tex, uv + vec2(d.x, -d.y)).rgb;
  s += texture(tex, uv + vec2(-d.x, 0.0)).rgb * 2.0;
  s += texture(tex, uv).rgb * 4.0;
  s += texture(tex, uv + vec2(d.x, 0.0)).rgb * 2.0;
  s += texture(tex, uv + vec2(-d.x, d.y)).rgb;
  s += texture(tex, uv + vec2(0.0, d.y)).rgb * 2.0;
  s += texture(tex, uv + vec2(d.x, d.y)).rgb;
  return s * (1.0 / 16.0);
}

void main() {
  vec3 bloom = tent(tBloom, vUv, uBloomTexel, uSampleScale) * uIntensity;
  // Extra-wide, low-weight, slightly warm-tinted mip (plan §8.5).
  vec3 halo = tent(tHalation, vUv, uHalationTexel, uSampleScale * 2.0);
  fragColor = vec4(bloom + halo * uHalationWeight * uWarmTint, 1.0);
}
