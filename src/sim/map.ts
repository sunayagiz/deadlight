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

const T = 24; // wall thickness

/** Horizontal wall from x0..x1 at y, with [startX, width] gaps left open. */
function hwall(walls: Wall[], y: number, x0: number, x1: number, gaps: [number, number][] = []): void {
  let cur = x0;
  for (const [gx, gw] of [...gaps].sort((a, b) => a[0] - b[0])) {
    if (gx > cur) walls.push({ x: cur, y, w: gx - cur, h: T });
    cur = gx + gw;
  }
  if (cur < x1) walls.push({ x: cur, y, w: x1 - cur, h: T });
}

/** Vertical wall from y0..y1 at x, with [startY, height] gaps left open. */
function vwall(walls: Wall[], x: number, y0: number, y1: number, gaps: [number, number][] = []): void {
  let cur = y0;
  for (const [gy, gh] of [...gaps].sort((a, b) => a[0] - b[0])) {
    if (gy > cur) walls.push({ x, y: cur, w: T, h: gy - cur });
    cur = gy + gh;
  }
  if (cur < y1) walls.push({ x, y: cur, w: T, h: y1 - cur });
}

/**
 * "Kino pattern" complex, 5760×2160 (6×4 screens): a central LOBBY gated to
 * two wings, everything converging on a huge GRAND HALL; a service corridor
 * and five lock-up rooms line the south. The D6 "power" door (lobby↔hall)
 * unlocks late and completes the big perimeter loop (CoD Zombies pacing).
 *
 *   ┌─────────┬──────────────────────────────────────┬───────────┐
 *   │ PARKING │        GRAND HALL  [][ pillars ][]   │ WAREHOUSE │
 *   ├──stairs─┴───────────D6(w6)───────────┬─────────┴──stairs───┤
 *   │ W.LAB │ W.OFFICE  D1(w2) LOBBY D2(w2)│ KITCHEN │  E.WARD   │
 *   ├─stairs┴──────────────D5(w3)──────────┴─────────────stairs──┤
 *   │                  SERVICE CORRIDOR (spawns)                 │
 *   ├──d──────────d──────────d──────────d──────────d─────────────┤
 *   │ W.CLOSET │ ARMORY │  MORGUE  │ STORAGE │ E.CLOSET          │
 *   └────────────────────────────────────────────────────────────┘
 *
 * Design rules (map research): every combat room ≥2 entrances (lock-ups are
 * the deliberate one-door exception), corridors 240+ px, door gaps 100–120,
 * hall has training pillars, rooms cap near one screen so the flashlight
 * stays meaningful, and spawn zones activate with their room's gate.
 */
