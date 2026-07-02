import { describe, it, expect } from 'vitest';
import { PLAYER_RADIUS, SIM_DT } from '../../src/config';
import { buildMap, mapSolids, updateDoors } from '../../src/sim/map';
import { updateMovement } from '../../src/sim/movement';
import { createGameState, createPlayer, emptyInput } from '../../src/sim/state';
import { segmentClear } from '../../src/sim/vision';
import type { Door } from '../../src/sim/types';

describe('map + doors', () => {
  it('buildMap has walls, two doors, spawn zones and a player start', () => {
    const m = buildMap();
    expect(m.walls.length).toBeGreaterThan(4);
    expect(m.doors).toHaveLength(2);
    expect(m.spawnZones.length).toBeGreaterThan(0);
    expect(m.doors.every((d) => !d.open)).toBe(true); // all start closed
  });

  it('mapSolids counts closed doors as solid and drops open ones', () => {
    const m = buildMap();
    const s = createGameState(m.walls, m.spawnZones, m.doors, m.playerStart);
    const withClosed = mapSolids(s).length;
    s.doors[0].open = true;
    const withOneOpen = mapSolids(s).length;
    expect(withOneOpen).toBe(withClosed - 1);
  });

  it('a door opens when the player is near and stays shut when far', () => {
    const doors: Door[] = [{ x: 200, y: 200, w: 20, h: 80, open: false }];
    const far = createPlayer(600, 200);
    updateDoors(doors, far);
    expect(doors[0].open).toBe(false);
    const near = createPlayer(230, 240); // right at the door
    updateDoors(doors, near);
    expect(doors[0].open).toBe(true);
  });

  it('a closed door blocks movement like a wall', () => {
    const door = { x: 300, y: 0, w: 20, h: 200 };
    const p = createPlayer(300 - PLAYER_RADIUS - 1, 100);
    updateMovement(p, { ...emptyInput(), moveX: 1 }, [door], SIM_DT);
    expect(p.pos.x).toBeCloseTo(300 - PLAYER_RADIUS); // stopped at the door face
  });
});

describe('line of sight', () => {
  it('is clear with nothing in the way', () => {
    expect(segmentClear({ x: 0, y: 0 }, { x: 100, y: 0 }, [])).toBe(true);
  });

  it('is blocked by a wall between the points', () => {
    const wall = { x: 50, y: -20, w: 10, h: 40 };
    expect(segmentClear({ x: 0, y: 0 }, { x: 100, y: 0 }, [wall])).toBe(false);
  });

  it('is not blocked by a wall off to the side', () => {
    const wall = { x: 50, y: 100, w: 10, h: 40 };
    expect(segmentClear({ x: 0, y: 0 }, { x: 100, y: 0 }, [wall])).toBe(true);
  });
});
