const float B[16] = float[](0.,8.,2.,10.,12.,4.,14.,6.,3.,11.,1.,9.,15.,7.,13.,5.);
float bayer4(vec2 frag) {
  vec2 p = mod(floor(frag), 4.0);
  return (B[int(p.x) + int(p.y) * 4] + 0.5) / 16.0;
}
vec3 nearestPalette(vec3 c, vec3 pal[16]) {
  float best = 1e9;
  vec3 pick = pal[0];
  for (int i = 0; i < 16; i++) {
    vec3 d = c - pal[i];
    float dist = dot(d, d);
    if (dist < best) { best = dist; pick = pal[i]; }
  }
  return pick;
}
vec3 ditherQuantize(vec3 lit, vec2 frag, float amount, vec3 pal[16]) {
  return nearestPalette(lit + vec3((bayer4(frag) - 0.5) * amount), pal);
}
