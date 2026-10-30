#include common.glsl;
#include pathFetch.glsl;

attribute float aPathStart;
attribute float aPathCount;
attribute float aPathLen;
attribute float aSpeed;

void main() {
  float len = max(aPathLen, 1e-4);
  float t = fract(uTime * aSpeed / len + aPhase);
  vec3 world = sampleTrafficPath(
    int(aPathStart + 0.5),
    int(aPathCount + 0.5),
    len,
    t
  );
  emitPoint(world);
}
