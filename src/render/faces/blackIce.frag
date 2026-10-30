precision highp float;

// Coverage only. Composite multiplies HDR+bloom by (1 - mask * k) so the
// solid is truly black and eats glow. Edge lines are a separate UV material.

uniform float logDepthBufFC;
uniform float uCoverage;

in float vFragDepth;
out vec4 fragColor;

void main() {
  gl_FragDepth = log2(max(vFragDepth, 1.0 + 1e-6)) * logDepthBufFC * 0.5;
  fragColor = vec4(uCoverage, 0.0, 0.0, 1.0);
}
