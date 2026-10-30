precision highp float;

uniform sampler2D tLow;
uniform sampler2D tHigh;
uniform vec2 uTexelSize;
uniform float uSampleScale;
uniform float uAddHigh;
uniform float uHighGain;

in vec2 vUv;
out vec4 fragColor;

// 9-tap tent upsample (Jimenez / Call of Duty).

vec3 tent(sampler2D tex, vec2 uv) {
  vec2 d = uTexelSize * uSampleScale;
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
  vec3 color = tent(tLow, vUv);
  if (uAddHigh > 0.5) {
    color += texture(tHigh, vUv).rgb * uHighGain;
  }
  fragColor = vec4(color, 1.0);
}
