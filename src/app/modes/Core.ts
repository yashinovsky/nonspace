import type { CoreInterior, CoreOutcome } from '../../breach/CoreInterior';
import type { Hud } from '../../hud/Hud';
import type { InputFrame } from '../../input/Input';
import type { FlightController } from '../../player/FlightController';
import type { Mode, ModeContext } from '../ModeStack';

export interface CoreMode extends Mode {
  readonly interior: CoreInterior;
}

export interface CoreModeOptions {
  interior: CoreInterior;
  hud?: Hud;
  flight?: FlightController;
  reduceMotion?: () => boolean;
  onDownloaded?: (targetId: string) => void;
  onJackOut?: () => void;
  onRouteOut?: () => void;
  onRouteDone?: () => void;
  onBurned?: () => void;
}

/**
 * Data-interior mode (plan §3.2 CORE / EXFIL). Flight stays live so the
 * cowboy can find the target constellation and later route out through the
 * breach hole. Download is hold-`E`. After the take: hold-`J` jacks out,
 * `engage` starts the route-out re-freeze.
 */
export function createCoreMode(opts: CoreModeOptions): CoreMode {
  const { interior } = opts;

  const paintHud = (): void => {
    const hud = opts.hud;
    if (!hud) return;
    hud.setNeural(0);
    hud.setTrace(interior.trace.value);
    hud.setFlatline(false);
    hud.setLock(null);
    hud.setGrip(null);
    if (interior.phase === 'download') hud.setMode('CORE');
    else if (interior.phase === 'routeOut') hud.setMode('EXFIL');
    else if (interior.phase === 'jackOut') hud.setMode('JACK');
    else hud.setMode('CORE');
    const flight = opts.flight;
    if (flight) hud.setSpeed(flight.telemetry.speed);
  };

  const handleOutcome = (out: CoreOutcome): void => {
    if (out.kind === 'downloaded') {
      opts.hud?.print(`GOT ${out.targetId}`);
      opts.onDownloaded?.(out.targetId);
    } else if (out.kind === 'jackOut') {
      opts.onJackOut?.();
    } else if (out.kind === 'routeOut') {
      opts.hud?.print('ROUTE OUT');
      opts.onRouteOut?.();
    } else if (out.kind === 'routeDone') {
      opts.onRouteDone?.();
    } else if (out.kind === 'burned') {
      opts.onBurned?.();
    }
  };

  const mode: CoreMode = {
    id: 'core',
    simulatesWhenCovered: true,
    interior,
    enter(_ctx: ModeContext) {
      paintHud();
    },
    exit() {
      opts.hud?.setGrip(null);
    },
    update(dt) {
      interior.updateVisuals(dt);
      paintHud();
      opts.hud?.update(0);
    },
    render() {
      paintHud();
    },
    handleInput(frame: InputFrame) {
      const flight = opts.flight;
      const player = flight ? { x: flight.pose.x, y: flight.pose.y, z: flight.pose.z } : undefined;
      const out = interior.step(frame.dt || 0, {
        downloadHeld: frame.down('download'),
        player,
        jackHeld: frame.held('jackOut'),
        engagePressed: frame.pressed('engage'),
      });
      handleOutcome(out);
    },
  };
  return mode;
}
