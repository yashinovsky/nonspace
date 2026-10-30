import { afterEach, describe, expect, it } from 'vitest';
import {
  corridorBend,
  createWintermute,
  gridBendToWarp,
  MAX_GRID_BEND_POINTS,
} from '../../src/ai/Wintermute';
import { mixMask, resegmentMasks } from '../../src/ai/Hijack';
import {
  countPersonaSegments,
  lissajousOffset,
  PERSONA_RATIO_A,
  PERSONA_RATIO_B,
  personaId,
  personaLineSet,
} from '../../src/ai/Persona';
import { createNeuromancer, softenLineSet, SOFTEN_SUBDIVISIONS } from '../../src/ai/Neuromancer';
import {
  Beam,
  createLineSet,
  getBeamSoften,
  setBeamSoften,
} from '../../src/render/lines/BeamBatch';
import { createPalette } from '../../src/render/palette';
import { bloomRadiusForWintermute } from '../../src/render/post/BloomPass';
import { createMemoryStorage, createSaveStore } from '../../src/core/save';
import { createCollisionWorld } from '../../src/player/Collision';
import { createFlightController } from '../../src/player/FlightController';
import { vfdMask } from '../../src/render/text/VfdText';
import { actionSchema } from '../../src/narrative/schema';
import type { InputFrame } from '../../src/input/Input';
import { SIM_DT } from '../../src/core/loop';
import { warpXZ } from '../../src/render/grid/GroundGrid';

afterEach(() => {
  setBeamSoften(0, 0);
});

function stubFrame(): InputFrame {
  return {
    tick: 1,
    dt: SIM_DT,
    lookX: 0,
    lookY: 0,
    mouseDx: 0,
    mouseDy: 0,
    thrust: 0,
    strafe: 0,
    vertical: 0,
    knobX: 0,
    knobY: 0,
    down: () => false,
    pressed: () => false,
    released: () => false,
    held: () => 0,
    pointerLocked: true,
    gamepadConnected: false,
    capturingText: false,
    textValue: '',
    textInserted: '',
    textBackspace: 0,
    textEnter: false,
    textEscape: false,
  };
}

function host() {
  const palette = createPalette();
  const persist = { decayScale: 1 };
  const ice = {
    frozen: false,
    setFrozen(on: boolean) {
      ice.frozen = on;
    },
  };
  const warp: Array<{ x: number; z: number; radius: number; strength: number }> = [];
  const printed: string[] = [];
  const hijacked: Array<string | null> = [];
  let phones = 0;
  const renderer = {
    exposure: 1,
    bloomRadius: undefined as number | undefined,
    chain: {
      getPass() {
        return persist;
      },
    },
  };
  const save = createSaveStore({ storage: createMemoryStorage() });
  save.load();
  const wm = createWintermute({
    palette,
    renderer,
    save,
    ice,
    grid: {
      setWarp(points) {
        warp.splice(0, warp.length, ...points);
      },
    },
    hud: {
      print(text) {
        printed.push(text);
      },
      hijack(text) {
        hijacked.push(text);
      },
    },
    phones: {
      unlock() {},
      start() {
        phones += 1;
      },
      stop() {
        phones = 0;
      },
      sounding() {
        return phones > 0;
      },
      get playing() {
        return phones > 0;
      },
      dispose() {},
    },
    persona: {
      setWho() {},
    },
  });
  return {
    palette,
    persist,
    ice,
    warp,
    printed,
    hijacked,
    renderer,
    save,
    wm,
    phones: () => phones,
  };
}

