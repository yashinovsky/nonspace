// Hinged grid panels (plan §5.9 / §8.5). Local (x along hinge, y along sheet).
// uFold[i] is 0..π (0° vertical → 180° inverted through the ground plane).

in float aPanel;
in float aShade;

uniform float uFold[8];
uniform vec3 uPalette[8];
uniform float uGain;
uniform float logDepthBufFC;

flat out vec3 vRgb;
out float vFragDepth;

void main() {
  int i = int(clamp(aPanel + 0.5, 0.0, 7.0));
  float a = uFold[i];
  vec3 folded = vec3(position.x, position.y * cos(a), position.y * sin(a));
  float yaw = float(i) * 0.7853981633974483;
  float cy = cos(yaw);
  float sy = sin(yaw);
  vec3 world = vec3(folded.x * cy + folded.z * sy, folded.y, -folded.x * sy + folded.z * cy);
  vec4 clip = projectionMatrix * modelViewMatrix * vec4(world, 1.0);
  gl_Position = clip;
  vFragDepth = 1.0 + clip.w;
  float open = sin(a);
  vRgb = uPalette[0] * (uGain * aShade * (0.22 + 0.78 * open));
}
