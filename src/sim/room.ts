import type { Wall } from './types';

/** Hardcoded 960×540 test room. Replaced by Tiled maps in the map-vision slice. */
export function testRoomWalls(): Wall[] {
  return [
    { x: 0, y: 0, w: 960, h: 24 }, // top
    { x: 0, y: 516, w: 960, h: 24 }, // bottom
    { x: 0, y: 0, w: 24, h: 540 }, // left
    { x: 936, y: 0, w: 24, h: 540 }, // right
    { x: 420, y: 220, w: 120, h: 32 }, // center obstacle
    { x: 200, y: 360, w: 32, h: 120 }, // lower-left pillar
  ];
}
