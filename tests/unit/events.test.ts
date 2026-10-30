import { describe, expect, it, vi } from 'vitest';
import { createEventBus, GAME_EVENT_TYPES, isGameEventType } from '../../src/core/events';
import { recordEvents } from '../../src/testing/mocks';

describe('event bus', () => {
  it('delivers typed events to listeners of that type only', () => {
    const bus = createEventBus();
    const trace = vi.fn();
    const neural = vi.fn();
    bus.on('traceChanged', trace);
    bus.on('neuralChanged', neural);

    bus.emit({ type: 'traceChanged', value: 42 });

    expect(trace).toHaveBeenCalledWith({ type: 'traceChanged', value: 42 });
    expect(neural).not.toHaveBeenCalled();
  });

  it('narrows the payload type for the listener', () => {
    const bus = createEventBus();
    let iceId = '';
    bus.on('gripStart', (e) => {
      iceId = e.iceId;
    });
    bus.emit({ type: 'gripStart', iceId: 'black-1' });
    expect(iceId).toBe('black-1');
  });

  it('unsubscribes via the returned function and via off()', () => {
    const bus = createEventBus();
    const a = vi.fn();
    const b = vi.fn();
    const stopA = bus.on('iceRekey', a);
    bus.on('iceRekey', b);
    stopA();
    bus.off('iceRekey', b);
    bus.emit({ type: 'iceRekey', iceId: 'x' });
    expect(a).not.toHaveBeenCalled();
    expect(b).not.toHaveBeenCalled();
    expect(bus.listenerCount()).toBe(0);
  });

  it('once() fires a single time', () => {
    const bus = createEventBus();
    const fn = vi.fn();
    bus.once('jackIn', fn);
    bus.emit({ type: 'jackIn', missionId: 'm1' });
    bus.emit({ type: 'jackIn', missionId: 'm1' });
    expect(fn).toHaveBeenCalledTimes(1);
    expect(bus.listenerCount('jackIn')).toBe(0);
  });

  it('onAny() sees every event after typed listeners', () => {
    const bus = createEventBus();
    const order: string[] = [];
    bus.onAny((e) => order.push(`any:${e.type}`));
    bus.on('flatline', () => order.push('typed'));
    bus.emit({ type: 'flatline', scripted: false });
    expect(order).toEqual(['typed', 'any:flatline']);
  });

  it('is safe to add and remove listeners during dispatch', () => {
    const bus = createEventBus();
    const late = vi.fn();
    const removed = vi.fn();
    const stopFirst = bus.on('scanPulse', () => {
      stopFirst();
      bus.on('scanPulse', late);
      bus.off('scanPulse', removed);
    });
    bus.on('scanPulse', removed);

    bus.emit({ type: 'scanPulse', origin: { x: 0, y: 0, z: 0 } });
    expect(late).not.toHaveBeenCalled();
    expect(removed).not.toHaveBeenCalled();

    bus.emit({ type: 'scanPulse', origin: { x: 0, y: 0, z: 0 } });
    expect(late).toHaveBeenCalledTimes(1);
    expect(bus.listenerCount('scanPulse')).toBe(1);
  });

  it('supports re-entrant emits', () => {
    const bus = createEventBus();
    const rec = recordEvents(bus);
    bus.on('iceLayerCracked', (e) => bus.emit({ type: 'softUsed', softId: `after-${e.layer}` }));
    bus.emit({ type: 'iceLayerCracked', iceId: 'x', layer: 0 });
    expect(rec.events.map((e) => e.type)).toEqual(['softUsed', 'iceLayerCracked']);
    expect(rec.last('softUsed')?.softId).toBe('after-0');
  });

  it('runs all listeners when one throws, then rethrows the first error', () => {
    const bus = createEventBus();
    const after = vi.fn();
    bus.on('mollyPain', () => {
      throw new Error('boom');
    });
    bus.on('mollyPain', after);
    expect(() => bus.emit({ type: 'mollyPain', amount: 1 })).toThrow('boom');
    expect(after).toHaveBeenCalledOnce();
  });

  it('clear() removes everything, including during dispatch', () => {
    const bus = createEventBus();
    const second = vi.fn();
    bus.on('simstimFlip', () => bus.clear());
    bus.on('simstimFlip', second);
    bus.emit({ type: 'simstimFlip', on: true });
    expect(second).not.toHaveBeenCalled();
    expect(bus.listenerCount()).toBe(0);
  });

  it('lists every event type exactly once', () => {
    expect(new Set(GAME_EVENT_TYPES).size).toBe(GAME_EVENT_TYPES.length);
    expect(GAME_EVENT_TYPES).toContain('gripEnd');
    expect(isGameEventType('jackOut')).toBe(true);
    expect(isGameEventType('toString')).toBe(false);
  });
});
