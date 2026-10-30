precision highp float;

uniform sampler2D tLow;
uniform sampler2D tHigh;
uniform sampler2D tHalation;
uniform vec2 uTexelSize;
uniform vec2 uHalationTexel;
uniform float uSampleScale;
uniform float uAddHigh;
uniform float uHighGain;
uniform float uIntensity;
uniform float uHalationWeight;
uniform vec3 uWarmTint;

in vec2 vUv;
out vec4 fragColor;

// 9-tap tent (Jimenez / CoD). Composite path also uses tent on the extra-wide
// warm mip at uSampleScale * 2.0.
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
  vec3 color = tent(tLow, vUv, uTexelSize, uSampleScale);
  if (uAddHigh > 0.5) color += texture(tHigh, vUv).rgb * uHighGain;
  if (uHalationWeight > 0.0) {
    vec3 halo = tent(tHalation, vUv, uHalationTexel, uSampleScale * 2.0);
    color = color * uIntensity + halo * uHalationWeight * uWarmTint;
  }
  fragColor = vec4(color, 1.0);
}
