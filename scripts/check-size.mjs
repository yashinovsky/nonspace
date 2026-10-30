// Fails the build if the default-boot graph exceeds the M0.1 budget
// (plan §10, M0.1 AC: dist/ under 1 MB). Lazy `?lab=` / debug chunks are
// listed but not counted — look-lane routes would otherwise exhaust the
// budget (grid + heraldry leave <1 KB).
import { readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const LIMIT_BYTES = Number(process.env.DIST_LIMIT_BYTES ?? 1024 * 1024);
const dist = new URL('../dist/', import.meta.url).pathname;

/** Lab / debug-only chunks. Default boot never fetches these. */
const LAB =
  /(?:^|\/)(?:lab-|grammar-|sectorWorker-|.+Lab-|DebugGui-|teletext|JackIn|JackOut|CrtCollapse|IceVisuals|IceModel|Shatter|iceFacet|senseNet|straylight|BreachController|PhaseLock|Grip-|NeuralLoad|Trace-|Heat-|Flatline|Breach-|Hud-|BitmapText-|VfdText-|white-|Boot|Title|DeckPanel|Settings|Subtitles|Watcher-|CoreInterior|Core-|softs-|registry-|effects-|Wintermute-|Neuromancer-|Hijack-|Persona-|personaPaths|CoordinateJump|JumpStreak|Kuang-|KuangMaterial-|Dive-|DiveTube-|kuangMath-|kuangSpline-|diveMath-|verticalSlice|tutorialPrompts|chibaScene|construct-|constructScene-|tendril-|turing-|turingScene-|turingField-|kuangGrade-|kuangScene-|trueName-|merge-|credits-|p0-|m1-|m2-|m3-|m4-|m5-|m6-|m7-|SimstimRenderer|Matrix-|Interlude|missions-|companion|Dixie-|barks-|Beach-|BeachRenderer-|enterBeach-|beach-|a11y-|overlay-|assists-|tuning-|reporter-)/;

/** Vite content-hashed JS/CSS (M8.5). */
const HASHED_ASSET = /-[a-zA-Z0-9_-]{8,}\.(?:js|css|woff2?)$/;

/** @param {string} dir @returns {{ path: string, size: number }[]} */
function walk(dir) {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    const st = statSync(path);
    return st.isDirectory() ? walk(path) : [{ path, size: st.size }];
  });
}

const files = walk(dist).sort((a, b) => b.size - a.size);
const total = files.reduce((n, f) => n + f.size, 0);
const boot = files.filter((f) => !LAB.test(relative(dist, f.path)));
const bootTotal = boot.reduce((n, f) => n + f.size, 0);
const kb = (/** @type {number} */ n) => `${(n / 1024).toFixed(1)} KB`;

for (const f of files.slice(0, 8))
  console.log(`  ${kb(f.size).padStart(10)}  ${relative(dist, f.path)}`);
console.log(`dist/ total: ${kb(total)} (labs excluded from budget)`);
console.log(`dist/ boot:  ${kb(bootTotal)} (limit ${kb(LIMIT_BYTES)})`);

const unhashed = files.filter((f) => {
  const rel = relative(dist, f.path).replaceAll('\\', '/');
  if (!rel.startsWith('assets/')) return false;
  return /\.(?:js|css)$/.test(rel) && !HASHED_ASSET.test(rel);
});
if (unhashed.length > 0) {
  for (const f of unhashed) console.error(`  unhashed asset: ${relative(dist, f.path)}`);
  console.error('dist/ assets must use content hashes');
  process.exit(1);
}

if (bootTotal > LIMIT_BYTES) {
  console.error('dist/ exceeds the size budget');
  process.exit(1);
}
