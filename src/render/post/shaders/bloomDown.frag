precision highp float;

uniform sampler2D tInput;
uniform vec2 uTexelSize;
uniform float uKaris;

in vec2 vUv;
out vec4 fragColor;

// 13-tap dual-filter downsample (Jimenez / Call of Duty). Five overlapping
// 4-tap boxes: the center at 0.5 and four corners at 0.125.

vec3 fetch(vec2 uv) {
  return texture(tInput, uv).rgb;
}

float luma(vec3 c) {
  return max(dot(c, vec3(0.2126, 0.7152, 0.0722)), 1e-4);
}

vec3 box4(vec2 uv, vec2 a, vec2 b, vec2 c, vec2 d) {
  vec3 A = fetch(uv + uTexelSize * a);
  vec3 B = fetch(uv + uTexelSize * b);
  vec3 C = fetch(uv + uTexelSize * c);
  vec3 D = fetch(uv + uTexelSize * d);
  if (uKaris < 0.5) {
    return (A + B + C + D) * 0.25;
  }
  float wa = 1.0 / luma(A);
  float wb = 1.0 / luma(B);
  float wc = 1.0 / luma(C);
  float wd = 1.0 / luma(D);
  return (A * wa + B * wb + C * wc + D * wd) / (wa + wb + wc + wd);
}

void main() {
  vec3 center = box4(vUv, vec2(-0.5, -0.5), vec2(0.5, -0.5), vec2(-0.5, 0.5), vec2(0.5, 0.5));
  vec3 nw = box4(vUv, vec2(-1.0, -1.0), vec2(0.0, -1.0), vec2(-1.0, 0.0), vec2(0.0, 0.0));
  vec3 ne = box4(vUv, vec2(0.0, -1.0), vec2(1.0, -1.0), vec2(0.0, 0.0), vec2(1.0, 0.0));
  vec3 sw = box4(vUv, vec2(-1.0, 0.0), vec2(0.0, 0.0), vec2(-1.0, 1.0), vec2(0.0, 1.0));
  vec3 se = box4(vUv, vec2(0.0, 0.0), vec2(1.0, 0.0), vec2(0.0, 1.0), vec2(1.0, 1.0));
  fragColor = vec4(center * 0.5 + (nw + ne + sw + se) * 0.125, 1.0);
}
