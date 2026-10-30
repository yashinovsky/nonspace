uniform sampler2D uPathTex;
uniform vec2 uPathSize;

vec4 pathTexel(int index) {
  float w = uPathSize.x;
  float fi = float(index);
  vec2 uv = vec2(mod(fi, w) + 0.5, floor(fi / w) + 0.5) / uPathSize;
  return texture2D(uPathTex, uv);
}

// Arc-length sample. `t` is already in [0, 1). Joints are C0 (no position jump).
vec3 sampleTrafficPath(int start, int count, float len, float t) {
  if (count < 2 || len < 1e-6) {
    return pathTexel(start).xyz;
  }
  float s = t * len;
  int lo = start;
  int hi = start + count - 1;
  for (int i = 0; i < 12; i++) {
    if (hi - lo <= 1) break;
    int mid = (lo + hi) / 2;
    if (pathTexel(mid).w <= s) lo = mid;
    else hi = mid;
  }
  vec4 a = pathTexel(lo);
  int next = lo + 1;
  if (next > start + count - 1) next = start + count - 1;
  vec4 b = pathTexel(next);
  float span = max(b.w - a.w, 1e-8);
  float u = clamp((s - a.w) / span, 0.0, 1.0);
  return mix(a.xyz, b.xyz, u);
}