describe('M7.3 Wintermute', () => {
  it('overexpose doubles bloom then restores with no leftover', () => {
    const h = host();
    const rgb = { r: 0, g: 0, b: 0 };
    h.palette.get(Beam.GRID, rgb);
    const r0 = rgb.r;
    h.wm.apply({ kind: 'overexpose', amount: 1 });
    expect(h.wm.overexpose).toBe(1);
    expect(h.renderer.exposure).toBe(2);
    expect(h.renderer.bloomRadius).toBe(bloomRadiusForWintermute(1));
    expect(h.renderer.bloomRadius).toBe(2);
    h.palette.get(Beam.GRID, rgb);
    expect(rgb.r).toBeGreaterThan(r0);
    h.wm.apply({ kind: 'overexpose', amount: 0 });
    expect(h.wm.overexpose).toBe(0);
    expect(h.renderer.exposure).toBe(1);
    expect(h.renderer.bloomRadius).toBeUndefined();
    h.palette.get(Beam.GRID, rgb);
    expect(rgb.r).toBeCloseTo(r0, 5);
  });

  it('ramps overexpose over seconds then lands', () => {
    const h = host();
    h.wm.apply({ kind: 'overexpose', amount: 1, seconds: 1 });
    h.wm.update(0.25);
    expect(h.wm.overexpose).toBeCloseTo(0.25, 5);
    h.wm.update(0.75);
    expect(h.wm.overexpose).toBe(1);
    expect(h.renderer.bloomRadius).toBe(2);
  });

  it('freeze holds ice and phosphor decay, then releases', () => {
    const h = host();
    h.wm.apply({ kind: 'freeze', on: true });
    expect(h.wm.frozen).toBe(true);
    expect(h.ice.frozen).toBe(true);
    expect(h.persist.decayScale).toBe(0);
    h.wm.apply({ kind: 'freeze', on: false });
    expect(h.ice.frozen).toBe(false);
    expect(h.persist.decayScale).toBe(1);
  });

  it('gridBend writes four warp points and empty restores zero strength', () => {
    const h = host();
    const pts = corridorBend(0.8);
    expect(pts).toHaveLength(MAX_GRID_BEND_POINTS);
    h.wm.apply({ kind: 'gridBend', points: pts });
    expect(h.wm.warpOn).toBe(true);
    expect(h.warp).toHaveLength(4);
    expect(h.warp.some((p) => p.strength > 0)).toBe(true);
    const bent = warpXZ(80, 0, gridBendToWarp(pts));
    expect(Math.hypot(bent.x - 80, bent.z - 0)).toBeGreaterThan(1);
    h.wm.apply({ kind: 'gridBend', points: [] });
    expect(h.wm.warpOn).toBe(false);
    expect(h.warp.every((p) => p.strength === 0)).toBe(true);
    const flat = warpXZ(80, 0, h.warp);
    expect(flat.x).toBeCloseTo(80, 8);
    expect(flat.z).toBeCloseTo(0, 8);
  });

  it('hijack, persona, phones and bargain are reversible', () => {
    const h = host();
    h.wm.apply({ kind: 'hijack', text: 'WINTERMUTE> I NEED A RIDER' });
    expect(h.wm.hijackText).toBe('WINTERMUTE> I NEED A RIDER');
    expect(h.printed.at(-1)).toContain('WINTERMUTE');
    expect(h.hijacked.at(-1)).toBe('WINTERMUTE> I NEED A RIDER');
    h.wm.apply({ kind: 'persona', who: 'finn', on: true });
    expect(h.wm.personaWho).toBe('finn');
    h.wm.apply({ kind: 'ringPhones', on: true });
    expect(h.wm.phonesOn).toBe(true);
    expect(h.phones()).toBeGreaterThan(0);
    h.wm.apply({ kind: 'bargain', offerId: 'opens-the-door', debt: 2 });
    expect(h.save.data.campaign.wintermuteDebt).toBe(2);
    h.wm.reset();
    expect(h.wm.hijackText).toBe('');
    expect(h.hijacked.at(-1)).toBeNull();
    expect(h.wm.personaWho).toBeNull();
    expect(h.wm.phonesOn).toBe(false);
    expect(h.phones()).toBe(0);
    expect(h.renderer.bloomRadius).toBeUndefined();
  });
});

