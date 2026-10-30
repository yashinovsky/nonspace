precision highp float;

uniform sampler2D tCurrent;
uniform sampler2D tPrev;
uniform float uDt;
uniform float uDecayScale;
uniform float uOmega;
uniform float uSmearThreshold;
uniform float uSmearStrength;
uniform vec3 uAfterglow;
uniform float uShift;

in vec2 vUv;
out vec4 fragColor;

void main() {
  vec3 current = texture(tCurrent, vUv).rgb;
  vec3 prev = texture(tPrev, vUv).rgb;
  float boost = 1.0 + max(uOmega - uSmearThreshold, 0.0) * uSmearStrength;
  float expn = max(uDt, 0.0) * 60.0 * max(uDecayScale, 0.0) * boost;
  // P7: blue-white flash, blue dies first, trail shifts yellow-green.
  vec3 decay = pow(vec3(0.90, 0.93, 0.78), vec3(expn));
  vec3 faded = prev * decay;
  float energy = max(max(faded.r, faded.g), faded.b);
  vec3 shifted = mix(faded, uAfterglow * energy, uShift);
  fragColor = vec4(max(current, shifted), 1.0);
}
