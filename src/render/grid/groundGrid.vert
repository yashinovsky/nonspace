// Fullscreen triangle. The fragment shader ray-intersects y = 0 so the grid
// is infinite and never covers the sky when the far plane clips a huge quad.

void main() {
  gl_Position = vec4(position.xy, 0.0, 1.0);
}
