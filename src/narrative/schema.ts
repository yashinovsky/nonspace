import { z } from 'zod';
import type { NeuromancerAction } from '../ai/Neuromancer';
import { MAX_GRID_BEND_POINTS, type WintermuteAction } from '../ai/Wintermute';
import { MODE_IDS, type ModeId } from '../app/ModeStack';
import type { IceLayerDef } from '../breach/IceModel';
import { GAME_EVENT_TYPES, type GameEvent } from '../core/events';
import type { Vec3 } from '../core/math/vec3';
import type { MatrixCoord } from '../world/coords';

/* ------------------------------------------------------------------ types */
/* Mission contract (plan §9.5). The schemas below are typed against these. */

export interface MissionDef {
  id: string;
  act: 1 | 2 | 3 | 4 | 5;
  title: string;
  /** Teletext interlude before the run. */
  briefing: { ink: string; knot: string };
  debrief: { ink: string; knot: string };
  start: { coords: MatrixCoord; jackInSequence: 'full' | 'short' };
  softsAvailable: string[];
  /** Landmarks that must be loaded. */
  landmarks: string[];
  targets: Array<{
    id: string;
    landmark: string;
    ice: string;
    core: { seed: number; strata: number; targetRecord: string };
  }>;
  objectives: Array<{
    id: string;
    text: string;
    when: Trigger;
    complete: Trigger;
    optional?: boolean;
  }>;
  simstim?: {
    timeline: string;
    gates: Array<{
      id: string;
      iceNode: string;
      tMeat: number;
      early: number;
      late: number;
      onEarly: Action[];
      onLate: Action[];
    }>;
  };
  /** Scripted events. */
  timeline: Array<{ at: Trigger; do: Action[] }>;
  fail: Trigger[];
  checkpoints: Array<{ id: string; at: Trigger }>;
}

export type Trigger =
  | { t: 'time'; s: number }
  | { t: 'meatTime'; s: number }
  | { t: 'event'; type: GameEvent['type']; where?: Record<string, unknown> }
  | { t: 'near'; landmark: string; radius: number }
  | { t: 'all' | 'any'; of: Trigger[] }
  | { t: 'flag'; name: string };

export type Action =
  | { a: 'say'; who: 'dixie' | 'molly' | 'wintermute' | 'system'; line: string }
  | { a: 'ink'; knot: string }
  | { a: 'objective'; id: string; state: 'active' | 'done' | 'failed' }
  | { a: 'setFlag'; name: string; value: boolean }
  | { a: 'iceMod'; ice: string; patch: Partial<IceLayerDef> }
  | { a: 'wintermute'; action: WintermuteAction }
  | { a: 'neuromancer'; action: NeuromancerAction }
  | { a: 'forceMode'; mode: ModeId }
  | { a: 'music'; state: string }
  | { a: 'sfx'; id: string };

/* ---------------------------------------------------------------- schemas */

const id = z.string().min(1);
const nonNeg = z.number().finite().nonnegative();

export const vec3Schema: z.ZodType<Vec3> = z.strictObject({
  x: z.number().finite(),
  y: z.number().finite(),
  z: z.number().finite(),
});

export const matrixCoordSchema: z.ZodType<MatrixCoord> = z.strictObject({
  region: z.string().regex(/^[A-Z]{3,4}$/, 'region must be a 3-4 letter code like BAMA'),
  x: nonNeg,
  z: nonNeg,
  y: z.number().finite(),
});

const ratio = z.tuple([z.number().int().positive(), z.number().int().positive()]);

export const iceLayerDefSchema = z.strictObject({
  ratios: z.array(ratio).min(1),
  tolRatio: z.number().positive(),
  phaseDrift: z.number().finite(),
  rekeyEvery: z.tuple([nonNeg, nonNeg]).optional(),
  telegraph: nonNeg,
  lockTime: z.number().positive(),
  traceRate: nonNeg,
  feedbackDps: nonNeg,
  grip: z.strictObject({ neuralThreshold: nonNeg, seconds: z.number().positive() }).optional(),
});

export const wintermuteActionSchema: z.ZodType<WintermuteAction> = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('hijack'), text: z.string() }),
  z.strictObject({
    kind: z.literal('overexpose'),
    amount: z.number().min(0).max(1),
    seconds: nonNeg.optional(),
  }),
  z.strictObject({ kind: z.literal('freeze'), on: z.boolean() }),
  z.strictObject({
    kind: z.literal('gridBend'),
    points: z
      .array(z.strictObject({ x: z.number(), z: z.number(), strength: z.number() }))
      .max(MAX_GRID_BEND_POINTS),
  }),
  z.strictObject({ kind: z.literal('persona'), who: id, on: z.boolean() }),
  z.strictObject({ kind: z.literal('ringPhones'), on: z.boolean() }),
  z.strictObject({ kind: z.literal('bargain'), offerId: id, debt: nonNeg }),
]);

