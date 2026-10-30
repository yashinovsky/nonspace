// Black ICE solid → R8 coverage mask (plan §8.3, §8.5). Log-depth matches
// the renderer's logarithmicDepthBuffer so the shard depth-tests against the
// matrix camera even though the mask RT itself has no depth attachment.

out float vFragDepth;

void main() {
  vec4 clip = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  gl_Position = clip;
  vFragDepth = 1.0 + clip.w;
}
