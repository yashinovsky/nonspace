precision highp float;

// Distance to the ribbon (width w) then Gaussian glow of σ, plus vertex dwell (plan §8.5).
// Additive light; log-depth so we match the renderer’s logarithmicDepthBuffer.

flat in vec2 vScreenA;
flat in vec2 vScreenB;
flat in vec3 vRgb;
flat in float vIntensity;
flat in float vHalfWidth;
flat in float vSigma;
flat in float vDwell;
flat in float vDwellSigma;
in float vFragDepth;

uniform float logDepthBufFC;

out vec4 fragColor;

void main() {
  gl_FragDepth = log2(max(vFragDepth, 1.0 + 1e-6)) * logDepthBufFC * 0.5;

  vec2 p = gl_FragCoord.xy;
  vec2 ba = vScreenB - vScreenA;
  float ba2 = dot(ba, ba);
  float h = ba2 > 1e-8 ? clamp(dot(p - vScreenA, ba) / ba2, 0.0, 1.0) : 0.0;
  float dSeg = length(p - vScreenA - ba * h);
  float d = max(dSeg - vHalfWidth, 0.0);

  float sigma = max(vSigma, 0.05);
  float I = vIntensity * exp(-(d * d) / (2.0 * sigma * sigma));

  if (vDwell > 0.0) {
    float dEnd = min(length(p - vScreenA), length(p - vScreenB));
    float sd = max(vDwellSigma, 0.05);
    I += vDwell * exp(-(dEnd * dEnd) / (2.0 * sd * sd));
  }

  if (I < 0.0004) discard;
  fragColor = vec4(vRgb * I, 1.0);
}
