import { DOOR_OPEN_RADIUS } from '../config';
import type { Door, GameState, PlayerState, SpawnZone, Wall } from './types';

export interface MapDef {
  walls: Wall[];
  doors: Door[];
  spawnZones: SpawnZone[];
  playerStart: { x: number; y: number };
}

/**
 * Handcrafted 960×540 building: a left hall and two right rooms, each right room
 * sealed behind a closed door so you can't see what's inside until you approach.
 * Replaced by Tiled maps later; the shape is what the vision system is tuned against.
 */
export function buildMap(): MapDef {
  const T = 20; // wall thickness
  return {
    walls: [
      // outer border
      { x: 0, y: 0, w: 960, h: T },
      { x: 0, y: 540 - T, w: 960, h: T },
      { x: 0, y: 0, w: T, h: 540 },
      { x: 960 - T, y: 0, w: T, h: 540 },
      // vertical divider (left hall | right rooms) with a door gap at y 230..320
      { x: 470, y: T, w: T, h: 210 },
      { x: 470, y: 320, w: T, h: 200 },
      // horizontal divider splitting the right side, door gap at x 690..770
      { x: 490, y: 270, w: 200, h: T },
      { x: 770, y: 270, w: 170, h: T },
      // a pillar in the left hall for cover
      { x: 210, y: 150, w: T, h: 96 },
    ],
    doors: [
      { x: 470, y: 230, w: T, h: 90, open: false }, // hall -> right side
      { x: 690, y: 270, w: 80, h: T, open: false }, // right-top <-> right-bottom
    ],
    spawnZones: [
      { x: 110, y: 110 }, // left hall
      { x: 110, y: 430 },
      { x: 860, y: 110 }, // right-top room
      { x: 860, y: 450 }, // right-bottom room
    ],
    playerStart: { x: 240, y: 300 },
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

/** Doors swing open (permanently) once the player is close enough. */
export function updateDoors(doors: Door[], player: PlayerState): void {
  for (const d of doors) {
    if (d.open) continue;
    const cx = d.x + d.w / 2;
    const cy = d.y + d.h / 2;
    const dx = player.pos.x - cx;
    const dy = player.pos.y - cy;
    const reach = DOOR_OPEN_RADIUS + Math.max(d.w, d.h) / 2;
    if (dx * dx + dy * dy <= reach * reach) d.open = true;
  }
}
