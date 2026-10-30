import type { EventBus, Unsubscribe } from '../../core/events';
import type { AudioEngine } from '../AudioEngine';
import type { DixieVoice } from '../dixieVoice';

/**
 * Map game events (plan §9.1) onto SFX / modem / Dixie even when the matching
 * visuals are still stubs. Flatline plays the timed sequence in recipes/flatline.ts.
 */
export function bindSfxToEvents(
  bus: EventBus,
  engine: AudioEngine,
  dixie?: DixieVoice,
): Unsubscribe {
  const offs: Unsubscribe[] = [
    bus.on('jackIn', () => engine.sfx('jackIn')),
    bus.on('jackOut', (e) => {
      if (e.reason === 'burned') engine.sfx('burned');
      else engine.sfx('jackOut');
    }),
    bus.on('flatline', () => engine.sfx('flatline')),
    bus.on('scanPulse', (e) => engine.sfx('scan', { pos: e.origin })),
    bus.on('iceRekeyTelegraph', () => engine.sfx('rekeyTelegraph')),
    bus.on('iceLayerCracked', () => engine.sfx('shatter')),
    bus.on('simstimFlip', () => engine.sfx('simstimFlip')),
    bus.on('traceChanged', () => engine.sfx('traceTick')),
    bus.on('downloadProgress', (e) => {
      if (e.value <= 0 || e.value >= 1) engine.modem.stop();
      else engine.modem.start();
    }),
    bus.on('dixieSay', (e) => dixie?.bark(e.lineId)),
    bus.on('wintermute', (e) => {
      if (e.action.kind === 'hijack' || e.action.kind === 'freeze') {
        engine.sfx('wintermuteHijack');
      }
    }),
    bus.on('neuromancer', (e) => {
      if (e.action.kind === 'soften') engine.sfx('neuromancerSoften');
    }),
  ];
  return () => {
    for (const off of offs) off();
  };
}

/** Event types this binder listens for (tests / docs). */
export const SFX_BOUND_EVENTS = [
  'jackIn',
  'jackOut',
  'flatline',
  'scanPulse',
  'iceRekeyTelegraph',
  'iceLayerCracked',
  'simstimFlip',
  'traceChanged',
  'downloadProgress',
  'dixieSay',
  'wintermute',
  'neuromancer',
] as const;
