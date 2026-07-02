import type { Vec2, Wall } from './types';

/** Liang–Barsky: does the segment cross the rect's interior? */
function segHitsRect(x0: number, y0: number, x1: number, y1: number, r: Wall): boolean {
  const dx = x1 - x0;
  const dy = y1 - y0;
  const p = [-dx, dx, -dy, dy];
  const q = [x0 - r.x, r.x + r.w - x0, y0 - r.y, r.y + r.h - y0];
  let t0 = 0;
  let t1 = 1;
  for (let i = 0; i < 4; i++) {
    if (p[i] === 0) {
      if (q[i] < 0) return false; // parallel and outside this slab
    } else {
      const t = q[i] / p[i];
      if (p[i] < 0) {
        if (t > t1) return false;
        if (t > t0) t0 = t;
      } else {
        if (t < t0) return false;
        if (t < t1) t1 = t;
      }
    }
  }
  return t0 < t1;
}

/** True when nothing in `blockers` sits on the line between the two points. */
export function segmentClear(from: Vec2, to: Vec2, blockers: Wall[]): boolean {
  for (const r of blockers) {
    if (segHitsRect(from.x, from.y, to.x, to.y, r)) return false;
  }
  return true;
}