describe('M7.3 Neuromancer', () => {
  it('soften warms the palette and subdivides, then restores', () => {
    const palette = createPalette();
    const rgb = { r: 0, g: 0, b: 0 };
    palette.get(Beam.GRID, rgb);
    const r0 = rgb.r;
    const g0 = rgb.g;
    const nm = createNeuromancer({ palette });
    nm.apply({ kind: 'soften', amount: 1 });
    expect(nm.soften).toBe(1);
    expect(getBeamSoften()).toBe(1);
    palette.get(Beam.GRID, rgb);
    expect(rgb.r).toBeGreaterThan(r0);
    expect(rgb.g).not.toBeCloseTo(g0, 3);
    const set = createLineSet(2, { width: true, flags: true });
    const soft = softenLineSet(set, 1);
    expect(soft.color.length).toBe(2 * SOFTEN_SUBDIVISIONS);
    expect(softenLineSet(set, 0)).toBe(set);
    nm.apply({ kind: 'soften', amount: 0 });
    expect(nm.soften).toBe(0);
    expect(getBeamSoften()).toBe(0);
    palette.get(Beam.GRID, rgb);
    expect(rgb.r).toBeCloseTo(r0, 5);
    expect(rgb.g).toBeCloseTo(g0, 5);
  });

  it('pull drifts the craft and blocks jack-out until cleared', () => {
    const palette = createPalette();
    const flight = createFlightController({ collision: createCollisionWorld() });
    flight.setPose({ x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0 });
    const nm = createNeuromancer({ palette, flight });
    nm.apply({ kind: 'pull', target: { x: 0, y: 0, z: -40 }, strength: 80 });
    expect(nm.jackOutBlocked).toBe(true);
    expect(flight.jackOutBlocked).toBe(true);
    flight.step(stubFrame(), 0.25);
    expect(flight.pose.z).toBeLessThan(0);
    nm.apply({ kind: 'pull', target: null, strength: 0 });
    expect(flight.jackOutBlocked).toBe(false);
    expect(nm.pullStrength).toBe(0);
  });

  it('beach queues forceMode', () => {
    const palette = createPalette();
    let beach = 0;
    const nm = createNeuromancer({ palette, forceBeach: () => beach++ });
    nm.apply({ kind: 'beach' });
    expect(nm.beachQueued).toBe(true);
    expect(beach).toBe(1);
    nm.reset();
    expect(nm.beachQueued).toBe(false);
  });
});

describe('M7.3 hijack masks', () => {
  it('mixes 14-seg bits from the source glyph into the target', () => {
    const from = vfdMask('A', 14);
    const to = vfdMask('B', 14);
    expect(mixMask(from, to, 0)).toBe(from);
    expect(mixMask(from, to, 1)).toBe(to);
    const mid = mixMask(from, to, 0.5, 3);
    expect(mid === from || mid === to || (mid !== from && mid !== to)).toBe(true);
    const masks = resegmentMasks('HI', 'WM', 1);
    expect(masks[0]).toBe(vfdMask('W', 14));
    expect(masks[1]).toBe(vfdMask('M', 14));
  });
});

describe('M7.3 persona', () => {
  it('is a white ICE polyline with a 3.04:2 Lissajous wobble', () => {
    expect(personaId('nobody')).toBe('finn');
    expect(countPersonaSegments('finn')).toBeGreaterThan(12);
    expect(PERSONA_RATIO_A).toBeCloseTo(3.04, 5);
    expect(PERSONA_RATIO_B).toBe(2);
    const a = lissajousOffset(0.4, 3);
    const b = lissajousOffset(0.9, 3);
    expect(Math.hypot(a.x - b.x, a.y - b.y)).toBeGreaterThan(0.01);
    const set = personaLineSet('finn');
    expect(set.color.length).toBe(countPersonaSegments('finn'));
    expect(set.color[0]).toBe(Beam.ICE);
    expect(set.flags![0]! & 4).toBeTruthy();
  });
});

describe('M7.3 mission actions', () => {
  it('rejects more than four grid-bend points', () => {
    expect(() =>
      actionSchema.parse({
        a: 'wintermute',
        action: {
          kind: 'gridBend',
          points: [
            { x: 0, z: 0, strength: 1 },
            { x: 1, z: 0, strength: 1 },
            { x: 2, z: 0, strength: 1 },
            { x: 3, z: 0, strength: 1 },
            { x: 4, z: 0, strength: 1 },
          ],
        },
      }),
    ).toThrow();
  });
});
