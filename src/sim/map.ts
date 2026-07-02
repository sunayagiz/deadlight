import { DOOR_OPEN_RADIUS } from '../config';
import type { Door, GameState, SpawnZone, Wall } from './types';

export interface MapDef {
  width: number;
  height: number;
  walls: Wall[];
  doors: Door[];
  spawnZones: SpawnZone[];
  playerStart: { x: number; y: number };
}

// ── Carving engine ───────────────────────────────────────────────────────────
// The map is SOLID ROCK; rooms and necks are carved out. Every door fills a
// carved NECK exactly (full cross-section), flanked by rock, so doors are always
// flush — never floating bars you can walk around. Leftover solid cells are
// compressed into wall rects.

const CELL = 60;
const COLS = 144; // 8640 px
const ROWS = 64; // 3840 px

class Carver {
  grid = new Uint8Array(COLS * ROWS).fill(1);
  private set(x: number, y: number, v: number): void {
    if (x >= 0 && y >= 0 && x < COLS && y < ROWS) this.grid[y * COLS + x] = v;
  }
  rect(x0: number, y0: number, x1: number, y1: number): void {
    for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) this.set(x, y, 0);
  }
  fill(x0: number, y0: number, x1: number, y1: number): void {
    for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) this.set(x, y, 1);
  }
  disc(cx: number, cy: number, r: number): void {
    for (let y = Math.floor(cy - r); y <= cy + r; y++)
      for (let x = Math.floor(cx - r); x <= cx + r; x++)
        if ((x - cx) ** 2 + (y - cy) ** 2 <= r * r) this.set(x, y, 0);
  }
  private corner(cx: number, cy: number, s: number, dx: 1 | -1, dy: 1 | -1): void {
    for (let i = 0; i < s; i++) for (let j = 0; j < s - i; j++) this.set(cx + i * dx, cy + j * dy, 1);
  }
  octagon(x0: number, y0: number, x1: number, y1: number, ch: number): void {
    this.rect(x0, y0, x1, y1);
    this.corner(x0, y0, ch, 1, 1);
    this.corner(x1 - 1, y0, ch, -1, 1);
    this.corner(x0, y1 - 1, ch, 1, -1);
    this.corner(x1 - 1, y1 - 1, ch, -1, -1);
  }
  toWalls(): Wall[] {
    const used = new Uint8Array(COLS * ROWS);
    const walls: Wall[] = [];
    for (let y = 0; y < ROWS; y++) {
      for (let x = 0; x < COLS; x++) {
        const i = y * COLS + x;
        if (!this.grid[i] || used[i]) continue;
        let w = 1;
        while (x + w < COLS && this.grid[i + w] && !used[i + w]) w++;
        let h = 1;
        outer: while (y + h < ROWS) {
          for (let k = 0; k < w; k++) {
            const j = (y + h) * COLS + x + k;
            if (!this.grid[j] || used[j]) break outer;
          }
          h++;
        }
        for (let yy = 0; yy < h; yy++) for (let xx = 0; xx < w; xx++) used[(y + yy) * COLS + x + xx] = 1;
        walls.push({ x: x * CELL, y: y * CELL, w: w * CELL, h: h * CELL });
      }
    }
    return walls;
  }
}

const px = (c: number): number => c * CELL;

/**
 * "The Facility" — 8640×3840 (9×7 screens). Octagonal LOBBY dead-center is the
 * only wave-1 space; its four exits are all GATE doors (CoD unlock pacing):
 * D1 west wing + parking (w2), D2 east wing + warehouse (w2), D5 sewer + cave +
 * generator (w3), D6 "power" grand hall (w6). Every door fills a carved neck
 * exactly. A spawn zone activates with the gate that connects its room, so no
 * enemy is ever spawned in a room the player can't reach (which would stall the
 * wave).
 */
