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
// The map starts as SOLID ROCK and rooms/corridors are carved out of it — the
// opposite of stacking boxes. Diagonal corridors, octagonal rooms, winding
// tunnels and cave blobs all fall out of three carve primitives. The leftover
// solid cells are compressed into wall rects via greedy rect decomposition.

const CELL = 60; // px per grid cell
const COLS = 144; // 8640 px
const ROWS = 64; // 3840 px

class Carver {
  grid = new Uint8Array(COLS * ROWS).fill(1); // 1 = solid rock

  private set(cx: number, cy: number, v: number): void {
    if (cx >= 0 && cy >= 0 && cx < COLS && cy < ROWS) this.grid[cy * COLS + cx] = v;
  }

  /** Open a rectangular chamber (cell coords, inclusive..exclusive). */
  rect(cx0: number, cy0: number, cx1: number, cy1: number): void {
    for (let y = cy0; y < cy1; y++) for (let x = cx0; x < cx1; x++) this.set(x, y, 0);
  }

  /** Open a disc — junction bulges, dens, cave pockets. */
  disc(cx: number, cy: number, r: number): void {
    for (let y = Math.floor(cy - r); y <= cy + r; y++) {
      for (let x = Math.floor(cx - r); x <= cx + r; x++) {
        if ((x - cx) ** 2 + (y - cy) ** 2 <= r * r) this.set(x, y, 0);
      }
    }
  }

