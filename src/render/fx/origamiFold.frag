precision highp float;

flat in vec3 vRgb;
in float vFragDepth;
uniform float logDepthBufFC;
out vec4 fragColor;

void main() {
  gl_FragDepth = log2(max(vFragDepth, 1.0 + 1e-6)) * logDepthBufFC * 0.5;
  if (dot(vRgb, vec3(1.0)) < 0.0008) discard;
  fragColor = vec4(vRgb, 1.0);
}
