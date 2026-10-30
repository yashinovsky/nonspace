precision highp float;

// Silver-white, low-contrast phosphene dots. Additive. Reduce flashing
// clamps uAmp on the CPU so this stays a localized boil, not a strobe.

in float vI;
out vec4 fragColor;

void main() {
  vec2 p = gl_PointCoord * 2.0 - 1.0;
  float r2 = dot(p, p);
  if (r2 > 1.0 || vI <= 0.0005) discard;
  float g = exp(-r2 * 3.2);
  vec3 silver = vec3(0.76, 0.80, 0.88);
  fragColor = vec4(silver * (vI * g), 1.0);
}
