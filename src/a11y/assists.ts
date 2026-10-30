import type { IceSoftMods } from '../breach/IceModel';
import type { Settings } from '../core/settings';

/**
 * Phase Lock accessibility assists (plan §8.10). Applied at IceModel.step
 * time so a live settings toggle takes effect without rebuilding ICE.
 */

/** Multiply layer `tolRatio` (log units). Wider = easier lock. */
export const WIDER_TOLERANCE_MUL = 1.75;
/** Multiply `rekeyEvery` seconds. Slower = more time on a signature. */
export const SLOWER_REKEY_MUL = 2;

export type PhaseLockAssistSettings = Settings['phaseLock'];

export function iceAssistMods(
  phaseLock: PhaseLockAssistSettings,
): Pick<IceSoftMods, 'tolMul' | 'rekeyMul'> {
  return {
    tolMul: phaseLock.widerTolerance ? WIDER_TOLERANCE_MUL : 1,
    rekeyMul: phaseLock.slowerRekey ? SLOWER_REKEY_MUL : 1,
  };
}

export function mergeIceMods(
  base: IceSoftMods | undefined,
  phaseLock: PhaseLockAssistSettings | undefined,
): IceSoftMods {
  const assists = phaseLock ? iceAssistMods(phaseLock) : { tolMul: 1, rekeyMul: 1 };
  return {
    freezeDrift: base?.freezeDrift,
    feedbackMul: base?.feedbackMul,
    traceMul: base?.traceMul,
    tolMul: (base?.tolMul ?? 1) * (assists.tolMul ?? 1),
    rekeyMul: (base?.rekeyMul ?? 1) * (assists.rekeyMul ?? 1),
  };
}
