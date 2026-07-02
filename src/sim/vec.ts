import type { Vec2 } from './types';

export function len(v: Vec2): number {
  return Math.hypot(v.x, v.y);
}

export function norm(v: Vec2): Vec2 {
  const l = len(v);
  return l === 0 ? { x: 0, y: 0 } : { x: v.x / l, y: v.y / l };
}

/** t is intentionally unclamped — callers may extrapolate. */
export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}
