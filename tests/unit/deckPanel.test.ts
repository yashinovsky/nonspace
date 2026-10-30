import { describe, expect, it } from 'vitest';
import { createEventBus } from '../../src/core/events';
import { createLoop } from '../../src/core/loop';
import { createMemoryStorage, createSaveStore } from '../../src/core/save';
import { createSettingsStore } from '../../src/core/settings';
import {
  createDeckPanel,
  createDeckPanelMode,
  DEFAULT_ADDRESS_BOOK,
  hashMarks,
} from '../../src/hud/DeckPanel';
import { ACCESSIBILITY_FIELDS, createSettingsMenu } from '../../src/hud/dom/Settings';
import { createSubtitles, subtitleSizePx } from '../../src/hud/dom/Subtitles';
import { createInput } from '../../src/input/Input';
import { parseMatrixCoord } from '../../src/world/coords';

const DT = 1 / 60;

function inputHarness() {
  const settings = createSettingsStore();
  const input = createInput({ settings, attach: false, storage: createMemoryStorage() });
  return { settings, input };
}

function typeChars(input: ReturnType<typeof createInput>, text: string): void {
  for (const ch of text) {
    input.feedKey('KeyA', true, ch);
    input.feedKey('KeyA', false);
  }
}

describe('M3.3 deck panel', () => {
  it('opens and closes without pausing the sim', () => {
    const loop = createLoop({
      update() {},
      render() {},
    });
    const settings = createSettingsStore();
    const menu = createSettingsMenu({ settings, loop });
    const panel = createDeckPanel();
    expect(loop.paused).toBe(false);
    panel.show();
    expect(panel.open).toBe(true);
    expect(loop.paused).toBe(false);
    panel.hide();
    expect(panel.open).toBe(false);
    expect(loop.paused).toBe(false);
    menu.show();
    expect(menu.open).toBe(true);
    expect(loop.paused).toBe(true);
    expect(menu.pausedSim).toBe(true);
    menu.hide();
    expect(loop.paused).toBe(false);
  });

  it('deck mode id is an overlay that does not freeze matrix', () => {
    const mode = createDeckPanelMode();
    expect(mode.id).toBe('deckPanel');
    expect(mode.simulatesWhenCovered).toBe(false);
  });

  it('coordinate entry uses text capture and parseMatrixCoord', () => {
    const { input } = inputHarness();
    const jumps: string[] = [];
    let errors = 0;
    const panel = createDeckPanel({
      input,
      onJump: (c) => {
        jumps.push(`${c.region} ${c.x}/${c.z}/${c.y}`);
      },
      onError: () => {
        errors += 1;
      },
    });
    panel.show();
    expect(input.capturingText).toBe(true);
    typeChars(input, 'not a coord');
    input.feedKey('Enter', true, 'Enter');
    panel.handleInput(input.sample(DT));
    expect(errors).toBe(1);
    expect(panel.lastError).toBe('BAD COORD');
    expect(jumps).toEqual([]);

    panel.hide();
    const { input: input2 } = inputHarness();
    const panel2 = createDeckPanel({
      input: input2,
      onJump: (c) => {
        jumps.push(`${c.region} ${c.x}/${c.z}/${c.y}`);
      },
      onError: () => {
        errors += 1;
      },
    });
    panel2.show();
    typeChars(input2, 'BAMA 0168.25 / 0096.40 / 0420');
    input2.feedKey('Enter', true, 'Enter');
    panel2.handleInput(input2.sample(DT));
    expect(panel2.lastError).toBeNull();
    expect(panel2.lastJump).toEqual(parseMatrixCoord('BAMA 0168.25 / 0096.40 / 0420'));
    expect(jumps).toHaveLength(1);
  });

  it('has COORD SOFTS LOG PING STATUS and an address book', () => {
    const panel = createDeckPanel();
    expect(DEFAULT_ADDRESS_BOOK.length).toBeGreaterThan(7);
    expect(panel.addressBook.some((e) => e.id === 'chiba-node')).toBe(true);
    panel.setTab('SOFTS');
    expect(panel.tab).toBe('SOFTS');
    panel.setTab('LOG');
    panel.pushLog('DIXIE> three-two');
    expect(panel.log).toContain('DIXIE> three-two');
    panel.setTab('PING');
    panel.setLink(true);
    expect(panel.link).toBe(true);
    panel.setTab('STATUS');
    expect(hashMarks(0)).toBe('NONE');
    expect(hashMarks(4)).toBe('||||');
  });

  it('blocked jumps surface a deck error without recording lastJump', () => {
    const { input } = inputHarness();
    let errors = 0;
    const panel = createDeckPanel({
      input,
      onJump: () => 'BLOCKED GRIP',
      onError: () => {
        errors += 1;
      },
    });
    panel.show();
    typeChars(input, 'BAMA 0168.25 / 0096.40 / 0420');
    input.feedKey('Enter', true, 'Enter');
    panel.handleInput(input.sample(DT));
    expect(errors).toBe(1);
    expect(panel.lastError).toBe('BLOCKED GRIP');
    expect(panel.lastJump).toBeNull();
    panel.addAddress({ id: 'drop', name: 'Drop', coord: 'BAMA 0001.00 / 0001.00 / 0100' });
    expect(panel.addressBook.some((e) => e.id === 'drop')).toBe(true);
  });
});

describe('M3.3 settings §8.10', () => {
  it('catalog covers every accessibility option in 8.10', () => {
    expect(ACCESSIBILITY_FIELDS).toEqual(
      expect.arrayContaining([
        'reduceFlashing',
        'reduceMotion',
        'holdToToggle',
        'subtitles.enabled',
        'subtitles.size',
        'subtitles.background',
        'phaseLock.visualOnly',
        'phaseLock.widerTolerance',
        'phaseLock.mimicAlways',
        'phaseLock.slowerRekey',
      ]),
    );
  });
});

describe('M3.3 subtitles', () => {
  it('scales small/medium/large and records SFX cues', () => {
    expect(subtitleSizePx('small')).toBe(14);
    expect(subtitleSizePx('medium')).toBe(20);
    expect(subtitleSizePx('large')).toBe(28);
    const settings = createSettingsStore();
    const events = createEventBus();
    const sub = createSubtitles({ settings, events, hold: 10 });
    expect(sub.sizePx).toBe(20);
    settings.update({ subtitles: { size: 'large' } });
    expect(sub.sizePx).toBe(28);
    events.emit({ type: 'iceRekeyTelegraph', iceId: 'w', inSeconds: 1 });
    expect(sub.visible).toBe('[REKEY]');
    expect(sub.history.some((l) => l.cue)).toBe(true);
    events.emit({ type: 'dixieSay', lineId: 'three-two' });
    expect(sub.visible).toBe('DIXIE> three-two');
    sub.dispose();
  });
});

describe('save campaign status marks', () => {
  it('reads flatlines scars and heat', () => {
    const save = createSaveStore({ storage: createMemoryStorage() });
    save.data.campaign.flatlines = 3;
    save.data.campaign.scars = 2;
    save.data.campaign.heat = 11;
    expect(hashMarks(save.data.campaign.flatlines)).toBe('|||');
    expect(hashMarks(save.data.campaign.scars)).toBe('||');
  });
});
