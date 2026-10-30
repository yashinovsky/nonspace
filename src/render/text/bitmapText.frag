precision highp float;

uniform sampler2D tAtlas;
uniform float logDepthBufFC;

flat in vec3 vRgb;
flat in float vIntensity;
in vec2 vUv;
in float vFragDepth;

out vec4 fragColor;

void main() {
  gl_FragDepth = log2(max(vFragDepth, 1.0 + 1e-6)) * logDepthBufFC * 0.5;
  float g = texture(tAtlas, vUv).a;
  float I = vIntensity * g;
  if (I < 0.04) discard;
  fragColor = vec4(vRgb * I, 1.0);
}
