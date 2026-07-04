import { describe, expect, it } from 'vitest';
import { BED_BASE, BED_SWELL, TENSION_MAX, bedVolume, lerpTo, tensionVolume } from '../../src/game/music';

describe('dynamic music mix (B5)', () => {
  it('tension layer is silent at/below the calm floor', () => {
    expect(tensionVolume(0)).toBe(0);
    expect(tensionVolume(0.1)).toBe(0);
    expect(tensionVolume(-1)).toBe(0); // clamped
  });

  it('tension layer fades up with intensity and caps at TENSION_MAX', () => {
    const mid = tensionVolume(0.5);
    expect(mid).toBeGreaterThan(0);
    expect(mid).toBeLessThan(TENSION_MAX);
    expect(tensionVolume(0.85)).toBeCloseTo(TENSION_MAX, 5);
    expect(tensionVolume(1)).toBe(TENSION_MAX); // saturated, never exceeds cap
    expect(tensionVolume(2)).toBe(TENSION_MAX); // clamped input
  });

  it('tension curve is monotonic non-decreasing', () => {
    let prev = -1;
    for (let i = 0; i <= 1.0001; i += 0.05) {
      const v = tensionVolume(i);
      expect(v).toBeGreaterThanOrEqual(prev);
      prev = v;
    }
  });

  it('bed sits at base through the low range then swells at high intensity', () => {
    expect(bedVolume(0)).toBeCloseTo(BED_BASE, 5);
    expect(bedVolume(0.5)).toBeCloseTo(BED_BASE, 5);
    expect(bedVolume(1)).toBeCloseTo(BED_BASE + BED_SWELL, 5);
    expect(bedVolume(0.6)).toBeGreaterThan(BED_BASE);
    expect(bedVolume(0.6)).toBeLessThan(BED_BASE + BED_SWELL);
  });

  it('lerpTo eases toward the target without overshoot', () => {
    let v = 0;
    for (let n = 0; n < 600; n++) v = lerpTo(v, 0.5, 1 / 60, 0.6); // ~10 s ≫ tau → settled
    expect(v).toBeCloseTo(0.5, 3);
    expect(v).toBeLessThanOrEqual(0.5);
    // a single small step moves partway, never past the target
    expect(lerpTo(0, 1, 1 / 60, 0.6)).toBeGreaterThan(0);
    expect(lerpTo(0, 1, 1 / 60, 0.6)).toBeLessThan(1);
  });
});