export function buildMap(): MapDef {
  const W = 5760;
  const H = 2160;
  const walls: Wall[] = [];

  // outer border
  hwall(walls, 0, 0, W);
  hwall(walls, H - T, 0, W);
  vwall(walls, 0, T, H - T);
  vwall(walls, W - T, T, H - T);

  // ── north band (y 0..700): PARKING | GRAND HALL | WAREHOUSE
  vwall(walls, 1400, T, 700, [[300, 110]]); // parking↔hall (interior door)
  vwall(walls, 4300, T, 700, [[300, 110]]); // hall↔warehouse (interior door)
  walls.push({ x: 2300, y: 280, w: 240, h: 140 }); // hall training pillars
  walls.push({ x: 3300, y: 280, w: 240, h: 140 });

  // ── north/middle divider (y 700): parking↔lab stairs, D6 power door, warehouse↔ward stairs
  hwall(walls, 700, T, W - T, [
    [280, 120],
    [2790, 120], // D6
    [4980, 120],
  ]);

  // ── middle band (y 700..1430): W.LAB | W.OFFICE | LOBBY | KITCHEN | E.WARD
  vwall(walls, 900, 724, 1430, [[1000, 110]]); // lab↔office (interior door)
  vwall(walls, 1900, 724, 1430, [[1020, 110]]); // D1 gate lobby↔office
  vwall(walls, 3800, 724, 1430, [[1020, 110]]); // D2 gate lobby↔kitchen
  vwall(walls, 4800, 724, 1430, [[1000, 110]]); // kitchen↔ward (interior door)
  walls.push({ x: 2450, y: 1040, w: 180, h: 90 }); // lobby cover blocks
  walls.push({ x: 3150, y: 1040, w: 180, h: 90 });

  // ── furniture & clutter: break the boxes into real rooms (all solid cover)
  walls.push(
    // parking: wrecked cars in rows
    { x: 220, y: 160, w: 120, h: 52 },
    { x: 460, y: 150, w: 120, h: 52 },
    { x: 760, y: 170, w: 120, h: 52 },
    { x: 340, y: 420, w: 120, h: 52 },
    { x: 820, y: 460, w: 120, h: 52 },
    { x: 1120, y: 300, w: 52, h: 120 }, // one parked sideways
    // warehouse: crate stacks
    { x: 4520, y: 140, w: 130, h: 130 },
    { x: 4780, y: 300, w: 100, h: 100 },
    { x: 5150, y: 130, w: 130, h: 130 },
    { x: 5350, y: 420, w: 100, h: 100 },
    { x: 4950, y: 540, w: 130, h: 90 },
    // lab: work tables
    { x: 300, y: 900, w: 180, h: 60 },
    { x: 540, y: 1160, w: 180, h: 60 },
    { x: 180, y: 1250, w: 60, h: 120 },
    // office: desk grid
    { x: 1150, y: 880, w: 130, h: 70 },
    { x: 1450, y: 880, w: 130, h: 70 },
    { x: 1300, y: 1120, w: 130, h: 70 },
    { x: 1620, y: 1250, w: 130, h: 70 },
    // kitchen: L-shaped counters
    { x: 4200, y: 1060, w: 260, h: 70 },
    { x: 4130, y: 850, w: 70, h: 210 },
    { x: 4550, y: 820, w: 180, h: 60 },
    // ward: bed rows
    { x: 4980, y: 800, w: 110, h: 50 },
    { x: 5250, y: 800, w: 110, h: 50 },
    { x: 4980, y: 1250, w: 110, h: 50 },
    { x: 5250, y: 1250, w: 110, h: 50 },
    { x: 5520, y: 1020, w: 110, h: 50 },
    // grand hall: column posts flanking the pillars
    { x: 1800, y: 180, w: 48, h: 48 },
    { x: 1800, y: 480, w: 48, h: 48 },
    { x: 2900, y: 120, w: 48, h: 48 },
    { x: 2900, y: 520, w: 48, h: 48 },
    { x: 3900, y: 180, w: 48, h: 48 },
    { x: 3900, y: 480, w: 48, h: 48 },
    // service corridor: abandoned crates
    { x: 900, y: 1510, w: 90, h: 60 },
    { x: 3620, y: 1580, w: 90, h: 60 },
    { x: 4650, y: 1490, w: 90, h: 60 },
    // lock-ups: armory racks, morgue slabs, storage shelving
    { x: 1300, y: 1850, w: 70, h: 180 },
    { x: 1560, y: 1850, w: 70, h: 180 },
    { x: 1850, y: 1900, w: 70, h: 180 },
    { x: 2500, y: 1850, w: 90, h: 150 },
    { x: 2760, y: 1850, w: 90, h: 150 },
    { x: 3050, y: 1900, w: 90, h: 150 },
    { x: 3700, y: 1850, w: 220, h: 60 },
    { x: 3700, y: 2010, w: 220, h: 60 },
    { x: 4150, y: 1850, w: 220, h: 60 },
    // buttresses breaking the long straight border walls
    { x: 800, y: 24, w: 90, h: 56 },
    { x: 2600, y: 24, w: 70, h: 56 },
    { x: 3700, y: 24, w: 70, h: 56 },
    { x: 4800, y: 24, w: 90, h: 56 },
    { x: 24, y: 380, w: 56, h: 90 },
    { x: 24, y: 1150, w: 56, h: 90 },
    { x: 5680, y: 420, w: 56, h: 90 },
    { x: 5680, y: 1100, w: 56, h: 90 },
    { x: 1500, y: 2056, w: 90, h: 56 },
    { x: 4400, y: 2056, w: 90, h: 56 },
  );

  // ── middle/south divider (y 1430): lab stairs, D5 gate, ward stairs
  hwall(walls, 1430, T, W - T, [
    [180, 120],
    [2790, 120], // D5
    [5460, 120],
  ]);

  // ── south: SERVICE CORRIDOR (y 1454..1700), lock-up row below (y 1724..)
  hwall(walls, 1700, T, W - T, [
    [500, 100],
    [1700, 100],
    [2850, 100],
    [4000, 100],
    [5200, 100],
  ]);
  vwall(walls, 1100, 1724, H - T); // lock-up dividers
  vwall(walls, 2300, 1724, H - T);
  vwall(walls, 3500, 1724, H - T);
  vwall(walls, 4700, 1724, H - T);

  return {
    width: W,
    height: H,
    walls,
    doors: [
      { x: 1400, y: 300, w: T, h: 110, open: false, minWave: 0 }, // parking↔hall
      { x: 4300, y: 300, w: T, h: 110, open: false, minWave: 0 }, // hall↔warehouse
      { x: 900, y: 1000, w: T, h: 110, open: false, minWave: 0 }, // lab↔office
      { x: 4800, y: 1000, w: T, h: 110, open: false, minWave: 0 }, // kitchen↔ward
      { x: 1900, y: 1020, w: T, h: 110, open: false, minWave: 2 }, // D1 lobby→west wing
      { x: 3800, y: 1020, w: T, h: 110, open: false, minWave: 2 }, // D2 lobby→east wing
      { x: 2790, y: 1430, w: 120, h: T, open: false, minWave: 3 }, // D5 lobby→corridor
      { x: 2790, y: 700, w: 120, h: T, open: false, minWave: 6 }, // D6 "power" lobby↔hall
      { x: 500, y: 1700, w: 100, h: T, open: false, minWave: 0 }, // w.closet
      { x: 1700, y: 1700, w: 100, h: T, open: false, minWave: 0 }, // armory
      { x: 2850, y: 1700, w: 100, h: T, open: false, minWave: 0 }, // morgue
      { x: 4000, y: 1700, w: 100, h: T, open: false, minWave: 0 }, // storage
      { x: 5200, y: 1700, w: 100, h: T, open: false, minWave: 0 }, // e.closet
    ],
    spawnZones: [
      // lobby "windows" — wave 1 pressure at the room edges
      { x: 1960, y: 780, minWave: 1 },
      { x: 3740, y: 1380, minWave: 1 },
      // west wing (behind D1)
      { x: 1000, y: 780, minWave: 2 },
      { x: 120, y: 800, minWave: 2 },
      // east wing (behind D2)
      { x: 3900, y: 780, minWave: 2 },
      { x: 5660, y: 800, minWave: 2 },
      // north band (reachable via wings)
      { x: 100, y: 100, minWave: 2 },
      { x: 1300, y: 600, minWave: 2 },
      { x: 1500, y: 100, minWave: 2 },
      { x: 2850, y: 100, minWave: 2 },
      { x: 4200, y: 600, minWave: 2 },
      { x: 4400, y: 100, minWave: 2 },
      { x: 5660, y: 100, minWave: 2 },
      // south corridor + lock-ups (behind D5)
      { x: 100, y: 1560, minWave: 3 },
      { x: 2850, y: 1560, minWave: 3 },
      { x: 5660, y: 1560, minWave: 3 },
      { x: 1800, y: 2050, minWave: 3 },
      { x: 2900, y: 2050, minWave: 3 },
      { x: 4100, y: 2050, minWave: 3 },
    ],
    playerStart: { x: 2850, y: 1080 },
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