export const neuromancerActionSchema: z.ZodType<NeuromancerAction> = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('soften'), amount: z.number().min(0).max(1) }),
  z.strictObject({
    kind: z.literal('pull'),
    target: vec3Schema.nullable(),
    strength: nonNeg,
  }),
  z.strictObject({ kind: z.literal('beach') }),
]);

export const triggerSchema: z.ZodType<Trigger> = z.lazy(() =>
  z.discriminatedUnion('t', [
    z.strictObject({ t: z.literal('time'), s: nonNeg }),
    z.strictObject({ t: z.literal('meatTime'), s: nonNeg }),
    z.strictObject({
      t: z.literal('event'),
      type: z.enum(GAME_EVENT_TYPES),
      where: z.record(z.string(), z.unknown()).optional(),
    }),
    z.strictObject({ t: z.literal('near'), landmark: id, radius: z.number().positive() }),
    z.strictObject({ t: z.enum(['all', 'any']), of: z.array(triggerSchema).min(1) }),
    z.strictObject({ t: z.literal('flag'), name: id }),
  ]),
);

export const actionSchema: z.ZodType<Action> = z.discriminatedUnion('a', [
  z.strictObject({
    a: z.literal('say'),
    who: z.enum(['dixie', 'molly', 'wintermute', 'system']),
    line: id,
  }),
  z.strictObject({ a: z.literal('ink'), knot: id }),
  z.strictObject({ a: z.literal('objective'), id, state: z.enum(['active', 'done', 'failed']) }),
  z.strictObject({ a: z.literal('setFlag'), name: id, value: z.boolean() }),
  z.strictObject({ a: z.literal('iceMod'), ice: id, patch: iceLayerDefSchema.partial() }),
  z.strictObject({ a: z.literal('wintermute'), action: wintermuteActionSchema }),
  z.strictObject({ a: z.literal('neuromancer'), action: neuromancerActionSchema }),
  z.strictObject({ a: z.literal('forceMode'), mode: z.enum(MODE_IDS) }),
  z.strictObject({ a: z.literal('music'), state: id }),
  z.strictObject({ a: z.literal('sfx'), id }),
]);

const inkRef = z.strictObject({ ink: id, knot: id });

export const missionDefSchema: z.ZodType<MissionDef> = z.strictObject({
  id,
  act: z.union([z.literal(1), z.literal(2), z.literal(3), z.literal(4), z.literal(5)]),
  title: z.string().min(1),
  briefing: inkRef,
  debrief: inkRef,
  start: z.strictObject({
    coords: matrixCoordSchema,
    jackInSequence: z.enum(['full', 'short']),
  }),
  softsAvailable: z.array(id),
  landmarks: z.array(id),
  targets: z.array(
    z.strictObject({
      id,
      landmark: id,
      ice: id,
      core: z.strictObject({
        seed: z.number().int(),
        strata: z.number().int().positive(),
        targetRecord: id,
      }),
    }),
  ),
  objectives: z.array(
    z.strictObject({
      id,
      text: z.string().min(1),
      when: triggerSchema,
      complete: triggerSchema,
      optional: z.boolean().optional(),
    }),
  ),
  simstim: z
    .strictObject({
      timeline: id,
      gates: z.array(
        z.strictObject({
          id,
          iceNode: id,
          tMeat: nonNeg,
          early: nonNeg,
          late: nonNeg,
          onEarly: z.array(actionSchema),
          onLate: z.array(actionSchema),
        }),
      ),
    })
    .optional(),
  timeline: z.array(z.strictObject({ at: triggerSchema, do: z.array(actionSchema) })),
  fail: z.array(triggerSchema),
  checkpoints: z.array(z.strictObject({ id, at: triggerSchema })),
});

// Compile-time check that the partial-able ICE layer schema matches the contract both ways.
type MutuallyAssignable<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false;
const _iceLayerSchemaMatches: MutuallyAssignable<
  z.infer<typeof iceLayerDefSchema>,
  IceLayerDef
> = true;
void _iceLayerSchemaMatches;

export class MissionValidationError extends Error {
  constructor(
    readonly missionId: string,
    readonly issues: z.core.$ZodIssue[],
    pretty: string,
  ) {
    super(`Invalid mission "${missionId}":\n${pretty}`);
    this.name = 'MissionValidationError';
  }
}

/** Validates unknown data as a MissionDef; throws MissionValidationError with readable paths. */
export function parseMission(data: unknown): MissionDef {
  const result = missionDefSchema.safeParse(data);
  if (result.success) return result.data;
  const missionId =
    typeof data === 'object' && data !== null && typeof (data as { id?: unknown }).id === 'string'
      ? (data as { id: string }).id
      : '<unknown>';
  throw new MissionValidationError(missionId, result.error.issues, z.prettifyError(result.error));
}
