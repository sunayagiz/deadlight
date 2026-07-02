import { describe, it, expect } from 'vitest';
import { len, norm, lerp } from '../../src/sim/vec';

describe('vec', () => {
  it('len computes euclidean length', () => {
    expect(len({ x: 3, y: 4 })).toBeCloseTo(5);
  });

  it('norm returns zero vector for zero input (no NaN)', () => {
    expect(norm({ x: 0, y: 0 })).toEqual({ x: 0, y: 0 });
  });

  it('norm pins both direction and magnitude', () => {
    expect(norm({ x: 3, y: 4 })).toEqual({ x: 0.6, y: 0.8 });
  });

  it('norm handles negative components', () => {
    expect(norm({ x: -3, y: 4 })).toEqual({ x: -0.6, y: 0.8 });
  });

  it('lerp interpolates between two numbers', () => {
    expect(lerp(0, 10, 0.25)).toBe(2.5);
  });
});
