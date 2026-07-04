import { describe, expect, it } from 'vitest';
import {
  clamp01,
  scaledShake,
  scaledFlash,
  affixTint,
  powerupColor,
  CB_SAFE,
  COLORBLIND_MODES,
  type Settings,
} from '../../src/game/settings';

const base = (over: Partial<Settings> = {}): Settings => ({
  colorblind: 'off',
  captions: true,
  shake: 1,
  flash: 1,
  highContrast: false,
  ...over,
});

describe('clamp01', () => {
  it('clamps to 0..1 and rejects NaN/garbage as 0', () => {
    expect(clamp01(0.5)).toBe(0.5);
    expect(clamp01(-3)).toBe(0);
    expect(clamp01(5)).toBe(1);
    expect(clamp01(NaN)).toBe(0);
    expect(clamp01('nope')).toBe(0);
    expect(clamp01(undefined)).toBe(0);
  });
});

describe('scaledShake / scaledFlash', () => {
  it('multiplies the base by the setting, 0 fully suppressing', () => {
    expect(scaledShake(0.006, base({ shake: 1 }))).toBeCloseTo(0.006);
    expect(scaledShake(0.006, base({ shake: 0 }))).toBe(0);
    expect(scaledShake(0.006, base({ shake: 0.5 }))).toBeCloseTo(0.003);
    expect(scaledFlash(0.5, base({ flash: 0 }))).toBe(0); // photosensitivity: no red flash
    expect(scaledFlash(0.5, base({ flash: 0.4 }))).toBeCloseTo(0.2);
  });
});

describe('colour-blind palette remap', () => {
  it('returns the base hue when colour-blind mode is off', () => {
    expect(affixTint('swift', 0xffe23a, 'off')).toBe(0xffe23a);
    expect(powerupColor('maxammo', 0x4ec6ff, 'off')).toBe(0x4ec6ff);
  });

  it('remaps every affix to a distinct Okabe–Ito-safe hue under any active mode', () => {
    const safe = new Set<number>(Object.values(CB_SAFE));
    for (const mode of COLORBLIND_MODES.filter((m) => m !== 'off')) {
      const seen = new Set<number>();
      for (const a of ['swift', 'tank', 'shielded', 'volatile', 'vampiric'] as const) {
        const c = affixTint(a, 0x000000, mode);
        expect(safe.has(c)).toBe(true); // came from the safe palette
        expect(seen.has(c)).toBe(false); // mutually distinct
        seen.add(c);
      }
    }
  });

  it('remaps power-ups to distinct safe hues under an active mode', () => {
    const seen = new Set<number>();
    for (const k of ['maxammo', 'instakill', 'nuke', 'doublepoints', 'firesale']) {
      const c = powerupColor(k, 0x000000, 'deuter');
      expect(seen.has(c)).toBe(false);
      seen.add(c);
    }
  });
});
