import { describe, it, expect } from 'vitest';
import { FixedLoop } from '../../src/game/loop';

const DT = 1 / 60;

describe('FixedLoop', () => {
  it('does not step when elapsed < dt, and returns fractional alpha', () => {
    const loop = new FixedLoop(DT);
    let steps = 0;
    const alpha = loop.tick(DT * 0.5, () => steps++);
    expect(steps).toBe(0);
    expect(alpha).toBeCloseTo(0.5);
  });

  it('accumulates across ticks', () => {
    const loop = new FixedLoop(DT);
    let steps = 0;
    loop.tick(DT * 0.5, () => steps++);
    const alpha = loop.tick(DT * 0.6, () => steps++);
    expect(steps).toBe(1);
    expect(alpha).toBeCloseTo(0.1);
  });

  it('steps multiple times for a long frame', () => {
    const loop = new FixedLoop(DT);
    let steps = 0;
    loop.tick(DT * 3, () => steps++);
    expect(steps).toBe(3);
  });

  it('clamps catch-up to maxSteps (no spiral of death)', () => {
    const loop = new FixedLoop(DT, 5);
    let steps = 0;
    loop.tick(1.0, () => steps++); // one full second hitch
    expect(steps).toBe(5);
  });

  it('survives a NaN elapsed sample without poisoning the accumulator', () => {
    const loop = new FixedLoop(DT);
    let steps = 0;
    loop.tick(Number.NaN, () => steps++);
    expect(steps).toBe(0);
    loop.tick(DT * 1.5, () => steps++);
    expect(steps).toBe(1); // still alive after the bad frame
  });

  it('treats negative elapsed as zero (alpha stays in [0, 1))', () => {
    const loop = new FixedLoop(DT);
    const alpha = loop.tick(-0.5, () => {});
    expect(alpha).toBe(0);
  });
});
