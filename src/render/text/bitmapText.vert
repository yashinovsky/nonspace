// Instanced Px437 cell quads in the batch XY plane. `position` is the unit quad (0..1).
in vec3 aOrigin;
in vec2 aSize;
in vec4 aUvRect; // u0 v0 u1 v1
in vec4 aData; // color idx, intensity, pad, pad

uniform vec3 uPalette[8];

flat out vec3 vRgb;
flat out float vIntensity;
out vec2 vUv;
out float vFragDepth;

void main() {
  vec3 pos = aOrigin + vec3(position.x * aSize.x, position.y * aSize.y, 0.0);
  vec4 clip = projectionMatrix * modelViewMatrix * vec4(pos, 1.0);
  gl_Position = clip;
  vFragDepth = 1.0 + clip.w;
  vUv = mix(aUvRect.xy, aUvRect.zw, position.xy);
  int idx = int(clamp(aData.x + 0.5, 0.0, 7.0));
  vRgb = uPalette[idx];
  vIntensity = aData.y;
}
