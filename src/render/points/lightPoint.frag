varying vec2 vUv;
varying vec3 vColor;
varying float vIntensity;

#ifdef USE_LOGARITHMIC_DEPTH_BUFFER
uniform float logDepthBufFC;
varying float vFragDepth;
varying float vIsPerspective;
#endif

void main() {
  float r2 = dot(vUv, vUv);
  if (r2 > 1.0 || vIntensity <= 0.0) discard;
  float g = exp(-r2 * 4.0);
  gl_FragColor = vec4(vColor * (vIntensity * g), 1.0);
#ifdef USE_LOGARITHMIC_DEPTH_BUFFER
  gl_FragDepth = vIsPerspective == 0.0 ? gl_FragCoord.z : log2(max(vFragDepth, 1e-6)) * logDepthBufFC * 0.5;
#endif
}
