import type { GameEvent, GameEventType } from '../core/events';
import type { Vec3 } from '../core/math/vec3';
import type { MissionDef, Trigger } from './schema';

/**
 * Compiled trigger trees (plan §9.5). Nodes are a flat array so evaluation
 * doesn't allocate; `event` nodes latch for the rest of the run so `all`/`any`
 * can mix an event with a level condition (near, flag, clock).
 */

export type TriggerNode =
  | { kind: 'time'; s: number }
  | { kind: 'meatTime'; s: number }
  | { kind: 'event'; type: GameEventType; where?: ReadonlyArray<readonly [string, unknown]> }
  | { kind: 'near'; landmark: string; radiusSq: number }
  | { kind: 'flag'; name: string }
  | { kind: 'all'; of: readonly number[] }
  | { kind: 'any'; of: readonly number[] };

export interface CompiledMission {
  readonly nodes: TriggerNode[];
  /** Indices of `event` nodes, for latching without walking the whole tree. */
  readonly eventNodes: readonly number[];
  readonly objectiveWhen: readonly number[];
  readonly objectiveComplete: readonly number[];
  readonly timelineAt: readonly number[];
  readonly failAt: readonly number[];
  readonly checkpointAt: readonly number[];
}

/** Mutable world the interpreter reads. Owned by the runner; not allocated per eval. */
export interface TriggerWorld {
  time: number;
  meatTime: number;
  flags: Record<string, boolean>;
  hasPos: boolean;
  posX: number;
  posY: number;
  posZ: number;
  landmarks: Map<string, Vec3>;
}

export function compileTrigger(t: Trigger, nodes: TriggerNode[], eventNodes: number[]): number {
  switch (t.t) {
    case 'time':
      nodes.push({ kind: 'time', s: t.s });
      break;
    case 'meatTime':
      nodes.push({ kind: 'meatTime', s: t.s });
      break;
    case 'event': {
      const where = t.where ? Object.entries(t.where) : undefined;
      nodes.push({ kind: 'event', type: t.type, where });
      eventNodes.push(nodes.length - 1);
      break;
    }
    case 'near':
      nodes.push({ kind: 'near', landmark: t.landmark, radiusSq: t.radius * t.radius });
      break;
    case 'flag':
      nodes.push({ kind: 'flag', name: t.name });
      break;
    case 'all':
    case 'any': {
      const of = t.of.map((child) => compileTrigger(child, nodes, eventNodes));
      nodes.push({ kind: t.t, of });
      break;
    }
  }
  return nodes.length - 1;
}

export function compileMission(def: MissionDef): CompiledMission {
  const nodes: TriggerNode[] = [];
  const eventNodes: number[] = [];
  const add = (t: Trigger): number => compileTrigger(t, nodes, eventNodes);
  return {
    nodes,
    eventNodes,
    objectiveWhen: def.objectives.map((o) => add(o.when)),
    objectiveComplete: def.objectives.map((o) => add(o.complete)),
    timelineAt: def.timeline.map((row) => add(row.at)),
    failAt: def.fail.map(add),
    checkpointAt: def.checkpoints.map((c) => add(c.at)),
  };
}

export function eventMatches(
  event: GameEvent,
  type: GameEventType,
  where?: ReadonlyArray<readonly [string, unknown]>,
): boolean {
  if (event.type !== type) return false;
  if (!where) return true;
  const rec = event as unknown as Record<string, unknown>;
  for (let i = 0; i < where.length; i++) {
    const pair = where[i]!;
    if (rec[pair[0]] !== pair[1]) return false;
  }
  return true;
}

/** Latch matching event nodes. Returns true if any node newly latched. */
export function latchEvent(
  nodes: readonly TriggerNode[],
  eventNodes: readonly number[],
  event: GameEvent,
  latched: Uint8Array,
): boolean {
  let newly = false;
  for (let i = 0; i < eventNodes.length; i++) {
    const idx = eventNodes[i]!;
    if (latched[idx]) continue;
    const node = nodes[idx]!;
    if (node.kind !== 'event') continue;
    if (!eventMatches(event, node.type, node.where)) continue;
    latched[idx] = 1;
    newly = true;
  }
  return newly;
}

export function evalTrigger(
  nodes: readonly TriggerNode[],
  root: number,
  world: TriggerWorld,
  latched: Uint8Array,
): boolean {
  const node = nodes[root]!;
  switch (node.kind) {
    case 'time':
      return world.time + 1e-9 >= node.s;
    case 'meatTime':
      return world.meatTime + 1e-9 >= node.s;
    case 'event':
      return latched[root] === 1;
    case 'flag':
      return world.flags[node.name] === true;
    case 'near': {
      if (!world.hasPos) return false;
      const lm = world.landmarks.get(node.landmark);
      if (!lm) return false;
      const dx = world.posX - lm.x;
      const dy = world.posY - lm.y;
      const dz = world.posZ - lm.z;
      return dx * dx + dy * dy + dz * dz <= node.radiusSq;
    }
    case 'all': {
      for (let i = 0; i < node.of.length; i++) {
        if (!evalTrigger(nodes, node.of[i]!, world, latched)) return false;
      }
      return true;
    }
    case 'any': {
      for (let i = 0; i < node.of.length; i++) {
        if (evalTrigger(nodes, node.of[i]!, world, latched)) return true;
      }
      return false;
    }
  }
}

/**
 * Walk a trigger and force the world into a state that makes it true. Used by
 * the `?checkpoint=` debug seek when no captured snapshot exists yet. Event
 * children are returned so the runner can emit them on the bus.
 */
export function collectSeek(
  trigger: Trigger,
  world: TriggerWorld,
  events: Array<{ type: GameEventType; where?: Record<string, unknown> }>,
): void {
  switch (trigger.t) {
    case 'time':
      if (world.time < trigger.s) world.time = trigger.s;
      break;
    case 'meatTime':
      if (world.meatTime < trigger.s) world.meatTime = trigger.s;
      break;
    case 'flag':
      world.flags[trigger.name] = true;
      break;
    case 'near': {
      const lm = world.landmarks.get(trigger.landmark) ?? { x: 0, y: 0, z: 0 };
      if (!world.landmarks.has(trigger.landmark)) world.landmarks.set(trigger.landmark, lm);
      world.posX = lm.x;
      world.posY = lm.y;
      world.posZ = lm.z;
      world.hasPos = true;
      break;
    }
    case 'event':
      events.push({ type: trigger.type, where: trigger.where });
      break;
    case 'all':
      for (const child of trigger.of) collectSeek(child, world, events);
      break;
    case 'any':
      if (trigger.of[0]) collectSeek(trigger.of[0], world, events);
      break;
  }
}