  /** Carve a corridor of half-width hw between two cells — any angle. */
  line(x0: number, y0: number, x1: number, y1: number, hw: number): void {
    const steps = Math.ceil(Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0))) * 2;
    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      this.disc(x0 + (x1 - x0) * t, y0 + (y1 - y0) * t, hw);
    }
  }

  /** Chamfer: re-fill a triangular corner of a carved rect (45° stair-step). */
  fillCorner(cx: number, cy: number, size: number, dirX: 1 | -1, dirY: 1 | -1): void {
    for (let i = 0; i < size; i++) {
      for (let j = 0; j < size - i; j++) this.set(cx + i * dirX, cy + j * dirY, 1);
    }
  }

  /** Octagonal room: rect with all four corners chamfered. */
  octagon(cx0: number, cy0: number, cx1: number, cy1: number, chamfer: number): void {
    this.rect(cx0, cy0, cx1, cy1);
    this.fillCorner(cx0, cy0, chamfer, 1, 1);
    this.fillCorner(cx1 - 1, cy0, chamfer, -1, 1);
    this.fillCorner(cx0, cy1 - 1, chamfer, 1, -1);
    this.fillCorner(cx1 - 1, cy1 - 1, chamfer, -1, -1);
  }

  /** Put solid clutter back inside a carved space (pillars, cars, racks). */
  fill(cx0: number, cy0: number, cx1: number, cy1: number): void {
    for (let y = cy0; y < cy1; y++) for (let x = cx0; x < cx1; x++) this.set(x, y, 1);
  }

  /** Greedy rect decomposition of the remaining solid cells. */
  toWalls(): Wall[] {
    const used = new Uint8Array(COLS * ROWS);
    const walls: Wall[] = [];
    for (let y = 0; y < ROWS; y++) {
      for (let x = 0; x < COLS; x++) {
        const i = y * COLS + x;
        if (!this.grid[i] || used[i]) continue;
        let w = 1; // grow right
        while (x + w < COLS && this.grid[i + w] && !used[i + w]) w++;
        let h = 1; // grow down while the full span stays solid+unused
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
 * "The Facility" — 8640×3840 (9×7 screens) carved out of solid rock.
 *
 * Octagonal LOBBY dead-center; a chamfered GRAND HALL north behind the D6
 * power door; office cluster west behind D1; medical wing east behind D2;
 * parking and warehouse in the far corners, tied to the hall by DIAGONAL
 * galleries; and under everything a WINDING SEWER with dens, a collapsed
 * cave zone and a generator room, reached through D5. Gate pacing follows
 * the CoD unlock loop: D1/D2 wave 2 → D5 wave 3 → D6 wave 6 closes the loop.
 */
export function buildMap(): MapDef {
  const c = new Carver();

  // ── center: octagonal lobby (player start)
  c.octagon(60, 23, 85, 42, 6);

  // ── north: grand hall (chamfered), two carved-back pillars
  c.octagon(52, 3, 97, 19, 5);
  c.fill(63, 8, 66, 12); // training pillars
  c.fill(83, 8, 86, 12);
  c.line(72, 19, 72, 24, 2); // hall↔lobby throat (D6 power door)

  // ── west: staggered office cluster behind D1
  c.rect(28, 21, 45, 31);
  c.rect(31, 34, 48, 45);
  c.line(44, 26, 52, 26, 2); // upper office↔lower link corridor
  c.line(45, 39, 60, 33, 2); // offices → lobby approach (diagonal)
  c.line(52, 26, 56, 31, 2);
  c.line(56, 31, 60, 32, 2); // D1 sits here

  // ── far west: parking garage + diagonal atrium gallery up to the hall
  c.rect(4, 4, 24, 20);
  c.line(24, 12, 30, 22, 2); // parking → offices ramp (diagonal)
  c.line(20, 6, 52, 8, 2); // collapsed atrium gallery → hall (long diagonal)

  // ── east: medical wing (ward + morgue) behind D2
  c.octagon(100, 21, 118, 34, 3);
  c.rect(104, 37, 122, 48);
  c.line(110, 34, 112, 37, 2); // ward↔morgue stair
  c.line(85, 32, 100, 27, 2); // lobby → ward approach (diagonal, D2 here)

  // ── far east: warehouse + gallery down from it
  c.octagon(120, 5, 141, 21, 4);
  c.line(97, 9, 120, 12, 2); // hall → warehouse gallery (diagonal)
  c.line(118, 21, 112, 26, 2); // warehouse → ward shortcut

  // ── south: winding sewer with dens, cave collapse, generator room
  c.line(72, 42, 72, 48, 2); // lobby → sewer drop (D5)
  c.line(72, 48, 56, 52, 2);
  c.line(56, 52, 40, 56, 2);
  c.disc(40, 56, 4); // west den
  c.line(40, 56, 22, 51, 2);
  // cave collapse zone: overlapping pockets
  c.disc(24, 50, 4);
  c.disc(18, 53, 5);
  c.disc(12, 49, 4);
  c.disc(14, 57, 3);
  c.line(72, 48, 90, 54, 2);
  c.disc(90, 54, 4); // east den
  c.line(90, 54, 112, 50, 2);
  c.line(112, 50, 126, 55, 2);
  c.rect(126, 50, 139, 60); // generator room
  c.line(116, 37, 112, 50, 2); // morgue → sewer back stair (loop!)

  // ── clutter: cars, crates, racks, slabs (solid, breaks sightlines)
  c.fill(8, 8, 10, 10);
  c.fill(13, 7, 15, 9);
  c.fill(18, 12, 20, 14);
  c.fill(9, 15, 11, 17); // parking cars
  c.fill(125, 9, 128, 12);
  c.fill(131, 14, 134, 17);
  c.fill(136, 7, 138, 9); // warehouse crates
  c.fill(33, 24, 35, 26);
  c.fill(40, 27, 42, 29);
  c.fill(35, 38, 37, 40);
  c.fill(43, 41, 45, 43); // office desks
  c.fill(105, 25, 107, 27);
  c.fill(112, 29, 114, 31); // ward beds
  c.fill(109, 41, 111, 44);
  c.fill(116, 41, 118, 44); // morgue slabs
  c.fill(130, 53, 132, 57); // generator block
  c.fill(70, 29, 72, 31);
  c.fill(76, 34, 78, 36); // lobby cover

  return {
    width: COLS * CELL,
    height: ROWS * CELL,
    walls: c.toWalls(),
    doors: [
      // gate spans exceed the carved corridor so nothing slips around the frame
      { x: px(58), y: px(29), w: 24, h: px(5), open: false, minWave: 2 }, // D1 west gate
      { x: px(93), y: px(27), w: 24, h: px(5), open: false, minWave: 2 }, // D2 east gate
      { x: px(70), y: px(44), w: px(5), h: 24, open: false, minWave: 3 }, // D5 sewer gate
      { x: px(70), y: px(21), w: px(5), h: 24, open: false, minWave: 6 }, // D6 power door
      { x: px(47), y: px(24), w: 24, h: px(5), open: false, minWave: 0 }, // office link
      { x: px(108), y: px(35), w: px(5), h: 24, open: false, minWave: 0 }, // ward↔morgue
      { x: px(119), y: px(10), w: 24, h: px(4), open: false, minWave: 0 }, // warehouse gallery
      { x: px(126), y: px(52), w: 24, h: px(6), open: false, minWave: 0 }, // generator room
      { x: px(25), y: px(49), w: 24, h: px(5), open: false, minWave: 0 }, // cave mouth
    ],
    spawnZones: [
      // lobby edges — wave 1 pressure (cell centers, clear of the chamfers)
      { x: px(66) + 30, y: px(25) + 30, minWave: 1 },
      { x: px(78) + 30, y: px(38) + 30, minWave: 1 },
      // wings + north (wave 2)
      { x: px(30) + 30, y: px(23) + 30, minWave: 2 },
      { x: px(46) + 30, y: px(43) + 30, minWave: 2 },
      { x: px(6) + 30, y: px(6) + 30, minWave: 2 },
      { x: px(22) + 30, y: px(18) + 30, minWave: 2 },
      { x: px(56) + 30, y: px(6) + 30, minWave: 2 },
      { x: px(92) + 30, y: px(14) + 30, minWave: 2 },
      { x: px(102) + 30, y: px(23) + 30, minWave: 2 },
      { x: px(120) + 30, y: px(46) + 30, minWave: 2 },
      { x: px(122) + 30, y: px(7) + 30, minWave: 2 },
      { x: px(137) + 30, y: px(17) + 30, minWave: 2 },
      // sewers, cave, generator (wave 3)
      { x: px(40) + 30, y: px(56) + 30, minWave: 3 },
      { x: px(90) + 30, y: px(54) + 30, minWave: 3 },
      { x: px(14) + 30, y: px(52) + 30, minWave: 3 },
      { x: px(136) + 30, y: px(57) + 30, minWave: 3 },
      { x: px(56) + 30, y: px(52) + 30, minWave: 3 },
      { x: px(112) + 30, y: px(50) + 30, minWave: 3 },
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
