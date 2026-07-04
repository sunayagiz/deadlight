import { describe, it, expect } from 'vitest';
import { stickVector } from '../../src/game/touch';

describe('stickVector', () => {
  it('returns a zero vector (no NaN) for a zero offset', () => {
    expect(stickVector(0, 0, 60)).toEqual({ x: 0, y: 0, mag: 0 });
  });

  it('gives a unit direction with magnitude 1 at exactly the radius', () => {
    expect(stickVector(60, 0, 60)).toEqual({ x: 1, y: 0, mag: 1 });
  });

  it('clamps magnitude to 1 past the radius but keeps the unit direction', () => {
    const v = stickVector(120, 0, 60);
    expect(v.mag).toBe(1);
    expect(v.x).toBeCloseTo(1);
    expect(v.y).toBeCloseTo(0);
  });

  it('scales magnitude linearly with push distance inside the radius', () => {
    const v = stickVector(30, 40, 100); // len 50, radius 100 → mag 0.5
    expect(v.mag).toBeCloseTo(0.5);
    expect(v.x).toBeCloseTo(0.6); // 30/50
    expect(v.y).toBeCloseTo(0.8); // 40/50
  });

  it('normalises direction independent of magnitude', () => {
    const v = stickVector(-3, 4, 5);
    expect(v.x).toBeCloseTo(-0.6);
    expect(v.y).toBeCloseTo(0.8);
    expect(v.mag).toBeCloseTo(1); // len 5 == radius
  });
});
