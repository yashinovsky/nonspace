precision highp float;

// 14-segment VFD (plan §6.5 / M3.1). Unlit segments draw at uGhost (6%).
uniform float uGhost;
uniform float logDepthBufFC;

flat in vec3 vRgb;
flat in float vIntensity;
flat in float vMask;
flat in float vGhost;
flat in float vMode7;
in vec2 vUv;
in float vFragDepth;

out vec4 fragColor;

float sdSegment(vec2 p, vec2 a, vec2 b) {
  vec2 pa = p - a;
  vec2 ba = b - a;
  float h = clamp(dot(pa, ba) / max(dot(ba, ba), 1e-8), 0.0, 1.0);
  return length(pa - ba * h);
}

void main() {
  gl_FragDepth = log2(max(vFragDepth, 1.0 + 1e-6)) * logDepthBufFC * 0.5;

  // Italic skew, UV origin bottom-left, Y up.
  vec2 p = vUv;
  p.x += (1.0 - p.y) * 0.08;
  p = clamp(p, vec2(0.0), vec2(1.0));

  const float IN = 0.10;
  vec2 A0 = vec2(IN, 1.0 - IN);
  vec2 A1 = vec2(1.0 - IN, 1.0 - IN);
  vec2 D0 = vec2(IN, IN);
  vec2 D1 = vec2(1.0 - IN, IN);
  vec2 M = vec2(0.5, 0.5);
  vec2 F0 = vec2(IN, 1.0 - IN);
  vec2 F1 = vec2(IN, 0.5);
  vec2 E0 = vec2(IN, 0.5);
  vec2 E1 = vec2(IN, IN);
  vec2 B0 = vec2(1.0 - IN, 1.0 - IN);
  vec2 B1 = vec2(1.0 - IN, 0.5);
  vec2 C0 = vec2(1.0 - IN, 0.5);
  vec2 C1 = vec2(1.0 - IN, IN);
  vec2 G0 = vec2(IN, 0.5);
  vec2 G1 = vec2(0.5, 0.5);
  vec2 g0 = vec2(0.5, 0.5);
  vec2 g1 = vec2(1.0 - IN, 0.5);
  vec2 I0 = vec2(0.5, 1.0 - IN);
  vec2 I1 = vec2(0.5, 0.5);
  vec2 L0 = vec2(0.5, 0.5);
  vec2 L1 = vec2(0.5, IN);

  int mask = int(vMask + 0.5);
  float th = 0.045;
  float dLit = 1e4;
  float dGhost = 1e4;

  vec2 segs[28];
  segs[0] = A0; segs[1] = A1;
  segs[2] = B0; segs[3] = B1;
  segs[4] = C0; segs[5] = C1;
  segs[6] = D0; segs[7] = D1;
  segs[8] = E0; segs[9] = E1;
  segs[10] = F0; segs[11] = F1;
  segs[12] = G0; segs[13] = G1;
  segs[14] = g0; segs[15] = g1;
  segs[16] = F0; segs[17] = M; // H
  segs[18] = I0; segs[19] = I1;
  segs[20] = B0; segs[21] = M; // J
  segs[22] = E1; segs[23] = M; // K
  segs[24] = L0; segs[25] = L1;
  segs[26] = C1; segs[27] = M; // M

  int nSeg = vMode7 > 0.5 ? 7 : 14;
  for (int i = 0; i < 14; i++) {
    if (i >= nSeg) break;
    vec2 a = segs[i * 2];
    vec2 b = segs[i * 2 + 1];
    if (vMode7 > 0.5 && i == 6) {
      a = G0;
      b = g1;
    }
    float d = sdSegment(p, a, b) - th;
    bool lit = (mask & (1 << i)) != 0;
    if (vMode7 > 0.5 && i == 6) {
      lit = (mask & ((1 << 6) | (1 << 7))) != 0;
    }
    if (lit) dLit = min(dLit, d);
    else dGhost = min(dGhost, d);
  }

  // Decimal point / colon encoded in bits 14 and 15.
  float dDot = length(p - vec2(0.82, 0.10)) - 0.055;
  if ((mask & (1 << 14)) != 0) dLit = min(dLit, dDot);
  else dGhost = min(dGhost, dDot);
  float dColon = length(p - vec2(0.82, 0.55)) - 0.055;
  if ((mask & (1 << 15)) != 0) dLit = min(dLit, dColon);

  float I = 0.0;
  if (dLit < 0.0) {
    I = vIntensity * (0.55 + 0.45 * smoothstep(-th, -th * 0.2, -dLit));
  } else if (vGhost > 0.5 && dGhost < 0.0) {
    I = vIntensity * uGhost;
  }
  if (I < 0.002) discard;
  fragColor = vec4(vRgb * I, 1.0);
}
