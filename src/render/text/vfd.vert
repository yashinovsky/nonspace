// Instanced VFD cell quads in the batch XY plane. `position` is the unit quad (0..1).
in vec3 aOrigin;
in vec2 aSize;
in vec4 aData; // color idx, intensity, mask (uint bits as float), flags

uniform vec3 uPalette[8];

flat out vec3 vRgb;
flat out float vIntensity;
flat out float vMask;
flat out float vGhost;
flat out float vMode7;
out vec2 vUv;
out float vFragDepth;

void main() {
  vec3 pos = aOrigin + vec3(position.x * aSize.x, position.y * aSize.y, 0.0);
  vec4 clip = projectionMatrix * modelViewMatrix * vec4(pos, 1.0);
  gl_Position = clip;
  vFragDepth = 1.0 + clip.w;
  vUv = position.xy;
  int idx = int(clamp(aData.x + 0.5, 0.0, 7.0));
  vRgb = uPalette[idx];
  vIntensity = aData.y;
  vMask = aData.z;
  float flags = aData.w;
  vGhost = mod(flags, 2.0) >= 0.5 ? 1.0 : 0.0;
  vMode7 = flags >= 1.5 ? 1.0 : 0.0;
}
