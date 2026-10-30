// Body of the simstim material (plan §8.5). Wrapped by ShaderMaterial with
// Three log-depth chunks. Face normal from screen-space derivatives; 16-color
// palette + 4×4 Bayer ordered dither.

float bayer4(vec2 frag) {
  vec2 p = mod(floor(frag), 4.0);
  float x = p.x;
  float y = p.y;
  float v = 0.0;
  if (y < 0.5) {
    if (x < 0.5) v = 0.0;
    else if (x < 1.5) v = 8.0;
    else if (x < 2.5) v = 2.0;
    else v = 10.0;
  } else if (y < 1.5) {
    if (x < 0.5) v = 12.0;
    else if (x < 1.5) v = 4.0;
    else if (x < 2.5) v = 14.0;
    else v = 6.0;
  } else if (y < 2.5) {
    if (x < 0.5) v = 3.0;
    else if (x < 1.5) v = 11.0;
    else if (x < 2.5) v = 1.0;
    else v = 9.0;
  } else {
    if (x < 0.5) v = 15.0;
    else if (x < 1.5) v = 7.0;
    else if (x < 2.5) v = 13.0;
    else v = 5.0;
  }
  return (v + 0.5) / 16.0;
}

vec3 nearestPalette(vec3 c, vec3 pal[16]) {
  float best = 1e9;
  vec3 pick = pal[0];
  for (int i = 0; i < 16; i++) {
    vec3 d = c - pal[i];
    float dist = dot(d, d);
    if (dist < best) {
      best = dist;
      pick = pal[i];
    }
  }
  return pick;
}

vec3 ditherQuantize(vec3 lit, vec2 frag, float amount, vec3 pal[16]) {
  float t = (bayer4(frag) - 0.5) * amount;
  return nearestPalette(lit + vec3(t), pal);
}
