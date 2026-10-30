// ICE shell faces (plan §8.5). Log-depth matches the matrix camera.
// Hatch / moiré live in the fragment shader; no hidden-line depth write.

in float aFace;
in vec2 aUv;

out vec3 vObj;
out vec3 vN;
out vec2 vUv;
out float vFace;
out float vFragDepth;

void main() {
  vec4 world = modelMatrix * vec4(position, 1.0);
  vObj = position;
  vN = normalize(mat3(modelMatrix) * normal);
  vUv = aUv;
  vFace = aFace;
  vec4 clip = projectionMatrix * viewMatrix * world;
  gl_Position = clip;
  vFragDepth = 1.0 + clip.w;
}