export function buildMap(): MapDef {
  const c = new Carver();
  const doors: Door[] = [];

  // horizontal neck (E/W passage) + a vertical door filling its full height
  const hneck = (xL: number, xR: number, y0: number, y1: number, minWave: number): void => {
    c.rect(xL, y0, xR, y1);
    doors.push({ x: px((xL + xR) / 2) - 12, y: px(y0), w: 24, h: px(y1 - y0), open: false, minWave });
  };
  // vertical neck (N/S passage) + a horizontal door filling its full width
  const vneck = (x0: number, x1: number, yT: number, yB: number, minWave: number): void => {
    c.rect(x0, yT, x1, yB);
    doors.push({ x: px(x0), y: px((yT + yB) / 2) - 12, w: px(x1 - x0), h: 24, open: false, minWave });
  };

  // ── chambers ──────────────────────────────────────────────────────────────
  c.octagon(58, 24, 86, 40, 5); // LOBBY (start)
  c.octagon(40, 4, 106, 20, 6); // GRAND HALL (behind D6)
  c.fill(58, 8, 62, 12); // hall training pillars
  c.fill(84, 8, 88, 12);
  c.rect(4, 23, 48, 42); // WEST WING
  c.rect(96, 23, 140, 42); // EAST WING
  c.rect(4, 4, 22, 20); // PARKING (NW)
  c.rect(122, 4, 140, 20); // WAREHOUSE (NE)
  c.rect(8, 46, 140, 53); // SEWER service tunnel (full width; overlaps cave + generator)
  c.disc(15, 56, 6); // CAVE collapse (SW) — organic, opens straight into the sewer
  c.disc(23, 54, 5);
  c.disc(10, 60, 4);
  c.rect(116, 52, 140, 62); // GENERATOR room (SE) — top row overlaps the sewer

  // ── necks + doors (each door fills its neck exactly) ────────────────────────
  vneck(70, 74, 20, 24, 6); // D6 power: lobby ↔ hall
  hneck(48, 58, 30, 33, 2); // D1: lobby ↔ west wing
  hneck(86, 96, 30, 33, 2); // D2: lobby ↔ east wing
  vneck(70, 74, 40, 46, 3); // D5: lobby ↔ sewer
  vneck(10, 14, 20, 23, 0); // parking ↔ west wing
  vneck(129, 133, 20, 23, 0); // warehouse ↔ east wing
  vneck(24, 28, 42, 46, 3); // west wing ↔ sewer (loop, opens with the sewer)
  vneck(116, 120, 42, 46, 3); // east wing ↔ sewer (loop)
  // cave + generator open directly into the sewer (organic mouths, no doors)

  // ── clutter (solid cover, de-boxes the rooms) ───────────────────────────────
  const clutter: [number, number, number, number][] = [
    [8, 8, 10, 10], [14, 6, 16, 8], [9, 15, 11, 17], // parking cars
    [126, 8, 128, 10], [132, 14, 134, 16], [137, 7, 139, 9], // warehouse crates
    [12, 27, 14, 29], [20, 33, 22, 35], [30, 26, 32, 28], [40, 36, 42, 38], // west wing
    [104, 27, 106, 29], [114, 33, 116, 35], [124, 26, 126, 28], [134, 36, 136, 38], // east wing
    [50, 8, 52, 10], [94, 8, 96, 10], [70, 14, 74, 16], // hall
    [66, 29, 68, 31], [76, 34, 78, 36], // lobby
    [46, 48, 48, 50], [72, 48, 74, 50], [108, 48, 110, 50], // sewer (clear of spawn zones)
    [122, 55, 124, 58], [134, 55, 136, 58], // generator
  ];
  for (const [a, b, d, e] of clutter) c.fill(a, b, d, e);

  return {
    width: COLS * CELL,
    height: ROWS * CELL,
    walls: c.toWalls(),
    doors,
    spawnZones: [
      { x: px(64) + 30, y: px(27) + 30, minWave: 1 }, // lobby
      { x: px(80) + 30, y: px(37) + 30, minWave: 1 },
      { x: px(16) + 30, y: px(32) + 30, minWave: 2 }, // west wing
      { x: px(10) + 30, y: px(10) + 30, minWave: 2 }, // parking
      { x: px(128) + 30, y: px(32) + 30, minWave: 2 }, // east wing
      { x: px(131) + 30, y: px(10) + 30, minWave: 2 }, // warehouse
      { x: px(20) + 30, y: px(48) + 30, minWave: 3 }, // sewer
      { x: px(100) + 30, y: px(48) + 30, minWave: 3 },
      { x: px(14) + 30, y: px(56) + 30, minWave: 3 }, // cave
      { x: px(128) + 30, y: px(57) + 30, minWave: 3 }, // generator
      { x: px(48) + 30, y: px(10) + 30, minWave: 6 }, // hall (only once D6 opens)
      { x: px(98) + 30, y: px(10) + 30, minWave: 6 },
    ],
    playerStart: { x: px(72) + 30, y: px(32) + 30 },
  };
}

/** Rects that currently block movement, bullets and sight: all walls + still-closed doors. */
export function mapSolids(state: GameState): Wall[] {
  const solids: Wall[] = state.walls.slice();
  for (const d of state.doors) {
    if (!d.open) solids.push({ x: d.x, y: d.y, w: d.w, h: d.h });
  }
  return solids;
}

/**
 * Doors swing open (permanently) once the player is close enough — but gate
 * doors stay locked until their wave milestone (CoD-style progression).
 */
export function updateDoors(state: GameState): void {
  const player = state.player;
  for (const d of state.doors) {
    if (d.open) continue;
    if (d.minWave > 0 && state.wave.index < d.minWave) continue; // still sealed
    const cx = d.x + d.w / 2;
    const cy = d.y + d.h / 2;
    const dx = player.pos.x - cx;
    const dy = player.pos.y - cy;
    const reach = DOOR_OPEN_RADIUS + Math.max(d.w, d.h) / 2;
    if (dx * dx + dy * dy <= reach * reach) d.open = true;
  }
}
