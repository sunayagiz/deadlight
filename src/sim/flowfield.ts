import { FLOW_CELL } from '../config';
import type { GameState, Vec2, Wall } from './types';

/**
 * Flow field: one multi-source BFS from the player(s) over a coarse grid,
 * then every zombie just reads its cell's direction — cost is independent of
 * horde size (the genre-standard answer for crowds; per-zombie A* is not).
 */
export interface FlowField {
  cols: number;
  rows: number;
  cell: number;
  dirX: Float32Array; // unit direction toward the target, per cell (0,0 = unreachable)
  dirY: Float32Array;
}

function buildBlocked(cols: number, rows: number, cell: number, solids: Wall[]): Uint8Array {
  const blocked = new Uint8Array(cols * rows);
  for (const s of solids) {
    const x0 = Math.max(0, Math.floor(s.x / cell));
    const y0 = Math.max(0, Math.floor(s.y / cell));
    const x1 = Math.min(cols - 1, Math.floor((s.x + s.w - 1) / cell));
    const y1 = Math.min(rows - 1, Math.floor((s.y + s.h - 1) / cell));
    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) blocked[y * cols + x] = 1;
    }
  }
  return blocked;
}

export function computeFlowField(
  mapW: number,
  mapH: number,
  solids: Wall[],
  targets: Vec2[],
  cell: number = FLOW_CELL,
): FlowField {
  const cols = Math.ceil(mapW / cell);
  const rows = Math.ceil(mapH / cell);
  const blocked = buildBlocked(cols, rows, cell, solids);
  const dist = new Int32Array(cols * rows).fill(-1);

  // Dijkstra with a bucket queue: orthogonal step = 10, diagonal = 14, so a
  // straight line genuinely beats a staircase (plain BFS treats them equal and
  // produces zig-zag flow directions). Diagonals only when both orthogonal
  // neighbours are open (prevents corner cutting through wall tips).
  const buckets: number[][] = [];
  const push = (i: number, d: number) => {
    dist[i] = d;
    (buckets[d] ??= []).push(i);
  };

  for (const t of targets) {
    const cx = Math.min(cols - 1, Math.max(0, Math.floor(t.x / cell)));
    const cy = Math.min(rows - 1, Math.max(0, Math.floor(t.y / cell)));
    const i = cy * cols + cx;
    if (dist[i] === -1) push(i, 0);
  }

  for (let d = 0; d < buckets.length; d++) {
    const bucket = buckets[d];
    if (!bucket) continue;
    for (let bi = 0; bi < bucket.length; bi++) {
      const i = bucket[bi];
      if (dist[i] !== d) continue; // stale entry (already settled cheaper)
      const x = i % cols;
      const y = (i / cols) | 0;
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          if (dx === 0 && dy === 0) continue;
          const nx = x + dx;
          const ny = y + dy;
          if (nx < 0 || ny < 0 || nx >= cols || ny >= rows) continue;
          const ni = ny * cols + nx;
          if (blocked[ni]) continue;
          if (dx !== 0 && dy !== 0 && (blocked[y * cols + nx] || blocked[ny * cols + x])) continue;
          const nd = d + (dx !== 0 && dy !== 0 ? 14 : 10);
          if (dist[ni] === -1 || nd < dist[ni]) push(ni, nd);
        }
      }
    }
  }

  // Per cell: point at the lowest-distance neighbour.
  const dirX = new Float32Array(cols * rows);
  const dirY = new Float32Array(cols * rows);
  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < cols; x++) {
      const i = y * cols + x;
      if (dist[i] <= 0) continue; // unreachable, blocked, or already at target
      let best = dist[i];
      let bx = 0;
      let by = 0;
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          if (dx === 0 && dy === 0) continue;
          const nx = x + dx;
          const ny = y + dy;
          if (nx < 0 || ny < 0 || nx >= cols || ny >= rows) continue;
          const ni = ny * cols + nx;
          if (dist[ni] === -1) continue;
          if (dx !== 0 && dy !== 0 && (blocked[y * cols + nx] || blocked[ny * cols + x])) continue;
          if (dist[ni] < best) {
            best = dist[ni];
            bx = dx;
            by = dy;
          }
        }
      }
      const l = Math.hypot(bx, by);
      if (l > 0) {
        dirX[i] = bx / l;
        dirY[i] = by / l;
      }
    }
  }
  return { cols, rows, cell, dirX, dirY };
}

/** Unit direction toward the target from this position, or null when unreachable/off-grid. */
export function sampleFlow(field: FlowField, x: number, y: number): Vec2 | null {
  const cx = Math.floor(x / field.cell);
  const cy = Math.floor(y / field.cell);
  if (cx < 0 || cy < 0 || cx >= field.cols || cy >= field.rows) return null;
  const i = cy * field.cols + cx;
  const dx = field.dirX[i];
  const dy = field.dirY[i];
  if (dx === 0 && dy === 0) return null;
  return { x: dx, y: dy };
}

// ── Cached accessor: recompute only when the player crosses a cell or a door
// changes. Deterministic given the state, so host/guest stay consistent.
let cacheKey = '';
let cacheField: FlowField | null = null;

export function getFlowField(state: GameState, solids: Wall[]): FlowField {
  const p = state.player;
  const key = `${Math.floor(p.pos.x / FLOW_CELL)},${Math.floor(p.pos.y / FLOW_CELL)}|${state.doors.map((d) => (d.open ? 1 : 0)).join('')}|${state.mapW}x${state.mapH}`;
  if (key !== cacheKey || !cacheField) {
    cacheField = computeFlowField(state.mapW, state.mapH, solids, [p.pos]);
    cacheKey = key;
  }
  return cacheField;
}
